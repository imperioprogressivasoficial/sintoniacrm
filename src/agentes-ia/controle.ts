import { randomUUID } from 'node:crypto';
import type { PedidoAgente, RespostaAgente } from '../ai/agente.js';
import type { Conversa, ModoAtendimento } from '../domain.js';
import { estaAberta } from '../engine/horario.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { UNIDADES } from '../unidades.js';
import { minutosDoDia, MIN, partesBahia } from '../util/tempo.js';
import type { ArmazemAgentesIa } from './armazem.js';
import type { ExecutorAgentes } from './executor.js';
import { SemChave } from './provedores.js';
import type { AgenteIa, ConfigUnidadeControle } from './tipos.js';

/**
 * "IA atende primeiro": a IA no controle do atendimento.
 * - conversa nova da unidade (no horário escolhido) nasce no modo IA com o agente escolhido;
 * - as respostas dessa conversa saem pelo agente (persona, regras, ferramentas restritas, memória);
 * - a passagem para a equipe segue as condições do agente; a volta para a IA, o tempo configurado;
 * - correções da equipe às sugestões viram aprendizados para a gestão aprovar.
 * Desligado: nada muda (o agente padrão da Sintonia continua respondendo como sempre).
 */
export interface DependenciasControle {
  empresaId: string;
  armazem: ArmazemAgentesIa;
  executor: ExecutorAgentes;
  /** O agente de sempre (src/ai/agente.ts). */
  padrao: { executar(p: PedidoAgente): Promise<RespostaAgente> };
  repo: Pick<Repositorio, 'buscarConversa' | 'mensagens' | 'sugestao' | 'registrarEvento'>;
  /** Há chave para este agente (própria ou a geral do provedor)? */
  temChave: (a: AgenteIa) => boolean;
  sintonia: () => { mudarModo(id: string, modo: ModoAtendimento): Promise<void> };
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export function valeAgora(cfg: ConfigUnidadeControle, unidade: Conversa['unidade'], agora: Date): boolean {
  if (!cfg.ligado || !cfg.agenteId) return false;
  if (cfg.quando === 'sempre') return true;
  if (cfg.quando === 'fora_do_horario') return !estaAberta(UNIDADES[unidade], agora);
  const p = partesBahia(agora);
  const m = p.hora * 60 + p.minuto;
  const ini = minutosDoDia(cfg.inicio);
  const fim = minutosDoDia(cfg.fim);
  return ini <= fim ? m >= ini && m < fim : m >= ini || m < fim;
}

const palavras = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) ?? []);
export function parecido(a: string, b: string): number {
  const x = palavras(a);
  const y = palavras(b);
  if (!x.size && !y.size) return 1;
  let comum = 0;
  for (const p of x) if (y.has(p)) comum++;
  return comum / (x.size + y.size - comum);
}

export class ControleIa {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  constructor(private readonly d: DependenciasControle) {
    this.agora = d.agora ?? (() => new Date());
    this.log = d.log ?? (() => {});
  }

  private async configDa(unidade: Conversa['unidade']): Promise<ConfigUnidadeControle | undefined> {
    const c = await this.d.armazem.controle(this.d.empresaId);
    return unidade === 'norte' || unidade === 'sumare' ? c[unidade] : undefined;
  }

  /** Modo inicial da conversa nova (gancho da Sintonia). undefined = o de sempre. */
  async modoInicial(c: Conversa, agora: Date): Promise<ModoAtendimento | undefined> {
    try {
      const cfg = await this.configDa(c.unidade);
      if (!cfg || !valeAgora(cfg, c.unidade, agora)) return undefined;
      const a = await this.d.armazem.buscar(cfg.agenteId!);
      if (!a || !a.ativo || a.empresaId !== this.d.empresaId || !this.d.temChave(a)) return undefined;
      await this.d.armazem.definirAgenteDaConversa(c.id, a.id, 'ia_primeiro', agora);
      return 'ia';
    } catch (e) {
      this.log('Falha no "IA atende primeiro"', String(e));
      return undefined;
    }
  }

  /** Agente que responde esta conversa: o dono dela, ou o da unidade quando "IA atende primeiro" está ligado. */
  async agenteDe(c: Conversa): Promise<AgenteIa | undefined> {
    if (c.id === 'simulacao') return undefined;
    const dono = await this.d.armazem.agenteDaConversa(c.id);
    let id = dono?.agenteId;
    if (!id) {
      const cfg = await this.configDa(c.unidade);
      if (cfg?.ligado && cfg.agenteId) id = cfg.agenteId;
    }
    if (!id) return undefined;
    const a = await this.d.armazem.buscar(id);
    return a && a.ativo && a.empresaId === this.d.empresaId ? a : undefined;
  }

  /** O agente que a Sintonia usa: roteia para o agente do estúdio quando a conversa tem um. */
  roteador(): { executar(p: PedidoAgente): Promise<RespostaAgente> } {
    return {
      executar: async (p) => {
        const a = await this.agenteDe(p.conversa).catch(() => undefined);
        if (!a) return this.d.padrao.executar(p);
        // "Retomar conversas paradas" desligado na unidade: o agente não manda follow-up (nada é enviado).
        if (p.tipoAtivo?.startsWith('followup')) {
          const cfg = await this.configDa(p.conversa.unidade).catch(() => undefined);
          if (cfg?.ligado && cfg.retomarParadas === false) return { texto: '', acoes: [], recusou: false };
        }
        try {
          const r = await this.d.executor.executar(a, p);
          return { texto: r.texto, acoes: r.acoes, recusou: r.recusou };
        } catch (e) {
          if (e instanceof SemChave) {
            this.log(`Agente ${a.nome} sem chave; respondendo com a IA padrão`);
            return this.d.padrao.executar(p);
          }
          throw e;
        }
      },
    };
  }

  /** Assumir (atendente) ou devolver para a IA. */
  async devolverParaIa(conversaId: string, agenteId?: string): Promise<AgenteIa | undefined> {
    const c = await this.d.repo.buscarConversa(conversaId);
    if (!c) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    let a = agenteId ? await this.d.armazem.buscar(agenteId) : await this.agenteDe(c);
    if (a && a.empresaId !== this.d.empresaId) a = undefined;
    if (a) await this.d.armazem.definirAgenteDaConversa(c.id, a.id, 'devolvida', this.agora());
    await this.d.sintonia().mudarModo(c.id, 'ia');
    return a;
  }

  /**
   * Relógio: devolve para a IA as conversas em que a equipe atuou e depois sumiu por N minutos
   * (com a cliente esperando). Não devolve as que a IA passou para a equipe ("precisa da equipe").
   */
  async tick(): Promise<number> {
    const agora = this.agora();
    const ctrl = await this.d.armazem.controle(this.d.empresaId);
    let n = 0;
    for (const dono of await this.d.armazem.conversasComAgente()) {
      const c = await this.d.repo.buscarConversa(dono.conversaId).catch(() => undefined);
      if (!c || c.modo === 'ia' || c.empresaId !== this.d.empresaId) continue;
      const cfg = c.unidade === 'norte' || c.unidade === 'sumare' ? ctrl[c.unidade] : undefined;
      if (!cfg?.ligado || cfg.voltarAposMin == null) continue;
      if (c.etiquetas.includes('precisa da equipe')) continue;
      const cli = c.ultimaMensagemCliente?.getTime() ?? 0;
      const equipe = c.ultimaMensagemEquipe?.getTime() ?? 0;
      if (!equipe || cli <= Math.max(equipe, c.ultimaMensagemIa?.getTime() ?? 0)) continue;
      if (agora.getTime() - Math.max(equipe, cli) < cfg.voltarAposMin * MIN) continue;
      if (c.pausaIaAte && c.pausaIaAte.getTime() > agora.getTime()) continue;
      await this.d.repo.registrarEvento({ tipo: 'ia_assumiu', conversaId: c.id, unidade: c.unidade, em: agora, dados: { motivo: `A equipe não respondeu em ${cfg.voltarAposMin} min: voltou para a IA.`, agenteId: dono.agenteId, por: 'IA' } });
      await this.d.sintonia().mudarModo(c.id, 'ia');
      n++;
    }
    return n;
  }

  /**
   * A equipe respondeu: se a resposta foi bem diferente da sugestão da IA, vira um aprendizado
   * pendente ("a IA aprendeu isso, aprovar?").
   */
  async aoEvento(e: Evento): Promise<void> {
    if (e.tipo !== 'equipe_respondeu' || !e.conversaId) return;
    try {
      const c = await this.d.repo.buscarConversa(e.conversaId);
      if (!c) return;
      const a = await this.agenteDe(c);
      if (!a) return;
      const sugestao = await this.d.repo.sugestao(c.id);
      if (!sugestao?.trim()) return;
      const msgs = await this.d.repo.mensagens(c.id, 30);
      const idx = msgs.map((m) => m.autor).lastIndexOf('equipe');
      if (idx < 0) return;
      const enviada = msgs[idx]!.texto;
      const cliente = msgs.slice(0, idx).filter((m) => m.autor === 'cliente').at(-1)?.texto;
      if (!cliente || enviada.trim().length < 12 || parecido(sugestao, enviada) >= 0.5) return;
      const pendentes = await this.d.armazem.aprendizados(a.id, 'pendente');
      if (pendentes.some((p) => p.origem.conversaId === c.id && p.origem.sugestao === sugestao)) return;
      await this.d.armazem.adicionarAprendizado({
        id: randomUUID(),
        agenteId: a.id,
        texto: `Quando a cliente disser algo como "${cliente.slice(0, 160)}", responda no estilo da equipe: "${enviada.slice(0, 300)}"`,
        origem: { conversaId: c.id, cliente, sugestao, enviada, atendente: e.dados?.atendente ?? null },
        situacao: 'pendente',
        criadoEm: this.agora(),
        decididoPor: null,
        decididoEm: null,
      });
    } catch (x) {
      this.log('Falha ao registrar aprendizado', String(x));
    }
  }
}

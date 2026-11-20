import type { PedidoAgente, RespostaAgente } from '../ai/agente.js';
import type { Conversa } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { MIN, partesBahia } from '../util/tempo.js';
import type { ArmazemRadar } from './armazem.js';
import { juizSemIa, type Juiz } from './juiz.js';
import { curto, EntradaRadar, type HistoricoRadar, type ItemRadar, type TipoHistoricoRadar } from './tipos.js';

/**
 * Radar ("tô no radar"): só entra quem a equipe coloca. Cada mensagem nova da cliente numa conversa no radar
 * passa pelo juiz (IA); prazo vencido também dispara. Ao disparar:
 * - avisa quem colocou (evento "radar" → sino + push, no Notificador);
 * - com "A IA responde", a resposta sai pelo caminho de sempre da IA: se a IA está atendendo a conversa,
 *   a instrução do radar vai como objetivo na resposta normal (gancho objetivoIa); senão, o relógio do radar
 *   pede a resposta ao agente e envia como mensagem automática. IA desligada ou sem chave: só avisa.
 */

export interface SintoniaParaRadar {
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined>;
  enviarAutomatico(c: Conversa, texto: string, autorNome: string): Promise<string>;
}

export interface OpcoesRadar {
  empresaId: string;
  armazem: ArmazemRadar;
  repo: Pick<Repositorio, 'buscarConversa' | 'mensagens' | 'registrarEvento' | 'salvarConversa'>;
  sintonia: () => SintoniaParaRadar;
  agente?: { executar(p: PedidoAgente): Promise<RespostaAgente> };
  /** Juiz com IA (Claude). Só é usado quando `iaDisponivel()` diz que há chave. */
  juiz?: Juiz;
  iaDisponivel?: () => boolean;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export const AUTOR_RADAR = 'Radar';
/** Com a IA atendendo, espera a resposta normal dela por este tempo antes de o próprio radar responder. */
const ESPERA_IA_MS = 3 * MIN;
/** Limite para o juiz não segurar a conversa (ele roda antes da resposta da IA). */
const LIMITE_JUIZ_MS = 25_000;

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function quandoCurto(d: Date): string {
  const p = partesBahia(d);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${DIAS[p.diaSemana]}, ${dois(p.dia)}/${dois(p.mes)} ${dois(p.hora)}:${dois(p.minuto)}`;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

export class Radar {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private fila: Promise<void> = Promise.resolve();
  private rodando = false;

  constructor(private readonly o: OpcoesRadar) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  private iaLigada(): boolean {
    return Boolean(this.o.iaDisponivel?.());
  }

  private async hist(conversaId: string, tipo: TipoHistoricoRadar, texto: string, por?: string): Promise<void> {
    await this.o.armazem.registrar(this.o.empresaId, { conversaId, tipo, texto, por, em: this.agora() });
  }

  // ------------------------------------------------------------ ações da equipe

  /** Coloca no radar (ou muda o que está vigiando: volta a vigiar do zero). */
  async colocar(c: Conversa, bruto: unknown, quem: { id?: string; nome: string }): Promise<ItemRadar> {
    const e = EntradaRadar.parse(bruto);
    const agora = this.agora();
    const prazo = e.prazo ? new Date(e.prazo) : undefined;
    if (prazo && prazo.getTime() <= agora.getTime()) throw erro('O prazo precisa ser no futuro.', 400);
    const antes = await this.o.armazem.obter(c.id);
    const item: ItemRadar = {
      conversaId: c.id,
      empresaId: this.o.empresaId,
      vigiar: e.vigiar,
      ...(prazo ? { prazo } : {}),
      acao: e.acao,
      ...(e.acao === 'ia' && e.instrucao ? { instrucao: e.instrucao } : {}),
      ...(quem.id ? { donoId: quem.id } : {}),
      donoNome: quem.nome,
      estado: 'vigiando',
      criadoEm: antes?.criadoEm ?? agora,
      atualizadoEm: agora,
    };
    await this.o.armazem.salvar(item);
    const acao = e.acao === 'ia' ? 'a IA responde' : 'me avisar';
    await this.hist(c.id, antes ? 'editou' : 'entrou', `${antes ? 'Mudou o radar' : 'Entrou no radar'}: vigiar "${curto(e.vigiar, 120)}"${prazo ? `, prazo ${quandoCurto(prazo)}` : ''}, ${acao}.`, quem.nome);
    return item;
  }

  async tirar(conversaId: string, quem: { nome: string }): Promise<boolean> {
    const ok = await this.o.armazem.apagar(conversaId);
    if (ok) await this.hist(conversaId, 'saiu', 'Saiu do radar.', quem.nome);
    return ok;
  }

  /** Quem colocou abriu a conversa depois do disparo: o número vermelho do chip baixa. */
  async visto(conversaId: string, quem: { id?: string; nome: string }): Promise<boolean> {
    const item = await this.o.armazem.obter(conversaId);
    if (!item || item.estado !== 'disparou' || item.vistoEm) return false;
    if (item.donoId && quem.id && item.donoId !== quem.id) return false;
    await this.o.armazem.atualizar(conversaId, { vistoEm: this.agora() });
    await this.hist(conversaId, 'visto', 'Aviso visto.', quem.nome);
    return true;
  }

  /** Depois do disparo, voltar a vigiar a mesma coisa (sem o prazo que já passou). */
  async vigiarDeNovo(c: Conversa, quem: { id?: string; nome: string }): Promise<ItemRadar | undefined> {
    const item = await this.o.armazem.obter(c.id);
    if (!item) return undefined;
    const agora = this.agora();
    const prazo = item.prazo && item.prazo.getTime() > agora.getTime() ? item.prazo : undefined;
    const novo: ItemRadar = { ...item, estado: 'vigiando', prazo, motivo: undefined, disparadoEm: undefined, vistoEm: undefined, resposta: undefined, respostaAte: undefined, atualizadoEm: agora };
    await this.o.armazem.salvar(novo);
    await this.hist(c.id, 'de_novo', 'Voltou a vigiar.', quem.nome);
    return novo;
  }

  listar(): Promise<ItemRadar[]> {
    return this.o.armazem.listar(this.o.empresaId);
  }

  async daConversa(conversaId: string): Promise<{ item?: ItemRadar; historico: HistoricoRadar[] }> {
    const [item, historico] = await Promise.all([this.o.armazem.obter(conversaId), this.o.armazem.historico(conversaId, 20)]);
    return { item: item && item.empresaId === this.o.empresaId ? item : undefined, historico };
  }

  // ------------------------------------------------------------ mensagem nova da cliente (sob a trava)

  /**
   * Gancho mensagemCliente (já SOB a trava da conversa; não pode pedir a trava de novo).
   * Roda antes da resposta da IA: assim, se disparar com "A IA responde", a resposta normal já leva a instrução.
   */
  async mensagemCliente(c: Conversa, m: { texto: string }): Promise<void> {
    const item = await this.o.armazem.obter(c.id);
    if (!item || item.estado !== 'vigiando' || item.empresaId !== this.o.empresaId) return;
    const agora = this.agora();
    const mensagens = await this.o.repo.mensagens(c.id);
    const pedido = { vigiar: item.vigiar, prazo: item.prazo, mensagens, novas: m.texto, agora };
    let v = await juizSemIa(pedido);
    if (this.iaLigada() && this.o.juiz) {
      try {
        v = await Promise.race([
          this.o.juiz(pedido),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('a IA demorou demais')), LIMITE_JUIZ_MS).unref?.()),
        ]);
      } catch (x) {
        this.log('Radar: a IA não conseguiu conferir; valeu a comparação simples', String(x));
      }
    }
    if (v.situacao === 'ainda_nao') return;
    await this.disparar(c, item, v.situacao === 'nao_precisa_mais' ? 'resolvido' : 'mensagem', v.motivo || `Ela escreveu: "${curto(m.texto, 120)}"`);
  }

  /** Instrução extra para a resposta normal da IA (gancho objetivoIa), quando o radar acabou de disparar com "A IA responde". */
  async objetivo(c: Conversa): Promise<string | undefined> {
    const item = await this.o.armazem.obter(c.id);
    if (!item || item.resposta !== 'pendente' || c.modo !== 'ia') return undefined;
    return this.textoObjetivo(item, false);
  }

  private textoObjetivo(item: ItemRadar, ativo: boolean): string {
    const base = ativo
      ? `A equipe colocou esta conversa no radar para vigiar: "${item.vigiar}". ${item.motivo ?? 'Chegou o prazo.'}`
      : `A equipe colocou esta conversa no radar para vigiar: "${item.vigiar}". Isso acabou de acontecer: ${item.motivo ?? ''}`;
    const instr = item.instrucao ? ` Instrução da equipe para este momento: ${item.instrucao}` : ' Responda de forma natural, levando ao próximo passo.';
    return `${base}${instr}${ativo ? ' Escreva uma mensagem curta e natural para enviar agora à cliente.' : ''}`;
  }

  private async disparar(c: Conversa, item: ItemRadar, origem: 'mensagem' | 'prazo' | 'resolvido', motivo: string): Promise<void> {
    const agora = this.agora();
    const querIa = item.acao === 'ia' && origem !== 'resolvido';
    const podeIa = querIa && this.iaLigada() && Boolean(this.o.agente);
    // Com a IA atendendo a conversa, a resposta normal dela leva a instrução; o radar só entra se ela não responder.
    const respostaAte = origem === 'mensagem' && c.modo === 'ia' ? new Date(agora.getTime() + ESPERA_IA_MS) : agora;
    const ok = await this.o.armazem.disparar(c.id, { motivo, disparadoEm: agora, ...(podeIa ? { resposta: 'pendente' as const, respostaAte } : {}) });
    if (!ok) return;
    await this.hist(c.id, origem === 'resolvido' ? 'resolvido' : 'disparou', origem === 'resolvido' ? `Não precisa mais vigiar: ${motivo}` : `Disparou: ${motivo}`);
    if (querIa && !podeIa) await this.hist(c.id, 'so_avisou', 'A IA está desligada ou sem chave: só avisamos a equipe.');
    await this.o.repo.registrarEvento({
      tipo: 'radar',
      conversaId: c.id,
      unidade: c.unidade,
      em: agora,
      dados: { acao: 'disparou', origem, motivo, vigiar: item.vigiar, donoId: item.donoId ?? null, iaResponde: podeIa },
    });
  }

  // ------------------------------------------------------------ eventos e relógio

  /** Ouvinte dos eventos: a IA respondeu com o radar pendente = a instrução foi junto. */
  aoEvento(e: Evento): void {
    if (e.tipo !== 'ia_respondeu' || !e.conversaId) return;
    const id = e.conversaId;
    this.fila = this.fila
      .then(async () => {
        const item = await this.o.armazem.obter(id);
        if (item?.resposta !== 'pendente') return;
        await this.o.armazem.atualizar(id, { resposta: 'feita' });
        await this.hist(id, 'ia_respondeu', 'A IA respondeu seguindo o radar.');
      })
      .catch((x) => this.log('Falha no radar (evento)', String(x)));
  }

  async ocioso(): Promise<void> {
    await this.fila;
  }

  async tick(): Promise<{ disparados: number; respostas: number }> {
    if (this.rodando) return { disparados: 0, respostas: 0 };
    this.rodando = true;
    let disparados = 0;
    let respostas = 0;
    try {
      const agora = this.agora();
      for (const item of await this.o.armazem.vencidos(this.o.empresaId, agora)) {
        try {
          const c = await this.o.repo.buscarConversa(item.conversaId);
          if (!c) {
            await this.o.armazem.apagar(item.conversaId);
            continue;
          }
          await this.disparar(c, item, 'prazo', `Chegou o prazo (${quandoCurto(item.prazo!)}).`);
          disparados++;
        } catch (x) {
          this.log('Falha no radar (prazo)', { conversa: item.conversaId, erro: String(x) });
        }
      }
      for (const item of await this.o.armazem.respostasPendentes(this.o.empresaId, this.agora())) {
        if (await this.responder(item).catch((x) => (this.log('Falha no radar (resposta)', String(x)), false))) respostas++;
      }
    } finally {
      this.rodando = false;
    }
    return { disparados, respostas };
  }

  /** "A IA responde" quando a IA da conversa não respondeu (atendente atendendo, prazo vencido). */
  private async responder(item: ItemRadar): Promise<boolean> {
    const fim = async (resposta: 'feita' | 'nao_saiu', tipo: TipoHistoricoRadar, texto: string) => {
      await this.o.armazem.atualizar(item.conversaId, { resposta });
      await this.hist(item.conversaId, tipo, texto);
    };
    if (!this.iaLigada() || !this.o.agente) {
      await fim('nao_saiu', 'ia_nao_respondeu', 'A IA ficou desligada ou sem chave: a resposta não saiu.');
      return false;
    }
    const agente = this.o.agente;
    let falhou = false;
    const r = await this.o.sintonia().comConversa(item.conversaId, async (c) => {
      // Sob a trava: confere de novo (outro processo pode ter feito).
      const atual = await this.o.armazem.obter(c.id);
      if (atual?.resposta !== 'pendente') return { feito: false as const };
      const desde = atual.disparadoEm?.getTime() ?? 0;
      if ((c.ultimaMensagemEquipe?.getTime() ?? 0) > desde) return { feito: false as const, estado: 'nao_saiu' as const, tipo: 'ia_nao_respondeu' as const, texto: 'A equipe respondeu antes: a IA não enviou nada.' };
      if ((c.ultimaMensagemIa?.getTime() ?? 0) > desde) return { feito: false as const, estado: 'feita' as const, tipo: 'ia_respondeu' as const, texto: 'A IA já tinha respondido.' };
      const ativo = !atual.motivo || atual.motivo.startsWith('Chegou o prazo');
      const ia = await agente.executar({ conversa: c, mensagens: await this.o.repo.mensagens(c.id), agora: this.agora(), modo: 'responder', objetivo: this.textoObjetivo(atual, ativo) });
      const texto = ia.texto.trim();
      if (!texto || ia.recusou) return { feito: false as const, estado: 'nao_saiu' as const, tipo: 'ia_nao_respondeu' as const, texto: 'A IA não quis responder esta: fica com a equipe.' };
      await this.o.sintonia().enviarAutomatico(c, texto, AUTOR_RADAR);
      await this.o.repo.salvarConversa(c);
      return { feito: true as const, estado: 'feita' as const, tipo: 'ia_respondeu' as const, texto: `A IA respondeu: "${curto(texto, 140)}"` };
    }).catch(async (x) => {
      falhou = true;
      await fim('nao_saiu', 'ia_nao_respondeu', `A resposta da IA não saiu: ${curto(String((x as Error)?.message ?? x), 120)}`);
      return undefined;
    });
    if (!r) {
      if (!falhou) await fim('nao_saiu', 'ia_nao_respondeu', 'A conversa não existe mais.');
      return false;
    }
    if ('estado' in r && r.estado) await fim(r.estado, r.tipo, r.texto);
    return r.feito;
  }
}

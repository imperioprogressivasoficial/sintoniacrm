import { randomUUID } from 'node:crypto';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { ClienteClaudeParse } from '../ai/copiloto.js';
import { ETAPAS, NOME_ETAPA, type Conversa, type Etapa, type ModoAtendimento } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { bahia, DIA, MIN, partesBahia } from '../util/tempo.js';
import type { ArmazemAgentesIa } from './armazem.js';
import type { RegistroComando } from './tipos.js';

/**
 * "Peça para a IA": a gestão escreve em português o que quer ("mova para Interessada quem pediu preço hoje
 * e não agendou"); vira um PLANO num formato fechado (filtro + uma ação), com a lista das conversas afetadas.
 * Nada muda até a confirmação. Só ações seguras que já existem, com limite de itens e auditoria.
 */

export const LIMITE_ITENS = 200;

export const Filtro = z.object({
  unidade: z.enum(['norte', 'sumare']).nullable().default(null),
  etapas: z.array(z.enum(ETAPAS)).default([]),
  comTag: z.string().max(60).nullable().default(null),
  semTag: z.string().max(60).nullable().default(null),
  /** Pediu preço nos últimos N dias (0 = hoje). */
  pediuPrecoDias: z.number().int().min(0).max(90).nullable().default(null),
  naoAgendou: z.boolean().default(false),
  /** Cliente sem escrever há pelo menos N dias (sumiu). */
  sumiuDias: z.number().int().min(1).max(365).nullable().default(null),
  /** Gasto somado nos agendamentos registrados (R$). */
  gastouAcimaDe: z.number().min(0).nullable().default(null),
  modo: z.enum(['ia', 'copiloto', 'humano']).nullable().default(null),
});
export type Filtro = z.infer<typeof Filtro>;

export const Acao = z.object({
  tipo: z.enum(['listar', 'mover_etapa', 'marcar_tag', 'criar_lembrete', 'mudar_modo']),
  etapa: z.enum(ETAPAS).nullable().default(null),
  tag: z.string().max(60).nullable().default(null),
  texto: z.string().max(200).nullable().default(null),
  modo: z.enum(['ia', 'copiloto', 'humano']).nullable().default(null),
});
export type Acao = z.infer<typeof Acao>;

export const Interpretacao = z.object({
  entendeu: z.boolean().describe('false se o pedido não cabe nas ações e filtros disponíveis'),
  filtro: Filtro,
  acao: Acao,
  explicacao: z.string().describe('Uma frase em português dizendo o que vai ser feito'),
});
export type Interpretacao = z.infer<typeof Interpretacao>;

export interface ItemPlano {
  conversaId: string;
  nome: string | null;
  telefone: string;
  unidade: string;
  etapa: Etapa;
  motivo: string;
}

export interface Plano {
  filtro: Filtro;
  acao: Acao;
  explicacao: string;
  origem: 'regras' | 'ia';
  itens: ItemPlano[];
  total: number;
  cortado: boolean;
  avisos: string[];
}

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function etapaPorNome(t: string): Etapa | undefined {
  const n = sem(t).trim();
  return ETAPAS.find((e) => sem(NOME_ETAPA[e]) === n || e === n.replace(/\s+/g, '_'));
}

/** Interpretação por regras (funciona sem chave da IA) para os pedidos mais comuns. */
export function interpretarPorRegras(texto: string, tags: string[]): Interpretacao | undefined {
  const t = sem(texto);
  const filtro = Filtro.parse({});
  const acao = Acao.parse({ tipo: 'listar' });

  const nomesEtapa = ETAPAS.map((e) => sem(NOME_ETAPA[e])).sort((a, b) => b.length - a.length);
  const achaEtapaDepois = (re: RegExp): Etapa | undefined => {
    const m = t.match(re);
    if (!m) return undefined;
    const resto = m[1]!.trim();
    const nome = nomesEtapa.find((n) => resto.startsWith(n));
    return nome ? etapaPorNome(nome) : undefined;
  };

  // ação
  if (/\b(mova|mover|move|passe|passar|coloque|colocar|jogue|leve)\b/.test(t)) {
    const etapa = achaEtapaDepois(/\b(?:para|pra|pro|em)\s+(?:a\s+|o\s+|etapa\s+)?(.+)/);
    if (!etapa) return undefined;
    acao.tipo = 'mover_etapa';
    acao.etapa = etapa;
  } else if (/\b(marque|marcar|marca|etiquete|coloque a tag|ponha a tag)\b/.test(t)) {
    const alvo = tags.find((n) => new RegExp(`\\b${sem(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
    if (!alvo) return undefined;
    acao.tipo = 'marcar_tag';
    acao.tag = alvo;
  } else if (/\b(lembrete|lembrar de ligar|ligar para|ligue para)\b/.test(t)) {
    acao.tipo = 'criar_lembrete';
    acao.texto = 'Ligar (pedido da gestão)';
  } else if (/\b(liste|listar|lista|mostre|mostrar|quais|quem|quantas)\b/.test(t)) {
    acao.tipo = 'listar';
  } else return undefined;

  // filtros
  if (/\bnorte\b/.test(t)) filtro.unidade = 'norte';
  if (/\bsumare\b/.test(t)) filtro.unidade = 'sumare';
  if (/\b(pre[cç]o|precos|quanto custa|valor|valores)\b/.test(t)) {
    filtro.pediuPrecoDias = /\bontem\b/.test(t) ? 1 : (() => {
      const m = t.match(/(\d+)\s*dias?/);
      return /\bsemana\b/.test(t) ? 7 : m && !/sumi|sem responder|parad/.test(t) ? Number(m[1]) : 0;
    })();
  }
  if (/\b(nao|sem) (agendaram|agendou|agendar|marcaram|marcou|marcar)\b/.test(t)) filtro.naoAgendou = true;
  const sumiu = t.match(/(?:sumi\w*|sem responder|parad\w*|nao responde\w*)\s*(?:ha|faz|a mais de|por)?\s*(\d+)\s*dias?/);
  if (sumiu) filtro.sumiuDias = Number(sumiu[1]);
  else if (/\bsumi\w*\b/.test(t)) filtro.sumiuDias = 3;
  const gasto = t.match(/(?:gastou|gastaram|gasto|consumiu)\s*(?:mais de|acima de|>)\s*r?\$?\s*(\d+(?:[.,]\d+)?)/);
  if (gasto) filtro.gastouAcimaDe = Number(gasto[1]!.replace(',', '.'));
  const naEtapa = t.match(/\b(?:que estao|estao|que esta|na etapa|em)\s+(?:na\s+|no\s+|em\s+)?([a-z ]+?)(?:\s+(?:e|que|ha|sem|com)\b|$)/);
  if (naEtapa && acao.tipo !== 'mover_etapa') {
    const e = etapaPorNome(naEtapa[1]!);
    if (e) filtro.etapas = [e];
  } else if (acao.tipo === 'mover_etapa') {
    const m = t.match(/\b(?:que estao|estao|que esta)\s+(?:na\s+|no\s+|em\s+)?([a-z ]+?)(?:\s+(?:e|que|ha|sem|com|para|pra)\b|$)/);
    const e = m ? etapaPorNome(m[1]!) : undefined;
    if (e) filtro.etapas = [e];
  }
  const comTag = t.match(/\bcom (?:a )?tag\s+([\wà-ú]+)/);
  if (comTag) filtro.comTag = tags.find((n) => sem(n) === comTag[1]) ?? null;
  const semTag = t.match(/\bsem (?:a )?tag\s+([\wà-ú]+)/);
  if (semTag) filtro.semTag = tags.find((n) => sem(n) === semTag[1]) ?? null;
  if (acao.tipo === 'marcar_tag' && acao.tag) filtro.semTag = acao.tag;

  const algum = filtro.unidade || filtro.etapas.length || filtro.comTag || filtro.pediuPrecoDias != null || filtro.naoAgendou || filtro.sumiuDias || filtro.gastouAcimaDe != null;
  if (!algum && acao.tipo !== 'listar') return undefined;
  return { entendeu: true, filtro, acao, explicacao: explicar(filtro, acao) };
}

export function explicar(f: Filtro, a: Acao): string {
  const partes: string[] = [];
  if (f.pediuPrecoDias != null) partes.push(f.pediuPrecoDias === 0 ? 'pediram preço hoje' : `pediram preço nos últimos ${f.pediuPrecoDias} dia(s)`);
  if (f.naoAgendou) partes.push('não agendaram');
  if (f.sumiuDias) partes.push(`não escrevem há ${f.sumiuDias} dia(s) ou mais`);
  if (f.gastouAcimaDe != null) partes.push(`gastaram mais de R$ ${f.gastouAcimaDe}`);
  if (f.etapas.length) partes.push(`estão em ${f.etapas.map((e) => NOME_ETAPA[e]).join(' ou ')}`);
  if (f.comTag) partes.push(`têm a tag ${f.comTag}`);
  if (f.semTag) partes.push(`ainda não têm a tag ${f.semTag}`);
  if (f.unidade) partes.push(f.unidade === 'norte' ? 'da unidade Norte' : 'da unidade Sumaré');
  if (f.modo) partes.push(`no modo ${f.modo}`);
  const quem = partes.length ? `as conversas que ${partes.join(', ')}` : 'todas as conversas';
  switch (a.tipo) {
    case 'listar':
      return `Listar ${quem}.`;
    case 'mover_etapa':
      return `Mover para ${NOME_ETAPA[a.etapa!]} ${quem}.`;
    case 'marcar_tag':
      return `Marcar a tag ${a.tag} em ${quem}.`;
    case 'criar_lembrete':
      return `Criar lembrete de ligação para ${quem}.`;
    case 'mudar_modo':
      return `Mudar para o modo ${a.modo} ${quem}.`;
  }
}

export interface DependenciasComandos {
  empresaId: string;
  armazem: ArmazemAgentesIa;
  repo: Pick<Repositorio, 'listarConversas' | 'mensagens' | 'eventosEntre' | 'registrarEvento' | 'buscarConversa'>;
  /** Nomes das tags existentes (marcar só tag que existe). */
  tags: () => Promise<string[]>;
  tagsDaConversa: (conversaId: string) => Promise<string[]>;
  moverEtapa: (conversaId: string, etapa: Etapa, por: string) => Promise<boolean>;
  marcarTag: (conversaId: string, tag: string, por: string) => Promise<boolean>;
  mudarModo: (conversaId: string, modo: ModoAtendimento) => Promise<void>;
  /** Interpretação pela IA quando as regras não entendem (ausente/sem chave = só regras). */
  claude?: () => ClienteClaudeParse | undefined;
  modelo?: string;
  agora?: () => Date;
}

const PRECO = /pre[cç]o|quanto (custa|fica|é|e\b|sai)|valor|valores|tabela/i;

export class Comandos {
  private readonly agora: () => Date;
  constructor(private readonly d: DependenciasComandos) {
    this.agora = d.agora ?? (() => new Date());
  }

  async interpretar(texto: string): Promise<Interpretacao & { origem: 'regras' | 'ia' }> {
    const tags: string[] = await this.d.tags().catch(() => []);
    const r = interpretarPorRegras(texto, tags);
    if (r) return { ...r, origem: 'regras' };
    const claude = this.d.claude?.();
    if (!claude) {
      throw Object.assign(new Error('Não entendi o pedido. Tente algo como “mova para Interessada quem pediu preço hoje e não agendou”, “marque VIP quem gastou mais de 500” ou “liste quem sumiu há 3 dias”. (Com a chave da IA configurada, ela entende pedidos mais livres.)'), { statusCode: 422 });
    }
    const naoEntendi = () => Object.assign(new Error('A IA não conseguiu transformar esse pedido numa ação segura. Reescreva com: o que fazer (mover, marcar tag, listar, lembrete) e quem.'), { statusCode: 422 });
    const resp = await Promise.resolve().then(() => claude.beta.messages.parse({
      model: this.d.modelo ?? 'claude-opus-5-5',
      max_tokens: 4000,
      system: `Você traduz pedidos da gestão de um salão (CRM de WhatsApp) para um plano fechado: um filtro de conversas e UMA ação.
Etapas: ${ETAPAS.map((e) => `${e} (${NOME_ETAPA[e]})`).join(', ')}. Tags existentes: ${tags.map((x) => `"${x}"`).join(', ') || 'nenhuma'}.
Ações: listar, mover_etapa (precisa de etapa), marcar_tag (só tag existente), criar_lembrete (texto curto), mudar_modo.
Se o pedido pedir algo fora disso (apagar, enviar mensagem, mudar preço), devolva entendeu = false. Campos sem uso ficam null, false ou [].`,
      messages: [{ role: 'user', content: texto }],
      output_config: { effort: 'low', format: betaZodOutputFormat(Interpretacao) },
    })).catch(() => undefined);
    if (!resp || resp.stop_reason === 'refusal' || !resp.parsed_output || !resp.parsed_output.entendeu) throw naoEntendi();
    const i = resp.parsed_output;
    if (i.acao.tipo === 'marcar_tag' && !tags.includes(i.acao.tag ?? '')) throw Object.assign(new Error('Essa tag não existe. Crie a tag antes.'), { statusCode: 422 });
    return { ...i, explicacao: explicar(i.filtro, i.acao), origem: 'ia' };
  }

  /** Aplica o filtro nas conversas que a pessoa pode ver. */
  async filtrar(f: Filtro, visivel: (c: Conversa) => boolean): Promise<ItemPlano[]> {
    const agora = this.agora();
    let lista = (await this.d.repo.listarConversas()).filter((c) => c.empresaId === this.d.empresaId && visivel(c));
    if (f.unidade) lista = lista.filter((c) => c.unidade === f.unidade);
    if (f.etapas.length) lista = lista.filter((c) => f.etapas.includes(c.etapa));
    if (f.modo) lista = lista.filter((c) => c.modo === f.modo);
    if (f.naoAgendou) lista = lista.filter((c) => c.etapa !== 'agendada' && c.etapa !== 'compareceu');
    const motivo = new Map<string, string[]>();
    const add = (id: string, m: string) => motivo.set(id, [...(motivo.get(id) ?? []), m]);
    if (f.sumiuDias) {
      const limite = agora.getTime() - f.sumiuDias * DIA;
      lista = lista.filter((c) => {
        const t = c.ultimaMensagemCliente?.getTime();
        if (!t || t > limite || c.etapa === 'perdida' || c.etapa === 'agendada' || c.etapa === 'compareceu') return false;
        add(c.id, `sem escrever há ${Math.floor((agora.getTime() - t) / DIA)} dia(s)`);
        return true;
      });
    }
    if (f.pediuPrecoDias != null) {
      const p = partesBahia(agora);
      const inicio = bahia(p.ano, p.mes, p.dia).getTime() - f.pediuPrecoDias * DIA;
      const candidatas = lista.filter((c) => (c.ultimaMensagemCliente?.getTime() ?? 0) >= inicio);
      const ok = new Set<string>();
      for (const c of candidatas) {
        const ms = await this.d.repo.mensagens(c.id, 60);
        const m = ms.find((x) => x.autor === 'cliente' && x.em.getTime() >= inicio && PRECO.test(x.texto));
        if (m) {
          ok.add(c.id);
          add(c.id, `pediu preço: “${m.texto.slice(0, 60)}”`);
        }
      }
      lista = lista.filter((c) => ok.has(c.id));
    }
    if (f.gastouAcimaDe != null) {
      const eventos = await this.d.repo.eventosEntre(new Date(agora.getTime() - 400 * DIA), new Date(agora.getTime() + MIN));
      const gasto = new Map<string, number>();
      for (const e of eventos) {
        if ((e.tipo === 'agendamento_ia' || e.tipo === 'agendamento_equipe') && e.conversaId) {
          const v = Number(e.dados?.valor ?? 0);
          if (Number.isFinite(v)) gasto.set(e.conversaId, (gasto.get(e.conversaId) ?? 0) + v);
        }
      }
      lista = lista.filter((c) => {
        const g = gasto.get(c.id) ?? 0;
        if (g <= f.gastouAcimaDe!) return false;
        add(c.id, `gastou R$ ${g.toFixed(2).replace('.', ',')}`);
        return true;
      });
    }
    if (f.comTag || f.semTag) {
      const saida: Conversa[] = [];
      for (const c of lista) {
        const tags = (await this.d.tagsDaConversa(c.id)).map((x) => x.toLowerCase());
        if (f.comTag && !tags.includes(f.comTag.toLowerCase())) continue;
        if (f.semTag && tags.includes(f.semTag.toLowerCase())) continue;
        saida.push(c);
      }
      lista = saida;
    }
    lista.sort((a, b) => (b.ultimaMensagemCliente?.getTime() ?? 0) - (a.ultimaMensagemCliente?.getTime() ?? 0));
    return lista.map((c) => ({ conversaId: c.id, nome: c.nome ?? null, telefone: c.telefone, unidade: c.unidade, etapa: c.etapa, motivo: (motivo.get(c.id) ?? []).join(' · ') || NOME_ETAPA[c.etapa] }));
  }

  /** Monta o plano com a prévia e grava (situação "planejado"). Nada muda aqui. */
  async planejar(texto: string, quem: { nome: string; id?: string }, visivel: (c: Conversa) => boolean): Promise<RegistroComando & { plano: Plano }> {
    const i = await this.interpretar(texto);
    const todos = await this.filtrar(i.filtro, visivel);
    const avisos: string[] = [];
    let itens = todos;
    if (i.acao.tipo === 'mover_etapa') itens = itens.filter((x) => x.etapa !== i.acao.etapa);
    const cortado = itens.length > LIMITE_ITENS;
    if (cortado) avisos.push(`São ${itens.length} conversas; por segurança, um comando mexe em no máximo ${LIMITE_ITENS}. Rode de novo depois para as demais.`);
    if (i.filtro.gastouAcimaDe != null) avisos.push('O gasto é somado dos agendamentos registrados na Sintonia.');
    const plano: Plano = { filtro: i.filtro, acao: i.acao, explicacao: i.explicacao, origem: i.origem, itens: itens.slice(0, LIMITE_ITENS), total: itens.length, cortado, avisos };
    const reg: RegistroComando & { plano: Plano } = {
      id: randomUUID(),
      empresaId: this.d.empresaId,
      texto,
      plano,
      situacao: i.acao.tipo === 'listar' ? 'executado' : 'planejado',
      por: quem.nome,
      porId: quem.id ?? null,
      criadoEm: this.agora(),
      executadoEm: i.acao.tipo === 'listar' ? this.agora() : null,
      resultado: i.acao.tipo === 'listar' ? { listadas: plano.itens.length } : null,
    };
    await this.d.armazem.gravarComando(reg);
    return reg;
  }

  /** Executa o plano confirmado, só nas conversas da prévia (e que a pessoa ainda pode ver). */
  async confirmar(id: string, quem: { nome: string; id?: string }, visivel: (c: Conversa) => boolean) {
    const reg = await this.d.armazem.comando(id);
    if (!reg || reg.empresaId !== this.d.empresaId) throw Object.assign(new Error('Comando não encontrado.'), { statusCode: 404 });
    if (reg.situacao !== 'planejado') throw Object.assign(new Error(reg.situacao === 'executado' ? 'Este comando já foi executado.' : 'Este comando foi cancelado.'), { statusCode: 409 });
    const plano = reg.plano as Plano;
    const por = `IA · pedido de ${quem.nome}`;
    let feitos = 0;
    const falhas: Array<{ conversaId: string; erro: string }> = [];
    for (const item of plano.itens.slice(0, LIMITE_ITENS)) {
      try {
        const c = await this.d.repo.buscarConversa(item.conversaId);
        if (!c || !visivel(c)) throw new Error('sem acesso');
        const a = plano.acao;
        let mudou = true;
        if (a.tipo === 'mover_etapa') mudou = await this.d.moverEtapa(c.id, a.etapa!, por);
        else if (a.tipo === 'marcar_tag') mudou = await this.d.marcarTag(c.id, a.tag!, por);
        else if (a.tipo === 'mudar_modo') await this.d.mudarModo(c.id, a.modo!);
        else if (a.tipo === 'criar_lembrete') {
          await this.d.repo.registrarEvento({ tipo: 'lembrete_ligacao', conversaId: c.id, unidade: c.unidade, em: this.agora(), dados: { quando: this.agora().toISOString(), texto: a.texto ?? 'Ligar', por, comandoId: reg.id } });
        }
        if (mudou) feitos++;
      } catch (e) {
        falhas.push({ conversaId: item.conversaId, erro: String((e as Error).message ?? e) });
      }
    }
    const atualizado: RegistroComando = { ...reg, situacao: 'executado', executadoEm: this.agora(), resultado: { feitos, falhas, confirmadoPor: quem.nome, confirmadoPorId: quem.id ?? null } };
    await this.d.armazem.gravarComando(atualizado);
    return atualizado;
  }

  async cancelar(id: string, quem: { nome: string }) {
    const reg = await this.d.armazem.comando(id);
    if (!reg || reg.empresaId !== this.d.empresaId) throw Object.assign(new Error('Comando não encontrado.'), { statusCode: 404 });
    if (reg.situacao !== 'planejado') return reg;
    const r: RegistroComando = { ...reg, situacao: 'cancelado', resultado: { canceladoPor: quem.nome } };
    await this.d.armazem.gravarComando(r);
    return r;
  }

  historico(limite = 30) {
    return this.d.armazem.comandos(this.d.empresaId, limite);
  }
}

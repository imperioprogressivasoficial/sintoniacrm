import { createHash } from 'node:crypto';
import type pg from 'pg';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import { valorDe, type ConfigComercial } from '../comercial/calculo.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import type { Repositorio } from '../store/repositorio.js';
import { bahia, dataISO, partesBahia } from '../util/tempo.js';
import type { ArmazemRastreio, Origem } from './armazem.js';

/**
 * Central de criativos: quais anúncios trouxeram leads, agendamentos e vendas.
 *
 * Base: o primeiro toque de cada conversa (origens_lead). Anúncio de clique para WhatsApp traz o criativo
 * (id do anúncio, título, texto, imagem/vídeo, link); link rastreado com utm_content vira um "criativo de link"
 * (nos anúncios da Meta, utm_content={{ad.name}}). O que a lead fez depois (agendou, compareceu, ganhou no funil)
 * conta para o criativo que a trouxe, mesmo que tenha acontecido depois do período (coorte por chegada).
 * Com a conta de anúncios conectada (Conexões › Meta Ads), entra o gasto, impressões, cliques e CTR por anúncio.
 */

/** Uma lead que chegou por anúncio/link no período, com o que aconteceu depois. */
export interface LeadCriativo {
  conversaId: string;
  unidade: string;
  /** Primeiro toque (chegada). */
  origem: Origem;
  /** Agendamentos feitos pela Sintonia (IA ou equipe) depois da chegada. */
  agendamentos: Array<{ valor: number | null; servico: string | null; compareceu: boolean }>;
  /** Passou por Agendada (ou além) pelo funil, mesmo sem agendamento registrado pela conversa. */
  etapaAgendou: boolean;
  /** Compareceu (funil do sistema). */
  compareceu: boolean;
  /** Está na última etapa (ganho) de um funil da empresa. */
  ganho: boolean;
  /** Valor do negócio no cartão (R$), quando alguém preencheu. */
  valorCartao: number | null;
}

/** Números da Meta por anúncio (Marketing API). */
export interface InsightAnuncio {
  adId: string;
  adNome?: string;
  campanhaId?: string;
  campanhaNome?: string;
  conjuntoNome?: string;
  gasto: number;
  impressoes: number;
  cliques: number;
  miniatura?: string;
  titulo?: string;
  texto?: string;
}

export const ORDENS = ['vendas', 'leads', 'agendamentos', 'custo', 'gasto'] as const;
export type OrdemCriativos = (typeof ORDENS)[number];

export interface Criativo {
  chave: string;
  tipo: 'anuncio' | 'link';
  adId: string | null;
  titulo: string;
  texto: string | null;
  imagem: string | null;
  video: boolean;
  url: string | null;
  rede: string | null;
  campanha: { chave: string; nome: string } | null;
  conjunto: string | null;
  unidades: string[];
  leads: number;
  /** Leads que agendaram (pessoas, não horários). */
  agendaram: number;
  /** Leads que compareceram ou fecharam negócio. */
  vendas: number;
  /** R$ das vendas. */
  valor: number;
  /** Vendas sem valor conhecido (contam como venda, sem R$). */
  vendasSemValor: number;
  /** Da Meta (null = sem conta de anúncios conectada ou anúncio fora dela). */
  gasto: number | null;
  impressoes: number | null;
  cliques: number | null;
  ctr: number | null;
  custoLead: number | null;
  custoVenda: number | null;
  /** Valor ÷ gasto. */
  retorno: number | null;
  primeiraLead: Date | null;
  ultimaLead: Date | null;
}

export interface ResumoCriativos {
  criativos: Criativo[];
  totais: { leads: number; agendaram: number; vendas: number; valor: number; gasto: number | null; custoLead: number | null; custoVenda: number | null; retorno: number | null };
  campanhas: Array<{ chave: string; nome: string }>;
  unidades: string[];
}

const centavos = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number | null | undefined) => (b && b > 0 ? centavos(a / b) : null);
const limpo = (s: string | undefined | null) => (s && s.trim() ? s.trim() : undefined);
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Chave do criativo de uma origem (undefined = não é criativo: orgânico, indicação, link sem utm_content). */
export function chaveCriativo(o: Origem): string | undefined {
  if (o.canal === 'anuncio_meta') {
    if (limpo(o.adId)) return `ad:${o.adId!.trim()}`;
    const t = limpo(o.anuncioTitulo) ?? limpo(o.anuncioUrl) ?? limpo(o.anuncioMiniatura);
    return t ? `t:${hash(`${t}|${o.anuncioUrl ?? ''}`)}` : 'ad:?';
  }
  if (o.canal === 'link' && limpo(o.utmContent)) return `utm:${norm(o.utmCampaign ?? '')}|${norm(o.utmContent!)}`;
  return undefined;
}

/** Campanha da origem: id da Meta, senão o nome (da Graph API ou utm_campaign). */
export function campanhaDe(o: Origem): { chave: string; nome: string } | null {
  const nome = limpo(o.campaignNome) ?? limpo(o.utmCampaign);
  if (limpo(o.campaignId)) return { chave: `id:${o.campaignId!.trim()}`, nome: nome ?? `Campanha ${o.campaignId}` };
  return nome ? { chave: `nome:${norm(nome)}`, nome } : null;
}

/** Valor de uma venda: o do cartão; senão o dos agendamentos que compareceram (ou de todos); senão o valor padrão. */
export function valorDaVenda(l: LeadCriativo, precos: ConfigComercial['precos'], valorPadrao?: number): number | null {
  if (typeof l.valorCartao === 'number' && l.valorCartao > 0) return l.valorCartao;
  const comp = l.agendamentos.filter((a) => a.compareceu);
  const base = comp.length ? comp : l.agendamentos;
  const soma = base.reduce((s, a) => s + valorDe(a, precos), 0);
  if (soma > 0) return centavos(soma);
  return valorPadrao && valorPadrao > 0 ? valorPadrao : null;
}

export interface OpcoesResumo {
  precos?: ConfigComercial['precos'];
  valorPadrao?: number;
  insights?: InsightAnuncio[];
  unidade?: string;
  campanha?: string;
  ordem?: OrdemCriativos;
}

/** Junta as leads por criativo e calcula os números. Função pura (os testes conferem sem banco). */
export function resumirCriativos(leads: LeadCriativo[], o: OpcoesResumo = {}): ResumoCriativos {
  const precos = o.precos ?? [];
  const mapa = new Map<string, Criativo>();
  const campanhas = new Map<string, string>();
  const unidades = new Set<string>();
  const novo = (chave: string, tipo: Criativo['tipo']): Criativo => ({
    chave, tipo, adId: null, titulo: '', texto: null, imagem: null, video: false, url: null, rede: null, campanha: null, conjunto: null, unidades: [],
    leads: 0, agendaram: 0, vendas: 0, valor: 0, vendasSemValor: 0, gasto: null, impressoes: null, cliques: null, ctr: null, custoLead: null, custoVenda: null, retorno: null, primeiraLead: null, ultimaLead: null,
  });

  for (const l of leads) {
    const chave = chaveCriativo(l.origem);
    if (!chave) continue;
    unidades.add(l.unidade);
    const camp = campanhaDe(l.origem);
    if (camp) campanhas.set(camp.chave, camp.nome);
    if (o.unidade && l.unidade !== o.unidade) continue;
    if (o.campanha && camp?.chave !== o.campanha) continue;
    const x = l.origem;
    let c = mapa.get(chave);
    if (!c) {
      c = novo(chave, x.canal === 'link' ? 'link' : 'anuncio');
      mapa.set(chave, c);
    }
    // Dados do criativo: o que tiver; a lead mais recente completa o que faltava.
    c.adId ??= limpo(x.adId) ?? null;
    c.titulo ||= limpo(x.anuncioTitulo) ?? limpo(x.adNome) ?? limpo(x.utmContent) ?? '';
    c.texto ??= limpo(x.anuncioTexto) ?? null;
    c.imagem ??= limpo(x.anuncioMiniatura) ?? (x.anuncioMidiaTipo !== 'video' ? limpo(x.anuncioMidiaUrl) : undefined) ?? null;
    c.video ||= x.anuncioMidiaTipo === 'video';
    c.url ??= limpo(x.anuncioUrl) ?? null;
    c.rede ??= limpo(x.fonte)?.toLowerCase() ?? null;
    c.campanha ??= camp;
    c.conjunto ??= limpo(x.adsetNome) ?? null;
    if (!c.unidades.includes(l.unidade)) c.unidades.push(l.unidade);
    c.leads++;
    if (!c.primeiraLead || x.em < c.primeiraLead) c.primeiraLead = x.em;
    if (!c.ultimaLead || x.em > c.ultimaLead) c.ultimaLead = x.em;
    const vendeu = l.compareceu || l.ganho || l.agendamentos.some((a) => a.compareceu);
    if (vendeu || l.etapaAgendou || l.agendamentos.length) c.agendaram++;
    if (vendeu) {
      c.vendas++;
      const v = valorDaVenda(l, precos, o.valorPadrao);
      if (v === null) c.vendasSemValor++;
      else c.valor = centavos(c.valor + v);
    }
  }

  // Números da Meta: por id do anúncio; criativo de link, pelo nome do anúncio (utm_content={{ad.name}}).
  const porNome = new Map<string, Criativo>();
  for (const c of mapa.values()) if (c.tipo === 'link') porNome.set(c.chave.split('|').slice(1).join('|'), c);
  const comFiltro = Boolean(o.unidade);
  for (const i of o.insights ?? []) {
    const camp = i.campanhaId ? { chave: `id:${i.campanhaId}`, nome: i.campanhaNome ?? `Campanha ${i.campanhaId}` } : null;
    if (camp) campanhas.set(camp.chave, camp.nome);
    let c = mapa.get(`ad:${i.adId}`) ?? (i.adNome ? porNome.get(norm(i.adNome)) : undefined);
    if (!c) {
      // Anúncio que gastou e não trouxe ninguém: aparece também (é o que mais interessa cortar).
      if (comFiltro || i.gasto <= 0) continue;
      if (o.campanha && camp?.chave !== o.campanha) continue;
      c = novo(`ad:${i.adId}`, 'anuncio');
      c.adId = i.adId;
      c.campanha = camp;
      mapa.set(c.chave, c);
    }
    if (o.campanha && c.campanha?.chave !== o.campanha && camp?.chave !== o.campanha) continue;
    c.titulo ||= i.titulo ?? i.adNome ?? '';
    c.texto ??= i.texto ?? null;
    c.imagem ??= i.miniatura ?? null;
    c.conjunto ??= i.conjuntoNome ?? null;
    if (camp && (!c.campanha || c.campanha.chave.startsWith('nome:'))) c.campanha = camp;
    c.gasto = centavos((c.gasto ?? 0) + i.gasto);
    c.impressoes = (c.impressoes ?? 0) + i.impressoes;
    c.cliques = (c.cliques ?? 0) + i.cliques;
  }

  const lista = [...mapa.values()];
  for (const c of lista) {
    if (!c.titulo) c.titulo = c.tipo === 'link' ? 'Link rastreado' : c.adId ? `Anúncio ${c.adId}` : 'Anúncio sem título';
    c.ctr = c.impressoes ? Math.round((c.cliques! / c.impressoes) * 10000) / 100 : null;
    if (c.gasto !== null) {
      c.custoLead = div(c.gasto, c.leads);
      c.custoVenda = div(c.gasto, c.vendas);
      c.retorno = c.gasto > 0 ? Math.round((c.valor / c.gasto) * 100) / 100 : null;
    }
  }
  ordenar(lista, o.ordem ?? 'vendas');

  const soma = (k: 'leads' | 'agendaram' | 'vendas' | 'valor') => lista.reduce((s, c) => s + c[k], 0);
  const comGasto = lista.filter((c) => c.gasto !== null);
  const gasto = comGasto.length ? centavos(comGasto.reduce((s, c) => s + c.gasto!, 0)) : null;
  const totais = { leads: soma('leads'), agendaram: soma('agendaram'), vendas: soma('vendas'), valor: centavos(soma('valor')), gasto, custoLead: null as number | null, custoVenda: null as number | null, retorno: null as number | null };
  if (gasto !== null) {
    totais.custoLead = div(gasto, comGasto.reduce((s, c) => s + c.leads, 0));
    totais.custoVenda = div(gasto, comGasto.reduce((s, c) => s + c.vendas, 0));
    totais.retorno = gasto > 0 ? Math.round((comGasto.reduce((s, c) => s + c.valor, 0) / gasto) * 100) / 100 : null;
  }
  return {
    criativos: lista,
    totais,
    campanhas: [...campanhas].map(([chave, nome]) => ({ chave, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    unidades: [...unidades].sort(),
  };
}

function ordenar(lista: Criativo[], ordem: OrdemCriativos) {
  const nulo = (v: number | null, asc: boolean) => (v === null ? (asc ? Infinity : -Infinity) : v);
  const regras: Record<OrdemCriativos, Array<(a: Criativo, b: Criativo) => number>> = {
    vendas: [(a, b) => b.valor - a.valor, (a, b) => b.vendas - a.vendas, (a, b) => b.agendaram - a.agendaram, (a, b) => b.leads - a.leads],
    leads: [(a, b) => b.leads - a.leads, (a, b) => b.agendaram - a.agendaram, (a, b) => b.valor - a.valor],
    agendamentos: [(a, b) => b.agendaram - a.agendaram, (a, b) => b.leads - a.leads, (a, b) => b.valor - a.valor],
    // Mais barato primeiro; quem não tem gasto (ou não trouxe lead) vai para o fim.
    custo: [(a, b) => nulo(a.custoLead, true) - nulo(b.custoLead, true), (a, b) => b.leads - a.leads],
    gasto: [(a, b) => nulo(b.gasto, false) - nulo(a.gasto, false), (a, b) => b.leads - a.leads],
  };
  lista.sort((a, b) => {
    for (const r of regras[ordem]) {
      const d = r(a, b);
      if (d && Number.isFinite(d)) return d;
      if (d) return d > 0 ? 1 : -1;
    }
    return a.titulo.localeCompare(b.titulo, 'pt-BR');
  });
}

// ---------------------------------------------------------------- períodos

export const PERIODOS_CRIATIVOS = ['7d', '30d', '90d', 'mes', 'mes_passado'] as const;
export type PeriodoCriativos = (typeof PERIODOS_CRIATIVOS)[number];

/** Janela [inicio, fim) no horário da Bahia e as datas (AAAA-MM-DD) para a Meta. */
export function janelaCriativos(p: PeriodoCriativos, agora: Date): { inicio: Date; fim: Date; desde: string; ate: string } {
  const d = partesBahia(agora);
  let inicio: Date;
  let fim = agora;
  if (p === 'mes') inicio = bahia(d.ano, d.mes, 1);
  else if (p === 'mes_passado') {
    inicio = bahia(d.ano, d.mes - 1, 1);
    fim = bahia(d.ano, d.mes, 1);
  } else inicio = bahia(d.ano, d.mes, d.dia - ({ '7d': 6, '30d': 29, '90d': 89 } as const)[p]);
  return { inicio, fim, desde: dataISO(inicio), ate: dataISO(new Date(fim.getTime() - 1)) };
}

// ---------------------------------------------------------------- fontes

export interface FonteCriativos {
  /** Leads com primeiro toque por anúncio ou link entre [inicio, fim), no escopo de quem vê. */
  carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<LeadCriativo[]>;
}

const ETAPAS_AGENDOU = ['agendada', 'compareceu', 'manutencao'];
const ETAPAS_VENDEU = ['compareceu', 'manutencao'];
const TIPOS_AGENDAMENTO = ['agendamento_ia', 'agendamento_equipe'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export class FonteCriativosPostgres implements FonteCriativos {
  constructor(private readonly pool: pg.Pool) {}

  async carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<LeadCriativo[]> {
    const params: unknown[] = [inicio, fim];
    const onde = sqlEscopo(escopo, 'c', params);
    const { rows } = await this.pool.query(
      `select o.*, c.id::text as cid, c.unidade as c_unidade, c.etapa as c_etapa, v.valor::text as valor_cartao,
              exists (select 1 from sintonia.eventos x where x.conversa_id = c.id and x.tipo = 'etapa_mudou' and x.dados->>'para' = any($${params.length + 1}::text[])) as etapa_agendou,
              exists (select 1 from sintonia.eventos x where x.conversa_id = c.id and x.tipo = 'etapa_mudou' and x.dados->>'para' = any($${params.length + 2}::text[])) as etapa_vendeu,
              exists (select 1 from sintonia.conversa_tags ct join sintonia.funis f on f.id = ct.funil_id and not f.sistema
                       where ct.conversa_id = c.id
                         and ct.tag_id = (select t.id from sintonia.tags t where t.funil_id = f.id order by t.ordem desc, t.criada_em desc limit 1)
                         and (select count(*) from sintonia.tags t where t.funil_id = f.id) >= 2) as ganho,
              coalesce((select json_agg(json_build_object('dados', x.dados, 'em', x.em) order by x.em)
                          from sintonia.eventos x where x.conversa_id = c.id and x.tipo = any($${params.length + 3}::text[]) and x.em >= o.em), '[]'::json) as agendamentos,
              (select min(x.em) from sintonia.eventos x where x.conversa_id = c.id and x.tipo = 'etapa_mudou' and x.dados->>'para' = 'compareceu') as compareceu_em
         from sintonia.origens_lead o
         join sintonia.conversas c on c.id = o.conversa_id
         left join sintonia.cartao_valores v on v.conversa_id = c.id
        where o.toque = 'primeiro' and o.canal in ('anuncio_meta', 'link') and o.em >= $1 and o.em < $2 and ${onde}`,
      [...params, ETAPAS_AGENDOU, ETAPAS_VENDEU, TIPOS_AGENDAMENTO],
    );
    return rows.map((r) => {
      const origem = origemDaLinha(r);
      const comp = ETAPAS_VENDEU.includes(String(r.c_etapa)) || Boolean(r.etapa_vendeu);
      const compEm = r.compareceu_em ? new Date(r.compareceu_em as string) : null;
      const ags = (r.agendamentos as Array<{ dados: Record<string, unknown> | null; em: string }>).map((a) => ({
        valor: num(a.dados?.valor),
        servico: str(a.dados?.servico),
        compareceu: String(r.c_etapa) === 'compareceu' || (compEm !== null && compEm >= new Date(a.em)),
      }));
      return {
        conversaId: String(r.cid),
        unidade: String(r.c_unidade),
        origem,
        agendamentos: ags,
        etapaAgendou: ETAPAS_AGENDOU.includes(String(r.c_etapa)) || Boolean(r.etapa_agendou),
        compareceu: comp,
        ganho: Boolean(r.ganho),
        valorCartao: r.valor_cartao === null || r.valor_cartao === undefined ? null : Number(r.valor_cartao),
      };
    });
  }
}

/** Colunas de origens_lead → Origem (o armazém faz igual; aqui só o que a central usa). */
function origemDaLinha(r: Record<string, unknown>): Origem {
  const s = (k: string) => (r[k] === null || r[k] === undefined ? undefined : String(r[k]));
  const o: Origem = {
    canal: String(r.canal) as Origem['canal'],
    origemPor: (s('origem_por') ?? 'automatico') as Origem['origemPor'],
    em: r.em as Date,
    fonte: s('fonte'),
    utmCampaign: s('utm_campaign'),
    utmContent: s('utm_content'),
    utmSource: s('utm_source'),
    campaignId: s('campaign_id'),
    campaignNome: s('campaign_nome'),
    adsetNome: s('adset_nome'),
    adId: s('ad_id'),
    adNome: s('ad_nome'),
    anuncioTitulo: s('anuncio_titulo'),
    anuncioTexto: s('anuncio_texto'),
    anuncioMidiaTipo: s('anuncio_midia_tipo'),
    anuncioMidiaUrl: s('anuncio_midia_url'),
    anuncioMiniatura: s('anuncio_miniatura'),
    anuncioUrl: s('anuncio_url'),
  };
  for (const k of Object.keys(o) as Array<keyof Origem>) if (o[k] === undefined) delete o[k];
  return o;
}

/** Memória (testes e uso local): mesmo contrato, a partir do repositório e do armazém de rastreio. */
export class FonteCriativosMemoria implements FonteCriativos {
  constructor(
    private readonly repo: Repositorio,
    private readonly armazem: ArmazemRastreio,
    private readonly extra: { valor?: (conversaId: string) => Promise<number | null>; ganho?: (conversaId: string) => Promise<boolean> } = {},
  ) {}

  async carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<LeadCriativo[]> {
    const conversas = new Map((await this.repo.listarConversas()).filter((c) => noEscopo(escopo, c)).map((c) => [c.id, c]));
    const origens = await this.armazem.primeiros([...conversas.keys()]);
    const eventos = await this.repo.eventosEntre(inicio, new Date(8.64e15));
    const saida: LeadCriativo[] = [];
    for (const [id, o] of origens) {
      const c = conversas.get(id);
      if (!c || (o.canal !== 'anuncio_meta' && o.canal !== 'link') || o.em < inicio || o.em >= fim) continue;
      const dela = eventos.filter((e) => e.conversaId === id);
      const para = (lista: string[]) => dela.some((e) => e.tipo === 'etapa_mudou' && lista.includes(String(e.dados?.para)));
      const compEm = dela.filter((e) => e.tipo === 'etapa_mudou' && e.dados?.para === 'compareceu').map((e) => e.em).sort((a, b) => a.getTime() - b.getTime())[0];
      saida.push({
        conversaId: id,
        unidade: c.unidade,
        origem: o,
        agendamentos: dela
          .filter((e) => TIPOS_AGENDAMENTO.includes(e.tipo) && e.em >= o.em)
          .map((e) => ({ valor: num(e.dados?.valor), servico: str(e.dados?.servico), compareceu: c.etapa === 'compareceu' || (compEm !== undefined && compEm >= e.em) })),
        etapaAgendou: ETAPAS_AGENDOU.includes(c.etapa) || para(ETAPAS_AGENDOU),
        compareceu: ETAPAS_VENDEU.includes(c.etapa) || para(ETAPAS_VENDEU),
        ganho: (await this.extra.ganho?.(id)) ?? false,
        valorCartao: (await this.extra.valor?.(id)) ?? null,
      });
    }
    return saida;
  }
}

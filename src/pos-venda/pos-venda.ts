import type pg from 'pg';
import type { Conversa } from '../domain.js';
import type { Automacoes } from '../automacoes/automacoes.js';
import type { AutomacaoNova, Passo } from '../automacoes/esquema.js';
import { esperarDias } from '../automacoes/modelos.js';
import type { Funil, Funis } from '../funis/funis.js';
import type { Repositorio } from '../store/repositorio.js';
import type { ArmazemTags } from '../tags/tags.js';
import { dataISO, DIA } from '../util/tempo.js';

/**
 * pos-venda (dono 28/11): funil "Pós-venda" que começa quando a cliente chega em Finalizado no funil de atendimento
 * e vai, por tempo, até ela voltar. Meta: a cliente voltar 4 vezes no ano (um retorno a cada ~90 dias).
 *
 * Nada aqui é um motor novo: o funil é um funil comum (etapas = tags) e o caminho são automações comuns
 * (Automações), que a equipe liga, desliga e edita na tela de sempre. Este módulo só:
 * - cria a SUGESTÃO (funil + automações), uma vez, e nunca por cima do que a equipe editou;
 * - conta as visitas no ano de cada cliente (atendimentos dos últimos 12 meses) e a média do funil;
 * - guarda a meta de visitas (padrão 4, editável no topo do funil).
 *
 * Etapas sugeridas:
 *   Conscientização (0–30 dias: agradecimento e cuidados, depois foto/avaliação) → Retorno 30 dias (como está, dicas,
 *   lembrar da manutenção) → Manutenção 60 dias (convite para manutenção/hidratação) → Retorno 90 dias (convite para
 *   refazer, com um lembrete se ela não responder) → Inativa (passou de ~120 dias sem voltar: uma última mensagem).
 *   Voltou: ela agendou de novo (em qualquer ponto do caminho): sai das esperas. Depois do novo atendimento
 *   (Finalizado de novo), recomeça em Conscientização e a visita conta.
 */

/**
 * Etapa do funil de atendimento (chave fixa do sistema) em que o pós-venda começa. Hoje "compareceu" (o nome na tela
 * pode ser "Finalizado"): se o funil de atendimento mudar de chave, troque aqui (e a automação "começa no
 * Finalizado" pode ser apontada para outra etapa na tela de Automações).
 */
export const CHAVE_FINALIZADO = 'compareceu';
export const NOME_FUNIL = 'Pós-venda';
export const META_PADRAO = 4;
/** Visitas contam nos últimos 12 meses. */
export const JANELA_DIAS = 365;

export const ETAPAS_POS_VENDA = {
  conscientizacao: { nome: 'Conscientização', cor: '#12A594' },
  retorno30: { nome: 'Retorno 30 dias', cor: '#0090FF' },
  manutencao60: { nome: 'Manutenção 60 dias', cor: '#8E4EC6' },
  retorno90: { nome: 'Retorno 90 dias', cor: '#D4A017' },
  voltou: { nome: 'Voltou', cor: '#30A46C' },
  inativa: { nome: 'Inativa', cor: '#8B8D98' },
} as const;
type ChaveEtapa = keyof typeof ETAPAS_POS_VENDA;

export interface ConfigPosVenda {
  funilId: string | null;
  metaVisitas: number;
  semeadoEm: Date | null;
}

export class ErroPosVenda extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export interface ArmazemPosVenda {
  config(empresaId: string): Promise<ConfigPosVenda>;
  salvar(empresaId: string, c: Partial<ConfigPosVenda>, por: string): Promise<void>;
  /** Reserva a criação da sugestão: true só para quem chegou primeiro (semeado_em estava vazio). */
  reservarSemente(empresaId: string, em: Date, por: string): Promise<boolean>;
  liberarSemente(empresaId: string): Promise<void>;
  /** Dias (AAAA-MM-DD, Bahia) com atendimento desde `desde`, por conversa (somando as conversas do mesmo telefone). */
  visitas(empresaId: string, conversaIds: string[], desde: Date): Promise<Map<string, string[]>>;
  /** Clientes do funil (por telefone, fora a lixeira), a média de visitas e quantas bateram a meta. */
  resumoFunil(empresaId: string, funilId: string, desde: Date, meta: number): Promise<{ clientes: number; media: number; naMeta: number }>;
}

const PADRAO: ConfigPosVenda = { funilId: null, metaVisitas: META_PADRAO, semeadoEm: null };

// ---------------------------------------------------------------- memória

export class ArmazemPosVendaMemoria implements ArmazemPosVenda {
  private readonly configs = new Map<string, ConfigPosVenda>();
  constructor(
    private readonly repo: Repositorio,
    private readonly tags: ArmazemTags,
  ) {}

  async config(empresaId: string) {
    return { ...(this.configs.get(empresaId) ?? PADRAO) };
  }
  async salvar(empresaId: string, c: Partial<ConfigPosVenda>) {
    this.configs.set(empresaId, { ...(await this.config(empresaId)), ...c });
  }
  async reservarSemente(empresaId: string, em: Date) {
    const c = await this.config(empresaId);
    if (c.semeadoEm) return false;
    this.configs.set(empresaId, { ...c, semeadoEm: em });
    return true;
  }
  async liberarSemente(empresaId: string) {
    const c = await this.config(empresaId);
    this.configs.set(empresaId, { ...c, semeadoEm: null });
  }
  /** Dias com atendimento por telefone (todas as conversas da empresa). */
  private async diasPorTelefone(empresaId: string, desde: Date): Promise<Map<string, Set<string>>> {
    const conversas = new Map((await this.repo.listarConversas({ empresaId })).map((c) => [c.id, c]));
    const r = new Map<string, Set<string>>();
    for (const e of await this.repo.eventosEntre(desde, new Date(8.64e15))) {
      if (e.tipo !== 'etapa_mudou' || e.dados?.para !== CHAVE_FINALIZADO || !e.conversaId) continue;
      const c = conversas.get(e.conversaId);
      if (!c) continue;
      const s = r.get(c.telefone) ?? new Set<string>();
      s.add(dataISO(e.em));
      r.set(c.telefone, s);
    }
    return r;
  }
  async visitas(empresaId: string, conversaIds: string[], desde: Date) {
    const dias = await this.diasPorTelefone(empresaId, desde);
    const r = new Map<string, string[]>();
    for (const id of conversaIds) {
      const c = await this.repo.buscarConversa(id);
      if (!c || c.empresaId !== empresaId) continue;
      r.set(id, [...(dias.get(c.telefone) ?? [])].sort());
    }
    return r;
  }
  async resumoFunil(empresaId: string, funilId: string, desde: Date, meta: number) {
    const dias = await this.diasPorTelefone(empresaId, desde);
    const telefones = new Set<string>();
    for (const m of await this.tags.etapasDoFunil(funilId)) {
      const c = await this.repo.buscarConversa(m.conversaId);
      if (c && c.empresaId === empresaId) telefones.add(c.telefone);
    }
    const n = [...telefones].map((t) => dias.get(t)?.size ?? 0);
    return { clientes: n.length, media: n.length ? n.reduce((s, x) => s + x, 0) / n.length : 0, naMeta: n.filter((x) => x >= meta).length };
  }
}

// ---------------------------------------------------------------- Postgres

/** Dia da visita no horário da Bahia (igual a dataISO). */
const DIA_BAHIA = `to_char(e.em at time zone 'America/Bahia', 'YYYY-MM-DD')`;

export class ArmazemPosVendaPostgres implements ArmazemPosVenda {
  constructor(private readonly pool: pg.Pool) {}

  async config(empresaId: string) {
    const { rows } = await this.pool.query<{ funil_id: string | null; meta_visitas: number; semeado_em: Date | null }>(
      'select funil_id::text, meta_visitas, semeado_em from sintonia.pos_venda_config where empresa_id = $1',
      [empresaId],
    );
    const l = rows[0];
    return l ? { funilId: l.funil_id, metaVisitas: l.meta_visitas, semeadoEm: l.semeado_em } : { ...PADRAO };
  }
  async salvar(empresaId: string, c: Partial<ConfigPosVenda>, por: string) {
    await this.pool.query(
      `insert into sintonia.pos_venda_config (empresa_id, funil_id, meta_visitas, semeado_em, atualizado_em, atualizado_por)
       values ($1, $3::uuid, coalesce($4::int, ${META_PADRAO}), $6::timestamptz, now(), $7)
       on conflict (empresa_id) do update set
         funil_id = case when $2 then excluded.funil_id else pos_venda_config.funil_id end,
         meta_visitas = coalesce($4::int, pos_venda_config.meta_visitas),
         semeado_em = case when $5 then excluded.semeado_em else pos_venda_config.semeado_em end,
         atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [empresaId, c.funilId !== undefined, c.funilId ?? null, c.metaVisitas ?? null, c.semeadoEm !== undefined, c.semeadoEm ?? null, por],
    );
  }
  async reservarSemente(empresaId: string, em: Date, por: string) {
    const r = await this.pool.query(
      `insert into sintonia.pos_venda_config (empresa_id, semeado_em, atualizado_em, atualizado_por) values ($1, $2, now(), $3)
       on conflict (empresa_id) do update set semeado_em = excluded.semeado_em, atualizado_em = now(), atualizado_por = excluded.atualizado_por
        where pos_venda_config.semeado_em is null`,
      [empresaId, em, por],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async liberarSemente(empresaId: string) {
    await this.pool.query('update sintonia.pos_venda_config set semeado_em = null where empresa_id = $1', [empresaId]);
  }
  async visitas(empresaId: string, conversaIds: string[], desde: Date) {
    const ids = conversaIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const r = new Map<string, string[]>(ids.map((id) => [id, []]));
    if (!ids.length) return r;
    const { rows } = await this.pool.query<{ id: string; dias: string[] | null }>(
      `select a.id::text as id, array_agg(distinct ${DIA_BAHIA}) filter (where e.id is not null) as dias
         from sintonia.conversas a
         join sintonia.conversas c2 on c2.empresa_id = a.empresa_id and c2.telefone = a.telefone
         left join sintonia.eventos e on e.conversa_id = c2.id and e.tipo = 'etapa_mudou' and e.dados->>'para' = $3 and e.em >= $4
        where a.empresa_id = $1 and a.id = any($2::uuid[])
        group by a.id`,
      [empresaId, ids, CHAVE_FINALIZADO, desde],
    );
    for (const l of rows) r.set(l.id, (l.dias ?? []).sort());
    return r;
  }
  async resumoFunil(empresaId: string, funilId: string, desde: Date, meta: number) {
    const { rows } = await this.pool.query<{ clientes: number; media: number | null; na_meta: number }>(
      `with membros as (
         select distinct c.telefone from sintonia.conversa_tags ct join sintonia.conversas c on c.id = ct.conversa_id
          where ct.funil_id = $2 and c.empresa_id = $1
            and not exists (select 1 from sintonia.leads_excluidos lx where lx.funil_id = ct.funil_id and lx.conversa_id = c.id)
       ), v as (
         select m.telefone, count(distinct ${DIA_BAHIA}) filter (where e.id is not null) as n
           from membros m
           join sintonia.conversas c2 on c2.empresa_id = $1 and c2.telefone = m.telefone
           left join sintonia.eventos e on e.conversa_id = c2.id and e.tipo = 'etapa_mudou' and e.dados->>'para' = $3 and e.em >= $4
          group by m.telefone
       )
       select count(*)::int as clientes, avg(n)::float as media, (count(*) filter (where n >= $5))::int as na_meta from v`,
      [empresaId, funilId, CHAVE_FINALIZADO, desde, meta],
    );
    const l = rows[0];
    return { clientes: l?.clientes ?? 0, media: l?.media ?? 0, naMeta: l?.na_meta ?? 0 };
  }
}

// ---------------------------------------------------------------- textos da sugestão

/** Mensagem de relacionamento: a IA escreve com o objetivo; o texto vai quando a IA está desligada. Sem emoji de rosto. */
const msg = (texto: string, objetivo: string): Passo => ({ tipo: 'enviar_mensagem', texto, so_no_horario: true, ia_objetivo: objetivo });

/** Textos de reserva: 'salao' (salão de beleza, como a Império) ou 'geral' (qualquer empresa). */
export const ESTILOS = ['salao', 'geral'] as const;
export type Estilo = (typeof ESTILOS)[number];

const REGRA_IA = 'Mensagem curta e humana, como uma pessoa da loja escreveria no WhatsApp, sem emoji de rosto e sem textão.';

export const TEXTOS_POS_VENDA: Record<Estilo, Record<'obrigada' | 'foto' | 'retorno30' | 'manutencao60' | 'retorno90' | 'lembrete90' | 'inativa', { texto: string; objetivo: string }>> = {
  salao: {
    obrigada: {
      texto: 'Oi, {primeiro_nome}! Obrigada por ter vindo hoje. Nos primeiros dias, use shampoo sem sal e evite prender o cabelo molhado. Qualquer dúvida sobre os cuidados, é só me chamar por aqui.',
      objetivo: `Agradecer a visita de hoje e passar 2 ou 3 cuidados simples para os primeiros dias depois do procedimento (use os cuidados da base de conhecimento). ${REGRA_IA}`,
    },
    foto: {
      texto: '{primeiro_nome}, como ficou o seu cabelo nesses dias? Se puder, me manda uma foto. E se gostou do resultado, sua avaliação ajuda muito a gente.',
      objetivo: `Perguntar como ficou o cabelo nos primeiros dias, pedir uma foto do resultado e, se ela gostou, pedir uma avaliação. ${REGRA_IA}`,
    },
    retorno30: {
      texto: 'Oi, {primeiro_nome}! Já faz um mês do seu procedimento. Como está o cabelo? Uma dica: hidratar uma vez por semana ajuda o liso a durar mais. Quando quiser, vejo um horário de manutenção para você.',
      objetivo: `Um mês depois do atendimento: perguntar como está o cabelo, dar uma dica de cuidado e lembrar, sem pressão, que a manutenção ajuda o resultado a durar. ${REGRA_IA}`,
    },
    manutencao60: {
      texto: '{primeiro_nome}, dois meses do seu procedimento! É uma boa hora para uma hidratação ou manutenção na {unidade}. Quer que eu veja um horário para você?',
      objetivo: `Dois meses depois do atendimento: convidar para uma hidratação ou manutenção e oferecer ver um horário. ${REGRA_IA}`,
    },
    retorno90: {
      texto: 'Oi, {primeiro_nome}! Já são 3 meses desde o seu último procedimento, é o tempo certo para refazer. Quer que eu separe um horário para você esta semana?',
      objetivo: `Três meses depois do atendimento: convidar para refazer o procedimento e oferecer um horário. ${REGRA_IA}`,
    },
    lembrete90: {
      texto: '{primeiro_nome}, ainda tenho alguns horários livres nos próximos dias. Se quiser, reservo um para você.',
      objetivo: `Ela não respondeu ao convite para refazer: lembrar com leveza que ainda há horários e oferecer reservar. ${REGRA_IA}`,
    },
    inativa: {
      texto: 'Oi, {primeiro_nome}! Faz um tempinho que você não vem e sentimos sua falta por aqui. Quando quiser voltar, é só me chamar que eu vejo o melhor horário para você.',
      objetivo: `Ela não volta há mais de 4 meses: dizer que sentimos falta dela, sem cobrar, e deixar a porta aberta para agendar. ${REGRA_IA}`,
    },
  },
  geral: {
    obrigada: {
      texto: 'Oi, {primeiro_nome}! Obrigada por ter vindo hoje. Se surgir qualquer dúvida sobre os cuidados dos próximos dias, é só me chamar por aqui.',
      objetivo: `Agradecer o atendimento de hoje e passar os cuidados dos primeiros dias, se houver (use a base de conhecimento). ${REGRA_IA}`,
    },
    foto: {
      texto: '{primeiro_nome}, como está tudo depois do atendimento? Se gostou, sua avaliação ajuda muito a gente.',
      objetivo: `Perguntar como está tudo depois do atendimento e, se ela gostou, pedir uma avaliação. ${REGRA_IA}`,
    },
    retorno30: {
      texto: 'Oi, {primeiro_nome}! Já faz um mês do seu atendimento. Como está tudo? Se precisar de alguma coisa, é só me chamar.',
      objetivo: `Um mês depois do atendimento: perguntar como está tudo, dar uma dica útil e lembrar que estamos à disposição. ${REGRA_IA}`,
    },
    manutencao60: {
      texto: '{primeiro_nome}, dois meses do seu atendimento! Quer que eu veja um horário para a sua manutenção na {unidade}?',
      objetivo: `Dois meses depois do atendimento: convidar para a manutenção ou um retorno e oferecer um horário. ${REGRA_IA}`,
    },
    retorno90: {
      texto: 'Oi, {primeiro_nome}! Já são 3 meses desde o seu último atendimento. Quer que eu separe um horário para você?',
      objetivo: `Três meses depois do atendimento: convidar para voltar e oferecer um horário. ${REGRA_IA}`,
    },
    lembrete90: {
      texto: '{primeiro_nome}, ainda tenho alguns horários livres nos próximos dias. Se quiser, reservo um para você.',
      objetivo: `Ela não respondeu ao convite: lembrar com leveza que ainda há horários e oferecer reservar. ${REGRA_IA}`,
    },
    inativa: {
      texto: 'Oi, {primeiro_nome}! Faz um tempinho que você não vem e sentimos sua falta. Quando quiser voltar, é só me chamar.',
      objetivo: `Ela não volta há mais de 4 meses: dizer que sentimos falta dela, sem cobrar, e deixar a porta aberta. ${REGRA_IA}`,
    },
  },
};

/** Opções das automações de relacionamento do pós-venda. */
const OPCOES_CAMINHO = { parar_se_equipe_responder: false, parar_se_sair_da_etapa: true, respeitar_limites: true };

/**
 * As automações sugeridas. `etapa(k)` = id da etapa do funil pós-venda; `finalizado` = etapa Finalizado do funil de
 * atendimento. Todas nascem `ligada` (padrão: sim).
 */
export function montarAutomacoes(p: { funilId: string; sistemaId: string; finalizado: string; etapa: (k: ChaveEtapa) => string; estilo: Estilo; ligada: boolean }): AutomacaoNova[] {
  const t = TEXTOS_POS_VENDA[p.estilo];
  const m = (k: keyof typeof t) => msg(t[k].texto, t[k].objetivo);
  const mover = (k: ChaveEtapa): Passo => ({ tipo: 'mover_etapa', funilId: p.funilId, etapaId: p.etapa(k) });
  const naEtapa = (k: ChaveEtapa) => ({ tipo: 'entrou_na_etapa' as const, etapaId: p.etapa(k) });
  const MIN = (h: number) => Math.round(h * 60);
  return [
    {
      nome: 'Pós-venda: começa no Finalizado',
      funilId: p.sistemaId,
      ligada: p.ligada,
      gatilho: { tipo: 'entrou_na_etapa', etapaId: p.finalizado },
      passos: [mover('conscientizacao')],
      opcoes: { parar_se_equipe_responder: false, parar_se_sair_da_etapa: false, respeitar_limites: true },
    },
    {
      nome: 'Pós-venda: Conscientização',
      funilId: p.funilId,
      ligada: p.ligada,
      gatilho: naEtapa('conscientizacao'),
      passos: [{ tipo: 'esperar', minutos: MIN(2) }, m('obrigada'), ...esperarDias(3), m('foto'), ...esperarDias(27), mover('retorno30')],
      opcoes: OPCOES_CAMINHO,
    },
    {
      nome: 'Pós-venda: Retorno 30 dias',
      funilId: p.funilId,
      ligada: p.ligada,
      gatilho: naEtapa('retorno30'),
      passos: [m('retorno30'), ...esperarDias(30), mover('manutencao60')],
      opcoes: OPCOES_CAMINHO,
    },
    {
      nome: 'Pós-venda: Manutenção 60 dias',
      funilId: p.funilId,
      ligada: p.ligada,
      gatilho: naEtapa('manutencao60'),
      passos: [m('manutencao60'), ...esperarDias(30), mover('retorno90')],
      opcoes: OPCOES_CAMINHO,
    },
    {
      nome: 'Pós-venda: Retorno 90 dias',
      funilId: p.funilId,
      ligada: p.ligada,
      gatilho: naEtapa('retorno90'),
      passos: [
        m('retorno90'),
        ...esperarDias(10),
        { tipo: 'condicao', se: 'cliente_respondeu', entao: [], senao: [m('lembrete90')] },
        ...esperarDias(20),
        mover('inativa'),
      ],
      opcoes: OPCOES_CAMINHO,
    },
    {
      nome: 'Pós-venda: Inativa',
      funilId: p.funilId,
      ligada: p.ligada,
      gatilho: naEtapa('inativa'),
      passos: [...esperarDias(1), m('inativa')],
      opcoes: OPCOES_CAMINHO,
    },
    {
      nome: 'Pós-venda: Voltou (agendou de novo)',
      funilId: p.funilId,
      ligada: p.ligada,
      gatilho: { tipo: 'agendou', quando: 'qualquer' },
      passos: [{ tipo: 'condicao', se: 'no_funil', valor: p.funilId, entao: [mover('voltou')], senao: [] }],
      opcoes: { parar_se_equipe_responder: false, parar_se_sair_da_etapa: false, respeitar_limites: true },
    },
  ];
}

// ---------------------------------------------------------------- serviço

export interface OpcoesPosVenda {
  armazem: ArmazemPosVenda;
  funis: Funis;
  automacoes: Automacoes;
  empresaId: string;
  /** Textos de reserva do botão "Criar funil pós-venda sugerido" (padrão 'geral'). */
  estiloPadrao?: Estilo;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export interface ResumoPosVenda {
  meta: number;
  /** Média de visitas no ano entre as clientes do funil (uma casa decimal). */
  media: number;
  clientes: number;
  naMeta: number;
}

export class PosVenda {
  readonly empresaId: string;
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;

  constructor(private readonly o: OpcoesPosVenda) {
    this.empresaId = o.empresaId;
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  /** Configuração, com o funil conferido (apagado = null). */
  async config(): Promise<ConfigPosVenda & { funil: Funil | null }> {
    const c = await this.o.armazem.config(this.empresaId);
    const funil = c.funilId ? await this.o.funis.exigir(c.funilId).catch(() => null) : null;
    return { ...c, funilId: funil?.id ?? null, funil };
  }

  async ehFunil(funilId: string): Promise<boolean> {
    return (await this.config()).funilId === funilId;
  }

  async alterarConfig(campos: { metaVisitas?: number }, por: string): Promise<ConfigPosVenda & { funil: Funil | null }> {
    if (campos.metaVisitas !== undefined) {
      if (!Number.isInteger(campos.metaVisitas) || campos.metaVisitas < 1 || campos.metaVisitas > 52) throw new ErroPosVenda('A meta de visitas vai de 1 a 52 por ano.', 400);
      await this.o.armazem.salvar(this.empresaId, { metaVisitas: campos.metaVisitas }, por);
    }
    return this.config();
  }

  private desde(): Date {
    return new Date(this.agora().getTime() - JANELA_DIAS * DIA);
  }

  /** Visitas no ano (atendimentos dos últimos 12 meses) de cada conversa. */
  async visitas(conversaIds: string[]): Promise<Map<string, number>> {
    const dias = await this.o.armazem.visitas(this.empresaId, conversaIds, this.desde());
    return new Map([...dias].map(([id, d]) => [id, d.length]));
  }

  /** Ficha: visitas no ano, os dias, a meta e a etapa do pós-venda em que ela está. */
  async daConversa(c: Conversa): Promise<{ visitasAno: number; dias: string[]; meta: number; funilId: string | null; etapa: { id: string; nome: string; cor: string } | null }> {
    const cfg = await this.config();
    const dias = (await this.o.armazem.visitas(this.empresaId, [c.id], this.desde())).get(c.id) ?? [];
    let etapa: { id: string; nome: string; cor: string } | null = null;
    if (cfg.funilId) {
      const id = await this.o.funis.etapaNoFunil(c.id, cfg.funilId);
      const e = id ? (await this.o.funis.etapas(cfg.funilId)).find((x) => x.id === id) : undefined;
      if (e) etapa = { id: e.id, nome: e.nome, cor: e.cor };
    }
    return { visitasAno: dias.length, dias, meta: cfg.metaVisitas, funilId: cfg.funilId, etapa };
  }

  /**
   * Quadro do funil pós-venda: cada cartão ganha `visitasAno` e o quadro ganha `posVenda` (média, meta).
   * Outros funis passam como estão.
   */
  async decorarQuadro<Q extends { funil: { id: string }; colunas: Array<{ cartoes: Array<{ conversaId: string }> }> }>(q: Q): Promise<Q | (Q & { posVenda: ResumoPosVenda })> {
    if (!(await this.ehFunil(q.funil.id))) return q;
    const visitas = await this.visitas(q.colunas.flatMap((c) => c.cartoes.map((x) => x.conversaId)));
    return {
      ...q,
      colunas: q.colunas.map((c) => ({ ...c, cartoes: c.cartoes.map((x) => ({ ...x, visitasAno: visitas.get(x.conversaId) ?? 0 })) })),
      posVenda: await this.resumo(q.funil.id),
    };
  }

  /** Número do topo do funil pós-venda. */
  async resumo(funilId: string): Promise<ResumoPosVenda> {
    const cfg = await this.o.armazem.config(this.empresaId);
    const r = await this.o.armazem.resumoFunil(this.empresaId, funilId, this.desde(), cfg.metaVisitas);
    return { meta: cfg.metaVisitas, media: Math.round(r.media * 10) / 10, clientes: r.clientes, naMeta: r.naMeta };
  }

  /**
   * Cria o funil "Pós-venda" e as automações sugeridas (botão "Criar funil pós-venda sugerido"). Recusa (409) se o
   * funil sugerido já existe ou se já há um funil com o mesmo nome (feito pela equipe): nunca mexe no que existe.
   */
  async criarSugerido(por: string, o: { estilo?: Estilo; ligada?: boolean } = {}): Promise<{ funil: Funil; automacoes: number }> {
    const cfg = await this.config();
    if (cfg.funil) throw new ErroPosVenda(`O funil "${cfg.funil.nome}" (pós-venda) já existe.`, 409);
    const funis = await this.o.funis.listar();
    if (funis.some((f) => f.nome.toLowerCase() === NOME_FUNIL.toLowerCase())) throw new ErroPosVenda(`Já existe um funil chamado "${NOME_FUNIL}". Renomeie ou apague esse funil antes de criar o sugerido.`, 409);
    const sistema = funis.find((f) => f.sistema) ?? (await this.o.funis.garantirSistema());
    const finalizado = (await this.o.funis.etapas(sistema.id)).find((e) => e.chaveSistema === CHAVE_FINALIZADO);
    if (!finalizado) throw new ErroPosVenda('O funil de atendimento não tem a etapa Finalizado.', 409);

    const funil = await this.o.funis.criar({ nome: NOME_FUNIL, etapas: Object.values(ETAPAS_POS_VENDA).map((e) => ({ ...e })) }, por);
    const criadas: string[] = [];
    try {
      const etapas = await this.o.funis.etapas(funil.id);
      const etapa = (k: ChaveEtapa) => {
        const e = etapas.find((x) => x.nome === ETAPAS_POS_VENDA[k].nome);
        if (!e) throw new ErroPosVenda(`Etapa "${ETAPAS_POS_VENDA[k].nome}" não foi criada.`, 409);
        return e.id;
      };
      const lista = montarAutomacoes({ funilId: funil.id, sistemaId: sistema.id, finalizado: finalizado.id, etapa, estilo: o.estilo ?? this.o.estiloPadrao ?? 'geral', ligada: o.ligada ?? true });
      for (const a of lista) criadas.push((await this.o.automacoes.criar(a, por)).id);
      await this.o.armazem.salvar(this.empresaId, { funilId: funil.id, semeadoEm: this.agora() }, por);
      return { funil, automacoes: criadas.length };
    } catch (e) {
      // Desfaz: apagar o funil leva as etapas e as automações dele; a do funil de atendimento sai à mão.
      for (const id of criadas) await this.o.automacoes.apagar(id).catch(() => {});
      await this.o.funis.apagar(funil.id).catch(() => {});
      throw e;
    }
  }

  /**
   * Sugestão automática (ao subir; na Império): cria uma vez só. Se a equipe já tem um funil "Pós-venda", ou se a
   * sugestão já foi criada antes (mesmo que depois apagada), não faz nada. Devolve se criou.
   */
  async semear(estilo?: Estilo): Promise<boolean> {
    if (!(await this.o.armazem.reservarSemente(this.empresaId, this.agora(), 'sistema'))) return false;
    try {
      await this.criarSugerido('sistema', { estilo, ligada: true });
      this.log('Pós-venda: funil e automações sugeridos criados');
      return true;
    } catch (e) {
      if (e instanceof ErroPosVenda && e.statusCode === 409) {
        this.log('Pós-venda: sugestão não criada (já existe um funil com esse nome)', e.message);
        return false; // fica marcada como semeada: não insiste
      }
      await this.o.armazem.liberarSemente(this.empresaId).catch(() => {});
      throw e;
    }
  }
}

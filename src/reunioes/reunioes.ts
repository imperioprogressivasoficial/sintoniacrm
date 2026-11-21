import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { AvisosReuniao } from './avisos.js';

/**
 * Link de agendamento (como o Cal.com, dentro da Sintonia): a equipe cria um link ("Reunião de 30 min",
 * dias e horários livres) e manda para o contato, que escolhe o horário numa página pública (/r/<slug>).
 * Também os scripts de venda (Vendas › Scripts). Tabelas: db/migrations/320_reunioes_scripts.sql.
 * Horários sempre no fuso da Bahia (UTC−3, sem horário de verão).
 */

const FUSO = '-03:00';
const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato 09:00.');

export const DadosLink = z.object({
  titulo: z.string().trim().min(2, 'Dê um nome ao link.').max(80),
  descricao: z.string().trim().max(600).default(''),
  duracao_min: z.number().int().min(10).max(240),
  dias: z.array(z.number().int().min(0).max(6)).min(1, 'Escolha pelo menos um dia.').max(7),
  inicio: HM,
  fim: HM,
  antecedencia_h: z.number().int().min(0).max(168).default(2),
  janela_dias: z.number().int().min(1).max(90).default(21),
  local: z.string().trim().max(300).default(''),
  ativo: z.boolean().default(true),
  /* atendimento-extra: confirmação/cancelamento/lembrete pelo WhatsApp para o contato e lembrete antes (min; 0 = sem). */
  whatsapp_cliente: z.boolean().default(true),
  lembrete_min: z.number().int().min(0).max(1440).default(60),
}).refine((d) => d.inicio < d.fim, { message: 'O fim tem que ser depois do início.', path: ['fim'] });
export type DadosLink = z.infer<typeof DadosLink>;

export interface LinkReuniao extends DadosLink { id: string; slug: string }
export interface Reserva { inicio: Date; fim: Date }

const minutos = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hmDe = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Data 'YYYY-MM-DD' de um instante, na Bahia. */
export const dataBahia = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
export const instante = (data: string, hm: string) => new Date(`${data}T${hm}:00${FUSO}`);

/** Horários livres de cada dia da janela do link (sem os já marcados e respeitando a antecedência). */
export function horariosLivres(link: Pick<LinkReuniao, 'duracao_min' | 'dias' | 'inicio' | 'fim' | 'antecedencia_h' | 'janela_dias'>, marcadas: Reserva[], agora: Date): Array<{ data: string; horarios: string[] }> {
  const saida: Array<{ data: string; horarios: string[] }> = [];
  const limite = agora.getTime() + link.antecedencia_h * 3600_000;
  const hoje = dataBahia(agora);
  for (let i = 0; i < link.janela_dias; i++) {
    const data = dataBahia(new Date(instante(hoje, '12:00').getTime() + i * 86400_000));
    const diaSemana = new Date(`${data}T12:00:00${FUSO}`).getUTCDay();
    if (!link.dias.includes(diaSemana)) continue;
    const horarios: string[] = [];
    for (let m = minutos(link.inicio); m + link.duracao_min <= minutos(link.fim); m += link.duracao_min) {
      const ini = instante(data, hmDe(m));
      const fim = new Date(ini.getTime() + link.duracao_min * 60_000);
      if (ini.getTime() < limite) continue;
      if (marcadas.some((r) => r.inicio < fim && r.fim > ini)) continue;
      horarios.push(hmDe(m));
    }
    if (horarios.length) saida.push({ data, horarios });
  }
  return saida;
}

const slugDe = (titulo: string) => {
  const base = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reuniao';
  return `${base}-${randomBytes(2).toString('hex')}`;
};

const linhaLink = (r: Record<string, unknown>): LinkReuniao => ({
  id: String(r.id), slug: String(r.slug), titulo: String(r.titulo), descricao: String(r.descricao ?? ''), duracao_min: Number(r.duracao_min),
  dias: (r.dias as number[]) ?? [], inicio: String(r.inicio), fim: String(r.fim), antecedencia_h: Number(r.antecedencia_h), janela_dias: Number(r.janela_dias),
  local: String(r.local ?? ''), ativo: Boolean(r.ativo),
  whatsapp_cliente: r.whatsapp_cliente === undefined ? true : Boolean(r.whatsapp_cliente), lembrete_min: r.lembrete_min === undefined ? 60 : Number(r.lembrete_min),
});

const DadosReserva = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: HM,
  nome: z.string().trim().min(2, 'Escreva seu nome.').max(120),
  telefone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(160).default(''),
  observacao: z.string().trim().max(800).default(''),
}).refine((d) => d.telefone.replace(/\D/g, '').length >= 10 || /.+@.+\..+/.test(d.email), { message: 'Informe um WhatsApp ou um e-mail.', path: ['telefone'] });

const DadosScript = z.object({
  titulo: z.string().trim().min(2, 'Dê um título ao script.').max(100),
  etapa: z.string().trim().max(60).default(''),
  texto: z.string().trim().min(1, 'Escreva o script.').max(6000),
  ordem: z.number().int().min(0).max(9999).default(0),
});

export function registrarReunioes(
  app: FastifyInstance,
  pool: pg.Pool,
  o: {
    agora?: () => Date;
    pastaPublica?: URL;
    /* integracoes: reunião marcada ou cancelada vira evento de webhook ("agendamento.*"). Nunca atrasa nem derruba a resposta. */
    aoReuniao?: (tipo: 'criado' | 'cancelado', empresaId: string, reuniao: Record<string, unknown>) => void;
    /* atendimento-extra: sino + push (dona do link e gestão), WhatsApp para o contato e lembrete antes. */
    avisos?: AvisosReuniao;
    /** A pessoa logada pode abrir esta conversa? (Agenda: botão "Abrir conversa"). */
    podeAbrir?: (req: FastifyRequest, conversaId: string) => Promise<boolean>;
  } = {},
): void {
  const avisar = (tipo: 'criado' | 'cancelado', r: Record<string, unknown> | undefined) => {
    if (!o.aoReuniao || !r) return;
    try {
      const inicio = new Date(r.inicio as string);
      const fim = new Date(r.fim as string);
      o.aoReuniao(tipo, String(r.empresa_id), {
        id: String(r.id), origem: 'link', status: tipo === 'criado' ? 'marcado' : 'cancelado', inicio: inicio.toISOString(), fim: fim.toISOString(),
        duracaoMin: Math.round((fim.getTime() - inicio.getTime()) / 60_000), titulo: r.titulo ?? null, local: r.local || null, linkId: String(r.link_id),
        cliente: { nome: r.nome ?? null, telefone: r.telefone ?? null, email: r.email ?? null }, observacao: r.observacao || null,
      });
    } catch { /* aviso é extra */ }
  };
  const agora = o.agora ?? (() => new Date());
  const empresa = (req: FastifyRequest) => {
    if (!req.usuario) throw Object.assign(new Error('Faça login para continuar.'), { statusCode: 401 });
    return req.usuario.empresaId;
  };
  const Id = z.string().uuid();

  // ---------- equipe ----------
  app.get('/api/reunioes', async (req) => {
    const e = empresa(req);
    const links = (await pool.query('select * from sintonia.links_reuniao where empresa_id = $1 order by criado_em', [e])).rows.map(linhaLink);
    const proximas = (await pool.query(
      `select r.id, r.nome, r.telefone, r.email, r.observacao, r.inicio, r.fim, r.status, l.titulo
         from sintonia.reunioes r join sintonia.links_reuniao l on l.id = r.link_id
        where r.empresa_id = $1 and r.fim > $2 order by r.inicio limit 100`, [e, agora()])).rows;
    return { links, proximas };
  });
  app.post('/api/reunioes/links', async (req) => {
    const e = empresa(req);
    const d = DadosLink.parse(req.body);
    const id = randomUUID();
    const slug = slugDe(d.titulo);
    await pool.query(
      `insert into sintonia.links_reuniao (id, empresa_id, slug, titulo, descricao, duracao_min, dias, inicio, fim, antecedencia_h, janela_dias, local, ativo, criado_por, whatsapp_cliente, lembrete_min)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, e, slug, d.titulo, d.descricao, d.duracao_min, d.dias, d.inicio, d.fim, d.antecedencia_h, d.janela_dias, d.local, d.ativo, req.usuario?.id ?? null, d.whatsapp_cliente, d.lembrete_min]);
    return { id, slug, ...d };
  });
  app.put('/api/reunioes/links/:id', async (req) => {
    const e = empresa(req);
    const id = Id.parse((req.params as { id: string }).id);
    const d = DadosLink.parse(req.body);
    const r = await pool.query(
      `update sintonia.links_reuniao set titulo=$3, descricao=$4, duracao_min=$5, dias=$6, inicio=$7, fim=$8, antecedencia_h=$9, janela_dias=$10, local=$11, ativo=$12,
              whatsapp_cliente=$13, lembrete_min=$14
        where id=$1 and empresa_id=$2`,
      [id, e, d.titulo, d.descricao, d.duracao_min, d.dias, d.inicio, d.fim, d.antecedencia_h, d.janela_dias, d.local, d.ativo, d.whatsapp_cliente, d.lembrete_min]);
    if (!r.rowCount) throw Object.assign(new Error('Link não encontrado.'), { statusCode: 404 });
    return { ok: true };
  });
  app.delete('/api/reunioes/links/:id', async (req) => {
    const e = empresa(req);
    await pool.query('delete from sintonia.links_reuniao where id=$1 and empresa_id=$2', [Id.parse((req.params as { id: string }).id), e]);
    return { ok: true };
  });
  app.post('/api/reunioes/:id/cancelar', async (req) => {
    const e = empresa(req);
    const r = await pool.query(
      `update sintonia.reunioes r set status='cancelada', cancelada_por='equipe', cancelada_em=$3 from sintonia.links_reuniao l where r.id=$1 and r.empresa_id=$2 and l.id = r.link_id and r.status <> 'cancelada' returning r.*, l.titulo, l.local`,
      [Id.parse((req.params as { id: string }).id), e, agora()]);
    avisar('cancelado', r.rows[0]);
    if (r.rows[0]) o.avisos?.aoCancelar(String(r.rows[0].id), 'equipe');
    return { ok: true };
  });

  /* atendimento-extra: reuniões marcadas pelo link na tela Agenda (junto dos agendamentos), com a etiqueta "Reunião online". */
  const AgendaQ = z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dias: z.coerce.number().int().min(1).max(42).default(14) });
  app.get('/api/reunioes/agenda', async (req) => {
    const e = empresa(req);
    const q = AgendaQ.parse(req.query);
    const de = instante(q.de, '00:00');
    const ate = new Date(de.getTime() + q.dias * 86400_000);
    const { rows } = await pool.query(
      `select r.id, r.nome, r.telefone, r.email, r.observacao, r.inicio, r.fim, r.conversa_id, r.criado_em, l.titulo, l.local, l.criado_por
         from sintonia.reunioes r join sintonia.links_reuniao l on l.id = r.link_id
        where r.empresa_id = $1 and r.status = 'marcada' and r.inicio < $3 and r.fim > $2
        order by r.inicio limit 500`, [e, de, ate]);
    const itens = [];
    for (const r of rows) {
      const conversaId = r.conversa_id ? String(r.conversa_id) : null;
      const inicio = new Date(r.inicio), fim = new Date(r.fim);
      itens.push({
        id: `reuniao:${r.id}`, reuniaoId: String(r.id), fonte: 'reuniao', cliente: r.nome, telefone: r.telefone ? String(r.telefone).replace(/\D/g, '') : '',
        email: r.email || null, observacao: r.observacao || '', servico: r.titulo, local: r.local || '', profissional: null, unidade: null,
        inicio: inicio.toISOString(), fim: fim.toISOString(), duracaoMin: Math.round((fim.getTime() - inicio.getTime()) / 60_000),
        responsavelId: r.criado_por ?? null, marcadoEm: new Date(r.criado_em).toISOString(), conversaId,
        podeAbrir: Boolean(conversaId && o.podeAbrir && (await o.podeAbrir(req, conversaId).catch(() => false))),
      });
    }
    return { itens };
  });

  // ---------- scripts de venda ----------
  app.get('/api/scripts', async (req) => ({ scripts: (await pool.query('select id, titulo, etapa, texto, ordem from sintonia.scripts_venda where empresa_id=$1 order by ordem, criado_em', [empresa(req)])).rows }));
  app.post('/api/scripts', async (req) => {
    const d = DadosScript.parse(req.body);
    const id = randomUUID();
    await pool.query('insert into sintonia.scripts_venda (id, empresa_id, titulo, etapa, texto, ordem) values ($1,$2,$3,$4,$5,$6)', [id, empresa(req), d.titulo, d.etapa, d.texto, d.ordem]);
    return { id, ...d };
  });
  app.put('/api/scripts/:id', async (req) => {
    const d = DadosScript.parse(req.body);
    const r = await pool.query('update sintonia.scripts_venda set titulo=$3, etapa=$4, texto=$5, ordem=$6 where id=$1 and empresa_id=$2', [Id.parse((req.params as { id: string }).id), empresa(req), d.titulo, d.etapa, d.texto, d.ordem]);
    if (!r.rowCount) throw Object.assign(new Error('Script não encontrado.'), { statusCode: 404 });
    return { ok: true };
  });
  app.delete('/api/scripts/:id', async (req) => {
    await pool.query('delete from sintonia.scripts_venda where id=$1 and empresa_id=$2', [Id.parse((req.params as { id: string }).id), empresa(req)]);
    return { ok: true };
  });

  // ---------- página pública (sem login) ----------
  const Slug = z.string().regex(/^[a-z0-9-]{3,60}$/);
  const pegarLink = async (slugBruto: string) => {
    const slug = Slug.safeParse(slugBruto);
    if (!slug.success) return null;
    const { rows } = await pool.query('select * from sintonia.links_reuniao where slug = $1 and ativo', [slug.data]);
    return rows[0] ? linhaLink(rows[0]) : null;
  };
  const marcadasDe = async (linkId: string) =>
    (await pool.query(`select inicio, fim from sintonia.reunioes where link_id=$1 and status='marcada' and fim > now()`, [linkId])).rows as Reserva[];

  app.get('/r/:slug', async (_req, reply) => {
    const html = await readFile(new URL('reuniao.html', o.pastaPublica ?? new URL('../../public/', import.meta.url)), 'utf8');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(html);
  });
  app.get('/reservar/:slug', async (req, reply) => {
    const link = await pegarLink((req.params as { slug: string }).slug);
    if (!link) return reply.code(404).send({ erro: 'Esse link de agendamento não existe ou foi desligado.' });
    return { titulo: link.titulo, descricao: link.descricao, duracao_min: link.duracao_min, local: link.local, dias: horariosLivres(link, await marcadasDe(link.id), agora()) };
  });
  const tentativas = new Map<string, number[]>();
  app.post('/reservar/:slug', async (req, reply) => {
    const ip = req.ip;
    const t = Date.now();
    const lista = (tentativas.get(ip) ?? []).filter((x) => x > t - 3600_000);
    if (lista.length >= 10) return reply.code(429).send({ erro: 'Muitas tentativas. Tente de novo mais tarde.' });
    tentativas.set(ip, [...lista, t]);
    if (tentativas.size > 5000) tentativas.clear();
    const link = await pegarLink((req.params as { slug: string }).slug);
    if (!link) return reply.code(404).send({ erro: 'Esse link de agendamento não existe ou foi desligado.' });
    const d = DadosReserva.safeParse(req.body);
    if (!d.success) return reply.code(400).send({ erro: d.error.issues[0]?.message ?? 'Confira os dados.' });
    const livres = horariosLivres(link, await marcadasDe(link.id), agora());
    if (!livres.some((x) => x.data === d.data.data && x.horarios.includes(d.data.hora))) return reply.code(409).send({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.' });
    const inicio = instante(d.data.data, d.data.hora);
    const fim = new Date(inicio.getTime() + link.duracao_min * 60_000);
    // atendimento-extra: código para o próprio contato desmarcar pelo link (vai na confirmação e na tela de "Agendado!").
    const codigo = randomBytes(18).toString('base64url');
    try {
      const r = await pool.query(
        `insert into sintonia.reunioes (id, link_id, empresa_id, nome, telefone, email, observacao, inicio, fim, codigo_cancelar, criado_em)
         select $1, $2, empresa_id, $3, $4, $5, $6, $7, $8, $9, $10 from sintonia.links_reuniao where id = $2 returning *`,
        [randomUUID(), link.id, d.data.nome, d.data.telefone || null, d.data.email || null, d.data.observacao, inicio, fim, codigo, agora()]);
      if (r.rows[0]) avisar('criado', { ...r.rows[0], titulo: link.titulo, local: link.local });
      if (r.rows[0]) o.avisos?.aoMarcar(String(r.rows[0].id));
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.' });
      throw e;
    }
    return { ok: true, inicio: inicio.toISOString(), fim: fim.toISOString(), titulo: link.titulo, local: link.local, cancelar: codigo };
  });

  // atendimento-extra: o contato vê e desmarca a própria reunião pelo link (/r/<slug>?cancelar=<código>).
  const Codigo = z.string().regex(/^[A-Za-z0-9_-]{20,40}$/);
  const reservaDoCodigo = async (slugBruto: string, codigoBruto: unknown) => {
    const slug = Slug.safeParse(slugBruto);
    const codigo = Codigo.safeParse(codigoBruto);
    if (!slug.success || !codigo.success) return null;
    const { rows } = await pool.query(
      `select r.*, l.titulo, l.local from sintonia.reunioes r join sintonia.links_reuniao l on l.id = r.link_id
        where l.slug = $1 and r.codigo_cancelar = $2`, [slug.data, codigo.data]);
    return rows[0] ?? null;
  };
  const limitar = (ip: string) => {
    const t = Date.now();
    const lista = (tentativas.get(ip) ?? []).filter((x) => x > t - 3600_000);
    if (lista.length >= 30) return true;
    tentativas.set(ip, [...lista, t]);
    return false;
  };
  app.get('/reservar/:slug/reserva', async (req, reply) => {
    if (limitar(req.ip)) return reply.code(429).send({ erro: 'Muitas tentativas. Tente de novo mais tarde.' });
    const r = await reservaDoCodigo((req.params as { slug: string }).slug, (req.query as { codigo?: string }).codigo);
    if (!r) return reply.code(404).send({ erro: 'Não achamos esse agendamento.' });
    return { titulo: r.titulo, local: r.local, nome: r.nome, inicio: new Date(r.inicio).toISOString(), fim: new Date(r.fim).toISOString(), status: r.status, passou: new Date(r.inicio).getTime() <= agora().getTime() };
  });
  app.post('/reservar/:slug/cancelar', async (req, reply) => {
    if (limitar(req.ip)) return reply.code(429).send({ erro: 'Muitas tentativas. Tente de novo mais tarde.' });
    const r = await reservaDoCodigo((req.params as { slug: string }).slug, (req.body as { codigo?: string } | null)?.codigo);
    if (!r) return reply.code(404).send({ erro: 'Não achamos esse agendamento.' });
    if (r.status === 'cancelada') return { ok: true, jaCancelada: true };
    if (new Date(r.inicio).getTime() <= agora().getTime()) return reply.code(409).send({ erro: 'Essa reunião já começou. Fale com quem te mandou o link.' });
    const u = await pool.query(`update sintonia.reunioes set status='cancelada', cancelada_por='cliente', cancelada_em=$2 where id=$1 and status='marcada' returning *`, [r.id, agora()]);
    if (u.rows[0]) {
      avisar('cancelado', { ...u.rows[0], titulo: r.titulo, local: r.local });
      o.avisos?.aoCancelar(String(r.id), 'cliente');
    }
    return { ok: true };
  });
}

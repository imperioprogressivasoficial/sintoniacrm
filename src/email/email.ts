import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Cofre } from '../conexoes/cofre.js';
import { ETAPAS, type Conversa } from '../domain.js';
import { UNIDADES } from '../unidades.js';
import { bahia, partesBahia } from '../util/tempo.js';
import { Conteudo, montarEmail, trocarVariaveis, type Variaveis } from './blocos.js';
import { ErroEnvio, type ContaEnvio, type FabricaTransporte } from './transporte.js';

/**
 * E-mail marketing da Sintonia: contas remetentes, modelos, campanhas, público, fila de envio com ritmo,
 * rastreio (abertura, clique), descadastro e bounces. Tudo no Postgres: a fila sobrevive a reinício
 * (reserva com prazo + "skip locked") e cada destinatário é único por campanha (idempotente).
 */

export class ErroEmail extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------ predefinições

export const PREDEFINICOES = {
  hostinger: { nome: 'Hostinger', smtpHost: 'smtp.hostinger.com', smtpPorta: 465, smtpSeguranca: 'ssl', imapHost: 'imap.hostinger.com', imapPorta: 993, porMinuto: 20, limiteDiario: 1000, dica: 'Use o e-mail completo como usuário e a senha da caixa de e-mail (hPanel → E-mails).' },
  gmail: { nome: 'Gmail / Google Workspace', smtpHost: 'smtp.gmail.com', smtpPorta: 465, smtpSeguranca: 'ssl', imapHost: 'imap.gmail.com', imapPorta: 993, porMinuto: 20, limiteDiario: 500, dica: 'Precisa da verificação em duas etapas ligada e de uma "senha de app" (Conta Google → Segurança → Senhas de app). A senha normal não funciona.' },
  outlook: { nome: 'Outlook / Microsoft 365', smtpHost: 'smtp.office365.com', smtpPorta: 587, smtpSeguranca: 'starttls', imapHost: 'outlook.office365.com', imapPorta: 993, porMinuto: 15, limiteDiario: 300, dica: 'No Microsoft 365 o administrador precisa liberar o "SMTP autenticado" para a caixa.' },
  outro: { nome: 'Outro servidor SMTP', smtpHost: '', smtpPorta: 587, smtpSeguranca: 'starttls', imapHost: '', imapPorta: 993, porMinuto: 20, limiteDiario: 300, dica: 'Peça ao seu provedor o endereço SMTP, a porta e o tipo de segurança.' },
} as const;

// ------------------------------------------------------------ esquemas

const email = z.string().trim().toLowerCase().email('E-mail inválido').max(200);
const texto = (max: number) => z.string().trim().max(max);

export const ContaCorpo = z.object({
  nome: texto(80).min(1, 'Dê um nome para a conta'),
  provedor: z.enum(['smtp', 'resend', 'brevo']).default('smtp'),
  predefinicao: z.enum(['hostinger', 'gmail', 'outlook', 'outro']).optional(),
  smtpHost: texto(200).optional(),
  smtpPorta: z.number().int().min(1).max(65535).optional(),
  smtpSeguranca: z.enum(['ssl', 'starttls', 'nenhuma']).default('ssl'),
  usuario: texto(200).optional(),
  /** Vazio/ausente = mantém a senha salva. */
  senha: z.string().max(400).optional(),
  apiChave: z.string().max(400).optional(),
  remetenteNome: texto(80).min(1, 'Informe o nome do remetente'),
  remetenteEmail: email,
  responderPara: z.union([email, z.literal('')]).optional(),
  imapLigado: z.boolean().default(false),
  imapHost: texto(200).optional(),
  imapPorta: z.number().int().min(1).max(65535).optional(),
  porMinuto: z.number().int().min(1).max(600).default(20),
  limiteDiario: z.number().int().min(1).max(100000).default(300),
  ativa: z.boolean().default(true),
});
export type ContaCorpo = z.infer<typeof ContaCorpo>;

const uuid = z.string().uuid();
export const Publico = z.object({
  tags: z.array(uuid).max(50).default([]),
  tagsExcluir: z.array(uuid).max(50).default([]),
  etapas: z.array(z.enum(ETAPAS)).max(ETAPAS.length).default([]),
  unidades: z.array(z.enum(['norte', 'sumare', 'feira'])).max(3).default([]),
  aniversariantesDoMes: z.boolean().default(false),
  /** Quantos no máximo (vazio = todos). */
  quantidade: z.number().int().min(1).max(100000).nullable().default(null),
  ordem: z.enum(['recentes', 'aleatoria']).default('recentes'),
});
export type Publico = z.infer<typeof Publico>;

export const ModeloCorpo = z.object({
  nome: texto(120).min(1),
  assunto: texto(200).default(''),
  preheader: texto(200).default(''),
  conteudo: Conteudo,
  contaId: uuid.nullable().optional(),
});

export const CampanhaCorpo = z.object({
  nome: texto(120).min(1, 'Dê um nome para a campanha'),
  contaId: uuid.nullable().optional(),
  assunto: texto(200).default(''),
  preheader: texto(200).default(''),
  conteudo: Conteudo.default({ tema: Conteudo.shape.tema.parse(undefined), blocos: [] }),
  publico: Publico.default(Publico.parse({})),
});
export const CampanhaAlteracao = CampanhaCorpo.partial();

// ------------------------------------------------------------ tipos

export interface ContaResumo {
  id: string;
  nome: string;
  provedor: 'smtp' | 'resend' | 'brevo';
  predefinicao: string | null;
  smtpHost: string | null;
  smtpPorta: number | null;
  smtpSeguranca: 'ssl' | 'starttls' | 'nenhuma';
  usuario: string | null;
  senhaDefinida: boolean;
  apiChaveDefinida: boolean;
  remetenteNome: string;
  remetenteEmail: string;
  responderPara: string | null;
  imapLigado: boolean;
  imapHost: string | null;
  imapPorta: number | null;
  imapLidoEm: Date | null;
  imapErro: string | null;
  porMinuto: number;
  limiteDiario: number;
  ativa: boolean;
  testadaEm: Date | null;
  testeErro: string | null;
  enviadosHoje?: number;
}

interface LinhaConta {
  id: string;
  empresa_id: string;
  nome: string;
  provedor: 'smtp' | 'resend' | 'brevo';
  predefinicao: string | null;
  smtp_host: string | null;
  smtp_porta: number | null;
  smtp_seguranca: 'ssl' | 'starttls' | 'nenhuma';
  usuario: string | null;
  senha_cifrada: string | null;
  api_chave_cifrada: string | null;
  remetente_nome: string;
  remetente_email: string;
  responder_para: string | null;
  imap_ligado: boolean;
  imap_host: string | null;
  imap_porta: number | null;
  imap_ultimo_uid: string;
  imap_lido_em: Date | null;
  imap_erro: string | null;
  por_minuto: number;
  limite_diario: number;
  ativa: boolean;
  testada_em: Date | null;
  teste_erro: string | null;
}

interface LinhaEnvio {
  id: string;
  token: string;
  campanha_id: string | null;
  modelo_id: string | null;
  conta_id: string | null;
  email: string;
  nome: string | null;
  telefone: string | null;
  conversa_id: string | null;
  unidade: string | null;
  estado: string;
  tentativas: number;
}

interface Destinatario {
  email: string;
  nome: string | null;
  telefone: string | null;
  conversa_id: string | null;
  unidade: string | null;
}

export interface OpcoesEmail {
  pool: pg.Pool;
  cofre: Cofre;
  empresaId: string;
  transporte: FabricaTransporte;
  /** Endereço público (https://...) dos links de rastreio. Sem ele, vale o último visto numa requisição. */
  urlPublica?: string;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Leitor de IMAP (injetável nos testes). */
  lerImap?: (conta: { host: string; porta: number; usuario: string; senha: string; ultimoUid: number }) => Promise<{ mensagens: Array<{ uid: number; fonte: Buffer }>; ultimoUid: number }>;
}

const EMAIL_VALIDO = "^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$";
const RESERVA_MS = 5 * 60_000;
const MAX_TENTATIVAS = 4;

const novoToken = () => randomBytes(24).toString('hex');
const nomeUnidade = (u: string | null) => (u && u in UNIDADES ? UNIDADES[u as keyof typeof UNIDADES].nome : '');

export class EmailMarketing {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private urlVista?: string;
  private rodando = false;

  constructor(private readonly o: OpcoesEmail) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  get empresaId() {
    return this.o.empresaId;
  }

  /** Guarda o endereço por onde a gestão acessa (base dos links rastreados, se não houver um fixo). */
  verUrl(base: string) {
    if (!this.o.urlPublica && /^https?:\/\//.test(base)) this.urlVista = base.replace(/\/+$/, '');
  }
  baseUrl(): string {
    return (this.o.urlPublica || this.urlVista || 'http://localhost:3000').replace(/\/+$/, '');
  }

  private q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, p: unknown[] = []) {
    return this.o.pool.query<T>(sql, p);
  }

  // ============================================================ contas

  private resumoConta(l: LinhaConta): ContaResumo {
    return {
      id: l.id,
      nome: l.nome,
      provedor: l.provedor,
      predefinicao: l.predefinicao,
      smtpHost: l.smtp_host,
      smtpPorta: l.smtp_porta,
      smtpSeguranca: l.smtp_seguranca,
      usuario: l.usuario,
      senhaDefinida: Boolean(l.senha_cifrada),
      apiChaveDefinida: Boolean(l.api_chave_cifrada),
      remetenteNome: l.remetente_nome,
      remetenteEmail: l.remetente_email,
      responderPara: l.responder_para,
      imapLigado: l.imap_ligado,
      imapHost: l.imap_host,
      imapPorta: l.imap_porta,
      imapLidoEm: l.imap_lido_em,
      imapErro: l.imap_erro,
      porMinuto: l.por_minuto,
      limiteDiario: l.limite_diario,
      ativa: l.ativa,
      testadaEm: l.testada_em,
      testeErro: l.teste_erro,
    };
  }

  private decifrar(v: string | null): string | null {
    if (!v) return null;
    try {
      return this.o.cofre.decifrar(v);
    } catch {
      return null;
    }
  }

  private envioDe(l: LinhaConta): ContaEnvio {
    return { id: l.id, provedor: l.provedor, smtpHost: l.smtp_host, smtpPorta: l.smtp_porta, smtpSeguranca: l.smtp_seguranca, usuario: l.usuario, senha: this.decifrar(l.senha_cifrada), apiChave: this.decifrar(l.api_chave_cifrada) };
  }

  private async linhaConta(id: string): Promise<LinhaConta> {
    const { rows } = await this.q<LinhaConta>('select * from sintonia.email_contas where id = $1 and empresa_id = $2', [id, this.o.empresaId]);
    if (!rows[0]) throw new ErroEmail('Conta de e-mail não encontrada.', 404);
    return rows[0];
  }

  async contas(): Promise<ContaResumo[]> {
    const { rows } = await this.q<LinhaConta>('select * from sintonia.email_contas where empresa_id = $1 order by criada_em', [this.o.empresaId]);
    const hoje = this.inicioDoDia();
    const { rows: n } = await this.q<{ conta_id: string; n: string }>('select conta_id, count(*) as n from sintonia.email_envios where empresa_id = $1 and enviado_em >= $2 group by conta_id', [this.o.empresaId, hoje]);
    const porConta = new Map(n.map((x) => [x.conta_id, Number(x.n)]));
    return rows.map((l) => ({ ...this.resumoConta(l), enviadosHoje: porConta.get(l.id) ?? 0 }));
  }

  async salvarConta(id: string | null, bruto: unknown, quem: string): Promise<ContaResumo> {
    const c = ContaCorpo.parse(bruto);
    const atual = id ? await this.linhaConta(id) : undefined;
    if (c.provedor === 'smtp' && (!c.smtpHost || !c.usuario)) throw new ErroEmail('Preencha o servidor SMTP e o usuário.');
    const senha = c.senha?.trim() ? this.o.cofre.cifrar(c.senha) : (atual?.senha_cifrada ?? null);
    const chave = c.apiChave?.trim() ? this.o.cofre.cifrar(c.apiChave.trim()) : (atual?.api_chave_cifrada ?? null);
    if (c.provedor === 'smtp' && !senha) throw new ErroEmail('Informe a senha da caixa de e-mail (no Gmail, a senha de app).');
    if (c.provedor !== 'smtp' && !chave) throw new ErroEmail('Informe a chave da API do provedor.');
    if (c.imapLigado && !c.imapHost) throw new ErroEmail('Para ler as respostas, preencha o servidor IMAP.');
    const valores = [
      c.nome, c.provedor, c.predefinicao ?? null, c.smtpHost || null, c.smtpPorta ?? null, c.smtpSeguranca, c.usuario || null, senha, chave,
      c.remetenteNome, c.remetenteEmail, c.responderPara || null, c.imapLigado, c.imapHost || null, c.imapPorta ?? null, c.porMinuto, c.limiteDiario, c.ativa,
    ];
    if (atual) {
      await this.q(
        `update sintonia.email_contas set nome=$1, provedor=$2, predefinicao=$3, smtp_host=$4, smtp_porta=$5, smtp_seguranca=$6, usuario=$7, senha_cifrada=$8, api_chave_cifrada=$9,
           remetente_nome=$10, remetente_email=$11, responder_para=$12, imap_ligado=$13, imap_host=$14, imap_porta=$15, por_minuto=$16, limite_diario=$17, ativa=$18, atualizada_em=now()
         where id=$19`,
        [...valores, atual.id],
      );
      return this.resumoConta(await this.linhaConta(atual.id));
    }
    const novo = randomUUID();
    await this.q(
      `insert into sintonia.email_contas (nome, provedor, predefinicao, smtp_host, smtp_porta, smtp_seguranca, usuario, senha_cifrada, api_chave_cifrada,
         remetente_nome, remetente_email, responder_para, imap_ligado, imap_host, imap_porta, por_minuto, limite_diario, ativa, id, empresa_id, criada_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [...valores, novo, this.o.empresaId, quem],
    );
    return this.resumoConta(await this.linhaConta(novo));
  }

  async apagarConta(id: string): Promise<void> {
    await this.linhaConta(id);
    await this.q("update sintonia.email_envios set estado = 'cancelado', erro = 'Conta apagada' where conta_id = $1 and estado = 'pendente'", [id]);
    await this.q('delete from sintonia.email_contas where id = $1', [id]);
  }

  /** Confere o login e envia um e-mail de teste. */
  async testarConta(id: string, para: string): Promise<{ ok: boolean; mensagem?: string; erro?: string }> {
    const l = await this.linhaConta(id);
    const t = this.o.transporte(this.envioDe(l));
    try {
      await t.verificar();
      const token = novoToken();
      await t.enviar({
        de: { nome: l.remetente_nome, email: l.remetente_email },
        para: { email: email.parse(para) },
        responderPara: l.responder_para,
        assunto: 'Teste da Sintonia: sua conta de e-mail está funcionando ✓',
        html: `<!DOCTYPE html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0B2540;padding:24px"><h2 style="color:#106EBE">Tudo certo!</h2><p>Este é um e-mail de teste enviado pela Sintonia usando a conta <b>${l.nome.replace(/</g, '&lt;')}</b>.</p><p>Se ele chegou na caixa de entrada (e não no spam), a configuração está boa. Se caiu no spam, confira o SPF, o DKIM e o DMARC do domínio.</p></body></html>`,
        texto: `Tudo certo! Este é um e-mail de teste enviado pela Sintonia usando a conta ${l.nome}.`,
        messageId: `<teste-${token}@${dominio(l.remetente_email)}>`,
      });
      await this.q('update sintonia.email_contas set testada_em = $2, teste_erro = null where id = $1', [id, this.agora()]);
      return { ok: true, mensagem: `Conexão ok. E-mail de teste enviado para ${para}.` };
    } catch (e) {
      const erro = String((e as Error).message ?? e).slice(0, 400);
      await this.q('update sintonia.email_contas set testada_em = $2, teste_erro = $3 where id = $1', [id, this.agora(), erro]);
      return { ok: false, erro };
    }
  }

  // ============================================================ modelos

  async modelos() {
    const { rows } = await this.q('select id, nome, assunto, preheader, conteudo, conta_id, atualizado_em from sintonia.email_modelos where empresa_id = $1 order by nome', [this.o.empresaId]);
    return rows.map((r) => ({ id: r.id, nome: r.nome, assunto: r.assunto, preheader: r.preheader, conteudo: r.conteudo, contaId: r.conta_id, atualizadoEm: r.atualizado_em }));
  }

  async salvarModelo(id: string | null, bruto: unknown, quem: string) {
    const m = ModeloCorpo.parse(bruto);
    if (id) {
      const r = await this.q('update sintonia.email_modelos set nome=$1, assunto=$2, preheader=$3, conteudo=$4, conta_id=$5, atualizado_em=now() where id=$6 and empresa_id=$7', [m.nome, m.assunto, m.preheader, JSON.stringify(m.conteudo), m.contaId ?? null, id, this.o.empresaId]);
      if (!r.rowCount) throw new ErroEmail('Modelo não encontrado.', 404);
    } else {
      id = randomUUID();
      await this.q('insert into sintonia.email_modelos (id, empresa_id, nome, assunto, preheader, conteudo, conta_id, criado_por) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, this.o.empresaId, m.nome, m.assunto, m.preheader, JSON.stringify(m.conteudo), m.contaId ?? null, quem]);
    }
    return (await this.modelos()).find((x) => x.id === id)!;
  }

  async modeloExiste(id: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const { rows } = await this.q('select 1 from sintonia.email_modelos where id = $1 and empresa_id = $2', [id, this.o.empresaId]);
    return rows.length > 0;
  }

  async apagarModelo(id: string) {
    await this.q('delete from sintonia.email_modelos where id = $1 and empresa_id = $2', [id, this.o.empresaId]);
  }

  // ============================================================ público

  /** SQL do público: um destinatário por e-mail válido, sem descadastrados nem bounces. */
  private sqlPublico(p: Publico, comLimite: boolean): { sql: string; params: unknown[] } {
    const params: unknown[] = [this.o.empresaId];
    const add = (v: unknown) => `$${params.push(v)}`;
    const naConversa: string[] = [];
    if (p.unidades.length) naConversa.push(`c.unidade = any(${add(p.unidades)}::text[])`);
    if (p.etapas.length) naConversa.push(`c.etapa = any(${add(p.etapas)}::text[])`);
    if (p.tags.length) naConversa.push(`exists (select 1 from sintonia.conversa_tags t where t.conversa_id = c.id and t.tag_id = any(${add(p.tags)}::uuid[]))`);
    const exigeConversa = naConversa.length > 0;
    const filtros: string[] = [`ct.empresa_id = $1`, `btrim(ct.email) ~* ${add(EMAIL_VALIDO)}`, `not exists (select 1 from sintonia.email_supressoes s where s.empresa_id = $1 and s.email = lower(btrim(ct.email)))`];
    if (exigeConversa) filtros.push('cv.id is not null');
    if (p.tagsExcluir.length) {
      filtros.push(`not exists (select 1 from sintonia.conversas c2 join sintonia.conversa_tags t2 on t2.conversa_id = c2.id where c2.empresa_id = $1 and c2.telefone = ct.telefone and t2.tag_id = any(${add(p.tagsExcluir)}::uuid[]))`);
    }
    if (p.aniversariantesDoMes) filtros.push(`extract(month from ct.nascimento) = ${add(partesBahia(this.agora()).mes)}`);
    const sql = `
      with base as (
        select distinct on (lower(btrim(ct.email))) lower(btrim(ct.email)) as email, coalesce(nullif(ct.nome, ''), cv.nome) as nome, ct.telefone,
               cv.id as conversa_id, cv.unidade, ct.atualizado_em
          from sintonia.contatos ct
          left join lateral (
            select c.id, c.nome, c.unidade from sintonia.conversas c
             where c.empresa_id = ct.empresa_id and c.telefone = ct.telefone ${naConversa.length ? `and ${naConversa.join(' and ')}` : ''}
             order by c.atualizada_em desc limit 1
          ) cv on true
         where ${filtros.join(' and ')}
         order by lower(btrim(ct.email)), ct.atualizado_em desc
      )
      select email, nome, telefone, conversa_id, unidade from base
       order by ${p.ordem === 'aleatoria' ? 'random()' : 'atualizado_em desc, email'}
       ${comLimite && p.quantidade ? `limit ${add(p.quantidade)}` : ''}`;
    return { sql, params };
  }

  async contarPublico(bruto: unknown): Promise<{ total: number; disponiveis: number; amostra: Destinatario[] }> {
    const p = Publico.parse(bruto ?? {});
    const { sql, params } = this.sqlPublico({ ...p, quantidade: null }, false);
    const { rows } = await this.q<{ n: string }>(`select count(*) as n from (${sql}) x`, params);
    const disponiveis = Number(rows[0]?.n ?? 0);
    const amostra = await this.q<Destinatario>(`select * from (${this.sqlPublico({ ...p, quantidade: Math.min(p.quantidade ?? 6, 6) }, true).sql}) x`, this.sqlPublico({ ...p, quantidade: Math.min(p.quantidade ?? 6, 6) }, true).params);
    return { total: p.quantidade ? Math.min(p.quantidade, disponiveis) : disponiveis, disponiveis, amostra: amostra.rows };
  }

  // ============================================================ campanhas

  private campanhaDe(r: pg.QueryResultRow) {
    return {
      id: r.id as string,
      nome: r.nome as string,
      contaId: r.conta_id as string | null,
      assunto: r.assunto as string,
      preheader: r.preheader as string,
      conteudo: r.conteudo as Conteudo,
      publico: Publico.parse(r.publico ?? {}),
      estado: r.estado as string,
      agendadaPara: r.agendada_para as Date | null,
      total: r.total as number,
      iniciadaEm: r.iniciada_em as Date | null,
      concluidaEm: r.concluida_em as Date | null,
      criadaPor: r.criada_por as string | null,
      criadaEm: r.criada_em as Date,
      atualizadaEm: r.atualizada_em as Date,
    };
  }

  async campanhas() {
    const { rows } = await this.q(
      `select c.*, coalesce(m.enviados, 0)::int as enviados, coalesce(m.abertos, 0)::int as abertos, coalesce(m.clicados, 0)::int as clicados
         from sintonia.email_campanhas c
         left join lateral (select count(*) filter (where enviado_em is not null) as enviados, count(*) filter (where aberto_em is not null) as abertos,
                                   count(*) filter (where clicado_em is not null) as clicados from sintonia.email_envios e where e.campanha_id = c.id) m on true
        where c.empresa_id = $1 order by c.criada_em desc limit 200`,
      [this.o.empresaId],
    );
    return rows.map((r) => ({ ...this.campanhaDe(r), metricas: { enviados: r.enviados, abertos: r.abertos, clicados: r.clicados } }));
  }

  async campanha(id: string) {
    const { rows } = await this.q('select * from sintonia.email_campanhas where id = $1 and empresa_id = $2', [id, this.o.empresaId]);
    if (!rows[0]) throw new ErroEmail('Campanha não encontrada.', 404);
    return this.campanhaDe(rows[0]);
  }

  async criarCampanha(bruto: unknown, quem: string) {
    const c = CampanhaCorpo.parse(bruto);
    const id = randomUUID();
    const conta = c.contaId ?? (await this.contaPadrao())?.id ?? null;
    await this.q(
      'insert into sintonia.email_campanhas (id, empresa_id, nome, conta_id, assunto, preheader, conteudo, publico, criada_por) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, this.o.empresaId, c.nome, conta, c.assunto, c.preheader, JSON.stringify(c.conteudo), JSON.stringify(c.publico), quem],
    );
    return this.campanha(id);
  }

  async alterarCampanha(id: string, bruto: unknown) {
    const atual = await this.campanha(id);
    if (!['rascunho', 'agendada'].includes(atual.estado)) throw new ErroEmail('Campanha já enviada: duplique para fazer outra.', 409);
    const c = CampanhaAlteracao.parse(bruto);
    await this.q(
      `update sintonia.email_campanhas set nome = coalesce($2, nome), conta_id = case when $3::boolean then $4::uuid else conta_id end, assunto = coalesce($5, assunto),
         preheader = coalesce($6, preheader), conteudo = coalesce($7::jsonb, conteudo), publico = coalesce($8::jsonb, publico), atualizada_em = now() where id = $1`,
      [id, c.nome ?? null, c.contaId !== undefined, c.contaId ?? null, c.assunto ?? null, c.preheader ?? null, c.conteudo ? JSON.stringify(c.conteudo) : null, c.publico ? JSON.stringify(c.publico) : null],
    );
    return this.campanha(id);
  }

  async apagarCampanha(id: string) {
    const c = await this.campanha(id);
    if (c.estado === 'enviando') throw new ErroEmail('Pause ou cancele a campanha antes de apagar.', 409);
    await this.q('delete from sintonia.email_campanhas where id = $1', [id]);
  }

  async duplicarCampanha(id: string, quem: string) {
    const c = await this.campanha(id);
    return this.criarCampanha({ nome: `${c.nome} (cópia)`.slice(0, 120), contaId: c.contaId, assunto: c.assunto, preheader: c.preheader, conteudo: c.conteudo, publico: c.publico }, quem);
  }

  private async contaPadrao(): Promise<LinhaConta | undefined> {
    const { rows } = await this.q<LinhaConta>('select * from sintonia.email_contas where empresa_id = $1 and ativa order by criada_em limit 1', [this.o.empresaId]);
    return rows[0];
  }

  private conferirPronta(c: Awaited<ReturnType<EmailMarketing['campanha']>>) {
    if (!c.contaId) throw new ErroEmail('Escolha a conta remetente (configure uma em Conexões → E-mail).');
    if (!c.assunto.trim()) throw new ErroEmail('Escreva o assunto do e-mail.');
    if (!c.conteudo.blocos.length) throw new ErroEmail('O e-mail está vazio: adicione pelo menos um bloco.');
  }

  /** Enviar agora (quando ausente) ou agendar. O público é montado na hora de começar. */
  async enviarCampanha(id: string, quando?: Date | null): Promise<{ estado: string; total: number; agendadaPara: Date | null }> {
    const c = await this.campanha(id);
    if (!['rascunho', 'agendada'].includes(c.estado)) throw new ErroEmail('Esta campanha já foi enviada.', 409);
    this.conferirPronta(c);
    const conta = await this.linhaConta(c.contaId!);
    if (!conta.ativa) throw new ErroEmail('A conta remetente está desligada.');
    if (quando && quando.getTime() > this.agora().getTime() + 30_000) {
      await this.q("update sintonia.email_campanhas set estado = 'agendada', agendada_para = $2, base_url = $3, atualizada_em = now() where id = $1", [id, quando, this.baseUrl()]);
      return { estado: 'agendada', total: 0, agendadaPara: quando };
    }
    const total = await this.comecar(id, c.publico, c.contaId!);
    return { estado: 'enviando', total, agendadaPara: null };
  }

  /** Monta a fila da campanha (idempotente: o mesmo e-mail não entra duas vezes) e liga o envio. */
  private async comecar(id: string, publico: Publico, contaId: string): Promise<number> {
    const { sql, params } = this.sqlPublico(publico, true);
    const n = params.length;
    await this.q(
      `insert into sintonia.email_envios (empresa_id, token, campanha_id, conta_id, email, nome, telefone, conversa_id, unidade, proxima_em, criado_em)
       select $1, left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 48), $${n + 1}, $${n + 2}, p.email, p.nome, p.telefone, p.conversa_id, p.unidade, $${n + 3}, $${n + 3}
         from (${sql}) p
       on conflict do nothing`,
      [...params, id, contaId, this.agora()],
    );
    const { rows } = await this.q<{ n: string }>('select count(*) as n from sintonia.email_envios where campanha_id = $1', [id]);
    const total = Number(rows[0]!.n);
    await this.q(
      "update sintonia.email_campanhas set estado = 'enviando', total = $2, iniciada_em = coalesce(iniciada_em, $3), base_url = coalesce(base_url, $4), atualizada_em = now() where id = $1",
      [id, total, this.agora(), this.baseUrl()],
    );
    return total;
  }

  async pausar(id: string) {
    const r = await this.q("update sintonia.email_campanhas set estado = 'pausada', atualizada_em = now() where id = $1 and empresa_id = $2 and estado in ('enviando', 'agendada')", [id, this.o.empresaId]);
    if (!r.rowCount) throw new ErroEmail('Só dá para pausar uma campanha enviando ou agendada.', 409);
    return this.campanha(id);
  }

  async retomar(id: string) {
    const c = await this.campanha(id);
    if (c.estado !== 'pausada') throw new ErroEmail('A campanha não está pausada.', 409);
    const { rows } = await this.q<{ n: string }>('select count(*) as n from sintonia.email_envios where campanha_id = $1', [id]);
    if (Number(rows[0]!.n) === 0) {
      // Pausada antes de começar (estava agendada): volta para a agenda (ou começa, se já passou da hora).
      if (c.agendadaPara && c.agendadaPara.getTime() > this.agora().getTime()) await this.q("update sintonia.email_campanhas set estado = 'agendada' where id = $1", [id]);
      else await this.comecar(id, c.publico, c.contaId!);
    } else await this.q("update sintonia.email_campanhas set estado = 'enviando', atualizada_em = now() where id = $1", [id]);
    return this.campanha(id);
  }

  async cancelar(id: string) {
    const c = await this.campanha(id);
    if (['concluida', 'cancelada'].includes(c.estado)) throw new ErroEmail('A campanha já terminou.', 409);
    await this.q("update sintonia.email_envios set estado = 'cancelado' where campanha_id = $1 and estado = 'pendente'", [id]);
    await this.q("update sintonia.email_campanhas set estado = 'cancelada', concluida_em = $2, atualizada_em = now() where id = $1", [id, this.agora()]);
    return this.campanha(id);
  }

  // ============================================================ prévia e teste

  /** HTML de prévia (variáveis com um exemplo; links e descadastro sem rastreio). */
  previa(b: { assunto?: string; preheader?: string; conteudo: unknown; nome?: string; unidade?: string }): { html: string; assunto: string } {
    const conteudo = Conteudo.parse(b.conteudo);
    const v: Variaveis = { nome: b.nome ?? 'Maria Souza', email: 'maria@exemplo.com', unidade: b.unidade ?? 'Salvador Norte Shopping' };
    const m = montarEmail(conteudo, { assunto: b.assunto ?? '', preheader: b.preheader, descadastro: '#descadastro' });
    return { html: trocarVariaveis(m.html, v, true), assunto: trocarVariaveis(b.assunto ?? '', v, false) };
  }

  /** "Enviar teste para mim": sai na hora, com [TESTE] no assunto, sem rastreio. */
  async enviarTeste(id: string, para: string, nome?: string) {
    const c = await this.campanha(id);
    this.conferirPronta(c);
    const conta = await this.linhaConta(c.contaId!);
    const v: Variaveis = { nome: nome ?? 'Maria Souza', email: para, unidade: 'Salvador Norte Shopping' };
    const m = montarEmail(c.conteudo, { assunto: c.assunto, preheader: c.preheader, descadastro: `${this.baseUrl()}/e/d/teste` });
    await this.o.transporte(this.envioDe(conta)).enviar({
      de: { nome: conta.remetente_nome, email: conta.remetente_email },
      para: { email: email.parse(para), nome },
      responderPara: conta.responder_para,
      assunto: `[TESTE] ${trocarVariaveis(c.assunto, v, false)}`,
      html: trocarVariaveis(m.html, v, true),
      texto: trocarVariaveis(m.texto, v, false),
      messageId: `<teste-${novoToken()}@${dominio(conta.remetente_email)}>`,
    });
    return { ok: true, para };
  }

  // ============================================================ automações

  /** Passo "enviar e-mail" das automações: entra na fila (idempotente pela chave da execução). */
  async deAutomacao(p: { conversa: Conversa; modeloId: string; chave: string; variaveis?: Record<string, string> }): Promise<{ ok: true; detalhe: string } | { ok: false; motivo: string }> {
    const { rows: ms } = await this.q('select * from sintonia.email_modelos where id = $1 and empresa_id = $2', [p.modeloId, this.o.empresaId]);
    const modelo = ms[0];
    if (!modelo) return { ok: false, motivo: 'Modelo de e-mail não encontrado.' };
    const conta = modelo.conta_id ? await this.linhaConta(modelo.conta_id).catch(() => undefined) : await this.contaPadrao();
    if (!conta || !conta.ativa) return { ok: false, motivo: 'Nenhuma conta de e-mail ativa (Conexões → E-mail).' };
    const { rows } = await this.q<{ email: string | null; nome: string | null }>('select email, nome from sintonia.contatos where empresa_id = $1 and telefone = $2', [this.o.empresaId, p.conversa.telefone]);
    const destino = rows[0]?.email?.trim().toLowerCase();
    if (!destino || !new RegExp(EMAIL_VALIDO).test(destino)) return { ok: false, motivo: 'A cliente não tem e-mail válido na ficha.' };
    const { rows: sup } = await this.q<{ motivo: string }>('select motivo from sintonia.email_supressoes where empresa_id = $1 and email = $2', [this.o.empresaId, destino]);
    if (sup[0]) return { ok: false, motivo: sup[0].motivo === 'descadastro' ? 'A cliente se descadastrou dos e-mails.' : 'Este e-mail deu erro permanente antes (bounce).' };
    const r = await this.q(
      `insert into sintonia.email_envios (empresa_id, token, modelo_id, conta_id, chave, email, nome, telefone, conversa_id, unidade, proxima_em, criado_em, variaveis)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12) on conflict do nothing`,
      [this.o.empresaId, novoToken(), modelo.id, conta.id, p.chave, destino, rows[0]?.nome || p.conversa.nome || null, p.conversa.telefone, p.conversa.id, p.conversa.unidade, this.agora(), p.variaveis ? JSON.stringify(p.variaveis) : null],
    );
    return { ok: true, detalhe: r.rowCount ? `E-mail "${modelo.nome}" na fila para ${destino}.` : `E-mail "${modelo.nome}" já estava na fila para ${destino}.` };
  }

  // ============================================================ fila de envio

  private inicioDoDia(): Date {
    const d = partesBahia(this.agora());
    return bahia(d.ano, d.mes, d.dia);
  }

  /** Uma volta do relógio: agendadas que venceram, reservas vencidas (processo caiu) e o lote de cada conta. */
  async tick(): Promise<{ enviados: number }> {
    if (this.rodando) return { enviados: 0 };
    this.rodando = true;
    try {
      const agora = this.agora();
      const { rows: vencidas } = await this.q("select id, publico, conta_id from sintonia.email_campanhas where empresa_id = $1 and estado = 'agendada' and agendada_para <= $2", [this.o.empresaId, agora]);
      for (const c of vencidas) {
        if (!c.conta_id) continue;
        await this.comecar(c.id, Publico.parse(c.publico ?? {}), c.conta_id).catch((e) => this.log('Falha ao começar campanha agendada', String(e)));
      }
      // Reserva vencida: o processo caiu no meio. Volta para a fila.
      await this.q("update sintonia.email_envios set estado = 'pendente', reservada_ate = null where empresa_id = $1 and estado = 'enviando' and reservada_ate < $2", [this.o.empresaId, agora]);

      let enviados = 0;
      const { rows: contas } = await this.q<LinhaConta>('select * from sintonia.email_contas where empresa_id = $1 and ativa', [this.o.empresaId]);
      for (const conta of contas) enviados += await this.loteDaConta(conta).catch((e) => (this.log('Falha no envio de e-mails', { conta: conta.id, erro: String(e) }), 0));
      await this.q(
        `update sintonia.email_campanhas c set estado = 'concluida', concluida_em = $2, atualizada_em = now()
          where c.empresa_id = $1 and c.estado = 'enviando' and not exists (select 1 from sintonia.email_envios e where e.campanha_id = c.id and e.estado in ('pendente', 'enviando'))`,
        [this.o.empresaId, agora],
      );
      return { enviados };
    } finally {
      this.rodando = false;
    }
  }

  /** Quantos esta conta ainda pode enviar agora (ritmo por minuto e limite do dia). */
  async folga(conta: Pick<LinhaConta, 'id' | 'por_minuto' | 'limite_diario'>): Promise<number> {
    const agora = this.agora();
    const { rows } = await this.q<{ minuto: string; dia: string }>(
      `select count(*) filter (where enviado_em > $2) as minuto, count(*) filter (where enviado_em >= $3) as dia
         from sintonia.email_envios where conta_id = $1 and enviado_em >= least($2, $3)`,
      [conta.id, new Date(agora.getTime() - 60_000), this.inicioDoDia()],
    );
    const r = rows[0]!;
    return Math.max(0, Math.min(conta.por_minuto - Number(r.minuto), conta.limite_diario - Number(r.dia)));
  }

  private async loteDaConta(conta: LinhaConta): Promise<number> {
    const folga = Math.min(await this.folga(conta), 50);
    if (folga <= 0) return 0;
    const agora = this.agora();
    const { rows } = await this.q<LinhaEnvio>(
      `update sintonia.email_envios set estado = 'enviando', reservada_ate = $3, tentativas = tentativas + 1
        where id in (
          select e.id from sintonia.email_envios e left join sintonia.email_campanhas c on c.id = e.campanha_id
           where e.conta_id = $1 and e.estado = 'pendente' and e.proxima_em <= $2 and (e.campanha_id is null or c.estado = 'enviando')
           order by e.id limit $4 for update of e skip locked)
        returning id, token, campanha_id, modelo_id, conta_id, email, nome, telefone, conversa_id, unidade, estado, tentativas, variaveis`,
      [conta.id, agora, new Date(agora.getTime() + RESERVA_MS), folga],
    );
    if (!rows.length) return 0;
    const transporte = this.o.transporte(this.envioDe(conta));
    const conteudos = new Map<string, { assunto: string; preheader: string; conteudo: Conteudo; base: string }>();
    let n = 0;
    for (const [i, e] of rows.entries()) {
      // Descadastrou (ou deu bounce em outra campanha) depois de entrar na fila: não envia.
      const { rows: sup } = await this.q('select 1 from sintonia.email_supressoes where empresa_id = $1 and email = $2', [this.o.empresaId, e.email]);
      if (sup.length) {
        await this.q("update sintonia.email_envios set estado = 'suprimido', reservada_ate = null where id = $1", [e.id]);
        continue;
      }
      const chave = e.campanha_id ? `c:${e.campanha_id}` : `m:${e.modelo_id}`;
      let fonte = conteudos.get(chave);
      if (!fonte) {
        const { rows: x } = e.campanha_id
          ? await this.q('select assunto, preheader, conteudo, base_url from sintonia.email_campanhas where id = $1', [e.campanha_id])
          : await this.q('select assunto, preheader, conteudo, null as base_url from sintonia.email_modelos where id = $1', [e.modelo_id]);
        if (!x[0]) {
          await this.q("update sintonia.email_envios set estado = 'cancelado', erro = 'Modelo/campanha apagado', reservada_ate = null where id = $1", [e.id]);
          continue;
        }
        fonte = { assunto: x[0].assunto, preheader: x[0].preheader, conteudo: Conteudo.parse(x[0].conteudo), base: (x[0].base_url || this.baseUrl()).replace(/\/+$/, '') };
        conteudos.set(chave, fonte);
      }
      const v: Variaveis = { nome: e.nome, email: e.email, unidade: nomeUnidade(e.unidade), extras: (e as { variaveis?: Record<string, string> | null }).variaveis ?? null };
      const base = fonte.base;
      const descadastro = `${base}/e/d/${e.token}`;
      const m = montarEmail(fonte.conteudo, {
        assunto: fonte.assunto,
        preheader: trocarVariaveis(fonte.preheader, v, false),
        descadastro,
        pixel: `${base}/e/a/${e.token}.gif`,
        rastrear: (idx) => `${base}/e/c/${e.token}/${idx}`,
      });
      const assunto = trocarVariaveis(fonte.assunto, v, false);
      const messageId = `<${e.token}@${dominio(conta.remetente_email)}>`;
      try {
        await transporte.enviar({
          de: { nome: conta.remetente_nome, email: conta.remetente_email },
          para: { email: e.email, nome: e.nome },
          responderPara: conta.responder_para,
          assunto,
          html: trocarVariaveis(m.html, v, true),
          texto: trocarVariaveis(m.texto, v, false),
          messageId,
          cabecalhos: { 'List-Unsubscribe': `<${descadastro}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Sintonia-Envio': e.token },
        });
        const em = this.agora();
        await this.q("update sintonia.email_envios set estado = 'enviado', enviado_em = $2, reservada_ate = null, assunto = $3, links = $4, message_id = $5, erro = null where id = $1", [
          e.id, em, assunto, m.links.map((l) => trocarVariaveis(l, v, false)), messageId,
        ]);
        await this.evento(e.id, 'enviado', assunto);
        n++;
      } catch (x) {
        const erro = x instanceof ErroEnvio ? x : new ErroEnvio(String((x as Error).message ?? x), false);
        if (erro.message.startsWith('Login recusado')) {
          // Problema da conta, não do destinatário: devolve este e os que sobraram do lote sem gastar tentativa.
          const ids = rows.slice(i).map((r) => r.id);
          await this.q("update sintonia.email_envios set estado = 'pendente', reservada_ate = null, tentativas = greatest(tentativas - 1, 0) where id = any($1::bigint[]) and estado = 'enviando'", [ids]);
          await this.q('update sintonia.email_contas set teste_erro = $2 where id = $1', [conta.id, erro.message.slice(0, 400)]);
          break;
        }
        await this.falhou(e, erro);
      }
    }
    return n;
  }

  private async falhou(e: LinhaEnvio, erro: ErroEnvio) {
    if (erro.permanente) {
      await this.q("update sintonia.email_envios set estado = 'bounce', reservada_ate = null, erro = $2 where id = $1", [e.id, erro.message.slice(0, 400)]);
      await this.suprimir(e.email, 'bounce', erro.message, Number(e.id));
      await this.evento(e.id, 'bounce', erro.message);
      return;
    }
    if (e.tentativas >= MAX_TENTATIVAS) {
      await this.q("update sintonia.email_envios set estado = 'erro', reservada_ate = null, erro = $2 where id = $1", [e.id, erro.message.slice(0, 400)]);
      await this.evento(e.id, 'erro', erro.message);
      return;
    }
    const espera = 2 ** e.tentativas * 60_000;
    await this.q("update sintonia.email_envios set estado = 'pendente', reservada_ate = null, proxima_em = $2, erro = $3 where id = $1", [e.id, new Date(this.agora().getTime() + espera), erro.message.slice(0, 400)]);
  }

  private async evento(envioId: string | number, tipo: string, detalhe?: string | null) {
    await this.q('insert into sintonia.email_eventos (empresa_id, envio_id, tipo, detalhe, em) values ($1,$2,$3,$4,$5)', [this.o.empresaId, envioId, tipo, detalhe?.slice(0, 500) ?? null, this.agora()]);
  }

  private async suprimir(emailDestino: string, motivo: 'descadastro' | 'bounce' | 'reclamacao' | 'manual', detalhe: string | null, envioId: number | null) {
    await this.q(
      `insert into sintonia.email_supressoes (empresa_id, email, motivo, detalhe, envio_id, em) values ($1, lower($2), $3, $4, $5, $6)
       on conflict (empresa_id, email) do update set motivo = case when sintonia.email_supressoes.motivo = 'descadastro' then 'descadastro' else excluded.motivo end`,
      [this.o.empresaId, emailDestino, motivo, detalhe?.slice(0, 400) ?? null, envioId, this.agora()],
    );
    await this.q("update sintonia.email_envios set estado = 'suprimido' where empresa_id = $1 and lower(email) = lower($2) and estado = 'pendente'", [this.o.empresaId, emailDestino]);
  }

  // ============================================================ rastreio (rotas públicas)

  async abriu(token: string): Promise<void> {
    if (!/^[0-9a-f]{48}$/.test(token)) return;
    const { rows } = await this.q<{ id: string; primeira: boolean }>(
      `update sintonia.email_envios e set aberturas = aberturas + 1, aberto_em = coalesce(aberto_em, $2)
         from (select id, aberto_em is null as primeira from sintonia.email_envios where token = $1 and enviado_em is not null for update) a
        where e.id = a.id returning e.id, a.primeira`,
      [token, this.agora()],
    );
    if (rows[0]?.primeira) await this.evento(rows[0].id, 'aberto');
  }

  /** Clique: devolve o endereço guardado no envio (nunca um vindo da URL: nada de redirecionamento aberto). */
  async clicou(token: string, indice: number): Promise<string | null> {
    if (!/^[0-9a-f]{48}$/.test(token) || !Number.isInteger(indice) || indice < 0 || indice > 500) return null;
    const { rows } = await this.q<{ id: string; url: string | null; primeiro: boolean }>(
      `update sintonia.email_envios e set cliques = cliques + 1, clicado_em = coalesce(clicado_em, $3), aberto_em = coalesce(aberto_em, $3)
         from (select id, links[$2::int + 1] as url, clicado_em is null as primeiro from sintonia.email_envios where token = $1 for update) a
        where e.id = a.id and a.url is not null returning e.id, a.url, a.primeiro`,
      [token, indice, this.agora()],
    );
    const r = rows[0];
    if (!r?.url) return null;
    await this.evento(r.id, 'clicado', r.url);
    return r.url;
  }

  /** Descadastro em um clique (link do rodapé ou List-Unsubscribe-Post). */
  async descadastrar(token: string): Promise<{ ok: boolean; email?: string }> {
    if (!/^[0-9a-f]{48}$/.test(token)) return { ok: false };
    const { rows } = await this.q<{ id: string; email: string; descadastro_em: Date | null }>('select id, email, descadastro_em from sintonia.email_envios where token = $1', [token]);
    const e = rows[0];
    if (!e) return { ok: false };
    if (!e.descadastro_em) {
      await this.q('update sintonia.email_envios set descadastro_em = $2 where id = $1', [e.id, this.agora()]);
      await this.suprimir(e.email, 'descadastro', 'Pelo link do e-mail', Number(e.id));
      await this.evento(e.id, 'descadastro');
    }
    return { ok: true, email: mascarar(e.email) };
  }

  // ============================================================ respostas e bounces (IMAP)

  /** Lê uma mensagem que chegou na caixa (resposta da cliente ou aviso de erro de entrega). */
  async processarRecebido(fonte: Buffer | string): Promise<'bounce' | 'resposta' | 'ignorado'> {
    const { simpleParser } = await import('mailparser');
    const m = await simpleParser(fonte);
    const bruto = typeof fonte === 'string' ? fonte : fonte.toString('utf8');
    const de = (m.from?.value?.[0]?.address ?? '').toLowerCase();
    const assunto = m.subject ?? '';
    const tipo = String(m.headers.get('content-type') && (m.headers.get('content-type') as { value?: string }).value || '');
    const ehBounce = /mailer-daemon|postmaster/.test(de) || /report/i.test(tipo) && /delivery-status/i.test(bruto) || /undeliver|delivery status notification|failure notice|returned mail|não (foi )?entregue|mail delivery failed/i.test(assunto);
    const tokens = [...bruto.matchAll(/(?:X-Sintonia-Envio:\s*|<)([0-9a-f]{48})(?:@|\s|$)/gi)].map((x) => x[1]!.toLowerCase());
    if (ehBounce) {
      const temporario = /Status:\s*4\.\d+\.\d+/i.test(bruto) && !/Status:\s*5\.\d+\.\d+/i.test(bruto);
      if (temporario) return 'ignorado';
      let envio: { id: string; email: string } | undefined;
      if (tokens.length) envio = (await this.q<{ id: string; email: string }>('select id, email from sintonia.email_envios where token = any($1::text[]) and empresa_id = $2 limit 1', [tokens, this.o.empresaId])).rows[0];
      if (!envio) {
        const destino = /(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s>]+@[^\s>]+)>?/i.exec(bruto)?.[1] ?? /X-Failed-Recipients:\s*([^\s,]+@[^\s,]+)/i.exec(bruto)?.[1];
        if (destino) envio = (await this.q<{ id: string; email: string }>('select id, email from sintonia.email_envios where empresa_id = $1 and lower(email) = lower($2) and enviado_em is not null order by enviado_em desc limit 1', [this.o.empresaId, destino])).rows[0];
      }
      if (!envio) return 'ignorado';
      const motivo = (/Diagnostic-Code:\s*(.+)/i.exec(bruto)?.[1] ?? assunto).trim().slice(0, 300);
      await this.q("update sintonia.email_envios set estado = 'bounce', erro = $2 where id = $1", [envio.id, motivo]);
      await this.suprimir(envio.email, 'bounce', motivo, Number(envio.id));
      await this.evento(envio.id, 'bounce', motivo);
      return 'bounce';
    }
    const auto = String(m.headers.get('auto-submitted') ?? '').toLowerCase();
    if (auto && auto !== 'no') return 'ignorado';
    const refs = [m.inReplyTo ?? '', ...(Array.isArray(m.references) ? m.references : m.references ? [m.references] : [])].join(' ');
    const token = /<?([0-9a-f]{48})@/i.exec(refs)?.[1]?.toLowerCase();
    if (!token) return 'ignorado';
    const { rows } = await this.q<{ id: string; respondido_em: Date | null }>('select id, respondido_em from sintonia.email_envios where token = $1 and empresa_id = $2', [token, this.o.empresaId]);
    const e = rows[0];
    if (!e) return 'ignorado';
    await this.q('update sintonia.email_envios set respondido_em = coalesce(respondido_em, $2) where id = $1', [e.id, this.agora()]);
    const trecho = (m.text ?? '').split(/\n\s*(?:Em .+escreveu:|On .+wrote:|-----)/)[0]!.trim().slice(0, 400);
    await this.evento(e.id, 'respondeu', trecho || assunto);
    return 'resposta';
  }

  /** Lê a caixa de entrada das contas com IMAP ligado (respostas e bounces). */
  async lerCaixas(): Promise<{ lidas: number }> {
    const { rows } = await this.q<LinhaConta>('select * from sintonia.email_contas where empresa_id = $1 and ativa and imap_ligado and imap_host is not null', [this.o.empresaId]);
    let lidas = 0;
    for (const c of rows) {
      try {
        const ler = this.o.lerImap ?? lerImapReal;
        const r = await ler({ host: c.imap_host!, porta: c.imap_porta ?? 993, usuario: c.usuario ?? c.remetente_email, senha: this.decifrar(c.senha_cifrada) ?? '', ultimoUid: Number(c.imap_ultimo_uid) });
        for (const msg of r.mensagens) {
          await this.processarRecebido(msg.fonte).catch((e) => this.log('Falha ao ler e-mail recebido', String(e)));
          lidas++;
        }
        await this.q('update sintonia.email_contas set imap_ultimo_uid = $2, imap_lido_em = $3, imap_erro = null where id = $1', [c.id, r.ultimoUid, this.agora()]);
      } catch (e) {
        await this.q('update sintonia.email_contas set imap_erro = $2, imap_lido_em = $3 where id = $1', [c.id, String((e as Error).message ?? e).slice(0, 300), this.agora()]);
      }
    }
    return { lidas };
  }

  // ============================================================ relatórios e histórico

  async relatorio(id: string) {
    const c = await this.campanha(id);
    const { rows } = await this.q(
      `select count(*)::int as total,
              count(*) filter (where estado = 'pendente' or estado = 'enviando')::int as na_fila,
              count(*) filter (where enviado_em is not null)::int as enviados,
              count(*) filter (where aberto_em is not null)::int as abertos,
              count(*) filter (where clicado_em is not null)::int as clicados,
              count(*) filter (where respondido_em is not null)::int as responderam,
              count(*) filter (where descadastro_em is not null)::int as descadastros,
              count(*) filter (where estado = 'bounce')::int as bounces,
              count(*) filter (where estado = 'erro')::int as erros,
              count(*) filter (where estado in ('suprimido', 'cancelado'))::int as pulados
         from sintonia.email_envios where campanha_id = $1`,
      [id],
    );
    const { rows: links } = await this.q(
      `select ev.detalhe as url, count(*)::int as cliques, count(distinct ev.envio_id)::int as pessoas from sintonia.email_eventos ev join sintonia.email_envios e on e.id = ev.envio_id
        where e.campanha_id = $1 and ev.tipo = 'clicado' group by ev.detalhe order by cliques desc limit 10`,
      [id],
    );
    const { rows: ultimos } = await this.q(
      `select email, nome, estado, enviado_em, aberto_em, clicado_em, respondido_em, descadastro_em, erro from sintonia.email_envios where campanha_id = $1
        order by greatest(coalesce(clicado_em, 'epoch'), coalesce(aberto_em, 'epoch'), coalesce(enviado_em, 'epoch')) desc, id limit 60`,
      [id],
    );
    const conta = c.contaId ? await this.linhaConta(c.contaId).catch(() => undefined) : undefined;
    return { campanha: c, funil: rows[0], links, destinatarios: ultimos.map((u) => ({ ...u, email: u.email })), ritmo: conta ? { porMinuto: conta.por_minuto, limiteDiario: conta.limite_diario } : null };
  }

  async resumo() {
    const { rows } = await this.q(
      `select count(*) filter (where enviado_em >= $2)::int as enviados30, count(*) filter (where aberto_em is not null and enviado_em >= $2)::int as abertos30,
              count(*) filter (where clicado_em is not null and enviado_em >= $2)::int as clicados30,
              (select count(*)::int from sintonia.email_supressoes s where s.empresa_id = $1 and motivo = 'descadastro') as descadastrados,
              (select count(*)::int from sintonia.email_supressoes s where s.empresa_id = $1 and motivo = 'bounce') as bounces,
              (select count(*)::int from sintonia.contatos ct where ct.empresa_id = $1 and ct.email ~* $3) as contatos_com_email
         from sintonia.email_envios where empresa_id = $1`,
      [this.o.empresaId, new Date(this.agora().getTime() - 30 * 86400_000), EMAIL_VALIDO],
    );
    return rows[0];
  }

  /** Histórico de e-mails da cliente (ficha). */
  async historico(f: { telefone?: string; email?: string }) {
    if (!f.telefone && !f.email) return [];
    const { rows } = await this.q(
      `select e.id, e.email, e.assunto, e.estado, e.enviado_em, e.aberto_em, e.clicado_em, e.respondido_em, e.descadastro_em, e.erro, e.criado_em,
              coalesce(c.nome, m.nome) as origem, case when e.campanha_id is not null then 'campanha' else 'automacao' end as tipo,
              (select json_agg(json_build_object('tipo', ev.tipo, 'detalhe', ev.detalhe, 'em', ev.em) order by ev.em) from sintonia.email_eventos ev where ev.envio_id = e.id and ev.tipo in ('respondeu', 'bounce', 'descadastro', 'clicado')) as eventos
         from sintonia.email_envios e
         left join sintonia.email_campanhas c on c.id = e.campanha_id
         left join sintonia.email_modelos m on m.id = e.modelo_id
        where e.empresa_id = $1 and (($2::text is not null and e.telefone = $2) or ($3::text is not null and lower(e.email) = lower($3)))
        order by e.criado_em desc limit 50`,
      [this.o.empresaId, f.telefone ?? null, f.email ?? null],
    );
    const emailFicha = f.email ?? (f.telefone ? (await this.q<{ email: string | null }>('select email from sintonia.contatos where empresa_id = $1 and telefone = $2', [this.o.empresaId, f.telefone])).rows[0]?.email : undefined);
    const sup = emailFicha ? (await this.q('select motivo, em from sintonia.email_supressoes where empresa_id = $1 and email = lower($2)', [this.o.empresaId, emailFicha])).rows[0] : undefined;
    return { email: emailFicha ?? null, bloqueio: sup ?? null, envios: rows };
  }

  async supressoes() {
    const { rows } = await this.q('select email, motivo, detalhe, em from sintonia.email_supressoes where empresa_id = $1 order by em desc limit 500', [this.o.empresaId]);
    return rows;
  }
  async liberar(emailAlvo: string) {
    await this.q('delete from sintonia.email_supressoes where empresa_id = $1 and email = lower($2)', [this.o.empresaId, emailAlvo]);
  }
}

export function dominio(e: string): string {
  return e.split('@')[1]?.toLowerCase() || 'sintonia.local';
}

/** "ma***@gmail.com": a página pública de descadastro não mostra o e-mail inteiro. */
export function mascarar(e: string): string {
  const [u = '', d = ''] = e.split('@');
  return `${u.slice(0, 2)}***@${d}`;
}

/** IMAP de verdade (imapflow): só as mensagens novas desde o último UID. */
async function lerImapReal(c: { host: string; porta: number; usuario: string; senha: string; ultimoUid: number }) {
  const { ImapFlow } = await import('imapflow');
  const cliente = new ImapFlow({ host: c.host, port: c.porta, secure: c.porta === 993, auth: { user: c.usuario, pass: c.senha }, logger: false });
  await cliente.connect();
  const mensagens: Array<{ uid: number; fonte: Buffer }> = [];
  let ultimoUid = c.ultimoUid;
  try {
    const trava = await cliente.getMailboxLock('INBOX');
    try {
      const caixa = cliente.mailbox;
      const proximo = caixa && typeof caixa === 'object' ? Number(caixa.uidNext ?? 1) : 1;
      // Primeira leitura: começa de agora (não reprocessa a caixa inteira).
      if (!ultimoUid) return { mensagens, ultimoUid: Math.max(0, proximo - 1) };
      if (proximo - 1 <= ultimoUid) return { mensagens, ultimoUid };
      for await (const msg of cliente.fetch(`${ultimoUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= ultimoUid || !msg.source) continue;
        mensagens.push({ uid: msg.uid, fonte: msg.source });
        ultimoUid = Math.max(ultimoUid, msg.uid);
        if (mensagens.length >= 200) break;
      }
    } finally {
      trava.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }
  return { mensagens, ultimoUid };
}

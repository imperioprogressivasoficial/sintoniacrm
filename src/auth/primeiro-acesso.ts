import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { apareceNaEquipe } from './acesso.js';
import type { Acessos } from './acessos.js';
import { ContasPostgres, PAPEIS, type Contas, type Papel, type Usuario, type UsuarioComSenha } from './contas.js';
import { gerarHash, senhaFraca } from './senha.js';
import { linkWhatsApp } from './usuarios-rotas.js';
import { Janela } from '../seguranca/protecao.js';
import { existeUnidade, FORMATO_ID_UNIDADE } from '../unidades.js';

/**
 * primeiro-acesso: UM link para a equipe toda (/primeiro-acesso). A pessoa digita o e-mail, cria a senha e entra.
 *
 * - Só vale para conta ativa que nasceu sem senha (convite ou semente SINTONIA_EQUIPE_INICIAL) e nunca entrou.
 * - A chave "Primeiro acesso pelo link" (por empresa, no banco) começa DESLIGADA. Só a administração e a direção
 *   ligam; ligada, fecha sozinha depois de 14 dias.
 * - E-mail que não existe, que já tem senha ou conta desativada: sempre a mesma resposta neutra (não revela quem
 *   tem conta). A chave desligada vale para todo mundo, então dizer "ainda não foi liberado" não revela nada.
 * - Limite de tentativas por endereço e por e-mail; tudo vai para a auditoria dos acessos.
 *
 * Também aqui: a semente da equipe (SINTONIA_EQUIPE_INICIAL), que cria quem ainda não existe sem nunca mexer em
 * quem já existe.
 */

export const DIAS_PRIMEIRO_ACESSO = 14;
export const MSG_NEUTRA =
  'Não encontramos um primeiro acesso liberado para este e-mail. Se você já criou a sua senha, é só entrar. Se esqueceu, crie uma nova.';
export const MSG_FECHADO = 'O acesso da equipe ainda não foi liberado. Aguarde o aviso da gestão e tente de novo.';
export const MSG_ENCERRADO = 'O prazo do primeiro acesso pelo link terminou. Peça à gestão para liberar de novo.';
const MSG_LIMITE = 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';

// ---------------------------------------------------------------- chave por empresa

export interface EstadoChave {
  ligadoAte: Date | null;
  ligadoEm: Date | null;
  ligadoPor: string | null;
}

export interface ArmazemPrimeiroAcesso {
  ler(empresaId: string): Promise<EstadoChave>;
  gravar(empresaId: string, e: EstadoChave): Promise<void>;
}

const desligada = (): EstadoChave => ({ ligadoAte: null, ligadoEm: null, ligadoPor: null });

export class ArmazemPrimeiroAcessoMemoria implements ArmazemPrimeiroAcesso {
  private m = new Map<string, EstadoChave>();
  async ler(empresaId: string) {
    return { ...(this.m.get(empresaId) ?? desligada()) };
  }
  async gravar(empresaId: string, e: EstadoChave) {
    this.m.set(empresaId, { ...e });
  }
}

export class ArmazemPrimeiroAcessoPostgres implements ArmazemPrimeiroAcesso {
  constructor(private readonly pool: pg.Pool) {}
  async ler(empresaId: string) {
    const { rows } = await this.pool.query<{ ligado_ate: Date | null; ligado_em: Date | null; ligado_por: string | null }>(
      'select ligado_ate, ligado_em, ligado_por from sintonia.primeiro_acesso where empresa_id = $1',
      [empresaId],
    );
    const r = rows[0];
    return r ? { ligadoAte: r.ligado_ate, ligadoEm: r.ligado_em, ligadoPor: r.ligado_por } : desligada();
  }
  async gravar(empresaId: string, e: EstadoChave) {
    await this.pool.query(
      `insert into sintonia.primeiro_acesso (empresa_id, ligado_ate, ligado_em, ligado_por) values ($1, $2, $3, $4)
       on conflict (empresa_id) do update set ligado_ate = excluded.ligado_ate, ligado_em = excluded.ligado_em, ligado_por = excluded.ligado_por`,
      [empresaId, e.ligadoAte, e.ligadoEm, e.ligadoPor],
    );
  }
}

/** Escolhe o armazém pelo tipo das contas (como acessosPara). */
export function armazemPrimeiroAcessoPara(contas: Contas): ArmazemPrimeiroAcesso {
  return contas instanceof ContasPostgres ? new ArmazemPrimeiroAcessoPostgres(contas.pool) : new ArmazemPrimeiroAcessoMemoria();
}

/** Situação da chave agora: ligada (até quando), desligada ou encerrada (passou dos 14 dias). */
export function situacaoDaChave(e: EstadoChave, agora: Date): 'ligada' | 'desligada' | 'encerrada' {
  if (!e.ligadoAte) return 'desligada';
  return e.ligadoAte.getTime() > agora.getTime() ? 'ligada' : 'encerrada';
}

/** Pode usar o primeiro acesso: conta ativa, sem senha própria e que nunca entrou. */
export const podeUsarPrimeiroAcesso = (u: UsuarioComSenha | undefined, ultimoAcesso: Date | null | undefined): u is UsuarioComSenha =>
  Boolean(u && u.ativo && u.semSenha && !ultimoAcesso);

// ---------------------------------------------------------------- semente da equipe (SINTONIA_EQUIPE_INICIAL)

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** "Administração", "admin", "Direção", "Atendente"… → id do papel. */
const NOMES_PAPEL: Record<string, Papel> = {
  admin: 'admin',
  administracao: 'admin',
  administrador: 'admin',
  administradora: 'admin',
  direcao: 'direcao',
  diretor: 'direcao',
  diretora: 'direcao',
  gerente: 'gerente',
  atendente: 'atendente',
  recepcionista: 'recepcionista',
  recepcao: 'recepcionista',
};

export const ItemEquipe = z.object({
  nome: z.string().trim().min(2, 'nome curto demais').max(120),
  email: z.string().trim().toLowerCase().email('e-mail inválido').max(200),
  papel: z
    .string()
    .transform((p) => NOMES_PAPEL[semAcento(p)] ?? semAcento(p))
    .pipe(z.enum(PAPEIS, { message: `papel inválido (use ${PAPEIS.join(', ')})` })),
  unidades: z
    .array(z.string().trim().toLowerCase().regex(FORMATO_ID_UNIDADE, 'unidade inválida'))
    .max(50)
    .default([])
    .transform((l) => [...new Set(l)]),
});
export type ItemEquipe = z.infer<typeof ItemEquipe>;

export interface ResultadoSemente {
  criados: string[];
  existentes: string[];
  invalidos: number;
}

/**
 * Cria quem da lista ainda não existe (pelo e-mail), sem senha (como convidado). Quem já existe NUNCA é alterado.
 * Itens inválidos são ignorados com aviso no log (o log nunca mostra o e-mail inteiro).
 */
export async function semearEquipe(o: {
  contas: Contas;
  acessos?: Acessos;
  empresaId: string;
  bruto: string | undefined;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}): Promise<ResultadoSemente> {
  const log = o.log ?? (() => undefined);
  const r: ResultadoSemente = { criados: [], existentes: [], invalidos: 0 };
  const texto = (o.bruto ?? '').trim();
  if (!texto) return r;
  let lista: unknown;
  try {
    lista = JSON.parse(texto);
  } catch {
    log('SINTONIA_EQUIPE_INICIAL ignorada: não é um JSON válido.');
    return r;
  }
  if (!Array.isArray(lista)) {
    log('SINTONIA_EQUIPE_INICIAL ignorada: precisa ser uma lista [ {nome, email, papel, unidades} ].');
    return r;
  }
  const disfarce = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');
  for (const [i, bruto] of lista.slice(0, 500).entries()) {
    const v = ItemEquipe.safeParse(bruto);
    if (!v.success) {
      r.invalidos++;
      log(`SINTONIA_EQUIPE_INICIAL: item ${i + 1} ignorado (${v.error.issues.map((x) => `${x.path.join('.') || 'item'}: ${x.message}`).join('; ')}).`);
      continue;
    }
    const p = v.data;
    if (await o.contas.buscarPorEmail(p.email)) {
      r.existentes.push(p.email);
      continue;
    }
    const fora = p.unidades.filter((u) => !existeUnidade(u, o.empresaId));
    if (fora.length) log(`SINTONIA_EQUIPE_INICIAL: item ${i + 1} tem unidade fora do cadastro (${fora.join(', ')}); confira em Empresa › Unidades.`);
    try {
      const u = await o.contas.criarUsuario({
        empresaId: o.empresaId,
        nome: p.nome,
        email: p.email,
        papel: p.papel,
        unidades: p.unidades,
        // Senha aleatória que ninguém sabe, até a pessoa criar a dela (primeiro acesso ou convite).
        senhaHash: await gerarHash(randomBytes(24).toString('base64url')),
        semSenha: true,
      });
      r.criados.push(u.email);
      await o.acessos
        ?.auditar({ empresaId: o.empresaId, autorId: null, autorNome: 'Sistema', alvoId: u.id, alvoNome: u.nome, acao: 'cadastrou pela equipe inicial', detalhe: p.papel, em: (o.agora ?? (() => new Date()))() })
        .catch(() => undefined);
    } catch (e) {
      if (/Já existe/.test((e as Error).message)) r.existentes.push(p.email);
      else log(`SINTONIA_EQUIPE_INICIAL: não deu para criar ${disfarce(p.email)}`, String(e));
    }
  }
  if (r.criados.length || r.invalidos) log(`Equipe inicial: ${r.criados.length} pessoa(s) criada(s), ${r.existentes.length} já existia(m), ${r.invalidos} item(ns) ignorado(s).`);
  return r;
}

// ---------------------------------------------------------------- rotas

export interface OpcoesPrimeiroAcesso {
  contas: Contas;
  acessos: Acessos;
  armazem: ArmazemPrimeiroAcesso;
  agora: () => Date;
  /** Empresa atendida por este servidor (a página pública não sabe de qual empresa é). */
  empresaPadrao: string;
  /** Abre a sessão e põe o cookie (o mesmo do /api/auth/entrar). */
  abrirSessao: (req: FastifyRequest, reply: FastifyReply, u: Usuario) => Promise<void>;
  /** Libera a conta bloqueada por tentativas (como a senha nova pelo link). */
  aoDefinirSenha?: (u: Usuario) => void;
  linkBase: (req: FastifyRequest) => string;
  invalidar: () => void;
}

const erro = (statusCode: number, mensagem: string) => Object.assign(new Error(mensagem), { statusCode });
const podeLigar = (u: Pick<Usuario, 'papel'>) => u.papel === 'admin' || u.papel === 'direcao';
const dataCurta = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).format(d).replace(',', ' às');

/** Texto pronto para mandar no grupo da equipe. */
export function textoPrimeiroAcesso(link: string, ate: Date | null): string {
  return `Oi, equipe! O Sintonia está pronto para vocês. Abram este link, digitem o seu e-mail e criem a sua senha${ate ? ` (vale até ${dataCurta(ate)})` : ''}:\n${link}`;
}

export function registrarPrimeiroAcesso(app: FastifyInstance, o: OpcoesPrimeiroAcesso): void {
  const { contas, acessos, armazem } = o;
  // Por endereço: as duas etapas somam (uma pessoa usa 2). Por e-mail: segura quem tenta adivinhar a vez de alguém.
  const porIp = new Janela(20, 15 * 60_000);
  const porEmail = new Janela(6, 15 * 60_000);
  const hashFicticio = gerarHash('primeiro-acesso-ninguem-usa-0');
  /** Conta a tentativa; devolve a resposta 429 pronta se passou do limite. */
  const limite = (req: FastifyRequest, reply: FastifyReply, email: string) => {
    const t = o.agora().getTime();
    const e1 = porIp.usar(`ip|${req.ip}`, t);
    const espera = e1 ?? porEmail.usar(email, t);
    return espera === null ? null : reply.code(429).header('retry-after', String(espera)).send({ erro: MSG_LIMITE, esperaSeg: espera });
  };
  const situacao = async (empresaId: string) => situacaoDaChave(await armazem.ler(empresaId), o.agora());
  const respostaFechada = (s: 'desligada' | 'encerrada') => ({ ok: false, fechado: true, motivo: s, mensagem: s === 'encerrada' ? MSG_ENCERRADO : MSG_FECHADO });
  /** Pessoa que pode usar o primeiro acesso agora (ou undefined, sem dizer por quê). */
  const elegivel = async (email: string): Promise<UsuarioComSenha | undefined> => {
    const u = await contas.buscarPorEmail(email);
    if (!u || !u.ativo || !u.semSenha) return undefined;
    if ((await situacao(u.empresaId)) !== 'ligada') return undefined;
    const ex = await acessos.extras(u.id);
    return podeUsarPrimeiroAcesso(u, ex.ultimoAcesso) ? u : undefined;
  };
  const Email = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

  // ---- público
  app.get('/api/auth/primeiro-acesso', async () => {
    const e = await armazem.ler(o.empresaPadrao);
    const s = situacaoDaChave(e, o.agora());
    return { liberado: s === 'ligada', motivo: s, ate: s === 'ligada' ? e.ligadoAte!.toISOString() : null, mensagem: s === 'ligada' ? null : s === 'encerrada' ? MSG_ENCERRADO : MSG_FECHADO };
  });

  app.post('/api/auth/primeiro-acesso/email', async (req, reply) => {
    const b = Email.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Digite um e-mail válido.' });
    const barrado = limite(req, reply, b.data.email);
    if (barrado) return barrado;
    const s = await situacao(o.empresaPadrao);
    if (s !== 'ligada') return respostaFechada(s);
    const u = await elegivel(b.data.email);
    if (!u) return { ok: false, mensagem: MSG_NEUTRA };
    return { ok: true, nome: u.nome.trim().split(/\s+/)[0] || u.nome };
  });

  const Criar = z.object({ email: z.string().trim().toLowerCase().email().max(200), senha: z.string().max(200) });
  app.post('/api/auth/primeiro-acesso', async (req, reply) => {
    const b = Criar.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Digite o e-mail e a senha.' });
    const barrado = limite(req, reply, b.data.email);
    if (barrado) return barrado;
    const fraca = senhaFraca(b.data.senha);
    if (fraca) return reply.code(400).send({ erro: fraca });
    const s = await situacao(o.empresaPadrao);
    if (s !== 'ligada') return respostaFechada(s);
    const u = await elegivel(b.data.email);
    if (!u) {
      await hashFicticio; // a resposta neutra não sai mais rápido que a de verdade
      await gerarHash(b.data.senha);
      return { ok: false, mensagem: MSG_NEUTRA };
    }
    await contas.definirSenha(u.id, await gerarHash(b.data.senha));
    o.aoDefinirSenha?.(u);
    await contas.encerrarSessoesDe(u.id);
    await acessos.salvarExtras(u.id, { trocarSenha: false });
    o.invalidar();
    await acessos.auditar({ empresaId: u.empresaId, autorId: u.id, autorNome: u.nome, alvoId: u.id, alvoNome: u.nome, acao: 'criou a senha pelo primeiro acesso', em: o.agora() });
    const { senhaHash: _, semSenha: _s, ...publico } = u;
    await o.abrirSessao(req, reply, publico);
    return { ok: true, nome: u.nome };
  });

  // ---- gestão (Usuários e acessos)
  const gestor = (req: FastifyRequest): Usuario => {
    const u = req.usuario;
    if (!u) throw erro(401, 'Faça login para continuar.');
    if (!req.permissoes?.equipe) throw erro(403, 'Você não cuida da equipe. Fale com a gestão.');
    return u;
  };
  const resumo = async (req: FastifyRequest, g: Usuario) => {
    const e = await armazem.ler(g.empresaId);
    const s = situacaoDaChave(e, o.agora());
    const link = `${o.linkBase(req)}/primeiro-acesso`;
    const todos = (await contas.listarUsuarios(g.empresaId)).filter((u) => u.ativo && apareceNaEquipe(g, u));
    const faltam: Array<{ id: string; nome: string; email: string; papel: Papel; unidades: string[]; podeUsar: boolean }> = [];
    for (const u of todos) {
      const ex = await acessos.extras(u.id);
      if (ex.ultimoAcesso) continue;
      const c = await contas.buscarPorId(u.id);
      faltam.push({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, unidades: u.unidades, podeUsar: Boolean(c?.semSenha) });
    }
    const ate = s === 'ligada' ? e.ligadoAte : null;
    const texto = textoPrimeiroAcesso(link, ate);
    return {
      situacao: s,
      ligado: s === 'ligada',
      ate: ate?.toISOString() ?? null,
      ligadoEm: e.ligadoEm?.toISOString() ?? null,
      ligadoPor: e.ligadoPor,
      dias: DIAS_PRIMEIRO_ACESSO,
      podeMudar: podeLigar(g),
      link,
      texto,
      whatsapp: linkWhatsApp('', texto),
      faltam,
    };
  };

  app.get('/api/acessos/primeiro-acesso', async (req) => resumo(req, gestor(req)));

  app.put('/api/acessos/primeiro-acesso', async (req) => {
    const g = gestor(req);
    if (!podeLigar(g)) throw erro(403, 'Só a direção e a administração liberam o primeiro acesso.');
    const b = z.object({ ligado: z.boolean() }).safeParse(req.body);
    if (!b.success) throw erro(400, 'Diga se liga ou desliga.');
    const agora = o.agora();
    if (b.data.ligado) {
      const ate = new Date(agora.getTime() + DIAS_PRIMEIRO_ACESSO * 86_400_000);
      await armazem.gravar(g.empresaId, { ligadoAte: ate, ligadoEm: agora, ligadoPor: g.nome });
      await acessos.auditar({ empresaId: g.empresaId, autorId: g.id, autorNome: g.nome, acao: 'ligou o primeiro acesso pelo link', detalhe: `vale até ${dataCurta(ate)}`, em: agora });
    } else {
      const antes = await armazem.ler(g.empresaId);
      await armazem.gravar(g.empresaId, { ligadoAte: null, ligadoEm: antes.ligadoEm, ligadoPor: antes.ligadoPor });
      await acessos.auditar({ empresaId: g.empresaId, autorId: g.id, autorNome: g.nome, acao: 'desligou o primeiro acesso pelo link', em: agora });
    }
    return resumo(req, g);
  });
}

/** Rotas públicas do primeiro acesso (entram na lista das que não pedem login). */
export const ROTAS_PUBLICAS_PRIMEIRO_ACESSO = ['/api/auth/primeiro-acesso', '/api/auth/primeiro-acesso/email'] as const;

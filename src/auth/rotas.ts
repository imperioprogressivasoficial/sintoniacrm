import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Contas, Usuario } from './contas.js';
import { acessosPara, type Acessos } from './acessos.js';
import { registrarEquipe } from './equipe.js';
import { comNivel, dentroDoHorario, permissaoDaRota, resolver, type Permissoes } from './permissoes.js';
import { registrarUsuarios } from './usuarios-rotas.js';
import { conferirSenha, gerarHash, senhaFraca } from './senha.js';

export const COOKIE = 'sintonia_sessao';

export interface OpcoesAuth {
  contas: Contas;
  /** Cookie só por HTTPS (ligar em produção). */
  cookieSeguro?: boolean;
  duracaoHoras?: number;
  agora?: () => Date;
  /** Permissões, convites, sessões e auditoria (padrão: escolhido pelo tipo de `contas`). */
  acessos?: Acessos;
}

/** Rotas da API que não pedem login. */
const PUBLICAS = new Set(['/api/auth/entrar', '/api/auth/sair', '/api/contato', '/api/auth/convite']);
/** O que quem precisa trocar a senha (ou está fora do horário) ainda pode chamar. */
const SEMPRE = new Set(['/api/auth/eu', '/api/auth/senha', '/api/auth/sair']);

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: Usuario;
  }
}

export function lerCookie(req: FastifyRequest, nome: string): string | undefined {
  const bruto = req.headers.cookie;
  if (!bruto) return undefined;
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return undefined;
}

/** Limite simples de tentativas: protege contra quem tenta adivinhar senha. */
class Limite {
  private tentativas = new Map<string, number[]>();
  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
  ) {}
  excedeu(chave: string, agora: number): boolean {
    const l = (this.tentativas.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    this.tentativas.set(chave, l);
    return l.length >= this.maximo;
  }
  registrar(chave: string, agora: number) {
    const l = this.tentativas.get(chave) ?? [];
    l.push(agora);
    this.tentativas.set(chave, l);
  }
  limpar(chave: string) {
    this.tentativas.delete(chave);
  }
}

export async function usuarioDaRequisicao(req: FastifyRequest, o: OpcoesAuth): Promise<Usuario | undefined> {
  const token = lerCookie(req, COOKIE);
  if (!token) return undefined;
  return o.contas.usuarioDaSessao(token, (o.agora ?? (() => new Date()))());
}

export function registrarAuth(app: FastifyInstance, o: OpcoesAuth): void {
  const agora = o.agora ?? (() => new Date());
  const horas = o.duracaoHoras ?? 12;
  const errosLogin = new Limite(5, 15 * 60_000);
  const contatos = new Limite(5, 60 * 60_000);
  // Usado quando o e-mail não existe, para a resposta demorar o mesmo (não revela quem tem conta).
  const hashFicticio = gerarHash('senha-que-ninguem-usa-0');

  const cookie = (valor: string, maxAge: number) =>
    `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${o.cookieSeguro ? '; Secure' : ''}`;

  const acessos = o.acessos ?? acessosPara(o.contas);
  // Permissões resolvidas por pessoa, guardadas por alguns segundos (qualquer mudança limpa tudo).
  const cache = new Map<string, { ate: number; perms: Permissoes; trocarSenha: boolean; horario: import('./permissoes.js').Horario | null }>();
  const usoSessao = new Map<string, number>();
  const invalidar = () => cache.clear();
  const resolverDe = async (u: Usuario) => {
    const t = Date.now();
    const c = cache.get(u.id);
    if (c && c.ate > t && c.perms) return c;
    if (!acessos) return { ate: 0, perms: resolver(u.papel), trocarSenha: false, horario: null };
    const [perfis, extras] = await Promise.all([acessos.perfis(u.empresaId), acessos.extras(u.id)]);
    const r = { ate: t + 3000, perms: resolver(u.papel, perfis[u.papel], extras.ajustes), trocarSenha: extras.trocarSenha, horario: extras.horario };
    cache.set(u.id, r);
    return r;
  };

  // Toda a API pede login, menos as rotas públicas.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const caminho = req.url.split('?')[0]!;
    if (!caminho.startsWith('/api/') || PUBLICAS.has(caminho)) return;
    const u = await usuarioDaRequisicao(req, o);
    if (!u) return reply.code(401).send({ erro: 'Faça login para continuar.' });
    const r = await resolverDe(u);
    req.usuario = comNivel(u, r.perms);
    req.permissoes = r.perms;
    const token = lerCookie(req, COOKIE)!;
    const t = agora();
    if (acessos && (usoSessao.get(token) ?? 0) < t.getTime() - 60_000) {
      usoSessao.set(token, t.getTime());
      if (usoSessao.size > 5000) usoSessao.clear();
      await acessos.marcarSessao(token, { em: t, ip: req.ip }).catch(() => undefined);
    }
    if (SEMPRE.has(caminho)) return;
    if (!dentroDoHorario(r.horario, t)) {
      return reply.code(403).send({ erro: 'Seu acesso está liberado só no seu horário de trabalho.', foraDoHorario: true });
    }
    if (r.trocarSenha) return reply.code(403).send({ erro: 'Troque sua senha para continuar.', trocarSenha: true });
    const p = permissaoDaRota(req.method, caminho);
    if (p && !r.perms[p]) return reply.code(403).send({ erro: 'Você não tem permissão para isso. Fale com a gestão.' });
  });

  const Entrar = z.object({ email: z.string().trim().email().max(200), senha: z.string().min(1).max(200) });
  app.post('/api/auth/entrar', async (req, reply) => {
    const b = Entrar.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Informe e-mail e senha.' });
    const chave = `${req.ip}|${b.data.email.toLowerCase()}`;
    const t = agora().getTime();
    if (errosLogin.excedeu(chave, t)) {
      return reply.code(429).send({ erro: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
    }
    const u = await o.contas.buscarPorEmail(b.data.email);
    const ok = await conferirSenha(b.data.senha, u?.senhaHash ?? (await hashFicticio));
    if (!u || !ok || !u.ativo) {
      errosLogin.registrar(chave, t);
      return reply.code(401).send({ erro: 'E-mail ou senha incorretos.' });
    }
    errosLogin.limpar(chave);
    const extras = acessos ? await acessos.extras(u.id) : undefined;
    if (extras && !dentroDoHorario(extras.horario, agora())) {
      return reply.code(403).send({ erro: 'Seu acesso está liberado só no seu horário de trabalho.', foraDoHorario: true });
    }
    const token = await o.contas.criarSessao(u.id, new Date(t + horas * 3600_000));
    if (acessos) {
      await acessos.registrarAcesso(u.id, agora());
      const aparelho = String(req.headers['user-agent'] ?? '').slice(0, 200) || undefined;
      await acessos.marcarSessao(token, { em: agora(), ip: req.ip, ...(aparelho ? { aparelho } : {}) });
    }
    reply.header('set-cookie', cookie(token, horas * 3600));
    return { nome: u.nome, papel: u.papel, ...(extras?.trocarSenha ? { trocarSenha: true } : {}) };
  });

  app.post('/api/auth/sair', async (req, reply) => {
    const token = lerCookie(req, COOKIE);
    if (token) await o.contas.encerrarSessao(token);
    reply.header('set-cookie', cookie('', 0));
    return { ok: true };
  });

  app.get('/api/auth/eu', async (req) => {
    const u = req.usuario!;
    const r = await resolverDe(u);
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, unidades: u.unidades, permissoes: r.perms, trocarSenha: r.trocarSenha };
  });

  // Trocar a própria senha: pede a atual; as outras sessões dela são encerradas (esta continua).
  const TrocaSenha = z.object({ atual: z.string().min(1).max(200), nova: z.string().max(200) });
  app.post('/api/auth/senha', async (req, reply) => {
    const b = TrocaSenha.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Informe a senha atual e a nova.' });
    const u = await o.contas.buscarPorId(req.usuario!.id);
    if (!u) return reply.code(401).send({ erro: 'Faça login para continuar.' });
    const chave = `senha|${u.id}`;
    const t = agora().getTime();
    if (errosLogin.excedeu(chave, t)) return reply.code(429).send({ erro: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
    if (!(await conferirSenha(b.data.atual, u.senhaHash))) {
      errosLogin.registrar(chave, t);
      return reply.code(400).send({ erro: 'A senha atual não confere.' });
    }
    errosLogin.limpar(chave);
    const fraca = senhaFraca(b.data.nova);
    if (fraca) return reply.code(400).send({ erro: fraca });
    if (b.data.nova === b.data.atual) return reply.code(400).send({ erro: 'A nova senha precisa ser diferente da atual.' });
    await o.contas.definirSenha(u.id, await gerarHash(b.data.nova));
    await o.contas.encerrarSessoesDe(u.id, lerCookie(req, COOKIE));
    if (acessos) {
      await acessos.salvarExtras(u.id, { trocarSenha: false });
      invalidar();
    }
    return { ok: true };
  });

  registrarEquipe(app, o.contas);
  if (acessos) registrarUsuarios(app, { contas: o.contas, acessos, agora, invalidar, permissoesDe: async (u) => (await resolverDe(u)).perms });

  const Contato = z.object({
    nome: z.string().trim().min(2).max(120),
    empresa: z.string().trim().max(160).optional(),
    whatsapp: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v.length >= 10 && v.length <= 13, 'WhatsApp inválido'),
    mensagem: z.string().trim().max(1000).optional(),
    origem: z.string().trim().max(60).optional(),
    // Armadilha para robôs: campo escondido que pessoas não preenchem.
    site: z.string().optional(),
  });
  app.post('/api/contato', async (req, reply) => {
    const b = Contato.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Confira o nome e o WhatsApp.' });
    if (b.data.site) return { ok: true };
    const t = agora().getTime();
    if (contatos.excedeu(req.ip, t)) return reply.code(429).send({ erro: 'Recebemos seus contatos. Já já falamos com você.' });
    contatos.registrar(req.ip, t);
    const { site: _, ...dados } = b.data;
    await o.contas.registrarInteressado(dados);
    return { ok: true };
  });
}

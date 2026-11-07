import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Contas, Usuario } from './contas.js';
import { registrarEquipe } from './equipe.js';
import { conferirSenha, gerarHash, senhaFraca } from './senha.js';

export const COOKIE = 'sintonia_sessao';

export interface OpcoesAuth {
  contas: Contas;
  /** Cookie só por HTTPS (ligar em produção). */
  cookieSeguro?: boolean;
  duracaoHoras?: number;
  agora?: () => Date;
}

/** Rotas da API que não pedem login. */
const PUBLICAS = new Set(['/api/auth/entrar', '/api/auth/sair', '/api/contato']);

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

  // Toda a API pede login, menos as rotas públicas.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const caminho = req.url.split('?')[0]!;
    if (!caminho.startsWith('/api/') || PUBLICAS.has(caminho)) return;
    const u = await usuarioDaRequisicao(req, o);
    if (!u) return reply.code(401).send({ erro: 'Faça login para continuar.' });
    req.usuario = u;
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
    const token = await o.contas.criarSessao(u.id, new Date(t + horas * 3600_000));
    reply.header('set-cookie', cookie(token, horas * 3600));
    return { nome: u.nome, papel: u.papel };
  });

  app.post('/api/auth/sair', async (req, reply) => {
    const token = lerCookie(req, COOKIE);
    if (token) await o.contas.encerrarSessao(token);
    reply.header('set-cookie', cookie('', 0));
    return { ok: true };
  });

  app.get('/api/auth/eu', async (req) => {
    const u = req.usuario!;
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, unidades: u.unidades };
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
    return { ok: true };
  });

  registrarEquipe(app, o.contas);

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

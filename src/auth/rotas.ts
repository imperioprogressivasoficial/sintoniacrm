import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Contas, Usuario } from './contas.js';
import { acessosPara, idDaSessao, nomeDoAparelho, type Acessos } from './acessos.js';
import { resumoToken } from './contas.js';
import { registrarEquipe } from './equipe.js';
import { comNivel, dentroDoHorario, permissaoDaRota, resolver, type Permissoes } from './permissoes.js';
import { registrarUsuarios, type TelefonesEquipe } from './usuarios-rotas.js';
import { conferirSenha, gerarHash, senhaFraca } from './senha.js';
import { LimiteLogin, mensagemBloqueio, type BloqueioConta } from './limite-login.js';
import { diasDemonstracao, horarioValido, janelaDemonstracao } from '../vendas/demonstracao.js';
import { ROTAS_PUBLICAS_SEM_PAGAMENTO } from '../publico/publico.js';
import { armazemPrimeiroAcessoPara, registrarPrimeiroAcesso, ROTAS_PUBLICAS_PRIMEIRO_ACESSO, type ArmazemPrimeiroAcesso } from './primeiro-acesso.js';

export const COOKIE = 'sintonia_sessao';

export interface OpcoesAuth {
  contas: Contas;
  /** Cookie só por HTTPS (ligar em produção). */
  cookieSeguro?: boolean;
  duracaoHoras?: number;
  agora?: () => Date;
  /** Permissões, convites, sessões e auditoria (padrão: escolhido pelo tipo de `contas`). */
  acessos?: Acessos;
  /** Como o link de "esqueci minha senha" chega à pessoa (e-mail do sistema e/ou WhatsApp). */
  recuperacao?: Recuperacao;
  /** perdas-saude: avisa a dona da conta (sino e e-mail) quando a conta é bloqueada por muitas tentativas erradas. */
  avisarBloqueio?: (u: Usuario, b: BloqueioConta) => Promise<void>;
  /** usuarios: telefone da pessoa (o mesmo da Conta › Perfil), para mandar convite e link pelo WhatsApp. */
  telefones?: TelefonesEquipe;
  /** primeiro-acesso: onde fica a chave "Primeiro acesso pelo link" (padrão: escolhido pelo tipo de `contas`). */
  primeiroAcesso?: ArmazemPrimeiroAcesso;
  /** primeiro-acesso: empresa atendida por este servidor (padrão: SINTONIA_EMPRESA_ID ou "imperio"). */
  empresaPadrao?: string;
}

/** Envio do link de redefinição. Sem nenhum canal, a tela orienta a pedir à administração. */
export interface Recuperacao {
  canais(): Promise<{ email: boolean; whatsapp: boolean }>;
  /** Manda o link pelos canais disponíveis; devolve por quais saiu. */
  enviar(u: Usuario, link: string, validadeMin: number): Promise<string[]>;
  /** usuarios: manda o convite por e-mail; devolve se saiu. */
  convidar?(u: Usuario, link: string, validadeHoras: number, quemConvidou: string): Promise<boolean>;
}

/** Validade do link pedido pela própria pessoa. */
export const VALIDADE_ESQUECI_MIN = 60;
export const RESPOSTA_ESQUECI = 'Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora.';

/** Rotas da API que não pedem login. */
const PUBLICAS = new Set(['/api/auth/entrar', '/api/auth/sair', '/api/contato', '/api/auth/convite', '/api/auth/esqueci', '/api/auth/esqueci/canais', '/api/leads-site', '/api/leads-site/horarios', '/api/leads-site/demonstracao', /* sem-pagamento: contato público e a recusa de cadastro */ ...ROTAS_PUBLICAS_SEM_PAGAMENTO, /* primeiro-acesso */ ...ROTAS_PUBLICAS_PRIMEIRO_ACESSO]);
/** O que quem precisa trocar a senha (ou está fora do horário) ainda pode chamar. */
const SEMPRE = new Set(['/api/auth/eu', '/api/auth/senha', '/api/auth/sair']);

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: Usuario;
  }
}

/** primeiro-acesso: a gestão (gerente, direção, administração) pode deixar a foto de perfil para depois. */
export const podePularFoto = (u: Pick<Usuario, 'papel'>) => u.papel === 'gerente' || u.papel === 'direcao' || u.papel === 'admin';

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

/** Endereço por onde a pessoa acessou (base dos links mandados para ela). */
export function linkBase(req: FastifyRequest): string {
  if (process.env.SINTONIA_URL_PUBLICA) return process.env.SINTONIA_URL_PUBLICA.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? (req.protocol || 'http');
  return `${proto}://${host}`;
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
  /* perdas-saude: limite por endereço, por endereço+e-mail e por conta (espera crescente) e aviso à dona da conta */
  const limiteLogin = new LimiteLogin({
    aoBloquearConta: (b) => {
      if (!o.avisarBloqueio) return;
      void (async () => {
        const u = await o.contas.buscarPorEmail(b.email);
        if (u && u.ativo) await o.avisarBloqueio!(u, b);
      })().catch(() => undefined);
    },
  });
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
    // integracoes: a API pública (/api/v1) se autentica pela chave de API (src/integracoes/api.ts), nunca pelo cookie.
    if (!caminho.startsWith('/api/') || PUBLICAS.has(caminho) || caminho.startsWith('/api/v1/') || caminho === '/api/v1') return;
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

  /** Cria a sessão, registra o acesso (aparelho e endereço) e põe o cookie. */
  const abrirSessao = async (req: FastifyRequest, reply: FastifyReply, u: Usuario) => {
    const token = await o.contas.criarSessao(u.id, new Date(agora().getTime() + horas * 3600_000));
    if (acessos) {
      await acessos.registrarAcesso(u.id, agora());
      const aparelho = String(req.headers['user-agent'] ?? '').slice(0, 200) || undefined;
      await acessos.marcarSessao(token, { em: agora(), ip: req.ip, ...(aparelho ? { aparelho } : {}) });
    }
    reply.header('set-cookie', cookie(token, horas * 3600));
  };

  const Entrar = z.object({ email: z.string().trim().email().max(200), senha: z.string().min(1).max(200) });
  app.post('/api/auth/entrar', async (req, reply) => {
    const b = Entrar.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Informe e-mail e senha.' });
    const t = agora().getTime();
    const bloqueado = limiteLogin.bloqueio(req.ip, b.data.email, t);
    if (bloqueado) {
      const esperaSeg = Math.max(1, Math.ceil((bloqueado.ate - t) / 1000));
      return reply.code(429).header('retry-after', String(esperaSeg)).send({ erro: mensagemBloqueio(bloqueado, t), bloqueio: bloqueado.motivo, esperaSeg, ate: new Date(bloqueado.ate).toISOString() });
    }
    const u = await o.contas.buscarPorEmail(b.data.email);
    const ok = await conferirSenha(b.data.senha, u?.senhaHash ?? (await hashFicticio));
    if (!u || !ok || !u.ativo) {
      const r = limiteLogin.errou(req.ip, b.data.email, t);
      if (r.bloqueio) {
        // Esta tentativa errou (401) e, com ela, o acesso ficou bloqueado: a tela já mostra até quando.
        const esperaSeg = Math.max(1, Math.ceil((r.bloqueio.ate - t) / 1000));
        return reply.code(401).send({ erro: `E-mail ou senha incorretos. ${mensagemBloqueio(r.bloqueio, t)}`, restantes: 0, bloqueio: r.bloqueio.motivo, esperaSeg, ate: new Date(r.bloqueio.ate).toISOString() });
      }
      const aviso = r.restantes <= 2 ? ` ${r.restantes === 1 ? 'Mais 1 tentativa errada' : `Mais ${r.restantes} tentativas erradas`} e o acesso fica bloqueado por um tempo.` : '';
      return reply.code(401).send({ erro: `E-mail ou senha incorretos.${aviso}`, restantes: r.restantes });
    }
    limiteLogin.acertou(req.ip, b.data.email);
    const extras = acessos ? await acessos.extras(u.id) : undefined;
    if (extras && !dentroDoHorario(extras.horario, agora())) {
      return reply.code(403).send({ erro: 'Seu acesso está liberado só no seu horário de trabalho.', foraDoHorario: true });
    }
    await abrirSessao(req, reply, u);
    return { nome: u.nome, papel: u.papel, ...(extras?.trocarSenha ? { trocarSenha: true } : {}) };
  });

  // ---------------------------------------------------------------- esqueci minha senha
  // A resposta é sempre a mesma (exista ou não a conta) e o envio acontece fora da requisição,
  // para nem o tempo de resposta revelar quem tem conta. O token só fica guardado como hash.
  const esqueciIp = new Limite(5, 60 * 60_000);
  const esqueciEmail = new Limite(3, 60 * 60_000);
  const semCanais = { email: false, whatsapp: false };
  const canaisRecuperacao = async () => (o.recuperacao && acessos ? await o.recuperacao.canais().catch(() => semCanais) : semCanais);
  app.get('/api/auth/esqueci/canais', async () => {
    const c = await canaisRecuperacao();
    return { ...c, disponivel: c.email || c.whatsapp };
  });
  const Esqueci = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
  app.post('/api/auth/esqueci', async (req, reply) => {
    const b = Esqueci.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Informe um e-mail válido.' });
    const t = agora().getTime();
    const email = b.data.email;
    if (esqueciIp.excedeu(req.ip, t) || esqueciEmail.excedeu(email, t)) {
      return reply.code(429).send({ erro: 'Muitos pedidos seguidos. Espere um pouco e tente de novo.' });
    }
    esqueciIp.registrar(req.ip, t);
    esqueciEmail.registrar(email, t);
    const canais = await canaisRecuperacao();
    if (!canais.email && !canais.whatsapp) return { ok: true, mensagem: RESPOSTA_ESQUECI, semEnvio: true };
    const base = linkBase(req);
    void (async () => {
      const u = await o.contas.buscarPorEmail(email);
      if (!u || !u.ativo || !acessos || !o.recuperacao) return;
      const token = await acessos.criarConvite(u.id, 'redefinir', new Date(agora().getTime() + VALIDADE_ESQUECI_MIN * 60_000));
      const usados = await o.recuperacao.enviar(u, `${base}/nova-senha?t=${encodeURIComponent(token)}`, VALIDADE_ESQUECI_MIN);
      await acessos.auditar({ empresaId: u.empresaId, autorId: u.id, autorNome: u.nome, alvoId: u.id, alvoNome: u.nome, acao: 'pediu nova senha', detalhe: usados.length ? `link enviado por ${usados.join(' e ')}` : 'nenhum envio funcionou', em: agora() });
    })().catch((e) => req.log.warn({ err: e }, 'falha ao enviar o link de redefinição'));
    return { ok: true, mensagem: RESPOSTA_ESQUECI };
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
    /* primeiro-acesso: quem não tem foto de perfil é chamado a pôr uma logo ao entrar. Só a gestão pode deixar para depois. */
    const temFoto = await o.contas
      .fotosDaEmpresa(u.empresaId)
      .then((m) => m.has(u.id))
      .catch(() => true);
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, unidades: u.unidades, permissoes: r.perms, trocarSenha: r.trocarSenha, pedirFoto: !temFoto, podePularFoto: podePularFoto(u) };
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

  // ---------------------------------------------------------------- usuarios: meus aparelhos conectados
  // A própria pessoa vê onde está conectada e sai de um aparelho ou de todos os outros.
  if (acessos) {
    app.get('/api/auth/sessoes', async (req) => {
      const u = req.usuario!;
      const atual = idDaSessao(resumoToken(lerCookie(req, COOKIE) ?? ''));
      const l = await acessos.sessoes(u.id, agora());
      return {
        sessoes: l.map((s) => ({
          id: s.id,
          aparelho: nomeDoAparelho(s.aparelho),
          ip: s.ip,
          criadaEm: s.criadaEm.toISOString(),
          usadaEm: s.usadaEm?.toISOString() ?? null,
          expiraEm: s.expiraEm.toISOString(),
          atual: s.id === atual,
        })),
      };
    });
    app.delete('/api/auth/sessoes/:id', async (req, reply) => {
      const u = req.usuario!;
      const id = z.string().regex(/^[0-9a-f]{16}$/).safeParse((req.params as { id: string }).id);
      if (!id.success) return reply.code(404).send({ erro: 'Aparelho não encontrado.' });
      const atual = idDaSessao(resumoToken(lerCookie(req, COOKIE) ?? ''));
      if (!(await acessos.encerrarSessao(u.id, id.data))) return reply.code(404).send({ erro: 'Aparelho não encontrado.' });
      await acessos.auditar({ empresaId: u.empresaId, autorId: u.id, autorNome: u.nome, alvoId: u.id, alvoNome: u.nome, acao: 'saiu de um aparelho', em: agora() });
      if (id.data === atual) reply.header('set-cookie', cookie('', 0));
      return { ok: true, saiu: id.data === atual };
    });
    app.post('/api/auth/sessoes/sair-das-outras', async (req) => {
      const u = req.usuario!;
      const antes = (await acessos.sessoes(u.id, agora())).length;
      await o.contas.encerrarSessoesDe(u.id, lerCookie(req, COOKIE));
      await acessos.auditar({ empresaId: u.empresaId, autorId: u.id, autorNome: u.nome, alvoId: u.id, alvoNome: u.nome, acao: 'saiu dos outros aparelhos', em: agora() });
      return { ok: true, encerradas: Math.max(0, antes - 1) };
    });
  }

  registrarEquipe(app, o.contas);
  /* primeiro-acesso: link único da equipe (/primeiro-acesso) e a chave em Usuários e acessos */
  if (acessos)
    registrarPrimeiroAcesso(app, {
      contas: o.contas,
      acessos,
      armazem: o.primeiroAcesso ?? armazemPrimeiroAcessoPara(o.contas),
      agora,
      empresaPadrao: o.empresaPadrao ?? (process.env.SINTONIA_EMPRESA_ID || 'imperio'),
      abrirSessao,
      aoDefinirSenha: (u) => limiteLogin.liberarConta(u.email),
      linkBase,
      invalidar,
    });
  if (acessos)
    registrarUsuarios(app, {
      contas: o.contas,
      acessos,
      agora,
      invalidar,
      permissoesDe: async (u) => (await resolverDe(u)).perms,
      aoDefinirSenha: (u) => limiteLogin.liberarConta(u.email),
      linkBase,
      ...(o.recuperacao ? { recuperacao: o.recuperacao } : {}),
      ...(o.telefones ? { telefones: o.telefones } : {}),
    });

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
    // robustez: nunca dizer "recebemos" sem ter gravado.
    if (contatos.excedeu(req.ip, t)) return reply.code(429).send({ erro: LIMITE_FORMULARIO });
    const { site: _, ...dados } = b.data;
    try {
      await o.contas.registrarInteressado(dados);
    } catch {
      return reply.code(503).send({ erro: SEM_GRAVAR });
    }
    contatos.registrar(req.ip, t);
    return { ok: true };
  });

  registrarLeadsSite(app, o.contas, agora);
}

// ---------------------------------------------------------------- leads do pop-up da página de vendas

/** robustez: resposta honesta quando o limite de envios por visitante estoura (nada foi gravado). */
/** robustez: o banco não gravou (fora do ar): a pessoa sabe que precisa tentar de novo. */
export const SEM_GRAVAR = 'Não conseguimos guardar seus dados agora. Tente de novo em alguns minutos.';
export const LIMITE_FORMULARIO = 'Recebemos muitos envios deste endereço agora e seus dados ainda não foram enviados. Tente de novo em alguns minutos.';

export const SETORES = ['Serviços', 'Saúde e estética', 'Varejo e e-commerce', 'Educação', 'Imobiliário', 'Indústria', 'Outro'] as const;
export const FATURAMENTOS = ['até R$ 50 mil', 'R$ 50 mil a R$ 200 mil', 'R$ 200 mil a R$ 1 milhão', 'acima de R$ 1 milhão'] as const;
export const PLANOS_SITE = ['Essencial', 'Colaborador de IA', 'Empresarial'] as const;

const LeadSiteEntrada = z.object({
  nome: z.string().trim().min(2).max(120),
  whatsapp: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length >= 10 && v.length <= 13, 'WhatsApp inválido'),
  email: z.string().trim().toLowerCase().max(160).email(),
  empresa: z.string().trim().max(160).optional(),
  setor: z.enum(SETORES).optional(),
  instagram: z.string().trim().max(80).transform((v) => v.replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '')).optional(),
  faturamento: z.enum(FATURAMENTOS),
  plano: z.enum(PLANOS_SITE),
  origem: z.string().trim().max(60).optional(),
  // Armadilha para robôs, como no /api/contato.
  site: z.string().optional(),
});

const AgendaEntrada = z.object({
  id: z.string().trim().min(1).max(40),
  token: z.string().trim().min(20).max(100),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
});

function registrarLeadsSite(app: FastifyInstance, contas: Contas, agora: () => Date): void {
  const leads = new Limite(5, 60 * 60_000);
  const agendas = new Limite(20, 60 * 60_000);

  app.get('/api/leads-site/horarios', async () => {
    const t = agora();
    const { de, ate } = janelaDemonstracao(t);
    return { fuso: 'America/Sao_Paulo', dias: diasDemonstracao(t, await contas.demonstracoesOcupadas(de, ate)) };
  });

  app.post('/api/leads-site', async (req, reply) => {
    const b = LeadSiteEntrada.safeParse(req.body);
    if (!b.success) {
      const campo = String(b.error.issues[0]?.path[0] ?? '');
      const erro = campo === 'email' ? 'Confira o e-mail.' : campo === 'whatsapp' ? 'Confira o WhatsApp com DDD.' : campo === 'nome' ? 'Confira o seu nome.' : 'Escolha o faturamento e o plano.';
      return reply.code(400).send({ erro });
    }
    // Robô: finge que deu certo e não grava nada.
    if (b.data.site) return { ok: true, id: '0', token: 'x'.repeat(43) };
    const t = agora().getTime();
    // robustez: nunca dizer "recebemos" sem ter gravado.
    if (leads.excedeu(req.ip, t)) return reply.code(429).send({ erro: LIMITE_FORMULARIO });
    const { site: _, ...dados } = b.data;
    let r: { id: string; token: string };
    try {
      r = await contas.registrarLeadSite({ ...dados, origem: dados.origem ?? 'pagina-vendas' });
    } catch {
      return reply.code(503).send({ erro: SEM_GRAVAR });
    }
    leads.registrar(req.ip, t);
    return { ok: true, id: r.id, token: r.token };
  });

  app.post('/api/leads-site/demonstracao', async (req, reply) => {
    const b = AgendaEntrada.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Escolha o dia e o horário.' });
    const t = agora();
    if (agendas.excedeu(req.ip, t.getTime())) return reply.code(429).send({ erro: 'Muitas tentativas. Tente de novo mais tarde.' });
    agendas.registrar(req.ip, t.getTime());
    const em = horarioValido(b.data.data, b.data.hora, t);
    if (!em) return reply.code(400).send({ erro: 'Esse horário não está disponível. Escolha outro.' });
    const r = await contas.agendarDemonstracao(b.data.id, b.data.token, em, t);
    if (r === 'nao-achou') return reply.code(404).send({ erro: 'Não achamos o seu cadastro. Envie os dados de novo.' });
    if (r === 'ocupado') return reply.code(409).send({ erro: 'Alguém acabou de marcar esse horário. Escolha outro.' });
    if (r === 'ja-agendado') return reply.code(409).send({ erro: 'Sua demonstração já está agendada. A gente confirma pelo WhatsApp.' });
    return { ok: true, data: b.data.data, hora: b.data.hora, em: em.toISOString() };
  });
}

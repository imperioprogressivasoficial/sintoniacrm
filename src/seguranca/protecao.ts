import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { resumoCliente, type Auditoria } from './auditoria.js';
import { ErroDadosCliente, type DadosCliente } from './dados-cliente.js';

/**
 * banco-seguranca: proteções do servidor que valem para todas as rotas.
 * 1. Cabeçalhos de segurança em toda resposta (HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options)
 *    e a política de conteúdo (CSP). A CSP começa em modo "só relatório" (não bloqueia nada: o navegador só avisa
 *    em /seguranca/csp o que bloquearia). Depois de uns dias sem aviso, SINTONIA_CSP=bloquear liga de verdade.
 * 2. Pedido que muda dados (POST/PUT/PATCH/DELETE em /api) vindo de outro site é recusado (Origin diferente).
 * 3. Limite de uso nas rotas sensíveis (exportar, apagar dados de cliente, chaves e acessos), por pessoa.
 * 4. Registro (auditoria) das ações sensíveis: entrar, senha errada/bloqueio, trocar senha, acessos e permissões,
 *    chaves e conexões, exportar, importar e mesclar leads, apagar conversa, dados de cliente (LGPD).
 * 5. LGPD: exportar tudo de um cliente (JSON) e anonimizar a pedido dele — só a gestão (administração e direção).
 */
export type ModoCsp = 'relatorio' | 'bloquear' | 'desligado';

export interface OpcoesProtecao {
  empresaId: string;
  auditoria?: Auditoria;
  /** Dados do cliente (LGPD). Só com Postgres. */
  dadosCliente?: DadosCliente;
  /** HSTS mesmo sem saber se o pedido veio por HTTPS (produção, atrás do Traefik). */
  https?: boolean;
  csp?: ModoCsp;
  /** Recusar mudança vinda de outro site (padrão: sim). */
  conferirOrigem?: boolean;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

/** Lê SINTONIA_CSP: "bloquear" liga de verdade, "0"/"desligado" tira; o resto (padrão) é só relatório. */
export function modoCsp(valor = process.env.SINTONIA_CSP): ModoCsp {
  const v = (valor ?? '').trim().toLowerCase();
  if (v === 'bloquear' || v === 'ativo' || v === '1') return 'bloquear';
  if (v === '0' || v === 'desligado' || v === 'nao') return 'desligado';
  return 'relatorio';
}

/**
 * Política de conteúdo compatível com o app de hoje: scripts e estilos do próprio servidor (o app.html tem scripts
 * e estilos dentro da página e onclick=, por isso 'unsafe-inline'), fontes do Google, imagens de qualquer https
 * (foto de perfil, anúncios), nada de plugin, formulário só para o próprio servidor e a página só dentro dela mesma.
 */
export function politicaCsp(o: { embutivel?: boolean } = {}): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(o.embutivel ? [] : ["frame-ancestors 'self'"]),
    'report-uri /seguranca/csp',
  ].join('; ');
}

/** Páginas que outro site pode mostrar dentro dele (link de agendamento da empresa). */
const EMBUTIVEIS = /^\/(r|reservar)\//;
/** Páginas que usam câmera e microfone (o app). */
const APP_COM_MIDIA = /^\/app(\/|$)/;
const MUDA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GESTAO = new Set(['admin', 'direcao']);

/** Limite de uso por pessoa (ou endereço, sem login) numa janela de tempo. */
export class Janela {
  private readonly usos = new Map<string, number[]>();
  constructor(
    readonly maximo: number,
    readonly janelaMs: number,
  ) {}
  /** Conta o uso; devolve em quantos segundos libera, se passou do limite. */
  usar(chave: string, agora: number): number | null {
    const l = (this.usos.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    if (l.length >= this.maximo) {
      this.usos.set(chave, l);
      return Math.max(1, Math.ceil((l[0]! + this.janelaMs - agora) / 1000));
    }
    l.push(agora);
    this.usos.set(chave, l);
    if (this.usos.size > 10_000) this.usos.clear();
    return null;
  }
}

interface RegraLimite {
  metodo: RegExp;
  caminho: RegExp;
  janela: Janela;
  mensagem: string;
}

export const LIMITES_SENSIVEIS = {
  exportar: { maximo: 20, janelaMs: 10 * 60_000 },
  dadosCliente: { maximo: 10, janelaMs: 60 * 60_000 },
  configuracao: { maximo: 60, janelaMs: 10 * 60_000 },
} as const;

/** Ação sensível que vira linha na auditoria (só quando deu certo, menos o login, que conta erro e bloqueio). */
interface RegraAuditoria {
  metodo: RegExp;
  caminho: RegExp;
  acao: string;
  detalhe?: (req: FastifyRequest) => Record<string, unknown>;
}
const chavesDoCorpo = (req: FastifyRequest) => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? { campos: Object.keys(b as object).slice(0, 60) } : {};
};
const REGRAS_AUDITORIA: RegraAuditoria[] = [
  { metodo: /^PUT$/, caminho: /^\/api\/conexoes$/, acao: 'mudou chaves e conexões', detalhe: chavesDoCorpo },
  { metodo: /^(POST|PATCH|DELETE)$/, caminho: /^\/api\/conexoes\/(whatsapp|pagamentos\/token|meta\/[^/]+\/verify-token|sociais\/[^/]+\/verify-token)/, acao: 'mexeu em conexões' },
  { metodo: /^(POST|PUT|PATCH|DELETE)$/, caminho: /^\/api\/acessos\//, acao: 'mudou acessos e permissões', detalhe: chavesDoCorpo },
  { metodo: /^(POST|PUT|PATCH|DELETE)$/, caminho: /^\/api\/equipe(\/[^/]+(\/(desativar|reativar|senha))?)?$/, acao: 'mudou a equipe' },
  { metodo: /^(POST|PATCH|DELETE)$/, caminho: /^\/api\/integracoes\/(chaves|webhooks)/, acao: 'mudou chaves de API ou webhooks' },
  { metodo: /^POST$/, caminho: /^\/api\/auth\/senha$/, acao: 'trocou a própria senha' },
  { metodo: /^(POST|DELETE)$/, caminho: /^\/api\/auth\/sessoes/, acao: 'saiu de aparelhos' },
  { metodo: /^(GET|POST)$/, caminho: /^\/api\/leads\/exportar|^\/api\/relatorios\/[^/]+\/csv|^\/api\/conversas\/[^/]+\/exportar|^\/api\/conversas\/exportar-todas/, acao: 'exportou dados' },
  { metodo: /^POST$/, caminho: /^\/api\/leads\/importar$/, acao: 'importou leads' },
  { metodo: /^POST$/, caminho: /^\/api\/leads\/mesclar$/, acao: 'juntou leads duplicados' },
  { metodo: /^DELETE$/, caminho: /^\/api\/conversas\/[^/]+$/, acao: 'apagou conversa' },
];

export function registrarProtecao(app: FastifyInstance, o: OpcoesProtecao): void {
  const agora = o.agora ?? (() => new Date());
  const log = o.log ?? (() => {});
  const csp = o.csp ?? modoCsp();
  const caminhoDe = (req: FastifyRequest) => req.url.split('?')[0]!;
  const auditar = (req: FastifyRequest, acao: string, extra: { alvo?: string | null; detalhe?: Record<string, unknown>; autorNome?: string | null } = {}) => {
    if (!o.auditoria) return;
    const u = req.usuario;
    void o.auditoria
      .registrar({ empresaId: u?.empresaId ?? o.empresaId, acao, autorId: u?.id ?? null, autorNome: extra.autorNome ?? u?.nome ?? null, papel: u?.papel ?? null, alvo: extra.alvo ?? null, detalhe: extra.detalhe ?? {}, ip: req.ip, em: agora() })
      .catch((e) => log('Falha ao gravar a auditoria', String(e)));
  };

  // ---------------------------------------------------------------- 1. cabeçalhos
  app.addHook('onSend', async (req, reply, corpo) => {
    const def = (nome: string, valor: string) => {
      if (!reply.hasHeader(nome)) reply.header(nome, valor);
    };
    def('x-content-type-options', 'nosniff');
    def('referrer-policy', 'strict-origin-when-cross-origin');
    // seguranca-abertura: câmera e microfone só no app (/app: áudio e foto na conversa); páginas públicas, login e o resto, nada.
    const midia = APP_COM_MIDIA.test(caminhoDe(req)) ? '(self)' : '()';
    def('permissions-policy', `camera=${midia}, microphone=${midia}, geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()`);
    if (o.https || req.protocol === 'https') def('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      const embutivel = EMBUTIVEIS.test(caminhoDe(req));
      if (!embutivel) def('x-frame-options', 'SAMEORIGIN');
      if (csp !== 'desligado' && !reply.hasHeader('content-security-policy')) {
        reply.header(csp === 'bloquear' ? 'content-security-policy' : 'content-security-policy-report-only', politicaCsp({ embutivel }));
      }
    }
    return corpo;
  });

  // Avisos da CSP (o navegador manda sozinho). Público, pequeno e com limite: só vai para o registro do servidor.
  const avisosCsp = new Janela(60, 60 * 60_000);
  for (const tipo of ['application/csp-report', 'application/reports+json']) {
    app.addContentTypeParser(tipo, { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, corpo, feito) => {
      try {
        feito(null, JSON.parse(String(corpo || '{}')));
      } catch {
        feito(null, {});
      }
    });
  }
  app.post('/seguranca/csp', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    if (avisosCsp.usar(req.ip, agora().getTime()) === null) {
      const r = (req.body as { 'csp-report'?: Record<string, unknown> } | Array<{ body?: Record<string, unknown> }> | undefined) ?? {};
      const aviso = Array.isArray(r) ? r[0]?.body : r['csp-report'];
      if (aviso) log('CSP (só relatório): a página tentou carregar algo fora da política', {
        pagina: String(aviso['document-uri'] ?? aviso.documentURL ?? '').slice(0, 200),
        regra: String(aviso['violated-directive'] ?? aviso.effectiveDirective ?? '').slice(0, 80),
        bloqueado: String(aviso['blocked-uri'] ?? aviso.blockedURL ?? '').slice(0, 200),
      });
    }
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- 2. mudança vinda de outro site
  app.addHook('onRequest', async (req, reply) => {
    if (o.conferirOrigem === false || !MUDA.has(req.method)) return;
    const caminho = caminhoDe(req);
    if (!caminho.startsWith('/api/') || caminho.startsWith('/api/v1/') || caminho === '/api/v1') return;
    const origem = req.headers.origin;
    if (!origem) return; // aplicativos e chamadas entre servidores não mandam Origin
    let host: string | undefined;
    try {
      host = new URL(origem).host;
    } catch {
      host = undefined;
    }
    if (host && host === req.host) return;
    return reply.code(403).send({ erro: 'Pedido recusado: veio de outro site.' });
  });

  // ---------------------------------------------------------------- 3. limite nas rotas sensíveis (depois do login)
  const regrasLimite: RegraLimite[] = [
    { metodo: /^(GET|POST)$/, caminho: /^\/api\/leads\/exportar|^\/api\/relatorios\/[^/]+\/csv|^\/api\/lgpd\/cliente\/exportar|^\/api\/conversas\/[^/]+\/exportar|^\/api\/conversas\/exportar-todas/, janela: new Janela(LIMITES_SENSIVEIS.exportar.maximo, LIMITES_SENSIVEIS.exportar.janelaMs), mensagem: 'Muitas exportações seguidas. Espere alguns minutos e tente de novo.' },
    { metodo: /^POST$/, caminho: /^\/api\/lgpd\/cliente\/anonimizar/, janela: new Janela(LIMITES_SENSIVEIS.dadosCliente.maximo, LIMITES_SENSIVEIS.dadosCliente.janelaMs), mensagem: 'Muitos pedidos de apagar dados seguidos. Espere e tente de novo.' },
    { metodo: /^(POST|PUT|PATCH|DELETE)$/, caminho: /^\/api\/(conexoes|acessos|integracoes\/chaves)/, janela: new Janela(LIMITES_SENSIVEIS.configuracao.maximo, LIMITES_SENSIVEIS.configuracao.janelaMs), mensagem: 'Muitas mudanças seguidas nas configurações. Espere alguns minutos.' },
  ];
  app.addHook('onRequest', async (req, reply) => {
    const caminho = caminhoDe(req);
    if (!caminho.startsWith('/api/')) return;
    for (const r of regrasLimite) {
      if (!r.metodo.test(req.method) || !r.caminho.test(caminho)) continue;
      const espera = r.janela.usar(req.usuario?.id ?? `ip:${req.ip}`, agora().getTime());
      if (espera !== null) return reply.code(429).header('retry-after', String(espera)).send({ erro: r.mensagem, esperaSeg: espera });
    }
  });

  // ---------------------------------------------------------------- 4. auditoria das ações sensíveis
  const errosLogin = new Janela(30, 60 * 60_000); // no máximo 30 linhas de "senha errada" por endereço por hora
  app.addHook('onResponse', async (req, reply) => {
    if (!o.auditoria) return;
    const caminho = caminhoDe(req);
    if (!caminho.startsWith('/api/')) return;
    const status = reply.statusCode;
    if (caminho === '/api/auth/entrar' && req.method === 'POST') {
      const email = String((req.body as { email?: unknown } | undefined)?.email ?? '').trim().toLowerCase().slice(0, 200);
      if (status === 200) auditar(req, 'entrou', { detalhe: { email } });
      else if (status === 429) auditar(req, 'acesso bloqueado (muitas tentativas)', { detalhe: { email } });
      else if (status === 401 && errosLogin.usar(req.ip, agora().getTime()) === null) auditar(req, 'senha errada', { detalhe: { email } });
      return;
    }
    if (status >= 400 || !req.usuario) return;
    const regra = REGRAS_AUDITORIA.find((r) => r.metodo.test(req.method) && r.caminho.test(caminho));
    if (regra) auditar(req, regra.acao, { alvo: caminho, detalhe: regra.detalhe?.(req) ?? {} });
  });

  // ---------------------------------------------------------------- 5. auditoria na tela e LGPD (só a gestão)
  const gestao = (req: FastifyRequest, reply: FastifyReply) => {
    // Sem login configurado (teste local) a rota fica aberta, como o resto da API.
    if (req.usuario && !GESTAO.has(req.usuario.papel)) {
      reply.code(403).send({ erro: 'Só a administração e a direção podem fazer isso.' });
      return false;
    }
    return true;
  };
  const empresa = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;

  app.get('/api/seguranca/auditoria', async (req, reply) => {
    if (!gestao(req, reply)) return reply;
    if (!o.auditoria) return { registros: [] };
    const q = z.object({ limite: z.coerce.number().int().min(1).max(1000).default(200), acao: z.string().trim().min(1).max(80).optional() }).parse(req.query);
    return { registros: await o.auditoria.listar(empresa(req), q) };
  });

  const QualCliente = z
    .object({ telefone: z.string().trim().min(3).max(40).optional(), conversaId: z.string().uuid().optional() })
    .refine((x) => x.telefone || x.conversaId, 'Informe o telefone do cliente.');
  const lerCliente = (v: unknown, reply: FastifyReply) => {
    const r = QualCliente.safeParse(v ?? {});
    if (!r.success) {
      reply.code(400).send({ erro: 'Informe o telefone do cliente.' });
      return undefined;
    }
    return r.data;
  };
  const responderErro = (e: unknown, reply: FastifyReply) => {
    if (e instanceof ErroDadosCliente) return reply.code(e.statusCode).send({ erro: e.message });
    throw e;
  };
  const semBanco = (reply: FastifyReply) => reply.code(501).send({ erro: 'Disponível só com o banco de dados ligado.' });

  // Antes de agir: quem é (quantas conversas, unidades, se tem ficha) — para a gestão conferir o número.
  app.get('/api/lgpd/cliente', async (req, reply) => {
    if (!gestao(req, reply)) return reply;
    const p = lerCliente(req.query, reply);
    if (!p) return reply;
    if (!o.dadosCliente) return semBanco(reply);
    try {
      const c = await o.dadosCliente.encontrar(empresa(req), p);
      return { telefones: c.telefones, conversas: c.conversas.map((x) => ({ id: x.id, unidade: x.unidade, nome: x.nome })), temFicha: c.temFicha };
    } catch (e) {
      return responderErro(e, reply);
    }
  });

  app.get('/api/lgpd/cliente/exportar', async (req, reply) => {
    if (!gestao(req, reply)) return reply;
    const p = lerCliente(req.query, reply);
    if (!p) return reply;
    if (!o.dadosCliente) return semBanco(reply);
    try {
      const dados = await o.dadosCliente.exportar(empresa(req), p, agora());
      const chave = (await o.dadosCliente.encontrar(empresa(req), p)).chave ?? dados.cliente.telefones[0] ?? '';
      auditar(req, 'exportou dados de um cliente (LGPD)', { alvo: resumoCliente(chave), detalhe: { conversas: dados.cliente.conversas, tabelas: Object.keys(dados.tabelas) } });
      return reply
        .header('cache-control', 'no-store')
        .header('content-disposition', `attachment; filename="dados-cliente-${agora().toISOString().slice(0, 10)}.json"`)
        .type('application/json; charset=utf-8')
        .send(JSON.stringify(dados, null, 2));
    } catch (e) {
      return responderErro(e, reply);
    }
  });

  // Apagar (anonimizar) a pedido do cliente: pede a palavra APAGAR para não acontecer por engano.
  const Anonimizar = z.object({ telefone: z.string().trim().min(3).max(40).optional(), conversaId: z.string().uuid().optional(), confirmar: z.string() });
  app.post('/api/lgpd/cliente/anonimizar', async (req, reply) => {
    if (!gestao(req, reply)) return reply;
    const b = Anonimizar.safeParse(req.body ?? {});
    if (!b.success || (!b.data.telefone && !b.data.conversaId)) return reply.code(400).send({ erro: 'Informe o telefone do cliente.' });
    if (b.data.confirmar.trim().toUpperCase() !== 'APAGAR') return reply.code(400).send({ erro: 'Para confirmar, escreva APAGAR. Isso não pode ser desfeito.' });
    if (!o.dadosCliente) return semBanco(reply);
    try {
      const p = { ...(b.data.telefone ? { telefone: b.data.telefone } : {}), ...(b.data.conversaId ? { conversaId: b.data.conversaId } : {}) };
      const antes = await o.dadosCliente.encontrar(empresa(req), p);
      const r = await o.dadosCliente.anonimizar(empresa(req), p);
      auditar(req, 'apagou dados de um cliente a pedido (LGPD)', { alvo: resumoCliente(antes.chave ?? antes.telefones[0] ?? ''), detalhe: { conversas: r.conversas, alteracoes: r.alteracoes } });
      return { ok: true, ...r };
    } catch (e) {
      return responderErro(e, reply);
    }
  });
}

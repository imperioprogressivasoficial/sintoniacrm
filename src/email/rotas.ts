import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, veTudo } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import { MODELOS_PRONTOS } from './blocos.js';
import { ErroEmail, PREDEFINICOES, type EmailMarketing, type Publico } from './email.js';

/**
 * Rotas do e-mail marketing. Gestão (/api/email/...): só gerência, direção e administração
 * (contas remetentes: só direção e administração, como o resto de Conexões).
 * Rastreio (/e/...): públicas, por token imprevisível, sem mostrar dado pessoal.
 */
export interface OpcoesRotasEmail {
  email: EmailMarketing;
  /** Avisa o trabalhador de que há e-mails na fila (para não esperar o próximo tique). */
  avisar?: () => void;
}

// GIF transparente de 1x1.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const Id = z.object({ id: z.string().uuid() });

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function paginaPublica(titulo: string, corpo: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Sintony:wght@700&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light dark;--fundo:#EEF4FB;--cartao:rgba(255,255,255,.72);--texto:#0B2540;--sub:#4C6178;--borda:rgba(16,110,190,.18)}
@media (prefers-color-scheme:dark){:root{--fundo:#06182B;--cartao:rgba(20,45,72,.6);--texto:#EAF3FF;--sub:#9DB4CC;--borda:rgba(15,252,190,.22)}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font-family:Poppins,system-ui,sans-serif;color:var(--texto);
background:radial-gradient(circle at 15% 10%,rgba(15,252,190,.25),transparent 40%),radial-gradient(circle at 90% 90%,rgba(16,110,190,.35),transparent 45%),var(--fundo)}
main{max-width:440px;width:100%;background:var(--cartao);border:1px solid var(--borda);border-radius:26px;padding:28px 24px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 20px 60px rgba(6,24,43,.18)}
h1{font-family:Sintony,Poppins,sans-serif;font-size:24px;margin:0 0 10px;color:#106EBE}@media (prefers-color-scheme:dark){h1{color:#0FFCBE}}
p{line-height:1.55;color:var(--sub);margin:0 0 18px}button{all:unset;cursor:pointer;display:block;text-align:center;width:100%;padding:14px 0;border-radius:999px;background:#0FFCBE;color:#071D33;font-weight:700;font-size:16px}
small{display:block;margin-top:16px;color:var(--sub);font-size:12px;text-align:center}
</style></head><body><main>${corpo}<small>Império Progressivas · enviado pela Sintonia</small></main></body></html>`;
}

export function registrarEmail(app: FastifyInstance, o: OpcoesRotasEmail): void {
  const em = o.email;

  // O "one-click" do List-Unsubscribe-Post chega como formulário.
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, corpo, feito) => feito(null, Object.fromEntries(new URLSearchParams(String(corpo)))));
  }

  const baseDe = (req: FastifyRequest) => {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    const local = /^(localhost|127\.)/.test(host);
    return `${String(req.headers['x-forwarded-proto'] ?? (local ? 'http' : 'https')).split(',')[0]}://${host}`;
  };
  const gestao = (req: FastifyRequest) => {
    if (!pode(req, 'email_marketing')) throw proibido('Só a gerência, a direção e a administração mexem no e-mail marketing.');
    em.verUrl(baseDe(req));
    return { nome: req.usuario?.nome ?? 'teste', email: req.usuario?.email };
  };
  const administracao = (req: FastifyRequest) => {
    if (req.usuario && !veTudo(req.usuario)) throw proibido('Só a direção e a administração configuram as contas de e-mail.');
    em.verUrl(baseDe(req));
    return { nome: req.usuario?.nome ?? 'teste', email: req.usuario?.email };
  };
  /** Gerente só manda para as unidades dela. */
  const limitarPublico = (req: FastifyRequest, p: unknown): unknown => {
    const u = req.usuario;
    if (!u || veTudo(u) || !p || typeof p !== 'object') return p;
    const pub = p as Partial<Publico>;
    const minhas = u.unidades as Publico['unidades'];
    const pedidas = (pub.unidades ?? []).filter((x) => minhas.includes(x));
    return { ...pub, unidades: pedidas.length ? pedidas : minhas };
  };
  const responder = async <T>(reply: FastifyReply, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroEmail) return reply.code(e.statusCode).send({ erro: e.message });
      throw e;
    }
  };

  // ---------------------------------------------------------------- contas (Conexões)
  app.get('/api/email/predefinicoes', async (req) => {
    administracao(req);
    return PREDEFINICOES;
  });
  app.get('/api/email/contas', async (req) => {
    gestao(req);
    return em.contas();
  });
  app.post('/api/email/contas', async (req, reply) => {
    const q = administracao(req);
    return responder(reply, async () => reply.code(201).send(await em.salvarConta(null, req.body, q.email ?? q.nome)));
  });
  app.put('/api/email/contas/:id', async (req, reply) => {
    const q = administracao(req);
    const { id } = Id.parse(req.params);
    return responder(reply, () => em.salvarConta(id, req.body, q.email ?? q.nome));
  });
  app.delete('/api/email/contas/:id', async (req, reply) => {
    administracao(req);
    const { id } = Id.parse(req.params);
    return responder(reply, async () => (await em.apagarConta(id), { ok: true }));
  });
  app.post('/api/email/contas/:id/testar', async (req, reply) => {
    const q = administracao(req);
    const { id } = Id.parse(req.params);
    const { para } = z.object({ para: z.string().trim().email().max(200).optional() }).parse(req.body ?? {});
    const destino = para ?? q.email;
    if (!destino) return reply.code(400).send({ erro: 'Informe para qual e-mail mandar o teste.' });
    return responder(reply, () => em.testarConta(id, destino));
  });
  app.post('/api/email/contas/ler-caixas', async (req) => {
    administracao(req);
    return em.lerCaixas();
  });

  // ---------------------------------------------------------------- modelos
  app.get('/api/email/modelos-prontos', async (req) => {
    gestao(req);
    return MODELOS_PRONTOS;
  });
  app.get('/api/email/modelos', async (req) => {
    gestao(req);
    return em.modelos();
  });
  app.post('/api/email/modelos', async (req, reply) => {
    const q = gestao(req);
    return responder(reply, async () => reply.code(201).send(await em.salvarModelo(null, req.body, q.nome)));
  });
  app.put('/api/email/modelos/:id', async (req, reply) => {
    const q = gestao(req);
    const { id } = Id.parse(req.params);
    return responder(reply, () => em.salvarModelo(id, req.body, q.nome));
  });
  app.delete('/api/email/modelos/:id', async (req) => {
    gestao(req);
    await em.apagarModelo(Id.parse(req.params).id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- campanhas
  app.get('/api/email/resumo', async (req) => {
    gestao(req);
    return em.resumo();
  });
  app.get('/api/email/campanhas', async (req) => {
    gestao(req);
    return em.campanhas();
  });
  app.post('/api/email/campanhas', async (req, reply) => {
    const q = gestao(req);
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    return responder(reply, async () => reply.code(201).send(await em.criarCampanha({ ...corpo, publico: limitarPublico(req, corpo.publico ?? {}) }, q.nome)));
  });
  app.get('/api/email/campanhas/:id', async (req, reply) => {
    gestao(req);
    return responder(reply, () => em.campanha(Id.parse(req.params).id));
  });
  app.put('/api/email/campanhas/:id', async (req, reply) => {
    gestao(req);
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    return responder(reply, () => em.alterarCampanha(Id.parse(req.params).id, corpo.publico ? { ...corpo, publico: limitarPublico(req, corpo.publico) } : corpo));
  });
  app.delete('/api/email/campanhas/:id', async (req, reply) => {
    gestao(req);
    return responder(reply, async () => (await em.apagarCampanha(Id.parse(req.params).id), { ok: true }));
  });
  app.post('/api/email/campanhas/:id/duplicar', async (req, reply) => {
    const q = gestao(req);
    return responder(reply, async () => reply.code(201).send(await em.duplicarCampanha(Id.parse(req.params).id, q.nome)));
  });
  app.post('/api/email/publico/contar', async (req, reply) => {
    gestao(req);
    return responder(reply, () => em.contarPublico(limitarPublico(req, (req.body as { publico?: unknown } | undefined)?.publico ?? req.body ?? {})));
  });
  app.post('/api/email/previa', { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    gestao(req);
    const b = z.object({ assunto: z.string().max(200).optional(), preheader: z.string().max(200).optional(), conteudo: z.unknown(), nome: z.string().max(80).optional() }).parse(req.body);
    return em.previa(b);
  });
  app.post('/api/email/campanhas/:id/teste', async (req, reply) => {
    const q = gestao(req);
    const { para } = z.object({ para: z.string().trim().email().max(200).optional() }).parse(req.body ?? {});
    const destino = para ?? q.email;
    if (!destino) return reply.code(400).send({ erro: 'Informe para qual e-mail mandar o teste.' });
    return responder(reply, () => em.enviarTeste(Id.parse(req.params).id, destino, q.nome));
  });
  app.post('/api/email/campanhas/:id/enviar', async (req, reply) => {
    gestao(req);
    const { quando } = z.object({ quando: z.string().datetime({ offset: true }).nullable().optional() }).parse(req.body ?? {});
    return responder(reply, async () => {
      const r = await em.enviarCampanha(Id.parse(req.params).id, quando ? new Date(quando) : null);
      o.avisar?.();
      return r;
    });
  });
  for (const acao of ['pausar', 'retomar', 'cancelar'] as const) {
    app.post(`/api/email/campanhas/:id/${acao}`, async (req, reply) => {
      gestao(req);
      return responder(reply, async () => {
        const r = await em[acao](Id.parse(req.params).id);
        if (acao === 'retomar') o.avisar?.();
        return r;
      });
    });
  }
  app.get('/api/email/campanhas/:id/relatorio', async (req, reply) => {
    gestao(req);
    return responder(reply, () => em.relatorio(Id.parse(req.params).id));
  });
  app.get('/api/email/historico', async (req) => {
    gestao(req);
    const q = z.object({ telefone: z.string().regex(/^\d{8,15}$/).optional(), email: z.string().email().max(200).optional() }).parse(req.query);
    return em.historico(q);
  });
  app.get('/api/email/supressoes', async (req) => {
    gestao(req);
    return em.supressoes();
  });
  app.delete('/api/email/supressoes/:email', async (req) => {
    administracao(req);
    await em.liberar(z.string().email().parse((req.params as { email: string }).email));
    return { ok: true };
  });

  // ---------------------------------------------------------------- rastreio público
  const semCache = (reply: FastifyReply) => reply.header('cache-control', 'no-store, private').header('referrer-policy', 'no-referrer').header('x-robots-tag', 'noindex');

  app.get('/e/a/:arquivo', async (req, reply) => {
    const token = String((req.params as { arquivo: string }).arquivo).replace(/\.gif$/, '');
    await em.abriu(token).catch(() => {});
    return semCache(reply).type('image/gif').send(PIXEL);
  });

  app.get('/e/c/:token/:i', async (req, reply) => {
    const p = req.params as { token: string; i: string };
    const url = await em.clicou(p.token, Number(p.i)).catch(() => null);
    semCache(reply);
    if (!url) return reply.code(404).type('text/html; charset=utf-8').send(paginaPublica('Link indisponível', '<h1>Link indisponível</h1><p>Este link não existe mais.</p>'));
    return reply.redirect(url, 302);
  });

  // GET mostra a confirmação (robôs de antivírus abrem links: não descadastram sozinhos); POST confirma.
  app.get('/e/d/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    semCache(reply).type('text/html; charset=utf-8').header('x-frame-options', 'DENY');
    if (token === 'teste') return paginaPublica('Descadastro (teste)', '<h1>Isto é um teste</h1><p>No e-mail de verdade, este botão tira a pessoa da lista.</p>');
    if (!/^[0-9a-f]{48}$/.test(token)) return reply.code(404).send(paginaPublica('Link inválido', '<h1>Link inválido</h1><p>Confira se o endereço está completo.</p>'));
    return paginaPublica(
      'Não receber mais e-mails',
      `<h1>Não quer mais receber nossos e-mails?</h1><p>Tudo bem! Confirme abaixo e você não recebe mais e-mails de marketing da Império Progressivas.</p>
       <form method="post" action="/e/d/${token}"><input type="hidden" name="confirmar" value="1"><button type="submit">Confirmar descadastro</button></form>`,
    );
  });
  app.post('/e/d/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const r = await em.descadastrar(token).catch(() => ({ ok: false as const }));
    semCache(reply).type('text/html; charset=utf-8');
    if (!r.ok) return reply.code(404).send(paginaPublica('Link inválido', '<h1>Link inválido</h1><p>Não encontramos este e-mail.</p>'));
    return paginaPublica('Descadastro feito', `<h1>Pronto, descadastrado ✓</h1><p>O endereço ${esc(r.email ?? '')} não recebe mais nossos e-mails de marketing. Se foi sem querer, fale com a gente no WhatsApp.</p>`);
  });
}

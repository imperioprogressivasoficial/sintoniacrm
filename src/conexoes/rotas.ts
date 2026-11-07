import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { usuarioDaRequisicao, type OpcoesAuth } from '../auth/rotas.js';
import { EvolutionAdmin, PREFIXO_INSTANCIA } from '../channels/evolution-admin.js';
import type { Conexoes, NumeroCfg } from './conexoes.js';

export interface OpcoesConexoes {
  conexoes: Conexoes;
  auth?: OpcoesAuth;
  /** Confere uma chave da IA (chamada barata). */
  testarIA: (chave: string) => Promise<void>;
  /** Confere a chave da Trinks lendo os profissionais de uma unidade. */
  testarTrinks: (chave: string) => Promise<{ profissionais: number }>;
  fetchFn?: typeof fetch;
}

const PAPEIS_PERMITIDOS = new Set(['admin', 'direcao']);
const UNIDADES = ['norte', 'sumare'] as const;
const Unidade = z.enum(UNIDADES);

const Salvar = z.object({
  anthropicApiKey: z.string().max(400).optional(),
  trinksApiKey: z.string().max(400).optional(),
  evolutionUrl: z.union([z.literal(''), z.string().url().max(300)]).optional(),
  evolutionApiKey: z.string().max(400).optional(),
  relatorioDestinos: z.string().max(400).optional(),
});

/** Tela de Conexões: chaves da IA, Trinks, Evolution e o WhatsApp de cada loja (QR Code). */
export function registrarConexoes(app: FastifyInstance, o: OpcoesConexoes): void {
  const c = o.conexoes;

  async function quem(req: FastifyRequest): Promise<string> {
    if (!o.auth) return 'teste';
    const u = await usuarioDaRequisicao(req, o.auth);
    if (!u || !PAPEIS_PERMITIDOS.has(u.papel)) throw Object.assign(new Error('Só a administração mexe nas conexões'), { statusCode: 403 });
    return u.email;
  }

  function evolution(): EvolutionAdmin {
    const url = c.get('evolutionUrl');
    const chave = c.get('evolutionApiKey');
    if (!url || !chave) throw Object.assign(new Error('Preencha o endereço e a chave da Evolution primeiro'), { statusCode: 400 });
    return new EvolutionAdmin(url, chave, o.fetchFn);
  }

  const webhookDe = (req: FastifyRequest) => {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    const local = /^(localhost|127\.)/.test(host);
    return { url: `${local ? 'http' : 'https'}://${host}/webhooks/evolution`, token: c.get('webhookToken') ?? '' };
  };

  async function definirNumero(unidade: (typeof UNIDADES)[number], ligado: boolean, quemFez: string) {
    const canalId = `${PREFIXO_INSTANCIA}${unidade}`;
    const outros = c.numeros().filter((n) => n.canalId !== canalId);
    const lista: NumeroCfg[] = ligado ? [...outros, { canalId, unidade }] : outros;
    await c.salvar({ numeros: JSON.stringify(lista) }, quemFez);
  }

  app.get('/api/conexoes', async (req) => {
    await quem(req);
    return c.resumo();
  });

  app.put('/api/conexoes', async (req) => {
    const autor = await quem(req);
    await c.salvar(Salvar.parse(req.body), autor);
    return c.resumo();
  });

  app.post('/api/conexoes/testar', async (req, reply) => {
    await quem(req);
    const { alvo } = z.object({ alvo: z.enum(['ia', 'trinks', 'evolution']) }).parse(req.body);
    try {
      if (alvo === 'ia') {
        const k = c.get('anthropicApiKey');
        if (!k) return reply.code(400).send({ ok: false, erro: 'Chave da IA não preenchida' });
        await o.testarIA(k);
        return { ok: true, mensagem: 'IA respondendo' };
      }
      if (alvo === 'trinks') {
        const k = c.get('trinksApiKey');
        if (!k) return reply.code(400).send({ ok: false, erro: 'Chave da Trinks não preenchida' });
        const r = await o.testarTrinks(k);
        return { ok: true, mensagem: `Trinks respondendo (${r.profissionais} profissionais no Norte)` };
      }
      const r = await evolution().testar();
      return { ok: true, mensagem: `Evolution respondendo (${r.instancias} instâncias)` };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 400) throw e;
      return reply.code(200).send({ ok: false, erro: String((e as Error).message ?? e).slice(0, 300) });
    }
  });

  app.get('/api/conexoes/whatsapp', async (req) => {
    await quem(req);
    if (!c.get('evolutionUrl') || !c.get('evolutionApiKey')) return { configurada: false, unidades: [] };
    const adm = evolution();
    const unidades = await Promise.all(
      UNIDADES.map(async (u) => {
        try {
          return { unidade: u, ...(await adm.info(`${PREFIXO_INSTANCIA}${u}`)) };
        } catch (e) {
          return { unidade: u, nome: `${PREFIXO_INSTANCIA}${u}`, estado: 'erro', erro: String((e as Error).message).slice(0, 200) };
        }
      }),
    );
    return { configurada: true, unidades };
  });

  app.post('/api/conexoes/whatsapp/:unidade/conectar', async (req) => {
    const autor = await quem(req);
    const unidade = Unidade.parse((req.params as { unidade: string }).unidade);
    const r = await evolution().conectar(`${PREFIXO_INSTANCIA}${unidade}`, webhookDe(req));
    await definirNumero(unidade, true, autor);
    return r;
  });

  app.post('/api/conexoes/whatsapp/:unidade/desconectar', async (req) => {
    const autor = await quem(req);
    const unidade = Unidade.parse((req.params as { unidade: string }).unidade);
    await evolution().desconectar(`${PREFIXO_INSTANCIA}${unidade}`).catch((e) => {
      if ((e as { status?: number }).status !== 404) throw e;
    });
    await definirNumero(unidade, false, autor);
    return { ok: true };
  });
}

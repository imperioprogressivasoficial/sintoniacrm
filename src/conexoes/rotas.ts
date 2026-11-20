import { lerWebhookEvolution } from '../channels/evolution.js';
import type { MensagemRecebida } from '../channels/tipos.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { usuarioDaRequisicao, type OpcoesAuth } from '../auth/rotas.js';
import { EvolutionAdmin, PREFIXO_INSTANCIA } from '../channels/evolution-admin.js';
import { GraphMeta } from '../channels/meta.js';
import { CamposSociais, registrarRotasSociais } from './sociais.js';
import { NOMES_SISTEMA } from '../agenda/sistema.js';
import { UNIDADES_AGENDA, type AgendasDasUnidades } from '../agenda/unidades-agenda.js';
import { campoCanal, campoMeta, novoVerifyToken, UNIDADES_WHATSAPP, type Conexoes, type NumeroCfg, type UnidadeWhatsApp } from './conexoes.js';

export interface OpcoesConexoes {
  conexoes: Conexoes;
  auth?: OpcoesAuth;
  /** Confere uma chave da IA (chamada barata). */
  testarIA: (chave: string) => Promise<void>;
  /** Confere a chave da Trinks lendo os profissionais de uma unidade. */
  testarTrinks: (chave: string) => Promise<{ resumo: string }>;
  /** Confere a chave da OpenAI (transcrição de áudio). Ausente = não testa. */
  testarOpenAI?: (chave: string) => Promise<void>;
  fetchFn?: typeof fetch;
  /** Agenda de cada unidade (Trinks, Avec ou AppBarber): status e "Testar" em Conexões › Agenda. */
  agendas?: AgendasDasUnidades;
  /** Grava conversas antigas puxadas do WhatsApp (sem IA nem avisos). */
  importarHistorico?: (mensagens: MensagemRecebida[]) => Promise<{ conversas: number; mensagens: number }>;
  /** Quando chegou o último webhook da Meta para o número (phone_number_id). */
  ultimoWebhookMeta?: (phoneNumberId: string) => Date | undefined;
}

const PAPEIS_PERMITIDOS = new Set(['admin', 'direcao']);
const UNIDADES = UNIDADES_WHATSAPP;
const Unidade = z.enum(UNIDADES);

const IdMeta = z.string().trim().regex(/^\d*$/, 'Use só os números do id (copie do painel da Meta)').max(40).optional();
const Segredo = z.string().max(600).optional();
const Canal = z.enum(['evolution', 'meta']).optional();
// Vazio = volta ao padrão (Trinks).
const SistemaAgenda = z.enum(['', 'trinks', 'avec', 'appbarber', 'nenhum']).optional();
const IdLoja = z.string().trim().regex(/^[\w.-]*$/, 'Use só letras, números, ponto, hífen ou sublinhado no ID').max(60).optional();
const UrlOpcional = z.union([z.literal(''), z.string().trim().url().max(300)]).optional();

const Salvar = z.object({
  anthropicApiKey: z.string().max(400).optional(),
  trinksApiKey: z.string().max(400).optional(),
  trinksEstabelecimentoNorte: z.string().trim().regex(/^\d*$/, 'Use só os números do ID do estabelecimento').max(20).optional(),
  trinksEstabelecimentoSumare: z.string().trim().regex(/^\d*$/, 'Use só os números do ID do estabelecimento').max(20).optional(),
  agendaSistemaNorte: SistemaAgenda,
  agendaSistemaSumare: SistemaAgenda,
  avecUrl: UrlOpcional,
  avecTokenNorte: Segredo,
  avecTokenSumare: Segredo,
  avecUnidadeNorte: IdLoja,
  avecUnidadeSumare: IdLoja,
  appbarberUrl: UrlOpcional,
  appbarberTokenNorte: Segredo,
  appbarberTokenSumare: Segredo,
  appbarberLojaNorte: IdLoja,
  appbarberLojaSumare: IdLoja,
  openaiApiKey: z.string().max(400).optional(),
  evolutionUrl: z.union([z.literal(''), z.string().url().max(300)]).optional(),
  evolutionApiKey: z.string().max(400).optional(),
  relatorioDestinos: z.string().max(400).optional(),
  canalNorte: Canal,
  canalSumare: Canal,
  metaPhoneNumberIdNorte: IdMeta,
  metaWabaIdNorte: IdMeta,
  metaTokenNorte: Segredo,
  metaAppSecretNorte: Segredo,
  metaPhoneNumberIdSumare: IdMeta,
  metaWabaIdSumare: IdMeta,
  metaTokenSumare: Segredo,
  metaAppSecretSumare: Segredo,
  ...CamposSociais,
  asaasApiKey: Segredo,
  asaasWebhookToken: Segredo,
  asaasSandbox: z.enum(['', '1']).optional(),
  cobrancaNome: z.string().trim().max(120).optional(),
  cobrancaEmail: z.union([z.literal(''), z.string().trim().email('E-mail de cobrança inválido').max(200)]).optional(),
  cobrancaCpfCnpj: z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s === '' || s.length === 11 || s.length === 14, 'CPF tem 11 números e CNPJ tem 14')
    .optional(),
});
const NOMES: Record<UnidadeWhatsApp, string> = { norte: 'Salvador Norte Shopping', sumare: 'Shopping Sumaré' };

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

  const baseDe = (req: FastifyRequest) => {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    const local = /^(localhost|127\.)/.test(host);
    return `${local ? 'http' : 'https'}://${host}`;
  };
  const webhookDe = (req: FastifyRequest) => ({ url: `${baseDe(req)}/webhooks/evolution`, token: c.get('webhookToken') ?? '' });

  /** Conta da API oficial da unidade, ou 400 explicando o que falta. */
  function contaMeta(u: UnidadeWhatsApp) {
    const conta = c.contaMeta(u);
    if (!conta) throw Object.assign(new Error(`Preencha o Phone Number ID e o token de acesso de ${NOMES[u]} primeiro`), { statusCode: 400 });
    return conta;
  }
  const erroCurto = (e: unknown) => String((e as Error).message ?? e).slice(0, 400);

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
    const dados = Salvar.parse(req.body);
    // Ligar a API oficial numa unidade exige o mínimo dela (o que já está salvo ou o que vem junto).
    for (const u of UNIDADES) {
      if ((dados as Record<string, unknown>)[campoCanal(u)] !== 'meta') continue;
      const valor = (parte: 'PhoneNumberId' | 'Token') => {
        const novo = (dados as Record<string, string | undefined>)[campoMeta(parte, u)];
        return novo !== undefined ? novo.trim() : c.get(campoMeta(parte, u));
      };
      if (!valor('PhoneNumberId') || !valor('Token')) {
        throw Object.assign(new Error(`Para ${NOMES[u]} usar a API oficial, preencha antes o Phone Number ID e o token de acesso`), { statusCode: 400 });
      }
    }
    await c.salvar(dados, autor);
    return c.resumo();
  });

  // ---------- Agenda: sistema de cada unidade ----------
  const UnidadeAgendaZ = z.enum(UNIDADES_AGENDA);
  app.get('/api/conexoes/agenda', async (req) => {
    await quem(req);
    if (!o.agendas) return { unidades: [] };
    return {
      sistemas: Object.entries(NOMES_SISTEMA).map(([id, nome]) => ({ id, nome })),
      unidades: o.agendas.configs().map((cfg) => ({
        unidade: cfg.unidade,
        nome: cfg.nome,
        sistema: cfg.escolha,
        sistemaNome: cfg.sistemaNome,
        local: cfg.local,
        falta: cfg.falta,
        conectada: cfg.conectada,
        pronta: cfg.pronta,
        aviso: cfg.aviso,
      })),
    };
  });

  app.post('/api/conexoes/agenda/:unidade/testar', async (req, reply) => {
    await quem(req);
    const u = UnidadeAgendaZ.parse((req.params as { unidade: string }).unidade);
    if (!o.agendas) return reply.code(501).send({ ok: false, erro: 'Agenda não disponível neste servidor' });
    const cfg = o.agendas.config(u);
    if (cfg.escolha === 'nenhum') return { ok: false, erro: `${cfg.nome} está sem sistema de agenda.` };
    if (cfg.falta.length) return { ok: false, erro: `Falta preencher: ${cfg.falta.join(', ')}.` };
    try {
      const resumo = await o.agendas.sistemaDa(u)!.testar(cfg.local!);
      return { ok: true, mensagem: `${cfg.sistemaNome} respondendo: ${resumo}` };
    } catch (e) {
      return { ok: false, erro: erroCurto(e) };
    }
  });

  // ---------- WhatsApp oficial (Meta) ----------
  app.get('/api/conexoes/meta', async (req) => {
    await quem(req);
    const unidades = UNIDADES.map((u) => {
      const conta = c.contaMeta(u);
      const faltando: string[] = [];
      if (!c.get(campoMeta('PhoneNumberId', u))) faltando.push('Phone Number ID');
      if (!c.get(campoMeta('WabaId', u))) faltando.push('WhatsApp Business Account ID');
      if (!c.get(campoMeta('Token', u))) faltando.push('token de acesso');
      if (!c.get(campoMeta('AppSecret', u))) faltando.push('App Secret');
      const visto = conta ? o.ultimoWebhookMeta?.(conta.phoneNumberId) : undefined;
      return {
        unidade: u,
        nome: NOMES[u],
        canal: c.canalDaUnidade(u),
        pronta: Boolean(conta?.appSecret),
        faltando,
        verifyToken: c.get(campoMeta('VerifyToken', u)) ?? null,
        ultimoWebhook: visto ? visto.toISOString() : null,
      };
    });
    return { webhookUrl: `${baseDe(req)}/webhook/meta`, unidades };
  });

  app.post('/api/conexoes/meta/:unidade/testar', async (req) => {
    await quem(req);
    const u = Unidade.parse((req.params as { unidade: string }).unidade);
    const conta = contaMeta(u);
    try {
      const graph = new GraphMeta(conta.token, o.fetchFn);
      const info = await graph.infoNumero(conta.phoneNumberId);
      let modelos: number | undefined;
      if (conta.wabaId) modelos = (await graph.modelosAprovados(conta.wabaId)).length;
      const partes = [info.numero, info.nome, info.qualidade ? `qualidade ${info.qualidade}` : undefined, modelos !== undefined ? `${modelos} modelo(s) aprovado(s)` : undefined];
      return { ok: true, mensagem: `Número respondendo: ${partes.filter(Boolean).join(' · ')}`, ...info, modelos };
    } catch (e) {
      return { ok: false, erro: erroCurto(e) };
    }
  });

  app.get('/api/conexoes/meta/:unidade/modelos', async (req, reply) => {
    await quem(req);
    const u = Unidade.parse((req.params as { unidade: string }).unidade);
    const conta = contaMeta(u);
    if (!conta.wabaId) return reply.code(400).send({ erro: `Preencha o WhatsApp Business Account ID de ${NOMES[u]} para ver os modelos` });
    try {
      return { modelos: await new GraphMeta(conta.token, o.fetchFn).modelosAprovados(conta.wabaId) };
    } catch (e) {
      return reply.code(502).send({ erro: erroCurto(e) });
    }
  });

  /** Gera outro Verify Token (o antigo deixa de valer: cole o novo no painel da Meta). */
  app.post('/api/conexoes/meta/:unidade/verify-token', async (req) => {
    const autor = await quem(req);
    const u = Unidade.parse((req.params as { unidade: string }).unidade);
    await c.salvar({ [campoMeta('VerifyToken', u)]: novoVerifyToken() }, autor);
    return { verifyToken: c.get(campoMeta('VerifyToken', u)) };
  });

  // ---------- Facebook Messenger, Instagram Direct e TikTok ----------
  registrarRotasSociais(app, { conexoes: c, quem, baseDe, fetchFn: o.fetchFn });

  app.post('/api/conexoes/testar', async (req, reply) => {
    await quem(req);
    const { alvo } = z.object({ alvo: z.enum(['ia', 'trinks', 'evolution', 'openai']) }).parse(req.body);
    try {
      if (alvo === 'ia') {
        const k = c.get('anthropicApiKey');
        if (!k) return reply.code(400).send({ ok: false, erro: 'Chave da IA não preenchida' });
        await o.testarIA(k);
        return { ok: true, mensagem: 'IA respondendo' };
      }
      if (alvo === 'openai') {
        const k = c.get('openaiApiKey');
        if (!k) return reply.code(400).send({ ok: false, erro: 'Chave da OpenAI não preenchida' });
        if (!o.testarOpenAI) return { ok: true, mensagem: 'Chave salva' };
        await o.testarOpenAI(k);
        return { ok: true, mensagem: 'Transcrição pronta' };
      }
      if (alvo === 'trinks') {
        const k = c.get('trinksApiKey');
        if (!k) return reply.code(400).send({ ok: false, erro: 'Chave da Trinks não preenchida' });
        const r = await o.testarTrinks(k);
        return { ok: true, mensagem: `Trinks respondendo: ${r.resumo}` };
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

  // ---------------------------------------------------------------- canais de WhatsApp (sem loja fixa)
  // Cada canal é uma instância da Evolution "sintonia-…". A pessoa cria quantos quiser e dá o nome que quiser.
  const IdCanal = z.string().regex(/^sintonia-[a-z0-9-]{2,40}$/);
  const NomeCanal = z.string().trim().min(1, 'Dê um nome ao canal.').max(40);
  const ehCanalEvo = (n: NumeroCfg) => n.canalId.startsWith(PREFIXO_INSTANCIA);
  const canaisSalvos = () => c.numeros().filter(ehCanalEvo);
  const nomeDe = (n: NumeroCfg, i: number) => n.nome?.trim() || `WhatsApp ${i + 1}`;
  async function salvarCanais(lista: NumeroCfg[], autor: string) {
    await c.salvar({ numeros: JSON.stringify([...c.numeros().filter((n) => !ehCanalEvo(n)), ...lista]) }, autor);
  }
  const numeroDe = (req: FastifyRequest) => {
    const bruto = String((req.body as { numero?: unknown } | undefined)?.numero ?? '').replace(/\D/g, '');
    if (bruto && (bruto.length < 10 || bruto.length > 13)) throw Object.assign(new Error('Número inválido. Use DDD + número, ex.: 71 99999-9999.'), { statusCode: 400 });
    return bruto ? (bruto.length <= 11 ? `55${bruto}` : bruto) : undefined;
  };
  const canalExistente = (id: string) => {
    const n = canaisSalvos().find((x) => x.canalId === id);
    if (!n) throw Object.assign(new Error('Canal não encontrado.'), { statusCode: 404 });
    return n;
  };

  app.get('/api/conexoes/whatsapp/canais', async (req) => {
    await quem(req);
    const salvos = canaisSalvos();
    const configurada = Boolean(c.get('evolutionUrl') && c.get('evolutionApiKey'));
    let infos: Awaited<ReturnType<EvolutionAdmin['listar']>> = [];
    let erro: string | null = null;
    if (configurada) {
      try { infos = await evolution().listar(); } catch (e) { erro = erroCurto(e).slice(0, 200); }
    }
    // Instâncias da Sintonia que já existem na Evolution mas não estão na lista (ex.: de antes) entram e ficam salvas com nome.
    const novos = infos.filter((i) => !salvos.some((n) => n.canalId === i.nome)).map((i, k) => ({ canalId: i.nome, unidade: UNIDADES[0], nome: `WhatsApp ${salvos.length + k + 1}` }) as NumeroCfg);
    const todos = [...salvos, ...novos];
    if (novos.length) await salvarCanais(todos, 'sistema');
    return {
      configurada,
      erro,
      canais: todos.map((n, i) => {
        const info = infos.find((x) => x.nome === n.canalId);
        return { id: n.canalId, nome: nomeDe(n, i), estado: erro ? 'erro' : (info?.estado ?? 'inexistente'), numero: info?.numero ?? null, perfil: info?.perfil ?? null };
      }),
    };
  });

  app.post('/api/conexoes/whatsapp/canais', async (req) => {
    const autor = await quem(req);
    const salvos = canaisSalvos();
    const pedido = (req.body as { nome?: unknown } | undefined)?.nome;
    const nome = pedido === undefined || pedido === '' ? `WhatsApp ${salvos.length + 1}` : NomeCanal.parse(pedido);
    let id: string;
    do id = `${PREFIXO_INSTANCIA}c${Math.random().toString(36).slice(2, 8)}`; while (salvos.some((n) => n.canalId === id));
    await salvarCanais([...salvos, { canalId: id, unidade: UNIDADES[0], nome }], autor);
    return { id, nome };
  });

  app.patch('/api/conexoes/whatsapp/canais/:id', async (req) => {
    const autor = await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    const nome = NomeCanal.parse((req.body as { nome?: unknown } | undefined)?.nome);
    const salvos = canaisSalvos();
    const ja = salvos.some((n) => n.canalId === id);
    // Canal antigo que só existia na Evolution: passa a ficar salvo com o nome novo.
    await salvarCanais(ja ? salvos.map((n) => (n.canalId === id ? { ...n, nome } : n)) : [...salvos, { canalId: id, unidade: UNIDADES[0], nome }], autor);
    return { id, nome };
  });

  app.delete('/api/conexoes/whatsapp/canais/:id', async (req) => {
    const autor = await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    if (c.get('evolutionUrl') && c.get('evolutionApiKey')) await evolution().apagar(id);
    await salvarCanais(canaisSalvos().filter((n) => n.canalId !== id), autor);
    return { ok: true };
  });

  app.post('/api/conexoes/whatsapp/canais/:id/conectar', async (req) => {
    const autor = await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    const numero = numeroDe(req);
    if (!canaisSalvos().some((n) => n.canalId === id)) await salvarCanais([...canaisSalvos(), { canalId: id, unidade: UNIDADES[0] }], autor);
    return evolution().conectar(id, webhookDe(req), numero);
  });

  // Puxa as conversas recentes do WhatsApp para a Sintonia (tela "Sincronizando" depois de conectar).
  app.post('/api/conexoes/whatsapp/canais/:id/sincronizar', async (req) => {
    await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    if (!o.importarHistorico) throw Object.assign(new Error('Sincronização indisponível'), { statusCode: 503 });
    const brutas = await evolution().historico(id);
    const mensagens = lerWebhookEvolution({ event: 'messages.upsert', instance: id, data: brutas });
    return o.importarHistorico(mensagens);
  });

  // Código em vigor (a Evolution troca enquanto espera): a tela confere e atualiza o que mostra.
  app.get('/api/conexoes/whatsapp/canais/:id/codigo', async (req) => {
    await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    return { codigo: await evolution().codigoAtual(id).catch(() => null) };
  });

  app.post('/api/conexoes/whatsapp/canais/:id/desconectar', async (req) => {
    await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    canalExistente(id);
    await evolution().desconectar(id).catch((e) => {
      if ((e as { status?: number }).status !== 404) throw e;
    });
    return { ok: true };
  });

  app.post('/api/conexoes/whatsapp/:unidade/conectar', async (req) => {
    const autor = await quem(req);
    const unidade = Unidade.parse((req.params as { unidade: string }).unidade);
    // Código pelo número (opcional): só dígitos; sem DDI, assume Brasil (55).
    const bruto = String((req.body as { numero?: unknown } | undefined)?.numero ?? '').replace(/\D/g, '');
    if (bruto && (bruto.length < 10 || bruto.length > 13)) throw Object.assign(new Error('Número inválido. Use DDD + número, ex.: 71 99999-9999.'), { statusCode: 400 });
    const numero = bruto ? (bruto.length <= 11 ? `55${bruto}` : bruto) : undefined;
    const r = await evolution().conectar(`${PREFIXO_INSTANCIA}${unidade}`, webhookDe(req), numero);
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

import { lerWebhookEvolution } from '../channels/evolution.js';
import type { MensagemRecebida } from '../channels/tipos.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { usuarioDaRequisicao, type OpcoesAuth } from '../auth/rotas.js';
import { EvolutionAdmin, PREFIXO_INSTANCIA } from '../channels/evolution-admin.js';
import type { SaudeWhatsApp } from '../channels/whatsapp-saude.js';
import { GraphMeta } from '../channels/meta.js';
import { CamposSociais, registrarRotasSociais } from './sociais.js';
import { NOMES_SISTEMA } from '../agenda/sistema.js';
import type { AgendasDasUnidades } from '../agenda/unidades-agenda.js';
import { campoCanal, campoDeUnidade, campoMeta, novoVerifyToken, unidadesWhatsApp, type BaseUnidade, type Conexoes, type NumeroCfg, type UnidadeWhatsApp } from './conexoes.js';
import { existeUnidade, primeiraUnidade, unidadeDe, zUnidade } from '../unidades.js';
import { AVISO_COPIAS, type Quem, type TrocaNumero } from './troca-numero.js';

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
  /* grupos: "Sincronizar conversas" também desliga o "ignorar grupos" e traz os grupos (Conversas de grupo). */
  sincronizarGrupos?: () => Promise<unknown>;
  /** Quanto do histórico do WhatsApp já chegou depois de conectar. */
  progressoHistorico?: (canalId: string) => { mensagens: number; conversas: number; em: Date } | undefined;
  /** meta-historico: conversas antigas do Messenger/Instagram ao conectar (src/conexoes/historico-meta.ts). */
  historicoMeta?: import('./historico-meta.js').HistoricoMeta;
  /** Saúde do WhatsApp não oficial (selo de cada canal, reconectar, avisos). */
  saude?: SaudeWhatsApp;
  /** Quando chegou o último webhook da Meta para o número (phone_number_id). */
  ultimoWebhookMeta?: (phoneNumberId: string) => Date | undefined;
  /** trocar-numero: número de cada canal, troca detectada e o que fazer com as conversas do número anterior. */
  trocaNumero?: TrocaNumero;
}

const PAPEIS_PERMITIDOS = new Set(['admin', 'direcao']);
// Unidade da URL: uma unidade ativa do cadastro (Empresa › Unidades).
const Unidade = zUnidade({ ativa: true });

const IdMeta = z.string().trim().regex(/^\d*$/, 'Use só os números do id (copie do painel da Meta)').max(40).optional();
const Segredo = z.string().max(600).optional();
const Canal = z.enum(['evolution', 'meta']).optional();
// Vazio = volta ao padrão (Trinks).
const SistemaAgenda = z.enum(['', 'trinks', 'avec', 'appbarber', 'nenhum']).optional();
const IdLoja = z.string().trim().regex(/^[\w.-]*$/, 'Use só letras, números, ponto, hífen ou sublinhado no ID').max(60).optional();
const UrlOpcional = z.union([z.literal(''), z.string().trim().url().max(300)]).optional();

/** Campos de cada unidade (o nome do campo leva a unidade: "metaTokenNorte", "metaToken__loja-1"). */
const POR_UNIDADE: Record<Exclude<BaseUnidade, 'metaVerifyToken'>, z.ZodTypeAny> = {
  trinksEstabelecimento: z.string().trim().regex(/^\d*$/, 'Use só os números do ID do estabelecimento').max(20).optional(),
  agendaSistema: SistemaAgenda,
  avecToken: Segredo,
  avecUnidade: IdLoja,
  appbarberToken: Segredo,
  appbarberLoja: IdLoja,
  canal: Canal,
  metaPhoneNumberId: IdMeta,
  metaWabaId: IdMeta,
  metaToken: Segredo,
  metaAppSecret: Segredo,
};

const SalvarFixo = z.object({
  anthropicApiKey: z.string().max(400).optional(),
  trinksApiKey: z.string().max(400).optional(),
  avecUrl: UrlOpcional,
  appbarberUrl: UrlOpcional,
  openaiApiKey: z.string().max(400).optional(),
  evolutionUrl: z.union([z.literal(''), z.string().url().max(300)]).optional(),
  evolutionApiKey: z.string().max(400).optional(),
  relatorioDestinos: z.string().max(400).optional(),
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
/** O corpo do PUT /api/conexoes: campos fixos + os de cada unidade do cadastro (campo de unidade desconhecida é ignorado). */
const Salvar = {
  parse(corpo: unknown): Record<string, string | undefined> {
    const fixos = SalvarFixo.parse(corpo ?? {}) as Record<string, string | undefined>;
    const r: Record<string, string | undefined> = { ...fixos };
    for (const [k, v] of Object.entries((corpo ?? {}) as Record<string, unknown>)) {
      const cu = campoDeUnidade(k);
      if (!cu || cu.base === 'metaVerifyToken' || !existeUnidade(cu.unidade)) continue;
      const s = POR_UNIDADE[cu.base].safeParse(v);
      if (!s.success) throw Object.assign(new Error(s.error.issues[0]?.message ?? `Confira o campo ${k}.`), { statusCode: 400 });
      r[k] = s.data as string | undefined;
    }
    return r;
  },
};
const nomeDa = (u: UnidadeWhatsApp) => unidadeDe(u).nome;

/** Tela de Conexões: chaves da IA, Trinks, Evolution e o WhatsApp de cada loja (QR Code). */
export function registrarConexoes(app: FastifyInstance, o: OpcoesConexoes): void {
  const c = o.conexoes;

  async function quem(req: FastifyRequest): Promise<string> {
    return (await quemFez(req)).email;
  }
  /** trocar-numero: quem está mexendo (nome e papel vão para a auditoria). */
  async function quemFez(req: FastifyRequest): Promise<Quem & { email: string }> {
    if (!o.auth) return { email: 'teste', papel: 'admin', nome: 'teste' };
    const u = await usuarioDaRequisicao(req, o.auth);
    if (!u || !PAPEIS_PERMITIDOS.has(u.papel)) throw Object.assign(new Error('Só a administração mexe nas conexões'), { statusCode: 403 });
    return { email: u.email, id: u.id, nome: u.nome, papel: u.papel };
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
    if (!conta) throw Object.assign(new Error(`Preencha o Phone Number ID e o token de acesso de ${nomeDa(u)} primeiro`), { statusCode: 400 });
    return conta;
  }
  const erroCurto = (e: unknown) => String((e as Error).message ?? e).slice(0, 400);

  async function definirNumero(unidade: UnidadeWhatsApp, ligado: boolean, quemFez: string) {
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
    for (const u of unidadesWhatsApp()) {
      if ((dados as Record<string, unknown>)[campoCanal(u)] !== 'meta') continue;
      const valor = (parte: 'PhoneNumberId' | 'Token') => {
        const novo = (dados as Record<string, string | undefined>)[campoMeta(parte, u)];
        return novo !== undefined ? novo.trim() : c.get(campoMeta(parte, u));
      };
      if (!valor('PhoneNumberId') || !valor('Token')) {
        throw Object.assign(new Error(`Para ${nomeDa(u)} usar a API oficial, preencha antes o Phone Number ID e o token de acesso`), { statusCode: 400 });
      }
    }
    await c.salvar(dados, autor);
    return c.resumo();
  });

  // ---------- Agenda: sistema de cada unidade ----------
  const UnidadeAgendaZ = Unidade;
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
    const unidades = unidadesWhatsApp().map((u) => {
      const conta = c.contaMeta(u);
      const faltando: string[] = [];
      if (!c.get(campoMeta('PhoneNumberId', u))) faltando.push('Phone Number ID');
      if (!c.get(campoMeta('WabaId', u))) faltando.push('WhatsApp Business Account ID');
      if (!c.get(campoMeta('Token', u))) faltando.push('token de acesso');
      if (!c.get(campoMeta('AppSecret', u))) faltando.push('App Secret');
      const visto = conta ? o.ultimoWebhookMeta?.(conta.phoneNumberId) : undefined;
      return {
        unidade: u,
        nome: nomeDa(u),
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
    if (!conta.wabaId) return reply.code(400).send({ erro: `Preencha o WhatsApp Business Account ID de ${nomeDa(u)} para ver os modelos` });
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
  registrarRotasSociais(app, { conexoes: c, quem, baseDe, fetchFn: o.fetchFn, ...(o.historicoMeta ? { historicoMeta: o.historicoMeta } : {}) });

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
      unidadesWhatsApp().map(async (u) => {
        try {
          const info = await adm.info(`${PREFIXO_INSTANCIA}${u}`);
          if (info.estado === 'conectada') await o.trocaNumero?.observar(info.nome, u, info.numero).catch(() => false); /* trocar-numero */
          return { unidade: u, ...info };
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
  /** Unidade que o canal atende: a que veio no corpo (unidade ativa do cadastro) ou a primeira. */
  const unidadeDoCanal = (req: FastifyRequest): UnidadeWhatsApp => {
    const pedida = (req.body as { unidade?: unknown } | undefined)?.unidade;
    return pedida === undefined || pedida === '' || pedida === null ? primeiraUnidade() : Unidade.parse(pedida);
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
    const novos = infos.filter((i) => !salvos.some((n) => n.canalId === i.nome)).map((i, k) => ({ canalId: i.nome, unidade: primeiraUnidade(), nome: `WhatsApp ${salvos.length + k + 1}` }) as NumeroCfg);
    const todos = [...salvos, ...novos];
    if (novos.length) await salvarCanais(todos, 'sistema');
    // O que a tela acabou de ler também atualiza a saúde (conectou: some a faixa na hora).
    for (const i of infos) if (i.estado === 'conectada') o.saude?.marcarConectado(i.nome);
    /* trocar-numero: guarda o número de cada canal conectado; outro número no lugar do anterior = troca pendente */
    const trocas = new Map<string, Awaited<ReturnType<TrocaNumero['situacao']>>>();
    if (o.trocaNumero) {
      for (const n of todos) {
        const info = infos.find((x) => x.nome === n.canalId);
        try {
          if (info?.estado === 'conectada') await o.trocaNumero.observar(n.canalId, n.unidade, info.numero);
          trocas.set(n.canalId, await o.trocaNumero.situacao(n.canalId, n.unidade));
        } catch (e) {
          req.log.warn({ erro: String(e) }, 'troca de número: falha ao conferir');
        }
      }
    }
    return {
      configurada,
      erro,
      canais: todos.map((n, i) => {
        const info = infos.find((x) => x.nome === n.canalId);
        const s = o.saude?.canal(n.canalId);
        const t = trocas.get(n.canalId);
        return {
          // trocar-numero: outro número conectou e falta decidir o que fazer com as conversas do anterior.
          troca: t ? { em: t.trocaEm.toISOString(), numeroAnterior: t.numeroAnterior, numeroNovo: t.numeroNovo, ...t.resumo, aviso: AVISO_COPIAS } : null,
          id: n.canalId,
          nome: nomeDe(n, i),
          // Unidade que recebe as conversas deste número (Empresa › Unidades).
          unidade: n.unidade,
          unidadeNome: unidadeDe(n.unidade).nomeApp,
          estado: erro ? 'erro' : (info?.estado ?? 'inexistente'),
          numero: info?.numero ?? null,
          perfil: info?.perfil ?? null,
          // Selo de saúde: por que caiu, se a Sintonia está tentando religar, última mensagem recebida.
          saude: s
            ? {
                estado: s.estado,
                desde: s.desde.toISOString(),
                motivo: s.motivo ?? null,
                precisaParear: s.precisaParear,
                reconectando: s.estado === 'desconectado' && !s.precisaParear && s.tentativas < 5,
                ultimaMensagemEm: s.ultimaMensagemEm?.toISOString() ?? null,
              }
            : null,
        };
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
    const unidade = unidadeDoCanal(req);
    await salvarCanais([...salvos, { canalId: id, unidade, nome }], autor);
    return { id, nome, unidade };
  });

  app.patch('/api/conexoes/whatsapp/canais/:id', async (req) => {
    const autor = await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    const corpo = (req.body ?? {}) as { nome?: unknown; unidade?: unknown };
    const salvos = canaisSalvos();
    const atual = salvos.find((n) => n.canalId === id);
    // Muda o nome, a unidade ou os dois (o que vier).
    const nome = corpo.nome === undefined && atual ? (atual.nome ?? nomeDe(atual, salvos.indexOf(atual))) : NomeCanal.parse(corpo.nome);
    const unidade = corpo.unidade === undefined && atual ? atual.unidade : unidadeDoCanal(req);
    // Canal antigo que só existia na Evolution: passa a ficar salvo com o nome novo.
    await salvarCanais(atual ? salvos.map((n) => (n.canalId === id ? { ...n, nome, unidade } : n)) : [...salvos, { canalId: id, unidade, nome }], autor);
    return { id, nome, unidade };
  });

  app.delete('/api/conexoes/whatsapp/canais/:id', async (req) => {
    const autor = await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    if (c.get('evolutionUrl') && c.get('evolutionApiKey')) await evolution().apagar(id);
    await salvarCanais(canaisSalvos().filter((n) => n.canalId !== id), autor);
    o.saude?.removido(id);
    return { ok: true };
  });

  app.post('/api/conexoes/whatsapp/canais/:id/conectar', async (req) => {
    const autor = await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    const numero = numeroDe(req);
    if (!canaisSalvos().some((n) => n.canalId === id)) await salvarCanais([...canaisSalvos(), { canalId: id, unidade: unidadeDoCanal(req) }], autor);
    o.saude?.pareandoPelaPessoa(id);
    await o.trocaNumero?.pareando(id, canalExistente(id).unidade); /* trocar-numero: a próxima conexão pode ser outro número */
    const r = await evolution().conectar(id, webhookDe(req), numero);
    if (r.estado === 'conectada') o.saude?.marcarConectado(id);
    return r;
  });

  // Reconectar sem QR Code: se a sessão do aparelho ainda vale, volta na hora. Senão a tela abre o QR Code/código.
  app.post('/api/conexoes/whatsapp/canais/:id/reconectar', async (req) => {
    await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    canalExistente(id);
    const adm = evolution();
    const r = await adm.reconectar(id);
    // Instância antiga: passa a avisar quedas (CONNECTION_UPDATE) daqui para frente.
    await adm.atualizarEventos(id).catch(() => false);
    if (r.estado === 'conectada') o.saude?.marcarConectado(id);
    return { estado: r.estado };
  });

  app.get('/api/conexoes/whatsapp/canais/:id/progresso', async (req) => {
    await quem(req);
    const p = o.progressoHistorico?.(IdCanal.parse((req.params as { id: string }).id));
    return p ? { ...p, em: p.em.toISOString() } : { mensagens: 0, conversas: 0, em: null };
  });

  app.get('/api/conexoes/whatsapp/canais/:id/diagnostico', async (req) => {
    await quem(req);
    return evolution().diagnosticoHistorico(IdCanal.parse((req.params as { id: string }).id));
  });

  // Puxa as conversas recentes do WhatsApp para a Sintonia (tela "Sincronizando" depois de conectar).
  app.post('/api/conexoes/whatsapp/canais/:id/sincronizar', async (req) => {
    await quem(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    if (!o.importarHistorico) throw Object.assign(new Error('Sincronização indisponível'), { statusCode: 503 });
    const brutas = await evolution().historico(id);
    const mensagens = lerWebhookEvolution({ event: 'messages.upsert', instance: id, data: brutas });
    // Grupos por trás: não atrasam a tela "Sincronizando".
    o.sincronizarGrupos?.().catch(() => {});
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
    // De propósito: sem aviso de queda nem reconexão automática.
    o.saude?.desligadoPelaPessoa(id);
    await evolution().desconectar(id).catch((e) => {
      const st = (e as { status?: number }).status;
      // 404: já não existe; 400: já estava desconectada ("is not connected").
      if (st !== 404 && st !== 400) throw e;
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- trocar-numero
  // Troca de número (Manter / Arquivar / Apagar as conversas do anterior) e o botão "Apagar os dados deste WhatsApp".
  const troca = () => {
    if (!o.trocaNumero) throw Object.assign(new Error('Indisponível neste servidor.'), { statusCode: 501 });
    return o.trocaNumero;
  };
  const CorpoDecisao = z.object({
    acao: z.enum(['manter', 'arquivar', 'apagar']),
    confirmacao: z.string().max(20).optional(),
  });
  /** Canal salvo ou a instância antiga de uma loja ("sintonia-norte"): devolve a loja dele. */
  const lojaDoCanal = (id: string): string => {
    const n = c.numeros().find((x) => x.canalId === id);
    if (!n) throw Object.assign(new Error('Canal não encontrado.'), { statusCode: 404 });
    return n.unidade;
  };
  const trabalhoJson = (t: NonNullable<ReturnType<TrocaNumero['trabalho']>>) => ({
    id: t.id, estado: t.estado, total: t.total, feito: t.feito, erro: t.erro ?? null, inicio: t.inicio.toISOString(), fim: t.fim?.toISOString() ?? null,
  });

  app.get('/api/conexoes/whatsapp/canais/:id/dados', async (req) => {
    await quemFez(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    return troca().dados(id, lojaDoCanal(id));
  });

  app.post('/api/conexoes/whatsapp/canais/:id/troca', async (req) => {
    const q = await quemFez(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    const b = CorpoDecisao.parse(req.body ?? {});
    const r = await troca().decidir({ canalId: id, unidade: lojaDoCanal(id), acao: b.acao, quem: q, origem: 'troca', ...(b.confirmacao ? { confirmacao: b.confirmacao } : {}) });
    return { ok: true, arquivadas: r.arquivadas ?? 0, trabalho: r.trabalho ? trabalhoJson(r.trabalho) : null };
  });

  app.post('/api/conexoes/whatsapp/canais/:id/dados', async (req) => {
    const q = await quemFez(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    const b = CorpoDecisao.extend({ acao: z.enum(['arquivar', 'apagar']) }).parse(req.body ?? {});
    const r = await troca().decidir({ canalId: id, unidade: lojaDoCanal(id), acao: b.acao, quem: q, origem: 'tudo', ...(b.confirmacao ? { confirmacao: b.confirmacao } : {}) });
    return { ok: true, arquivadas: r.arquivadas ?? 0, trabalho: r.trabalho ? trabalhoJson(r.trabalho) : null };
  });

  /* grupos do número antigo (dono 23/11): contar e apagar, sem tocar no que já chegou pelo número novo */
  app.get('/api/conexoes/whatsapp/canais/:id/grupos-antigos', async (req) => {
    await quemFez(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    return troca().gruposAntigos(id, lojaDoCanal(id));
  });
  app.post('/api/conexoes/whatsapp/canais/:id/grupos-antigos', async (req) => {
    const q = await quemFez(req);
    const id = IdCanal.parse((req.params as { id: string }).id);
    const b = z.object({ confirmacao: z.string().max(20).optional() }).parse(req.body ?? {});
    const n = await troca().apagarGruposAntigos({ canalId: id, unidade: lojaDoCanal(id), quem: q, ...(b.confirmacao ? { confirmacao: b.confirmacao } : {}) });
    return { ok: true, grupos: n };
  });

  app.get('/api/conexoes/whatsapp/apagando/:trabalho', async (req, reply) => {
    await quemFez(req);
    const t = troca().trabalho(z.string().uuid().parse((req.params as { trabalho: string }).trabalho));
    if (!t) return reply.code(404).send({ erro: 'Não achamos esse andamento (o servidor pode ter reiniciado). Abra de novo para conferir o que falta.' });
    return trabalhoJson(t);
  });

  app.post('/api/conexoes/whatsapp/:unidade/conectar', async (req) => {
    const autor = await quem(req);
    const unidade = Unidade.parse((req.params as { unidade: string }).unidade);
    // Código pelo número (opcional): só dígitos; sem DDI, assume Brasil (55).
    const bruto = String((req.body as { numero?: unknown } | undefined)?.numero ?? '').replace(/\D/g, '');
    if (bruto && (bruto.length < 10 || bruto.length > 13)) throw Object.assign(new Error('Número inválido. Use DDD + número, ex.: 71 99999-9999.'), { statusCode: 400 });
    const numero = bruto ? (bruto.length <= 11 ? `55${bruto}` : bruto) : undefined;
    o.saude?.pareandoPelaPessoa(`${PREFIXO_INSTANCIA}${unidade}`);
    await o.trocaNumero?.pareando(`${PREFIXO_INSTANCIA}${unidade}`, unidade); /* trocar-numero */
    const r = await evolution().conectar(`${PREFIXO_INSTANCIA}${unidade}`, webhookDe(req), numero);
    await definirNumero(unidade, true, autor);
    return r;
  });

  app.post('/api/conexoes/whatsapp/:unidade/desconectar', async (req) => {
    const autor = await quem(req);
    const unidade = Unidade.parse((req.params as { unidade: string }).unidade);
    o.saude?.desligadoPelaPessoa(`${PREFIXO_INSTANCIA}${unidade}`);
    await evolution().desconectar(`${PREFIXO_INSTANCIA}${unidade}`).catch((e) => {
      if ((e as { status?: number }).status !== 404) throw e;
    });
    await definirNumero(unidade, false, autor);
    return { ok: true };
  });
}

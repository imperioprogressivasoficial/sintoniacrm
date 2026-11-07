import type { NumeroConectado } from '../app/sintonia.js';
import { CanalMeta, lerStatusMeta, lerWebhookMeta } from '../channels/meta.js';
import type { CanalWhatsApp, StatusRecebido } from '../channels/tipos.js';
import type { UnidadeId } from '../domain.js';
import type { OpcoesWebhookMeta } from '../server.js';
import { UNIDADES_WHATSAPP, type Conexoes } from './conexoes.js';

/**
 * Números de WhatsApp em vigor, a partir das Conexões. Cada unidade usa a API escolhida na tela:
 * oficial (Meta, pelo Phone Number ID) ou não oficial (Evolution, pela instância do QR Code). Nunca as duas.
 */
export interface FonteNumeros {
  conexoes: Conexoes;
  /** Canal da Evolution em vigor (undefined = sem endereço ou chave). */
  evolution?: CanalWhatsApp;
  /** Números da variável de ambiente SINTONIA_NUMEROS (configuração antiga). */
  doAmbiente?: Array<{ canalId: string; unidade: UnidadeId; canal: 'evolution' | 'meta' }>;
  /** Canal da Meta do ambiente (META_TOKEN), para os números antigos com canal "meta". */
  metaDoAmbiente?: CanalWhatsApp;
  /** Cache dos canais da Meta por unidade: só refaz quando o token ou a WABA mudam. */
  cacheMeta?: Map<string, { chave: string; canal: CanalWhatsApp }>;
  /** Para os testes: como criar o canal da Meta. */
  criarMeta?: (conta: { token: string; wabaId?: string }) => CanalWhatsApp;
  log?: (msg: string) => void;
}

export function numerosDasConexoes(f: FonteNumeros): NumeroConectado[] {
  const { conexoes } = f;
  const log = f.log ?? (() => {});
  const cache = f.cacheMeta ?? new Map();
  const criarMeta = f.criarMeta ?? ((c) => new CanalMeta(c));
  const lista: NumeroConectado[] = [];

  for (const n of f.doAmbiente ?? []) {
    const canal = n.canal === 'evolution' ? f.evolution : f.metaDoAmbiente;
    if (canal) lista.push({ canalId: n.canalId, unidade: n.unidade, canal });
    else log(`Número ${n.canalId} ignorado: canal ${n.canal} sem credenciais`);
  }

  for (const unidade of UNIDADES_WHATSAPP) {
    if (conexoes.canalDaUnidade(unidade) !== 'meta') continue;
    const conta = conexoes.contaMeta(unidade);
    if (!conta) {
      log(`${unidade}: API oficial escolhida, mas faltam o Phone Number ID ou o token`);
      continue;
    }
    const chave = `${conta.token}|${conta.wabaId ?? ''}`;
    let c = cache.get(unidade);
    if (!c || c.chave !== chave) cache.set(unidade, (c = { chave, canal: criarMeta({ token: conta.token, wabaId: conta.wabaId }) }));
    if (!lista.some((x) => x.canalId === conta.phoneNumberId)) lista.push({ canalId: conta.phoneNumberId, unidade, canal: c.canal });
  }

  if (f.evolution) {
    for (const n of conexoes.numeros()) {
      if (conexoes.canalDaUnidade(n.unidade) === 'meta') continue;
      if (!lista.some((x) => x.canalId === n.canalId)) lista.push({ ...n, canal: f.evolution });
    }
  }
  return lista;
}

/** Só lê o webhook da Meta (os envios saem pelo canal de cada unidade). */
const LEITOR_META: CanalWhatsApp = {
  tipo: 'meta',
  lerWebhook: lerWebhookMeta,
  lerStatus: lerStatusMeta,
  enviarTexto: () => Promise.reject(new Error('Leitor do webhook não envia')),
};

/**
 * O que o webhook da Meta aceita agora: os Verify Tokens de todas as unidades e o App Secret de cada uma,
 * valendo só para o número dela. A configuração antiga (META_APP_SECRET) vale para qualquer número.
 */
export function opcoesWebhookMeta(
  conexoes: Conexoes,
  ambiente: { verifyToken?: string; appSecret?: string; temNumerosMeta?: boolean },
  status?: (lista: StatusRecebido[]) => Promise<unknown>,
): OpcoesWebhookMeta {
  const segredos: OpcoesWebhookMeta['segredos'] = [];
  for (const u of UNIDADES_WHATSAPP) {
    const conta = conexoes.contaMeta(u);
    if (conta?.appSecret) segredos.push({ appSecret: conta.appSecret, numeros: [conta.phoneNumberId] });
  }
  if (ambiente.temNumerosMeta && ambiente.appSecret) segredos.push({ appSecret: ambiente.appSecret });
  return {
    canal: LEITOR_META,
    verifyTokens: [...conexoes.verifyTokensMeta(), ...(ambiente.verifyToken ? [ambiente.verifyToken] : [])],
    segredos,
    semAssinatura: Boolean(ambiente.temNumerosMeta && !ambiente.appSecret),
    ...(status ? { status } : {}),
  };
}

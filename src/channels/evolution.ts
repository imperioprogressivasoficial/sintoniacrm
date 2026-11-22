import { z } from 'zod';
import type { AcaoRecebida, AlvoMensagem, AnexoRecebido, CanalWhatsApp, EnvioResultado, FotoPerfil, MensagemRecebida, MidiaBaixada, MidiaEnvio } from './tipos.js';
import type { TipoAnexo } from '../domain.js';
import { ErroMidiaGrande, LIMITE_INLINE, LIMITE_MIDIA, tamanhoBase64, textoDoAnexo } from '../midia.js';
import { telefoneDoJid } from '../util/telefone.js';
import { referenciaDaEvolution } from '../rastreio/referencia.js';
import { baixarDoWhatsApp } from './whatsapp-cdn.js';

/**
 * Evolution API (v2), a que já roda no VPS da Império (fluxo "Serena" no n8n).
 * Webhook: evento `messages.upsert`. Envio: POST /message/sendText/{instancia}.
 * Mídia: baixada por POST /chat/getBase64FromMediaMessage/{instancia}; enviada por
 * POST /message/sendMedia/{instancia} (foto, vídeo, documento) e /message/sendWhatsAppAudio/{instancia} (nota de voz).
 */

const MensagemEvolution = z.object({
  key: z.object({
    remoteJid: z.string(),
    // WhatsApp novo (LID): o remoteJid vira um código "@lid" e o número vem aqui.
    remoteJidAlt: z.string().nullish(),
    senderPn: z.string().nullish(),
    // Grupo: quem mandou (pode ser "@lid"; o número vem em participantAlt/participantPn).
    participant: z.string().nullish(),
    participantAlt: z.string().nullish(),
    participantPn: z.string().nullish(),
    fromMe: z.boolean().optional().default(false),
    id: z.string(),
  }),
  pushName: z.string().nullish(),
  // O conteúdo vem no formato do WhatsApp (Baileys); os tipos de mídia são lidos à mão em `lerConteudo`.
  message: z.record(z.string(), z.unknown()).nullish(),
  messageTimestamp: z.union([z.number(), z.string()]).nullish(),
  // Evolution v2 repete aqui o contextInfo da mensagem (anúncio de clique para WhatsApp).
  contextInfo: z.record(z.string(), z.unknown()).nullish(),
});

const WebhookEvolution = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.union([MensagemEvolution, z.array(MensagemEvolution)]),
});

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** Número que o WhatsApp manda como número, texto ou Long ({ low, high }). */
function numero(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  const o = obj(v);
  if (o && typeof o.low === 'number') return (o.low >>> 0) + (typeof o.high === 'number' ? o.high * 2 ** 32 : 0);
  return undefined;
}

/** Mensagens "embrulhadas" (temporárias, visualização única, documento com legenda): abre até achar o conteúdo. */
const EMBRULHOS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
function desembrulhar(msg: Obj): Obj {
  let atual = msg;
  for (let i = 0; i < 4; i++) {
    const chave = EMBRULHOS.find((k) => obj(obj(atual[k])?.message));
    if (!chave) break;
    atual = { ...obj(obj(atual[chave])!.message)!, base64: atual.base64 };
  }
  return atual;
}

const TIPOS: Array<[string, TipoAnexo]> = [
  ['imageMessage', 'imagem'],
  ['audioMessage', 'audio'],
  ['videoMessage', 'video'],
  ['documentMessage', 'documento'],
  ['stickerMessage', 'figurinha'],
];

function lerConteudo(bruta: Obj | null | undefined): { texto: string; anexo?: AnexoRecebido } | null {
  if (!bruta) return null;
  const msg = desembrulhar(bruta);
  const t = texto(msg.conversation) ?? texto(obj(msg.extendedTextMessage)?.text);
  if (t) return { texto: t };
  for (const [chave, tipo] of TIPOS) {
    const m = obj(msg[chave]);
    if (!m) continue;
    const legenda = texto(m.caption);
    const nomeArquivo = tipo === 'documento' ? (texto(m.fileName) ?? texto(m.title)) : undefined;
    const base64 = texto(msg.base64);
    const anexo: AnexoRecebido = {
      tipo,
      mimetype: texto(m.mimetype),
      nomeArquivo,
      duracaoSeg: tipo === 'audio' || tipo === 'video' ? numero(m.seconds) : undefined,
      legenda,
      tamanho: numero(m.fileLength),
      voz: tipo === 'audio' ? m.ptt === true : undefined,
      base64: base64 && tamanhoBase64(base64) <= LIMITE_INLINE ? base64 : undefined,
    };
    for (const k of Object.keys(anexo) as Array<keyof AnexoRecebido>) if (anexo[k] === undefined) delete anexo[k];
    // Áudio ainda não é transcrito: o marcador deixa a equipe ver e a IA pedir em texto.
    return { texto: textoDoAnexo(tipo, legenda, nomeArquivo), anexo };
  }
  return null;
}

/**
 * Referência completa da mídia (chave + nó da mensagem, sem miniaturas nem base64) para o download.
 * Com ela a Evolution baixa direto do WhatsApp (mediaKey/directPath), sem precisar ter a mensagem guardada
 * no banco dela — a Evolution do servidor não guarda mensagens (SAVE_DATA desligado), e por isso o download
 * só pelo id falhava ("Message not found"). Pedido do dono 21/11: "não está baixando áudio, foto, arquivo".
 */
const SEM_PESO = new Set(['jpegThumbnail', 'thumbnail', 'base64', 'thumbnailDirectPath', 'thumbnailSha256', 'thumbnailEncSha256', 'contextInfo', 'pngThumbnail', 'streamingSidecar', 'waveform']);
function enxugar(v: unknown, prof = 0): unknown {
  if (prof > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => enxugar(x, prof + 1));
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SEM_PESO.has(k)) o[k] = enxugar(x, prof + 1);
  return o;
}
function refMidiaEvolution(key: { id: string; remoteJid: string; fromMe: boolean; participant?: string | null }, message: unknown): string | undefined {
  try {
    const ref = JSON.stringify({ key: { id: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe, ...(key.participant ? { participant: key.participant } : {}) }, message: enxugar(message) });
    return ref.length <= 16_000 ? ref : undefined;
  } catch { return undefined; }
}

/** Evento do webhook da Evolution, normalizado (ex.: "messages.upsert", "messages.set"). */
export function eventoEvolution(corpo: unknown): string {
  const e = (corpo as { event?: unknown } | null)?.event;
  return typeof e === 'string' ? e.toLowerCase().replace(/_/g, '.') : '';
}

/** Mensagens do corpo (messages.upsert ou messages.set), cada uma lida sozinha: as fora do formato ficam de fora. */
function mensagensDoCorpo(corpo: unknown): { instancia: string; lista: Array<z.infer<typeof MensagemEvolution>> } | null {
  const evento = eventoEvolution(corpo);
  if (evento !== 'messages.upsert' && evento !== 'messages.set') return null;
  const bruto = corpo as { instance?: unknown; data?: unknown };
  if (typeof bruto.instance !== 'string') return null;
  const dados = Array.isArray(bruto.data) ? bruto.data : (bruto.data as { messages?: unknown } | undefined)?.messages ?? [bruto.data];
  const lista = (Array.isArray(dados) ? dados : []).map((x) => MensagemEvolution.safeParse(x)).filter((x) => x.success).map((x) => x.data);
  return { instancia: bruto.instance, lista };
}

export function lerWebhookEvolution(corpo: unknown): MensagemRecebida[] {
  const lido = mensagensDoCorpo(corpo);
  if (!lido) return [];
  const { lista } = lido;
  const r = { data: { instance: lido.instancia } };
  const saida: MensagemRecebida[] = [];
  for (const m of lista) {
    // Contato identificado por LID ("…@lid"): o número verdadeiro vem em remoteJidAlt (ou senderPn).
    const jid = m.key.remoteJid.endsWith('@lid') ? (m.key.remoteJidAlt ?? m.key.senderPn ?? '') : m.key.remoteJid;
    const telefone = telefoneDoJid(jid);
    const conteudo = lerConteudo(m.message);
    if (!telefone || !conteudo) continue;
    if (conteudo.anexo && !conteudo.anexo.base64 && !conteudo.anexo.ref) { const ref = refMidiaEvolution(m.key, m.message); if (ref) conteudo.anexo.ref = ref; }
    const ts = Number(m.messageTimestamp ?? 0);
    const referencia = m.key.fromMe ? undefined : referenciaDaEvolution(m);
    saida.push({
      canalId: r.data.instance,
      telefone,
      nome: m.key.fromMe ? undefined : (m.pushName ?? undefined),
      texto: conteudo.texto,
      deMim: m.key.fromMe,
      idExterno: m.key.id,
      em: ts ? new Date(ts * 1000) : new Date(),
      ...(conteudo.anexo ? { anexo: conteudo.anexo } : {}),
      ...(referencia ? { referencia } : {}),
    });
  }
  return saida;
}

/**
 * menu-mensagem: reações, mensagens apagadas e editadas que chegam pelo webhook (messages.upsert).
 * - reactionMessage { key (da mensagem reagida), text: emoji; vazio = tirou a reação };
 * - protocolMessage type REVOKE (0): apagou para todos; MESSAGE_EDIT (14) com editedMessage: editou.
 * Grupos ficam de fora (são outra tela).
 */
export function lerAcoesEvolution(corpo: unknown): AcaoRecebida[] {
  if (eventoEvolution(corpo) !== 'messages.upsert') return [];
  const lido = mensagensDoCorpo(corpo);
  if (!lido) return [];
  const saida: AcaoRecebida[] = [];
  for (const m of lido.lista) {
    if (ehGrupo(m.key.remoteJid)) continue;
    const jid = m.key.remoteJid.endsWith('@lid') ? (m.key.remoteJidAlt ?? m.key.senderPn ?? '') : m.key.remoteJid;
    const telefone = telefoneDoJid(jid);
    const msg = m.message ? desembrulhar(m.message) : undefined;
    if (!telefone || !msg) continue;
    const ts = Number(m.messageTimestamp ?? 0);
    const base = { canalId: lido.instancia, telefone, deMim: m.key.fromMe, em: ts ? new Date(ts * 1000) : new Date(), ...(m.pushName && !m.key.fromMe ? { nome: m.pushName } : {}) };
    const reacao = obj(msg.reactionMessage);
    const alvoReacao = texto(obj(reacao?.key)?.id);
    if (reacao && alvoReacao) {
      saida.push({ ...base, tipo: 'reacao', alvoIdExterno: alvoReacao, emoji: typeof reacao.text === 'string' ? reacao.text.slice(0, 16) : '' });
      continue;
    }
    const proto = obj(msg.protocolMessage);
    const alvo = texto(obj(proto?.key)?.id);
    if (!proto || !alvo) continue;
    const tipo = proto.type;
    if (tipo === 0 || tipo === 'REVOKE') saida.push({ ...base, tipo: 'apagou', alvoIdExterno: alvo });
    else if (tipo === 14 || tipo === 'MESSAGE_EDIT') {
      const ed = obj(proto.editedMessage);
      const t = ed ? (texto(ed.conversation) ?? texto(obj(ed.extendedTextMessage)?.text)) : undefined;
      if (t) saida.push({ ...base, tipo: 'editou', alvoIdExterno: alvo, texto: t });
    }
  }
  return saida;
}

/** Mensagem de um grupo do WhatsApp (Conversas de grupo). Nunca vira conversa de cliente. */
export interface MensagemGrupoRecebida {
  canalId: string;
  /** "1203...@g.us" */
  grupoJid: string;
  /** Número de quem mandou (só dígitos), quando o WhatsApp informa. */
  participante: string | null;
  participanteJid: string | null;
  /** Nome do perfil de quem mandou (pushName). */
  participanteNome?: string;
  texto: string;
  deMim: boolean;
  idExterno: string;
  em: Date;
  anexo?: AnexoRecebido;
}

const ehGrupo = (jid: string | null | undefined): jid is string => typeof jid === 'string' && jid.endsWith('@g.us');
/** Número de um JID de pessoa ("5571...@s.whatsapp.net" ou "5571...:12@s.whatsapp.net"). "@lid" não é número. */
const numeroDoJid = (jid: string | null | undefined): string | null => {
  if (!jid || !/@(s\.whatsapp\.net|c\.us)$/.test(jid)) return null;
  const d = (jid.split('@')[0] ?? '').split(':')[0]!.replace(/\D/g, '');
  return d.length >= 8 ? d : null;
};

/** Só as mensagens de grupo do webhook (messages.upsert e o histórico messages.set). */
export function lerGruposEvolution(corpo: unknown): MensagemGrupoRecebida[] {
  const lido = mensagensDoCorpo(corpo);
  if (!lido) return [];
  const saida: MensagemGrupoRecebida[] = [];
  for (const m of lido.lista) {
    if (!ehGrupo(m.key.remoteJid)) continue;
    const conteudo = lerConteudo(m.message);
    if (!conteudo) continue;
    if (conteudo.anexo && !conteudo.anexo.base64 && !conteudo.anexo.ref) { const ref = refMidiaEvolution(m.key, m.message); if (ref) conteudo.anexo.ref = ref; }
    const k = m.key;
    const participanteJid = k.participant ?? null;
    const participante = numeroDoJid(k.participantAlt) ?? numeroDoJid(k.participantPn) ?? numeroDoJid(k.senderPn) ?? numeroDoJid(k.participant);
    const ts = Number(m.messageTimestamp ?? 0);
    saida.push({
      canalId: lido.instancia,
      grupoJid: k.remoteJid,
      participante: k.fromMe ? null : participante,
      participanteJid: k.fromMe ? null : participanteJid,
      ...(k.fromMe || !m.pushName ? {} : { participanteNome: m.pushName }),
      texto: conteudo.texto,
      deMim: k.fromMe,
      idExterno: k.id,
      em: ts ? new Date(ts * 1000) : new Date(),
      ...(conteudo.anexo ? { anexo: conteudo.anexo } : {}),
    });
  }
  return saida;
}

/**
 * Por que um envio pela Evolution não saiu, em palavras simples (vai direto para a tela da atendente).
 * - temporario: vale tentar de novo sozinho (nada saiu: servidor fora, conexão caindo e voltando).
 * - incerto: o servidor não confirmou; a mensagem pode ter saído (nunca reenviar sozinho).
 */
export type CodigoErroEnvio =
  | 'sem_whatsapp'
  | 'desconectado'
  | 'canal_inexistente'
  | 'chave_recusada'
  | 'servidor_fora'
  | 'incerto'
  | 'recusado'
  | 'servidor_erro';

const MENSAGEM_ERRO: Record<CodigoErroEnvio, string> = {
  sem_whatsapp: 'Não enviada: este número não tem WhatsApp.',
  desconectado: 'Não enviada: o WhatsApp deste canal está desconectado. Reconecte em Conexões › WhatsApp.',
  canal_inexistente: 'Não enviada: a conexão deste WhatsApp foi apagada do servidor. Conecte de novo em Conexões › WhatsApp.',
  chave_recusada: 'Não enviada: o servidor do WhatsApp recusou a chave de acesso. Confira em Conexões › WhatsApp.',
  servidor_fora: 'Não enviada: o servidor do WhatsApp não respondeu. Tente de novo em instantes.',
  incerto: 'O servidor do WhatsApp não confirmou o envio: a mensagem pode ter saído. Confira no celular antes de mandar de novo.',
  recusado: 'Não enviada: o WhatsApp recusou a mensagem.',
  servidor_erro: 'Não enviada: o servidor do WhatsApp deu erro. Tente de novo.',
};
/** Status HTTP que a Sintonia devolve para a tela em cada caso. */
const STATUS_ERRO: Record<CodigoErroEnvio, number> = {
  sem_whatsapp: 422,
  desconectado: 503,
  canal_inexistente: 503,
  chave_recusada: 502,
  servidor_fora: 503,
  incerto: 504,
  recusado: 422,
  servidor_erro: 502,
};

export class ErroEnvioWhatsApp extends Error {
  readonly statusCode: number;
  constructor(
    readonly codigo: CodigoErroEnvio,
    /** Resposta crua da Evolution (só para o log). */
    readonly detalhe = '',
  ) {
    super(MENSAGEM_ERRO[codigo]);
    this.name = 'ErroEnvioWhatsApp';
    this.statusCode = STATUS_ERRO[codigo];
  }
  get temporario(): boolean {
    return this.codigo === 'servidor_fora' || this.codigo === 'desconectado';
  }
}

/** Erro de rede (fetch lançou): antes de chegar à Evolution (dá para tentar de novo) ou no meio (incerto). */
export function erroDeRede(e: unknown): ErroEnvioWhatsApp {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new ErroEnvioWhatsApp('incerto', 'tempo esgotado');
  const codigo = err?.cause?.code ?? err?.code ?? '';
  // Não conseguiu nem abrir a conexão: nada foi enviado.
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(codigo)) {
    return new ErroEnvioWhatsApp('servidor_fora', codigo);
  }
  // Caiu no meio (ECONNRESET, socket fechado): pode ter saído.
  return new ErroEnvioWhatsApp('incerto', codigo || String((e as Error)?.message ?? e).slice(0, 200));
}

/** Resposta de erro da Evolution v2.3 (status + corpo) para o motivo. */
export function erroDaResposta(status: number, corpo: string): ErroEnvioWhatsApp {
  const c = corpo.slice(0, 2000);
  if (/"exists"\s*:\s*false/.test(c)) return new ErroEnvioWhatsApp('sem_whatsapp', c);
  if (status === 404 || /instance does not exist|não existe/i.test(c)) return new ErroEnvioWhatsApp('canal_inexistente', c);
  if (/connection closed|not connected|is not connected|connection (was )?lost|socket (is )?closed|instance.*close/i.test(c)) return new ErroEnvioWhatsApp('desconectado', c);
  if (status === 401 || status === 403) return new ErroEnvioWhatsApp('chave_recusada', c);
  if (status === 429 || status === 502 || status === 503) return new ErroEnvioWhatsApp('servidor_fora', `${status} ${c}`);
  if (status === 504) return new ErroEnvioWhatsApp('incerto', `${status} ${c}`);
  if (status >= 400 && status < 500) return new ErroEnvioWhatsApp('recusado', `${status} ${c}`);
  return new ErroEnvioWhatsApp('servidor_erro', `${status} ${c}`);
}

export class CanalEvolution implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    /** Espera entre tentativas (troca nos testes). */
    private readonly esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  lerWebhook(corpo: unknown): MensagemRecebida[] {
    return lerWebhookEvolution(corpo);
  }

  private url(caminho: string, instancia: string) {
    return `${this.baseUrl.replace(/\/$/, '')}/${caminho}/${encodeURIComponent(instancia)}`;
  }

  private async postar(caminho: string, instancia: string, corpo: unknown, timeoutMs?: number): Promise<Response> {
    return this.fetchFn(this.url(caminho, instancia), {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify(corpo),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  }

  /**
   * Envia com novas tentativas só quando é certo que nada saiu (servidor fora: 2 vezes, 1 s e 3 s depois;
   * conexão caindo e voltando: 1 vez, 4 s depois). Tempo esgotado ou queda no meio nunca reenvia: não duplica.
   */
  private async enviarComTentativas(caminho: string, instancia: string, corpo: unknown, timeoutMs: number): Promise<EnvioResultado> {
    for (let tentativa = 0; ; tentativa++) {
      let erro: ErroEnvioWhatsApp;
      try {
        const resp = await this.postar(caminho, instancia, corpo, timeoutMs);
        if (resp.ok) {
          const json = (await resp.json().catch(() => ({}))) as { key?: { id?: string } };
          return { idExterno: json.key?.id ?? '' };
        }
        erro = erroDaResposta(resp.status, await resp.text().catch(() => ''));
      } catch (e) {
        erro = e instanceof ErroEnvioWhatsApp ? e : erroDeRede(e);
      }
      const limite = erro.codigo === 'servidor_fora' ? 2 : erro.codigo === 'desconectado' ? 1 : 0;
      if (tentativa >= limite) throw erro;
      await this.esperar(erro.codigo === 'desconectado' ? 4000 : tentativa === 0 ? 1000 : 3000);
    }
  }

  async enviarTexto(instancia: string, telefone: string, texto: string): Promise<EnvioResultado> {
    return this.enviarComTentativas('message/sendText', instancia, { number: telefone, text: texto }, 30_000);
  }

  /**
   * Foto, vídeo e documento: sendMedia com o arquivo em base64 (sem o prefixo "data:").
   * Nota de voz: sendWhatsAppAudio (a Evolution converte para o formato do WhatsApp e manda como gravada na hora).
   */
  async enviarMidia(instancia: string, telefone: string, m: MidiaEnvio): Promise<EnvioResultado> {
    const media = m.conteudo.toString('base64');
    if (m.tipo === 'audio') {
      return this.enviarComTentativas('message/sendWhatsAppAudio', instancia, { number: telefone, audio: media }, 120_000);
    }
    const mediatype = m.tipo === 'imagem' ? 'image' : m.tipo === 'video' ? 'video' : 'document';
    const corpo: Record<string, unknown> = { number: telefone, mediatype, mimetype: m.mimetype, media };
    if (m.legenda?.trim()) corpo.caption = m.legenda.trim();
    if (m.nomeArquivo) corpo.fileName = m.nomeArquivo;
    return this.enviarComTentativas('message/sendMedia', instancia, corpo, 120_000);
  }

  /* menu-mensagem: reação, resposta citando, editar e apagar para todos (Evolution v2). */
  private chave(a: AlvoMensagem) {
    return { remoteJid: `${a.telefone}@s.whatsapp.net`, fromMe: a.deMim, id: a.idExterno };
  }
  private async conferir(resp: Response): Promise<void> {
    if (!resp.ok) throw erroDaResposta(resp.status, await resp.text().catch(() => ''));
  }

  /** POST /message/sendReaction { key, reaction } (reaction vazia tira a reação). */
  async enviarReacao(instancia: string, alvo: AlvoMensagem, emoji: string): Promise<void> {
    await this.conferir(await this.postar('message/sendReaction', instancia, { key: this.chave(alvo), reaction: emoji }, 20_000).catch((e) => { throw erroDeRede(e); }));
  }

  /** sendText com "quoted": a cliente vê a mensagem citada em cima da resposta. */
  async enviarCitando(instancia: string, telefone: string, texto: string, citada: AlvoMensagem & { texto: string }): Promise<EnvioResultado> {
    const quoted = { key: this.chave(citada), message: { conversation: citada.texto.slice(0, 1000) } };
    return this.enviarComTentativas('message/sendText', instancia, { number: telefone, text: texto, quoted }, 30_000);
  }

  /** POST /chat/updateMessage { number, key, text }. */
  async editarTexto(instancia: string, alvo: AlvoMensagem, texto: string): Promise<void> {
    await this.conferir(await this.postar('chat/updateMessage', instancia, { number: alvo.telefone, key: this.chave(alvo), text: texto }, 20_000).catch((e) => { throw erroDeRede(e); }));
  }

  /** DELETE /chat/deleteMessageForEveryone { id, remoteJid, fromMe }. */
  async apagarParaTodos(instancia: string, alvo: AlvoMensagem): Promise<void> {
    const k = this.chave(alvo);
    const resp = await this.fetchFn(this.url('chat/deleteMessageForEveryone', instancia), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ id: k.id, remoteJid: k.remoteJid, fromMe: k.fromMe }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => { throw erroDeRede(e); });
    await this.conferir(resp);
  }

  /** "digitando…"/"gravando áudio…": POST /chat/sendPresence (a Evolution mostra o aviso por `delay` ms). */
  async enviarPresenca(instancia: string, telefone: string, tipo: 'digitando' | 'gravando', ms: number): Promise<void> {
    const resp = await this.postar('chat/sendPresence', instancia, { number: telefone, presence: tipo === 'gravando' ? 'recording' : 'composing', delay: Math.round(ms) }, ms + 15_000);
    if (!resp.ok) throw new Error(`Evolution recusou o aviso de digitando (${resp.status})`);
  }

  /** Baixa a mídia de uma mensagem já recebida. A Evolution procura a mensagem pelo id no banco dela. */
  async baixarMidia(instancia: string, idExterno: string, ref?: string): Promise<MidiaBaixada> {
    // Com a mensagem completa (ref), a Evolution baixa direto do WhatsApp; sem ela, procura pelo id no banco dela.
    let completa: unknown;
    if (ref && ref.startsWith('{')) { try { const r = JSON.parse(ref) as { key?: unknown; message?: unknown }; if (r.key && r.message) completa = r; } catch { /* ref antiga */ } }
    // 1º: direto do servidor de mídia do WhatsApp (endereço + chave que vêm na própria mensagem), sem a Evolution.
    const erros: string[] = [];
    if (completa) {
      try {
        const r = await baixarDoWhatsApp((completa as { message: unknown }).message, { limite: LIMITE_MIDIA, fetchFn: this.fetchFn });
        return { conteudo: r.conteudo, mimetype: r.mimetype, nomeArquivo: r.nomeArquivo };
      } catch (e) { if (String(e).includes('grande demais')) throw new ErroMidiaGrande(LIMITE_MIDIA + 1); erros.push(`direto: ${e instanceof Error ? e.message : String(e)}`); }
    }
    // 2º: a Evolution com a mensagem completa; 3º: a Evolution pelo id (só funciona se ela guardou a mensagem).
    let resp = completa ? await this.postar('chat/getBase64FromMediaMessage', instancia, { message: completa, convertToMp4: false }, 60_000) : null;
    if (resp && !resp.ok) erros.push(`evolution completa: ${resp.status} ${(await resp.text()).slice(0, 160)}`);
    if (!resp || !resp.ok) resp = await this.postar('chat/getBase64FromMediaMessage', instancia, { message: { key: { id: idExterno } }, convertToMp4: false }, 60_000);
    if (!resp.ok) throw new Error(`Evolution não entregou a mídia (${resp.status}): ${(await resp.text()).slice(0, 200)}${erros.length ? ' | ' + erros.join(' | ') : completa ? '' : ' | sem a mensagem completa guardada'}`);
    const j = (await resp.json()) as { base64?: string; mimetype?: string; fileName?: string };
    if (!j.base64) throw new Error('Evolution respondeu sem o arquivo');
    if (tamanhoBase64(j.base64) > LIMITE_MIDIA) throw new ErroMidiaGrande(tamanhoBase64(j.base64));
    return { conteudo: Buffer.from(j.base64, 'base64'), mimetype: texto(j.mimetype), nomeArquivo: texto(j.fileName) };
  }

  async buscarFoto(instancia: string, telefone: string): Promise<FotoPerfil | null> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/fetchProfilePictureUrl/${encodeURIComponent(instancia)}`;
    const resp = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ number: telefone }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Evolution recusou a foto (${resp.status})`);
    const { profilePictureUrl } = (await resp.json()) as { profilePictureUrl?: string | null };
    if (!profilePictureUrl) return null;
    const img = await this.fetchFn(profilePictureUrl, { signal: AbortSignal.timeout(10_000) });
    if (!img.ok) throw new Error(`Foto indisponível (${img.status})`);
    const tipo = img.headers.get('content-type') ?? 'image/jpeg';
    if (!tipo.startsWith('image/')) return null;
    const conteudo = Buffer.from(await img.arrayBuffer());
    return conteudo.length > 0 && conteudo.length < 2_000_000 ? { conteudo, tipo } : null;
  }
}

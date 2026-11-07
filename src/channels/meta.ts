import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  AnexoRecebido,
  CanalWhatsApp,
  EnvioResultado,
  MensagemRecebida,
  MidiaBaixada,
  MidiaEnvio,
  ModeloAprovado,
  ModeloEnvio,
  StatusEntrega,
  StatusRecebido,
} from './tipos.js';
import type { TipoAnexo } from '../domain.js';
import { normalizarCelular } from '../util/telefone.js';
import { ErroMidiaGrande, LIMITE_MIDIA, textoDoAnexo } from '../midia.js';
import { referenciaDaMeta } from '../rastreio/referencia.js';

/**
 * WhatsApp Cloud API (API oficial da Meta).
 * `canalId` aqui é o phone_number_id do número na Meta. Cada unidade tem o seu token (e a sua WABA).
 *
 * - Webhook: mensagens (texto, botão, áudio, foto, vídeo, documento, figurinha) e avisos de entrega/leitura.
 * - Envio: POST /{phone-number-id}/messages (texto, mídia já enviada em /media, modelo aprovado, marcar como lida).
 * - Mídia recebida: GET /{media-id} devolve a url; a url é baixada com o mesmo token.
 */
export const VERSAO_GRAPH = 'v21.0';
export const GRAPH = `https://graph.facebook.com/${VERSAO_GRAPH}`;

/** Mensagem pronta para quem tenta escrever livremente a uma cliente que não fala com a loja há mais de 24 h. */
export const FORA_DA_JANELA = 'Fora da janela de 24h: use um modelo aprovado (a cliente não escreve há mais de 24 horas).';

const Midia = z.object({ id: z.string(), mime_type: z.string().nullish(), caption: z.string().nullish() }).passthrough();

const WebhookMeta = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z
            .object({
              metadata: z.object({ phone_number_id: z.string() }),
              contacts: z
                .array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().nullish() }).nullish() }))
                .nullish(),
              messages: z
                .array(
                  z.object({
                    from: z.string(),
                    id: z.string(),
                    timestamp: z.string(),
                    type: z.string(),
                    text: z.object({ body: z.string() }).nullish(),
                    image: Midia.nullish(),
                    video: Midia.nullish(),
                    audio: Midia.extend({ voice: z.boolean().nullish() }).nullish(),
                    sticker: Midia.nullish(),
                    document: Midia.extend({ filename: z.string().nullish() }).nullish(),
                    button: z.object({ text: z.string() }).nullish(),
                    /** Anúncio de clique para WhatsApp. */
                    referral: z.record(z.string(), z.unknown()).nullish(),
                    interactive: z
                      .object({
                        button_reply: z.object({ title: z.string() }).nullish(),
                        list_reply: z.object({ title: z.string() }).nullish(),
                      })
                      .nullish(),
                  }),
                )
                .nullish(),
              statuses: z
                .array(
                  z.object({
                    id: z.string(),
                    status: z.string(),
                    timestamp: z.string(),
                    recipient_id: z.string().nullish(),
                    errors: z.array(z.object({ code: z.number().nullish(), title: z.string().nullish(), message: z.string().nullish() })).nullish(),
                  }),
                )
                .nullish(),
            })
            .passthrough(),
        }),
      ),
    }),
  ),
});
type MensagemMeta = NonNullable<z.infer<typeof WebhookMeta>['entry'][number]['changes'][number]['value']['messages']>[number];

const TIPOS: Array<['image' | 'audio' | 'video' | 'document' | 'sticker', TipoAnexo]> = [
  ['image', 'imagem'],
  ['audio', 'audio'],
  ['video', 'video'],
  ['document', 'documento'],
  ['sticker', 'figurinha'],
];

/** Mídia vira o marcador para a IA ("[foto] legenda") e o anexo, que o baixador busca depois pelo id da mídia. */
function lerMidia(m: MensagemMeta): { texto: string; anexo: AnexoRecebido } | null {
  for (const [chave, tipo] of TIPOS) {
    if (m.type !== chave) continue;
    const dado = m[chave] as (z.infer<typeof Midia> & { filename?: string | null; voice?: boolean | null }) | null | undefined;
    if (!dado) return null;
    const legenda = tipo === 'audio' || tipo === 'figurinha' ? undefined : (dado.caption ?? undefined);
    const nomeArquivo = tipo === 'documento' ? (dado.filename ?? undefined) : undefined;
    const anexo: AnexoRecebido = { tipo, ref: dado.id };
    if (dado.mime_type) anexo.mimetype = dado.mime_type;
    if (nomeArquivo) anexo.nomeArquivo = nomeArquivo;
    if (legenda) anexo.legenda = legenda;
    // Áudio gravado na hora chega com voice=true (ou em ogg/opus, o formato das notas de voz).
    if (tipo === 'audio' && (dado.voice || /ogg|opus/.test(dado.mime_type ?? ''))) anexo.voz = true;
    return { texto: textoDoAnexo(tipo, legenda, nomeArquivo), anexo };
  }
  return null;
}

export function lerWebhookMeta(corpo: unknown): MensagemRecebida[] {
  const r = WebhookMeta.safeParse(corpo);
  if (!r.success) return [];
  const saida: MensagemRecebida[] = [];
  for (const entry of r.data.entry) {
    for (const change of entry.changes) {
      const v = change.value;
      for (const m of v.messages ?? []) {
        const telefone = normalizarCelular(m.from);
        if (!telefone) continue;
        const textoSimples = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
        const midia = textoSimples ? null : lerMidia(m);
        const texto = textoSimples ?? midia?.texto;
        if (!texto) continue;
        const contato = v.contacts?.find((c) => c.wa_id === m.from);
        const referencia = referenciaDaMeta(m.referral);
        saida.push({
          canalId: v.metadata.phone_number_id,
          telefone,
          nome: contato?.profile?.name ?? undefined,
          texto,
          deMim: false,
          idExterno: m.id,
          em: new Date(Number(m.timestamp) * 1000),
          ...(midia ? { anexo: midia.anexo } : {}),
          ...(referencia ? { referencia } : {}),
        });
      }
    }
  }
  return saida;
}

const STATUS: Record<string, StatusEntrega> = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };

export function lerStatusMeta(corpo: unknown): StatusRecebido[] {
  const r = WebhookMeta.safeParse(corpo);
  if (!r.success) return [];
  const saida: StatusRecebido[] = [];
  for (const entry of r.data.entry) {
    for (const change of entry.changes) {
      for (const s of change.value.statuses ?? []) {
        const status = STATUS[s.status];
        if (!status) continue;
        const erro = s.errors?.map((e) => [e.code, e.title ?? e.message].filter(Boolean).join(' ')).join('; ');
        saida.push({
          canalId: change.value.metadata.phone_number_id,
          idExterno: s.id,
          status,
          em: new Date(Number(s.timestamp) * 1000),
          ...(s.recipient_id ? { telefone: s.recipient_id } : {}),
          ...(erro ? { erro } : {}),
        });
      }
    }
  }
  return saida;
}

/** Todos os phone_number_id citados no corpo (para conferir quem pode assinar cada um). */
export function numerosDoWebhook(corpo: unknown): string[] {
  const r = WebhookMeta.safeParse(corpo);
  if (!r.success) return [];
  return [...new Set(r.data.entry.flatMap((e) => e.changes.map((c) => c.value.metadata.phone_number_id)))];
}

/** Confere a assinatura X-Hub-Signature-256 que a Meta manda em cada webhook. */
export function assinaturaMetaValida(corpoBruto: string, assinatura: string | undefined, appSecret: string): boolean {
  if (!assinatura?.startsWith('sha256=') || !appSecret) return false;
  const esperado = createHmac('sha256', appSecret).update(corpoBruto).digest('hex');
  const a = Buffer.from(assinatura.slice(7), 'hex');
  const b = Buffer.from(esperado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Erro da Graph API, com o código da Meta e uma explicação em português quando dá. */
export class ErroMeta extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: number,
  ) {
    super(mensagem);
  }
}

const EXPLICACOES: Record<number, string> = {
  190: 'token de acesso inválido ou vencido',
  10: 'o token não tem permissão para este número (confira whatsapp_business_messaging)',
  100: 'pedido recusado pela Meta (confira o Phone Number ID)',
  131047: FORA_DA_JANELA,
  131026: 'a cliente não pode receber esta mensagem (número sem WhatsApp ou versão antiga)',
  132000: 'quantidade de parâmetros não bate com o modelo',
  132001: 'modelo não existe nesse idioma ou ainda não foi aprovado',
  133010: 'número ainda não registrado na Cloud API',
};

async function erroDa(resp: Response, acao: string): Promise<ErroMeta> {
  const bruto = await resp.text().catch(() => '');
  let codigo: number | undefined;
  let msg = bruto.slice(0, 300);
  try {
    const j = JSON.parse(bruto) as { error?: { message?: string; code?: number; error_data?: { details?: string } } };
    codigo = j.error?.code;
    msg = j.error?.error_data?.details ?? j.error?.message ?? msg;
  } catch {
    /* não era JSON */
  }
  const explicacao = codigo !== undefined ? EXPLICACOES[codigo] : undefined;
  if (codigo === 131047) return new ErroMeta(FORA_DA_JANELA, resp.status, codigo);
  return new ErroMeta(`Meta recusou ${acao} (${resp.status}${codigo ? `, código ${codigo}` : ''}): ${explicacao ? `${explicacao}. ` : ''}${msg}`.slice(0, 500), resp.status, codigo);
}

export interface ContaMetaCanal {
  token: string;
  /** WhatsApp Business Account ID: para listar os modelos aprovados. */
  wabaId?: string;
}

/** Informações do número na Meta (botão "Testar"). */
export interface InfoNumeroMeta {
  numero: string;
  nome?: string;
  qualidade?: string;
  verificado?: string;
}

/** Chamadas à Graph API com um token. Usado pelo canal e pela tela de Conexões. */
export class GraphMeta {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private cabecalho(extra?: Record<string, string>) {
    return { authorization: `Bearer ${this.token}`, ...extra };
  }

  async get<T>(caminho: string, acao: string): Promise<T> {
    const resp = await this.fetchFn(`${GRAPH}/${caminho}`, { headers: this.cabecalho(), signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) throw await erroDa(resp, acao);
    return (await resp.json()) as T;
  }

  async postJson<T>(caminho: string, corpo: unknown, acao: string): Promise<T> {
    const resp = await this.fetchFn(`${GRAPH}/${caminho}`, {
      method: 'POST',
      headers: this.cabecalho({ 'content-type': 'application/json' }),
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw await erroDa(resp, acao);
    return (await resp.json()) as T;
  }

  async postForm<T>(caminho: string, form: FormData, acao: string): Promise<T> {
    const resp = await this.fetchFn(`${GRAPH}/${caminho}`, { method: 'POST', headers: this.cabecalho(), body: form, signal: AbortSignal.timeout(120_000) });
    if (!resp.ok) throw await erroDa(resp, acao);
    return (await resp.json()) as T;
  }

  /** Baixa uma url da Meta (arquivo de mídia) com o token. */
  async baixar(url: string): Promise<Response> {
    const resp = await this.fetchFn(url, { headers: this.cabecalho(), signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw await erroDa(resp, 'o arquivo');
    return resp;
  }

  async infoNumero(phoneNumberId: string): Promise<InfoNumeroMeta> {
    const j = await this.get<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string }>(
      `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
      'a consulta do número',
    );
    return {
      numero: j.display_phone_number ?? '',
      ...(j.verified_name ? { nome: j.verified_name } : {}),
      ...(j.quality_rating ? { qualidade: j.quality_rating } : {}),
      ...(j.code_verification_status ? { verificado: j.code_verification_status } : {}),
    };
  }

  /** Modelos aprovados da WABA (página a página, até 500). */
  async modelosAprovados(wabaId: string): Promise<ModeloAprovado[]> {
    type Linha = { name: string; language: string; category?: string; status: string; components?: Array<{ type: string; text?: string }> };
    const saida: ModeloAprovado[] = [];
    let caminho: string | undefined = `${encodeURIComponent(wabaId)}/message_templates?fields=name,language,category,status,components&status=APPROVED&limit=100`;
    for (let i = 0; caminho && i < 5; i++) {
      const j: { data?: Linha[]; paging?: { next?: string } } = await this.get(caminho, 'a lista de modelos');
      for (const t of j.data ?? []) {
        if (t.status !== 'APPROVED') continue;
        const corpo = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
        const variaveis = new Set([...corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => x[1])).size;
        saida.push({ nome: t.name, idioma: t.language, categoria: t.category ?? '', status: t.status, corpo, variaveis });
      }
      caminho = j.paging?.next ? j.paging.next.replace(`${GRAPH}/`, '') : undefined;
    }
    return saida;
  }
}

/** Texto que fica na conversa quando a loja manda um modelo: o corpo com as variáveis preenchidas. */
export function textoDoModelo(corpo: string | undefined, m: ModeloEnvio): string {
  const p = m.parametros ?? [];
  if (corpo) return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => p[Number(n) - 1] ?? `{{${n}}}`);
  return `[modelo: ${m.nome}]${p.length ? ' ' + p.join(' · ') : ''}`;
}

export class CanalMeta implements CanalWhatsApp {
  readonly tipo = 'meta' as const;
  private readonly graph: GraphMeta;
  private readonly wabaId?: string;

  constructor(
    conta: string | ContaMetaCanal,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    const c = typeof conta === 'string' ? { token: conta } : conta;
    this.graph = new GraphMeta(c.token, fetchFn);
    this.wabaId = c.wabaId;
  }

  lerWebhook(corpo: unknown): MensagemRecebida[] {
    return lerWebhookMeta(corpo);
  }

  lerStatus(corpo: unknown): StatusRecebido[] {
    return lerStatusMeta(corpo);
  }

  private async mensagem(phoneNumberId: string, corpo: Record<string, unknown>, acao: string): Promise<EnvioResultado> {
    const j = await this.graph.postJson<{ messages?: Array<{ id?: string }> }>(
      `${encodeURIComponent(phoneNumberId)}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', ...corpo },
      acao,
    );
    return { idExterno: j.messages?.[0]?.id ?? '' };
  }

  /** Texto livre: só até 24 h depois da última mensagem da cliente (a Sintonia confere antes; a Meta confere de novo). */
  async enviarTexto(phoneNumberId: string, telefone: string, texto: string): Promise<EnvioResultado> {
    return this.mensagem(phoneNumberId, { to: telefone, type: 'text', text: { body: texto, preview_url: /https?:\/\//.test(texto) } }, 'o envio');
  }

  /** Sobe o arquivo em /media e devolve o id (vale ~30 dias). */
  async subirMidia(phoneNumberId: string, conteudo: Buffer, mimetype: string, nomeArquivo?: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimetype);
    form.append('file', new Blob([new Uint8Array(conteudo)], { type: mimetype }), nomeArquivo ?? `arquivo.${mimetype.split('/')[1]?.split(';')[0] ?? 'bin'}`);
    const up = await this.graph.postForm<{ id?: string }>(`${encodeURIComponent(phoneNumberId)}/media`, form, 'o arquivo');
    if (!up.id) throw new ErroMeta('Meta não devolveu o id do arquivo enviado', 502);
    return up.id;
  }

  /** Sobe o arquivo em /media e manda a mensagem com o id dele. */
  async enviarMidia(phoneNumberId: string, telefone: string, m: MidiaEnvio): Promise<EnvioResultado> {
    const up = { id: await this.subirMidia(phoneNumberId, m.conteudo, m.mimetype, m.nomeArquivo) };
    const tipo = m.tipo === 'imagem' ? 'image' : m.tipo === 'video' ? 'video' : m.tipo === 'audio' ? 'audio' : 'document';
    const midia: Record<string, unknown> = { id: up.id };
    if (tipo !== 'audio' && m.legenda?.trim()) midia.caption = m.legenda.trim();
    if (tipo === 'document' && m.nomeArquivo) midia.filename = m.nomeArquivo;
    return this.mensagem(phoneNumberId, { to: telefone, type: tipo, [tipo]: midia }, 'o envio do arquivo');
  }

  async enviarModelo(phoneNumberId: string, telefone: string, m: ModeloEnvio): Promise<EnvioResultado> {
    const template: Record<string, unknown> = { name: m.nome, language: { code: m.idioma } };
    const componentes: unknown[] = [];
    if (m.cabecalhoImagemId) componentes.push({ type: 'header', parameters: [{ type: 'image', image: { id: m.cabecalhoImagemId } }] });
    if (m.parametros?.length) componentes.push({ type: 'body', parameters: m.parametros.map((text) => ({ type: 'text', text })) });
    if (componentes.length) template.components = componentes;
    return this.mensagem(phoneNumberId, { to: telefone, type: 'template', template }, 'o modelo');
  }

  async listarModelos(): Promise<ModeloAprovado[]> {
    if (!this.wabaId) throw new ErroMeta('Preencha o WhatsApp Business Account ID da unidade em Conexões para ver os modelos', 400);
    return this.graph.modelosAprovados(this.wabaId);
  }

  async marcarLida(phoneNumberId: string, idExterno: string): Promise<void> {
    await this.graph.postJson(`${encodeURIComponent(phoneNumberId)}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: idExterno }, 'a marcação de lida');
  }

  /** Mídia recebida: GET /{media-id} dá a url (vale 5 min); a url é baixada com o token. */
  async baixarMidia(_phoneNumberId: string, _idExterno: string, ref?: string): Promise<MidiaBaixada> {
    if (!ref) throw new Error('Mensagem sem o id da mídia da Meta');
    const info = await this.graph.get<{ url?: string; mime_type?: string; file_size?: number }>(encodeURIComponent(ref), 'a mídia');
    if (!info.url) throw new Error('Meta respondeu sem o endereço do arquivo');
    if (info.file_size && info.file_size > LIMITE_MIDIA) throw new ErroMidiaGrande(info.file_size);
    const resp = await this.graph.baixar(info.url);
    const conteudo = Buffer.from(await resp.arrayBuffer());
    if (conteudo.length > LIMITE_MIDIA) throw new ErroMidiaGrande(conteudo.length);
    return { conteudo, ...(info.mime_type ? { mimetype: info.mime_type } : {}) };
  }

  /** Consulta o número na Graph API (botão "Testar"). */
  infoNumero(phoneNumberId: string): Promise<InfoNumeroMeta> {
    return this.graph.infoNumero(phoneNumberId);
  }
}

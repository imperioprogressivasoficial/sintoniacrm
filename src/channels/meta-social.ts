import type { TipoAnexo } from '../domain.js';
import { ErroMidiaGrande, LIMITE_MIDIA, textoDoAnexo } from '../midia.js';
import type { ReferenciaAnuncio } from '../rastreio/referencia.js';
import { ErroMeta, VERSAO_GRAPH } from './meta.js';
import type { AnexoRecebido, CanalWhatsApp, EnvioResultado, FotoPerfil, MensagemRecebida, MidiaBaixada, MidiaEnvio } from './tipos.js';

/**
 * Facebook Messenger (Messenger Platform) e Instagram Direct (Instagram Messaging), pela Graph API.
 *
 * Conversas hoje são por telefone. Aqui o "telefone" da conversa é um identificador com prefixo:
 *   fb:<PSID>   (Page-scoped ID do Messenger)
 *   ig:<IGSID>  (Instagram-scoped ID)
 *   tt:<open_id> (TikTok, reservado)
 * e o canalId é o da conta da loja: fb-<Page ID> / ig-<Instagram Account ID>.
 * Assim a tabela de conversas (única por empresa + unidade + telefone) continua igual e nunca colide com um celular.
 *
 * Docs: https://developers.facebook.com/docs/messenger-platform/ e
 *       https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
 */

export type RedeSocial = 'facebook' | 'instagram' | 'tiktok';
const PREFIXO: Record<RedeSocial, string> = { facebook: 'fb', instagram: 'ig', tiktok: 'tt' };
const REDE_DO_PREFIXO: Record<string, RedeSocial> = { fb: 'facebook', ig: 'instagram', tt: 'tiktok' };

/** "fb:123" — identificador da cliente na conversa (no lugar do telefone). */
export const identificadorSocial = (rede: RedeSocial, id: string) => `${PREFIXO[rede]}:${id}`;
/** "fb-999" — canalId da conta da loja na rede. */
export const canalIdSocial = (rede: RedeSocial, contaId: string) => `${PREFIXO[rede]}-${contaId}`;

/** Lê "fb:123" → { rede: 'facebook', id: '123' }. Telefone comum → undefined. */
export function lerIdentificadorSocial(telefone: string): { rede: RedeSocial; id: string } | undefined {
  const m = /^(fb|ig|tt):(.+)$/.exec(telefone);
  return m ? { rede: REDE_DO_PREFIXO[m[1]!]!, id: m[2]! } : undefined;
}
/** Conta da loja numa rede social (canalId fb-/ig-/tt-)? */
export function ehCanalSocial(canalId: string): boolean {
  return /^(fb|ig|tt)-/.test(canalId);
}
const contaDoCanal = (canalId: string) => canalId.replace(/^(fb|ig|tt)-/, '');
function idDaCliente(telefone: string): string {
  const s = lerIdentificadorSocial(telefone);
  if (!s) throw new ErroMeta('Esta conversa não é do Messenger/Instagram (sem PSID/IGSID)', 400);
  return s.id;
}

/** Canais com janela de 24 h para mensagem livre (a loja só responde até 24 h depois da última mensagem da cliente). */
export const TIPOS_COM_JANELA_24H: ReadonlyArray<CanalWhatsApp['tipo']> = ['meta', 'messenger', 'instagram'];
export const FORA_DA_JANELA_SOCIAL = 'Fora da janela de 24h: no Messenger e no Instagram a loja só responde até 24 horas depois da última mensagem da cliente.';

// ---------------------------------------------------------------- webhook

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined);

const TIPO_ANEXO: Record<string, TipoAnexo> = { image: 'imagem', video: 'video', audio: 'audio', file: 'documento', ig_reel: 'video', reel: 'video', animated_image_share: 'imagem' };

function lerAnexo(a: Obj | undefined): { texto: string; anexo?: AnexoRecebido } | undefined {
  if (!a) return undefined;
  const tipoRede = str(a.type) ?? '';
  const payload = obj(a.payload);
  const url = str(payload?.url);
  const tipo = TIPO_ANEXO[tipoRede];
  if (tipo && url) {
    const anexo: AnexoRecebido = { tipo, ref: url };
    if (tipo === 'audio') anexo.voz = true;
    return { texto: textoDoAnexo(tipo), anexo };
  }
  // Compartilhamentos e menções não são arquivos: ficam como texto para a equipe e a IA.
  if (tipoRede === 'share' || tipoRede === 'story_mention') return { texto: `[${tipoRede === 'share' ? 'publicação compartilhada' : 'menção nos stories'}]${url ? ` ${url}` : ''}` };
  if (tipoRede === 'fallback' || tipoRede === 'template') return { texto: `[link] ${str(payload?.url) ?? str(a.title) ?? ''}`.trim() };
  return undefined;
}

/** Anúncio "Enviar mensagem" (Click-to-Messenger / Click-to-Instagram Direct): `referral` com source ADS. */
function referenciaSocial(r: Obj | undefined, rede: RedeSocial): ReferenciaAnuncio | undefined {
  if (!r) return undefined;
  const fonte = str(r.source)?.toUpperCase();
  const adId = str(r.ad_id);
  if (fonte !== 'ADS' && !adId) return undefined;
  const ctx = obj(r.ads_context_data);
  const ref: ReferenciaAnuncio = { via: 'meta', tipo: 'ad', app: rede, fonteConversao: fonte?.toLowerCase() };
  if (adId) ref.adId = adId;
  const titulo = str(ctx?.ad_title);
  if (titulo) ref.titulo = titulo;
  const foto = str(ctx?.photo_url);
  const video = str(ctx?.video_url);
  if (video) Object.assign(ref, { midiaTipo: 'video', midiaUrl: video });
  else if (foto) Object.assign(ref, { midiaTipo: 'image', midiaUrl: foto });
  const url = str(r.ref);
  if (url && /^https?:/.test(url)) ref.url = url;
  return ref;
}

/**
 * Converte o corpo do webhook (object "page" no Messenger, "instagram" no Instagram) em mensagens.
 * Formato: entry[].id = conta da loja; entry[].messaging[] = { sender, recipient, timestamp (ms), message | postback | referral }.
 * Eco (message.is_echo) = a própria loja escreveu (Inbox da Meta, app do Instagram ou a Sintonia).
 */
export function lerWebhookSocial(corpo: unknown, rede: 'facebook' | 'instagram'): MensagemRecebida[] {
  const c = obj(corpo);
  const esperado = rede === 'facebook' ? 'page' : 'instagram';
  if (!c || c.object !== esperado || !Array.isArray(c.entry)) return [];
  const saida: MensagemRecebida[] = [];
  for (const e of c.entry as unknown[]) {
    const entry = obj(e);
    const conta = str(entry?.id);
    if (!entry || !conta || !Array.isArray(entry.messaging)) continue;
    for (const ev of entry.messaging as unknown[]) {
      const m = obj(ev);
      if (!m) continue;
      const remetente = str(obj(m.sender)?.id);
      const destinatario = str(obj(m.recipient)?.id);
      const msg = obj(m.message);
      const postback = obj(m.postback);
      if (!remetente || !destinatario) continue;
      if (msg?.is_deleted || msg?.is_unsupported) continue;
      const deMim = Boolean(msg?.is_echo) || remetente === conta;
      const cliente = deMim ? destinatario : remetente;
      const idExterno = str(msg?.mid) ?? str(postback?.mid);
      if (!idExterno) continue;

      let texto = str(msg?.text) ?? str(postback?.title);
      let anexo: AnexoRecebido | undefined;
      if (!texto && Array.isArray(msg?.attachments)) {
        const lido = lerAnexo(obj((msg.attachments as unknown[])[0]));
        texto = lido?.texto;
        anexo = lido?.anexo;
      }
      const story = obj(obj(msg?.reply_to)?.story);
      if (texto && story) texto = `${texto} [resposta ao story${str(story.url) ? ` ${str(story.url)}` : ''}]`;
      if (!texto) continue;

      const referencia = referenciaSocial(obj(m.referral) ?? obj(msg?.referral) ?? obj(postback?.referral), rede);
      const ts = Number(m.timestamp);
      saida.push({
        canalId: canalIdSocial(rede, conta),
        telefone: identificadorSocial(rede, cliente),
        texto,
        deMim,
        idExterno,
        em: Number.isFinite(ts) && ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(),
        rede,
        ...(anexo ? { anexo } : {}),
        ...(referencia ? { referencia } : {}),
      });
    }
  }
  return saida;
}

/** Contas da loja citadas no corpo (para conferir qual App Secret pode assiná-lo). */
export function contasDoWebhookSocial(corpo: unknown): string[] {
  const c = obj(corpo);
  if (!c || !Array.isArray(c.entry)) return [];
  return [...new Set((c.entry as unknown[]).map((e) => str(obj(e)?.id)).filter((x): x is string => Boolean(x)))];
}

// ---------------------------------------------------------------- envio

export const GRAPH_FACEBOOK = `https://graph.facebook.com/${VERSAO_GRAPH}`;
export const GRAPH_INSTAGRAM = `https://graph.instagram.com/${VERSAO_GRAPH}`;

/** Limite de texto por mensagem: Messenger 2000 caracteres; Instagram 1000 bytes (UTF-8). */
const LIMITE_TEXTO: Record<'messenger' | 'instagram', number> = { messenger: 2000, instagram: 1000 };

/** Quebra o texto em partes que cabem no limite (por parágrafo/linha/espaço quando dá). */
export function partirTexto(texto: string, limiteBytes: number, medir: (s: string) => number = (s) => Buffer.byteLength(s)): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto && medir(resto) > limiteBytes) {
    let corte = resto.length;
    while (corte > 0 && medir(resto.slice(0, corte)) > limiteBytes) corte = Math.floor(corte * 0.9);
    const janela = resto.slice(0, corte);
    const quebra = Math.max(janela.lastIndexOf('\n'), janela.lastIndexOf('. '), janela.lastIndexOf(' '));
    const fim = quebra > corte * 0.5 ? quebra + 1 : corte;
    partes.push(resto.slice(0, fim).trim());
    resto = resto.slice(fim).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

const EXPLICACOES: Record<number, string> = {
  190: 'token de acesso inválido ou vencido',
  10: 'o token não tem a permissão de mensagens (pages_messaging / instagram_manage_messages) ou a mensagem saiu da janela de 24 h',
  200: 'permissão negada (confira o app review e se a conta está ligada ao app)',
  230: 'é preciso a permissão pages_messaging',
  551: 'esta pessoa não pode receber mensagens agora',
  100: 'pedido recusado pela Meta (confira o Page ID / Instagram Account ID)',
};

async function erroSocial(resp: Response, acao: string): Promise<ErroMeta> {
  const bruto = await resp.text().catch(() => '');
  let codigo: number | undefined;
  let sub: number | undefined;
  let msg = bruto.slice(0, 300);
  try {
    const j = JSON.parse(bruto) as { error?: { message?: string; code?: number; error_subcode?: number } };
    codigo = j.error?.code;
    sub = j.error?.error_subcode;
    msg = j.error?.message ?? msg;
  } catch {
    /* não era JSON */
  }
  // 10/2018278 (Messenger) e 2534022 (Instagram): fora da janela de 24 h.
  if (sub === 2018278 || sub === 2534022) return new ErroMeta(FORA_DA_JANELA_SOCIAL, resp.status, codigo);
  const exp = codigo !== undefined ? EXPLICACOES[codigo] : undefined;
  return new ErroMeta(`Meta recusou ${acao} (${resp.status}${codigo ? `, código ${codigo}` : ''}): ${exp ? `${exp}. ` : ''}${msg}`.slice(0, 500), resp.status, codigo);
}

export interface PerfilSocial {
  nome?: string;
  usuario?: string;
  fotoUrl?: string;
}

export interface ContaSocial {
  /** Page Access Token (Messenger e Instagram pelo login do Facebook) ou Instagram User Access Token (começa com "IG"). */
  token: string;
  /** Messenger: Page ID. Instagram: Instagram Business Account ID (o IG_ID). */
  contaId: string;
  /** Instagram pelo login do Facebook: a Página ligada à conta (o envio sai por /{PAGE_ID}/messages). */
  pageId?: string;
  /**
   * Instagram só aceita arquivo por URL pública (não há upload de arquivo no envio).
   * Quem monta o canal diz como publicar o arquivo por um tempo; sem isso, o envio de arquivo é recusado com explicação.
   */
  publicarMidia?: (m: MidiaEnvio) => Promise<string>;
}

/** Base comum: Graph API com o token da conta. */
abstract class CanalSocialBase implements CanalWhatsApp {
  abstract readonly tipo: 'messenger' | 'instagram';
  protected abstract readonly rede: 'facebook' | 'instagram';
  private readonly perfis = new Map<string, { em: number; p: PerfilSocial }>();

  constructor(
    protected readonly conta: ContaSocial,
    protected readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Instagram API com login do Instagram usa graph.instagram.com (token "IG..."); o resto, graph.facebook.com. */
  protected get base(): string {
    return this.rede === 'instagram' && this.conta.token.startsWith('IG') ? GRAPH_INSTAGRAM : GRAPH_FACEBOOK;
  }
  /** Quem envia: Messenger = a Página; Instagram = o IG_ID (login do Instagram) ou a Página ligada (login do Facebook). */
  protected abstract caminhoEnvio(): string;

  lerWebhook(corpo: unknown): MensagemRecebida[] {
    return lerWebhookSocial(corpo, this.rede);
  }

  protected async pedir<T>(caminho: string, init: RequestInit, acao: string): Promise<T> {
    const resp = await this.fetchFn(`${this.base}/${caminho}`, {
      ...init,
      headers: { authorization: `Bearer ${this.conta.token}`, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw await erroSocial(resp, acao);
    return (await resp.json()) as T;
  }

  protected async enviar(corpo: Record<string, unknown>, acao: string): Promise<EnvioResultado> {
    const j = await this.pedir<{ message_id?: string }>(
      this.caminhoEnvio(),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) },
      acao,
    );
    return { idExterno: j.message_id ?? '' };
  }

  /** Texto livre (resposta dentro da janela de 24 h). Texto longo vai em partes. */
  async enviarTexto(_canalId: string, telefone: string, texto: string): Promise<EnvioResultado> {
    const id = idDaCliente(telefone);
    const limite = LIMITE_TEXTO[this.tipo];
    const medir = this.tipo === 'instagram' ? (s: string) => Buffer.byteLength(s) : (s: string) => s.length;
    let ultimo: EnvioResultado = { idExterno: '' };
    for (const parte of partirTexto(texto, limite, medir)) {
      ultimo = await this.enviar({ recipient: { id }, messaging_type: 'RESPONSE', message: { text: parte } }, 'o envio');
    }
    return ultimo;
  }

  abstract enviarMidia(canalId: string, telefone: string, m: MidiaEnvio): Promise<EnvioResultado>;

  /** Arquivo recebido: a url do anexo (CDN da Meta, expira) já veio no webhook. */
  async baixarMidia(_canalId: string, _idExterno: string, ref?: string): Promise<MidiaBaixada> {
    if (!ref || !/^https:\/\//.test(ref)) throw new Error('Anexo sem endereço');
    const resp = await this.fetchFn(ref, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`Meta não entregou o anexo (${resp.status})`);
    const tam = Number(resp.headers.get('content-length') ?? 0);
    if (tam > LIMITE_MIDIA) throw new ErroMidiaGrande(tam);
    const conteudo = Buffer.from(await resp.arrayBuffer());
    if (conteudo.length > LIMITE_MIDIA) throw new ErroMidiaGrande(conteudo.length);
    const mimetype = resp.headers.get('content-type') ?? undefined;
    return { conteudo, ...(mimetype ? { mimetype } : {}) };
  }

  protected abstract camposPerfil: string;
  protected abstract lerPerfil(j: Obj): PerfilSocial;

  /** Nome e foto da cliente (User Profile API / Instagram User Profile). Guardado por 1 h. */
  async perfil(_canalId: string, telefone: string): Promise<PerfilSocial> {
    const id = idDaCliente(telefone);
    const guardado = this.perfis.get(id);
    if (guardado && Date.now() - guardado.em < 3600_000) return guardado.p;
    const j = await this.pedir<Obj>(`${encodeURIComponent(id)}?fields=${this.camposPerfil}`, { method: 'GET' }, 'o perfil');
    const p = this.lerPerfil(j);
    this.perfis.set(id, { em: Date.now(), p });
    return p;
  }

  async buscarFoto(canalId: string, telefone: string): Promise<FotoPerfil | null> {
    const p = await this.perfil(canalId, telefone);
    if (!p.fotoUrl) return null;
    const resp = await this.fetchFn(p.fotoUrl, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) return null;
    return { conteudo: Buffer.from(await resp.arrayBuffer()), tipo: resp.headers.get('content-type') ?? 'image/jpeg' };
  }
}

const TIPO_ENVIO: Record<MidiaEnvio['tipo'], string> = { imagem: 'image', video: 'video', audio: 'audio', documento: 'file' };

/** Facebook Messenger: mensagens da Página. canalId = fb-<Page ID>. */
export class CanalMessenger extends CanalSocialBase {
  readonly tipo = 'messenger' as const;
  protected readonly rede = 'facebook' as const;
  protected readonly camposPerfil = 'first_name,last_name,profile_pic';

  protected caminhoEnvio() {
    return `${encodeURIComponent(this.conta.contaId)}/messages`;
  }

  /** Arquivo: upload junto com a mensagem (multipart "filedata"). Legenda vai numa mensagem de texto logo depois. */
  async enviarMidia(canalId: string, telefone: string, m: MidiaEnvio): Promise<EnvioResultado> {
    const id = idDaCliente(telefone);
    const form = new FormData();
    form.append('recipient', JSON.stringify({ id }));
    form.append('messaging_type', 'RESPONSE');
    form.append('message', JSON.stringify({ attachment: { type: TIPO_ENVIO[m.tipo], payload: { is_reusable: false } } }));
    form.append('filedata', new Blob([new Uint8Array(m.conteudo)], { type: m.mimetype }), m.nomeArquivo ?? `arquivo.${m.mimetype.split('/')[1]?.split(';')[0] ?? 'bin'}`);
    const j = await this.pedir<{ message_id?: string }>(this.caminhoEnvio(), { method: 'POST', body: form }, 'o envio do arquivo');
    if (m.legenda?.trim()) await this.enviarTexto(canalId, telefone, m.legenda.trim());
    return { idExterno: j.message_id ?? '' };
  }

  protected lerPerfil(j: Obj): PerfilSocial {
    const nome = [str(j.first_name), str(j.last_name)].filter(Boolean).join(' ');
    return { ...(nome ? { nome } : {}), ...(str(j.profile_pic) ? { fotoUrl: str(j.profile_pic) } : {}) };
  }

  /** Botão "Testar": nome da Página. */
  async testar(): Promise<{ nome: string; id: string }> {
    const j = await this.pedir<{ name?: string; id?: string }>(`${encodeURIComponent(this.conta.contaId)}?fields=name,id`, { method: 'GET' }, 'a consulta da Página');
    return { nome: j.name ?? '', id: j.id ?? this.conta.contaId };
  }
}

/** Instagram Direct. canalId = ig-<Instagram Account ID>. */
export class CanalInstagram extends CanalSocialBase {
  readonly tipo = 'instagram' as const;
  protected readonly rede = 'instagram' as const;
  protected readonly camposPerfil = 'name,username,profile_pic';

  protected caminhoEnvio() {
    if (this.base === GRAPH_INSTAGRAM) return `${encodeURIComponent(this.conta.contaId)}/messages`;
    return `${encodeURIComponent(this.conta.pageId ?? 'me')}/messages`;
  }

  /** Instagram recebe arquivo só por URL (payload.url). Sem como publicar o arquivo, recusa explicando. */
  async enviarMidia(canalId: string, telefone: string, m: MidiaEnvio): Promise<EnvioResultado> {
    const id = idDaCliente(telefone);
    if (!this.conta.publicarMidia) throw new ErroMeta('O Instagram só envia arquivo por um endereço público; envio de arquivo pelo Instagram ainda não está ligado nesta instalação.', 400);
    if (m.tipo === 'documento' && m.mimetype !== 'application/pdf') throw new ErroMeta('O Instagram só aceita foto, vídeo, áudio e PDF.', 400);
    const url = await this.conta.publicarMidia(m);
    const r = await this.enviar({ recipient: { id }, message: { attachment: { type: TIPO_ENVIO[m.tipo], payload: { url } } } }, 'o envio do arquivo');
    if (m.legenda?.trim()) await this.enviarTexto(canalId, telefone, m.legenda.trim());
    return r;
  }

  protected lerPerfil(j: Obj): PerfilSocial {
    const usuario = str(j.username);
    const nome = str(j.name) ?? (usuario ? `@${usuario}` : undefined);
    return { ...(nome ? { nome } : {}), ...(usuario ? { usuario } : {}), ...(str(j.profile_pic) ? { fotoUrl: str(j.profile_pic) } : {}) };
  }

  /** Botão "Testar": usuário da conta. */
  async testar(): Promise<{ nome: string; id: string }> {
    const caminho = this.base === GRAPH_INSTAGRAM ? 'me?fields=user_id,username,name' : `${encodeURIComponent(this.conta.contaId)}?fields=id,username,name`;
    const j = await this.pedir<{ username?: string; name?: string; id?: string; user_id?: string }>(caminho, { method: 'GET' }, 'a consulta da conta do Instagram');
    return { nome: j.username ? `@${j.username}` : (j.name ?? ''), id: j.user_id ?? j.id ?? this.conta.contaId };
  }
}

export const contaDoCanalSocial = contaDoCanal;

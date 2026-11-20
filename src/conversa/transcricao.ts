import type pg from 'pg';

/**
 * Transcrição dos áudios das conversas (OpenAI Whisper). Cada áudio é transcrito uma vez:
 * o texto fica guardado e a próxima pessoa que abrir a conversa já lê.
 */

export interface Transcritor {
  /** Devolve o texto falado no áudio. */
  transcrever(audio: Buffer, mimetype: string): Promise<string>;
  readonly modelo: string;
}

export class ErroTranscricao extends Error {
  constructor(
    message: string,
    readonly codigo: 'sem_chave' | 'falhou' | 'grande',
  ) {
    super(message);
  }
}

/** Limite da API de transcrição da OpenAI. */
export const LIMITE_TRANSCRICAO = 25 * 1024 * 1024;

const EXTENSAO: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * Whisper pela API da OpenAI. A chave vem da tela de Conexões e é lida a cada chamada
 * (trocou lá, vale na próxima transcrição).
 */
export class TranscritorOpenAI implements Transcritor {
  constructor(
    private readonly chave: () => string | undefined,
    readonly modelo = 'whisper-1',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async transcrever(audio: Buffer, mimetype: string): Promise<string> {
    const chave = this.chave();
    if (!chave) throw new ErroTranscricao('Configure a chave da OpenAI em Conexões (Transcrição de áudio).', 'sem_chave');
    if (audio.length > LIMITE_TRANSCRICAO) throw new ErroTranscricao('Áudio grande demais para transcrever (limite de 25 MB).', 'grande');
    const tipo = mimetype.split(';')[0]!.trim().toLowerCase();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: tipo || 'audio/ogg' }), `audio.${EXTENSAO[tipo] ?? 'ogg'}`);
    form.append('model', this.modelo);
    form.append('language', 'pt');
    form.append('response_format', 'json');
    const r = await this.fetchFn('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (r.status === 401) throw new ErroTranscricao('A chave da OpenAI foi recusada. Confira em Conexões.', 'sem_chave');
    if (!r.ok) {
      const corpo = (await r.text().catch(() => '')).slice(0, 200);
      throw new ErroTranscricao(`A transcrição falhou (OpenAI ${r.status}). ${corpo}`.trim(), 'falhou');
    }
    const j = (await r.json().catch(() => ({}))) as { text?: string };
    return String(j.text ?? '').trim();
  }
}

/**
 * Whisper rodando no próprio servidor (serviço "whisper" do docker-compose, faster-whisper em CPU).
 * Grátis por áudio: nada sai do servidor. Responde no formato do openai-whisper-asr-webservice (POST /asr).
 */
export class TranscritorLocal implements Transcritor {
  constructor(
    private readonly url: string,
    readonly modelo = 'whisper-local',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async transcrever(audio: Buffer, mimetype: string): Promise<string> {
    if (audio.length > LIMITE_TRANSCRICAO) throw new ErroTranscricao('Áudio grande demais para transcrever (limite de 25 MB).', 'grande');
    const tipo = mimetype.split(';')[0]!.trim().toLowerCase();
    const form = new FormData();
    form.append('audio_file', new Blob([new Uint8Array(audio)], { type: tipo || 'audio/ogg' }), `audio.${EXTENSAO[tipo] ?? 'ogg'}`);
    const r = await this.fetchFn(`${this.url.replace(/\/$/, '')}/asr?task=transcribe&language=pt&output=json&encode=true&vad_filter=true`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) throw new ErroTranscricao(`A transcrição no servidor falhou (${r.status}).`, 'falhou');
    const j = (await r.json().catch(() => ({}))) as { text?: string };
    return String(j.text ?? '').trim();
  }
}

/** Tenta o Whisper do servidor (grátis); se ele não estiver no ar e houver chave da OpenAI, usa a OpenAI. */
export class TranscritorComReserva implements Transcritor {
  constructor(
    private readonly local: Transcritor | null,
    private readonly reserva: Transcritor,
    private readonly temChaveReserva: () => boolean,
  ) {}
  get modelo() {
    return this.local ? this.local.modelo : this.reserva.modelo;
  }
  async transcrever(audio: Buffer, mimetype: string): Promise<string> {
    if (!this.local) return this.reserva.transcrever(audio, mimetype);
    try {
      return await this.local.transcrever(audio, mimetype);
    } catch (e) {
      if ((e as ErroTranscricao).codigo === 'grande' || !this.temChaveReserva()) throw e;
      return this.reserva.transcrever(audio, mimetype);
    }
  }
}

export interface Transcricao {
  mensagemId: string;
  texto: string;
  modelo: string | null;
  criadaPor: string | null;
  criadaEm: Date;
}

export interface ArmazemTranscricoes {
  obter(mensagemId: string): Promise<Transcricao | undefined>;
  daConversa(conversaId: string): Promise<Transcricao[]>;
  guardar(conversaId: string, t: Omit<Transcricao, 'criadaEm'>): Promise<Transcricao>;
}

export class TranscricoesMemoria implements ArmazemTranscricoes {
  private readonly dados = new Map<string, Transcricao & { conversaId: string }>();
  async obter(mensagemId: string) {
    const t = this.dados.get(mensagemId);
    if (!t) return undefined;
    const { conversaId: _c, ...resto } = t;
    return resto;
  }
  async daConversa(conversaId: string) {
    return [...this.dados.values()].filter((t) => t.conversaId === conversaId).map(({ conversaId: _c, ...t }) => t);
  }
  async guardar(conversaId: string, t: Omit<Transcricao, 'criadaEm'>) {
    // A primeira que chegar vale (duas pessoas clicando juntas não transcrevem duas versões).
    if (!this.dados.has(t.mensagemId)) this.dados.set(t.mensagemId, { ...t, conversaId, criadaEm: new Date() });
    return (await this.obter(t.mensagemId))!;
  }
}

interface Linha {
  mensagem_id: string;
  texto: string;
  modelo: string | null;
  criada_por: string | null;
  criada_em: Date;
}
const daLinha = (l: Linha): Transcricao => ({ mensagemId: l.mensagem_id, texto: l.texto, modelo: l.modelo, criadaPor: l.criada_por, criadaEm: l.criada_em });

export class TranscricoesPostgres implements ArmazemTranscricoes {
  constructor(private readonly pool: pg.Pool) {}
  async obter(mensagemId: string) {
    const { rows } = await this.pool.query<Linha>('select * from sintonia.transcricoes where mensagem_id = $1', [mensagemId]);
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async daConversa(conversaId: string) {
    const { rows } = await this.pool.query<Linha>('select * from sintonia.transcricoes where conversa_id = $1', [conversaId]);
    return rows.map(daLinha);
  }
  async guardar(conversaId: string, t: Omit<Transcricao, 'criadaEm'>) {
    await this.pool.query(
      `insert into sintonia.transcricoes (mensagem_id, conversa_id, texto, modelo, criada_por) values ($1, $2, $3, $4, $5)
       on conflict (mensagem_id) do nothing`,
      [t.mensagemId, conversaId, t.texto, t.modelo, t.criadaPor],
    );
    return (await this.obter(t.mensagemId))!;
  }
}

import type { NumeroConectado } from '../app/sintonia.js';
import { ErroEnvioWhatsApp, lerGruposEvolution, type MensagemGrupoRecebida } from '../channels/evolution.js';
import type { InfoGrupo } from '../channels/evolution-admin.js';
import { PREFIXO_INSTANCIA } from '../channels/evolution-admin.js';
import type { MidiaEnvio } from '../channels/tipos.js';
import { LIMITE_MIDIA, textoDoAnexo } from '../midia.js';
import type { AnexoGrupo, ArmazemGrupos, Grupo, MensagemGrupo } from './armazem.js';

/**
 * Conversas de grupo: os grupos do WhatsApp pela API não oficial (Evolution).
 * Recebe as mensagens de grupo do webhook (messages.upsert e o histórico messages.set), guarda em tabelas
 * próprias e envia texto, foto, documento e áudio para o grupo. Nada aqui chama a IA, o funil, os alarmes
 * ou as automações: grupo não é conversa de cliente.
 */

/** O que a Sintonia usa da administração da Evolution (src/channels/evolution-admin.ts). */
export interface AdminGrupos {
  infoGrupo(instancia: string, jid: string): Promise<InfoGrupo | null>;
  listarGrupos(instancia: string): Promise<InfoGrupo[]>;
  historicoGrupos(instancia: string, o?: { grupos?: number; porGrupo?: number }): Promise<unknown[]>;
  liberarGrupos(instancia: string): Promise<'liberado' | 'ja_liberado'>;
}

export interface DependenciasGrupos {
  empresaId: string;
  armazem: ArmazemGrupos;
  /** Números conectados (o grupo é do número que o recebeu; a unidade dele diz quem vê). */
  numeros: () => NumeroConectado[];
  /** Administração da Evolution (undefined = sem endereço ou chave). */
  admin?: () => AdminGrupos | undefined;
  fetchFn?: typeof fetch;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

/** Nome e foto do grupo ficam guardados por 6 horas antes de perguntar de novo à Evolution. */
const VALIDADE_INFO_MS = 6 * 60 * 60 * 1000;
/** "Ignorar grupos": confere cada instância no máximo uma vez por hora. */
const INTERVALO_LIBERAR_MS = 60 * 60 * 1000;

export const erroGrupo = (msg: string, statusCode: number, codigo?: string) => Object.assign(new Error(msg), { statusCode, ...(codigo ? { codigo } : {}) });

function anexoDe(r: MensagemGrupoRecebida['anexo']): AnexoGrupo | null {
  if (!r) return null;
  const a: AnexoGrupo = { tipo: r.tipo };
  if (r.mimetype) a.mimetype = r.mimetype;
  if (r.nomeArquivo) a.nomeArquivo = r.nomeArquivo;
  if (r.duracaoSeg !== undefined) a.duracaoSeg = r.duracaoSeg;
  if (r.legenda) a.legenda = r.legenda;
  if (r.tamanho !== undefined) a.tamanho = r.tamanho;
  if (r.voz) a.voz = true;
  return a;
}

export class Grupos {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly fetchFn: typeof fetch;
  /** Grupos com nome/foto sendo lidos agora (não pergunta duas vezes ao mesmo tempo). */
  private readonly lendoInfo = new Set<string>();
  /** Última vez que conferiu o "ignorar grupos" de cada instância. */
  private readonly liberados = new Map<string, number>();
  private pendentes: Promise<unknown>[] = [];

  constructor(private readonly d: DependenciasGrupos) {
    this.agora = d.agora ?? (() => new Date());
    this.log = d.log ?? (() => {});
    this.fetchFn = d.fetchFn ?? fetch;
  }

  private numero(canalId: string) {
    return this.d.numeros().find((n) => n.canalId === canalId);
  }

  /** Espera os trabalhos de fundo (nome e foto dos grupos). Para os testes. */
  async ocioso(): Promise<void> {
    while (this.pendentes.length) {
      const p = this.pendentes;
      this.pendentes = [];
      await Promise.allSettled(p);
    }
  }
  private fundo(p: Promise<unknown>) {
    const q = p.catch((e) => this.log('Conversas de grupo: falha em segundo plano', String(e)));
    this.pendentes.push(q);
    q.finally(() => (this.pendentes = this.pendentes.filter((x) => x !== q)));
  }

  /**
   * Webhook da Evolution: grava só as mensagens de grupo (o resto segue o caminho das conversas).
   * messages.set (histórico) entra sem contar como não lida. Devolve quantas mensagens novas gravou.
   */
  async aoWebhook(corpo: unknown): Promise<number> {
    const lista = lerGruposEvolution(corpo);
    if (!lista.length) return 0;
    const historico = String((corpo as { event?: unknown }).event ?? '').toLowerCase().replace(/_/g, '.') === 'messages.set';
    return this.receber(lista, { historico });
  }

  async receber(lista: MensagemGrupoRecebida[], o: { historico?: boolean } = {}): Promise<number> {
    let n = 0;
    const tocados = new Map<string, Grupo>();
    for (const m of [...lista].sort((a, b) => a.em.getTime() - b.em.getTime())) {
      const numero = this.numero(m.canalId);
      if (!numero) {
        this.log('Mensagem de grupo de número não cadastrado', m.canalId);
        continue;
      }
      const g = await this.d.armazem.grupo({ empresaId: this.d.empresaId, canalId: numero.canalId, unidade: numero.unidade, jid: m.grupoJid });
      tocados.set(g.id, g);
      const anexo = anexoDe(m.anexo);
      const gravada = await this.d.armazem.adicionar({
        grupoId: g.id,
        idExterno: m.idExterno,
        autor: m.deMim ? 'equipe' : 'participante',
        participante: m.participante,
        participanteJid: m.participanteJid,
        participanteNome: m.participanteNome ?? null,
        autorNome: m.deMim ? 'celular da loja' : null,
        usuarioId: null,
        texto: m.texto,
        anexo,
        historico: Boolean(o.historico),
        em: m.em,
      });
      if (!gravada) continue;
      n++;
      if (m.anexo?.base64) {
        const conteudo = Buffer.from(m.anexo.base64, 'base64');
        if (conteudo.length && conteudo.length <= LIMITE_MIDIA) await this.d.armazem.guardarMidia(gravada.id, conteudo).catch((e) => this.log('Falha ao guardar mídia de grupo', String(e)));
      }
    }
    for (const g of tocados.values()) this.talvezAtualizarInfo(g);
    return n;
  }

  /** Nome e foto vencidos (ou nunca lidos): pede à Evolution por trás, sem segurar o webhook. */
  talvezAtualizarInfo(g: Grupo): void {
    if (g.infoEm && this.agora().getTime() - g.infoEm.getTime() < VALIDADE_INFO_MS) return;
    if (this.lendoInfo.has(g.id)) return;
    const admin = this.d.admin?.();
    if (!admin) return;
    this.lendoInfo.add(g.id);
    this.fundo(this.atualizarInfo(g, admin).finally(() => this.lendoInfo.delete(g.id)));
  }

  private async atualizarInfo(g: Grupo, admin: AdminGrupos, info?: InfoGrupo | null): Promise<void> {
    const i = info === undefined ? await admin.infoGrupo(g.canalId, g.jid) : info;
    await this.d.armazem.atualizarInfo(g.id, { nome: i?.nome ?? null, participantes: i?.participantes ?? null }, this.agora());
    if (i?.fotoUrl) {
      const foto = await this.baixarFoto(i.fotoUrl).catch(() => null);
      if (foto) await this.d.armazem.guardarFoto(g.id, foto);
    }
  }

  private async baixarFoto(url: string): Promise<{ conteudo: Buffer; tipo: string } | null> {
    const r = await this.fetchFn(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const tipo = r.headers.get('content-type') ?? 'image/jpeg';
    if (!tipo.startsWith('image/')) return null;
    const conteudo = Buffer.from(await r.arrayBuffer());
    return conteudo.length > 0 && conteudo.length < 2_000_000 ? { conteudo, tipo } : null;
  }

  /** Instâncias da Evolution da Sintonia em uso. */
  private instancias(): string[] {
    return this.d
      .numeros()
      .filter((n) => n.canal.tipo === 'evolution' && n.canalId.startsWith(PREFIXO_INSTANCIA))
      .map((n) => n.canalId);
  }

  /**
   * Desliga o "ignorar grupos" das instâncias já conectadas (no máximo uma vez por hora cada).
   * Só muda a configuração na Evolution: o WhatsApp do dono continua conectado.
   */
  async liberarGrupos(forcar = false): Promise<Record<string, 'liberado' | 'ja_liberado' | 'falhou'>> {
    const admin = this.d.admin?.();
    const r: Record<string, 'liberado' | 'ja_liberado' | 'falhou'> = {};
    if (!admin) return r;
    const agora = Date.now();
    for (const inst of this.instancias()) {
      if (!forcar && agora - (this.liberados.get(inst) ?? 0) < INTERVALO_LIBERAR_MS) continue;
      this.liberados.set(inst, agora);
      try {
        r[inst] = await admin.liberarGrupos(inst);
        if (r[inst] === 'liberado') this.log('Conversas de grupo: "ignorar grupos" desligado na instância', inst);
      } catch (e) {
        r[inst] = 'falhou';
        this.log('Conversas de grupo: não deu para conferir "ignorar grupos"', { inst, erro: String(e).slice(0, 200) });
      }
    }
    return r;
  }

  /** Ao abrir a tela: confere o "ignorar grupos" por trás (não atrasa a lista). */
  prepararPorTras(): void {
    this.fundo(this.liberarGrupos());
  }

  /**
   * "Sincronizar": libera os grupos, traz a lista de grupos (nome, quantas pessoas, foto) e as mensagens recentes
   * guardadas na Evolution (entram como histórico, sem contar como não lidas).
   */
  async sincronizar(): Promise<{ grupos: number; mensagens: number }> {
    const admin = this.d.admin?.();
    if (!admin) throw erroGrupo('O WhatsApp não oficial não está configurado em Conexões.', 422);
    await this.liberarGrupos(true);
    let grupos = 0;
    let mensagens = 0;
    for (const inst of this.instancias()) {
      const numero = this.numero(inst)!;
      const lista = await admin.listarGrupos(inst).catch((e) => (this.log('Falha ao listar grupos', String(e)), [] as InfoGrupo[]));
      for (const info of lista) {
        const g = await this.d.armazem.grupo({ empresaId: this.d.empresaId, canalId: inst, unidade: numero.unidade, jid: info.jid });
        await this.atualizarInfo(g, admin, info).catch(() => {});
        grupos++;
      }
      const brutas = await admin.historicoGrupos(inst).catch((e) => (this.log('Falha ao puxar mensagens dos grupos', String(e)), [] as unknown[]));
      mensagens += await this.receber(lerGruposEvolution({ event: 'messages.set', instance: inst, data: brutas }), { historico: true });
    }
    return { grupos, mensagens };
  }

  // ---------- envio ----------

  private canalDoGrupo(g: Grupo) {
    const n = this.numero(g.canalId);
    if (!n) throw new ErroEnvioWhatsApp('desconectado', `canal ${g.canalId} fora da lista de números`);
    if (n.canal.tipo !== 'evolution') throw erroGrupo('Este número não envia para grupos (só o WhatsApp não oficial).', 422);
    return n;
  }

  async enviarTexto(g: Grupo, texto: string, quem: { id?: string; nome: string }): Promise<MensagemGrupo> {
    const n = this.canalDoGrupo(g);
    const r = await n.canal.enviarTexto(n.canalId, g.jid, texto);
    return this.gravarNossa(g, { texto, anexo: null, idExterno: r.idExterno }, quem);
  }

  async enviarMidia(g: Grupo, midia: MidiaEnvio, quem: { id?: string; nome: string }): Promise<MensagemGrupo> {
    const n = this.canalDoGrupo(g);
    if (!n.canal.enviarMidia) throw erroGrupo('Este número ainda não envia arquivos pela Sintonia.', 422);
    const legenda = midia.legenda?.trim() || undefined;
    const r = await n.canal.enviarMidia(n.canalId, g.jid, { ...midia, legenda });
    const tipo = midia.tipo;
    const anexo: AnexoGrupo = { tipo, mimetype: midia.mimetype, tamanho: midia.conteudo.length };
    if (midia.nomeArquivo) anexo.nomeArquivo = midia.nomeArquivo;
    if (legenda) anexo.legenda = legenda;
    if (tipo === 'audio') anexo.voz = true;
    const m = await this.gravarNossa(g, { texto: textoDoAnexo(tipo, legenda, midia.nomeArquivo), anexo, idExterno: r.idExterno }, quem);
    await this.d.armazem.guardarMidia(m.id, midia.conteudo);
    return { ...m, temMidia: true };
  }

  private async gravarNossa(g: Grupo, m: { texto: string; anexo: AnexoGrupo | null; idExterno: string }, quem: { id?: string; nome: string }): Promise<MensagemGrupo> {
    const em = this.agora();
    const idExterno = m.idExterno || `sintonia-${em.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const nova = {
      grupoId: g.id,
      idExterno,
      autor: 'equipe' as const,
      participante: null,
      participanteJid: null,
      participanteNome: null,
      autorNome: quem.nome,
      usuarioId: quem.id ?? null,
      texto: m.texto,
      anexo: m.anexo,
      historico: false,
      em,
    };
    const gravada = (await this.d.armazem.adicionar(nova, { nossa: true })) ?? (await this.d.armazem.mensagens(g.id, 50)).find((x) => x.idExterno === idExterno);
    if (quem.id) await this.d.armazem.marcarLida(quem.id, [g.id], em);
    return gravada ?? { ...nova, id: '', temMidia: false };
  }

  /** Arquivo de uma mensagem do grupo: guardado aqui, ou baixado agora da Evolution (e guardado). */
  async midia(m: MensagemGrupo, g: Grupo): Promise<Buffer | undefined> {
    const guardada = await this.d.armazem.midia(m.id);
    if (guardada) return guardada;
    if (!m.anexo || (m.autor === 'equipe' && m.usuarioId)) return undefined;
    const n = this.numero(g.canalId);
    if (!n?.canal.baixarMidia) return undefined;
    const b = await n.canal.baixarMidia(n.canalId, m.idExterno);
    if (b.conteudo.length > LIMITE_MIDIA) return undefined;
    await this.d.armazem.guardarMidia(m.id, b.conteudo);
    return b.conteudo;
  }
}

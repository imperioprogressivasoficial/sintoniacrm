import { randomUUID } from 'node:crypto';
import type { Anexo, Conversa, Mensagem, UnidadeId } from '../domain.js';
import type { TipoEnvio } from '../engine/followups.js';

/** Envio ativo programado, ou uma reavaliação de "quem responde". */
export interface Tarefa {
  id: string;
  conversaId: string;
  tipo: TipoEnvio | 'reavaliar';
  quando: Date;
  feita: boolean;
}

/** Registro do que aconteceu, para o relatório diário e o painel. */
export type TipoEvento =
  | 'conversa_nova'
  | 'mensagem_cliente'
  | 'ia_respondeu'
  | 'ia_assumiu'
  | 'equipe_respondeu'
  | 'sugestao_gerada'
  | 'agendamento_ia'
  | 'agendamento_equipe'
  | 'passou_para_humano'
  | 'etapa_mudou'
  | 'envio_ativo'
  /** Atendente ligou para a cliente (aba Ligações). */
  | 'ligacao'
  /** A conversa mudou de dona (assumiu, transferiu, liberou ou primeira resposta). */
  | 'transferencia'
  /** Tag marcada/desmarcada numa conversa (dados: tagId, nome, por). */
  | 'tag_marcada'
  | 'tag_desmarcada'
  /** Cartão mudou de etapa num funil (dados: funilId, de, para, por, porId, automatico). */
  | 'etapa_movida'
  /** Uma automação agiu numa conversa (dados: automacaoId, execucaoId, acao, ...). */
  | 'automacao'
  /** Lembrete de ligação criado por automação (dados: quando, texto, automacaoId): aparece em "Ligar hoje". */
  | 'lembrete_ligacao'
  | 'falha';

export interface Evento {
  tipo: TipoEvento;
  conversaId?: string;
  unidade?: UnidadeId;
  em: Date;
  dados?: Record<string, unknown>;
}

/** Alguém da equipe digitando numa conversa (anti-duplicidade). */
export interface Digitando {
  usuarioId: string;
  nome: string;
  /** Início da sequência de digitação: quem começou primeiro tem a vez. */
  desde: Date;
  /** Último sinal de digitação. */
  em: Date;
}

/** Depois de quanto tempo sem sinal a pessoa deixa de contar como "respondendo". */
export const VALIDADE_DIGITANDO_MS = 60_000;

/** Mídia esperando download (fila própria, na tabela de mídias). */
export interface MidiaPendente {
  mensagemId: string;
  conversaId: string;
  canalId: string;
  idExterno: string;
  /** Contando com esta. */
  tentativas: number;
}

/** Arquivo guardado de uma mensagem. */
export interface MidiaGuardada {
  conversaId: string;
  anexo: Anexo;
  conteudo: Buffer | null;
}

export interface Repositorio {
  buscarConversa(id: string): Promise<Conversa | undefined>;
  buscarOuCriarConversa(dados: {
    empresaId: string;
    unidade: UnidadeId;
    canalId: string;
    telefone: string;
    nome?: string;
    agora: Date;
  }): Promise<{ conversa: Conversa; nova: boolean }>;
  salvarConversa(c: Conversa): Promise<void>;
  listarConversas(): Promise<Conversa[]>;

  /**
   * Retorna false se a mensagem (pelo idExterno) já foi registrada.
   * Com `anexo`, grava junto os dados da mídia (o arquivo vem depois, em `guardarMidia`).
   * `id` opcional: quem grava pode escolher o id para guardar a mídia logo em seguida.
   */
  adicionarMensagem(m: Omit<Mensagem, 'id'> & { id?: string }): Promise<boolean>;

  // ---------- mídias (fotos, áudios, vídeos, documentos) ----------
  midia(mensagemId: string): Promise<MidiaGuardada | undefined>;
  /** Arquivo baixado: situação "pronta". */
  guardarMidia(mensagemId: string, r: { conteudo: Buffer; mimetype?: string; nomeArquivo?: string }): Promise<void>;
  /** Passou do limite: ficam só os dados. */
  midiaGrande(mensagemId: string, tamanho?: number): Promise<void>;
  /** Falha ao baixar: com `proxima`, tenta de novo nessa hora; sem, desiste (situação "falhou"). */
  falhaMidia(mensagemId: string, erro: string, proxima?: Date): Promise<void>;
  /**
   * Pega as mídias pendentes vencidas e as reserva por `reservaMs` (se o processo cair, outro retoma).
   * Com vários processos, cada mídia sai para um só.
   */
  reivindicarMidias(agora: Date, limite?: number, reservaMs?: number): Promise<MidiaPendente[]>;
  /** Volta uma mídia que falhou para a fila (botão "tentar de novo"). Retorna false se não estava em falha. */
  rebaixarMidia(mensagemId: string, agora: Date): Promise<boolean>;
  mensagens(conversaId: string, limite?: number): Promise<Mensagem[]>;
  /** Foto de perfil guardada (conteudo null = a cliente não tem foto). */
  foto(telefone: string): Promise<{ conteudo: Buffer | null; tipo: string | null; atualizadaEm: Date } | undefined>;
  salvarFoto(telefone: string, foto: { conteudo: Buffer; tipo: string } | null, em: Date): Promise<void>;
  /** Última mensagem de cada conversa (prévia da lista), numa consulta só. */
  ultimasMensagens(): Promise<Map<string, Mensagem>>;

  /** Marca ids de mensagens que a própria Sintonia enviou, para não confundi-las com a atendente. */
  registrarEnviadoPorNos(idExterno: string): Promise<void>;
  foiEnviadoPorNos(idExterno: string): Promise<boolean>;

  programar(t: Omit<Tarefa, 'id' | 'feita'>): Promise<void>;
  cancelarTarefas(conversaId: string, tipos?: Tarefa['tipo'][]): Promise<void>;
  /**
   * Pega as tarefas vencidas e já as marca como feitas, numa operação só.
   * Com vários trabalhadores, cada tarefa sai para um único deles (nunca dois lembretes iguais).
   */
  reivindicarTarefas(agora: Date, limite?: number): Promise<Tarefa[]>;
  /** Tarefas ainda por fazer de uma conversa (painel e testes). */
  tarefasPendentes(conversaId: string): Promise<Tarefa[]>;

  registrarEvento(e: Evento): Promise<void>;
  eventosEntre(inicio: Date, fim: Date): Promise<Evento[]>;

  guardarSugestao(conversaId: string, texto: string): Promise<void>;
  sugestao(conversaId: string): Promise<string | undefined>;

  /** Registra o sinal de "digitando" de alguém da equipe. */
  registrarDigitando(conversaId: string, quem: { usuarioId: string; nome: string }, em: Date): Promise<void>;
  /** Quem deu sinal de digitação a partir de `desde`, de quem começou primeiro para quem começou depois. */
  digitando(conversaId: string, desde: Date): Promise<Digitando[]>;
  pararDigitando(conversaId: string, usuarioId: string): Promise<void>;
}

/** Implementação em memória: usada nos testes e para rodar local sem banco. */
export class RepositorioMemoria implements Repositorio {
  private conversas = new Map<string, Conversa>();
  private msgs: Mensagem[] = [];
  private enviados = new Set<string>();
  private tarefas: Tarefa[] = [];
  private eventos: Evento[] = [];
  private sugestoes = new Map<string, string>();

  async buscarConversa(id: string) {
    const c = this.conversas.get(id);
    return c ? { ...c } : undefined;
  }

  async buscarOuCriarConversa(d: {
    empresaId: string;
    unidade: UnidadeId;
    canalId: string;
    telefone: string;
    nome?: string;
    agora: Date;
  }) {
    for (const c of this.conversas.values()) {
      if (c.empresaId === d.empresaId && c.unidade === d.unidade && c.telefone === d.telefone) {
        if (d.nome && !c.nome) c.nome = d.nome;
        return { conversa: { ...c }, nova: false };
      }
    }
    const c: Conversa = {
      id: randomUUID(),
      empresaId: d.empresaId,
      unidade: d.unidade,
      canalId: d.canalId,
      telefone: d.telefone,
      nome: d.nome,
      modo: 'copiloto',
      etapa: 'novo_lead',
      etiquetas: [],
      criadaEm: d.agora,
      atualizadaEm: d.agora,
    };
    this.conversas.set(c.id, c);
    return { conversa: { ...c }, nova: true };
  }

  async salvarConversa(c: Conversa) {
    this.conversas.set(c.id, { ...c });
  }

  async listarConversas() {
    return [...this.conversas.values()].map((c) => ({ ...c }));
  }

  async adicionarMensagem(m: Omit<Mensagem, 'id'> & { id?: string }) {
    if (m.idExterno && this.msgs.some((x) => x.idExterno === m.idExterno)) return false;
    const { anexo, ...resto } = m;
    const id = m.id ?? randomUUID();
    this.msgs.push({ ...resto, id });
    if (anexo) this.midias.set(id, { conversaId: m.conversaId, anexo: { ...anexo }, conteudo: null, tentativas: 0, proxima: 0 });
    return true;
  }

  /** A mensagem com os dados atuais da mídia (a situação muda depois do download). */
  private comAnexo(m: Mensagem): Mensagem {
    const md = this.midias.get(m.id);
    return md ? { ...m, anexo: { ...md.anexo } } : { ...m };
  }

  async mensagens(conversaId: string, limite = 40) {
    return this.msgs
      .filter((m) => m.conversaId === conversaId)
      .slice(-limite)
      .map((m) => this.comAnexo(m));
  }

  private midias = new Map<string, { conversaId: string; anexo: Anexo; conteudo: Buffer | null; tentativas: number; proxima: number; erro?: string }>();

  async midia(mensagemId: string) {
    const md = this.midias.get(mensagemId);
    return md ? { conversaId: md.conversaId, anexo: { ...md.anexo }, conteudo: md.conteudo } : undefined;
  }

  async guardarMidia(mensagemId: string, r: { conteudo: Buffer; mimetype?: string; nomeArquivo?: string }) {
    const md = this.midias.get(mensagemId);
    if (!md) return;
    md.conteudo = r.conteudo;
    md.erro = undefined;
    md.anexo = {
      ...md.anexo,
      situacao: 'pronta',
      tamanho: r.conteudo.length,
      mimetype: md.anexo.mimetype ?? r.mimetype,
      nomeArquivo: md.anexo.nomeArquivo ?? r.nomeArquivo,
    };
  }

  async midiaGrande(mensagemId: string, tamanho?: number) {
    const md = this.midias.get(mensagemId);
    if (md) md.anexo = { ...md.anexo, situacao: 'grande', tamanho: tamanho ?? md.anexo.tamanho };
  }

  async falhaMidia(mensagemId: string, erro: string, proxima?: Date) {
    const md = this.midias.get(mensagemId);
    if (!md) return;
    md.erro = erro;
    if (proxima) md.proxima = proxima.getTime();
    else md.anexo = { ...md.anexo, situacao: 'falhou' };
  }

  async reivindicarMidias(agora: Date, limite = 10, reservaMs = 5 * 60_000) {
    const t = agora.getTime();
    const saida: MidiaPendente[] = [];
    for (const [mensagemId, md] of this.midias) {
      if (saida.length >= limite) break;
      if (md.anexo.situacao !== 'pendente' || md.proxima > t) continue;
      const m = this.msgs.find((x) => x.id === mensagemId);
      const c = this.conversas.get(md.conversaId);
      if (!m?.idExterno || !c) continue;
      md.tentativas++;
      md.proxima = t + reservaMs;
      saida.push({ mensagemId, conversaId: md.conversaId, canalId: c.canalId, idExterno: m.idExterno, tentativas: md.tentativas });
    }
    return saida;
  }

  async rebaixarMidia(mensagemId: string, agora: Date) {
    const md = this.midias.get(mensagemId);
    if (!md || md.anexo.situacao !== 'falhou') return false;
    Object.assign(md, { tentativas: 0, proxima: agora.getTime(), erro: undefined });
    md.anexo = { ...md.anexo, situacao: 'pendente' };
    return true;
  }

  private fotos = new Map<string, { conteudo: Buffer | null; tipo: string | null; atualizadaEm: Date }>();
  async foto(telefone: string) {
    return this.fotos.get(telefone);
  }
  async salvarFoto(telefone: string, foto: { conteudo: Buffer; tipo: string } | null, em: Date) {
    this.fotos.set(telefone, { conteudo: foto?.conteudo ?? null, tipo: foto?.tipo ?? null, atualizadaEm: em });
  }

  async ultimasMensagens() {
    const r = new Map<string, Mensagem>();
    for (const m of this.msgs) {
      const atual = r.get(m.conversaId);
      if (!atual || atual.em.getTime() <= m.em.getTime()) r.set(m.conversaId, m);
    }
    for (const [k, m] of r) r.set(k, this.comAnexo(m));
    return r;
  }

  async registrarEnviadoPorNos(id: string) {
    if (id) this.enviados.add(id);
  }

  async foiEnviadoPorNos(id: string) {
    return this.enviados.has(id);
  }

  async programar(t: Omit<Tarefa, 'id' | 'feita'>) {
    this.tarefas.push({ ...t, id: randomUUID(), feita: false });
  }

  async cancelarTarefas(conversaId: string, tipos?: Tarefa['tipo'][]) {
    for (const t of this.tarefas) {
      if (t.conversaId === conversaId && !t.feita && (!tipos || tipos.includes(t.tipo))) t.feita = true;
    }
  }

  async reivindicarTarefas(agora: Date, limite = 100) {
    const vencidas = this.tarefas
      .filter((t) => !t.feita && t.quando.getTime() <= agora.getTime())
      .sort((a, b) => a.quando.getTime() - b.quando.getTime())
      .slice(0, limite);
    for (const t of vencidas) t.feita = true;
    return vencidas.map((t) => ({ ...t }));
  }

  /** Só para testes e para o painel: tarefas pendentes de uma conversa. */
  async tarefasPendentes(conversaId: string) {
    return this.tarefas
      .filter((t) => t.conversaId === conversaId && !t.feita)
      .sort((a, b) => a.quando.getTime() - b.quando.getTime())
      .map((t) => ({ ...t }));
  }

  async registrarEvento(e: Evento) {
    this.eventos.push(e);
  }

  async eventosEntre(inicio: Date, fim: Date) {
    return this.eventos.filter((e) => e.em >= inicio && e.em < fim);
  }

  async guardarSugestao(conversaId: string, texto: string) {
    this.sugestoes.set(conversaId, texto);
  }

  async sugestao(conversaId: string) {
    return this.sugestoes.get(conversaId);
  }

  private digitandoAgora = new Map<string, Map<string, Digitando>>();
  async registrarDigitando(conversaId: string, quem: { usuarioId: string; nome: string }, em: Date) {
    const m = this.digitandoAgora.get(conversaId) ?? new Map<string, Digitando>();
    const antes = m.get(quem.usuarioId);
    const continua = antes && em.getTime() - antes.em.getTime() <= VALIDADE_DIGITANDO_MS;
    m.set(quem.usuarioId, { usuarioId: quem.usuarioId, nome: quem.nome, desde: continua ? antes.desde : em, em });
    this.digitandoAgora.set(conversaId, m);
  }
  async digitando(conversaId: string, desde: Date) {
    return [...(this.digitandoAgora.get(conversaId)?.values() ?? [])]
      .filter((d) => d.em.getTime() >= desde.getTime())
      .sort((a, b) => a.desde.getTime() - b.desde.getTime())
      .map((d) => ({ ...d }));
  }
  async pararDigitando(conversaId: string, usuarioId: string) {
    this.digitandoAgora.get(conversaId)?.delete(usuarioId);
  }
}

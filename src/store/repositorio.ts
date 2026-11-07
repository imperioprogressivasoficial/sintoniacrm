import { randomUUID } from 'node:crypto';
import type { Conversa, Mensagem, UnidadeId } from '../domain.js';
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
  | 'falha';

export interface Evento {
  tipo: TipoEvento;
  conversaId?: string;
  unidade?: UnidadeId;
  em: Date;
  dados?: Record<string, unknown>;
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

  /** Retorna false se a mensagem (pelo idExterno) já foi registrada. */
  adicionarMensagem(m: Omit<Mensagem, 'id'>): Promise<boolean>;
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

  async adicionarMensagem(m: Omit<Mensagem, 'id'>) {
    if (m.idExterno && this.msgs.some((x) => x.idExterno === m.idExterno)) return false;
    this.msgs.push({ ...m, id: randomUUID() });
    return true;
  }

  async mensagens(conversaId: string, limite = 40) {
    return this.msgs.filter((m) => m.conversaId === conversaId).slice(-limite);
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
}

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Conversa } from '../domain.js';
import type { ArmazemCadastro } from '../empresa/cadastro.js';
import type { ProdutosLead } from '../empresa/lead-produtos.js';
import { ehEtapaDePerda, type Funis } from '../funis/funis.js';
import type { Perdas } from '../perdas/perdas.js';
import { nomeOuTelefone } from '../contatos/nome.js';

/**
 * ia-completa: o que a IA de atendimento enxerga e mexe no CRM, além da agenda.
 * - leitura (na hora em que a IA pensa): pipelines e etapas, onde a cliente está, motivos de perda, produtos e preços
 *   do cadastro (Empresa › Produtos e serviços), arquivos que podem ir para a cliente;
 * - escrita (depois, sob a trava da conversa, pela Sintonia): mover em qualquer pipeline (com motivo de perda),
 *   vincular produto ao lead, criar tarefa para a equipe (Agenda › Rotina) e pegar o arquivo para enviar.
 * Tudo da empresa da conversa; nada é criado (funil, etapa, produto) pela IA.
 */

export interface EtapaIa {
  id: string;
  nome: string;
  /** Etapa de perda (pede motivo). */
  perda: boolean;
  /** Chave da etapa fixa (só no funil do sistema): novo_lead, agendada... */
  chave: string | null;
}
export interface FunilIa {
  id: string;
  nome: string;
  sistema: boolean;
  etapas: EtapaIa[];
}
export interface ProdutoIa {
  id: string;
  nome: string;
  tipo: 'produto' | 'servico';
  categoria: string | null;
  /** null = sob consulta. */
  preco: number | null;
  duracaoMin: number | null;
  descricao: string;
  temFoto: boolean;
}
export interface DocumentoIa {
  id: string;
  nome: string;
  categoria: string;
  descricao: string;
}
export interface MotivoPerdaIa {
  id: string;
  nome: string;
  pedeTexto: boolean;
}
export interface ArquivoIa {
  conteudo: Buffer;
  mimetype: string;
  nomeArquivo?: string;
  tipo: 'imagem' | 'documento';
}

/** Leitura: usada pelas ferramentas enquanto a IA pensa. */
export interface ServicosCrmIa {
  funis(): Promise<FunilIa[]>;
  /** Etapa atual da conversa em cada funil em que ela está. */
  ondeEsta(c: Conversa): Promise<Array<{ funilId: string; etapaId: string }>>;
  motivosPerda(): Promise<MotivoPerdaIa[]>;
  produtos(): Promise<ProdutoIa[]>;
  documentos(): Promise<DocumentoIa[]>;
}

/** Escrita: aplicada pela Sintonia, sob a trava da conversa, depois que a IA terminou. */
export interface AplicadorCrmIa {
  moverFunil(c: Conversa, a: Extract<AcaoCrm, { tipo: 'mover_funil' }>): Promise<boolean>;
  vincularProduto(c: Conversa, produtoId: string, quantidade: number): Promise<void>;
  criarTarefa(c: Conversa, t: { titulo: string; descricao: string; venceEm: Date | null; prioridade: 'baixa' | 'normal' | 'alta' }): Promise<{ responsavel: string }>;
  arquivo(c: Conversa, origem: 'foto_produto' | 'documento', id: string): Promise<ArquivoIa | undefined>;
}

export type CrmIa = ServicosCrmIa & AplicadorCrmIa;

/** Ações de CRM que as ferramentas pedem (a Sintonia aplica). */
export type AcaoCrm =
  | { tipo: 'mover_funil'; funilId: string; funil: string; etapaId: string; etapa: string; motivo: string; perda: { motivo: string; detalhe: string | null } | null }
  | { tipo: 'vincular_produto'; produtoId: string; nome: string; quantidade: number }
  | { tipo: 'tarefa_equipe'; titulo: string; descricao: string; venceEm: Date | null; prioridade: 'baixa' | 'normal' | 'alta' }
  | { tipo: 'retorno'; quando: Date; motivo: string }
  | { tipo: 'enviar_arquivo'; origem: 'foto_produto' | 'documento'; id: string; nome: string; legenda: string | null };

// ---------------------------------------------------------------- tarefas da equipe

export interface ArmazemTarefasIa {
  criar(t: { empresaId: string; titulo: string; descricao: string; venceEm: Date | null; responsavelId: string; conversaId: string; clienteNome: string; prioridade: string }): Promise<void>;
}

export class ArmazemTarefasIaMemoria implements ArmazemTarefasIa {
  readonly criadas: Array<Parameters<ArmazemTarefasIa['criar']>[0]> = [];
  async criar(t: Parameters<ArmazemTarefasIa['criar']>[0]) {
    this.criadas.push(t);
  }
}

/** Grava em Agenda › Rotina (tabela da migração 340). */
export class ArmazemTarefasIaPostgres implements ArmazemTarefasIa {
  constructor(private readonly pool: pg.Pool) {}
  async criar(t: Parameters<ArmazemTarefasIa['criar']>[0]) {
    await this.pool.query(
      `insert into sintonia.rotina_tarefas (id, empresa_id, titulo, descricao, vence_em, responsavel_id, criado_por, conversa_id, cliente_nome, prioridade)
       values ($1,$2,$3,$4,$5,$6,'IA',$7,$8,$9)`,
      [randomUUID(), t.empresaId, t.titulo, t.descricao, t.venceEm, t.responsavelId, t.conversaId, t.clienteNome, t.prioridade],
    );
  }
}

// ---------------------------------------------------------------- montagem

export interface OpcoesCrmIa {
  empresaId: string;
  funis: Funis;
  perdas?: Perdas;
  cadastro: ArmazemCadastro;
  produtosLead?: ProdutosLead;
  tarefas: ArmazemTarefasIa;
  /** Quem recebe a tarefa quando a conversa não tem dona: a primeira pessoa da gestão ativa. */
  responsavelPadrao: () => Promise<{ id: string; nome: string } | undefined>;
}

/** Categorias de documento que podem ir para a cliente (contrato e manual interno não). */
const DOCS_PARA_CLIENTE = new Set(['catalogo', 'tabela', 'apresentacao']);

export function montarCrmIa(o: OpcoesCrmIa): CrmIa {
  return {
    async funis() {
      const lista = await o.funis.listar();
      return Promise.all(
        lista.map(async (f) => ({
          id: f.id,
          nome: f.nome,
          sistema: f.sistema,
          etapas: (await o.funis.etapas(f.id)).map((e) => ({ id: e.id, nome: e.nome, perda: ehEtapaDePerda(f, e), chave: e.chaveSistema ?? null })),
        })),
      );
    },
    async ondeEsta(c) {
      return (await o.funis.daConversa(c)).filter((x) => x.etapa).map((x) => ({ funilId: x.funilId, etapaId: x.etapa!.id }));
    },
    async motivosPerda() {
      if (!o.perdas) return [];
      return (await o.perdas.motivos()).map((m) => ({ id: m.id, nome: m.nome, pedeTexto: m.pedeTexto }));
    },
    async produtos() {
      return (await o.cadastro.produtos(o.empresaId))
        .filter((p) => p.ativo)
        .map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, categoria: p.categoria, preco: p.preco, duracaoMin: p.duracaoMin, descricao: p.descricao, temFoto: Boolean(p.fotoEm) }));
    },
    async documentos() {
      return (await o.cadastro.documentos(o.empresaId))
        .filter((d) => d.visivel === 'equipe' && DOCS_PARA_CLIENTE.has(d.categoria))
        .map((d) => ({ id: d.id, nome: d.nome, categoria: d.categoria, descricao: d.descricao }));
    },
    async moverFunil(c, a) {
      // O motivo da perda vai antes (a tela faz igual): o registro de perdas lê no aviso do movimento.
      let limpar = () => {};
      if (a.perda && o.perdas) limpar = await o.perdas.antesDeMover(c, a.funilId, a.etapaId, { motivo: a.perda.motivo, ...(a.perda.detalhe ? { detalhe: a.perda.detalhe } : {}) });
      try {
        return (await o.funis.moverSobTrava(c, a.funilId, a.etapaId, { nome: 'IA', id: null }, true)).mudou;
      } finally {
        limpar();
      }
    },
    async vincularProduto(c, produtoId, quantidade) {
      if (!o.produtosLead) throw new Error('Produtos do lead indisponíveis.');
      await o.produtosLead.adicionar(c, { produtoId, quantidade }, 'IA');
    },
    async criarTarefa(c, t) {
      let resp: { id: string; nome: string } | undefined = c.responsavelId ? { id: c.responsavelId, nome: c.responsavelNome ?? 'dona da conversa' } : undefined;
      resp ??= await o.responsavelPadrao();
      if (!resp) throw new Error('Ninguém da equipe para receber a tarefa.');
      await o.tarefas.criar({ empresaId: c.empresaId, titulo: t.titulo, descricao: t.descricao, venceEm: t.venceEm, responsavelId: resp.id, conversaId: c.id, clienteNome: nomeOuTelefone(c.nome, c.telefone), prioridade: t.prioridade });
      return { responsavel: resp.nome };
    },
    async arquivo(_c, origem, id) {
      if (origem === 'foto_produto') {
        const f = await o.cadastro.fotoProduto(o.empresaId, id);
        const p = await o.cadastro.produto(o.empresaId, id);
        return f && p?.ativo ? { conteudo: f.conteudo, mimetype: f.tipo, tipo: 'imagem' } : undefined;
      }
      const d = await o.cadastro.arquivoDocumento(o.empresaId, id);
      if (!d || d.doc.visivel !== 'equipe' || !DOCS_PARA_CLIENTE.has(d.doc.categoria)) return undefined;
      const imagem = /^image\//.test(d.tipo);
      return { conteudo: d.conteudo, mimetype: d.tipo, tipo: imagem ? 'imagem' : 'documento', nomeArquivo: d.doc.nome };
    },
  };
}

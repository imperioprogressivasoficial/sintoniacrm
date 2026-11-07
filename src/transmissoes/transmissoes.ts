import { ehCanalSocial } from '../channels/meta-social.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { NumeroConectado } from '../app/sintonia.js';
import type { CanalMeta } from '../channels/meta.js';
import { ehCanalTeste } from '../channels/teste.js';
import type { EnvioResultado, StatusRecebido } from '../channels/tipos.js';
import type { ArmazemContatos } from '../contatos/contatos.js';
import type { Conversa, ModoAtendimento } from '../domain.js';
import type { MovimentoEtapa } from '../funis/funis.js';
import type { Leads, RelatorioImportacao } from '../leads/leads.js';
import { textoDoAnexo } from '../midia.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Tag, Tags } from '../tags/tags.js';
import { UNIDADES } from '../unidades.js';
import { dataISO, DIA, MIN, partesBahia } from '../util/tempo.js';
import { ClienteModelosMeta, componentesDoModelo, ModeloNovo, statusLocal } from './meta-modelos.js';
import { contarVariaveis, dentroDaJanela, ehDescadastro, esperaDepois, montarTexto, parametrosDoModelo, preencherModelo, sorteador, type DadosPessoa } from './texto.js';
import {
  CampanhaAlteracao,
  CampanhaNova,
  Envio,
  LIMITES,
  Mensagem,
  Publico,
  STATUS_DESTINO,
  type CanalTransmissao,
  type GatilhoTransmissao,
  type StatusCampanha,
  type StatusDestino,
  type UnidadeTransmissao,
} from './tipos.js';

/**
 * Transmissões (disparo em massa de WhatsApp).
 *
 * - Campanha: unidade (número de envio), canal (oficial com modelo aprovado ou não oficial com texto livre),
 *   público, mensagem, agenda e ritmo. Status: rascunho → aguardando_modelo → agendada → enviando ⇄ pausada → concluída.
 * - Destinatários: uma linha por pessoa por campanha (único no banco: nunca duas vezes). Funil de cada um:
 *   fila → enviando → enviada → entregue → lida → respondeu; ou falhou / descadastrou / pulada.
 * - Fila persistente no Postgres com reserva "skip locked" e ritmo por número (tabela transmissao_ritmo):
 *   sobrevive a reinício. Se o processo cair NO MEIO de um envio, aquela pessoa vira "falhou" (incerto) e não é
 *   reenviada: preferimos não mandar a mandar duas vezes.
 * - Respostas: entram como conversas normais (a mensagem já está na conversa) e ganham a tag da campanha.
 *   "SAIR"/"PARAR" marca descadastro: a pessoa nunca mais entra em transmissão.
 */

export interface SintoniaParaTransmissoes {
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined>;
  enviarTransmissao(c: Conversa, texto: string, envio: (n: NumeroConectado) => Promise<EnvioResultado>, autorNome: string, modelo: boolean): Promise<string>;
}

export interface ContaMetaUnidade {
  token: string;
  wabaId?: string;
  phoneNumberId: string;
}

export interface OpcoesTransmissoes {
  pool: pg.Pool;
  empresaId: string;
  repo: Repositorio;
  sintonia: () => SintoniaParaTransmissoes;
  /** Números em vigor (reais e de teste). */
  numeros: () => NumeroConectado[];
  tags: Tags;
  contatos: ArmazemContatos;
  leads?: Leads;
  /** API oficial da unidade (para os modelos). */
  contaMeta?: (unidade: string) => ContaMetaUnidade | undefined;
  fetchMeta?: typeof fetch;
  /** Modo em que nasce a conversa criada por uma transmissão. */
  modoInicial?: () => Promise<ModoAtendimento>;
  agora?: () => Date;
  aleatorio?: () => number;
  log?: (msg: string, extra?: unknown) => void;
}

export interface Contagem {
  total: number;
  porStatus: Record<StatusDestino, number>;
  /** Funil acumulado: quem chegou pelo menos até ali. */
  funil: { fila: number; enviadas: number; entregues: number; lidas: number; responderam: number; falharam: number; descadastraram: number; puladas: number };
}

export interface Campanha {
  id: string;
  nome: string;
  unidade: UnidadeTransmissao;
  canal: CanalTransmissao;
  status: StatusCampanha;
  modo: 'manual' | 'automatico';
  publico: Publico;
  mensagem: Mensagem;
  envio: Envio;
  agendadaPara: Date | null;
  canalId: string | null;
  tagId: string | null;
  temImagem: boolean;
  imagemTipo: string | null;
  erro: string | null;
  criadaPor: string | null;
  criadaEm: Date;
  atualizadaEm: Date;
  iniciadaEm: Date | null;
  concluidaEm: Date | null;
}

export interface PreviaPublico {
  /** Passaram nos filtros (tags/etapas/unidade). */
  encontrados: number;
  /** Depois das exclusões. */
  disponiveis: number;
  /** Quantos vão receber (respeitando a quantidade). */
  selecionados: number;
  excluidos: { descadastrados: number; receberamRecente: number; conversando: number; semCelular: number };
  amostra: Array<{ nome: string | null; telefone: string }>;
}

export class ErroTransmissao extends Error {
  constructor(
    mensagem: string,
    readonly statusCode = 400,
  ) {
    super(mensagem);
  }
}

const STATUS_VAZIO = () => Object.fromEntries(STATUS_DESTINO.map((s) => [s, 0])) as Record<StatusDestino, number>;
const CELULAR = '^55[0-9]{2}9[0-9]{8}$';
/** Envio "enviando" há mais que isso: o processo caiu no meio. */
const TRAVADO_MS = 2 * MIN;

type Linha = Record<string, unknown>;

function campanhaDaLinha(r: Linha): Campanha {
  return {
    id: String(r.id),
    nome: String(r.nome),
    unidade: r.unidade as UnidadeTransmissao,
    canal: r.canal as CanalTransmissao,
    status: r.status as StatusCampanha,
    modo: r.modo as 'manual' | 'automatico',
    publico: Publico.parse(r.publico ?? {}),
    mensagem: Mensagem.parse(r.mensagem ?? {}),
    envio: Envio.parse(r.envio ?? {}),
    agendadaPara: (r.agendada_para as Date | null) ?? null,
    canalId: (r.canal_id as string | null) ?? null,
    tagId: (r.tag_id as string | null) ?? null,
    temImagem: Boolean(r.tem_imagem),
    imagemTipo: (r.imagem_tipo as string | null) ?? null,
    erro: (r.erro as string | null) ?? null,
    criadaPor: (r.criada_por as string | null) ?? null,
    criadaEm: r.criada_em as Date,
    atualizadaEm: r.atualizada_em as Date,
    iniciadaEm: (r.iniciada_em as Date | null) ?? null,
    concluidaEm: (r.concluida_em as Date | null) ?? null,
  };
}

const COLUNAS = `id, nome, unidade, canal, status, modo, publico, mensagem, envio, agendada_para, canal_id, tag_id,
  imagem is not null as tem_imagem, imagem_tipo, erro, criada_por, criada_em, atualizada_em, iniciada_em, concluida_em`;

export class Transmissoes {
  readonly empresaId: string;
  private readonly agora: () => Date;
  private readonly aleatorio: () => number;
  private readonly log: (msg: string, extra?: unknown) => void;
  private ultimoDiario = 0;
  private ultimaSincronia = 0;
  private rodando = false;
  private readonly falhasSeguidas = new Map<string, number>();

  constructor(private readonly o: OpcoesTransmissoes) {
    this.empresaId = o.empresaId;
    this.agora = o.agora ?? (() => new Date());
    this.aleatorio = o.aleatorio ?? Math.random;
    this.log = o.log ?? (() => {});
  }

  private get pool() {
    return this.o.pool;
  }

  // ------------------------------------------------------------------ números

  /** Número de envio da unidade: o real (se houver), senão o de teste. */
  numeroDaUnidade(unidade: string): NumeroConectado | undefined {
    const lista = this.o.numeros();
    // Transmissão é só por WhatsApp: Messenger/Instagram/TikTok não aceitam envio em massa fora da janela.
    const whats = lista.filter((n) => !ehCanalSocial(n.canalId));
    return whats.find((n) => n.unidade === unidade && !ehCanalTeste(n.canalId)) ?? whats.find((n) => n.unidade === unidade);
  }

  /** Para a tela: por qual número e API cada unidade envia, e os limites recomendados. */
  numeros() {
    return (['norte', 'sumare'] as const).map((u) => {
      const n = this.numeroDaUnidade(u);
      const tipo = n ? (ehCanalTeste(n.canalId) ? 'teste' : n.canal.tipo) : null;
      return {
        unidade: u,
        nome: UNIDADES[u].nome,
        canalId: n?.canalId ?? null,
        tipo,
        oficial: tipo === 'meta' || tipo === 'teste',
        naoOficial: tipo === 'evolution' || tipo === 'teste',
      };
    });
  }

  limites() {
    return LIMITES;
  }

  // ------------------------------------------------------------------ cadastro

  async listar(unidades?: string[]): Promise<Array<Campanha & { contagem: Contagem }>> {
    const { rows } = await this.pool.query(
      `select ${COLUNAS} from sintonia.transmissoes where empresa_id = $1 and ($2::text[] is null or unidade = any($2)) order by criada_em desc limit 300`,
      [this.empresaId, unidades ?? null],
    );
    const lista = rows.map(campanhaDaLinha);
    const contagens = await this.contagens(lista.map((c) => c.id));
    return lista.map((c) => ({ ...c, contagem: contagens.get(c.id) ?? contagemDe(new Map()) }));
  }

  async obter(id: string): Promise<Campanha | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await this.pool.query(`select ${COLUNAS} from sintonia.transmissoes where id = $1 and empresa_id = $2`, [id, this.empresaId]);
    return rows[0] ? campanhaDaLinha(rows[0]) : undefined;
  }

  async exigir(id: string): Promise<Campanha> {
    const c = await this.obter(id);
    if (!c) throw new ErroTransmissao('Transmissão não encontrada.', 404);
    return c;
  }

  async criar(bruto: unknown, por: string): Promise<Campanha> {
    const d = CampanhaNova.parse(bruto);
    const id = randomUUID();
    const agora = this.agora();
    await this.pool.query(
      `insert into sintonia.transmissoes (id, empresa_id, nome, unidade, canal, modo, publico, mensagem, envio, criada_por, criada_em, atualizada_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [id, this.empresaId, d.nome, d.unidade, d.canal, d.modo, d.publico, d.mensagem, padroesDoCanal(d.canal, d.envio, bruto), por, agora],
    );
    return this.exigir(id);
  }

  async alterar(id: string, bruto: unknown): Promise<Campanha> {
    const atual = await this.exigir(id);
    if (['enviando', 'concluida', 'cancelada'].includes(atual.status)) throw new ErroTransmissao('Pause a transmissão antes de mudar (ou duplique a que já terminou).', 409);
    const d = CampanhaAlteracao.parse(bruto);
    const canal = d.canal ?? atual.canal;
    const envio = d.envio ? padroesDoCanal(canal, d.envio, bruto) : atual.envio;
    await this.pool.query(
      `update sintonia.transmissoes set nome = $2, unidade = $3, canal = $4, modo = $5, publico = $6, mensagem = $7, envio = $8, atualizada_em = $9, erro = null
        where id = $1`,
      [id, d.nome ?? atual.nome, d.unidade ?? atual.unidade, canal, d.modo ?? atual.modo, d.publico ?? atual.publico, d.mensagem ?? atual.mensagem, envio, this.agora()],
    );
    return this.exigir(id);
  }

  async duplicar(id: string, por: string): Promise<Campanha> {
    const a = await this.exigir(id);
    const c = await this.criar({ nome: `${a.nome} (cópia)`.slice(0, 80), unidade: a.unidade, canal: a.canal, modo: a.modo, publico: a.publico, mensagem: a.mensagem, envio: a.envio }, por);
    await this.pool.query(
      'update sintonia.transmissoes set imagem = o.imagem, imagem_tipo = o.imagem_tipo from sintonia.transmissoes o where o.id = $2 and sintonia.transmissoes.id = $1',
      [c.id, a.id],
    );
    return this.exigir(c.id);
  }

  async apagar(id: string): Promise<void> {
    const c = await this.exigir(id);
    if (!['rascunho', 'concluida', 'cancelada', 'aguardando_modelo'].includes(c.status)) throw new ErroTransmissao('Cancele a transmissão antes de apagar.', 409);
    await this.pool.query('delete from sintonia.transmissoes where id = $1', [id]);
  }

  async definirImagem(id: string, img: { conteudo: Buffer; mimetype: string } | null): Promise<Campanha> {
    const c = await this.exigir(id);
    if (['enviando', 'concluida', 'cancelada'].includes(c.status)) throw new ErroTransmissao('Pause a transmissão antes de trocar a imagem.', 409);
    if (img && !/^image\/(jpeg|png|webp)$/.test(img.mimetype)) throw new ErroTransmissao('Use uma imagem JPG ou PNG.');
    if (img && img.conteudo.length > 5 * 1024 * 1024) throw new ErroTransmissao('A imagem pode ter até 5 MB.');
    await this.pool.query('update sintonia.transmissoes set imagem = $2, imagem_tipo = $3, imagem_meta = null, atualizada_em = $4 where id = $1', [
      id,
      img?.conteudo ?? null,
      img?.mimetype ?? null,
      this.agora(),
    ]);
    return this.exigir(id);
  }

  async imagem(id: string): Promise<{ conteudo: Buffer; tipo: string } | undefined> {
    const { rows } = await this.pool.query<{ imagem: Buffer | null; imagem_tipo: string | null }>(
      'select imagem, imagem_tipo from sintonia.transmissoes where id = $1 and empresa_id = $2',
      [id, this.empresaId],
    );
    const r = rows[0];
    return r?.imagem ? { conteudo: r.imagem, tipo: r.imagem_tipo ?? 'image/jpeg' } : undefined;
  }

  // ------------------------------------------------------------------ público

  /** Consulta do público com as exclusões marcadas (sem a quantidade). */
  private async publicoBruto(unidade: string, p: Publico, excetoCampanha: string | null) {
    const agora = this.agora();
    const { rows } = await this.pool.query<{
      conversa_id: string;
      telefone: string;
      nome: string | null;
      recente: Date;
      optout: boolean;
      recebeu: boolean;
      conversando: boolean;
      sem_celular: boolean;
    }>(
      `select c.id as conversa_id, c.telefone, coalesce(nullif(ct.nome, ''), c.nome) as nome,
              greatest(c.atualizada_em, c.ultima_mensagem_cliente, c.ultima_mensagem_equipe) as recente,
              exists (select 1 from sintonia.transmissao_optout o where o.empresa_id = c.empresa_id and o.telefone = c.telefone) as optout,
              ($6::int > 0 and exists (
                 select 1 from sintonia.transmissao_destinos d join sintonia.transmissoes t on t.id = d.transmissao_id
                  where t.empresa_id = c.empresa_id and d.telefone = c.telefone and d.enviada_em > $9::timestamptz - make_interval(days => $6::int)
                    and ($8::uuid is null or d.transmissao_id <> $8::uuid))) as recebeu,
              ($7::boolean and greatest(c.ultima_mensagem_cliente, c.ultima_mensagem_equipe) > $9::timestamptz - interval '24 hours') as conversando,
              c.telefone !~ '${CELULAR}' as sem_celular
         from sintonia.conversas c
         left join sintonia.contatos ct on ct.empresa_id = c.empresa_id and ct.telefone = c.telefone
        where c.empresa_id = $1 and c.unidade = $2
          and (cardinality($3::text[]) = 0 or (
                case when $10::boolean
                  then (select count(distinct x.tag_id) from sintonia.conversa_tags x where x.conversa_id = c.id and x.tag_id::text = any($3::text[])) = cardinality($3::text[])
                  else exists (select 1 from sintonia.conversa_tags x where x.conversa_id = c.id and x.tag_id::text = any($3::text[])) end))
          and not exists (select 1 from sintonia.conversa_tags x where x.conversa_id = c.id and x.tag_id::text = any($4::text[]))
          and (cardinality($5::text[]) = 0 or c.etapa = any($5::text[]))`,
      [this.empresaId, unidade, p.tags, p.semTags, p.etapas, p.excluirRecebeuDias, p.excluirConversaAberta, excetoCampanha, agora, p.tagsTodas],
    );
    return rows;
  }

  /** Quem passa e quem fica de fora, e os escolhidos (quantidade: sorteio ou mais recentes primeiro). */
  async selecionar(unidade: string, bruto: unknown, excetoCampanha: string | null = null) {
    const p = Publico.parse(bruto ?? {});
    const linhas = await this.publicoBruto(unidade, p, excetoCampanha);
    const excluidos = { descadastrados: 0, receberamRecente: 0, conversando: 0, semCelular: 0 };
    const aptos = linhas.filter((l) => {
      if (l.sem_celular) excluidos.semCelular++;
      else if (l.optout) excluidos.descadastrados++;
      else if (l.recebeu) excluidos.receberamRecente++;
      else if (l.conversando) excluidos.conversando++;
      else return true;
      return false;
    });
    let escolhidos = aptos;
    if (p.ordem === 'aleatorio') {
      escolhidos = [...aptos];
      for (let i = escolhidos.length - 1; i > 0; i--) {
        const j = Math.floor(this.aleatorio() * (i + 1));
        [escolhidos[i], escolhidos[j]] = [escolhidos[j]!, escolhidos[i]!];
      }
    } else escolhidos = [...aptos].sort((a, b) => (b.recente?.getTime() ?? 0) - (a.recente?.getTime() ?? 0));
    if (p.quantidade) escolhidos = escolhidos.slice(0, p.quantidade);
    return { encontrados: linhas.length, disponiveis: aptos.length, excluidos, escolhidos };
  }

  async previaPublico(unidade: string, bruto: unknown, excetoCampanha: string | null = null): Promise<PreviaPublico> {
    const s = await this.selecionar(unidade, bruto, excetoCampanha);
    return {
      encontrados: s.encontrados,
      disponiveis: s.disponiveis,
      selecionados: s.escolhidos.length,
      excluidos: s.excluidos,
      amostra: s.escolhidos.slice(0, 6).map((l) => ({ nome: l.nome, telefone: l.telefone })),
    };
  }

  /**
   * Sobe uma lista (planilha/CSV já lida pela tela) para os contatos, com normalização e deduplicação
   * (a mesma importação de Leads), marcando a tag escolhida ou uma nova (ex.: "Lista Black Friday").
   */
  async importar(p: { linhas: unknown[]; unidade: UnidadeTransmissao; tagId?: string; tagNova?: string; dddPadrao?: string; simular?: boolean }, por: string): Promise<{ relatorio: RelatorioImportacao; tag: Pick<Tag, 'id' | 'nome' | 'cor'> | null }> {
    if (!this.o.leads) throw new ErroTransmissao('A importação de contatos não está ligada neste servidor.', 501);
    let tag: Tag | undefined;
    if (p.tagNova?.trim()) {
      const nome = p.tagNova.replace(/\s+/g, ' ').trim();
      tag = (await this.o.tags.soltas()).find((t) => t.nome.toLowerCase() === nome.toLowerCase());
      if (!tag && !p.simular) tag = await this.o.tags.criar({ nome }, por);
    } else if (p.tagId) tag = await this.o.tags.exigir(p.tagId);
    const { PedidoImportacao } = await import('../leads/leads.js');
    const pedido = PedidoImportacao.parse({
      linhas: p.linhas,
      unidade: p.unidade,
      etapa: 'novo_lead',
      ...(tag ? { tagId: tag.id } : {}),
      criarConversa: true,
      ...(p.dddPadrao ? { dddPadrao: p.dddPadrao } : {}),
      simular: Boolean(p.simular),
    });
    const relatorio = await this.o.leads.importar(pedido, por);
    return { relatorio, tag: tag ? { id: tag.id, nome: tag.nome, cor: tag.cor } : null };
  }

  // ------------------------------------------------------------------ ciclo de vida

  /** Confere se dá para enviar e começa (agora, agendada ou esperando a aprovação do modelo). */
  async iniciar(id: string, o: { agendarPara?: Date | null } = {}): Promise<Campanha> {
    const c = await this.exigir(id);
    if (!['rascunho', 'pausada', 'agendada', 'aguardando_modelo'].includes(c.status)) throw new ErroTransmissao('Esta transmissão já está em andamento ou terminou.', 409);
    const numero = this.numeroDaUnidade(c.unidade);
    if (!numero) throw new ErroTransmissao(`A unidade ${UNIDADES[c.unidade].nome} não tem WhatsApp conectado.`);
    const tipo = ehCanalTeste(numero.canalId) ? 'teste' : numero.canal.tipo;
    if (c.canal === 'oficial' && tipo === 'evolution') throw new ErroTransmissao('Esta unidade usa a API não oficial (QR Code): escolha "API não oficial" e escreva o texto.');
    if (c.canal === 'nao_oficial' && tipo === 'meta') throw new ErroTransmissao('Esta unidade usa a API oficial: fora da janela de 24 h só passa modelo aprovado. Escolha "API oficial" e um modelo.');
    if (c.canal === 'oficial') {
      if (!c.mensagem.modelo) throw new ErroTransmissao('Escolha o modelo aprovado.');
      const n = contarVariaveis(c.mensagem.modelo.corpo);
      if (c.mensagem.variaveis.length < n) throw new ErroTransmissao(`O modelo tem ${n} variável(is): diga o que vai em cada uma.`);
      if (c.mensagem.modelo.cabecalho === 'IMAGE' && !c.temImagem) throw new ErroTransmissao('O modelo tem imagem no cabeçalho: envie a imagem da campanha.');
    } else if (!c.mensagem.texto.trim()) throw new ErroTransmissao('Escreva a mensagem.');
    if (c.modo === 'automatico' && !c.envio.gatilho) throw new ErroTransmissao('Escolha o gatilho da transmissão automática.');
    const agora = this.agora();
    const agendarPara = o.agendarPara === undefined ? c.agendadaPara : o.agendarPara;

    let status: StatusCampanha = c.modo === 'automatico' ? 'enviando' : agendarPara && agendarPara.getTime() > agora.getTime() ? 'agendada' : 'enviando';
    if (c.canal === 'oficial' && c.mensagem.modelo) {
      const m = await this.modeloLocal(c.unidade, c.mensagem.modelo.nome, c.mensagem.modelo.idioma);
      if (m && m.status !== 'aprovado') {
        if (m.status === 'rejeitado') throw new ErroTransmissao(`O modelo foi rejeitado pela Meta${m.motivo ? ` (${m.motivo})` : ''}. Ajuste e envie de novo.`);
        status = 'aguardando_modelo';
      }
    }
    await this.pool.query(
      `update sintonia.transmissoes set status = $2, agendada_para = $3, canal_id = coalesce(case when status = 'rascunho' then null else canal_id end, $4),
              iniciada_em = coalesce(iniciada_em, case when $2 = 'enviando' then $5::timestamptz end), erro = null, atualizada_em = $5
        where id = $1`,
      [id, status, agendarPara ?? null, numero.canalId, agora],
    );
    if (status === 'enviando' && c.modo === 'manual' && c.status !== 'pausada') await this.materializar(id);
    return this.exigir(id);
  }

  /** Grava a lista de destinatários (uma vez; o banco impede repetir a mesma pessoa). */
  private async materializar(id: string): Promise<number> {
    const c = await this.exigir(id);
    if (c.modo === 'automatico') return 0;
    const s = await this.selecionar(c.unidade, c.publico, c.id);
    const agora = this.agora();
    let n = 0;
    for (let i = 0; i < s.escolhidos.length; i += 500) {
      const parte = s.escolhidos.slice(i, i + 500);
      const r = await this.pool.query(
        `insert into sintonia.transmissao_destinos (transmissao_id, telefone, conversa_id, nome, origem, entrou_em, enviar_apos)
         select $1, t, cid::uuid, n, 'publico', $5, $5 from unnest($2::text[], $3::text[], $4::text[]) as x(t, cid, n)
         on conflict do nothing`,
        [id, parte.map((l) => l.telefone), parte.map((l) => l.conversa_id), parte.map((l) => l.nome), agora],
      );
      n += r.rowCount ?? 0;
    }
    await this.pool.query("update sintonia.transmissoes set iniciada_em = coalesce(iniciada_em, $2) where id = $1", [id, agora]);
    if (n === 0 && !(await this.temPendentes(id))) {
      await this.pool.query("update sintonia.transmissoes set status = 'concluida', concluida_em = $2, erro = 'Ninguém no público (ou todos excluídos).' where id = $1", [id, agora]);
    }
    return n;
  }

  private async temPendentes(id: string): Promise<boolean> {
    const { rows } = await this.pool.query("select 1 from sintonia.transmissao_destinos where transmissao_id = $1 and status in ('fila', 'enviando') limit 1", [id]);
    return rows.length > 0;
  }

  async pausar(id: string): Promise<Campanha> {
    const c = await this.exigir(id);
    if (!['enviando', 'agendada', 'aguardando_modelo'].includes(c.status)) throw new ErroTransmissao('Só dá para pausar o que está agendado ou enviando.', 409);
    await this.pool.query("update sintonia.transmissoes set status = 'pausada', atualizada_em = $2 where id = $1", [id, this.agora()]);
    return this.exigir(id);
  }

  async retomar(id: string): Promise<Campanha> {
    const c = await this.exigir(id);
    if (c.status !== 'pausada') throw new ErroTransmissao('A transmissão não está pausada.', 409);
    // Pausada antes de começar (ainda sem destinatários): começa de verdade.
    const { rows } = await this.pool.query('select 1 from sintonia.transmissao_destinos where transmissao_id = $1 limit 1', [id]);
    if (!rows.length && c.modo === 'manual') {
      await this.pool.query("update sintonia.transmissoes set status = 'rascunho' where id = $1", [id]);
      return this.iniciar(id, { agendarPara: c.agendadaPara && c.agendadaPara > this.agora() ? c.agendadaPara : null });
    }
    this.falhasSeguidas.delete(id);
    await this.pool.query("update sintonia.transmissoes set status = 'enviando', erro = null, atualizada_em = $2 where id = $1", [id, this.agora()]);
    return this.exigir(id);
  }

  async cancelar(id: string): Promise<Campanha> {
    const c = await this.exigir(id);
    if (['concluida', 'cancelada'].includes(c.status)) throw new ErroTransmissao('A transmissão já terminou.', 409);
    const agora = this.agora();
    await this.pool.query("update sintonia.transmissao_destinos set status = 'pulada', erro = 'Transmissão cancelada' where transmissao_id = $1 and status = 'fila'", [id]);
    await this.pool.query("update sintonia.transmissoes set status = 'cancelada', concluida_em = $2, atualizada_em = $2 where id = $1", [id, agora]);
    return this.exigir(id);
  }

  // ------------------------------------------------------------------ números da campanha

  async contagens(ids: string[]): Promise<Map<string, Contagem>> {
    if (!ids.length) return new Map();
    const { rows } = await this.pool.query<{ transmissao_id: string; status: StatusDestino; n: string }>(
      'select transmissao_id, status, count(*) as n from sintonia.transmissao_destinos where transmissao_id = any($1::uuid[]) group by 1, 2',
      [ids],
    );
    const por = new Map<string, Map<StatusDestino, number>>();
    for (const r of rows) {
      const m = por.get(r.transmissao_id) ?? new Map();
      m.set(r.status, Number(r.n));
      por.set(r.transmissao_id, m);
    }
    return new Map(ids.map((id) => [id, contagemDe(por.get(id) ?? new Map())]));
  }

  /** Detalhe para a página da campanha: números, gráfico e situação do envio. */
  async detalhe(id: string) {
    const c = await this.exigir(id);
    const contagem = (await this.contagens([id])).get(id)!;
    const agora = this.agora();
    const ritmo = c.canalId
      ? (await this.pool.query<{ proximo_em: Date; no_dia: number; dia: string | null }>("select proximo_em, no_dia, to_char(dia, 'YYYY-MM-DD') as dia from sintonia.transmissao_ritmo where canal_id = $1", [c.canalId])).rows[0]
      : undefined;
    return {
      ...c,
      contagem,
      serie: await this.serie(id),
      situacao: {
        dentroDaJanela: dentroDaJanela(c.envio, agora),
        proximoEnvio: ritmo && ritmo.proximo_em.getTime() > agora.getTime() ? ritmo.proximo_em : null,
        enviadosHojeNoNumero: ritmo?.dia === dataISO(agora) ? ritmo.no_dia : 0,
        canalTeste: c.canalId ? ehCanalTeste(c.canalId) : Boolean(this.numeroDaUnidade(c.unidade) && ehCanalTeste(this.numeroDaUnidade(c.unidade)!.canalId)),
      },
    };
  }

  /** Envios, entregas, leituras e respostas por intervalo (minuto, se curta; hora, se longa). */
  async serie(id: string) {
    const { rows: lim } = await this.pool.query<{ ini: Date | null; fim: Date | null }>(
      'select min(enviada_em) as ini, max(greatest(enviada_em, entregue_em, lida_em, respondeu_em)) as fim from sintonia.transmissao_destinos where transmissao_id = $1',
      [id],
    );
    const ini = lim[0]?.ini;
    const fim = lim[0]?.fim;
    if (!ini || !fim) return { passo: 'minuto', pontos: [] as Array<{ em: string; enviadas: number; entregues: number; lidas: number; responderam: number }> };
    const span = fim.getTime() - ini.getTime();
    const passo = span <= 3 * 60 * MIN ? 'minute' : span <= 7 * DIA ? 'hour' : 'day';
    const { rows } = await this.pool.query<{ em: Date; enviadas: string; entregues: string; lidas: string; responderam: string }>(
      `with ev as (
         select date_trunc($2, enviada_em) as em, 1 as e, 0 as g, 0 as l, 0 as r from sintonia.transmissao_destinos where transmissao_id = $1 and enviada_em is not null
         union all select date_trunc($2, entregue_em), 0, 1, 0, 0 from sintonia.transmissao_destinos where transmissao_id = $1 and entregue_em is not null
         union all select date_trunc($2, lida_em), 0, 0, 1, 0 from sintonia.transmissao_destinos where transmissao_id = $1 and lida_em is not null
         union all select date_trunc($2, respondeu_em), 0, 0, 0, 1 from sintonia.transmissao_destinos where transmissao_id = $1 and respondeu_em is not null)
       select em, sum(e) as enviadas, sum(g) as entregues, sum(l) as lidas, sum(r) as responderam from ev group by em order by em limit 500`,
      [id, passo],
    );
    return {
      passo: passo === 'minute' ? 'minuto' : passo === 'hour' ? 'hora' : 'dia',
      pontos: rows.map((r) => ({ em: r.em.toISOString(), enviadas: Number(r.enviadas), entregues: Number(r.entregues), lidas: Number(r.lidas), responderam: Number(r.responderam) })),
    };
  }

  async destinos(id: string, f: { status?: string; busca?: string; limite?: number; pagina?: number } = {}) {
    await this.exigir(id);
    const limite = Math.min(Math.max(f.limite ?? 50, 1), 200);
    const offset = Math.max(f.pagina ?? 0, 0) * limite;
    const busca = f.busca?.trim() ? `%${f.busca.trim().toLowerCase()}%` : null;
    const filtroStatus = f.status && (STATUS_DESTINO as readonly string[]).includes(f.status) ? f.status : null;
    const { rows } = await this.pool.query(
      `select id, telefone, nome, status, conversa_id, texto, erro, origem, entrou_em, enviada_em, entregue_em, lida_em, respondeu_em, falhou_em, count(*) over () as total
         from sintonia.transmissao_destinos
        where transmissao_id = $1 and ($2::text is null or status = $2) and ($3::text is null or lower(coalesce(nome, '')) like $3 or telefone like $3)
        order by coalesce(respondeu_em, lida_em, entregue_em, enviada_em, entrou_em) desc, id desc
        limit $4 offset $5`,
      [id, filtroStatus, busca, limite, offset],
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      itens: rows.map((r) => ({
        id: Number(r.id),
        telefone: r.telefone,
        nome: r.nome,
        status: r.status,
        conversaId: r.conversa_id,
        texto: r.texto,
        erro: r.erro,
        origem: r.origem,
        entrouEm: r.entrou_em,
        enviadaEm: r.enviada_em,
        entregueEm: r.entregue_em,
        lidaEm: r.lida_em,
        respondeuEm: r.respondeu_em,
        falhouEm: r.falhou_em,
      })),
    };
  }

  // ------------------------------------------------------------------ automáticas

  /** Põe a conversa na transmissão (gatilho ou passo de automação). Uma vez por pessoa (por ciclo). */
  async adicionarConversa(campanhaId: string, c: Conversa, origem: string, ciclo = ''): Promise<{ entrou: boolean; motivo?: string }> {
    const camp = await this.obter(campanhaId);
    if (!camp) return { entrou: false, motivo: 'Transmissão não encontrada.' };
    if (camp.status !== 'enviando') return { entrou: false, motivo: 'A transmissão não está ligada (enviando).' };
    if (camp.unidade !== c.unidade) return { entrou: false, motivo: 'A conversa é de outra unidade.' };
    if (!new RegExp(CELULAR).test(c.telefone)) return { entrou: false, motivo: 'Telefone não é celular.' };
    if (await this.descadastrado(c.telefone)) return { entrou: false, motivo: 'Pediu para sair das transmissões.' };
    const agora = this.agora();
    const r = await this.pool.query(
      `insert into sintonia.transmissao_destinos (transmissao_id, telefone, ciclo, conversa_id, nome, origem, entrou_em, enviar_apos)
       values ($1, $2, $3, $4, $5, $6, $7, $7) on conflict do nothing`,
      [campanhaId, c.telefone, ciclo, c.id, c.nome ?? null, origem, agora],
    );
    return (r.rowCount ?? 0) > 0 ? { entrou: true } : { entrou: false, motivo: 'Já recebeu esta transmissão.' };
  }

  private async automaticas(unidade: string, casa: (g: GatilhoTransmissao) => boolean): Promise<Campanha[]> {
    const { rows } = await this.pool.query(
      `select ${COLUNAS} from sintonia.transmissoes where empresa_id = $1 and modo = 'automatico' and status = 'enviando' and unidade = $2`,
      [this.empresaId, unidade],
    );
    return rows.map(campanhaDaLinha).filter((c) => c.envio.gatilho && casa(c.envio.gatilho));
  }

  /** Funis: a conversa entrou numa etapa (tags de etapa também contam como "tag marcada"). Sob a trava da conversa: só grava. */
  async aoMover(m: MovimentoEtapa): Promise<void> {
    const para = m.para;
    if (!para) return;
    for (const camp of await this.automaticas(m.conversa.unidade, (g) => (g.tipo === 'entrou_na_etapa' && g.etapaId === para) || (g.tipo === 'tag_marcada' && g.tagId === para))) {
      await this.adicionarConversa(camp.id, m.conversa, 'gatilho: etapa');
    }
  }

  async aoMarcarTag(c: Conversa, tag: Tag): Promise<void> {
    for (const camp of await this.automaticas(c.unidade, (g) => g.tipo === 'tag_marcada' && g.tagId === tag.id)) {
      await this.adicionarConversa(camp.id, c, 'gatilho: tag');
    }
  }

  /** Aniversário e "X dias depois de comparecer": conferidos algumas vezes por dia. */
  async gatilhosDiarios(): Promise<number> {
    const agora = this.agora();
    const p = partesBahia(agora);
    const { rows } = await this.pool.query(
      `select ${COLUNAS} from sintonia.transmissoes where empresa_id = $1 and modo = 'automatico' and status = 'enviando'`,
      [this.empresaId],
    );
    let n = 0;
    for (const camp of rows.map(campanhaDaLinha)) {
      const g = camp.envio.gatilho;
      if (g?.tipo === 'aniversario') {
        const mmdd = `${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
        const r = await this.pool.query(
          `insert into sintonia.transmissao_destinos (transmissao_id, telefone, ciclo, conversa_id, nome, origem, entrou_em, enviar_apos)
           select distinct on (c.telefone) $1, c.telefone, $4, c.id, coalesce(nullif(ct.nome, ''), c.nome), 'gatilho: aniversário', $5, $5
             from sintonia.conversas c
             join sintonia.contatos ct on ct.empresa_id = c.empresa_id and ct.telefone = c.telefone
            where c.empresa_id = $2 and c.unidade = $3 and to_char(ct.nascimento, 'MM-DD') = $6 and c.telefone ~ '${CELULAR}'
              and not exists (select 1 from sintonia.transmissao_optout o where o.empresa_id = c.empresa_id and o.telefone = c.telefone)
           on conflict do nothing`,
          [camp.id, this.empresaId, camp.unidade, String(p.ano), agora, mmdd],
        );
        n += r.rowCount ?? 0;
      } else if (g?.tipo === 'dias_apos_compareceu') {
        const alvo = dataISO(new Date(agora.getTime() - g.dias * DIA));
        const r = await this.pool.query(
          `insert into sintonia.transmissao_destinos (transmissao_id, telefone, ciclo, conversa_id, nome, origem, entrou_em, enviar_apos)
           select distinct on (c.telefone) $1, c.telefone, $4, c.id, coalesce(nullif(ct.nome, ''), c.nome), 'gatilho: ' || $6 || ' dia(s) depois de comparecer', $5, $5
             from sintonia.eventos e
             join sintonia.conversas c on c.id = e.conversa_id
             left join sintonia.contatos ct on ct.empresa_id = c.empresa_id and ct.telefone = c.telefone
             left join sintonia.tags tg on tg.id::text = e.dados->>'para'
            where c.empresa_id = $2 and c.unidade = $3 and c.telefone ~ '${CELULAR}'
              and ((e.tipo = 'etapa_mudou' and e.dados->>'para' = 'compareceu') or (e.tipo = 'etapa_movida' and tg.chave_sistema = 'compareceu'))
              and to_char(e.em at time zone 'America/Bahia', 'YYYY-MM-DD') = $4
              and not exists (select 1 from sintonia.transmissao_optout o where o.empresa_id = c.empresa_id and o.telefone = c.telefone)
           on conflict do nothing`,
          [camp.id, this.empresaId, camp.unidade, alvo, agora, String(g.dias)],
        );
        n += r.rowCount ?? 0;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ respostas, descadastro e entrega

  async descadastrado(telefone: string): Promise<boolean> {
    const { rows } = await this.pool.query('select 1 from sintonia.transmissao_optout where empresa_id = $1 and telefone = $2', [this.empresaId, telefone]);
    return rows.length > 0;
  }

  async descadastrar(telefone: string, motivo: string): Promise<void> {
    await this.pool.query(
      'insert into sintonia.transmissao_optout (empresa_id, telefone, em, motivo) values ($1, $2, $3, $4) on conflict (empresa_id, telefone) do nothing',
      [this.empresaId, telefone, this.agora(), motivo],
    );
    // Quem estava na fila de alguma transmissão sai dela.
    await this.pool.query(
      `update sintonia.transmissao_destinos d set status = 'pulada', erro = 'Pediu para sair'
         from sintonia.transmissoes t where t.id = d.transmissao_id and t.empresa_id = $1 and d.telefone = $2 and d.status = 'fila'`,
      [this.empresaId, telefone],
    );
  }

  async voltarAReceber(telefone: string): Promise<void> {
    await this.pool.query('delete from sintonia.transmissao_optout where empresa_id = $1 and telefone = $2', [this.empresaId, telefone]);
  }

  async totalDescadastrados(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>('select count(*) as n from sintonia.transmissao_optout where empresa_id = $1', [this.empresaId]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Mensagem da cliente (gancho da Sintonia, sob a trava da conversa): "SAIR"/"PARAR" descadastra;
   * qualquer outra resposta até 7 dias depois de uma transmissão conta como "respondeu" e marca a tag da campanha.
   */
  async mensagemCliente(c: Conversa, m: { texto: string }): Promise<void> {
    const agora = this.agora();
    if (ehDescadastro(m.texto)) {
      await this.descadastrar(c.telefone, `Respondeu "${m.texto.trim().slice(0, 40)}"`);
      const { rows } = await this.pool.query<{ transmissao_id: string }>(
        `update sintonia.transmissao_destinos set status = 'descadastrou', respondeu_em = coalesce(respondeu_em, $3), entregue_em = coalesce(entregue_em, $3), lida_em = coalesce(lida_em, $3)
          where id = (select d.id from sintonia.transmissao_destinos d join sintonia.transmissoes t on t.id = d.transmissao_id
                       where t.empresa_id = $1 and d.telefone = $2 and d.enviada_em is not null and d.enviada_em > $3::timestamptz - interval '60 days'
                       order by d.enviada_em desc limit 1)
          returning transmissao_id`,
        [this.empresaId, c.telefone, agora],
      );
      await this.o.repo.registrarEvento({ tipo: 'transmissao', conversaId: c.id, unidade: c.unidade, em: agora, dados: { acao: 'descadastrou', transmissaoId: rows[0]?.transmissao_id ?? null } });
      return;
    }
    const { rows } = await this.pool.query<{ transmissao_id: string }>(
      `update sintonia.transmissao_destinos set status = 'respondeu', respondeu_em = $3, entregue_em = coalesce(entregue_em, $3), lida_em = coalesce(lida_em, $3)
        where id = (select d.id from sintonia.transmissao_destinos d join sintonia.transmissoes t on t.id = d.transmissao_id
                     where t.empresa_id = $1 and d.telefone = $2 and d.status in ('enviada', 'entregue', 'lida')
                       and d.enviada_em <= $3 and d.enviada_em > $3::timestamptz - interval '7 days'
                     order by d.enviada_em desc limit 1)
        returning transmissao_id`,
      [this.empresaId, c.telefone, agora],
    );
    const campId = rows[0]?.transmissao_id;
    if (!campId) return;
    const tag = await this.tagDaCampanha(campId).catch((e) => {
      this.log('Falha ao criar a tag da transmissão', String(e));
      return undefined;
    });
    if (tag) {
      const r = await this.o.tags.marcar(c, tag.id, 'Transmissão').catch(() => undefined);
      if (r?.mudou) await this.o.repo.registrarEvento({ tipo: 'tag_marcada', conversaId: c.id, unidade: c.unidade, em: agora, dados: { tagId: tag.id, nome: tag.nome, por: 'Transmissão' } });
    }
    await this.o.repo.registrarEvento({ tipo: 'transmissao', conversaId: c.id, unidade: c.unidade, em: agora, dados: { acao: 'respondeu', transmissaoId: campId } });
  }

  /** Tag "📣 Nome da campanha" (criada na primeira resposta; reaproveita se já existe uma com o mesmo nome). */
  private async tagDaCampanha(id: string): Promise<Tag | undefined> {
    const c = await this.exigir(id);
    if (c.tagId) {
      const t = await this.o.tags.exigir(c.tagId).catch(() => undefined);
      if (t) return t;
    }
    const nome = `📣 ${c.nome}`.slice(0, 30).trim();
    let tag = (await this.o.tags.soltas()).find((t) => t.nome.toLowerCase() === nome.toLowerCase());
    tag ??= await this.o.tags.criar({ nome }, 'Transmissão');
    await this.pool.query('update sintonia.transmissoes set tag_id = $2 where id = $1', [id, tag.id]);
    return tag;
  }

  /** Avisos de entrega/leitura/falha (webhook da API oficial). Nunca volta atrás. */
  async statusRecebidos(lista: StatusRecebido[]): Promise<number> {
    let n = 0;
    for (const s of lista) {
      if (s.status === 'falhou') {
        const r = await this.pool.query(
          "update sintonia.transmissao_destinos set status = 'falhou', falhou_em = $2, erro = $3 where id_externo = $1 and status in ('enviando', 'enviada')",
          [s.idExterno, s.em, s.erro ?? 'O WhatsApp avisou falha na entrega'],
        );
        n += r.rowCount ?? 0;
        continue;
      }
      const r = await this.pool.query(
        `update sintonia.transmissao_destinos
            set status = case when array_position(array['enviada','entregue','lida','respondeu','descadastrou'], status) < array_position(array['enviada','entregue','lida','respondeu','descadastrou'], $2)
                              then $2 else status end,
                entregue_em = case when $2 in ('entregue', 'lida') then coalesce(entregue_em, $3) else entregue_em end,
                lida_em = case when $2 = 'lida' then coalesce(lida_em, $3) else lida_em end
          where id_externo = $1 and status in ('enviada', 'entregue', 'lida', 'respondeu', 'descadastrou')`,
        [s.idExterno, s.status, s.em],
      );
      n += r.rowCount ?? 0;
    }
    return n;
  }

  // ------------------------------------------------------------------ envio (fila com ritmo)

  /**
   * Uma volta do relógio: começa as agendadas, solta envios travados, gatilhos do dia, modelos, simulação do
   * canal de teste e envia o que o ritmo de cada número permite. Pode rodar em vários processos.
   */
  async tick(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      const agora = this.agora();
      await this.soltarTravados();
      await this.comecarAgendadas();
      if (agora.getTime() - this.ultimoDiario > 10 * MIN) {
        this.ultimoDiario = agora.getTime();
        await this.gatilhosDiarios().catch((e) => this.log('Falha nos gatilhos diários das transmissões', String(e)));
      }
      if (agora.getTime() - this.ultimaSincronia > 5 * MIN || (await this.temModeloDeTestePendente())) {
        this.ultimaSincronia = agora.getTime();
        await this.atualizarModelos().catch((e) => this.log('Falha ao atualizar os modelos da Meta', String(e)));
      }
      await this.simularCanalTeste();
      let enviados = 0;
      const inicio = Date.now();
      // Várias voltas no mesmo tick enquanto o ritmo deixar (ritmo rápido na API oficial), até ~0,9 s.
      for (let volta = 0; volta < 50; volta++) {
        const n = await this.enviarRodada();
        enviados += n;
        if (!n || Date.now() - inicio > 900) break;
      }
      await this.concluirTerminadas();
      return enviados;
    } finally {
      this.rodando = false;
    }
  }

  private async soltarTravados(): Promise<void> {
    const agora = this.agora();
    await this.pool.query(
      `update sintonia.transmissao_destinos set status = 'falhou', falhou_em = $1,
              erro = 'Envio interrompido no meio (o servidor reiniciou). Não reenviado para não mandar duas vezes: confira na conversa.'
        where status = 'enviando' and reservada_em < $1::timestamptz - make_interval(secs => $2::double precision / 1000)`,
      [agora, TRAVADO_MS],
    );
  }

  private async comecarAgendadas(): Promise<void> {
    const { rows } = await this.pool.query<{ id: string }>(
      "update sintonia.transmissoes set status = 'enviando', iniciada_em = coalesce(iniciada_em, $2), atualizada_em = $2 where empresa_id = $1 and status = 'agendada' and (agendada_para is null or agendada_para <= $2) returning id",
      [this.empresaId, this.agora()],
    );
    for (const r of rows) await this.materializar(r.id).catch((e) => this.log('Falha ao montar o público da transmissão', String(e)));
  }

  private async concluirTerminadas(): Promise<void> {
    const agora = this.agora();
    await this.pool.query(
      `update sintonia.transmissoes t set status = 'concluida', concluida_em = $2, atualizada_em = $2
        where t.empresa_id = $1 and t.status = 'enviando' and t.modo = 'manual'
          and exists (select 1 from sintonia.transmissao_destinos d where d.transmissao_id = t.id)
          and not exists (select 1 from sintonia.transmissao_destinos d where d.transmissao_id = t.id and d.status in ('fila', 'enviando'))`,
      [this.empresaId, agora],
    );
  }

  /** Tenta um envio por campanha em andamento (o ritmo do número decide se sai agora). */
  private async enviarRodada(): Promise<number> {
    const agora = this.agora();
    const { rows } = await this.pool.query(
      `select ${COLUNAS} from sintonia.transmissoes t where empresa_id = $1 and status = 'enviando'
          and exists (select 1 from sintonia.transmissao_destinos d where d.transmissao_id = t.id and d.status = 'fila' and d.enviar_apos <= $2)
        order by iniciada_em nulls last, criada_em`,
      [this.empresaId, agora],
    );
    let n = 0;
    for (const camp of rows.map(campanhaDaLinha)) {
      if (!dentroDaJanela(camp.envio, agora)) continue;
      const reservado = await this.reservar(camp, agora);
      if (!reservado) continue;
      await this.enviarUm(camp, reservado);
      n++;
    }
    return n;
  }

  /** Reserva o próximo da fila e o horário do número, numa transação (skip locked: um processo por envio). */
  private async reservar(camp: Campanha, agora: Date): Promise<{ id: number; telefone: string; conversaId: string | null; nome: string | null } | undefined> {
    const canalId = camp.canalId;
    if (!canalId) return undefined;
    const cli = await this.pool.connect();
    try {
      await cli.query('begin');
      await cli.query("insert into sintonia.transmissao_ritmo (canal_id, proximo_em) values ($1, 'epoch') on conflict do nothing", [canalId]);
      const { rows: rr } = await cli.query<{ proximo_em: Date; seguidos: number; dia: string | null; no_dia: number }>(
        "select proximo_em, seguidos, to_char(dia, 'YYYY-MM-DD') as dia, no_dia from sintonia.transmissao_ritmo where canal_id = $1 for update skip locked",
        [canalId],
      );
      const r = rr[0];
      if (!r || r.proximo_em.getTime() > agora.getTime()) {
        await cli.query('rollback');
        return undefined;
      }
      const hoje = dataISO(agora);
      const noDia = r.dia === hoje ? r.no_dia : 0;
      if (noDia >= camp.envio.limiteDia) {
        await cli.query('rollback');
        return undefined;
      }
      const { rows: dd } = await cli.query<{ id: string; telefone: string; conversa_id: string | null; nome: string | null }>(
        "select id, telefone, conversa_id, nome from sintonia.transmissao_destinos where transmissao_id = $1 and status = 'fila' and enviar_apos <= $2 order by id limit 1 for update skip locked",
        [camp.id, agora],
      );
      const d = dd[0];
      if (!d) {
        await cli.query('rollback');
        return undefined;
      }
      await cli.query("update sintonia.transmissao_destinos set status = 'enviando', reservada_em = $2 where id = $1", [d.id, agora]);
      // Parado há mais de 30 min: a sequência recomeça (a pausa longa conta de novo do zero).
      const seguidos = (r.proximo_em.getTime() < agora.getTime() - 30 * MIN ? 0 : r.seguidos) + 1;
      const { ms } = esperaDepois(camp.envio, camp.canal === 'oficial', seguidos, this.aleatorio);
      await cli.query('update sintonia.transmissao_ritmo set proximo_em = $2, seguidos = $3, dia = $4, no_dia = $5 where canal_id = $1', [
        canalId,
        new Date(agora.getTime() + ms),
        seguidos,
        hoje,
        noDia + 1,
      ]);
      await cli.query('commit');
      return { id: Number(d.id), telefone: d.telefone, conversaId: d.conversa_id, nome: d.nome };
    } catch (e) {
      await cli.query('rollback').catch(() => {});
      throw e;
    } finally {
      cli.release();
    }
  }

  private async enviarUm(camp: Campanha, d: { id: number; telefone: string; conversaId: string | null; nome: string | null }): Promise<void> {
    const agora = this.agora();
    const falhar = async (erro: string, status: 'falhou' | 'pulada' = 'falhou') => {
      await this.pool.query('update sintonia.transmissao_destinos set status = $2, erro = $3, falhou_em = $4 where id = $1', [d.id, status, erro.slice(0, 500), agora]);
    };
    try {
      if (await this.descadastrado(d.telefone)) return await falhar('Pediu para sair', 'pulada');
      const numero = this.o.numeros().find((n) => n.canalId === camp.canalId);
      if (!numero) {
        await this.pool.query("update sintonia.transmissao_destinos set status = 'fila', reservada_em = null where id = $1", [d.id]);
        await this.pool.query("update sintonia.transmissoes set status = 'pausada', erro = $2, atualizada_em = $3 where id = $1", [camp.id, `O número de envio (${camp.canalId}) não está conectado. Reconecte em Conexões e retome.`, agora]);
        return;
      }
      // Conversa: a que já existe na unidade, ou uma nova pelo número da campanha.
      let conversaId = d.conversaId;
      if (!conversaId || !(await this.o.repo.buscarConversa(conversaId))) {
        const criada = await this.o.repo.buscarOuCriarConversa({ empresaId: this.empresaId, unidade: camp.unidade, canalId: numero.canalId, telefone: d.telefone, nome: d.nome ?? undefined, agora });
        conversaId = criada.conversa.id;
        if (criada.nova) {
          const modo = this.o.modoInicial ? await this.o.modoInicial().catch(() => 'humano' as const) : 'humano';
          await this.o.repo.salvarConversa({ ...criada.conversa, modo });
        }
      }
      const pessoa = await this.dadosPessoa(d.telefone, d.nome, camp.unidade);
      const oficial = camp.canal === 'oficial';
      const teste = ehCanalTeste(numero.canalId);
      let texto: string;
      let params: string[] = [];
      if (oficial) {
        const m = camp.mensagem.modelo!;
        params = parametrosDoModelo(camp.mensagem.variaveis, pessoa);
        texto = preencherModelo(m.corpo, params) || `[modelo: ${m.nome}]`;
      } else texto = montarTexto(camp.mensagem.texto, pessoa, sorteador(`${camp.id}:${d.telefone}`));
      const img = camp.temImagem ? await this.imagem(camp.id) : undefined;
      const textoConversa = img && !oficial ? textoDoAnexo('imagem', texto) : texto;

      const envio = async (n: NumeroConectado): Promise<EnvioResultado> => {
        if (teste || n.canal.tipo === 'teste') {
          if (img && n.canal.enviarMidia) return n.canal.enviarMidia(n.canalId, d.telefone, { tipo: 'imagem', conteudo: img.conteudo, mimetype: img.tipo, legenda: texto });
          return n.canal.enviarTexto(n.canalId, d.telefone, texto);
        }
        if (oficial) {
          if (n.canal.tipo !== 'meta' || !n.canal.enviarModelo) throw new Error('Esta conversa não está num número da API oficial.');
          const m = camp.mensagem.modelo!;
          const cabecalhoImagemId = m.cabecalho === 'IMAGE' && img ? await this.midiaMeta(camp, n, img) : undefined;
          return n.canal.enviarModelo(n.canalId, d.telefone, { nome: m.nome, idioma: m.idioma, parametros: params, ...(cabecalhoImagemId ? { cabecalhoImagemId } : {}) });
        }
        if (img && n.canal.enviarMidia) return n.canal.enviarMidia(n.canalId, d.telefone, { tipo: 'imagem', conteudo: img.conteudo, mimetype: img.tipo, legenda: texto });
        return n.canal.enviarTexto(n.canalId, d.telefone, texto);
      };
      const sintonia = this.o.sintonia();
      const idExterno = await sintonia.comConversa(conversaId, async (c) => {
        const id = await sintonia.enviarTransmissao(c, textoConversa, envio, `Transmissão: ${camp.nome}`, oficial);
        await this.o.repo.salvarConversa(c);
        return id;
      });
      if (idExterno === undefined) return await falhar('Conversa não encontrada');
      await this.pool.query(
        "update sintonia.transmissao_destinos set status = 'enviada', enviada_em = $2, id_externo = $3, texto = $4, conversa_id = $5, erro = null where id = $1",
        [d.id, agora, idExterno || null, textoConversa, conversaId],
      );
      this.falhasSeguidas.delete(camp.id);
      await this.o.repo.registrarEvento({ tipo: 'transmissao', conversaId, unidade: camp.unidade, em: agora, dados: { acao: 'enviou', transmissaoId: camp.id, nome: camp.nome } });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await falhar(msg);
      const n = (this.falhasSeguidas.get(camp.id) ?? 0) + 1;
      this.falhasSeguidas.set(camp.id, n);
      this.log('Falha no envio da transmissão', { transmissao: camp.id, erro: msg });
      // Muitas falhas seguidas: algo errado com o número (bloqueio, token): pausa para alguém olhar.
      if (n >= 5) {
        this.falhasSeguidas.delete(camp.id);
        await this.pool.query("update sintonia.transmissoes set status = 'pausada', erro = $2, atualizada_em = $3 where id = $1 and status = 'enviando'", [
          camp.id,
          `Pausada sozinha: 5 falhas seguidas. Última: ${msg}`.slice(0, 500),
          agora,
        ]);
      }
    }
  }

  /** Imagem do cabeçalho do modelo: sobe uma vez em /media (vale ~30 dias) e reaproveita o id. */
  private async midiaMeta(camp: Campanha, n: NumeroConectado, img: { conteudo: Buffer; tipo: string }): Promise<string> {
    const { rows } = await this.pool.query<{ imagem_meta: { canalId: string; id: string; em: string } | null }>('select imagem_meta from sintonia.transmissoes where id = $1', [camp.id]);
    const m = rows[0]?.imagem_meta;
    if (m && m.canalId === n.canalId && Date.now() - new Date(m.em).getTime() < 25 * DIA) return m.id;
    const canal = n.canal as Partial<CanalMeta>;
    if (!canal.subirMidia) throw new Error('Este canal não envia imagem no cabeçalho do modelo.');
    const id = await canal.subirMidia(n.canalId, img.conteudo, img.tipo);
    await this.pool.query('update sintonia.transmissoes set imagem_meta = $2 where id = $1', [camp.id, { canalId: n.canalId, id, em: this.agora().toISOString() }]);
    return id;
  }

  /** Nome, unidade e campos da ficha (pelo id e pelo nome do campo) para as variáveis. */
  private async dadosPessoa(telefone: string, nome: string | null, unidade: UnidadeTransmissao): Promise<DadosPessoa> {
    const [ficha, defs] = await Promise.all([this.o.contatos.obter(this.empresaId, telefone).catch(() => undefined), this.o.contatos.campos(this.empresaId).catch(() => [])]);
    const campos: DadosPessoa['campos'] = {};
    for (const [id, v] of Object.entries(ficha?.campos ?? {})) {
      campos[id] = v;
      const def = defs.find((x) => x.id === id);
      if (def) campos[def.nome] = v;
    }
    if (ficha?.email) campos.email = ficha.email;
    if (ficha?.nascimento) campos.nascimento = ficha.nascimento.split('-').reverse().join('/');
    return { nome: ficha?.nome || nome, telefone, unidade: UNIDADES[unidade].nome, campos };
  }

  /** Canal de teste: simula "entregue" (3 s) e "lida" (mais 4 s) para ver o funil andar sem número real. */
  private async simularCanalTeste(): Promise<void> {
    const agora = this.agora();
    const entregues = await this.pool.query<{ id_externo: string | null }>(
      `update sintonia.transmissao_destinos d set status = 'entregue', entregue_em = $1
         from sintonia.transmissoes t
        where t.id = d.transmissao_id and t.empresa_id = $2 and t.canal_id like 'teste-%' and d.status = 'enviada'
          and d.enviada_em < $1::timestamptz - interval '3 seconds' and d.id % 10 <> 7
        returning d.id_externo`,
      [agora, this.empresaId],
    );
    const lidas = await this.pool.query<{ id_externo: string | null }>(
      `update sintonia.transmissao_destinos d set status = 'lida', lida_em = $1
         from sintonia.transmissoes t
        where t.id = d.transmissao_id and t.empresa_id = $2 and t.canal_id like 'teste-%' and d.status = 'entregue'
          and d.entregue_em < $1::timestamptz - interval '4 seconds' and d.id % 3 <> 0
        returning d.id_externo`,
      [agora, this.empresaId],
    );
    for (const r of entregues.rows) if (r.id_externo) await this.o.repo.registrarEntrega(r.id_externo, 'entregue', agora).catch(() => false);
    for (const r of lidas.rows) if (r.id_externo) await this.o.repo.registrarEntrega(r.id_externo, 'lida', agora).catch(() => false);
  }

  /** Para a simulação: uma pessoa que recebeu (canal de teste) "responde". */
  async alguemParaResponder(id: string): Promise<{ telefone: string; nome: string | null; unidade: UnidadeTransmissao } | undefined> {
    const c = await this.exigir(id);
    if (!c.canalId || !ehCanalTeste(c.canalId)) throw new ErroTransmissao('A simulação de resposta só existe no WhatsApp de teste.', 409);
    const { rows } = await this.pool.query<{ telefone: string; nome: string | null }>(
      "select telefone, nome from sintonia.transmissao_destinos where transmissao_id = $1 and status in ('enviada', 'entregue', 'lida') order by random() limit 1",
      [id],
    );
    return rows[0] ? { ...rows[0], unidade: c.unidade } : undefined;
  }

  // ------------------------------------------------------------------ modelos da API oficial

  private async modeloLocal(unidade: string, nome: string, idioma: string) {
    const { rows } = await this.pool.query<{ status: string; motivo: string | null }>(
      'select status, motivo from sintonia.transmissao_modelos where empresa_id = $1 and unidade = $2 and nome = $3 and idioma = $4',
      [this.empresaId, unidade, nome, idioma],
    );
    return rows[0];
  }

  private cliente(unidade: string): { cli: ClienteModelosMeta; wabaId: string } | undefined {
    const conta = this.o.contaMeta?.(unidade);
    if (!conta?.wabaId) return undefined;
    return { cli: new ClienteModelosMeta(conta.token, this.o.fetchMeta ?? fetch), wabaId: conta.wabaId };
  }

  /** Modelos da unidade (os da WABA, sincronizados, e os criados pela tela). */
  async modelos(unidade: string, sincronizar = false) {
    if (sincronizar) await this.atualizarModelos(unidade);
    const { rows } = await this.pool.query(
      `select id, unidade, nome, idioma, categoria, componentes, status, motivo, meta_id, criado_por, criado_em, atualizado_em
         from sintonia.transmissao_modelos where empresa_id = $1 and unidade = $2 order by atualizado_em desc`,
      [this.empresaId, unidade],
    );
    return rows.map((r) => {
      const comp = (r.componentes ?? []) as Array<{ type?: string; format?: string; text?: string; buttons?: unknown[] }>;
      const corpo = comp.find((x) => x.type === 'BODY')?.text ?? '';
      const cab = comp.find((x) => x.type === 'HEADER');
      return {
        id: r.id,
        unidade: r.unidade,
        nome: r.nome,
        idioma: r.idioma,
        categoria: r.categoria,
        status: r.status,
        motivo: r.motivo,
        simulado: String(r.meta_id ?? '').startsWith('teste-'),
        corpo,
        variaveis: contarVariaveis(corpo),
        cabecalho: cab ? { formato: cab.format ?? 'TEXT', texto: cab.text ?? null } : null,
        rodape: comp.find((x) => x.type === 'FOOTER')?.text ?? null,
        botoes: (comp.find((x) => x.type === 'BUTTONS')?.buttons ?? []) as unknown[],
        criadoPor: r.criado_por,
        atualizadoEm: r.atualizado_em,
      };
    });
  }

  /** Cria o modelo e manda para aprovação da Meta. Sem a API oficial configurada (só teste), a aprovação é simulada. */
  async criarModelo(bruto: unknown, por: string) {
    const m = ModeloNovo.parse(bruto);
    if (!m.nome) throw new ErroTransmissao('Dê um nome ao modelo (letras minúsculas, números e _).');
    const ja = await this.modeloLocal(m.unidade, m.nome, m.idioma);
    if (ja) throw new ErroTransmissao('Já existe um modelo com este nome e idioma.', 409);
    const meta = this.cliente(m.unidade);
    const numero = this.numeroDaUnidade(m.unidade);
    if (!meta && !(numero && ehCanalTeste(numero.canalId))) {
      throw new ErroTransmissao('Preencha o WhatsApp Business Account ID e o token da unidade em Conexões para criar modelos.');
    }
    let handle: string | undefined;
    if (m.cabecalho?.tipo === 'imagem' && meta) handle = await meta.cli.subirExemplo(Buffer.from(m.cabecalho.base64, 'base64'), m.cabecalho.mimetype);
    const componentes = componentesDoModelo(m, handle);
    const agora = this.agora();
    let metaId: string;
    let status = 'pendente';
    if (meta) {
      const r = await meta.cli.criar(meta.wabaId, m, componentes);
      metaId = r.id;
      status = statusLocal(r.status);
    } else metaId = `teste-${randomUUID()}`;
    const id = randomUUID();
    await this.pool.query(
      `insert into sintonia.transmissao_modelos (id, empresa_id, unidade, nome, idioma, categoria, componentes, status, meta_id, criado_por, criado_em, atualizado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [id, this.empresaId, m.unidade, m.nome, m.idioma, m.categoria, JSON.stringify(componentes), status, metaId, por, agora],
    );
    return (await this.modelos(m.unidade)).find((x) => x.id === id)!;
  }

  private async temModeloDeTestePendente(): Promise<boolean> {
    const { rows } = await this.pool.query("select 1 from sintonia.transmissao_modelos where empresa_id = $1 and status = 'pendente' and meta_id like 'teste-%' limit 1", [this.empresaId]);
    return rows.length > 0;
  }

  /**
   * Atualiza o status dos modelos (pendente → aprovado/rejeitado) a partir da WABA de cada unidade e destrava
   * as campanhas que esperavam a aprovação. Modelos de teste são "aprovados" 10 s depois de criados.
   */
  async atualizarModelos(soUnidade?: string): Promise<void> {
    const agora = this.agora();
    for (const unidade of soUnidade ? [soUnidade] : ['norte', 'sumare']) {
      const meta = this.cliente(unidade);
      if (meta) {
        const lista = await meta.cli.listar(meta.wabaId);
        for (const t of lista) {
          await this.pool.query(
            `insert into sintonia.transmissao_modelos (id, empresa_id, unidade, nome, idioma, categoria, componentes, status, motivo, meta_id, criado_por, criado_em, atualizado_em)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Meta', $11, $11)
             on conflict (empresa_id, unidade, nome, idioma) do update
               set status = excluded.status, motivo = excluded.motivo, categoria = excluded.categoria, componentes = excluded.componentes,
                   meta_id = coalesce(excluded.meta_id, sintonia.transmissao_modelos.meta_id),
                   atualizado_em = case when sintonia.transmissao_modelos.status is distinct from excluded.status then excluded.atualizado_em else sintonia.transmissao_modelos.atualizado_em end`,
            [randomUUID(), this.empresaId, unidade, t.nome, t.idioma, t.categoria, JSON.stringify(t.componentes), statusLocal(t.status), t.motivo ?? null, t.id ?? null, agora],
          );
        }
      }
    }
    await this.pool.query(
      "update sintonia.transmissao_modelos set status = 'aprovado', atualizado_em = $2 where empresa_id = $1 and status = 'pendente' and meta_id like 'teste-%' and criado_em < $2::timestamptz - interval '10 seconds'",
      [this.empresaId, agora],
    );
    // Campanhas esperando o modelo.
    const { rows } = await this.pool.query(`select ${COLUNAS} from sintonia.transmissoes where empresa_id = $1 and status = 'aguardando_modelo'`, [this.empresaId]);
    for (const c of rows.map(campanhaDaLinha)) {
      const m = c.mensagem.modelo && (await this.modeloLocal(c.unidade, c.mensagem.modelo.nome, c.mensagem.modelo.idioma));
      if (m?.status === 'aprovado') {
        await this.pool.query("update sintonia.transmissoes set status = 'agendada', atualizada_em = $2 where id = $1", [c.id, agora]);
      } else if (m?.status === 'rejeitado') {
        await this.pool.query("update sintonia.transmissoes set status = 'rascunho', erro = $2, atualizada_em = $3 where id = $1", [
          c.id,
          `O modelo foi rejeitado pela Meta${m.motivo ? `: ${m.motivo}` : ''}. Ajuste e envie de novo.`,
          agora,
        ]);
      }
    }
  }
}

function contagemDe(m: Map<StatusDestino, number>): Contagem {
  const porStatus = STATUS_VAZIO();
  for (const [k, v] of m) porStatus[k] = v;
  const s = porStatus;
  const lidas = s.lida + s.respondeu + s.descadastrou;
  const entregues = s.entregue + lidas;
  const enviadas = s.enviada + entregues;
  return {
    total: Object.values(s).reduce((a, b) => a + b, 0),
    porStatus,
    funil: { fila: s.fila + s.enviando, enviadas, entregues, lidas, responderam: s.respondeu, falharam: s.falhou, descadastraram: s.descadastrou, puladas: s.pulada },
  };
}

/** Na criação, o ritmo começa nos padrões seguros de cada API (a tela pode mudar). */
function padroesDoCanal(canal: CanalTransmissao, e: Envio, bruto: unknown): Envio {
  const dado = (bruto as { envio?: Record<string, unknown> } | null)?.envio ?? {};
  const out = { ...e };
  if (canal === 'oficial' && dado.limiteDia === undefined) out.limiteDia = LIMITES.oficial.limiteDia;
  if (canal === 'nao_oficial' && dado.limiteDia === undefined) out.limiteDia = LIMITES.nao_oficial.limiteDia;
  return out;
}

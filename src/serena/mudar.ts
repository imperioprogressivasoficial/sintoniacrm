import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import { nomeOuTelefone } from '../contatos/nome.js';
import { dataISO, deDataEHora, partesBahia } from '../util/tempo.js';
import { unidadeDe } from '../unidades.js';
import type { Artefato, ResultadoFerramenta } from './acoes.js';
import type { Chamar, MetodoHttp } from './ler.js';

/**
 * serena-super: o que a Serena MUDA no CRM além de enviar/agendar/mover (src/serena/fazer.ts), sempre com cartão
 * e "Confirmar":
 * - criar tarefa para alguém (Rotina), marcar/tirar etiqueta, transferir a conversa, agendar mensagem,
 *   sugerir mudança no treinamento da IA (com antes/depois), rascunho de transmissão, pausar/religar a Serena
 *   (só a gestão) e criar/renomear pipeline e etapa.
 * - A ferramenta "mostrar_…" confere (com as rotas de leitura de sempre) e só devolve o cartão. NADA muda aqui.
 * - No "Confirmar" (POST /api/serena/confirmar, tipo "mudar"), o servidor confere os dados de novo com o MESMO
 *   esquema daqui e chama a rota da tela com o login de quem pediu (as permissões e conferências de sempre
 *   valem de novo). Só as rotas desta lista: o cartão nunca escolhe um endereço. Tudo vai para a auditoria.
 */

const Id = z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/, 'id inválido');
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const Hora = z.string().regex(/^\d{1,2}:\d{2}$/, 'use HH:mm');
const seg = (s: string) => encodeURIComponent(s);

/** O que cada mudança faz no Confirmar: os dados aceitos e a rota chamada (só estas). */
export const MUDANCAS = {
  tarefa: {
    Dados: z.object({
      titulo: z.string().trim().min(2).max(140),
      descricao: z.string().trim().max(2000).default(''),
      venceEm: z.string().datetime({ offset: true }).nullable().default(null),
      responsavelId: Id.optional(),
      conversaId: Id.nullable().optional(),
      prioridade: z.enum(['baixa', 'normal', 'alta']).default('normal'),
    }),
    pedidos: (d: { titulo: string; descricao: string; venceEm: string | null; responsavelId?: string; conversaId?: string | null; prioridade: string }) => [
      { metodo: 'POST' as MetodoHttp, url: '/api/rotina/tarefas', corpo: { titulo: d.titulo, descricao: d.descricao, venceEm: d.venceEm, prioridade: d.prioridade, ...(d.responsavelId ? { responsavelId: d.responsavelId } : {}), ...(d.conversaId ? { conversaId: d.conversaId } : {}) } },
    ],
    feito: () => 'Tarefa criada ✓ (aparece na Rotina).',
    conversas: (d: { conversaId?: string | null }) => (d.conversaId ? [d.conversaId] : []),
  },
  etiqueta: {
    Dados: z.object({ acao: z.enum(['marcar', 'tirar']), tagId: Id, conversas: z.array(Id).min(1).max(50) }),
    pedidos: (d: { acao: 'marcar' | 'tirar'; tagId: string; conversas: string[] }) =>
      d.conversas.map((c) => (d.acao === 'marcar' ? { metodo: 'POST' as MetodoHttp, url: `/api/conversas/${seg(c)}/tags`, corpo: { tagId: d.tagId } } : { metodo: 'DELETE' as MetodoHttp, url: `/api/conversas/${seg(c)}/tags/${seg(d.tagId)}` })),
    feito: (d: { acao: string; conversas: string[] }) => `${d.acao === 'marcar' ? 'Etiqueta marcada' : 'Etiqueta tirada'} ✓ em ${d.conversas.length} conversa${d.conversas.length === 1 ? '' : 's'}.`,
    conversas: (d: { conversas: string[] }) => d.conversas,
  },
  transferir: {
    Dados: z.object({ conversaId: Id, usuarioId: Id.nullable() }),
    pedidos: (d: { conversaId: string; usuarioId: string | null }) => [{ metodo: 'POST' as MetodoHttp, url: `/api/conversas/${seg(d.conversaId)}/transferir`, corpo: { usuarioId: d.usuarioId } }],
    feito: (d: { usuarioId: string | null }) => (d.usuarioId ? 'Conversa transferida ✓' : 'Conversa liberada ✓ (fica sem dona).'),
    conversas: (d: { conversaId: string }) => [d.conversaId],
  },
  mensagem_agendada: {
    Dados: z.object({ conversaId: Id, texto: z.string().trim().min(1).max(4000), data: Data, hora: Hora }),
    pedidos: (d: { conversaId: string; texto: string; data: string; hora: string }) => [{ metodo: 'POST' as MetodoHttp, url: `/api/conversas/${seg(d.conversaId)}/agendadas`, corpo: { texto: d.texto, data: d.data, hora: d.hora.padStart(5, '0') } }],
    feito: (d: { data: string; hora: string }) => `Mensagem agendada ✓ para ${d.data.split('-').reverse().join('/')} às ${d.hora.padStart(5, '0')}.`,
    conversas: (d: { conversaId: string }) => [d.conversaId],
  },
  treinamento: {
    Dados: z.object({ chave: z.string().trim().min(1).max(120).nullable(), titulo: z.string().trim().min(1).max(80), conteudo: z.string().max(20_000) }),
    pedidos: (d: { chave: string | null; titulo: string; conteudo: string }) => [
      d.chave ? { metodo: 'PUT' as MetodoHttp, url: `/api/ia/base/${seg(d.chave)}`, corpo: { titulo: d.titulo, conteudo: d.conteudo } } : { metodo: 'POST' as MetodoHttp, url: '/api/ia/base', corpo: { titulo: d.titulo, conteudo: d.conteudo } },
    ],
    feito: (d: { chave: string | null; titulo: string }) => (d.chave ? `Treinamento atualizado ✓ (${d.titulo}). Vale a partir da próxima conversa.` : `Seção "${d.titulo}" criada no treinamento ✓`),
    conversas: () => [],
  },
  transmissao: {
    Dados: z.object({ nome: z.string().trim().min(1).max(80), unidade: z.string().trim().min(1).max(60), texto: z.string().trim().min(1).max(4000), tags: z.array(Id).max(20).default([]), conversas: z.array(z.string().uuid()).max(5000).default([]) }),
    pedidos: (d: { nome: string; unidade: string; texto: string; tags: string[]; conversas: string[] }) => [
      { metodo: 'POST' as MetodoHttp, url: '/api/transmissoes', corpo: { nome: d.nome, unidade: d.unidade, canal: 'nao_oficial', modo: 'manual', publico: { tags: d.tags, conversas: d.conversas, origemLista: 'Serena', excluirRecebeuDias: 7, excluirConversaAberta: true }, mensagem: { texto: d.texto } } },
    ],
    feito: () => 'Rascunho de transmissão criado ✓ Nada foi enviado: revise e inicie em Transmissões.',
    conversas: () => [],
  },
  pausa_serena: {
    Dados: z.union([
      z.object({ pausada: z.literal(false) }),
      z.object({ pausada: z.literal(true), duracao: z.enum(['1h', 'amanha', 'indefinido']), motivo: z.string().trim().max(200).optional() }),
    ]),
    pedidos: (d: { pausada: boolean; duracao?: string; motivo?: string }) => [{ metodo: 'PUT' as MetodoHttp, url: '/api/ia/pausa', corpo: d.pausada ? { pausada: true, duracao: d.duracao, ...(d.motivo ? { motivo: d.motivo } : {}) } : { pausada: false } }],
    feito: (d: { pausada: boolean; duracao?: string }) => (d.pausada ? `Serena pausada ✓ (${{ '1h': 'por 1 hora', amanha: 'até amanhã', indefinido: 'até alguém religar' }[d.duracao ?? 'indefinido']}). A equipe responde as clientes.` : 'Serena ligada de novo ✓ Ela volta a atender as clientes.'),
    conversas: () => [],
  },
  funil: {
    Dados: z.discriminatedUnion('operacao', [
      z.object({ operacao: z.literal('criar_funil'), nome: z.string().trim().min(1).max(80), etapas: z.array(z.string().trim().min(1).max(60)).max(30).default([]) }),
      z.object({ operacao: z.literal('renomear_funil'), funilId: Id, nome: z.string().trim().min(1).max(80) }),
      z.object({ operacao: z.literal('criar_etapa'), funilId: Id, nome: z.string().trim().min(1).max(60) }),
      z.object({ operacao: z.literal('renomear_etapa'), funilId: Id, etapaId: Id, nome: z.string().trim().min(1).max(60) }),
    ]),
    pedidos: (d: { operacao: string; nome: string; etapas?: string[]; funilId?: string; etapaId?: string }) => {
      if (d.operacao === 'criar_funil') return [{ metodo: 'POST' as MetodoHttp, url: '/api/funis', corpo: { nome: d.nome, etapas: (d.etapas ?? []).map((nome) => ({ nome })) } }];
      if (d.operacao === 'renomear_funil') return [{ metodo: 'PATCH' as MetodoHttp, url: `/api/funis/${seg(d.funilId!)}`, corpo: { nome: d.nome } }];
      if (d.operacao === 'criar_etapa') return [{ metodo: 'POST' as MetodoHttp, url: `/api/funis/${seg(d.funilId!)}/etapas`, corpo: { nome: d.nome } }];
      return [{ metodo: 'PATCH' as MetodoHttp, url: `/api/funis/${seg(d.funilId!)}/etapas/${seg(d.etapaId!)}`, corpo: { nome: d.nome } }];
    },
    feito: (d: { operacao: string; nome: string }) => ({ criar_funil: `Pipeline "${d.nome}" criado ✓`, renomear_funil: `Pipeline renomeado para "${d.nome}" ✓`, criar_etapa: `Etapa "${d.nome}" criada ✓`, renomear_etapa: `Etapa renomeada para "${d.nome}" ✓` })[d.operacao] ?? 'Feito ✓',
    conversas: () => [],
  },
} as const;
export type AcaoMudar = keyof typeof MUDANCAS;
export const ACOES_MUDAR = Object.keys(MUDANCAS) as AcaoMudar[];

/** Quem pode o quê (as rotas conferem de novo no Confirmar). */
export interface PodeMudar {
  /** Gerência, direção, administração. */
  gestao: boolean;
  transmissoes: boolean;
  /** Treinar a IA (Agente de IA). */
  treinar: boolean;
}

/** Linha do cartão (rótulo: valor). */
type Linha = { rotulo: string; valor: string };

export interface DadosMudar {
  acao: AcaoMudar;
  params: Record<string, unknown>;
  linhas: Linha[];
  /** Treinamento: o antes e o depois da seção. */
  antes?: string | null;
  depois?: string | null;
  /** Rótulo do botão. */
  botao: string;
  /** Tela para abrir depois. */
  abrir?: string | null;
}

type Ferramenta = Anthropic.Beta.Messages.BetaTool;

const PREVIA = (o: string) =>
  `Cartão mostrado à pessoa com os botões Confirmar e Cancelar. NADA foi feito ainda: só acontece se a pessoa clicar em Confirmar. Agora, em uma ou duas frases, diga o que preparou (${o}) e peça para conferir e confirmar. Nunca diga que já fez.`;

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const quandoTxt = (data: string, hora: string) => {
  const p = partesBahia(deDataEHora(data, hora.padStart(5, '0')));
  return `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][p.diaSemana]} ${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} às ${hora.padStart(5, '0')}`;
};

export interface FontesMudar {
  chamar: Chamar;
  conversas: () => Promise<Conversa[]>;
  agora: () => Date;
}

export class MudarSerena {
  constructor(
    private readonly f: FontesMudar,
    private readonly pode: PodeMudar,
    private readonly guardar: (a: Omit<Artefato, 'id'>) => Artefato,
  ) {}

  static readonly NOMES = new Set(['mostrar_tarefa', 'mostrar_etiqueta_conversa', 'mostrar_transferir', 'mostrar_mensagem_agendada', 'mostrar_treinamento', 'mostrar_transmissao', 'mostrar_pausa_serena', 'mostrar_funil']);

  regras(): string[] {
    const faz = ['criar tarefa para alguém (Rotina)', 'marcar ou tirar etiqueta de conversas', 'transferir conversa', 'agendar mensagem'];
    const nao: string[] = [];
    if (this.pode.treinar) faz.push('sugerir mudança no treinamento da IA (com o antes e o depois)');
    else nao.push('mudar o treinamento da IA');
    if (this.pode.gestao && this.pode.transmissoes) faz.push('montar rascunho de transmissão (nunca envia sozinho)');
    else nao.push('criar transmissão');
    if (this.pode.gestao) faz.push('pausar e religar a Serena que atende as clientes', 'criar e renomear pipelines e etapas');
    else nao.push('pausar a Serena', 'criar ou mudar pipelines');
    return [`Você também pode (sempre com cartão e Confirmar): ${faz.join('; ')}.`, nao.length ? `Esta pessoa NÃO pode: ${nao.join('; ')} (só a gestão). Se pedir, explique com gentileza.` : ''].filter(Boolean);
  }

  ferramentas(): Ferramenta[] {
    const f: Ferramenta[] = [
      {
        name: 'mostrar_tarefa',
        description: 'Cartão "Criar tarefa" (Rotina) para alguém da equipe (ou para a própria pessoa), opcionalmente ligada a uma conversa, com prazo. NÃO cria: só a pessoa confirma.',
        input_schema: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'O que fazer (até 140 letras)' },
            descricao: { type: ['string', 'null'] },
            responsavel: { type: ['string', 'null'], description: 'Nome de quem vai fazer (vazio = a própria pessoa)' },
            conversa_id: { type: ['string', 'null'] },
            data: { type: ['string', 'null'], description: 'Prazo AAAA-MM-DD' },
            hora: { type: ['string', 'null'], description: 'HH:mm (padrão 18:00)' },
            prioridade: { type: ['string', 'null'], enum: ['baixa', 'normal', 'alta', null] },
          },
          required: ['titulo'],
          additionalProperties: false,
        },
      },
      {
        name: 'mostrar_etiqueta_conversa',
        description: 'Cartão para marcar ou tirar uma etiqueta (ou etapa do pipeline, que também é etiqueta) de uma ou mais conversas (até 50). Use conversa_id de buscar_leads/buscar_clientes. NÃO marca: só a pessoa confirma.',
        input_schema: {
          type: 'object',
          properties: {
            acao: { type: 'string', enum: ['marcar', 'tirar'] },
            etiqueta: { type: 'string', description: 'Nome da etiqueta' },
            conversas: { type: 'array', items: { type: 'string' }, description: 'conversa_id de cada uma' },
          },
          required: ['acao', 'etiqueta', 'conversas'],
          additionalProperties: false,
        },
      },
      {
        name: 'mostrar_transferir',
        description: 'Cartão para transferir uma conversa para outra pessoa da equipe (ou liberar, sem dona). Confere quem pode receber. NÃO transfere: só a pessoa confirma.',
        input_schema: {
          type: 'object',
          properties: { conversa_id: { type: 'string' }, para: { type: ['string', 'null'], description: 'Nome de quem recebe; null = liberar (fica sem dona)' } },
          required: ['conversa_id'],
          additionalProperties: false,
        },
      },
      {
        name: 'mostrar_mensagem_agendada',
        description: 'Cartão para agendar uma mensagem para uma cliente num dia e hora (sai sozinha, pelo número da loja, com o nome de quem agendou). NÃO agenda: só a pessoa confirma. Mensagem curta, no jeito de WhatsApp, sem inventar preço ou horário.',
        input_schema: {
          type: 'object',
          properties: { conversa_id: { type: 'string' }, texto: { type: 'string' }, data: { type: 'string', description: 'AAAA-MM-DD' }, hora: { type: 'string', description: 'HH:mm (horário da Bahia)' } },
          required: ['conversa_id', 'texto', 'data', 'hora'],
          additionalProperties: false,
        },
      },
    ];
    if (this.pode.treinar)
      f.push({
        name: 'mostrar_treinamento',
        description:
          'Cartão com a SUGESTÃO de mudança no treinamento da IA (Agente de IA › Treinamento): mostra o antes e o depois da seção. Para mudar uma seção que existe, passe o título dela e o texto NOVO INTEIRO da seção. Para criar uma seção nova, use um título que ainda não existe. NÃO muda: só a pessoa confirma.',
        input_schema: {
          type: 'object',
          properties: { secao: { type: 'string', description: 'Título da seção (existente ou nova)' }, conteudo: { type: 'string', description: 'O texto completo da seção, já com a mudança' } },
          required: ['secao', 'conteudo'],
          additionalProperties: false,
        },
      });
    if (this.pode.gestao && this.pode.transmissoes)
      f.push({
        name: 'mostrar_transmissao',
        description:
          'Cartão de RASCUNHO de transmissão (mensagem em massa) para revisar em Transmissões. Nunca envia: cria o rascunho e a pessoa revisa e inicia na tela. Público: por etiquetas (nomes) e/ou lista de conversa_id. Texto com {primeiro_nome}.',
        input_schema: {
          type: 'object',
          properties: {
            nome: { type: 'string', description: 'Nome da transmissão (até 80 letras)' },
            unidade: { type: 'string', description: 'Id da unidade (número que envia)' },
            texto: { type: 'string' },
            etiquetas: { type: ['array', 'null'], items: { type: 'string' } },
            conversas: { type: ['array', 'null'], items: { type: 'string' } },
          },
          required: ['nome', 'unidade', 'texto'],
          additionalProperties: false,
        },
      });
    if (this.pode.gestao)
      f.push(
        {
          name: 'mostrar_pausa_serena',
          description: 'Cartão para PAUSAR (por 1 hora, até amanhã ou até religar) ou RELIGAR a Serena que atende as clientes no WhatsApp. Pausada, a equipe responde. NÃO muda: só a pessoa confirma.',
          input_schema: {
            type: 'object',
            properties: { pausar: { type: 'boolean' }, duracao: { type: ['string', 'null'], enum: ['1h', 'amanha', 'indefinido', null] }, motivo: { type: ['string', 'null'] } },
            required: ['pausar'],
            additionalProperties: false,
          },
        },
        {
          name: 'mostrar_funil',
          description: 'Cartão para criar um pipeline (com etapas), renomear um pipeline, criar uma etapa ou renomear uma etapa. Ids de ver_funis. NÃO muda: só a pessoa confirma.',
          input_schema: {
            type: 'object',
            properties: {
              operacao: { type: 'string', enum: ['criar_funil', 'renomear_funil', 'criar_etapa', 'renomear_etapa'] },
              nome: { type: 'string', description: 'Nome novo (do pipeline ou da etapa)' },
              etapas: { type: ['array', 'null'], items: { type: 'string' }, description: 'Só em criar_funil: nomes das etapas, na ordem' },
              funil_id: { type: ['string', 'null'] },
              etapa_id: { type: ['string', 'null'] },
            },
            required: ['operacao', 'nome'],
            additionalProperties: false,
          },
        },
      );
    return f;
  }

  async executar(nome: string, entrada: unknown): Promise<ResultadoFerramenta> {
    try {
      switch (nome) {
        case 'mostrar_tarefa':
          return await this.tarefa(entrada);
        case 'mostrar_etiqueta_conversa':
          return await this.etiqueta(entrada);
        case 'mostrar_transferir':
          return await this.transferir(entrada);
        case 'mostrar_mensagem_agendada':
          return await this.agendada(entrada);
        case 'mostrar_treinamento':
          return await this.treinamento(entrada);
        case 'mostrar_transmissao':
          return await this.transmissao(entrada);
        case 'mostrar_pausa_serena':
          return this.pausa(entrada);
        case 'mostrar_funil':
          return await this.funil(entrada);
        default:
          return { conteudo: `Ferramenta desconhecida: ${nome}.`, erro: true };
      }
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`).join('; ') : e instanceof Error ? e.message : String(e);
      return { conteudo: `Não deu: ${msg} Corrija e tente de novo (ou explique à pessoa).`, erro: true };
    }
  }

  private cartao(acao: AcaoMudar, titulo: string, params: Record<string, unknown>, linhas: Array<Linha | null>, extra: Partial<DadosMudar> & { botao: string }) {
    // Confere já aqui com o mesmo esquema do Confirmar (se não passar aqui, não passaria lá).
    MUDANCAS[acao].Dados.parse(params);
    const dados: DadosMudar = { acao, params, linhas: linhas.filter((l): l is Linha => Boolean(l && l.valor)), ...extra };
    this.guardar({ tipo: 'mudar', acao: 'criar', alvoId: `${acao}:${titulo}`, titulo, dados: { ...dados } });
  }

  private async conversa(id: string): Promise<Conversa> {
    const c = (await this.f.conversas()).find((x) => x.id === id);
    if (!c) throw new Error('Conversa não encontrada entre as que esta pessoa pode ver. Use buscar_leads.');
    return c;
  }

  private async lerJson(url: string): Promise<{ status: number; corpo: unknown }> {
    return this.f.chamar('GET', url).catch(() => ({ status: 500, corpo: null }));
  }

  /** Pessoas da equipe (id e nome) que esta pessoa enxerga. */
  private async pessoas(): Promise<Array<{ id: string; nome: string }>> {
    const e = await this.lerJson('/api/equipe');
    if (e.status === 200) return ((e.corpo as { pessoas?: Array<{ id: string; nome: string; ativo?: boolean }> })?.pessoas ?? []).filter((p) => p.ativo !== false);
    const c = await this.lerJson('/api/equipe/chat/pessoas');
    return c.status === 200 ? ((c.corpo as { pessoas?: Array<{ id: string; nome: string }> })?.pessoas ?? []) : [];
  }

  private acharPessoa<T extends { nome: string }>(lista: T[], nome: string): T {
    const n = sem(nome);
    const exata = lista.find((x) => sem(x.nome) === n);
    if (exata) return exata;
    const parecidas = lista.filter((x) => sem(x.nome).includes(n) || sem(x.nome).split(/\s+/)[0] === n.split(/\s+/)[0]);
    if (parecidas.length === 1) return parecidas[0]!;
    if (parecidas.length > 1) throw new Error(`Mais de uma pessoa com "${nome}": ${parecidas.map((x) => x.nome).join(', ')}. Pergunte qual.`);
    throw new Error(`Não achei "${nome}" entre quem pode receber. Pessoas: ${lista.slice(0, 20).map((x) => x.nome).join(', ') || '(nenhuma)'}.`);
  }

  private async tarefa(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z
      .object({
        titulo: z.string().trim().min(2).max(140),
        descricao: z.string().trim().max(2000).nullish(),
        responsavel: z.string().trim().max(80).nullish(),
        conversa_id: z.string().trim().max(100).nullish(),
        data: Data.nullish(),
        hora: Hora.nullish(),
        prioridade: z.enum(['baixa', 'normal', 'alta']).nullish(),
      })
      .parse(entrada);
    let resp: { id: string; nome: string } | undefined;
    if (b.responsavel) resp = this.acharPessoa(await this.pessoas(), b.responsavel);
    const c = b.conversa_id ? await this.conversa(b.conversa_id) : undefined;
    let venceEm: string | null = null;
    if (b.data) {
      const quando = deDataEHora(b.data, (b.hora ?? '18:00').padStart(5, '0'));
      if (quando.getTime() < this.f.agora().getTime()) throw new Error(`O prazo já passou (hoje é ${dataISO(this.f.agora())}).`);
      venceEm = quando.toISOString();
    }
    const params = { titulo: b.titulo, descricao: b.descricao ?? '', venceEm, prioridade: b.prioridade ?? 'normal', ...(resp ? { responsavelId: resp.id } : {}), ...(c ? { conversaId: c.id } : {}) };
    this.cartao('tarefa', b.titulo, params, [
      { rotulo: 'Para', valor: resp?.nome ?? 'Você' },
      { rotulo: 'Prazo', valor: b.data ? quandoTxt(b.data, b.hora ?? '18:00') : 'Sem prazo' },
      { rotulo: 'Prioridade', valor: { baixa: 'Baixa', normal: 'Normal', alta: 'Alta' }[params.prioridade] },
      c ? { rotulo: 'Cliente', valor: nomeOuTelefone(c.nome, c.telefone) } : null,
      b.descricao ? { rotulo: 'Detalhe', valor: b.descricao } : null,
    ], { botao: 'Confirmar e criar', abrir: 'rotina' });
    return { conteudo: PREVIA(`tarefa "${b.titulo}" para ${resp?.nome ?? 'a própria pessoa'}`) };
  }

  private async etiqueta(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ acao: z.enum(['marcar', 'tirar']), etiqueta: z.string().trim().min(1).max(80), conversas: z.array(z.string().trim().max(100)).min(1).max(50) }).parse(entrada);
    const r = await this.lerJson('/api/tags');
    if (r.status !== 200) throw new Error('não deu para ler as etiquetas');
    const lista = (Array.isArray(r.corpo) ? r.corpo : ((r.corpo as { tags?: unknown[] })?.tags ?? [])) as Array<{ id: string; nome: string; funilId?: string | null }>;
    const alvo = sem(b.etiqueta);
    const tag = lista.find((t) => sem(t.nome) === alvo) ?? lista.find((t) => sem(t.nome).includes(alvo));
    if (!tag) throw new Error(`não existe a etiqueta "${b.etiqueta}". Existentes: ${lista.slice(0, 40).map((t) => t.nome).join(', ') || '(nenhuma)'}. Se for nova, ofereça criar com mostrar_etiqueta.`);
    const visiveis = new Map((await this.f.conversas()).map((c) => [c.id, c]));
    const ids = [...new Set(b.conversas)].filter((id) => visiveis.has(id));
    if (!ids.length) throw new Error('nenhuma dessas conversas está entre as que esta pessoa pode ver. Use buscar_leads.');
    const nomes = ids.map((id) => nomeOuTelefone(visiveis.get(id)!.nome, visiveis.get(id)!.telefone));
    const titulo = `${b.acao === 'marcar' ? 'Marcar' : 'Tirar'} "${tag.nome}" ${ids.length === 1 ? `em ${nomes[0]}` : `em ${ids.length} conversas`}`;
    this.cartao('etiqueta', titulo, { acao: b.acao, tagId: tag.id, conversas: ids }, [
      { rotulo: tag.funilId ? 'Etapa' : 'Etiqueta', valor: tag.nome },
      { rotulo: ids.length === 1 ? 'Conversa' : 'Conversas', valor: nomes.slice(0, 8).join(', ') + (nomes.length > 8 ? ` e mais ${nomes.length - 8}` : '') },
    ], { botao: b.acao === 'marcar' ? 'Confirmar e marcar' : 'Confirmar e tirar' });
    return { conteudo: PREVIA(`${b.acao} a etiqueta "${tag.nome}" em ${ids.length} conversa(s)`) };
  }

  private async transferir(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ conversa_id: z.string().trim().max(100), para: z.string().trim().max(80).nullish() }).parse(entrada);
    const c = await this.conversa(b.conversa_id);
    const r = await this.lerJson(`/api/conversas/${seg(c.id)}/transferir`);
    if (r.status === 403 || r.status === 401) throw new Error('esta pessoa não pode transferir esta conversa (só a dona ou a gerência). Explique com gentileza.');
    if (r.status !== 200) throw new Error('não deu para ver quem pode receber agora');
    const opcoes = (r.corpo as Array<{ id: string; nome: string; dona?: boolean }>) ?? [];
    const alvo = b.para ? this.acharPessoa(opcoes, b.para) : null;
    if (alvo?.dona) throw new Error(`${alvo.nome} já é a dona desta conversa.`);
    const nome = nomeOuTelefone(c.nome, c.telefone);
    this.cartao('transferir', alvo ? `Transferir ${nome} para ${alvo.nome}` : `Liberar ${nome} (sem dona)`, { conversaId: c.id, usuarioId: alvo?.id ?? null }, [
      { rotulo: 'Cliente', valor: nome },
      { rotulo: 'Unidade', valor: unidadeDe(c.unidade).nome },
      { rotulo: 'Dona hoje', valor: c.responsavelNome ?? 'Sem dona' },
      { rotulo: 'Passa para', valor: alvo?.nome ?? 'Ninguém (fila)' },
    ], { botao: alvo ? 'Confirmar e transferir' : 'Confirmar e liberar' });
    return { conteudo: PREVIA(alvo ? `transferir ${nome} para ${alvo.nome}` : `liberar ${nome}`) };
  }

  private async agendada(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ conversa_id: z.string().trim().max(100), texto: z.string().trim().min(1).max(4000), data: Data, hora: Hora }).parse(entrada);
    const c = await this.conversa(b.conversa_id);
    if (deDataEHora(b.data, b.hora.padStart(5, '0')).getTime() <= this.f.agora().getTime() + 60_000) throw new Error('esse horário já passou: escolha um horário de agora em diante.');
    const nome = nomeOuTelefone(c.nome, c.telefone);
    this.cartao('mensagem_agendada', `Agendar mensagem para ${nome}`, { conversaId: c.id, texto: b.texto, data: b.data, hora: b.hora.padStart(5, '0') }, [
      { rotulo: 'Cliente', valor: nome },
      { rotulo: 'Quando', valor: quandoTxt(b.data, b.hora) },
      { rotulo: 'Mensagem', valor: b.texto },
    ], { botao: 'Confirmar e agendar', abrir: 'agendadas' });
    return { conteudo: PREVIA(`mensagem para ${nome} em ${quandoTxt(b.data, b.hora)}`) };
  }

  private async treinamento(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ secao: z.string().trim().min(1).max(80), conteudo: z.string().trim().min(1).max(20_000) }).parse(entrada);
    const r = await this.lerJson('/api/ia/base');
    if (r.status === 403 || r.status === 401) throw new Error('esta pessoa não pode mudar o treinamento (só a gestão).');
    if (r.status !== 200) throw new Error('o treinamento não está ligado aqui');
    const secoes = ((r.corpo as { secoes?: Array<{ chave: string; titulo: string; conteudo: string }> })?.secoes ?? []);
    const alvo = sem(b.secao);
    const s = secoes.find((x) => sem(x.titulo) === alvo) ?? secoes.find((x) => sem(x.titulo).includes(alvo));
    if (s && s.conteudo.trim() === b.conteudo.trim()) throw new Error('o texto novo é igual ao que já está lá.');
    this.cartao('treinamento', s ? `Mudar o treinamento: ${s.titulo}` : `Nova seção no treinamento: ${b.secao}`, { chave: s?.chave ?? null, titulo: s?.titulo ?? b.secao, conteudo: b.conteudo }, [{ rotulo: 'Seção', valor: s?.titulo ?? `${b.secao} (nova)` }], {
      botao: 'Confirmar mudança',
      antes: s ? s.conteudo.slice(0, 6000) : null,
      depois: b.conteudo.slice(0, 6000),
      abrir: 'ia',
    });
    return { conteudo: PREVIA(s ? `mudança na seção "${s.titulo}" do treinamento` : `seção nova "${b.secao}" no treinamento`) };
  }

  private async transmissao(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ nome: z.string().trim().min(1).max(80), unidade: z.string().trim().min(1).max(60), texto: z.string().trim().min(1).max(4000), etiquetas: z.array(z.string().trim().max(80)).max(20).nullish(), conversas: z.array(z.string().trim().max(100)).max(5000).nullish() }).parse(entrada);
    const tags: Array<{ id: string; nome: string }> = [];
    if (b.etiquetas?.length) {
      const r = await this.lerJson('/api/tags');
      const lista = (Array.isArray(r.corpo) ? r.corpo : ((r.corpo as { tags?: unknown[] })?.tags ?? [])) as Array<{ id: string; nome: string }>;
      for (const e of b.etiquetas) {
        const t = lista.find((x) => sem(x.nome) === sem(e));
        if (!t) throw new Error(`não existe a etiqueta "${e}".`);
        tags.push(t);
      }
    }
    const visiveis = new Set((await this.f.conversas()).map((c) => c.id));
    const conversas = [...new Set(b.conversas ?? [])].filter((id) => visiveis.has(id));
    if (!tags.length && !conversas.length) throw new Error('diga o público: etiquetas e/ou a lista de conversas (de buscar_leads).');
    this.cartao('transmissao', `Rascunho: ${b.nome}`, { nome: b.nome, unidade: b.unidade, texto: b.texto, tags: tags.map((t) => t.id), conversas }, [
      { rotulo: 'Unidade', valor: unidadeDe(b.unidade).nome },
      tags.length ? { rotulo: 'Etiquetas', valor: tags.map((t) => t.nome).join(', ') } : null,
      conversas.length ? { rotulo: 'Lista', valor: `${conversas.length} conversa${conversas.length === 1 ? '' : 's'}` } : null,
      { rotulo: 'Mensagem', valor: b.texto },
      { rotulo: 'Envio', valor: 'Não sai nada agora: fica como rascunho em Transmissões' },
    ], { botao: 'Criar rascunho', abrir: 'transmissoes' });
    return { conteudo: PREVIA(`rascunho de transmissão "${b.nome}" (não envia)`) };
  }

  private pausa(entrada: unknown): ResultadoFerramenta {
    const b = z.object({ pausar: z.boolean(), duracao: z.enum(['1h', 'amanha', 'indefinido']).nullish(), motivo: z.string().trim().max(200).nullish() }).parse(entrada);
    if (!this.pode.gestao) throw new Error('só a gestão pausa ou religa a Serena.');
    const duracao = b.duracao ?? 'indefinido';
    const params = b.pausar ? { pausada: true as const, duracao, ...(b.motivo ? { motivo: b.motivo } : {}) } : { pausada: false as const };
    this.cartao('pausa_serena', b.pausar ? 'Pausar a Serena' : 'Religar a Serena', params, [
      { rotulo: 'O que muda', valor: b.pausar ? 'A Serena para de responder as clientes; a equipe responde' : 'A Serena volta a responder as clientes' },
      b.pausar ? { rotulo: 'Por quanto tempo', valor: { '1h': '1 hora', amanha: 'Até amanhã', indefinido: 'Até alguém religar' }[duracao] } : null,
      b.motivo ? { rotulo: 'Motivo', valor: b.motivo } : null,
    ], { botao: b.pausar ? 'Confirmar pausa' : 'Confirmar e religar' });
    return { conteudo: PREVIA(b.pausar ? 'pausar a Serena' : 'religar a Serena') };
  }

  private async funil(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z
      .object({ operacao: z.enum(['criar_funil', 'renomear_funil', 'criar_etapa', 'renomear_etapa']), nome: z.string().trim().min(1).max(80), etapas: z.array(z.string().trim().min(1).max(60)).max(30).nullish(), funil_id: z.string().trim().max(100).nullish(), etapa_id: z.string().trim().max(100).nullish() })
      .parse(entrada);
    if (!this.pode.gestao) throw new Error('só a gestão cria ou muda pipelines.');
    const r = await this.lerJson('/api/funis');
    const funis = (Array.isArray(r.corpo) ? r.corpo : []) as Array<{ id: string; nome: string; etapas?: Array<{ id: string; nome: string }> }>;
    if (b.operacao === 'criar_funil') {
      if (funis.some((f) => sem(f.nome) === sem(b.nome))) throw new Error(`já existe um pipeline "${b.nome}".`);
      const etapas = b.etapas ?? [];
      this.cartao('funil', `Criar pipeline "${b.nome}"`, { operacao: 'criar_funil', nome: b.nome, etapas }, [{ rotulo: 'Pipeline', valor: b.nome }, { rotulo: 'Etapas', valor: etapas.join(' → ') || 'As etapas padrão' }], { botao: 'Confirmar e criar', abrir: 'funil' });
      return { conteudo: PREVIA(`pipeline "${b.nome}"`) };
    }
    const funil = funis.find((f) => f.id === b.funil_id);
    if (!funil) throw new Error('esse pipeline não existe. Use ver_funis.');
    if (b.operacao === 'renomear_funil') {
      this.cartao('funil', `Renomear pipeline "${funil.nome}"`, { operacao: 'renomear_funil', funilId: funil.id, nome: b.nome }, [{ rotulo: 'Era', valor: funil.nome }, { rotulo: 'Fica', valor: b.nome }], { botao: 'Confirmar', abrir: 'funil' });
      return { conteudo: PREVIA(`renomear o pipeline para "${b.nome}"`) };
    }
    if (b.operacao === 'criar_etapa') {
      if ((funil.etapas ?? []).some((e) => sem(e.nome) === sem(b.nome))) throw new Error(`já existe a etapa "${b.nome}" em "${funil.nome}".`);
      this.cartao('funil', `Nova etapa em "${funil.nome}"`, { operacao: 'criar_etapa', funilId: funil.id, nome: b.nome }, [{ rotulo: 'Pipeline', valor: funil.nome }, { rotulo: 'Etapa nova', valor: b.nome }], { botao: 'Confirmar e criar', abrir: 'funil' });
      return { conteudo: PREVIA(`etapa "${b.nome}" em "${funil.nome}"`) };
    }
    const etapa = (funil.etapas ?? []).find((e) => e.id === b.etapa_id);
    if (!etapa) throw new Error(`essa etapa não existe em "${funil.nome}". Use ver_funis.`);
    this.cartao('funil', `Renomear etapa "${etapa.nome}"`, { operacao: 'renomear_etapa', funilId: funil.id, etapaId: etapa.id, nome: b.nome }, [{ rotulo: 'Pipeline', valor: funil.nome }, { rotulo: 'Era', valor: etapa.nome }, { rotulo: 'Fica', valor: b.nome }], { botao: 'Confirmar', abrir: 'funil' });
    return { conteudo: PREVIA(`renomear a etapa para "${b.nome}"`) };
  }
}

// ---------------------------------------------------------------- Confirmar (rota)

/** Aplica uma mudança confirmada: confere os dados de novo e chama a(s) rota(s) da lista, como a pessoa. */
export async function aplicarMudanca(chamar: Chamar, bruto: unknown): Promise<{ acao: AcaoMudar; params: Record<string, unknown>; resumo: string; falhas: string[]; conversas: string[] }> {
  const { acao, params } = z.object({ acao: z.enum(ACOES_MUDAR as [AcaoMudar, ...AcaoMudar[]]), params: z.unknown() }).parse(bruto);
  const m = MUDANCAS[acao];
  const d = m.Dados.parse(params) as never;
  const pedidos = (m.pedidos as (x: never) => Array<{ metodo: MetodoHttp; url: string; corpo?: unknown }>)(d);
  const falhas: string[] = [];
  let ok = 0;
  for (const p of pedidos) {
    const r = await chamar(p.metodo, p.url, p.corpo);
    if (r.status >= 200 && r.status < 300) ok++;
    else falhas.push(String((r.corpo as { erro?: string; message?: string } | null)?.erro ?? (r.corpo as { message?: string } | null)?.message ?? `erro ${r.status}`));
    // Uma só e falhou: o motivo volta direto (ex.: sem permissão).
    if (pedidos.length === 1 && falhas.length) {
      const st = r.status === 401 || r.status === 403 ? 403 : r.status === 404 ? 404 : r.status >= 500 ? 424 : 409;
      throw Object.assign(new Error(falhas[0]!), { statusCode: st });
    }
  }
  if (!ok) throw Object.assign(new Error(`Não deu: ${falhas[0] ?? 'nada mudou'}`), { statusCode: 409 });
  const resumo = `${(m.feito as (x: never) => string)(d)}${falhas.length ? ` ${falhas.length} não deu (${falhas[0]}).` : ''}`;
  return { acao, params: d as Record<string, unknown>, resumo, falhas, conversas: (m.conversas as (x: never) => string[])(d) };
}

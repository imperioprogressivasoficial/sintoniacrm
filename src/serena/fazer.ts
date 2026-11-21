import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ETAPAS, NOME_ETAPA, type Conversa } from '../domain.js';
import { agendaDaUnidade, horariosLivres } from '../agenda/agendar.js';
import { NOMES_SISTEMA, type FonteAgenda } from '../agenda/sistema.js';
import type { ServicosCrmIa } from '../ai/crm-ia.js';
import { executarFerramenta, novaSessao } from '../ai/ferramentas.js';
import { dataValida } from '../ai/guarda.js';
import { nomeOuTelefone } from '../contatos/nome.js';
import { unidadeDe, unidadesComAgenda } from '../unidades.js';
import { dataISO, DIA, deDataEHora, partesBahia } from '../util/tempo.js';
import type { Artefato, ResultadoFerramenta } from './acoes.js';

/**
 * serena-faz: a Serena da tela (chat da equipe) também FAZ, como uma gerente de vendas que trabalha:
 * - manda mensagem para clientes (uma ou várias), com a lista e o texto montados aqui;
 * - agenda, remarca e cancela na agenda do salão (as mesmas funções da IA do WhatsApp);
 * - move conversas no funil/pipeline (com o motivo da perda quando é etapa de perda);
 * - lê preços e durações do cadastro (Produtos e serviços) e do sistema de agenda, dizendo de onde veio.
 * Aqui NADA é feito: as ferramentas "mostrar_…" só conferem e devolvem um cartão (artefato) com
 * "Confirmar"/"Cancelar". Quem faz é a rota POST /api/serena/confirmar (src/serena/confirmar.ts), depois
 * do clique, conferindo tudo de novo com as permissões de quem pediu.
 * As listas de clientes só trazem o que a pessoa pode ver (escopo/podeVer, já aplicado em `conversas`).
 */

/** Até quantas clientes o envio sai direto (uma a uma, com intervalo). Acima disso, vira transmissão. */
export const LIMITE_DIRETO = 20;
/** Máximo de clientes num cartão de envio. */
export const LIMITE_ENVIO = 500;
/** Máximo de conversas num cartão de mover. */
export const LIMITE_MOVER = 200;

/** O que esta pessoa pode pedir à Serena (a rota de confirmar confere de novo). */
export interface PodeFazer {
  /** Mandar mensagem para clientes (permissão "Responder"). */
  enviar: boolean;
  /** Mandar para várias de uma vez (gestão). */
  enviarVarias: boolean;
  /** Mais de 20: vira transmissão (permissão "Transmissões"). */
  transmitir: boolean;
  /** Mover no funil (permissão "Mover etapas"). */
  mover: boolean;
  /** Mover várias de uma vez (gestão). */
  moverVarias: boolean;
}

export interface FontesFazer {
  /** Conversas que a pessoa pode ver (já filtradas). */
  conversas: () => Promise<Conversa[]>;
  /** Agenda do salão (Trinks, Avec, AppBarber). Sem ela, a Serena não agenda. */
  agenda?: FonteAgenda;
  /** Pipelines, motivos de perda e produtos do cadastro. */
  crm?: Pick<ServicosCrmIa, 'funis' | 'motivosPerda' | 'produtos'>;
  /** Pediu para não receber mensagens em massa (SAIR/PARAR). */
  descadastrado?: (telefone: string) => Promise<boolean>;
  agora: () => Date;
  /** Quanto esperar a agenda (padrão 25 s). */
  prazoAgendaMs?: number;
}

type Ferramenta = Anthropic.Beta.Messages.BetaTool;
const PREVIA = (o: string) =>
  `Cartão mostrado à pessoa com os botões Confirmar e Cancelar. NADA foi feito ainda: só acontece se a pessoa clicar em Confirmar. Agora, em uma ou duas frases, diga o que preparou (${o}) e peça para ela conferir e confirmar no cartão. Nunca diga que já enviou, agendou ou moveu.`;

const nomeDe = (c: Conversa) => nomeOuTelefone(c.nome, c.telefone);
const primeiro = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] ?? '';
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "sáb 22/11 14h" ou "sáb 22/11 14h30". */
export function quandoCurto(data: string, hora: string): string {
  const d = deDataEHora(data, hora.padStart(5, '0'));
  const p = partesBahia(d);
  const h = p.minuto ? `${p.hora}h${String(p.minuto).padStart(2, '0')}` : `${p.hora}h`;
  return `${DIAS_CURTOS[p.diaSemana]} ${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} ${h}`;
}

/** Última atividade da conversa (qualquer lado). */
const ultimaAtividade = (c: Conversa) =>
  Math.max(c.ultimaMensagemCliente?.getTime() ?? 0, c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0) || c.atualizadaEm.getTime();
const ultimaDe = (c: Conversa): 'cliente' | 'loja' | null => {
  const cli = c.ultimaMensagemCliente?.getTime() ?? 0;
  const loja = Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
  if (!cli && !loja) return null;
  return cli > loja ? 'cliente' : 'loja';
};
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, falha) => {
    const t = setTimeout(() => falha(new Error('A agenda do salão demorou demais para responder. Tente de novo em instantes.')), ms);
    (t as { unref?: () => void }).unref?.();
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      (e) => (clearTimeout(t), falha(e)),
    );
  });
}

// ---------------------------------------------------------------- entradas

const Id = z.string().trim().min(1).max(100);
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD').refine(dataValida, 'essa data não existe no calendário');
const Hora = z.string().regex(/^\d{1,2}:\d{2}$/, 'use HH:mm');

const Busca = z.object({
  busca: z.string().trim().max(80).nullish(),
  parada_dias_min: z.number().int().min(0).max(3650).nullish(),
  parada_dias_max: z.number().int().min(0).max(3650).nullish(),
  ultima_de: z.enum(['cliente', 'loja']).nullish(),
  etapa: z.enum(ETAPAS).nullish(),
  unidade: z.string().trim().max(60).nullish(),
  limite: z.number().int().min(1).max(LIMITE_ENVIO).nullish(),
});

export const PedidoEnvio = z.object({
  conversas: z.array(z.object({ conversa_id: Id, texto: z.string().trim().max(4000).nullish() })).min(1, 'Escolha pelo menos uma cliente.').max(LIMITE_ENVIO, `No máximo ${LIMITE_ENVIO} clientes por vez.`),
  texto: z.string().trim().max(4000).nullish(),
  titulo: z.string().trim().max(80).nullish(),
});

const PedidoAgenda = z.object({
  acao: z.enum(['agendar', 'remarcar', 'cancelar']),
  conversa_id: Id,
  unidade: z.string().trim().min(1).max(60),
  servico_id: z.number().int().nullish(),
  profissional_id: z.number().int().nullish(),
  data: Data.nullish(),
  hora: Hora.nullish(),
  agendamento_id: z.number().int().nullish(),
  motivo: z.string().trim().max(300).nullish(),
  nome_cliente: z.string().trim().max(120).nullish(),
  ja_conferiu_agendamentos: z.boolean().nullish(),
});

const PedidoMover = z.object({
  conversas: z.array(Id).min(1, 'Escolha pelo menos uma conversa.').max(LIMITE_MOVER, `No máximo ${LIMITE_MOVER} conversas por vez.`),
  funil_id: Id,
  etapa_id: Id,
  motivo_perda_id: z.string().trim().max(60).nullish(),
  detalhe_perda: z.string().trim().max(300).nullish(),
});

// ---------------------------------------------------------------- dados dos cartões (o que a tela mostra e devolve ao confirmar)

export interface ItemEnvio {
  conversaId: string;
  nome: string;
  unidade: string;
  /** Texto só desta cliente (sem ele vale o texto geral). */
  texto?: string;
}
export interface DadosEnvio {
  /** Texto geral, com {primeiro_nome} e {nome}. */
  texto: string;
  itens: ItemEnvio[];
  /** Quem ficou de fora e por quê (pediu para sair, não encontrada). */
  fora: Array<{ nome: string; motivo: string }>;
  /** direto = uma a uma pelo caminho da equipe; transmissao = Transmissões (mais de 20). */
  modo: 'direto' | 'transmissao';
}

export interface DadosAgendamento {
  acao: 'agendar' | 'remarcar' | 'cancelar';
  conversaId: string;
  unidade: string;
  servicoId: number | null;
  profissionalId: number | null;
  data: string | null;
  hora: string | null;
  agendamentoId: number | null;
  motivo: string;
  nomeCliente: string;
  /** Manda a confirmação de sempre para a cliente (agendar/remarcar). */
  enviarConfirmacao: boolean;
  /** Para a tela: nomes e textos prontos. */
  resumo: { cliente: string; servico: string | null; profissional: string | null; quando: string | null; unidade: string; preco: number | null; antigo: string | null; fonte: string | null };
}

export interface DadosMover {
  funilId: string;
  etapaId: string;
  funil: string;
  etapa: string;
  perda: { motivo: string; motivoNome: string; detalhe: string | null } | null;
  itens: Array<{ conversaId: string; nome: string; unidade: string }>;
}

// ---------------------------------------------------------------- a classe

export class FazerSerena {
  private cacheConversas?: Promise<Conversa[]>;

  constructor(
    private readonly f: FontesFazer,
    private readonly pode: PodeFazer,
    /** Onde guardar os cartões (a lista do AcoesSerena). */
    private readonly guardar: (a: Omit<Artefato, 'id'>) => Artefato,
  ) {}

  /** Nomes das ferramentas desta parte (para o AcoesSerena saber a quem passar). */
  static readonly NOMES = new Set([
    'buscar_clientes',
    'ver_funis',
    'ver_produtos',
    'ver_servicos_agenda',
    'consultar_horarios',
    'ver_agendamentos_da_cliente',
    'mostrar_envio',
    'mostrar_agendamento',
    'mostrar_mover',
  ]);

  private conversas(): Promise<Conversa[]> {
    this.cacheConversas ??= this.f.conversas();
    return this.cacheConversas;
  }

  private async conversa(id: string): Promise<Conversa | undefined> {
    return (await this.conversas()).find((c) => c.id === id);
  }

  /** Linhas do contexto: o que a Serena faz por esta pessoa (e o que não). */
  regras(): string[] {
    const faz: string[] = [];
    const nao: string[] = [];
    if (this.pode.enviar) faz.push(this.pode.enviarVarias ? `mandar mensagem para clientes (uma ou várias; mais de ${LIMITE_DIRETO} vira transmissão${this.pode.transmitir ? '' : ', que esta pessoa não pode fazer'})` : 'mandar mensagem para UMA cliente por vez');
    else nao.push('mandar mensagem para clientes (falta a permissão "Responder clientes")');
    if (this.pode.enviar && !this.pode.enviarVarias) nao.push('mandar para várias clientes de uma vez (só a gestão)');
    if (this.f.agenda) {
      const us = unidadesComAgenda();
      faz.push(`agendar, remarcar e cancelar horários na agenda${us.length ? ` (unidades com agenda: ${us.map((u) => unidadeDe(u).nome).join(', ')})` : ''}`);
    } else nao.push('agendar (a agenda não está ligada em Conexões › Agenda)');
    if (this.f.crm && this.pode.mover) faz.push(this.pode.moverVarias ? 'mover conversas no funil/pipeline (uma ou várias)' : 'mover UMA conversa por vez no funil/pipeline');
    else if (!this.pode.mover) nao.push('mover conversas no funil (falta a permissão "Mover etapas")');
    if (this.pode.mover && !this.pode.moverVarias) nao.push('mover várias conversas de uma vez (só a gestão)');
    return [
      faz.length ? `Você pode fazer por esta pessoa (sempre com cartão e Confirmar): ${faz.join('; ')}.` : '',
      nao.length ? `Esta pessoa NÃO pode: ${nao.join('; ')}. Se pedir, explique com gentileza e sugira falar com a gerência.` : '',
    ].filter(Boolean);
  }

  ferramentas(): Ferramenta[] {
    const f: Ferramenta[] = [
      {
        name: 'buscar_clientes',
        description:
          'Lista as clientes (conversas) que esta pessoa pode ver, com filtros. Use para montar listas (ex.: conversas paradas há mais de 7 dias) e para achar o conversa_id de alguém pelo nome. Datas e horas no horário da Bahia.',
        input_schema: {
          type: 'object',
          properties: {
            busca: { type: ['string', 'null'], description: 'Parte do nome ou do telefone' },
            parada_dias_min: { type: ['integer', 'null'], description: 'Sem mensagem nenhuma (de ninguém) há pelo menos N dias' },
            parada_dias_max: { type: ['integer', 'null'], description: 'Com alguma mensagem nos últimos N dias' },
            ultima_de: { type: ['string', 'null'], enum: ['cliente', 'loja', null], description: 'Quem mandou a última mensagem' },
            etapa: { type: ['string', 'null'], enum: [...ETAPAS, null], description: 'Etapa do funil de atendimento' },
            unidade: { type: ['string', 'null'], description: 'Id da unidade' },
            limite: { type: ['integer', 'null'], description: `Quantas no máximo (padrão 50, até ${LIMITE_ENVIO})` },
          },
          additionalProperties: false,
        },
      },
    ];
    if (this.f.crm) {
      f.push(
        {
          name: 'ver_funis',
          description: 'Pipelines (funis) com as etapas (ids) e quais são de perda, e os motivos de perda (ids). Use antes de mostrar_mover.',
          input_schema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'ver_produtos',
          description: 'Produtos e serviços do cadastro da empresa (Empresa › Produtos e serviços) com preço e duração. Fonte oficial de preço junto com a agenda do salão.',
          input_schema: { type: 'object', properties: { busca: { type: ['string', 'null'], description: 'Parte do nome ou categoria; null = todos' } }, additionalProperties: false },
        },
      );
    }
    if (this.f.agenda) {
      f.push(
        {
          name: 'ver_servicos_agenda',
          description: 'Serviços da unidade no sistema de agenda do salão (Trinks, Avec ou AppBarber), com id, preço, preço promocional de hoje e duração.',
          input_schema: { type: 'object', properties: { unidade: { type: 'string', description: 'Id da unidade' } }, required: ['unidade'], additionalProperties: false },
        },
        {
          name: 'consultar_horarios',
          description: 'Horários livres de um dia para um serviço, por profissional (com ids). Use antes de mostrar_agendamento.',
          input_schema: {
            type: 'object',
            properties: {
              unidade: { type: 'string' },
              data: { type: 'string', description: 'AAAA-MM-DD' },
              servico_id: { type: 'integer' },
              profissional_id: { type: ['integer', 'null'] },
            },
            required: ['unidade', 'data', 'servico_id'],
            additionalProperties: false,
          },
        },
        {
          name: 'ver_agendamentos_da_cliente',
          description: 'Próximos horários marcados de uma cliente na agenda da unidade, com o id de cada um (para remarcar ou cancelar).',
          input_schema: { type: 'object', properties: { conversa_id: { type: 'string' }, unidade: { type: 'string' } }, required: ['conversa_id', 'unidade'], additionalProperties: false },
        },
        {
          name: 'mostrar_agendamento',
          description:
            'Mostra à pessoa o cartão "Agendar/Remarcar/Cancelar <cliente> — <serviço> — <dia e hora> — <unidade>" com Confirmar e Cancelar. NÃO agenda: só a pessoa confirma. Agendar e remarcar pedem servico_id, profissional_id, data e hora vindos de consultar_horarios; remarcar e cancelar pedem agendamento_id (ver_agendamentos_da_cliente). Se a cliente já tem horário e a pessoa quer MAIS um, use ja_conferiu_agendamentos=true.',
          input_schema: {
            type: 'object',
            properties: {
              acao: { type: 'string', enum: ['agendar', 'remarcar', 'cancelar'] },
              conversa_id: { type: 'string' },
              unidade: { type: 'string' },
              servico_id: { type: ['integer', 'null'] },
              profissional_id: { type: ['integer', 'null'] },
              data: { type: ['string', 'null'], description: 'AAAA-MM-DD' },
              hora: { type: ['string', 'null'], description: 'HH:mm' },
              agendamento_id: { type: ['integer', 'null'] },
              motivo: { type: ['string', 'null'], description: 'No cancelamento: por quê, curto' },
              nome_cliente: { type: ['string', 'null'], description: 'Nome completo para o cadastro na agenda (se ela ainda não tem)' },
              ja_conferiu_agendamentos: { type: ['boolean', 'null'] },
            },
            required: ['acao', 'conversa_id', 'unidade'],
            additionalProperties: false,
          },
        },
      );
    }
    if (this.pode.enviar) {
      f.push({
        name: 'mostrar_envio',
        description: `Mostra à pessoa o cartão "Enviar para N clientes" com a lista e o texto (ela pode editar o texto e tirar nomes), com Confirmar e Cancelar. NÃO envia: só a pessoa confirma. Use conversa_id de buscar_clientes. Use "texto" (o mesmo para todas, com {primeiro_nome}) ou um texto por cliente em conversas[].texto. Mensagem curta, no jeito de WhatsApp, sem inventar preço, horário ou promoção. Até ${LIMITE_DIRETO} clientes sai uma a uma pelo número da loja; mais que isso vira uma transmissão (um texto só, com {primeiro_nome}).`,
        input_schema: {
          type: 'object',
          properties: {
            conversas: {
              type: 'array',
              items: { type: 'object', properties: { conversa_id: { type: 'string' }, texto: { type: ['string', 'null'], description: 'Só se for um texto diferente para esta cliente' } }, required: ['conversa_id'], additionalProperties: false },
            },
            texto: { type: ['string', 'null'], description: 'Texto para todas, com {primeiro_nome} onde entra o nome' },
            titulo: { type: ['string', 'null'], description: 'Do que se trata, curto (ex.: Retomar conversas paradas)' },
          },
          required: ['conversas'],
          additionalProperties: false,
        },
      });
    }
    if (this.f.crm && this.pode.mover) {
      f.push({
        name: 'mostrar_mover',
        description:
          'Mostra à pessoa o cartão "Mover N conversas para <etapa>" com Confirmar e Cancelar. NÃO move: só a pessoa confirma. Ids de ver_funis e conversa_id de buscar_clientes. Etapa de perda exige motivo_perda_id (e detalhe_perda quando o motivo pede).',
        input_schema: {
          type: 'object',
          properties: {
            conversas: { type: 'array', items: { type: 'string' }, description: 'conversa_id de cada uma' },
            funil_id: { type: 'string' },
            etapa_id: { type: 'string' },
            motivo_perda_id: { type: ['string', 'null'] },
            detalhe_perda: { type: ['string', 'null'] },
          },
          required: ['conversas', 'funil_id', 'etapa_id'],
          additionalProperties: false,
        },
      });
    }
    return f;
  }

  /** Executa uma ferramenta desta parte. Erro de conferência volta para a IA corrigir. */
  async executar(nome: string, entrada: unknown): Promise<ResultadoFerramenta> {
    try {
      switch (nome) {
        case 'buscar_clientes':
          return { conteudo: await this.buscar(entrada) };
        case 'ver_funis':
          return { conteudo: await this.verFunis() };
        case 'ver_produtos':
          return { conteudo: await this.verProdutos(entrada) };
        case 'ver_servicos_agenda':
          return { conteudo: await this.verServicos(entrada) };
        case 'consultar_horarios':
          return { conteudo: await this.consultarHorarios(entrada) };
        case 'ver_agendamentos_da_cliente':
          return await this.verAgendamentos(entrada);
        case 'mostrar_envio':
          return await this.mostrarEnvio(entrada);
        case 'mostrar_agendamento':
          return await this.mostrarAgendamento(entrada);
        case 'mostrar_mover':
          return await this.mostrarMover(entrada);
        default:
          return { conteudo: `Ferramenta desconhecida: ${nome}.`, erro: true };
      }
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`).join('; ') : e instanceof Error ? e.message : String(e);
      return { conteudo: `Não deu: ${msg} Corrija e tente de novo (ou explique à pessoa).`, erro: true };
    }
  }

  // ---------------------------------------------------------------- leitura

  private async buscar(entrada: unknown): Promise<string> {
    const b = Busca.parse(entrada ?? {});
    const agora = this.f.agora().getTime();
    const termo = b.busca ? sem(b.busca) : '';
    const digitos = b.busca?.replace(/\D/g, '') ?? '';
    const lista = (await this.conversas())
      .filter((c) => {
        const dias = (agora - ultimaAtividade(c)) / DIA;
        if (b.parada_dias_min != null && dias < b.parada_dias_min) return false;
        if (b.parada_dias_max != null && dias > b.parada_dias_max) return false;
        if (b.ultima_de && ultimaDe(c) !== b.ultima_de) return false;
        if (b.etapa && c.etapa !== b.etapa) return false;
        if (b.unidade && c.unidade !== b.unidade) return false;
        if (termo && !sem(c.nome ?? '').includes(termo) && !(digitos.length >= 4 && c.telefone.includes(digitos))) return false;
        return true;
      })
      .sort((a, x) => ultimaAtividade(a) - ultimaAtividade(x));
    const limite = b.limite ?? 50;
    const l = [`<clientes total="${lista.length}"${lista.length > limite ? ` mostrando="${limite}"` : ''}>`];
    for (const c of lista.slice(0, limite)) {
      const dias = Math.floor((agora - ultimaAtividade(c)) / DIA);
      l.push(
        `- ${nomeDe(c)} · conversa_id ${c.id} · ${unidadeDe(c.unidade).nome} (${c.unidade}) · etapa ${NOME_ETAPA[c.etapa]} · parada há ${dias} dia(s) · última de ${ultimaDe(c) ?? 'ninguém'}${c.responsavelNome ? ` · dona ${c.responsavelNome}` : ''}`,
      );
    }
    if (!lista.length) l.push('(nenhuma cliente com esse filtro entre as conversas que esta pessoa pode ver)');
    l.push('</clientes>');
    return l.join('\n');
  }

  private async verFunis(): Promise<string> {
    const crm = this.f.crm!;
    const [funis, motivos] = await Promise.all([crm.funis(), crm.motivosPerda().catch(() => [])]);
    const l: string[] = ['<funis>'];
    for (const f of funis.slice(0, 20)) {
      l.push(`- Funil "${f.nome}" (funil_id ${f.id})${f.sistema ? ' · funil de atendimento' : ''}`);
      for (const e of f.etapas.slice(0, 30)) l.push(`  - etapa "${e.nome}" (etapa_id ${e.id})${e.perda ? ' · PERDA (pede motivo)' : ''}`);
    }
    if (!funis.length) l.push('(nenhum)');
    l.push('</funis>', '<motivos_de_perda>');
    for (const m of motivos) l.push(`- ${m.nome} (motivo_perda_id ${m.id})${m.pedeTexto ? ' · pede detalhe' : ''}`);
    if (!motivos.length) l.push('(nenhum cadastrado)');
    l.push('</motivos_de_perda>');
    return l.join('\n');
  }

  private async verProdutos(entrada: unknown): Promise<string> {
    const { busca } = z.object({ busca: z.string().trim().max(80).nullish() }).parse(entrada ?? {});
    const b = busca ? sem(busca) : '';
    const produtos = (await this.f.crm!.produtos()).filter((p) => !b || sem(`${p.nome} ${p.categoria ?? ''} ${p.descricao}`).includes(b)).slice(0, 60);
    if (!produtos.length) return `Fonte: cadastro (Empresa › Produtos e serviços). ${b ? `Nada com "${busca}".` : 'Cadastro vazio.'} Não invente preço: confira a agenda do salão (ver_servicos_agenda) ou diga que não sabe.`;
    const l = ['Fonte: cadastro da empresa (Empresa › Produtos e serviços).', '<produtos>'];
    for (const p of produtos) {
      l.push(`- ${p.nome} · ${p.tipo === 'servico' ? 'serviço' : 'produto'}${p.categoria ? ` · ${p.categoria}` : ''} · ${p.preco === null ? 'preço sob consulta (não diga valor)' : `R$ ${p.preco.toFixed(2).replace('.', ',')}`}${p.duracaoMin ? ` · ${p.duracaoMin} min` : ''}${p.descricao ? ` · ${p.descricao.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`);
    }
    l.push('</produtos>');
    return l.join('\n');
  }

  private unidadeComAgenda(unidade: string) {
    const r = agendaDaUnidade(this.f.agenda!, unidade);
    return { ...r, fonte: `agenda do salão (${NOMES_SISTEMA[r.tipo] ?? r.tipo}, unidade ${unidadeDe(unidade).nome})` };
  }

  private async verServicos(entrada: unknown): Promise<string> {
    const { unidade } = z.object({ unidade: z.string().trim().min(1).max(60) }).parse(entrada);
    const { sistema, local, fonte } = this.unidadeComAgenda(unidade);
    const servicos = (await comPrazo(sistema.listarServicos(local), this.f.prazoAgendaMs ?? 25_000)).filter((s) => s.visivelParaCliente !== false);
    if (!servicos.length) return `Fonte: ${fonte}. Nenhum serviço cadastrado lá. Não invente.`;
    const real = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
    return [
      `Fonte: ${fonte}.`,
      '<servicos>',
      ...servicos.slice(0, 80).map((s) => `- ${s.nome} (servico_id ${s.id})${s.categoria ? ` · ${s.categoria}` : ''} · ${real(s.preco)}${s.valorPromocional != null && s.valorPromocional !== s.preco ? ` (promoção hoje: ${real(s.valorPromocional)})` : ''} · ${s.duracaoEmMinutos} min`),
      '</servicos>',
    ].join('\n');
  }

  private async consultarHorarios(entrada: unknown): Promise<string> {
    const i = z.object({ unidade: z.string().trim().min(1).max(60), data: Data, servico_id: z.number().int(), profissional_id: z.number().int().nullish() }).parse(entrada);
    const agora = this.f.agora();
    if (i.data < dataISO(agora)) return `Essa data já passou (hoje é ${dataISO(agora)}).`;
    const livres = await comPrazo(horariosLivres(this.f.agenda!, i.unidade, i.data, i.servico_id, i.profissional_id ?? undefined, agora), this.f.prazoAgendaMs ?? 25_000);
    if (!livres.length) return `Nenhum horário livre em ${i.data} para esse serviço em ${unidadeDe(i.unidade).nome}. Sugira outro dia.`;
    return livres.map((p) => `- ${p.profissional ?? 'Profissional'} (profissional_id ${p.profissionalId}): ${p.horarios.join(', ')}`).join('\n');
  }

  private contexto(c: Conversa) {
    return { agenda: this.f.agenda!, conversa: c, agora: this.f.agora(), acoes: [], podeEscrever: false, sessao: novaSessao(), prazoAgendaMs: this.f.prazoAgendaMs };
  }

  private async verAgendamentos(entrada: unknown): Promise<ResultadoFerramenta> {
    const i = z.object({ conversa_id: Id, unidade: z.string().trim().min(1).max(60) }).parse(entrada);
    const c = await this.conversa(i.conversa_id);
    if (!c) return { conteudo: 'Cliente não encontrada entre as conversas que esta pessoa pode ver. Use buscar_clientes.', erro: true };
    const r = await executarFerramenta('ver_agendamentos_da_cliente', { unidade: i.unidade }, this.contexto(c));
    return r.erro ? { conteudo: `A agenda não respondeu: ${r.conteudo.slice(0, 200)}`, erro: true } : { conteudo: r.conteudo };
  }

  /** Horários futuros da cliente (lista crua) ou erro. */
  private async agendamentosDa(c: Conversa, unidade: string): Promise<Array<{ id: number; servico?: string; profissional?: string; inicio: string }>> {
    const r = await executarFerramenta('ver_agendamentos_da_cliente', { unidade }, this.contexto(c));
    if (r.erro) throw new Error(`a agenda não respondeu (${r.conteudo.slice(0, 160)})`);
    const v = JSON.parse(r.conteudo) as unknown;
    return Array.isArray(v) ? (v as Array<{ id: number; servico?: string; profissional?: string; inicio: string }>) : [];
  }

  // ---------------------------------------------------------------- cartões

  private async mostrarEnvio(entrada: unknown): Promise<ResultadoFerramenta> {
    const p = PedidoEnvio.parse(entrada);
    const ids = [...new Set(p.conversas.map((x) => x.conversa_id))];
    if (ids.length > 1 && !this.pode.enviarVarias) return { conteudo: 'Esta pessoa só pode mandar para UMA cliente por vez (envio para várias é da gestão). Explique e ofereça mandar para uma só.', erro: true };
    const geral = p.texto?.trim() ?? '';
    const proprios = new Map(p.conversas.filter((x) => x.texto?.trim()).map((x) => [x.conversa_id, x.texto!.trim()]));
    const itens: ItemEnvio[] = [];
    const fora: DadosEnvio['fora'] = [];
    for (const id of ids) {
      const c = await this.conversa(id);
      if (!c) {
        fora.push({ nome: id.slice(0, 8), motivo: 'não encontrada (ou esta pessoa não vê)' });
        continue;
      }
      if (await this.f.descadastrado?.(c.telefone).catch(() => false)) {
        fora.push({ nome: nomeDe(c), motivo: 'pediu para não receber mensagens (SAIR)' });
        continue;
      }
      const texto = proprios.get(id);
      if (!texto && !geral) return { conteudo: `Falta o texto para ${nomeDe(c)}: use "texto" (para todas) ou conversas[].texto.`, erro: true };
      itens.push({ conversaId: c.id, nome: nomeDe(c), unidade: unidadeDe(c.unidade).nome, ...(texto ? { texto } : {}) });
    }
    if (!itens.length) return { conteudo: `Ninguém para receber: ${fora.map((x) => `${x.nome} (${x.motivo})`).join('; ') || 'lista vazia'}.`, erro: true };
    const modo = itens.length > LIMITE_DIRETO ? 'transmissao' : 'direto';
    if (modo === 'transmissao') {
      if (!this.pode.transmitir) return { conteudo: `Mais de ${LIMITE_DIRETO} clientes vira transmissão, e esta pessoa não pode fazer transmissões. Ofereça mandar para até ${LIMITE_DIRETO}.`, erro: true };
      if (proprios.size) return { conteudo: `Para mais de ${LIMITE_DIRETO} clientes use um texto só (campo "texto", com {primeiro_nome}); a transmissão não leva um texto diferente por cliente.`, erro: true };
    }
    const titulo = `Enviar para ${itens.length} cliente${itens.length === 1 ? '' : 's'}`;
    const dados: DadosEnvio = { texto: geral, itens, fora, modo };
    this.guardar({ tipo: 'envio', acao: 'criar', titulo, dados: { ...dados, assunto: p.titulo ?? null } });
    return { conteudo: PREVIA(`mensagem para ${itens.length} cliente(s)${fora.length ? `; ${fora.length} ficou(aram) de fora: ${fora.map((x) => `${x.nome} (${x.motivo})`).join('; ')}` : ''}${modo === 'transmissao' ? '; vai como transmissão, aos poucos' : ''}`) };
  }

  private async mostrarAgendamento(entrada: unknown): Promise<ResultadoFerramenta> {
    const i = PedidoAgenda.parse(entrada);
    const c = await this.conversa(i.conversa_id);
    if (!c) return { conteudo: 'Cliente não encontrada entre as conversas que esta pessoa pode ver. Use buscar_clientes.', erro: true };
    const { sistema, local, fonte } = this.unidadeComAgenda(i.unidade);
    const prazo = this.f.prazoAgendaMs ?? 25_000;
    const nome = nomeDe(c);
    const unidade = unidadeDe(i.unidade).nome;
    let antigo: { id: number; servico?: string; inicio: string } | undefined;
    let existentes: Awaited<ReturnType<FazerSerena['agendamentosDa']>> = [];
    if (i.acao !== 'agendar' || !i.ja_conferiu_agendamentos) existentes = await this.agendamentosDa(c, i.unidade);
    if (i.acao !== 'agendar') {
      if (!i.agendamento_id) return { conteudo: 'Falta agendamento_id (use ver_agendamentos_da_cliente).', erro: true };
      antigo = existentes.find((a) => a.id === i.agendamento_id);
      if (!antigo) return { conteudo: 'Esse horário não está entre os próximos horários desta cliente. Use ver_agendamentos_da_cliente.', erro: true };
    } else if (existentes.length && !i.ja_conferiu_agendamentos) {
      const l = existentes.slice(0, 5).map((a) => `${a.servico ?? 'horário'} em ${String(a.inicio).replace('T', ' ').slice(0, 16)} (id ${a.id})`);
      return { conteudo: `${nome} já tem horário marcado: ${l.join('; ')}. Pergunte à pessoa se é MAIS um horário (aí chame de novo com ja_conferiu_agendamentos=true) ou se é para remarcar (acao "remarcar").`, erro: true };
    }
    const antigoTxt = antigo ? `${antigo.servico ?? 'horário'} de ${quandoCurto(String(antigo.inicio).slice(0, 10), String(antigo.inicio).slice(11, 16))}` : null;
    let servico: string | null = null;
    let profissional: string | null = null;
    let preco: number | null = null;
    if (i.acao !== 'cancelar') {
      if (!i.servico_id || !i.profissional_id || !i.data || !i.hora) return { conteudo: 'Para agendar ou remarcar preciso de servico_id, profissional_id, data e hora (de consultar_horarios).', erro: true };
      const hora = i.hora.padStart(5, '0');
      if (deDataEHora(i.data, hora).getTime() <= this.f.agora().getTime()) return { conteudo: 'Esse horário já passou. Escolha um horário de agora em diante.', erro: true };
      const s = (await comPrazo(sistema.listarServicos(local), prazo)).find((x) => x.id === i.servico_id);
      if (!s) return { conteudo: `O serviço ${i.servico_id} não existe na agenda de ${unidade}. Use ver_servicos_agenda.`, erro: true };
      servico = s.nome;
      preco = s.valorPromocional ?? s.preco;
      const livres = await comPrazo(horariosLivres(this.f.agenda!, i.unidade, i.data, i.servico_id, i.profissional_id, this.f.agora()), prazo);
      const p = livres.find((x) => x.profissionalId === i.profissional_id);
      if (!p || !p.horarios.includes(hora)) {
        const outros = livres.flatMap((x) => x.horarios.map((h) => `${h} com ${x.profissional ?? x.profissionalId}`)).slice(0, 6);
        return { conteudo: `O horário ${hora} de ${i.data} não está livre com essa profissional.${outros.length ? ` Livres nesse dia: ${outros.join('; ')}.` : ' Não há horário livre nesse dia.'}`, erro: true };
      }
      profissional = p.profissional;
    }
    const quando = i.data && i.hora ? quandoCurto(i.data, i.hora) : null;
    const verbo = { agendar: 'Agendar', remarcar: 'Remarcar', cancelar: 'Cancelar' }[i.acao];
    const titulo = i.acao === 'cancelar' ? `Cancelar ${primeiro(nome) || nome} — ${antigoTxt} — unidade ${unidade}` : `${verbo} ${primeiro(nome) || nome} — ${servico} — ${quando} — unidade ${unidade}`;
    const dados: DadosAgendamento = {
      acao: i.acao,
      conversaId: c.id,
      unidade: i.unidade,
      servicoId: i.servico_id ?? null,
      profissionalId: i.profissional_id ?? null,
      data: i.data ?? null,
      hora: i.hora ? i.hora.padStart(5, '0') : null,
      agendamentoId: i.agendamento_id ?? null,
      motivo: i.motivo?.trim() || '',
      nomeCliente: i.nome_cliente?.trim() || c.nome || 'Cliente',
      enviarConfirmacao: i.acao !== 'cancelar' && this.pode.enviar,
      resumo: { cliente: nome, servico, profissional, quando, unidade, preco, antigo: antigoTxt, fonte },
    };
    this.guardar({ tipo: 'agendamento', acao: 'criar', alvoId: c.id, titulo, dados: { ...dados } });
    return { conteudo: PREVIA(`${verbo.toLowerCase()} ${nome}`) };
  }

  private async mostrarMover(entrada: unknown): Promise<ResultadoFerramenta> {
    const i = PedidoMover.parse(entrada);
    const ids = [...new Set(i.conversas)];
    if (ids.length > 1 && !this.pode.moverVarias) return { conteudo: 'Esta pessoa só pode mover UMA conversa por vez (mover várias é da gestão).', erro: true };
    const crm = this.f.crm!;
    const funil = (await crm.funis()).find((f) => f.id === i.funil_id);
    if (!funil) return { conteudo: 'Esse funil não existe. Use ver_funis.', erro: true };
    const etapa = funil.etapas.find((e) => e.id === i.etapa_id);
    if (!etapa) return { conteudo: `Essa etapa não existe no funil "${funil.nome}". Use ver_funis.`, erro: true };
    let perda: DadosMover['perda'] = null;
    if (etapa.perda) {
      const motivos = await crm.motivosPerda();
      const m = motivos.find((x) => x.id === i.motivo_perda_id);
      if (!m) return { conteudo: `"${etapa.nome}" é etapa de perda: falta o motivo. Pergunte à pessoa qual destes: ${motivos.map((x) => `${x.nome} (${x.id})`).join('; ') || '(nenhum motivo cadastrado)'}.`, erro: true };
      const detalhe = i.detalhe_perda?.trim() || null;
      if (m.pedeTexto && (!detalhe || detalhe.length < 2)) return { conteudo: `O motivo "${m.nome}" pede um detalhe em poucas palavras (detalhe_perda). Pergunte à pessoa.`, erro: true };
      perda = { motivo: m.id, motivoNome: m.nome, detalhe };
    }
    const itens: DadosMover['itens'] = [];
    const faltam: string[] = [];
    for (const id of ids) {
      const c = await this.conversa(id);
      if (c) itens.push({ conversaId: c.id, nome: nomeDe(c), unidade: unidadeDe(c.unidade).nome });
      else faltam.push(id.slice(0, 8));
    }
    if (!itens.length) return { conteudo: 'Nenhuma dessas conversas está entre as que esta pessoa pode ver. Use buscar_clientes.', erro: true };
    const titulo = itens.length === 1 ? `Mover ${itens[0]!.nome} para "${etapa.nome}"` : `Mover ${itens.length} conversas para "${etapa.nome}"`;
    const dados: DadosMover = { funilId: funil.id, etapaId: etapa.id, funil: funil.nome, etapa: etapa.nome, perda, itens };
    this.guardar({ tipo: 'mover', acao: 'criar', titulo, dados: { ...dados } });
    return { conteudo: PREVIA(`mover ${itens.length} conversa(s) para "${etapa.nome}" em "${funil.nome}"${faltam.length ? `; ${faltam.length} não encontrada(s)` : ''}`) };
  }
}

/** Regras do estúdio de agentes (persona, sempre/nunca) em texto, para a Serena da tela seguir também. */
export function regrasDosAgentes(agentes: Array<{ nome: string; ativo: boolean; config: { persona?: { quemE?: string }; regras?: { sempre?: string[]; nunca?: string[] } } }>): string {
  const linhas: string[] = [];
  const sempre = new Set<string>();
  const nunca = new Set<string>();
  for (const a of agentes.filter((x) => x.ativo)) {
    for (const r of a.config.regras?.sempre ?? []) if (r.trim()) sempre.add(r.trim());
    for (const r of a.config.regras?.nunca ?? []) if (r.trim()) nunca.add(r.trim());
  }
  if (sempre.size) linhas.push('Sempre:', ...[...sempre].slice(0, 40).map((r) => `- ${r}`));
  if (nunca.size) linhas.push('Nunca:', ...[...nunca].slice(0, 40).map((r) => `- ${r}`));
  return linhas.join('\n');
}

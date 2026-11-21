import { z } from 'zod';
import type { Agendamento, Conversa, Etapa } from '../domain.js';
import { agendar, agendaDaUnidade, ErroAgendamento, horariosLivres } from '../agenda/agendar.js';
import { ErroAgenda, type AgendamentoDoSistema, type FonteAgenda, type ServicoAgenda } from '../agenda/sistema.js';
import { dataISO, deDataEHora, DIA, horaHHmm } from '../util/tempo.js';
import { idsUnidades, primeiraUnidade, unidadeDe, unidadesComAgenda, zUnidade } from '../unidades.js';
import { horaDoSistema } from '../agenda/agenda-externa.js';
import { anotarPrecosDe, dataValida, feriadoNacional } from './guarda.js';
import { anotarAgenda } from './saude-agenda.js';
import type { AcaoCrm, ServicosCrmIa } from './crm-ia.js';
import { rodarFerramentaCrm, FERRAMENTAS_CRM_NOMES } from './ferramentas-crm.js';

/**
 * O que o agente precisa da agenda (src/agenda/sistema.ts): o roteador que escolhe o sistema de cada unidade
 * (Trinks, Avec ou AppBarber) ou um sistema só (nos testes, um falso no formato do Trinks).
 */
export type Agenda = FonteAgenda;

/** Agendamento já existente que a IA mudou (remarcar/cancelar). */
export interface AgendamentoAntigo {
  id: number;
  unidade: string;
  inicio: string;
  servico: string | null;
}

/** Efeitos que o agente pede e o app aplica depois (funil, lembretes, alerta para a equipe). */
export type AcaoAgente =
  | { tipo: 'agendou'; agendamento: Agendamento; clienteTrinksId: number }
  | { tipo: 'passar_para_humano'; motivo: string }
  | { tipo: 'etapa'; etapa: Etapa; motivo: string }
  /** Marcar uma tag que JÁ EXISTE na empresa (a IA nunca cria tag). */
  | { tipo: 'marcar_tag'; nome: string }
  /** ia-completa: remarcou (o novo já está gravado na agenda; o antigo foi cancelado ou ficou para a equipe cancelar). */
  | { tipo: 'remarcou'; antigo: AgendamentoAntigo; agendamento: Agendamento; clienteTrinksId: number; cancelouAntigo: boolean; erroCancelar?: string }
  /** ia-completa: cancelou na agenda. `restam` = outros horários futuros da cliente. */
  | { tipo: 'cancelou'; antigo: AgendamentoAntigo; motivo: string; restam: number }
  | AcaoCrm;

/** Unidades que a IA pode consultar e agendar: as que têm agenda; sem nenhuma, as ativas (a ferramenta explica o que falta). */
const unidadesParaIa = (): string[] => {
  const l = unidadesComAgenda();
  return l.length ? l : idsUnidades().length ? idsUnidades() : [primeiraUnidade()];
};

import { def, RecusaFerramenta, type Ferramenta } from './ferramenta-base.js';
export { def, RecusaFerramenta };

// As unidades vêm do cadastro (Empresa › Unidades): lidas na hora em que a ferramenta vai para a IA
// (os getters entram no JSON enviado), então unidade nova vale sem reiniciar.
export const unidadeProp = {
  type: 'string',
  get enum() {
    return unidadesParaIa();
  },
  get description() {
    return unidadesParaIa()
      .map((u) => `${u} = ${unidadeDe(u).nome}`)
      .join(', ');
  },
};

export const FERRAMENTAS_LEITURA: Ferramenta[] = [
  def('ver_servicos', 'Lista os serviços da unidade no sistema de agenda do salão, com id, preço de tabela, preço promocional de hoje e duração.', {
    unidade: unidadeProp,
  }),
  def(
    'consultar_horarios',
    'Horários livres de um dia para um serviço, por profissional. Use antes de propor qualquer horário.',
    {
      unidade: unidadeProp,
      data: { type: 'string', description: 'Dia no formato AAAA-MM-DD' },
      servico_id: { type: 'integer', description: 'id vindo de ver_servicos' },
      profissional_id: { type: ['integer', 'null'], description: 'Opcional: filtra uma profissional' },
    },
  ),
  def('ver_agendamentos_da_cliente', 'Próximos horários marcados desta cliente (próximos 60 dias), com o id de cada um (para remarcar ou cancelar).', {
    unidade: unidadeProp,
  }),
  def('registrar_etapa', 'Atualiza a etapa da cliente no funil quando o momento dela ficar claro.', {
    etapa: { type: 'string', enum: ['em_conversa', 'interessada', 'perdida'] },
    motivo: { type: 'string', description: 'Uma frase curta explicando' },
  }),
];

/**
 * Ferramenta de tags: só entra quando a empresa ligou "IA marca tags" e existe alguma tag.
 * A lista de nomes vai no enum (o modelo não consegue inventar um nome) e é conferida de novo ao aplicar.
 */
export function ferramentaMarcarTag(nomes: string[]): Ferramenta {
  return def(
    'marcar_tag',
    `Marca na conversa uma das tags da loja, quando a conversa deixar isso claro (ex.: a cliente diz que veio pelo Instagram → "Instagram"). Use só se tiver certeza; não precisa avisar a cliente. Tags existentes: ${nomes.map((n) => `"${n}"`).join(', ')}.`,
    { nome: { type: 'string', enum: nomes, description: 'Nome exato de uma tag existente' } },
  );
}

export const FERRAMENTAS_ESCRITA: Ferramenta[] = [
  def(
    'agendar',
    'Marca o horário no sistema de agenda do salão. Só use depois que a cliente confirmou serviço, unidade, dia, hora e profissional.',
    {
      unidade: unidadeProp,
      servico_id: { type: 'integer' },
      profissional_id: { type: 'integer' },
      data: { type: 'string', description: 'AAAA-MM-DD' },
      hora: { type: 'string', description: 'HH:mm, um dos horários de consultar_horarios' },
      nome_cliente: { type: 'string', description: 'Nome completo da cliente para o cadastro' },
      ja_conferiu_agendamentos: {
        type: 'boolean',
        description: 'true se você já viu os horários que ela tem marcados e ela quer MAIS um horário (não remarcar). Na dúvida, false.',
      },
    },
  ),
  def('passar_para_humano', 'Chama alguém da equipe para continuar esta conversa. A IA para de responder aqui.', {
    motivo: { type: 'string' },
  }),
];

/** ia-completa: remarcar e cancelar (escrita na agenda). */
export const FERRAMENTAS_AGENDA_MUDAR: Ferramenta[] = [
  def(
    'remarcar_agendamento',
    'Troca um horário que a cliente já tem por outro. Primeiro use ver_agendamentos_da_cliente (pega o id) e consultar_horarios (horário novo livre); confirme com a cliente o horário antigo e o novo e só chame depois que ela disser que sim. O novo é marcado antes de cancelar o antigo.',
    {
      unidade: unidadeProp,
      agendamento_id: { type: 'integer', description: 'id do horário atual (ver_agendamentos_da_cliente)' },
      servico_id: { type: 'integer' },
      profissional_id: { type: 'integer' },
      data: { type: 'string', description: 'Novo dia, AAAA-MM-DD' },
      hora: { type: 'string', description: 'Nova hora, HH:mm (de consultar_horarios)' },
      cliente_confirmou: { type: 'boolean', description: 'true só se a cliente disse que sim para a troca' },
    },
  ),
  def(
    'cancelar_agendamento',
    'Cancela um horário da cliente na agenda. Antes, ofereça remarcar; confirme com a cliente qual horário cancelar e só chame depois que ela disser que sim.',
    {
      unidade: unidadeProp,
      agendamento_id: { type: 'integer', description: 'id do horário (ver_agendamentos_da_cliente)' },
      motivo: { type: 'string', description: 'Por que ela cancelou, curto' },
      cliente_confirmou: { type: 'boolean', description: 'true só se a cliente confirmou o cancelamento' },
    },
  ),
];

const Unidade = zUnidade();
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD').refine(dataValida, 'essa data não existe no calendário');
const Hora = z.string().regex(/^\d{1,2}:\d{2}$/);

const ENTRADAS = {
  ver_servicos: z.object({ unidade: Unidade }),
  consultar_horarios: z.object({
    unidade: Unidade,
    data: Data,
    servico_id: z.number().int(),
    profissional_id: z.number().int().nullable(),
  }),
  ver_agendamentos_da_cliente: z.object({ unidade: Unidade }),
  registrar_etapa: z.object({ etapa: z.enum(['em_conversa', 'interessada', 'perdida']), motivo: z.string() }),
  agendar: z.object({
    unidade: Unidade,
    servico_id: z.number().int(),
    profissional_id: z.number().int(),
    data: Data,
    hora: Hora,
    nome_cliente: z.string().min(3),
    ja_conferiu_agendamentos: z.boolean().optional().default(false),
  }),
  remarcar_agendamento: z.object({
    unidade: Unidade,
    agendamento_id: z.number().int(),
    servico_id: z.number().int(),
    profissional_id: z.number().int(),
    data: Data,
    hora: Hora,
    cliente_confirmou: z.boolean(),
  }),
  cancelar_agendamento: z.object({ unidade: Unidade, agendamento_id: z.number().int(), motivo: z.string().max(300), cliente_confirmou: z.boolean() }),
  passar_para_humano: z.object({ motivo: z.string() }),
} as const;

/** ia-completa: memória de uma resposta da IA (as idas e vindas com ferramentas de UMA resposta). */
export interface SessaoFerramentas {
  /** Valores em centavos que vieram do sistema nesta resposta (agenda, produtos). */
  precos: Set<number>;
  /** Agendamentos já feitos nesta resposta (a mesma chamada repetida não marca duas vezes). */
  feitos: Map<string, unknown>;
  /** Quantas vezes cada chamada idêntica foi feita (laço de ferramenta). */
  chamadas: Map<string, number>;
  /** Serviços por unidade (evita chamar a agenda de novo na mesma resposta). */
  servicos: Map<string, ServicoAgenda[]>;
}
export const novaSessao = (): SessaoFerramentas => ({ precos: new Set(), feitos: new Map(), chamadas: new Map(), servicos: new Map() });

export interface ContextoFerramentas {
  agenda: Agenda;
  conversa: Conversa;
  agora: Date;
  acoes: AcaoAgente[];
  /** Em modo sugestão, nada é gravado na agenda. */
  podeEscrever: boolean;
  /** Tags que a IA pode marcar (vazio = não marca). */
  tagsDisponiveis?: string[];
  /** ia-completa: pipelines, produtos, motivos de perda e arquivos da empresa (ausente = essas ferramentas não existem). */
  crm?: ServicosCrmIa;
  /** ia-completa: a IA ainda está com a conversa? (a equipe pode ter assumido enquanto ela pensava). */
  aindaComIa?: () => Promise<boolean>;
  /** ia-completa: estado desta resposta (idempotência, preços vistos, laço). */
  sessao?: SessaoFerramentas;
  /** ia-completa: quanto esperar a agenda antes de desistir (padrão 25 s). */
  prazoAgendaMs?: number;
}

/** Chamadas idênticas permitidas numa resposta antes de a ferramenta recusar (laço). */
export const MAX_REPETICOES = 2;

/** Ferramentas que falam com a agenda do salão (falha aqui = agenda fora, não erro da IA). */
const DA_AGENDA = new Set(['ver_servicos', 'consultar_horarios', 'ver_agendamentos_da_cliente', 'agendar', 'remarcar_agendamento', 'cancelar_agendamento']);

/** Erro da agenda com a mensagem que a IA deve seguir (não é culpa dela, e ela não pode inventar). */
export class AgendaFora extends Error {}

const AVISO_AGENDA_FORA =
  'A agenda do salão não respondeu agora. NÃO invente horários nem confirme nada: diga à cliente, com gentileza, que vai confirmar com a equipe e use passar_para_humano.';

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, falha) => {
    const t = setTimeout(() => falha(new AgendaFora('A agenda demorou demais para responder (tempo esgotado).')), ms);
    (t as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        ok(v);
      },
      (e) => {
        clearTimeout(t);
        falha(e);
      },
    );
  });
}

/** Executa uma ferramenta e devolve o texto do tool_result. Erros viram mensagem para a IA. */
export async function executarFerramenta(
  nome: string,
  entrada: unknown,
  ctx: ContextoFerramentas,
): Promise<{ conteudo: string; erro: boolean }> {
  const sessao = ctx.sessao;
  if (sessao) {
    const chave = `${nome}|${JSON.stringify(entrada)}`;
    const n = (sessao.chamadas.get(chave) ?? 0) + 1;
    sessao.chamadas.set(chave, n);
    if (n > MAX_REPETICOES) {
      return { conteudo: `Você já chamou ${nome} com estes mesmos dados ${MAX_REPETICOES} vezes nesta resposta. Use o resultado que já tem e responda à cliente (ou use passar_para_humano).`, erro: true };
    }
  }
  const unidade = typeof (entrada as { unidade?: unknown })?.unidade === 'string' ? (entrada as { unidade: string }).unidade : undefined;
  try {
    const trabalho = rodar(nome, entrada, ctx);
    const r = DA_AGENDA.has(nome) ? await comPrazo(trabalho, ctx.prazoAgendaMs ?? 25_000) : await trabalho;
    if (sessao) anotarPrecosDe(r, sessao.precos);
    if (DA_AGENDA.has(nome) && unidade) anotarAgenda(unidade, true, null, ctx.agora);
    return { conteudo: typeof r === 'string' ? r : JSON.stringify(r), erro: false };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { conteudo: `Parâmetros inválidos: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, erro: true };
    }
    if (e instanceof ErroAgendamento) {
      if (e.codigo === 'sem_agenda') {
        const outras = unidadesComAgenda().filter((u) => u !== unidade);
        return {
          conteudo: `${e.message} Não ofereça horário por esta unidade${outras.length ? `: ofereça uma unidade que agenda (${outras.map((u) => unidadeDe(u).nome).join(', ')})` : ''} ou use passar_para_humano para a equipe marcar.`,
          erro: true,
        };
      }
      return { conteudo: e.message, erro: true };
    }
    if (e instanceof RecusaFerramenta) return { conteudo: e.message, erro: true };
    const msg = e instanceof Error ? e.message : String(e);
    if (DA_AGENDA.has(nome)) {
      if (unidade) anotarAgenda(unidade, false, msg, ctx.agora);
      return { conteudo: `${AVISO_AGENDA_FORA} (detalhe: ${msg.slice(0, 160)})`, erro: true };
    }
    return { conteudo: msg, erro: true };
  }
}

async function servicosDa(ctx: ContextoFerramentas, unidade: string): Promise<ServicoAgenda[]> {
  const ja = ctx.sessao?.servicos.get(unidade);
  if (ja) return ja;
  const { sistema, local } = agendaDaUnidade(ctx.agenda, unidade);
  const l = await sistema.listarServicos(local);
  ctx.sessao?.servicos.set(unidade, l);
  return l;
}

const cancelado = (tipo: string, a: AgendamentoDoSistema) => a.cancelado || (tipo === 'trinks' && a.status?.id === 9);

/** Horários futuros da cliente nesta unidade (vazio se ela não tem cadastro). */
async function agendamentosDa(ctx: ContextoFerramentas, unidade: string, dias = 120): Promise<{ clienteId: number | null; lista: AgendamentoDoSistema[] }> {
  const { sistema, tipo, local } = agendaDaUnidade(ctx.agenda, unidade);
  const clienteId = (tipo === 'trinks' ? ctx.conversa.trinksClienteId : undefined) ?? (await sistema.buscarClientePorTelefone(local, ctx.conversa.telefone))?.id ?? null;
  if (!clienteId) return { clienteId: null, lista: [] };
  const lista = await sistema.listarAgendamentosDoCliente(local, clienteId, dataISO(ctx.agora), dataISO(new Date(ctx.agora.getTime() + dias * DIA)));
  return { clienteId, lista: lista.filter((a) => !cancelado(tipo, a)) };
}

/** "2026-11-07T14:00:00" → mesmo dia e hora? */
const mesmoHorario = (a: AgendamentoDoSistema, data: string, hora: string) => {
  const d = horaDoSistema(String(a.dataHoraInicio));
  return Boolean(d) && dataISO(d!) === data && horaHHmm(d!) === hora.padStart(5, '0');
};

/** Até 6 horários livres do mesmo dia (para oferecer quando o escolhido foi ocupado). */
async function alternativas(ctx: ContextoFerramentas, unidade: string, data: string, servicoId: number): Promise<string> {
  try {
    const livres = await horariosLivres(ctx.agenda, unidade, data, servicoId, undefined, ctx.agora);
    const l = livres.flatMap((p) => p.horarios.map((h) => `${h} com ${p.profissional ?? 'profissional ' + p.profissionalId} (profissional_id ${p.profissionalId})`)).slice(0, 6);
    return l.length ? ` Ainda livres nesse dia: ${l.join('; ')}.` : ' Não sobrou horário livre nesse dia: ofereça outro dia.';
  } catch {
    return ' Consulte consultar_horarios de novo antes de oferecer outro horário.';
  }
}

/**
 * Confere o horário na agenda logo antes de gravar (a cliente pode ter demorado a responder e outra pessoa
 * ter ocupado). Se a agenda não responder à conferência, segue: o próprio sistema recusa horário ocupado.
 */
async function conferirLivre(ctx: ContextoFerramentas, unidade: string, data: string, hora: string, servicoId: number, profissionalId: number): Promise<boolean> {
  try {
    const { sistema, local } = agendaDaUnidade(ctx.agenda, unidade);
    const lista = await sistema.horariosVagos(local, data, { servicoId, profissionalId });
    const p = lista.find((x) => Number(x.id) === Number(profissionalId));
    return Boolean(p && (p.horariosVagos ?? []).includes(hora.padStart(5, '0')));
  } catch {
    return true;
  }
}

async function exigirEscritaComIa(ctx: ContextoFerramentas, oQue: string): Promise<void> {
  if (!ctx.podeEscrever) throw new RecusaFerramenta(`Modo sugestão: não ${oQue}. Escreva a mensagem propondo para a atendente revisar.`);
  if (ctx.aindaComIa && !(await ctx.aindaComIa().catch(() => true))) {
    throw new RecusaFerramenta(`A equipe assumiu esta conversa agora: não ${oQue}. Não responda mais nada.`);
  }
}

function antigoDe(unidade: string, a: AgendamentoDoSistema): AgendamentoAntigo {
  return { id: a.id, unidade, inicio: String(a.dataHoraInicio), servico: a.servico?.nome ?? null };
}

async function rodar(nome: string, entrada: unknown, ctx: ContextoFerramentas): Promise<unknown> {
  const { agenda, conversa, agora } = ctx;
  switch (nome) {
    case 'ver_servicos': {
      const i = ENTRADAS.ver_servicos.parse(entrada);
      const servicos = await servicosDa(ctx, i.unidade);
      const l = servicos
        .filter((s) => s.visivelParaCliente !== false)
        .map((s) => ({
          id: s.id,
          nome: s.nome,
          categoria: s.categoria ?? null,
          duracao_min: s.duracaoEmMinutos,
          preco: s.preco,
          preco_promocional_hoje: s.valorPromocional ?? null,
        }));
      return l.length ? l : 'Nenhum serviço cadastrado na agenda desta unidade. Não invente serviço nem preço: use passar_para_humano.';
    }
    case 'consultar_horarios': {
      const i = ENTRADAS.consultar_horarios.parse(entrada);
      if (i.data < dataISO(agora)) throw new RecusaFerramenta(`Essa data já passou (hoje é ${dataISO(agora)}). Ofereça um dia de hoje em diante.`);
      if (i.data > dataISO(new Date(agora.getTime() + 120 * DIA))) throw new RecusaFerramenta('A agenda só abre até 120 dias à frente. Ofereça uma data mais próxima.');
      // Serviço que não existe nesta unidade: avisa em vez de devolver "nenhum horário".
      const servicos = await servicosDa(ctx, i.unidade).catch(() => null);
      if (servicos && !servicos.some((s) => s.id === i.servico_id)) {
        throw new RecusaFerramenta(`O serviço ${i.servico_id} não existe na agenda de ${unidadeDe(i.unidade).nome}. Use ver_servicos para pegar o id certo; se ela pediu algo que não existe aí, diga que não fazemos esse serviço nessa unidade.`);
      }
      const livres = await horariosLivres(agenda, i.unidade, i.data, i.servico_id, i.profissional_id ?? undefined, agora);
      const feriado = feriadoNacional(i.data);
      const dia = new Date(`${i.data}T12:00:00-03:00`).getUTCDay();
      const fechadoNoCadastro = !unidadeDe(i.unidade).horario[dia as 0];
      if (!livres.length) {
        return `Nenhum horário livre nesse dia para esse serviço${fechadoNoCadastro ? ' (pelo cadastro, a unidade não abre nesse dia da semana)' : ''}${feriado ? ` (é feriado: ${feriado})` : ''}. Ofereça outro dia.`;
      }
      if (feriado) return { aviso: `Esse dia é feriado (${feriado}). Avise a cliente e confirme que ela quer mesmo esse dia.`, horarios: livres };
      return livres;
    }
    case 'ver_agendamentos_da_cliente': {
      const i = ENTRADAS.ver_agendamentos_da_cliente.parse(entrada);
      const { clienteId, lista } = await agendamentosDa(ctx, i.unidade, 60);
      if (!clienteId) return 'Cliente ainda não tem cadastro na agenda do salão.';
      return lista.length
        ? lista.map((a) => ({
            id: a.id,
            servico: a.servico?.nome,
            profissional: a.profissional?.nome,
            inicio: a.dataHoraInicio,
            status: a.status?.nome,
          }))
        : 'Nenhum horário marcado.';
    }
    case 'registrar_etapa': {
      const i = ENTRADAS.registrar_etapa.parse(entrada);
      ctx.acoes.push({ tipo: 'etapa', etapa: i.etapa, motivo: i.motivo });
      return 'ok';
    }
    case 'agendar': {
      const i = ENTRADAS.agendar.parse(entrada);
      await exigirEscritaComIa(ctx, 'agende');
      const hora = i.hora.padStart(5, '0');
      if (deDataEHora(i.data, hora).getTime() <= agora.getTime()) throw new RecusaFerramenta('Esse horário já passou. Ofereça um horário de agora em diante.');
      const chave = `${i.unidade}|${i.data}|${hora}|${i.servico_id}|${i.profissional_id}`;
      // Mesma chamada de novo nesta resposta: devolve o que já foi feito (nunca marca duas vezes).
      const ja = ctx.sessao?.feitos.get(chave);
      if (ja) return ja;
      // Horários que ela já tem: o mesmo horário (tentativa repetida depois de uma falha) = já está marcado.
      let existentes: { clienteId: number | null; lista: AgendamentoDoSistema[] } = { clienteId: null, lista: [] };
      try {
        existentes = await agendamentosDa(ctx, i.unidade);
      } catch {
        /* sem a lista, segue: o sistema ainda recusa conflito */
      }
      const igual = existentes.lista.find((a) => mesmoHorario(a, i.data, hora) && (a.servico?.id === undefined || a.servico.id === i.servico_id));
      if (igual && existentes.clienteId) {
        const r = await resultadoDeExistente(ctx, i, igual, existentes.clienteId);
        ctx.sessao?.feitos.set(chave, r);
        return r;
      }
      if (existentes.lista.length && !i.ja_conferiu_agendamentos) {
        const l = existentes.lista.slice(0, 5).map((a) => `${a.servico?.nome ?? 'horário'} em ${String(a.dataHoraInicio).replace('T', ' ').slice(0, 16)} (id ${a.id})`);
        throw new RecusaFerramenta(
          `Ela já tem horário marcado: ${l.join('; ')}. Pergunte se quer MAIS um horário (aí chame agendar de novo com ja_conferiu_agendamentos=true) ou se quer trocar o que já tem (use remarcar_agendamento).`,
        );
      }
      if (!(await conferirLivre(ctx, i.unidade, i.data, hora, i.servico_id, i.profissional_id))) {
        throw new RecusaFerramenta(`O horário ${hora} de ${i.data} não está mais livre.${await alternativas(ctx, i.unidade, i.data, i.servico_id)} Peça desculpas e ofereça outro.`);
      }
      const r = await agendarComConferencia(ctx, i, hora);
      ctx.sessao?.feitos.set(chave, r);
      return r;
    }
    case 'remarcar_agendamento': {
      const i = ENTRADAS.remarcar_agendamento.parse(entrada);
      await exigirEscritaComIa(ctx, 'remarque');
      if (!i.cliente_confirmou) throw new RecusaFerramenta('Antes de remarcar, confirme com a cliente o horário antigo e o novo. Chame de novo só depois que ela disser que sim.');
      const { sistema } = agendaDaUnidade(agenda, i.unidade);
      if (!sistema.cancelarAgendamento) throw new RecusaFerramenta('Esta agenda ainda não deixa a IA cancelar horário. Use passar_para_humano para a equipe remarcar.');
      const hora = i.hora.padStart(5, '0');
      if (deDataEHora(i.data, hora).getTime() <= agora.getTime()) throw new RecusaFerramenta('O horário novo já passou. Ofereça um horário de agora em diante.');
      const { clienteId, lista } = await agendamentosDa(ctx, i.unidade);
      const atual = lista.find((a) => a.id === i.agendamento_id);
      if (!atual || !clienteId) throw new RecusaFerramenta('Esse horário não está entre os horários futuros desta cliente. Use ver_agendamentos_da_cliente para pegar o id certo.');
      if (mesmoHorario(atual, i.data, hora)) throw new RecusaFerramenta('O horário novo é igual ao atual: nada a remarcar.');
      const chave = `remarcar|${i.agendamento_id}|${i.data}|${hora}`;
      const ja = ctx.sessao?.feitos.get(chave);
      if (ja) return ja;
      if (!(await conferirLivre(ctx, i.unidade, i.data, hora, i.servico_id, i.profissional_id))) {
        throw new RecusaFerramenta(`O horário ${hora} de ${i.data} não está livre.${await alternativas(ctx, i.unidade, i.data, i.servico_id)} O horário antigo continua marcado.`);
      }
      // Marca o novo ANTES de cancelar o antigo: se algo falhar no meio, a cliente nunca fica sem horário.
      const novo = await agendarComConferencia(ctx, { ...i, nome_cliente: conversa.nome ?? 'Cliente' }, hora);
      const acaoNova = ctx.acoes.pop() as Extract<AcaoAgente, { tipo: 'agendou' }>;
      let cancelou = true;
      let erroCancelar: string | undefined;
      try {
        await sistema.cancelarAgendamento(agendaDaUnidade(agenda, i.unidade).local, i.agendamento_id);
      } catch (e) {
        cancelou = false;
        erroCancelar = e instanceof Error ? e.message : String(e);
      }
      ctx.acoes.push({ tipo: 'remarcou', antigo: antigoDe(i.unidade, atual), agendamento: acaoNova.agendamento, clienteTrinksId: acaoNova.clienteTrinksId, cancelouAntigo: cancelou, ...(erroCancelar ? { erroCancelar } : {}) });
      const r = {
        ...(novo as object),
        remarcado: true,
        antigo_cancelado: cancelou,
        ...(cancelou ? {} : { aviso: 'O horário novo está marcado, mas o antigo não foi cancelado: a equipe foi avisada para cancelar. Diga à cliente que o novo está confirmado.' }),
      };
      ctx.sessao?.feitos.set(chave, r);
      return r;
    }
    case 'cancelar_agendamento': {
      const i = ENTRADAS.cancelar_agendamento.parse(entrada);
      await exigirEscritaComIa(ctx, 'cancele');
      if (!i.cliente_confirmou) throw new RecusaFerramenta('Antes de cancelar, ofereça remarcar e confirme com a cliente qual horário ela quer cancelar. Chame de novo só depois do sim.');
      const { sistema, local } = agendaDaUnidade(agenda, i.unidade);
      if (!sistema.cancelarAgendamento) throw new RecusaFerramenta('Esta agenda ainda não deixa a IA cancelar horário. Use passar_para_humano para a equipe cancelar.');
      const chave = `cancelar|${i.agendamento_id}`;
      const ja = ctx.sessao?.feitos.get(chave);
      if (ja) return ja;
      const { lista } = await agendamentosDa(ctx, i.unidade);
      const atual = lista.find((a) => a.id === i.agendamento_id);
      if (!atual) throw new RecusaFerramenta('Esse horário não está entre os horários futuros desta cliente (talvez já tenha sido cancelado). Use ver_agendamentos_da_cliente.');
      await sistema.cancelarAgendamento(local, i.agendamento_id);
      const restam = lista.filter((a) => a.id !== i.agendamento_id).length;
      ctx.acoes.push({ tipo: 'cancelou', antigo: antigoDe(i.unidade, atual), motivo: i.motivo, restam });
      const r = { ok: true, cancelado: atual.dataHoraInicio, servico: atual.servico?.nome ?? null, outros_horarios_marcados: restam };
      ctx.sessao?.feitos.set(chave, r);
      return r;
    }
    case 'passar_para_humano': {
      const i = ENTRADAS.passar_para_humano.parse(entrada);
      if (!ctx.podeEscrever) throw new RecusaFerramenta('Modo sugestão: apenas sugira que alguém da equipe continue.');
      ctx.acoes.push({ tipo: 'passar_para_humano', motivo: i.motivo });
      return 'ok: a equipe foi avisada. Diga à cliente que alguém da equipe vai continuar o atendimento.';
    }
    case 'marcar_tag': {
      const i = z.object({ nome: z.string() }).parse(entrada);
      const alvo = i.nome.trim().toLowerCase();
      const existente = (ctx.tagsDisponiveis ?? []).find((n) => n.toLowerCase() === alvo);
      if (!existente) throw new RecusaFerramenta('Essa tag não existe. Use só as tags da lista; a IA não cria tags.');
      if (!ctx.acoes.some((a) => a.tipo === 'marcar_tag' && a.nome === existente)) ctx.acoes.push({ tipo: 'marcar_tag', nome: existente });
      return 'ok';
    }
    default:
      if (FERRAMENTAS_CRM_NOMES.has(nome)) {
        if (!ctx.crm) throw new RecusaFerramenta('Esta ferramenta não está disponível agora.');
        return rodarFerramentaCrm(nome, entrada, { ...ctx, crm: ctx.crm });
      }
      throw new RecusaFerramenta(`Ferramenta desconhecida: ${nome}`);
  }
}

type PedidoIa = { unidade: string; servico_id: number; profissional_id: number; data: string; nome_cliente: string };

/**
 * Grava na agenda. Se a agenda falhar sem dizer "ocupado" (tempo esgotado, erro do servidor), confere se o horário
 * entrou mesmo assim antes de dizer que não deu: a cliente nunca recebe "não consegui" com o horário marcado.
 * Sempre registra a ação "agendou" (o remarcar troca pela dele).
 */
async function agendarComConferencia(ctx: ContextoFerramentas, i: PedidoIa, hora: string): Promise<unknown> {
  try {
    const r = await agendar(
      ctx.agenda,
      ctx.conversa,
      { unidade: i.unidade, servicoId: i.servico_id, profissionalId: i.profissional_id, data: i.data, hora, nomeCliente: i.nome_cliente, origem: 'IA via WhatsApp' },
      ctx.agora,
    );
    ctx.acoes.push({ tipo: 'agendou', clienteTrinksId: r.clienteTrinksId, agendamento: r.agendamento });
    return { ok: true, agendamento_id: r.agendamento.trinksId, servico: r.agendamento.servico, profissional: r.agendamento.profissional, data: i.data, hora, valor: r.valor };
  } catch (e) {
    if (e instanceof ErroAgendamento) {
      if (e.codigo === 'horario_ocupado') throw new RecusaFerramenta(`${e.message}${await alternativas(ctx, i.unidade, i.data, i.servico_id)}`);
      throw e;
    }
    if (e instanceof ErroAgenda && e.status === 409) throw new RecusaFerramenta(`Horário ocupado.${await alternativas(ctx, i.unidade, i.data, i.servico_id)}`);
    // Falha "no escuro": confere se entrou.
    try {
      const { clienteId, lista } = await agendamentosDa(ctx, i.unidade);
      const entrou = clienteId ? lista.find((a) => mesmoHorario(a, i.data, hora)) : undefined;
      if (entrou && clienteId) return resultadoDeExistente(ctx, i, entrou, clienteId);
    } catch {
      /* a agenda segue fora: cai no erro abaixo */
    }
    throw e;
  }
}

/** Horário que já estava (ou entrou) na agenda: devolve como agendado, sem gravar de novo. */
async function resultadoDeExistente(ctx: ContextoFerramentas, i: PedidoIa, a: AgendamentoDoSistema, clienteId: number): Promise<unknown> {
  const inicio = horaDoSistema(a.dataHoraInicio) ?? new Date(`${String(a.dataHoraInicio).replace(' ', 'T').slice(0, 16)}:00-03:00`);
  const agendamento: Agendamento = {
    trinksId: a.id,
    unidade: i.unidade,
    servico: a.servico?.nome ?? 'Serviço',
    profissional: a.profissional?.nome ?? undefined,
    inicio,
    duracaoMin: a.duracaoEmMinutos,
  };
  ctx.acoes.push({ tipo: 'agendou', clienteTrinksId: clienteId, agendamento });
  return { ok: true, ja_estava_marcado: true, agendamento_id: a.id, servico: agendamento.servico, profissional: agendamento.profissional ?? null, data: dataISO(inicio), hora: horaHHmm(inicio), valor: a.valor };
}

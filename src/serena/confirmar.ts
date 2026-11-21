import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import { textoConfirmacao } from '../agenda/agendar.js';
import type { FonteAgenda } from '../agenda/sistema.js';
import type { ServicosCrmIa } from '../ai/crm-ia.js';
import { executarFerramenta, novaSessao, type AcaoAgente } from '../ai/ferramentas.js';
import { PREFIXO_NOTA_IA } from '../ai/prompt.js';
import type { Sintonia } from '../app/sintonia.js';
import { ehGestor, escopoDe, podeVer } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import { ehCanalTeste } from '../channels/teste.js';
import { nomeEhReal, nomeOuTelefone } from '../contatos/nome.js';
import type { Auditoria } from '../seguranca/auditoria.js';
import type { Repositorio } from '../store/repositorio.js';
import { montarTexto, sorteador } from '../transmissoes/texto.js';
import { ErroTransmissao, type Transmissoes } from '../transmissoes/transmissoes.js';
import { LIMITES } from '../transmissoes/tipos.js';
import { unidadeDe } from '../unidades.js';
import { dataISO } from '../util/tempo.js';
import { LIMITE_DIRETO, LIMITE_ENVIO, LIMITE_MOVER, quandoCurto, type PodeFazer } from './fazer.js';
import { aplicarMudanca } from './mudar.js';

/**
 * serena-faz: o "Confirmar" dos cartões de ação da Serena (POST /api/serena/confirmar).
 * Nada aqui confia no cartão: confere de novo quem pede, o que ela vê (podeVer), as permissões
 * (Responder, Mover etapas, Transmissões; várias de uma vez só a gestão) e faz pelos caminhos de sempre:
 * - envio: até 20 clientes, uma a uma pelo caminho da equipe (Sintonia.equipeEnviou), com intervalo entre
 *   as mensagens, limite por dia e sem quem pediu para sair; mais de 20, vira uma Transmissão (fila com ritmo,
 *   limite por número, descadastro);
 * - agenda: as mesmas funções da IA do WhatsApp (src/ai/ferramentas.ts: confere o horário de novo, não marca
 *   duas vezes, espera no máximo 25 s) e depois os efeitos de sempre (funil, lembretes);
 * - mover: o mesmo mover da tela (com o motivo da perda).
 * Cada ação fica na conversa (nota "Serena (a pedido de Fulana) …" ou a própria mensagem com esse autor),
 * num evento "serena_acao" e na auditoria.
 */

/** O que a Serena usa para ler e fazer (montado no index.ts; nos testes, dublês). */
export interface ServicosSerenaFaz {
  agenda?: FonteAgenda;
  crm?: Pick<ServicosCrmIa, 'funis' | 'motivosPerda' | 'produtos'>;
  descadastrado?: (telefone: string) => Promise<boolean>;
  /** Move como a tela move (com o motivo da perda antes). */
  mover?: (c: Conversa, funilId: string, etapaId: string, perda: { motivo: string; detalhe?: string } | null, por: { nome: string; id: string | null }) => Promise<{ mudou: boolean }>;
  /** Mais de 20 clientes: cria e começa uma transmissão. */
  transmitir?: TransmitirSerena;
  prazoAgendaMs?: number;
}

export type TransmitirSerena = (p: { unidade: string; nome: string; conversas: string[]; texto: string; por: string }) => Promise<{ id: string; nome: string; status: string; selecionados: number }>;

/** O que esta pessoa pode pedir (a mesma regra vale para as ferramentas e para o Confirmar). */
export function podeFazerDe(req: FastifyRequest): PodeFazer {
  const gestao = !req.usuario || ehGestor(req.usuario);
  const enviar = pode(req, 'responder');
  const mover = pode(req, 'crm_mover');
  return { enviar, enviarVarias: enviar && gestao, transmitir: enviar && pode(req, 'transmissoes'), mover, moverVarias: mover && gestao };
}

// ---------------------------------------------------------------- envio aos poucos (até 20)

/**
 * Fila do envio direto: uma mensagem por vez, com intervalo sorteado (o mesmo da transmissão pela API não oficial,
 * 8–25 s) e limite por dia. Fica em memória: se o servidor reiniciar no meio, as que faltavam não saem
 * (nunca saem duas vezes).
 */
export class EnvioAosPoucos {
  private corrente: Promise<void> = Promise.resolve();
  private contagem = { dia: '', n: 0 };
  readonly limiteDia: number;

  constructor(
    private readonly o: { limiteDia?: number; intervaloMs?: () => number; esperar?: (ms: number) => Promise<void>; agora?: () => Date; log?: (msg: string, extra?: unknown) => void } = {},
  ) {
    this.limiteDia = o.limiteDia ?? 100;
  }

  private hoje() {
    const d = dataISO((this.o.agora ?? (() => new Date()))());
    if (this.contagem.dia !== d) this.contagem = { dia: d, n: 0 };
    return this.contagem;
  }

  restamHoje(): number {
    return Math.max(0, this.limiteDia - this.hoje().n);
  }

  /** Reserva até `n` envios de hoje; devolve quantos couberam. */
  reservar(n: number): number {
    const c = this.hoje();
    const ok = Math.max(0, Math.min(n, this.limiteDia - c.n));
    c.n += ok;
    return ok;
  }

  /** Devolve envios reservados que não vão sair. */
  devolver(n: number): void {
    const c = this.hoje();
    c.n = Math.max(0, c.n - n);
  }

  private intervalo(): number {
    if (this.o.intervaloMs) return this.o.intervaloMs();
    const { intervaloMin, intervaloMax } = LIMITES.nao_oficial;
    return Math.round((intervaloMin + Math.random() * (intervaloMax - intervaloMin)) * 1000);
  }

  /** Põe as tarefas na fila, com o intervalo ANTES de cada uma. */
  enfileirar(tarefas: Array<() => Promise<void>>): void {
    const esperar = this.o.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms).unref?.()));
    for (const t of tarefas) {
      this.corrente = this.corrente
        .then(() => esperar(this.intervalo()))
        .then(t)
        .catch((e) => this.o.log?.('Serena: falha num envio da fila', String(e)));
    }
  }

  /** Para os testes: espera a fila andar até o fim. */
  ocioso(): Promise<void> {
    return this.corrente;
  }
}

// ---------------------------------------------------------------- transmissão (mais de 20)

/** Mais de 20 clientes: uma transmissão por unidade, pelo caminho de sempre (público = a lista; ritmo, limite e descadastro de lá). */
export function transmitirPelaSerena(t: Transmissoes): TransmitirSerena {
  return async (p) => {
    const n = t.numeroDaUnidade(p.unidade);
    const nomeU = unidadeDe(p.unidade).nome;
    if (!n) throw new ErroTransmissao(`A unidade ${nomeU} não tem WhatsApp conectado.`);
    const tipo = ehCanalTeste(n.canalId) ? 'teste' : n.canal.tipo;
    if (tipo === 'meta') throw new ErroTransmissao(`A unidade ${nomeU} usa a API oficial do WhatsApp: mensagem em massa só com modelo aprovado. Faça pela tela Transmissões.`);
    const publico = { conversas: p.conversas, origemLista: 'Serena', excluirRecebeuDias: 7, excluirConversaAberta: true };
    const previa = await t.previaPublico(p.unidade, publico);
    if (!previa.selecionados) throw new ErroTransmissao('Ninguém da lista pode receber agora (pediu para sair, recebeu transmissão nos últimos 7 dias ou está conversando agora).', 409);
    const c = await t.criar({ nome: p.nome, unidade: p.unidade, canal: 'nao_oficial', publico, mensagem: { texto: p.texto } }, p.por);
    const iniciada = await t.iniciar(c.id);
    return { id: c.id, nome: c.nome, status: iniciada.status, selecionados: previa.selecionados };
  };
}

// ---------------------------------------------------------------- rota

export interface OpcoesSerenaFaz {
  repo: Repositorio;
  empresaId: string;
  sintonia: Pick<Sintonia, 'equipeEnviou' | 'equipeAgendou' | 'equipeMudouAgenda' | 'conferirVez'>;
  servicos: ServicosSerenaFaz;
  auditoria?: Auditoria;
  envio?: EnvioAosPoucos;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

const Id = z.string().trim().min(1).max(100);
const ConfirmaEnvio = z.object({
  texto: z.string().trim().max(4000).default(''),
  itens: z.array(z.object({ conversaId: Id, texto: z.string().trim().max(4000).nullish() })).min(1, 'A lista ficou vazia.').max(LIMITE_ENVIO),
  assunto: z.string().trim().max(80).nullish(),
});
const ConfirmaAgenda = z.object({
  acao: z.enum(['agendar', 'remarcar', 'cancelar']),
  conversaId: Id,
  unidade: z.string().trim().min(1).max(60),
  servicoId: z.number().int().nullish(),
  profissionalId: z.number().int().nullish(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  hora: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
  agendamentoId: z.number().int().nullish(),
  motivo: z.string().trim().max(300).default(''),
  nomeCliente: z.string().trim().min(1).max(120).default('Cliente'),
  enviarConfirmacao: z.boolean().default(false),
});
const ConfirmaMover = z.object({
  funilId: Id,
  etapaId: Id,
  perda: z.object({ motivo: z.string().trim().min(1).max(60), detalhe: z.string().trim().max(300).nullish() }).nullish(),
  itens: z.array(z.object({ conversaId: Id })).min(1, 'A lista ficou vazia.').max(LIMITE_MOVER),
});
const Pedido = z.object({ tipo: z.enum(['envio', 'agendamento', 'mover', 'mudar']), dados: z.unknown() });

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

export function registrarSerenaFaz(app: FastifyInstance, o: OpcoesSerenaFaz): void {
  const agora = o.agora ?? (() => new Date());
  const envio = o.envio ?? new EnvioAosPoucos({ log: o.log });
  const s = o.servicos;

  async function conversaVisivel(req: FastifyRequest, id: string): Promise<Conversa | undefined> {
    const c = await o.repo.buscarConversa(id).catch(() => undefined);
    if (!c || c.empresaId !== o.empresaId || (req.usuario && !podeVer(req.usuario, c))) return undefined;
    return c;
  }
  const porQuem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const autorDe = (req: FastifyRequest) => `Serena (a pedido de ${porQuem(req)})`;
  const nota = (c: Conversa, texto: string) =>
    o.repo.adicionarMensagem({ conversaId: c.id, autor: 'sistema', texto: `${PREFIXO_NOTA_IA}${texto}`, em: agora() }).catch((e) => o.log?.('Serena: falha ao anotar na conversa', String(e)));
  const evento = (req: FastifyRequest, c: Conversa, dados: Record<string, unknown>) =>
    o.repo
      .registrarEvento({ tipo: 'serena_acao', conversaId: c.id, unidade: c.unidade, em: agora(), dados: { ...dados, porId: req.usuario?.id ?? null, porNome: porQuem(req) } })
      .catch((e) => o.log?.('Serena: falha ao registrar o evento', String(e)));
  const auditar = (req: FastifyRequest, acao: string, alvo: string, detalhe: Record<string, unknown>) =>
    o.auditoria
      ?.registrar({ empresaId: o.empresaId, acao, autorId: req.usuario?.id ?? null, autorNome: porQuem(req), papel: req.usuario?.papel ?? null, alvo, detalhe, ip: req.ip, em: agora() })
      .catch((e) => o.log?.('Serena: falha na auditoria', String(e)));

  // ------------------------------------------------------------ envio
  async function confirmarEnvio(req: FastifyRequest, bruto: unknown) {
    const p = podeFazerDe(req);
    if (!p.enviar) throw erro('Você não tem permissão para responder clientes. Fale com a gestão.', 403);
    const d = ConfirmaEnvio.parse(bruto);
    const vistos = new Set<string>();
    const itens = d.itens.filter((i) => !vistos.has(i.conversaId) && vistos.add(i.conversaId));
    if (itens.length > 1 && !p.enviarVarias) throw erro('Mandar para várias clientes de uma vez é da gestão. Mande para uma por vez.', 403);
    const fora: Array<{ nome: string; motivo: string }> = [];
    const alvos: Array<{ c: Conversa; texto: string; proprio: boolean }> = [];
    for (const i of itens) {
      const c = await conversaVisivel(req, i.conversaId);
      if (!c) {
        fora.push({ nome: i.conversaId.slice(0, 8), motivo: 'não encontrada' });
        continue;
      }
      if (await s.descadastrado?.(c.telefone).catch(() => false)) {
        fora.push({ nome: nomeOuTelefone(c.nome, c.telefone), motivo: 'pediu para não receber' });
        continue;
      }
      const texto = i.texto?.trim() || d.texto;
      if (!texto) throw erro(`Falta o texto para ${nomeOuTelefone(c.nome, c.telefone)}.`, 400);
      alvos.push({ c, texto, proprio: Boolean(i.texto?.trim()) });
    }
    if (!alvos.length) throw erro('Ninguém da lista pode receber (não encontradas ou pediram para sair).', 409);
    const nomes = alvos.map((a) => a.c.id);

    // Mais de 20: transmissão (uma por unidade).
    if (alvos.length > LIMITE_DIRETO) {
      if (!p.transmitir) throw erro(`Mais de ${LIMITE_DIRETO} clientes vira transmissão, e você não tem a permissão de Transmissões.`, 403);
      if (!s.transmitir) throw erro('As transmissões não estão ligadas neste servidor.', 501);
      if (alvos.some((a) => a.proprio)) throw erro(`Para mais de ${LIMITE_DIRETO} clientes use um texto só (com {primeiro_nome}).`, 400);
      const porUnidade = new Map<string, string[]>();
      for (const a of alvos) porUnidade.set(a.c.unidade, [...(porUnidade.get(a.c.unidade) ?? []), a.c.id]);
      const minhas = escopoDe(req.usuario).unidades;
      if (minhas && [...porUnidade.keys()].some((u) => !minhas.includes(u))) throw erro('Você só faz transmissões das suas unidades.', 403);
      const transmissoes = [];
      for (const [unidade, conversas] of porUnidade) {
        const nome = `Serena: ${d.assunto || 'mensagem'} (a pedido de ${porQuem(req)})`.slice(0, 80);
        transmissoes.push({ unidade: unidadeDe(unidade).nome, ...(await s.transmitir({ unidade, nome, conversas, texto: d.texto, por: porQuem(req) })) });
      }
      for (const a of alvos) await evento(req, a.c, { acao: 'transmissao', transmissoes: transmissoes.map((t) => t.id) });
      await auditar(req, 'serena_envio', `${alvos.length} conversas`, { modo: 'transmissao', conversas: nomes, transmissoes: transmissoes.map((t) => t.id) });
      const n = transmissoes.reduce((t, x) => t + x.selecionados, 0);
      return {
        ok: true,
        modo: 'transmissao',
        transmissoes,
        fora,
        resumo: `Transmissão criada para ${n} cliente${n === 1 ? '' : 's'}: sai aos poucos, no ritmo seguro do número. Acompanhe em Transmissões.`,
      };
    }

    // Até 20: uma a uma, pelo caminho da equipe.
    const cabem = envio.reservar(alvos.length);
    if (cabem < alvos.length) {
      envio.devolver(cabem);
      throw erro(`Hoje só dá para a Serena mandar mais ${cabem} mensage${cabem === 1 ? 'm' : 'ns'} direto (limite do dia, para proteger o número). Use Transmissões para mais.`, 429);
    }
    const autor = autorDe(req);
    const falhas: Array<{ nome: string; erro: string }> = [];
    const mandar = async (a: { c: Conversa; texto: string }) => {
      const final = montarTexto(a.texto, { nome: nomeEhReal(a.c.nome) ? a.c.nome : '', telefone: a.c.telefone, unidade: unidadeDe(a.c.unidade).nome }, sorteador(a.c.id));
      await o.sintonia.equipeEnviou(a.c.id, final, autor, req.usuario);
      await evento(req, a.c, { acao: 'enviou', texto: final.slice(0, 300) });
    };
    const [primeira, ...resto] = alvos;
    let enviadas = 0;
    try {
      await mandar(primeira!);
      enviadas = 1;
    } catch (e) {
      if (alvos.length === 1) throw e; // uma só: o motivo volta direto para a tela
      falhas.push({ nome: nomeOuTelefone(primeira!.c.nome, primeira!.c.telefone), erro: (e as Error).message });
    }
    envio.enfileirar(
      resto.map((a) => async () => {
        await mandar(a).catch((e) => {
          o.log?.('Serena: envio não saiu', { conversa: a.c.id, erro: String(e) });
          void nota(a.c, `${autor} tentou mandar uma mensagem e não saiu (${String((e as Error)?.message ?? e).slice(0, 120)}).`);
        });
      }),
    );
    await auditar(req, 'serena_envio', `${alvos.length} conversa${alvos.length === 1 ? '' : 's'}`, { modo: 'direto', conversas: nomes });
    const resumo =
      alvos.length === 1
        ? 'Mensagem enviada ✓'
        : `${enviadas ? 'A primeira já saiu' : 'A primeira não saiu'}; as outras ${resto.length} vão uma a uma nos próximos minutos (intervalo para o WhatsApp não bloquear o número).`;
    return { ok: true, modo: 'direto', enviadas, naFila: resto.length, fora, falhas, resumo };
  }

  // ------------------------------------------------------------ agenda
  async function confirmarAgenda(req: FastifyRequest, bruto: unknown) {
    const d = ConfirmaAgenda.parse(bruto);
    if (!s.agenda) throw erro('A agenda não está configurada (Conexões › Agenda).', 501);
    const c = await conversaVisivel(req, d.conversaId);
    if (!c) throw erro('Cliente não encontrada.', 404);
    const p = podeFazerDe(req);
    const confirmar = d.enviarConfirmacao && d.acao !== 'cancelar';
    if (confirmar && !p.enviar) throw erro('Você não tem permissão para responder clientes. Desmarque "mandar confirmação" ou fale com a gestão.', 403);
    if (req.usuario) await o.sintonia.conferirVez(c.id, req.usuario);
    const autor = autorDe(req);
    const acoes: AcaoAgente[] = [];
    const ctx = { agenda: s.agenda, conversa: c, agora: agora(), acoes, podeEscrever: true, sessao: novaSessao(), prazoAgendaMs: s.prazoAgendaMs, origemAgendamento: `Serena a pedido de ${porQuem(req)}` };
    const falta = () => erro('Faltam serviço, profissional, dia e hora.', 400);
    let r: { conteudo: string; erro: boolean };
    if (d.acao === 'agendar') {
      if (!d.servicoId || !d.profissionalId || !d.data || !d.hora) throw falta();
      // A pessoa viu o cartão (com os horários que a cliente já tem): é MAIS um horário.
      r = await executarFerramenta('agendar', { unidade: d.unidade, servico_id: d.servicoId, profissional_id: d.profissionalId, data: d.data, hora: d.hora, nome_cliente: d.nomeCliente.length >= 3 ? d.nomeCliente : 'Cliente', ja_conferiu_agendamentos: true }, ctx);
    } else if (d.acao === 'remarcar') {
      if (!d.servicoId || !d.profissionalId || !d.data || !d.hora || !d.agendamentoId) throw falta();
      r = await executarFerramenta('remarcar_agendamento', { unidade: d.unidade, agendamento_id: d.agendamentoId, servico_id: d.servicoId, profissional_id: d.profissionalId, data: d.data, hora: d.hora, cliente_confirmou: true }, ctx);
    } else {
      if (!d.agendamentoId) throw erro('Falta o horário a cancelar.', 400);
      r = await executarFerramenta('cancelar_agendamento', { unidade: d.unidade, agendamento_id: d.agendamentoId, motivo: d.motivo || `Pedido por ${porQuem(req)}`, cliente_confirmou: true }, ctx);
    }
    if (r.erro) {
      const msg = r.conteudo.startsWith('A agenda do salão não respondeu') ? 'A agenda do salão não respondeu agora. Nada foi marcado; tente de novo em instantes.' : r.conteudo.replace(/ ?Peça desculpas e ofereça outro\.?/, '').replace(/ ?Use passar_para_humano[^.]*\.?/, '');
      throw erro(msg, 409);
    }
    const resultado = JSON.parse(r.conteudo) as { valor?: number };
    const nome = nomeOuTelefone(c.nome, c.telefone);
    let resumo = '';
    let mensagem: string | undefined;
    const agendou = acoes.find((a): a is Extract<AcaoAgente, { tipo: 'agendou' }> => a.tipo === 'agendou');
    const mudou = acoes.filter((a): a is Extract<AcaoAgente, { tipo: 'remarcou' | 'cancelou' }> => a.tipo === 'remarcou' || a.tipo === 'cancelou');
    if (agendou) {
      await o.sintonia.equipeAgendou(c.id, agendou, autor, req.usuario);
      const ag = agendou.agendamento;
      await nota(c, `${autor} agendou ${ag.servico} para ${quandoCurto(dataISO(ag.inicio), d.hora ?? '00:00')}${ag.profissional ? ` com ${ag.profissional}` : ''} (${unidadeDe(ag.unidade).nome}).`);
      resumo = `Agendado ✓ ${ag.servico}, ${quandoCurto(dataISO(ag.inicio), d.hora ?? '00:00')}${ag.profissional ? ` com ${ag.profissional}` : ''}.`;
      if (confirmar) mensagem = textoConfirmacao(c.nome ?? d.nomeCliente, { agendamento: ag, valor: resultado.valor ?? 0, clienteTrinksId: agendou.clienteTrinksId });
    }
    if (mudou.length) {
      await o.sintonia.equipeMudouAgenda(c.id, mudou, autor, req.usuario);
      const m = mudou[0]!;
      if (m.tipo === 'remarcou') {
        resumo = `Remarcado ✓ para ${quandoCurto(dataISO(m.agendamento.inicio), d.hora ?? '00:00')}${m.cancelouAntigo ? '' : ' (o horário antigo não foi cancelado na agenda: cancele à mão)'}.`;
        if (confirmar) mensagem = textoConfirmacao(c.nome ?? d.nomeCliente, { agendamento: m.agendamento, valor: 0, clienteTrinksId: m.clienteTrinksId });
      } else resumo = 'Horário cancelado ✓';
    }
    let aviso: string | undefined;
    if (mensagem) {
      try {
        await o.sintonia.equipeEnviou(c.id, mensagem, autor, req.usuario);
      } catch (e) {
        aviso = `A confirmação para a cliente não saiu (${(e as Error).message}). Avise por outro jeito.`;
      }
    }
    await evento(req, c, { acao: d.acao === 'agendar' ? 'agendou' : d.acao === 'remarcar' ? 'remarcou' : 'cancelou', unidade: d.unidade, data: d.data ?? null, hora: d.hora ?? null, agendamentoId: d.agendamentoId ?? null });
    await auditar(req, 'serena_agendamento', `conversa ${c.id}`, { acao: d.acao, unidade: d.unidade, data: d.data ?? null, hora: d.hora ?? null });
    return { ok: true, resumo: `${resumo}${mensagem && !aviso ? ' Confirmação enviada para a cliente.' : ''}`, cliente: nome, ...(aviso ? { aviso } : {}) };
  }

  // ------------------------------------------------------------ mover
  async function confirmarMover(req: FastifyRequest, bruto: unknown) {
    const p = podeFazerDe(req);
    if (!p.mover) throw erro('Você não pode mudar o CRM. Fale com a gestão.', 403);
    if (!s.mover || !s.crm) throw erro('Mover pelo chat não está ligado neste servidor.', 501);
    const d = ConfirmaMover.parse(bruto);
    const ids = [...new Set(d.itens.map((i) => i.conversaId))];
    if (ids.length > 1 && !p.moverVarias) throw erro('Mover várias conversas de uma vez é da gestão. Mova uma por vez.', 403);
    const funil = (await s.crm.funis()).find((f) => f.id === d.funilId);
    const etapa = funil?.etapas.find((e) => e.id === d.etapaId);
    if (!funil || !etapa) throw erro('Esse funil ou etapa não existe mais.', 404);
    let perda: { motivo: string; detalhe?: string } | null = null;
    let motivoNome = '';
    if (etapa.perda) {
      const m = (await s.crm.motivosPerda()).find((x) => x.id === d.perda?.motivo);
      if (!m) throw erro(`"${etapa.nome}" é etapa de perda: escolha o motivo.`, 400);
      if (m.pedeTexto && !d.perda?.detalhe?.trim()) throw erro(`O motivo "${m.nome}" pede um detalhe.`, 400);
      perda = { motivo: m.id, ...(d.perda?.detalhe?.trim() ? { detalhe: d.perda.detalhe.trim() } : {}) };
      motivoNome = m.nome;
    }
    const autor = autorDe(req);
    let movidas = 0;
    const falhas: Array<{ nome: string; erro: string }> = [];
    for (const id of ids) {
      const c = await conversaVisivel(req, id);
      if (!c) {
        falhas.push({ nome: id.slice(0, 8), erro: 'não encontrada' });
        continue;
      }
      try {
        const r = await s.mover(c, funil.id, etapa.id, perda, { nome: autor, id: req.usuario?.id ?? null });
        if (r.mudou) movidas++;
        await nota(c, `${autor} moveu para "${etapa.nome}" (${funil.nome})${perda ? `. Motivo: ${motivoNome}${perda.detalhe ? ` — ${perda.detalhe}` : ''}` : ''}.`);
        await evento(req, c, { acao: 'moveu', funilId: funil.id, etapaId: etapa.id, etapa: etapa.nome, perda });
      } catch (e) {
        falhas.push({ nome: nomeOuTelefone(c.nome, c.telefone), erro: (e as Error).message });
      }
    }
    if (ids.length === 1 && falhas.length) throw erro(`Não deu para mover: ${falhas[0]!.erro}`, 409);
    await auditar(req, 'serena_mover', `${ids.length} conversa${ids.length === 1 ? '' : 's'}`, { funilId: funil.id, etapaId: etapa.id, conversas: ids, perda });
    const resumo = `${movidas === ids.length - falhas.length ? 'Pronto ✓' : 'Feito ✓'} ${ids.length - falhas.length} conversa${ids.length - falhas.length === 1 ? '' : 's'} em "${etapa.nome}".${falhas.length ? ` ${falhas.length} não deu.` : ''}`;
    return { ok: true, movidas, falhas, resumo };
  }

  // ------------------------------------------------------------ serena-super: o resto (tarefa, etiqueta, transferir…)
  // Chama a rota da tela de sempre (só as da lista em src/serena/mudar.ts), com o login de quem confirmou:
  // a permissão e as conferências da rota valem de novo.
  async function confirmarMudanca(req: FastifyRequest, bruto: unknown) {
    const chamar = async (metodo: string, url: string, corpo?: unknown) => {
      const r = await app.inject({
        method: metodo as 'GET',
        url,
        ...(corpo !== undefined ? { payload: corpo as Record<string, unknown> } : {}),
        headers: { ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}), 'user-agent': 'Serena (Confirmar)', 'x-serena': '1' },
      });
      let c: unknown = null;
      try {
        c = r.body ? r.json() : null;
      } catch {
        c = r.body;
      }
      return { status: r.statusCode, corpo: c };
    };
    const r = await aplicarMudanca(chamar, bruto);
    for (const id of r.conversas) {
      const c = await conversaVisivel(req, id);
      if (c) await evento(req, c, { acao: r.acao });
    }
    // Na auditoria vai o que mudou (sem o texto inteiro do treinamento nem dado de cliente).
    const detalhe = Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v]));
    await auditar(req, `serena_${r.acao}`, r.conversas.length ? `${r.conversas.length} conversa${r.conversas.length === 1 ? '' : 's'}` : r.acao, detalhe);
    return { ok: true, resumo: r.resumo, falhas: r.falhas.map((erro) => ({ nome: '', erro })) };
  }

  app.post('/api/serena/confirmar', async (req) => {
    const b = Pedido.parse(req.body);
    if (b.tipo === 'envio') return confirmarEnvio(req, b.dados);
    if (b.tipo === 'agendamento') return confirmarAgenda(req, b.dados);
    if (b.tipo === 'mudar') return confirmarMudanca(req, b.dados);
    return confirmarMover(req, b.dados);
  });
}

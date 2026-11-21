import { beforeEach, describe, expect, it } from 'vitest';
import { Agente, TEXTO_PASSAGEM, type ClienteClaude } from '../src/ai/agente.js';
import { executarFerramenta, novaSessao, type AcaoAgente, type ContextoFerramentas } from '../src/ai/ferramentas.js';
import { ArmazemTarefasIaMemoria, montarCrmIa, type CrmIa, type FunilIa } from '../src/ai/crm-ia.js';
import { feriadoNacional, GuardaCusto, partirParaWhatsApp, precosDoTexto, precosInventados } from '../src/ai/guarda.js';
import { estadoIa } from '../src/ai/estado-ia.js';
import { limparSaudeAgenda, situacaoDaAgenda } from '../src/ai/saude-agenda.js';
import { ErroAgenda, type AgendamentoDoSistema, type DadosNovoAgendamento } from '../src/agenda/sistema.js';
import { FilaIa } from '../src/app/fila-ia.js';
import { PercepcaoIa } from '../src/app/percepcao.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp, MensagemRecebida, MidiaEnvio } from '../src/channels/tipos.js';
import { TranscricoesMemoria } from '../src/conversa/transcricao.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemCadastroMemoria } from '../src/empresa/cadastro.js';
import { ArmazemFunisMemoria, Funis } from '../src/funis/funis.js';
import { ArmazemPerdasMemoria } from '../src/perdas/armazem.js';
import { Perdas } from '../src/perdas/perdas.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { ArmazemTagsMemoria, Tags } from '../src/tags/tags.js';
import { bahia, MIN } from '../src/util/tempo.js';
import { configPadrao, type AgenteIa } from '../src/agentes-ia/tipos.js';

/**
 * ia-completa: a IA de atendimento de ponta a ponta, com IA falsa determinística (roteiro de respostas) e agenda falsa.
 * Cada `describe` é uma das falhas possíveis da lista do pedido (ver o relatório da branch claude/ia-completa).
 */

// ---------------------------------------------------------------- dublês

type Resposta = Record<string, unknown>;
type Passo = Resposta | ((pedido: Record<string, unknown>) => Resposta | Promise<Resposta>);

/** IA falsa: devolve os passos na ordem e guarda o que recebeu. */
function roteiro(passos: Passo[]) {
  const recebidos: Array<Record<string, unknown>> = [];
  const cliente = {
    recebidos,
    passos,
    beta: {
      messages: {
        create: (async (p: Record<string, unknown>) => {
          recebidos.push(structuredClone(p));
          const passo = passos.shift();
          if (!passo) throw new Error('roteiro acabou');
          return typeof passo === 'function' ? passo(p) : passo;
        }) as never,
      },
    },
  };
  return cliente as typeof cliente & ClienteClaude;
}
let nTool = 0;
const usa = (name: string, input: unknown): Resposta => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${++nTool}`, name, input }] });
const fala = (text: string): Resposta => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
/** Resultados de ferramenta que a IA recebeu no pedido de índice `i`. */
const resultados = (p: Record<string, unknown>) => {
  const ult = (p.messages as Array<{ role: string; content: unknown }>).at(-1)!;
  return Array.isArray(ult.content) ? (ult.content as Array<{ type: string; content?: string; is_error?: boolean; text?: string }>) : [];
};
const textoDoPedido = (p: Record<string, unknown>) => JSON.stringify(p.messages);

interface Marcado {
  id: number;
  clienteId: number;
  servicoId: number;
  profissionalId: number;
  data: string;
  hora: string;
  cancelado: boolean;
}

/** Agenda falsa no formato do Trinks, com falhas sob encomenda. */
class AgendaFalsa {
  readonly sistema = 'trinks' as const;
  servicos = [
    { id: 1, nome: 'Progressiva', duracaoEmMinutos: 180, preco: 320, valorPromocional: null },
    { id: 2, nome: 'Escova', duracaoEmMinutos: 60, preco: 80, valorPromocional: null },
  ];
  profissionais = [
    { id: 7, nome: 'Jéssica' },
    { id: 8, nome: 'Ana' },
  ];
  horarios = ['09:00', '10:00', '14:00', '16:00'];
  marcados: Marcado[] = [];
  clientes = new Map<string, number>();
  falha: null | 'fora' | 'lenta' | 'grava_e_falha' = null;
  /** A lista de horários livres não vê o que foi ocupado (o sistema só recusa ao gravar). */
  listaDesatualizada = false;
  cancelamentos: number[] = [];
  private seq = 500;

  private async checar() {
    if (this.falha === 'fora') throw new ErroAgenda(503, 'Trinks fora do ar (503)');
    if (this.falha === 'lenta') await new Promise(() => {});
  }
  private ocupado(data: string, hora: string, prof: number) {
    return this.marcados.some((m) => !m.cancelado && m.data === data && m.hora === hora && m.profissionalId === prof);
  }
  ocupar(data: string, hora: string, prof: number) {
    this.marcados.push({ id: ++this.seq, clienteId: 999, servicoId: 1, profissionalId: prof, data, hora, cancelado: false });
  }
  marcarPara(telefone: string, data: string, hora: string, servicoId = 1, prof = 7) {
    if (!this.clientes.has(telefone)) this.clientes.set(telefone, 55);
    const id = ++this.seq;
    this.marcados.push({ id, clienteId: this.clientes.get(telefone)!, servicoId, profissionalId: prof, data, hora, cancelado: false });
    return id;
  }
  async listarServicos() {
    await this.checar();
    return this.servicos;
  }
  async listarProfissionais() {
    await this.checar();
    return this.profissionais;
  }
  async horariosVagos(_l: string, data: string, f?: { profissionalId?: number }) {
    await this.checar();
    return this.profissionais
      .filter((p) => !f?.profissionalId || p.id === f.profissionalId)
      .map((p) => ({ id: p.id, nome: p.nome, horariosVagos: this.horarios.filter((h) => this.listaDesatualizada || !this.ocupado(data, h, p.id)) }));
  }
  async buscarClientePorTelefone(_l: string, tel: string) {
    await this.checar();
    const id = this.clientes.get(tel);
    return id ? { id, nome: 'Marina' } : null;
  }
  async criarCliente(_l: string, _nome: string, tel: string) {
    this.clientes.set(tel, 55);
    return 55;
  }
  async criarAgendamento(_l: string, d: DadosNovoAgendamento) {
    if (this.falha === 'fora') throw new ErroAgenda(503, 'Trinks fora do ar (503)');
    if (this.ocupado(d.data, d.hora, d.profissionalId)) throw new ErroAgenda(409, 'Horário indisponível');
    const id = ++this.seq;
    this.marcados.push({ id, clienteId: d.clienteId, servicoId: d.servicoId, profissionalId: d.profissionalId, data: d.data, hora: d.hora, cancelado: false });
    if (this.falha === 'grava_e_falha') throw new Error('socket hang up');
    return id;
  }
  async cancelarAgendamento(_l: string, id: number) {
    await this.checar();
    const m = this.marcados.find((x) => x.id === id);
    if (m) m.cancelado = true;
    this.cancelamentos.push(id);
  }
  async listarAgendamentosDoCliente(_l: string, clienteId: number): Promise<AgendamentoDoSistema[]> {
    await this.checar();
    return this.marcados
      .filter((m) => m.clienteId === clienteId)
      .map((m) => {
        const s = this.servicos.find((x) => x.id === m.servicoId)!;
        return {
          id: m.id,
          cancelado: m.cancelado,
          servico: { id: s.id, nome: s.nome },
          profissional: { id: m.profissionalId, nome: this.profissionais.find((p) => p.id === m.profissionalId)?.nome },
          dataHoraInicio: `${m.data}T${m.hora}:00`,
          duracaoEmMinutos: s.duracaoEmMinutos,
          valor: s.preco,
        };
      });
  }
  /** Marcados ativos desta cliente (55). */
  ativos() {
    return this.marcados.filter((m) => m.clienteId === 55 && !m.cancelado);
  }
}

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ telefone: string; texto: string }> = [];
  midias: Array<MidiaEnvio> = [];
  fora = false;
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, texto: string) {
    if (this.fora) throw new Error('WhatsApp desconectado');
    this.enviados.push({ telefone, texto });
    return { idExterno: `out-${this.enviados.length}` };
  }
  async enviarMidia(_c: string, _t: string, m: MidiaEnvio) {
    if (this.fora) throw new Error('WhatsApp desconectado');
    this.midias.push(m);
    return { idExterno: `midia-${this.midias.length}` };
  }
}

/** CRM falso (pipelines, produtos, arquivos) que guarda o que a Sintonia aplicou. */
function crmFalso() {
  const feitos: Array<{ acao: string; dados: unknown }> = [];
  const funis: FunilIa[] = [
    {
      id: 'f-sis',
      nome: 'Atendimento',
      sistema: true,
      etapas: [
        { id: 'e-int', nome: 'Interessada', perda: false, chave: 'interessada' },
        { id: 'e-age', nome: 'Agendada', perda: false, chave: 'agendada' },
      ],
    },
    {
      id: 'f1',
      nome: 'Vendas de produtos',
      sistema: false,
      etapas: [
        { id: 'e1', nome: 'Proposta', perda: false, chave: null },
        { id: 'e2', nome: 'Perdido', perda: true, chave: null },
      ],
    },
  ];
  const crm: CrmIa & { feitos: typeof feitos } = {
    feitos,
    funis: async () => funis,
    ondeEsta: async () => [{ funilId: 'f1', etapaId: 'e1' }],
    motivosPerda: async () => [
      { id: 'preco', nome: 'Preço', pedeTexto: false },
      { id: 'outro', nome: 'Outro', pedeTexto: true },
    ],
    produtos: async () => [
      { id: 'p1', nome: 'Kit Home Care', tipo: 'produto', categoria: 'Cuidados', preco: 150, duracaoMin: null, descricao: 'Shampoo e máscara', temFoto: true },
      { id: 'p2', nome: 'Tratamento sob medida', tipo: 'servico', categoria: null, preco: null, duracaoMin: 90, descricao: '', temFoto: false },
    ],
    documentos: async () => [{ id: 'd1', nome: 'Catálogo 2026', categoria: 'catalogo', descricao: '' }],
    moverFunil: async (_c, a) => (feitos.push({ acao: 'mover', dados: a }), true),
    vincularProduto: async (_c, produtoId, quantidade) => void feitos.push({ acao: 'vincular', dados: { produtoId, quantidade } }),
    criarTarefa: async (_c, t) => (feitos.push({ acao: 'tarefa', dados: t }), { responsavel: 'Gil' }),
    arquivo: async (_c, origem, id) => (feitos.push({ acao: 'arquivo', dados: { origem, id } }), { conteudo: Buffer.from('foto'), mimetype: 'image/jpeg', tipo: 'imagem' as const }),
  };
  return crm;
}

const BASE = 'Progressiva a partir de R$ 320. Escova R$ 80.';
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);
const TEL = '5571988124471';
let seq = 0;
const msg = (texto: string, em: Date, extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  canalId: 'imperio-norte',
  telefone: TEL,
  nome: 'Marina',
  texto,
  deMim: false,
  idExterno: `in-${++seq}`,
  em,
  ...extra,
});

interface OpcoesMontar {
  passos?: Passo[];
  agora?: Date;
  fila?: boolean;
  juntarMs?: number;
  crm?: CrmIa;
  guarda?: GuardaCusto;
  percepcao?: PercepcaoIa;
  maxPassos?: number;
  /** Chamado a cada espera (juntar mensagens / mídia baixando). */
  aoEsperar?: (ms: number) => Promise<void>;
}

function montar(o: OpcoesMontar = {}) {
  const repo = new RepositorioMemoria();
  const canal = new CanalFalso();
  const relogio = { t: o.agora ?? quinta(10) };
  const agenda = new AgendaFalsa();
  const claude = roteiro(o.passos ?? []);
  const agente = new Agente(claude, agenda, BASE, { modelo: 'claude-opus-5-5', esforco: 'low', crm: () => o.crm, prazoAgendaMs: 50, maxPassos: o.maxPassos });
  const avisos: string[] = [];
  const esperas: number[] = [];
  let s!: Sintonia;
  const fila = o.fila ? new FilaIa({ pensar: (id) => s.pensar(id), paralelo: 4 }) : undefined;
  s = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente,
    agora: () => relogio.t,
    configIa: async () => ({ modoPadrao: 'ia' }),
    avisarEquipe: async (t) => void avisos.push(t),
    ...(fila ? { filaIa: fila } : {}),
    juntarMs: o.juntarMs ?? 0,
    esperar: async (ms) => {
      esperas.push(ms);
      relogio.t = new Date(relogio.t.getTime() + ms);
      await o.aoEsperar?.(ms);
    },
    ...(o.crm ? { crmIa: o.crm } : {}),
    ...(o.guarda ? { guardaCusto: o.guarda } : {}),
    ...(o.percepcao ? { percepcao: o.percepcao } : {}),
  });
  const conversa = async () => (await repo.listarConversas())[0]!;
  /** Recebe e espera a IA terminar (com ou sem fila). */
  const receber = async (texto: string, extra: Partial<MensagemRecebida> = {}) => {
    await s.receber(msg(texto, relogio.t, extra));
    await fila?.ocioso();
  };
  return { s, repo, canal, relogio, agenda, claude, avisos, esperas, fila, conversa, receber };
}

beforeEach(() => limparSaudeAgenda());

// ---------------------------------------------------------------- 1. fluxo completo

describe('Conversa completa: tirar dúvida, consultar, confirmar e agendar', () => {
  it('consulta serviços e horários, confirma com a cliente e só então marca; funil e lembretes acompanham', async () => {
    const m = montar({
      passos: [
        usa('ver_servicos', { unidade: 'norte' }),
        usa('consultar_horarios', { unidade: 'norte', data: '2026-11-07', servico_id: 1, profissional_id: null }),
        fala('Tenho sábado às 14h com a Jéssica, a progressiva sai por R$ 320. Posso marcar?'),
        usa('agendar', { unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '14:00', nome_cliente: 'Marina Souza', ja_conferiu_agendamentos: false }),
        fala('Prontinho, Marina! Sábado às 14h com a Jéssica.'),
      ],
    });
    await m.receber('oi, queria fazer progressiva sábado à tarde');
    expect(m.canal.enviados.map((e) => e.texto)).toEqual(['Tenho sábado às 14h com a Jéssica, a progressiva sai por R$ 320. Posso marcar?']);
    expect(m.agenda.ativos()).toHaveLength(0);
    m.relogio.t = quinta(10, 5);
    await m.receber('pode marcar sim');
    expect(m.agenda.ativos()).toMatchObject([{ data: '2026-11-07', hora: '14:00', profissionalId: 7 }]);
    const c = await m.conversa();
    expect(c.etapa).toBe('agendada');
    expect((await m.repo.tarefasPendentes(c.id)).map((t) => t.tipo).sort()).toEqual(['lembrete_2h', 'lembrete_vespera']);
    expect(m.canal.enviados.at(-1)!.texto).toBe('Prontinho, Marina! Sábado às 14h com a Jéssica.');
    expect(situacaoDaAgenda('norte')?.ok).toBe(true);
  });
});

// ---------------------------------------------------------------- 2. agenda fora

describe('Falha: agenda fora do ar, lenta ou com erro', () => {
  it('Trinks fora: a IA recebe a ordem de não inventar, passa para a equipe e a equipe é avisada', async () => {
    const m = montar({
      passos: [
        usa('consultar_horarios', { unidade: 'norte', data: '2026-11-07', servico_id: 1, profissional_id: null }),
        (p) => {
          const r = resultados(p)[0]!;
          expect(r.is_error).toBe(true);
          expect(r.content).toContain('NÃO invente');
          return usa('passar_para_humano', { motivo: 'A agenda não respondeu.' });
        },
        fala('Vou confirmar os horários com a equipe e já te respondem.'),
      ],
    });
    m.agenda.falha = 'fora';
    await m.receber('tem horário sábado?');
    const c = await m.conversa();
    expect(c.modo).toBe('humano');
    expect(m.avisos).toHaveLength(1);
    expect(situacaoDaAgenda('norte')).toMatchObject({ ok: false });
  });

  it('agenda lenta: tempo esgotado vira a mesma orientação (a resposta não fica presa)', async () => {
    const m = montar({ passos: [usa('ver_servicos', { unidade: 'norte' }), (p) => (expect(resultados(p)[0]!.content).toContain('tempo esgotado'), fala('Vou confirmar com a equipe.'))] });
    m.agenda.falha = 'lenta';
    await m.receber('quanto é a escova?');
    expect(m.canal.enviados).toHaveLength(1);
  });

  it('erro "no escuro" ao gravar (o horário entrou mesmo assim): confere e não diz que falhou nem marca de novo', async () => {
    const m = montar({
      passos: [
        usa('agendar', { unidade: 'norte', servico_id: 2, profissional_id: 8, data: '2026-11-07', hora: '10:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false }),
        (p) => (expect(JSON.parse(resultados(p)[0]!.content!)).toMatchObject({ ok: true, ja_estava_marcado: true }), fala('Prontinho, sábado às 10h!')),
      ],
    });
    m.agenda.falha = 'grava_e_falha';
    await m.receber('pode marcar a escova sábado 10h com a Ana');
    expect(m.agenda.ativos()).toHaveLength(1);
    expect((await m.conversa()).etapa).toBe('agendada');
  });
});

// ---------------------------------------------------------------- 3. corrida e idempotência

describe('Falha: horário ocupado entre consultar e agendar (corrida)', () => {
  it('confere antes de gravar e oferece os que sobraram', async () => {
    const m = montar({
      passos: [
        (p) => {
          m.agenda.ocupar('2026-11-07', '14:00', 7); // outra pessoa marcou enquanto a cliente pensava
          void p;
          return usa('agendar', { unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '14:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false });
        },
        (p) => {
          const r = resultados(p)[0]!;
          expect(r.is_error).toBe(true);
          expect(r.content).toContain('não está mais livre');
          expect(r.content).toContain('16:00');
          return fala('Poxa, esse horário acabou de ser ocupado. Tenho às 16h, serve?');
        },
      ],
    });
    await m.receber('pode ser sábado 14h');
    expect(m.agenda.ativos()).toHaveLength(0);
    expect(m.canal.enviados.at(-1)!.texto).toContain('16h');
  });

  it('a lista de horários não viu, mas o sistema recusou (409): mesma orientação', async () => {
    const m = montar({
      passos: [
        usa('agendar', { unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '14:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false }),
        (p) => (expect(resultados(p)[0]!.content).toMatch(/ocupad/), fala('Esse horário foi ocupado agora. Posso ver outro?')),
      ],
    });
    m.agenda.ocupar('2026-11-07', '14:00', 7);
    m.agenda.listaDesatualizada = true;
    await m.receber('sábado 14h');
    expect(m.agenda.ativos()).toHaveLength(0);
  });
});

describe('Falha: agendar duas vezes o mesmo horário (idempotência)', () => {
  it('a mesma chamada repetida na mesma resposta marca uma vez só', async () => {
    const pedido = { unidade: 'norte', servico_id: 2, profissional_id: 8, data: '2026-11-07', hora: '09:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false };
    const m = montar({ passos: [usa('agendar', pedido), usa('agendar', pedido), fala('Marcado!')] });
    await m.receber('marca escova sábado 9h com a Ana');
    expect(m.agenda.ativos()).toHaveLength(1);
  });

  it('nova tentativa depois de uma falha (ela já tem aquele horário): devolve o que já está marcado', async () => {
    const m = montar({
      passos: [
        usa('agendar', { unidade: 'norte', servico_id: 2, profissional_id: 8, data: '2026-11-07', hora: '09:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false }),
        (p) => (expect(JSON.parse(resultados(p)[0]!.content!)).toMatchObject({ ja_estava_marcado: true }), fala('Já está marcado para sábado às 9h!')),
      ],
    });
    m.agenda.marcarPara(TEL, '2026-11-07', '09:00', 2, 8);
    await m.receber('marca escova sábado 9h');
    expect(m.agenda.ativos()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 4. mensagens seguidas e mensagem durante o pensar

describe('Falha: cliente manda várias mensagens seguidas', () => {
  it('espera ela parar de escrever e responde tudo numa resposta só', async () => {
    const proximas = ['tudo bem?', 'quanto custa a escova?'];
    let m!: ReturnType<typeof montar>;
    m = montar({
      fila: true,
      juntarMs: 6000,
      passos: [fala('Oi, Marina! Tudo ótimo. A escova sai por R$ 80.')],
      aoEsperar: async () => {
        const t = proximas.shift();
        if (t) await m.s.receber(msg(t, m.relogio.t));
      },
    });
    await m.receber('oi');
    expect(m.claude.recebidos).toHaveLength(1);
    const visto = textoDoPedido(m.claude.recebidos[0]!);
    for (const t of ['oi', 'tudo bem?', 'quanto custa a escova?']) expect(visto).toContain(t);
    expect(m.canal.enviados).toHaveLength(1);
    expect(m.esperas.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Falha: mensagem nova enquanto a IA ainda pensa', () => {
  it('a resposta antiga é descartada e a IA pensa de novo com tudo (uma resposta só sai)', async () => {
    let m!: ReturnType<typeof montar>;
    m = montar({
      fila: true,
      passos: [
        async () => {
          m.relogio.t = new Date(m.relogio.t.getTime() + 2000);
          await m.s.receber(msg('ah, e pode ser sábado?', m.relogio.t));
          return fala('Resposta que ficou velha');
        },
        fala('Sábado tenho às 14h. Quer?'),
      ],
    });
    await m.receber('tem horário essa semana?');
    expect(m.canal.enviados.map((e) => e.texto)).toEqual(['Sábado tenho às 14h. Quer?']);
    expect(textoDoPedido(m.claude.recebidos[1]!)).toContain('pode ser sábado?');
  });
});

describe('Falha: a equipe assume a conversa no meio', () => {
  it('a IA para na hora: não agenda, não responde e não gasta mais chamadas', async () => {
    let m!: ReturnType<typeof montar>;
    m = montar({
      fila: true,
      passos: [
        async () => {
          // A atendente respondeu pelo celular enquanto a IA pensava.
          await m.s.receber(msg('Oi Marina, aqui é a Carla, já te ajudo!', m.relogio.t, { deMim: true, idExterno: 'cel-1' }));
          return usa('agendar', { unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '14:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false });
        },
        fala('não deveria sair'),
      ],
    });
    await m.receber('marca sábado 14h');
    expect(m.agenda.ativos()).toHaveLength(0);
    expect(m.canal.enviados).toHaveLength(0);
    expect(m.claude.recebidos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 5. pedir humano, fora do horário, outra unidade

describe('Falha: cliente pede humano, reclama ou está brava', () => {
  for (const texto of ['quero falar com uma atendente, por favor', 'que ABSURDO, péssimo atendimento!!!']) {
    it(`"${texto}": passa para a equipe sem chamar a IA, com aviso`, async () => {
      const m = montar();
      await m.receber(texto);
      expect(m.claude.recebidos).toHaveLength(0);
      expect(m.canal.enviados.map((e) => e.texto)).toEqual([TEXTO_PASSAGEM]);
      const c = await m.conversa();
      expect(c.modo).toBe('humano');
      expect(c.etiquetas).toContain('precisa da equipe');
      expect(m.avisos).toHaveLength(1);
    });
  }
});

describe('Falha: fora do horário de atendimento', () => {
  it('de madrugada a IA responde e sabe quando a equipe volta', async () => {
    const m = montar({ agora: quinta(2), passos: [fala('Oi! Posso te ajudar por aqui mesmo.')] });
    await m.receber('oi, tá aberto?');
    const ctx = textoDoPedido(m.claude.recebidos[0]!);
    expect(ctx).toContain('fora do horário de atendimento');
    expect(ctx).toContain('volta hoje às 10:00');
    expect(m.canal.enviados).toHaveLength(1);
  });
});

describe('Falha: número de uma unidade, cliente quer outra', () => {
  it('a IA conhece as outras unidades e marca na que a cliente escolheu', async () => {
    const m = montar({
      passos: [
        (p) => (expect(textoDoPedido(p)).toContain('Shopping Sumaré (sumare)'), usa('agendar', { unidade: 'sumare', servico_id: 2, profissional_id: 7, data: '2026-11-07', hora: '10:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false })),
        fala('Marcado no Sumaré, sábado às 10h!'),
      ],
    });
    await m.receber('prefiro no Sumaré, sábado 10h, escova');
    const ev = (await m.repo.eventosEntre(quinta(0), quinta(23))).find((e) => e.tipo === 'agendamento_ia');
    expect(ev?.unidade).toBe('norte'); // a conversa continua sendo do número que recebeu
    const c = await m.conversa();
    expect(c.etapa).toBe('agendada');
  });
});

// ---------------------------------------------------------------- 6. ferramentas: validações

describe('Falhas de dados: unidade sem agenda, serviço inexistente, data passada/inválida/feriado, já tem horário', () => {
  const conversa: Conversa = { id: 'c1', empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: TEL, nome: 'Marina', modo: 'ia', etapa: 'em_conversa', etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9) };
  const ctx = (agenda: AgendaFalsa, extra: Partial<ContextoFerramentas> = {}): ContextoFerramentas => ({ agenda, conversa, agora: quinta(10), acoes: [], podeEscrever: true, sessao: novaSessao(), prazoAgendaMs: 50, ...extra });

  it('unidade sem agenda: explica e sugere as que agendam', async () => {
    const r = await executarFerramenta('consultar_horarios', { unidade: 'feira', data: '2026-11-07', servico_id: 1, profissional_id: null }, ctx(new AgendaFalsa()));
    expect(r.erro).toBe(true);
    expect(r.conteudo).toContain('Não ofereça horário');
    expect(r.conteudo).toContain('Salvador Norte Shopping');
  });

  it('serviço que não existe na unidade', async () => {
    const r = await executarFerramenta('consultar_horarios', { unidade: 'norte', data: '2026-11-07', servico_id: 99, profissional_id: null }, ctx(new AgendaFalsa()));
    expect(r).toMatchObject({ erro: true });
    expect(r.conteudo).toContain('não existe');
  });

  it('data no passado, inválida ou longe demais', async () => {
    const a = new AgendaFalsa();
    expect((await executarFerramenta('consultar_horarios', { unidade: 'norte', data: '2026-11-01', servico_id: 1, profissional_id: null }, ctx(a))).conteudo).toContain('já passou');
    expect((await executarFerramenta('consultar_horarios', { unidade: 'norte', data: '2026-02-30', servico_id: 1, profissional_id: null }, ctx(a))).conteudo).toContain('não existe no calendário');
    expect((await executarFerramenta('consultar_horarios', { unidade: 'norte', data: '2027-06-01', servico_id: 1, profissional_id: null }, ctx(a))).conteudo).toContain('120 dias');
    expect((await executarFerramenta('agendar', { unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-05', hora: '08:00', nome_cliente: 'Marina' }, ctx(a))).conteudo).toContain('já passou');
  });

  it('feriado: avisa a IA para confirmar com a cliente', async () => {
    const r = await executarFerramenta('consultar_horarios', { unidade: 'norte', data: '2026-11-20', servico_id: 1, profissional_id: null }, ctx(new AgendaFalsa()));
    expect(JSON.parse(r.conteudo)).toMatchObject({ aviso: expect.stringContaining('Consciência Negra') });
    expect(feriadoNacional('2026-02-16')).toBe('Carnaval');
    expect(feriadoNacional('2026-04-03')).toBe('Sexta-feira Santa');
    expect(feriadoNacional('2026-11-06')).toBeNull();
  });

  it('cliente que já tem horário: pergunta se é mais um ou troca; confirmado, marca', async () => {
    const a = new AgendaFalsa();
    a.marcarPara(TEL, '2026-11-10', '09:00');
    const pedido = { unidade: 'norte', servico_id: 2, profissional_id: 8, data: '2026-11-07', hora: '10:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false };
    const r = await executarFerramenta('agendar', pedido, ctx(a));
    expect(r.erro).toBe(true);
    expect(r.conteudo).toContain('já tem horário marcado');
    expect(r.conteudo).toContain('remarcar_agendamento');
    const ok = await executarFerramenta('agendar', { ...pedido, ja_conferiu_agendamentos: true }, ctx(a));
    expect(ok.erro).toBe(false);
    expect(a.ativos()).toHaveLength(2);
  });

  it('modo sugestão e conversa que a equipe assumiu nunca gravam na agenda', async () => {
    const a = new AgendaFalsa();
    const pedido = { unidade: 'norte', servico_id: 2, profissional_id: 8, data: '2026-11-07', hora: '10:00', nome_cliente: 'Marina' };
    expect((await executarFerramenta('agendar', pedido, ctx(a, { podeEscrever: false }))).conteudo).toContain('Modo sugestão');
    expect((await executarFerramenta('agendar', pedido, ctx(a, { aindaComIa: async () => false }))).conteudo).toContain('equipe assumiu');
    expect(a.marcados).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- 7. resposta longa, preço inventado, laço

describe('Falha: resposta muito longa', () => {
  it('sem markdown e em no máximo 3 mensagens curtas', async () => {
    const longo = `**Oi, Marina!** ${'A progressiva deixa o cabelo liso e brilhante por meses. '.repeat(30)}\n\n## Cuidados\n${'Use shampoo sem sal. '.repeat(40)}`;
    const m = montar({ passos: [fala(longo)] });
    await m.receber('me explica a progressiva');
    expect(m.canal.enviados.length).toBeGreaterThan(1);
    expect(m.canal.enviados.length).toBeLessThanOrEqual(3);
    for (const e of m.canal.enviados) {
      expect(e.texto.length).toBeLessThanOrEqual(700);
      expect(e.texto).not.toContain('**');
      expect(e.texto).not.toMatch(/^##/m);
    }
    const c = await m.conversa();
    expect((await m.repo.mensagens(c.id)).filter((x) => x.autor === 'ia')).toHaveLength(m.canal.enviados.length);
  });

  it('partirParaWhatsApp: texto curto fica como está', () => {
    expect(partirParaWhatsApp('Oi! Tudo bem?')).toEqual(['Oi! Tudo bem?']);
    expect(partirParaWhatsApp('')).toEqual([]);
  });
});

describe('Falha: preço inventado (alucinação)', () => {
  it('valor que não veio do sistema volta para a IA consultar; corrigido, sai', async () => {
    const m = montar({
      passos: [
        fala('A progressiva custa R$ 250.'),
        (p) => (expect(textoDoPedido(p)).toContain('verificação automática'), usa('ver_servicos', { unidade: 'norte' })),
        fala('A progressiva custa R$ 320.'),
      ],
    });
    await m.receber('quanto é a progressiva?');
    expect(m.canal.enviados.map((e) => e.texto)).toEqual(['A progressiva custa R$ 320.']);
  });

  it('se insistir no valor inventado, a equipe confirma o preço', async () => {
    const m = montar({ passos: [fala('Fica R$ 199.'), fala('Fica R$ 199 mesmo.')] });
    await m.receber('quanto é?');
    expect(m.canal.enviados.map((e) => e.texto)).toEqual([TEXTO_PASSAGEM]);
    expect((await m.conversa()).modo).toBe('humano');
  });

  it('regras do conferidor', () => {
    expect(precosDoTexto('R$ 1.250,50 ou 80 reais e R$99')).toEqual([125050, 9900, 8000]);
    const conhecidos = new Set([32000, 8000]);
    expect(precosInventados('Progressiva R$ 320 + escova R$ 80 = R$ 400', conhecidos)).toEqual([]);
    expect(precosInventados('Duas escovas: R$ 160', conhecidos)).toEqual([]);
    expect(precosInventados('Promo de R$ 290', conhecidos)).toEqual([29000]);
  });
});

describe('Falha: laço de ferramentas', () => {
  it('a mesma chamada pela 3ª vez é recusada; passou do limite de passos, a equipe assume', async () => {
    const m = montar({
      maxPassos: 4,
      passos: [
        usa('ver_servicos', { unidade: 'norte' }),
        usa('ver_servicos', { unidade: 'norte' }),
        usa('ver_servicos', { unidade: 'norte' }),
        (p) => (expect(resultados(p)[0]!.content).toContain('já chamou'), usa('ver_servicos', { unidade: 'sumare' })),
      ],
    });
    await m.receber('quais serviços?');
    expect(m.canal.enviados.map((e) => e.texto)).toEqual([TEXTO_PASSAGEM]);
    expect((await m.conversa()).modo).toBe('humano');
  });
});

// ---------------------------------------------------------------- 8. custo, chave, WhatsApp fora

describe('Falha: custo (limite por conversa por dia)', () => {
  it('perto do limite registra aviso; no limite a conversa vai para a equipe sem chamar a IA', async () => {
    const guarda = new GuardaCusto(10_000, () => quinta(10));
    const m = montar({ guarda, passos: [fala('Oi!'), fala('Tudo certo.')] });
    await m.receber('oi');
    const c = await m.conversa();
    guarda.anotar(c.id, { entrada: 8_500, saida: 0, cacheLeitura: 0, cacheEscrita: 0 });
    m.relogio.t = quinta(10, 1);
    await m.receber('e aí?');
    expect((await m.repo.eventosEntre(quinta(0), quinta(23))).some((e) => e.tipo === 'falha' && e.dados?.etapa === 'custo')).toBe(true);
    guarda.anotar(c.id, { entrada: 5_000, saida: 0, cacheLeitura: 0, cacheEscrita: 0 });
    m.relogio.t = quinta(10, 2);
    const chamadas = m.claude.recebidos.length;
    await m.receber('mais uma pergunta');
    expect(m.claude.recebidos).toHaveLength(chamadas);
    expect(m.canal.enviados.at(-1)!.texto).toBe(TEXTO_PASSAGEM);
    expect((await m.conversa()).modo).toBe('humano');
    expect(m.avisos.join(' ')).toContain('limite de uso');
  });
});

describe('Falha: chave da IA inválida', () => {
  it('pausa a IA, a conversa fica com a equipe e a equipe recebe UM aviso', async () => {
    const m = montar({ passos: [() => { throw Object.assign(new Error('401 invalid x-api-key'), { status: 401 }); }] });
    await m.receber('oi');
    expect(m.s.iaPausadaAte()).not.toBeNull();
    expect(m.avisos).toHaveLength(1);
    expect(m.avisos[0]).toContain('Conexões');
    m.relogio.t = quinta(10, 1);
    await m.s.receber(msg('alô', m.relogio.t, { telefone: '5571990000001' }));
    expect(m.avisos).toHaveLength(1);
    expect(m.claude.recebidos).toHaveLength(1);
  });
});

describe('Falha: WhatsApp desconectado na hora de enviar', () => {
  it('o que a IA fez vale, a resposta espera e é reenviada sem pensar de novo (nem agendar duas vezes)', async () => {
    const m = montar({
      passos: [
        usa('agendar', { unidade: 'norte', servico_id: 2, profissional_id: 8, data: '2026-11-07', hora: '10:00', nome_cliente: 'Marina', ja_conferiu_agendamentos: false }),
        fala('Prontinho! Sábado às 10h com a Ana.'),
      ],
    });
    m.canal.fora = true;
    await m.receber('marca a escova sábado 10h com a Ana');
    const c = await m.conversa();
    expect(m.agenda.ativos()).toHaveLength(1);
    expect(c.etapa).toBe('agendada');
    expect((await m.repo.mensagens(c.id)).filter((x) => x.autor === 'ia')).toHaveLength(0);
    const [t] = (await m.repo.tarefasPendentes(c.id)).filter((x) => x.tipo === 'reavaliar');
    expect(t).toBeDefined();
    m.canal.fora = false;
    m.relogio.t = new Date(t!.quando.getTime() + 1000);
    await m.s.tick();
    expect(m.canal.enviados.map((e) => e.texto)).toEqual(['Prontinho! Sábado às 10h com a Ana.']);
    expect(m.claude.recebidos).toHaveLength(2); // não pensou de novo
    expect(m.agenda.ativos()).toHaveLength(1);
    expect((await m.repo.tarefasPendentes(c.id)).some((x) => x.tipo === 'reavaliar')).toBe(false);
  });
});

// ---------------------------------------------------------------- 9. remarcar e cancelar

describe('Remarcar e cancelar pela agenda da unidade', () => {
  it('remarcar: pede confirmação; confirmado, marca o novo, cancela o antigo, refaz lembretes e avisa a equipe', async () => {
    let id = 0;
    const m = montar({
      passos: [
        usa('ver_agendamentos_da_cliente', { unidade: 'norte' }),
        () => usa('remarcar_agendamento', { unidade: 'norte', agendamento_id: id, servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '16:00', cliente_confirmou: false }),
        (p) => (expect(resultados(p)[0]!.content).toContain('confirme com a cliente'), fala('Troco sábado 14h para sábado 16h, confirma?')),
        () => usa('remarcar_agendamento', { unidade: 'norte', agendamento_id: id, servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '16:00', cliente_confirmou: true }),
        fala('Remarcado para sábado às 16h!'),
      ],
    });
    id = m.agenda.marcarPara(TEL, '2026-11-07', '14:00');
    await m.receber('preciso mudar meu horário de sábado para mais tarde');
    expect(m.agenda.cancelamentos).toHaveLength(0);
    m.relogio.t = quinta(10, 3);
    await m.receber('confirmo');
    expect(m.agenda.cancelamentos).toEqual([id]);
    expect(m.agenda.ativos()).toMatchObject([{ data: '2026-11-07', hora: '16:00' }]);
    const c = await m.conversa();
    expect((await m.repo.tarefasPendentes(c.id)).filter((t) => t.tipo === 'lembrete_2h').map((t) => t.quando)).toEqual([bahia(2026, 11, 7, 14)]);
    expect(m.avisos.join(' ')).toContain('remarcou');
    expect((await m.repo.mensagens(c.id)).some((x) => x.autor === 'sistema' && x.texto.includes('IA remarcou'))).toBe(true);
  });

  it('cancelar: só com confirmação; a cliente volta de Agendada para Interessada e a equipe é avisada', async () => {
    let id = 0;
    const m = montar({ passos: [fala('Oi, Marina!'), () => usa('cancelar_agendamento', { unidade: 'norte', agendamento_id: id, motivo: 'Vai viajar', cliente_confirmou: true }), fala('Cancelado. Quando voltar, me chama!')] });
    id = m.agenda.marcarPara(TEL, '2026-11-07', '14:00');
    await m.receber('oi');
    const c = await m.conversa();
    c.etapa = 'agendada';
    await m.repo.salvarConversa(c);
    m.relogio.t = quinta(10, 2);
    await m.receber('vou viajar, pode cancelar meu horário de sábado');
    expect(m.agenda.cancelamentos).toEqual([id]);
    expect((await m.conversa()).etapa).toBe('interessada');
    expect(m.avisos.join(' ')).toContain('cancelou');
  });
});

// ---------------------------------------------------------------- 10. CRM: pipelines, produtos, tarefa, retorno, arquivo

describe('CRM pela IA: pipeline com motivo de perda, produto, tarefa, retorno e foto', () => {
  it('confere tudo antes, a Sintonia aplica depois; o retorno sai no dia combinado', async () => {
    const crm = crmFalso();
    const m = montar({
      crm,
      maxPassos: 14,
      passos: [
        usa('ver_funis', {}),
        usa('mover_no_funil', { funil_id: 'f1', etapa_id: 'e2', motivo: 'Achou caro', motivo_perda_id: null, detalhe_perda: null }),
        (p) => (expect(resultados(p)[0]!.content).toContain('motivo_perda_id'), usa('mover_no_funil', { funil_id: 'f1', etapa_id: 'e2', motivo: 'Achou caro', motivo_perda_id: 'outro', detalhe_perda: null })),
        (p) => (expect(resultados(p)[0]!.content).toContain('pede um detalhe'), usa('mover_no_funil', { funil_id: 'f-sis', etapa_id: 'e-age', motivo: 'x', motivo_perda_id: null, detalhe_perda: null })),
        (p) => (expect(resultados(p)[0]!.content).toContain('muda sozinha'), usa('mover_no_funil', { funil_id: 'f1', etapa_id: 'e2', motivo: 'Achou caro', motivo_perda_id: 'preco', detalhe_perda: null })),
        usa('ver_produtos', { busca: 'kit' }),
        usa('vincular_produto', { produto_id: 'p1', quantidade: 1 }),
        usa('criar_tarefa_equipe', { titulo: 'Enviar proposta do kit', detalhe: 'Ela pediu desconto', prazo_horas: 4, prioridade: 'alta' }),
        usa('agendar_retorno', { data: '2026-11-09', hora: '10:00', motivo: 'ver se decidiu sobre o kit' }),
        usa('enviar_arquivo', { origem: 'foto_produto', id: 'p1', legenda: 'Kit Home Care' }),
        usa('enviar_arquivo', { origem: 'foto_produto', id: 'p2', legenda: null }),
        (p) => (expect(resultados(p)[0]!.content).toContain('não tem foto'), fala('Te mandei a foto do kit, que sai por R$ 150. Segunda te chamo!')),
      ],
    });
    await m.receber('achei caro a progressiva, mas me interessei pelo kit de cuidados');
    expect(crm.feitos.map((f) => f.acao)).toEqual(['mover', 'vincular', 'tarefa', 'arquivo']);
    expect(crm.feitos[0]!.dados).toMatchObject({ funilId: 'f1', etapaId: 'e2', perda: { motivo: 'preco', detalhe: null } });
    expect(m.canal.enviados.at(-1)!.texto).toContain('R$ 150');
    expect(m.canal.midias).toHaveLength(1);
    const c = await m.conversa();
    const retorno = (await m.repo.tarefasPendentes(c.id)).find((t) => t.tipo === 'retorno_ia')!;
    expect(retorno.quando).toEqual(bahia(2026, 11, 9, 10));
    const notas = (await m.repo.mensagens(c.id)).filter((x) => x.autor === 'sistema').map((x) => x.texto);
    expect(notas.join('\n')).toContain('Retorno combinado');
    expect(notas.join('\n')).toContain('Enviar proposta do kit');

    // No dia: a IA volta a falar, sabendo o motivo.
    m.claude.passos.push((p) => (expect(textoDoPedido(p)).toContain('ver se decidiu sobre o kit'), fala('Oi Marina! Conseguiu pensar no kit?')));
    m.relogio.t = bahia(2026, 11, 9, 10, 1);
    await m.s.tick();
    expect(m.canal.enviados.at(-1)!.texto).toBe('Oi Marina! Conseguiu pensar no kit?');
  });

  it('produto sob consulta e preço do cadastro: a IA não pode dizer outro valor', async () => {
    const m = montar({ crm: crmFalso(), passos: [usa('ver_produtos', { busca: null }), fala('O kit sai por R$ 150 e o tratamento é sob consulta.')] });
    await m.receber('quanto é o kit?');
    expect(m.canal.enviados.at(-1)!.texto).toContain('R$ 150');
    const r = JSON.parse(resultados(m.claude.recebidos[1]!)[0]!.content!);
    expect(r.produtos.find((p: { id: string }) => p.id === 'p2').obs).toContain('sob consulta');
  });

  it('montarCrmIa de verdade: perda pela IA fica registrada com o motivo que ela informou', async () => {
    const repo = new RepositorioMemoria();
    const armazemTags = new ArmazemTagsMemoria(() => repo.listarConversas());
    const tags = new Tags(armazemTags, 'imperio');
    const funis = new Funis({ armazem: new ArmazemFunisMemoria(repo, armazemTags), armazemTags, tags, repo, empresaId: 'imperio', comConversa: async (id, fn) => { const c = await repo.buscarConversa(id); return c ? fn(c) : undefined; } });
    const perdas = new Perdas({ armazem: new ArmazemPerdasMemoria(repo), funis, empresaId: 'imperio' });
    const cadastro = new ArmazemCadastroMemoria();
    const p = await cadastro.criarProduto('imperio', { nome: 'Kit', tipo: 'produto', categoria: null, preco: 150, duracaoMin: null, descricao: '', codigo: '', ativo: true }, 'teste');
    await cadastro.gravarFotoProduto('imperio', p.id, { conteudo: Buffer.from('jpg'), tipo: 'image/jpeg' });
    const tarefas = new ArmazemTarefasIaMemoria();
    const crm = montarCrmIa({ empresaId: 'imperio', funis, perdas, cadastro, tarefas, responsavelPadrao: async () => ({ id: 'u-gil', nome: 'Gil' }) });
    const { conversa: c } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: TEL, agora: quinta(9) });
    const f = await funis.criar({ nome: 'Vendas', etapas: [{ nome: 'Proposta' }, { nome: 'Perdido' }] }, 'teste');
    const lista = await crm.funis();
    const perdido = lista.find((x) => x.id === f.id)!.etapas.find((e) => e.nome === 'Perdido')!;
    expect(perdido.perda).toBe(true);
    expect(await crm.moverFunil(c, { tipo: 'mover_funil', funilId: f.id, funil: 'Vendas', etapaId: perdido.id, etapa: 'Perdido', motivo: 'caro', perda: { motivo: 'preco', detalhe: null } })).toBe(true);
    expect((await perdas.dosCartoes(f.id, [c.id]))[c.id]).toMatchObject({ motivo: 'preco', por: 'IA' });
    expect((await crm.produtos())[0]).toMatchObject({ nome: 'Kit', preco: 150, temFoto: true });
    expect(await crm.arquivo(c, 'foto_produto', p.id)).toMatchObject({ tipo: 'imagem', mimetype: 'image/jpeg' });
    expect(await crm.criarTarefa(c, { titulo: 'Ligar', descricao: '', venceEm: null, prioridade: 'normal' })).toEqual({ responsavel: 'Gil' });
    expect(tarefas.criadas[0]).toMatchObject({ responsavelId: 'u-gil', conversaId: c.id, titulo: 'Ligar' });
  });
});

// ---------------------------------------------------------------- 11. áudio e foto

describe('Áudio e foto da cliente', () => {
  it('ouve o áudio (transcreve uma vez e guarda) e vê a foto', async () => {
    const transcricoes = new TranscricoesMemoria();
    const transcritor = { modelo: 'whisper-falso', transcrever: async () => 'quero fazer progressiva no sábado' };
    let repoRef!: RepositorioMemoria;
    const percepcao = new PercepcaoIa({ repo: { midia: (id) => repoRef.midia(id) }, transcricoes, transcritor });
    const m = montar({
      percepcao,
      passos: [
        (p) => {
          const t = textoDoPedido(p);
          expect(t).toContain('transcrição: quero fazer progressiva no sábado');
          expect(t).toContain('"type":"image"');
          return fala('Que lindo seu cabelo! Sábado tenho às 14h.');
        },
      ],
    });
    repoRef = m.repo;
    await m.s.receber(msg('[foto]', m.relogio.t, { anexo: { tipo: 'imagem', mimetype: 'image/jpeg', base64: Buffer.from('jpeg').toString('base64') } }));
    // A IA já respondeu à foto? Não: está no mesmo minuto; esta conversa usa a resposta seguinte.
    m.claude.passos.length = 0;
    m.claude.recebidos.length = 0;
    m.canal.enviados.length = 0;
    m.claude.passos.push((p) => {
      const t = textoDoPedido(p);
      expect(t).toContain('transcrição: quero fazer progressiva no sábado');
      return fala('Sábado tenho às 14h. Quer?');
    });
    m.relogio.t = quinta(10, 1);
    await m.receber('[áudio]', { anexo: { tipo: 'audio', mimetype: 'audio/ogg', voz: true, base64: Buffer.from('ogg').toString('base64') } });
    expect(m.canal.enviados.map((e) => e.texto)).toEqual(['Sábado tenho às 14h. Quer?']);
    const c = await m.conversa();
    expect((await transcricoes.daConversa(c.id)).map((t) => t.texto)).toEqual(['quero fazer progressiva no sábado']);
  });

  it('mídia ainda baixando, que acabou de chegar: espera um pouco antes de responder', async () => {
    let repoRef!: RepositorioMemoria;
    const percepcao = new PercepcaoIa({ repo: { midia: (id) => repoRef.midia(id) }, transcricoes: new TranscricoesMemoria(), transcritor: { modelo: 'x', transcrever: async () => 'oi' } });
    let pend = '';
    const m = montar({
      percepcao,
      passos: [fala('Oi!')],
      aoEsperar: async () => {
        // O download terminou durante a espera.
        if (pend) await repoRef.guardarMidia(pend, { conteudo: Buffer.from('ogg') });
        pend = '';
      },
    });
    repoRef = m.repo;
    // Sem base64: fica "pendente" (o baixador busca depois).
    const canal = m.canal as CanalFalso & { baixarMidia?: unknown };
    canal.baixarMidia = async () => Buffer.from('ogg');
    const original = m.repo.adicionarMensagem.bind(m.repo);
    m.repo.adicionarMensagem = async (x) => {
      if (x.anexo) pend = x.id!;
      return original(x);
    };
    await m.receber('[áudio]', { anexo: { tipo: 'audio', mimetype: 'audio/ogg' } });
    expect(m.esperas).toContain(5000);
    expect(textoDoPedido(m.claude.recebidos[0]!)).toContain('transcrição: oi');
  });
});

// ---------------------------------------------------------------- 12. tela "O que a IA faz"

describe('Estado da IA (tela "O que a IA faz")', () => {
  const agente = (ferramentas: AgenteIa['config']['ferramentas']): AgenteIa => ({
    id: 'a1', empresaId: 'imperio', nome: 'Lia', avatar: '✦', unidades: ['norte'], provedor: 'anthropic', modelo: 'claude-opus-5-5', chaveCifrada: null, criatividade: 50,
    config: { ...configPadrao(), ferramentas }, ativo: true, criadoEm: quinta(9), atualizadoEm: quinta(9), atualizadoPor: null,
  });
  const base = (extra: Partial<Parameters<typeof estadoIa>[0]> = {}): Parameters<typeof estadoIa>[0] => ({
    chaves: () => ({ anthropic: true, openai: false }),
    pausadaAte: () => null,
    agendas: {
      configs: () => [
        { unidade: 'norte', nome: 'Salvador Norte', escolha: 'trinks', sistemaNome: 'Trinks', local: '1', falta: [], conectada: true, pronta: true, aviso: null },
        { unidade: 'feira', nome: 'Feira de Santana', escolha: 'nenhum', sistemaNome: null, local: null, falta: [], conectada: false, pronta: false, aviso: null },
      ],
      sistemaDa: () => ({ testar: async () => { throw new Error('401 chave do Trinks inválida'); } }),
    },
    whatsapp: () => [{ unidade: 'norte', conectado: true }],
    configIa: async () => ({ modoPadrao: 'copiloto', marcarTags: false, assumirSemResposta: { ligado: true, minutos: 15 } }),
    controle: async () => ({}),
    agentes: async () => [agente(['responder', 'consultar_agenda', 'agendar'])],
    transcricao: () => false,
    crm: true,
    limiteConversaDia: 600_000,
    ...extra,
  });

  it('mostra ferramentas por agente, o que falta e testa a agenda na hora', async () => {
    const e = await estadoIa(base(), { testarAgenda: true });
    expect(e.chave.ok).toBe(true);
    expect(e.agendas.find((a) => a.unidade === 'norte')).toMatchObject({ ok: false, texto: expect.stringContaining('401 chave do Trinks') });
    expect(e.agendas.find((a) => a.unidade === 'feira')).toMatchObject({ semAgenda: true });
    expect(e.falta.map((f) => f.texto).join(' ')).toContain('Agenda de Salvador Norte');
    expect(e.sentidos.audio).toBe(false);
    expect(e.padrao.desligadas).toEqual(['marcar_tag', 'lembrete_ligacao']);
    expect(e.agentes[0]!.desligadas).toContain('mover_etapa');
    expect(e.ferramentas.find((f) => f.id === 'agendar')!.nome).toBe('Agendar, remarcar e cancelar');
  });

  it('sem chave e com "Só eu": não está pronta e diz onde resolver', async () => {
    const e = await estadoIa(base({ chaves: () => ({ anthropic: false, openai: false }), configIa: async () => ({ modoPadrao: 'humano', marcarTags: false, assumirSemResposta: { ligado: true, minutos: 15 } }) }));
    expect(e.pronta).toBe(false);
    expect(e.falta.map((f) => f.onde)).toEqual(expect.arrayContaining(['Mais › Conexões', 'Automações › Agente de IA › Configuração']));
  });
});

// ---------------------------------------------------------------- 13. agentes do estúdio também têm as ferramentas

describe('Agentes do estúdio: ferramentas novas por opção', () => {
  it('agendar libera remarcar/cancelar; mover_etapa libera qualquer pipeline; as outras têm opção própria', async () => {
    const { ferramentasPermitidas } = await import('../src/agentes-ia/executor.js');
    const s = ferramentasPermitidas(['responder', 'agendar', 'mover_etapa'], false);
    for (const n of ['remarcar_agendamento', 'cancelar_agendamento', 'ver_funis', 'mover_no_funil', 'ver_produtos']) expect(s.has(n)).toBe(true);
    expect(s.has('criar_tarefa_equipe')).toBe(false);
    const t = ferramentasPermitidas(['responder', 'tarefas', 'retorno', 'enviar_arquivos', 'produtos'], false);
    for (const n of ['criar_tarefa_equipe', 'agendar_retorno', 'enviar_arquivo', 'vincular_produto']) expect(t.has(n)).toBe(true);
  });

  it('agente novo já nasce com todas as ferramentas da IA completa', () => {
    expect(configPadrao().ferramentas).toEqual(expect.arrayContaining(['produtos', 'tarefas', 'retorno', 'enviar_arquivos']));
  });
});

// Marca de uso para o tipo (evita import "não usado" quando o TS remove tipos).
export type _Uso = AcaoAgente | typeof MIN;

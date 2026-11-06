import { describe, expect, it } from 'vitest';
import { Agente, TEXTO_PASSAGEM } from '../src/ai/agente.js';
import type { Agenda } from '../src/ai/ferramentas.js';
import { historicoParaTurnos } from '../src/ai/prompt.js';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import type { Conversa, Mensagem } from '../src/domain.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { fabricas, type FabricaRepo } from './repos.js';
import { bahia, MIN } from '../src/util/tempo.js';

// ---------- dublês ----------

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ telefone: string; texto: string }> = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, texto: string) {
    this.enviados.push({ telefone, texto });
    return { idExterno: `out-${this.enviados.length}` };
  }
}

class AgenteFalso {
  pedidos: PedidoAgente[] = [];
  constructor(private resposta: (p: PedidoAgente) => RespostaAgente = () => ({ texto: 'Oi! Posso ajudar?', acoes: [], recusou: false })) {}
  async executar(p: PedidoAgente) {
    this.pedidos.push(p);
    return this.resposta(p);
  }
}

async function montar(f: FabricaRepo, agora: Date, agente = new AgenteFalso()) {
  const repo: Repositorio = await f.criar();
  const canal = new CanalFalso();
  const relogio = { t: agora };
  const s = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente,
    agora: () => relogio.t,
  });
  return { s, repo, canal, agente, relogio };
}

let seq = 0;
const msg = (texto: string, em: Date, extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  canalId: 'imperio-norte',
  telefone: '5571988124471',
  nome: 'Marina',
  texto,
  deMim: false,
  idExterno: `in-${++seq}`,
  em,
  ...extra,
});

const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

// ---------- orquestração ----------

describe.each(fabricas)('Sintonia: atendimento ponta a ponta ($nome)', (f) => {
  it('de madrugada a IA responde sozinha e programa follow-up', async () => {
    const { s, repo, canal } = await montar(f, quinta(2));
    await s.receber(msg('vcs abrem domingo?', quinta(2)));
    expect(canal.enviados).toEqual([{ telefone: '5571988124471', texto: 'Oi! Posso ajudar?' }]);
    const [c] = await repo.listarConversas();
    expect(c!.modo).toBe('ia'); // assumiu
    expect(c!.etapa).toBe('em_conversa');
    expect((await repo.tarefasPendentes(c!.id)).map((t) => t.tipo)).toEqual(['followup_1h', 'followup_1d', 'followup_3d']);
  });

  it('em horário de loja: sugere para a atendente e só assume depois de 15 min', async () => {
    const { s, repo, canal, relogio } = await montar(f, quinta(14));
    await s.receber(msg('Quanto fica a progressiva?', quinta(14)));
    const [c] = await repo.listarConversas();
    expect(canal.enviados).toHaveLength(0);
    expect(await repo.sugestao(c!.id)).toBe('Oi! Posso ajudar?');

    relogio.t = quinta(14, 15);
    await s.tick();
    expect(canal.enviados).toHaveLength(1);
    expect((await repo.buscarConversa(c!.id))!.modo).toBe('ia');
    const eventos = await repo.eventosEntre(quinta(0), quinta(23));
    expect(eventos.some((e) => e.tipo === 'ia_assumiu')).toBe(true);
  });

  it('se a atendente responde pelo celular, a IA não atropela', async () => {
    const { s, repo, canal, relogio } = await montar(f, quinta(14));
    await s.receber(msg('Consegue encaixe hoje?', quinta(14)));
    relogio.t = quinta(14, 3);
    await s.receber(msg('Vou verificar e já te falo!', quinta(14, 3), { deMim: true }));
    relogio.t = quinta(14, 20);
    await s.tick();
    expect(canal.enviados).toHaveLength(0);
    const [c] = await repo.listarConversas();
    const m = await repo.mensagens(c!.id);
    expect(m.map((x) => x.autor)).toEqual(['cliente', 'equipe']);
  });

  it('o eco da própria mensagem da IA não é confundido com a atendente', async () => {
    const { s, repo, canal } = await montar(f, quinta(2));
    await s.receber(msg('oi', quinta(2)));
    // A Evolution devolve o envio da IA como fromMe, com o id que o envio retornou.
    await s.receber(msg('Oi! Posso ajudar?', quinta(2, 1), { deMim: true, idExterno: 'out-1' }));
    const [c] = await repo.listarConversas();
    expect(c!.modo).toBe('ia');
    expect((await repo.mensagens(c!.id)).filter((x) => x.autor === 'equipe')).toHaveLength(0);
    expect(canal.enviados).toHaveLength(1);
  });

  it('mensagem retomada depois de uma queda (gravada, mas sem resposta) é respondida', async () => {
    const { s, repo, canal } = await montar(f, quinta(2));
    const m = msg('oi, ainda tem horário?', quinta(2));
    // o processo anterior gravou a conversa e a mensagem e caiu antes de responder
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: m.telefone, agora: quinta(2) });
    await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'cliente', texto: m.texto, em: m.em, idExterno: m.idExterno });
    await s.receber(m);
    expect(canal.enviados).toHaveLength(1);
    // e a mesma mensagem de novo, já respondida, não gera segunda resposta
    await s.receber(m);
    expect(canal.enviados).toHaveLength(1);
  });

  it('duas mensagens seguidas: a segunda também é respondida, mesmo chegando antes da resposta à primeira', async () => {
    const { s, canal, relogio } = await montar(f, quinta(2));
    const primeira = msg('oi', quinta(2, 0));
    const segunda = msg('quanto custa a progressiva?', quinta(2, 1));
    relogio.t = quinta(2, 5); // a fila processou as duas alguns minutos depois
    await s.receber(primeira);
    await s.receber(segunda);
    expect(canal.enviados).toHaveLength(2);
  });

  it('webhook repetido não gera resposta duplicada', async () => {
    const { s, canal } = await montar(f, quinta(2));
    const m = msg('oi', quinta(2));
    await s.receber(m);
    await s.receber(m);
    expect(canal.enviados).toHaveLength(1);
  });

  it('modo "Só eu": nada é enviado, mas a conversa é registrada', async () => {
    const { s, repo, canal } = await montar(f, quinta(2));
    await s.receber(msg('oi', quinta(2)));
    const [c] = await repo.listarConversas();
    await s.mudarModo(c!.id, 'humano');
    await s.receber(msg('alguém aí?', quinta(2, 5)));
    expect(canal.enviados).toHaveLength(1);
  });

  it('agendamento feito pela IA move o funil, cancela follow-up e programa lembretes', async () => {
    const agente = new AgenteFalso(() => ({
      texto: 'Prontinho, agendado!',
      recusou: false,
      acoes: [
        {
          tipo: 'agendou',
          clienteTrinksId: 55,
          agendamento: { trinksId: 9, unidade: 'norte', servico: 'Progressiva', profissional: 'Jéssica', inicio: bahia(2026, 11, 7, 15), duracaoMin: 180 },
        },
      ],
    }));
    const { s, repo } = await montar(f, quinta(2), agente);
    await s.receber(msg('pode marcar sábado 15h', quinta(2)));
    const [c] = await repo.listarConversas();
    expect(c!.etapa).toBe('agendada');
    expect(c!.trinksClienteId).toBe(55);
    expect((await repo.tarefasPendentes(c!.id)).map((t) => t.tipo)).toEqual(['lembrete_vespera', 'lembrete_2h']);
    expect(await s.relatorioDoDia(quinta(12))).toContain('1 agendamentos: 1 pela IA, 0 pela equipe');
  });

  it('passar para humano: a IA para e a equipe é avisada', async () => {
    const avisos: string[] = [];
    const repo = await f.criar();
    const canal = new CanalFalso();
    const agente = new AgenteFalso(() => ({ texto: TEXTO_PASSAGEM, recusou: false, acoes: [{ tipo: 'passar_para_humano', motivo: 'Reclamação' }] }));
    const s = new Sintonia({
      empresaId: 'imperio',
      repo,
      numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
      agente,
      agora: () => quinta(2),
      avisarEquipe: async (t) => {
        avisos.push(t);
      },
    });
    await s.receber(msg('fiquei insatisfeita com o resultado', quinta(2)));
    const [c] = await repo.listarConversas();
    expect(c!.modo).toBe('humano');
    expect(c!.etiquetas).toContain('precisa da equipe');
    expect(avisos[0]).toContain('Reclamação');
    expect((await repo.tarefasPendentes(c!.id))).toHaveLength(0);
  });

  it('follow-up ativo sai no horário e usa a instrução certa', async () => {
    const { s, repo, canal, agente, relogio } = await montar(f, quinta(2));
    await s.receber(msg('quanto custa?', quinta(2)));
    relogio.t = bahia(2026, 11, 5, 8, 0);
    await s.tick();
    expect(agente.pedidos.at(-1)!.tipoAtivo).toBe('followup_1h');
    expect(canal.enviados).toHaveLength(2);
    const [c] = await repo.listarConversas();
    expect((await repo.tarefasPendentes(c!.id)).map((t) => t.tipo)).toEqual(['followup_1d', 'followup_3d']);
  });
});

// ---------- agente com ferramentas ----------

const conversaBase: Conversa = {
  id: 'c1',
  empresaId: 'imperio',
  unidade: 'norte',
  canalId: 'imperio-norte',
  telefone: '5571988124471',
  nome: 'Marina',
  modo: 'ia',
  etapa: 'interessada',
  etiquetas: [],
  criadaEm: quinta(9),
  atualizadaEm: quinta(9),
};

function agendaFalsa(): Agenda & { criados: unknown[] } {
  const criados: unknown[] = [];
  return {
    criados,
    listarServicos: async () => [{ id: 1, nome: 'Progressiva Império', duracaoEmMinutos: 180, preco: 320, valorPromocional: null }],
    listarProfissionais: async () => [{ id: 7, nome: 'Jéssica' }],
    horariosVagos: async () => [{ id: 7, nome: 'Jéssica', horariosVagos: ['09:00', '14:00'] }],
    buscarClientePorTelefone: async () => null,
    criarCliente: async () => 55,
    criarAgendamento: async (_e, dados) => {
      criados.push(dados);
      return 999;
    },
    listarAgendamentosDoCliente: async () => [],
  };
}

/** Claude falso: devolve as respostas na ordem e guarda o que recebeu. */
function claudeFalso(respostas: Array<Record<string, unknown>>) {
  const recebidos: Array<Record<string, unknown>> = [];
  return {
    recebidos,
    beta: {
      messages: {
        create: (async (params: Record<string, unknown>) => {
          recebidos.push(structuredClone(params));
          const r = respostas.shift();
          if (!r) throw new Error('sem resposta');
          return r;
        }) as never,
      },
    },
  };
}

const textoFinal = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const usarFerramenta = (id: string, name: string, input: unknown) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input }],
});

describe('Agente', () => {
  const mensagens: Mensagem[] = [
    { id: '1', conversaId: 'c1', autor: 'cliente', texto: 'Quero fazer progressiva sábado 14h', em: quinta(14) },
  ];

  it('consulta, agenda no Trinks e devolve a ação para o funil', async () => {
    const claude = claudeFalso([
      usarFerramenta('t1', 'consultar_horarios', { unidade: 'norte', data: '2026-11-07', servico_id: 1, profissional_id: null }),
      usarFerramenta('t2', 'agendar', { unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '14:00', nome_cliente: 'Marina Souza' }),
      textoFinal('Prontinho, Marina! Sábado às 14h com a Jéssica.'),
    ]);
    const agenda = agendaFalsa();
    const agente = new Agente(claude, agenda, 'BASE', { modelo: 'claude-opus-5-5', esforco: 'low' });
    const r = await agente.executar({ conversa: conversaBase, mensagens, agora: quinta(14, 1), modo: 'responder' });

    expect(r.texto).toBe('Prontinho, Marina! Sábado às 14h com a Jéssica.');
    expect(r.acoes[0]).toMatchObject({ tipo: 'agendou', clienteTrinksId: 55, agendamento: { trinksId: 999, servico: 'Progressiva Império' } });
    expect(agenda.criados[0]).toMatchObject({ valor: 320, duracaoEmMinutos: 180, hora: '14:00' });

    const primeiro = claude.recebidos[0]!;
    expect(primeiro.model).toBe('claude-opus-5-5');
    expect(primeiro.fallbacks).toBe('default');
    expect(primeiro.output_config).toEqual({ effort: 'low' });
    // Contexto variável vai no fim da mensagem, não no system (cache).
    const msgs = primeiro.messages as Array<{ role: string; content: string }>;
    expect(msgs.at(-1)!.content).toContain('<contexto>');
    expect(JSON.stringify(primeiro.system)).not.toContain('<contexto>');
  });

  it('em modo sugestão não grava nada no Trinks', async () => {
    const claude = claudeFalso([
      usarFerramenta('t1', 'agendar', { unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '14:00', nome_cliente: 'Marina Souza' }),
      textoFinal('Posso reservar sábado às 14h?'),
    ]);
    const agenda = agendaFalsa();
    const agente = new Agente(claude, agenda, 'BASE', { modelo: 'claude-opus-5-5', esforco: 'low' });
    const r = await agente.executar({ conversa: conversaBase, mensagens, agora: quinta(14, 1), modo: 'sugerir' });
    expect(agenda.criados).toHaveLength(0);
    expect(r.acoes).toHaveLength(0);
    const tools = (claude.recebidos[0]!.tools as Array<{ name: string }>).map((t) => t.name);
    expect(tools).not.toContain('agendar');
  });

  it('parâmetro inválido volta como erro para a IA corrigir', async () => {
    const claude = claudeFalso([
      usarFerramenta('t1', 'consultar_horarios', { unidade: 'norte', data: '07/11', servico_id: 1, profissional_id: null }),
      textoFinal('ok'),
    ]);
    const agente = new Agente(claude, agendaFalsa(), 'BASE', { modelo: 'm', esforco: 'low' });
    await agente.executar({ conversa: conversaBase, mensagens, agora: quinta(14), modo: 'responder' });
    const resultado = (claude.recebidos[1]!.messages as Array<{ content: unknown }>).at(-1)!.content as Array<{ is_error: boolean }>;
    expect(resultado[0]!.is_error).toBe(true);
  });

  it('recusa vira passagem para a equipe', async () => {
    const claude = claudeFalso([{ stop_reason: 'refusal', content: [] }]);
    const agente = new Agente(claude, agendaFalsa(), 'BASE', { modelo: 'm', esforco: 'low' });
    const r = await agente.executar({ conversa: conversaBase, mensagens, agora: quinta(14), modo: 'responder' });
    expect(r.recusou).toBe(true);
    expect(r.acoes[0]!.tipo).toBe('passar_para_humano');
  });

  it('horários que já passaram hoje não são oferecidos', async () => {
    const claude = claudeFalso([
      usarFerramenta('t1', 'consultar_horarios', { unidade: 'norte', data: '2026-11-05', servico_id: 1, profissional_id: null }),
      textoFinal('ok'),
    ]);
    const agente = new Agente(claude, agendaFalsa(), 'BASE', { modelo: 'm', esforco: 'low' });
    await agente.executar({ conversa: conversaBase, mensagens, agora: quinta(10), modo: 'responder' });
    const resultado = (claude.recebidos[1]!.messages as Array<{ content: unknown }>).at(-1)!.content as Array<{ content: string }>;
    expect(resultado[0]!.content).toContain('14:00');
    expect(resultado[0]!.content).not.toContain('09:00');
  });
});

describe('histórico para a IA', () => {
  it('junta mensagens seguidas e marca o que a equipe escreveu', () => {
    const t = historicoParaTurnos([
      { id: '1', conversaId: 'c', autor: 'ia', texto: 'Lembrete: amanhã às 9h', em: quinta(9) },
      { id: '2', conversaId: 'c', autor: 'cliente', texto: 'oi', em: quinta(10) },
      { id: '3', conversaId: 'c', autor: 'cliente', texto: 'confirmo', em: quinta(10, 1) },
      { id: '4', conversaId: 'c', autor: 'equipe', autorNome: 'Carla', texto: 'Obrigada!', em: quinta(10, 2) },
      { id: '5', conversaId: 'c', autor: 'sistema', texto: 'nota interna', em: quinta(10, 3) },
    ]);
    expect(t.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(t[2]!.content).toBe('oi\nconfirmo');
    expect(t[3]!.content).toBe('[Equipe: Carla] Obrigada!');
  });
});

void MIN;

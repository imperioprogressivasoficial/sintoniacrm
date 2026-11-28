import { describe, expect, it } from 'vitest';
import type { ClienteClaude } from '../src/ai/agente.js';
import type { CrmIa } from '../src/ai/crm-ia.js';
import { ErroAgenda, type AgendamentoDoSistema, type DadosNovoAgendamento } from '../src/agenda/sistema.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { RespostasMemoria } from '../src/conversa/respostas.js';
import { registrarConversa } from '../src/conversa/rotas.js';
import { TranscricoesMemoria } from '../src/conversa/transcricao.js';
import type { Conversa } from '../src/domain.js';
import { AuditoriaMemoria } from '../src/seguranca/auditoria.js';
import { EnvioAosPoucos, registrarSerenaFaz, transmitirPelaSerena, type ServicosSerenaFaz, type TransmitirSerena } from '../src/serena/confirmar.js';
import { regrasDosAgentes } from '../src/serena/fazer.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { bahia, DIA } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/**
 * serena-faz: a Serena da tela (chat da equipe) manda mensagem, agenda e move, sempre com cartão e "Confirmar".
 * IA, agenda, CRM, canal de WhatsApp e transmissão de mentira.
 */

type Bloco = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
interface Pedido {
  tools?: Array<{ name: string }>;
  system: Array<{ text: string }>;
  messages: Array<{ role: string; content: unknown }>;
}
function claudeRoteiro(respostas: Bloco[][]) {
  const pedidos: Pedido[] = [];
  let i = 0;
  const beta = {
    messages: {
      create: async (p: Pedido) => {
        pedidos.push(structuredClone(p));
        const content = respostas[Math.min(i++, respostas.length - 1)]!;
        return { stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', content };
      },
    },
  };
  return { beta, pedidos };
}
let nTool = 0;
const usar = (name: string, input: unknown): Bloco => ({ type: 'tool_use', id: `tu_${++nTool}`, name, input });
const texto = (t: string): Bloco => ({ type: 'text', text: t });
/** Resultados de ferramenta que a IA recebeu num pedido. */
const resultados = (p: Pedido) => {
  const ult = p.messages.at(-1)!;
  return Array.isArray(ult.content) ? (ult.content as Array<{ content: string; is_error?: boolean }>) : [];
};

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ telefone: string; texto: string }> = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, t: string) {
    this.enviados.push({ telefone, texto: t });
    return { idExterno: `out-${this.enviados.length}-${Math.random()}` };
  }
}

/** Agenda falsa no formato do Trinks. */
class AgendaFalsa {
  readonly sistema = 'trinks' as const;
  servicos = [{ id: 1, nome: 'Progressiva', duracaoEmMinutos: 180, preco: 320, valorPromocional: null }];
  profissionais = [{ id: 7, nome: 'Jéssica' }];
  horarios = ['09:00', '14:00'];
  marcados: Array<{ id: number; clienteId: number; servicoId: number; profissionalId: number; data: string; hora: string; cancelado: boolean }> = [];
  clientes = new Map<string, number>();
  private seq = 500;
  async listarServicos() {
    return this.servicos;
  }
  async listarProfissionais() {
    return this.profissionais;
  }
  async horariosVagos(_l: string, data: string) {
    return this.profissionais.map((p) => ({ id: p.id, nome: p.nome, horariosVagos: this.horarios.filter((h) => !this.marcados.some((m) => !m.cancelado && m.data === data && m.hora === h)) }));
  }
  async buscarClientePorTelefone(_l: string, tel: string) {
    const id = this.clientes.get(tel);
    return id ? { id, nome: 'Maria' } : null;
  }
  async criarCliente(_l: string, _n: string, tel: string) {
    this.clientes.set(tel, 55);
    return 55;
  }
  async criarAgendamento(_l: string, d: DadosNovoAgendamento) {
    if (this.marcados.some((m) => !m.cancelado && m.data === d.data && m.hora === d.hora)) throw new ErroAgenda(409, 'ocupado');
    const id = ++this.seq;
    this.marcados.push({ id, clienteId: d.clienteId, servicoId: d.servicoId, profissionalId: d.profissionalId, data: d.data, hora: d.hora, cancelado: false });
    return id;
  }
  async cancelarAgendamento(_l: string, id: number) {
    const m = this.marcados.find((x) => x.id === id);
    if (m) m.cancelado = true;
  }
  async listarAgendamentosDoCliente(_l: string, clienteId: number): Promise<AgendamentoDoSistema[]> {
    return this.marcados
      .filter((m) => m.clienteId === clienteId)
      .map((m) => ({ id: m.id, cancelado: m.cancelado, servico: { id: 1, nome: 'Progressiva' }, profissional: { id: 7, nome: 'Jéssica' }, dataHoraInicio: `${m.data}T${m.hora}:00`, duracaoEmMinutos: 180, valor: 320 }));
  }
}

function crmFalso() {
  return {
    funis: async () => [
      { id: 'f1', nome: 'Vendas', sistema: false, etapas: [{ id: 'e1', nome: 'Proposta', perda: false, chave: null }, { id: 'e2', nome: 'Perdido', perda: true, chave: null }] },
    ],
    ondeEsta: async () => [],
    motivosPerda: async () => [
      { id: 'preco', nome: 'Preço', pedeTexto: false },
      { id: 'outro', nome: 'Outro', pedeTexto: true },
    ],
    produtos: async () => [{ id: 'p1', nome: 'Kit Home Care', tipo: 'produto' as const, categoria: 'Cuidados', preco: 150, duracaoMin: null, descricao: '', temFoto: false }],
    documentos: async () => [],
  } as unknown as Pick<CrmIa, 'funis' | 'motivosPerda' | 'produtos'>;
}

const AGORA = bahia(2026, 11, 20, 10, 0);

async function montar(o: { regras?: string } = {}) {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Souza', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = new RepositorioMemoria();
  const canal = new CanalFalso();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }, { canalId: 'imperio-sumare', unidade: 'sumare', canal }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const agenda = new AgendaFalsa();
  const movidos: Array<{ conversaId: string; funilId: string; etapaId: string; perda: unknown; por: string }> = [];
  const transmitidos: Array<Parameters<TransmitirSerena>[0]> = [];
  const optout = new Set<string>();
  const servicos: ServicosSerenaFaz = {
    agenda,
    crm: crmFalso(),
    descadastrado: async (tel) => optout.has(tel),
    mover: async (c, funilId, etapaId, perda, por) => (movidos.push({ conversaId: c.id, funilId, etapaId, perda, por: por.nome }), { mudou: true }),
    transmitir: async (p) => (transmitidos.push(p), { id: 'tr-1', nome: p.nome, status: 'enviando', selecionados: p.conversas.length }),
  };
  const app = criarServidor({ sintonia, repo, auth: { contas } });
  const ia = claudeRoteiro([[texto('oi')]]);
  const auditoria = new AuditoriaMemoria();
  const envio = new EnvioAosPoucos({ esperar: async () => {}, intervaloMs: () => 0, agora: () => AGORA, limiteDia: 30 });
  registrarConversa(app, {
    repo,
    sintonia,
    empresaId: 'imperio',
    agora: () => AGORA,
    respostas: new RespostasMemoria(),
    transcricoes: new TranscricoesMemoria(),
    ia: { claude: ia as unknown as ClienteClaude, modelo: 'claude-opus-5-5', base: async () => 'Valores: respeito e verdade.', ligada: () => true },
    canalDa: () => ({ erro: 'sem número' }),
    serenaAcoes: () => ({ tags: async () => [] }),
    serenaFaz: servicos,
    ...(o.regras ? { regrasIa: async () => o.regras! } : {}),
  });
  registrarSerenaFaz(app, { repo, empresaId: 'imperio', sintonia, servicos, auditoria, envio, agora: () => AGORA });
  const entrar = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  const admin = await entrar('bruno@imperio.com');
  const carla = await entrar('carla@imperio.com');
  let tel = 0;
  const cliente = async (nome: string, diasParada: number, unidade = 'norte'): Promise<Conversa> => {
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade, canalId: `imperio-${unidade}`, telefone: `557198812${String(++tel).padStart(4, '0')}`, nome, agora: AGORA });
    const quando = new Date(AGORA.getTime() - diasParada * DIA);
    const c = { ...conversa, modo: 'humano' as const, ultimaMensagemCliente: quando, ultimaMensagemEquipe: new Date(quando.getTime() + 60_000), atualizadaEm: quando };
    await repo.salvarConversa(c);
    return c;
  };
  /** Troca o roteiro da IA e conversa com a Serena. */
  const chat = async (cookie: string, pergunta: string, respostas: Bloco[][]) => {
    const r = claudeRoteiro(respostas);
    ia.beta = r.beta as typeof ia.beta;
    const resp = await app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie }, payload: { mensagens: [{ papel: 'usuario', texto: pergunta }] } });
    return { resp, pedidos: r.pedidos };
  };
  const confirmar = (cookie: string, tipo: string, dados: unknown) => app.inject({ method: 'POST', url: '/api/serena/confirmar', headers: { cookie }, payload: { tipo, dados } });
  return { app, repo, canal, agenda, movidos, transmitidos, optout, auditoria, envio, admin, carla, cliente, chat, confirmar };
}

describe('Serena faz: o que ela diz que faz', () => {
  it('o prompt não diz mais "não envia mensagens"; segue o treinamento e as regras dos agentes', async () => {
    const m = await montar({ regras: regrasDosAgentes([{ nome: 'Serena', ativo: true, config: { regras: { sempre: ['Chamar pelo primeiro nome'], nunca: ['Dar desconto sem a gerente'] } } }]) });
    const { resp, pedidos } = await m.chat(m.admin, 'O que você consegue fazer?', [[texto('Eu mando mensagens, agendo e movo, sempre com sua confirmação.')]]);
    expect(resp.statusCode, resp.body).toBe(200);
    const sistema = pedidos[0]!.system.map((s) => s.text).join('\n');
    expect(sistema).not.toMatch(/não envia mensagens/i);
    expect(sistema).not.toMatch(/não agenda clientes/i);
    expect(sistema).toContain('O que você faz (sempre com prévia e confirmação)');
    expect(sistema).toContain('inventar preço, horário, regra');
    expect(sistema).toContain('regras, os princípios e os valores');
    expect(sistema).toContain('Valores: respeito e verdade.');
    expect(sistema).toContain('Dar desconto sem a gerente');
    expect(pedidos[0]!.tools!.map((t) => t.name)).toEqual(expect.arrayContaining(['buscar_clientes', 'mostrar_envio', 'mostrar_agendamento', 'mostrar_mover', 'ver_produtos', 'ver_servicos_agenda']));
  });

  it('preço: lê o cadastro e a agenda e diz de onde veio', async () => {
    const m = await montar();
    const { pedidos } = await m.chat(m.admin, 'Quanto custa a progressiva?', [[usar('ver_produtos', { busca: null }), usar('ver_servicos_agenda', { unidade: 'norte' })], [texto('R$ 320 na agenda do salão.')]]);
    const [prod, serv] = resultados(pedidos[1]!);
    expect(prod!.content).toContain('Fonte: cadastro da empresa');
    expect(prod!.content).toContain('R$ 150,00');
    expect(serv!.content).toMatch(/Fonte: agenda do salão \(Trinks/);
    expect(serv!.content).toContain('Progressiva (servico_id 1)');
    expect(serv!.content).toContain('R$ 320,00');
  });
});

describe('Serena faz: mandar mensagem', () => {
  it('monta a lista (só paradas há mais de 7 dias), mostra o cartão e NÃO envia antes do Confirmar', async () => {
    const m = await montar();
    const ana = await m.cliente('Ana Lima', 10);
    const bia = await m.cliente('Bia Rocha', 9);
    await m.cliente('Clara Nova', 1);
    const { resp, pedidos } = await m.chat(m.admin, 'escreve uma mensagem para retomar as conversas paradas há mais de 7 dias', [
      [usar('buscar_clientes', { parada_dias_min: 7 })],
      [usar('mostrar_envio', { conversas: [{ conversa_id: ana.id }, { conversa_id: bia.id }], texto: 'Oi {primeiro_nome}! Sentimos sua falta. Posso te ajudar?', titulo: 'Retomar conversas paradas' })],
      [texto('Preparei a mensagem para 2 clientes. Confira e confirme no cartão.')],
    ]);
    expect(resp.statusCode, resp.body).toBe(200);
    const lista = resultados(pedidos[1]!)[0]!.content;
    expect(lista).toContain('Ana Lima');
    expect(lista).toContain('Bia Rocha');
    expect(lista).not.toContain('Clara Nova');
    expect(resultados(pedidos[2]!)[0]!.content).toContain('NADA foi feito ainda');
    const a = resp.json().artefatos[0];
    expect(a).toMatchObject({ tipo: 'envio', titulo: 'Enviar para 2 clientes' });
    expect(a.dados.itens.map((i: { nome: string }) => i.nome)).toEqual(['Ana Lima', 'Bia Rocha']);
    expect(a.dados.modo).toBe('direto');
    // Nada saiu.
    expect(m.canal.enviados).toHaveLength(0);

    // Confirmar: sai pelo caminho da equipe, com o primeiro nome, e o resto vai na fila (com intervalo).
    const r = await m.confirmar(m.admin, 'envio', { texto: a.dados.texto, itens: a.dados.itens.map((i: { conversaId: string }) => ({ conversaId: i.conversaId })) });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, modo: 'direto', enviadas: 1, naFila: 1 });
    await m.envio.ocioso();
    expect(m.canal.enviados.map((e) => e.texto)).toEqual(['Oi Ana! Sentimos sua falta. Posso te ajudar?', 'Oi Bia! Sentimos sua falta. Posso te ajudar?']);
    const msgs = await m.repo.mensagens(ana.id);
    expect(msgs.at(-1)).toMatchObject({ autor: 'equipe', autorNome: 'Serena (a pedido de Bruno)' });
    const evs = (await m.repo.eventosEntre(new Date(0), new Date(AGORA.getTime() + DIA))).filter((e) => e.tipo === 'serena_acao');
    expect(evs.map((e) => e.dados?.acao)).toEqual(['enviou', 'enviou']);
    expect(evs[0]!.dados).toMatchObject({ porNome: 'Bruno' });
    expect(m.auditoria.linhas.map((l) => l.acao)).toEqual(['serena_envio']);
    expect(JSON.stringify(m.auditoria.linhas)).not.toContain(ana.telefone);
  });

  it('quem pediu para sair fica de fora (no cartão e no Confirmar)', async () => {
    const m = await montar();
    const ana = await m.cliente('Ana Lima', 10);
    const bia = await m.cliente('Bia Rocha', 9);
    m.optout.add(bia.telefone);
    const { resp } = await m.chat(m.admin, 'manda para as duas', [[usar('mostrar_envio', { conversas: [{ conversa_id: ana.id }, { conversa_id: bia.id }], texto: 'Oi {primeiro_nome}!' })], [texto('ok')]]);
    const a = resp.json().artefatos[0];
    expect(a.dados.itens.map((i: { nome: string }) => i.nome)).toEqual(['Ana Lima']);
    expect(a.dados.fora[0]).toMatchObject({ nome: 'Bia Rocha' });
    const r = await m.confirmar(m.admin, 'envio', { texto: 'Oi {primeiro_nome}!', itens: [{ conversaId: ana.id }, { conversaId: bia.id }] });
    expect(r.json().fora).toHaveLength(1);
    await m.envio.ocioso();
    expect(m.canal.enviados.map((e) => e.telefone)).toEqual([ana.telefone]);
  });

  it('mais de 20 clientes vai pelas Transmissões (nada sai direto)', async () => {
    const m = await montar();
    const lista: Conversa[] = [];
    for (let i = 0; i < 23; i++) lista.push(await m.cliente(`Cliente ${i}`, 12));
    const { resp } = await m.chat(m.admin, 'manda para todo mundo parado', [[usar('mostrar_envio', { conversas: lista.map((c) => ({ conversa_id: c.id })), texto: 'Oi {primeiro_nome}! Novidades por aqui.' })], [texto('ok')]]);
    const a = resp.json().artefatos[0];
    expect(a.dados.modo).toBe('transmissao');
    const r = await m.confirmar(m.admin, 'envio', { texto: a.dados.texto, assunto: 'Novidades', itens: lista.map((c) => ({ conversaId: c.id })) });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().modo).toBe('transmissao');
    expect(m.transmitidos).toHaveLength(1);
    expect(m.transmitidos[0]).toMatchObject({ unidade: 'norte', texto: 'Oi {primeiro_nome}! Novidades por aqui.', por: 'Bruno' });
    expect(m.transmitidos[0]!.conversas).toHaveLength(23);
    expect(m.transmitidos[0]!.nome).toContain('Serena');
    await m.envio.ocioso();
    expect(m.canal.enviados).toHaveLength(0);
  });

  it('sem permissão: atendente não manda para várias nem para quem não vê', async () => {
    const m = await montar();
    const ana = await m.cliente('Ana Lima', 10);
    const bia = await m.cliente('Bia Rocha', 9);
    const outra = await m.cliente('Dora Sumaré', 9, 'sumare');
    const { resp, pedidos } = await m.chat(m.carla, 'manda para as duas', [[usar('mostrar_envio', { conversas: [{ conversa_id: ana.id }, { conversa_id: bia.id }], texto: 'Oi!' })], [texto('Só dá para uma por vez.')]]);
    expect(resp.json().artefatos).toBeUndefined();
    expect(resultados(pedidos[1]!)[0]).toMatchObject({ is_error: true });
    expect(resultados(pedidos[1]!)[0]!.content).toContain('UMA cliente por vez');
    // A lista da atendente só traz o que ela vê.
    const busca = await m.chat(m.carla, 'quem está parado?', [[usar('buscar_clientes', {})], [texto('ok')]]);
    expect(resultados(busca.pedidos[1]!)[0]!.content).not.toContain('Dora');
    // E o Confirmar confere de novo.
    expect((await m.confirmar(m.carla, 'envio', { texto: 'Oi!', itens: [{ conversaId: ana.id }, { conversaId: bia.id }] })).statusCode).toBe(403);
    expect((await m.confirmar(m.carla, 'envio', { texto: 'Oi!', itens: [{ conversaId: outra.id }] })).statusCode).toBe(409);
    await m.envio.ocioso();
    expect(m.canal.enviados).toHaveLength(0);
    // Uma só, que ela vê: sai.
    const ok = await m.confirmar(m.carla, 'envio', { texto: 'Oi {primeiro_nome}!', itens: [{ conversaId: ana.id }] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(m.canal.enviados.map((e) => e.texto)).toEqual(['Oi Ana!']);
  });
});

describe('Serena faz: agenda', () => {
  it('confere o horário, mostra "Agendar Maria — Progressiva — … — unidade …" e só agenda no Confirmar', async () => {
    const m = await montar();
    const maria = await m.cliente('Maria Souza', 2);
    const { resp, pedidos } = await m.chat(m.admin, 'agenda a Maria para progressiva domingo às 14h', [
      [usar('consultar_horarios', { unidade: 'norte', data: '2026-11-22', servico_id: 1, profissional_id: null })],
      [usar('mostrar_agendamento', { acao: 'agendar', conversa_id: maria.id, unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-22', hora: '14:00' })],
      [texto('Preparei o agendamento. Confira e confirme.')],
    ]);
    expect(resp.statusCode, resp.body).toBe(200);
    expect(resultados(pedidos[1]!)[0]!.content).toContain('Jéssica (profissional_id 7): 09:00, 14:00');
    const a = resp.json().artefatos[0];
    expect(a.tipo).toBe('agendamento');
    expect(a.titulo).toMatch(/^Agendar Maria — Progressiva — dom 22\/11 14h — unidade /);
    expect(a.dados.resumo).toMatchObject({ profissional: 'Jéssica', preco: 320 });
    expect(m.agenda.marcados).toHaveLength(0);

    const { resumo, ...dados } = a.dados;
    void resumo;
    const r = await m.confirmar(m.admin, 'agendamento', dados);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().resumo).toContain('Agendado ✓');
    expect(m.agenda.marcados).toHaveLength(1);
    expect(m.agenda.marcados[0]).toMatchObject({ data: '2026-11-22', hora: '14:00', profissionalId: 7 });
    // Confirmação para a cliente e a nota na conversa.
    expect(m.canal.enviados.at(-1)!.texto).toContain('Prontinho, Maria!');
    const msgs = await m.repo.mensagens(maria.id);
    expect(msgs.some((x) => x.autor === 'sistema' && x.texto.includes('Serena (a pedido de Bruno) agendou Progressiva'))).toBe(true);
    // Confirmar de novo não marca duas vezes.
    const de_novo = await m.confirmar(m.admin, 'agendamento', dados);
    expect(de_novo.statusCode).toBe(200);
    expect(m.agenda.marcados.filter((x) => !x.cancelado)).toHaveLength(1);
  });

  it('horário ocupado não vira cartão; cancelar só no Confirmar', async () => {
    const m = await montar();
    const maria = await m.cliente('Maria Souza', 2);
    m.agenda.clientes.set(maria.telefone, 55);
    m.agenda.marcados.push({ id: 900, clienteId: 55, servicoId: 1, profissionalId: 7, data: '2026-11-22', hora: '14:00', cancelado: false });
    const { pedidos } = await m.chat(m.admin, 'agenda às 14h', [[usar('mostrar_agendamento', { acao: 'agendar', conversa_id: maria.id, unidade: 'norte', servico_id: 1, profissional_id: 7, data: '2026-11-22', hora: '14:00', ja_conferiu_agendamentos: true })], [texto('Esse horário está ocupado.')]]);
    expect(resultados(pedidos[1]!)[0]).toMatchObject({ is_error: true });
    expect(resultados(pedidos[1]!)[0]!.content).toContain('não está livre');

    const { resp } = await m.chat(m.admin, 'cancela o horário da Maria', [[usar('mostrar_agendamento', { acao: 'cancelar', conversa_id: maria.id, unidade: 'norte', agendamento_id: 900, motivo: 'Viajou' })], [texto('ok')]]);
    const a = resp.json().artefatos[0];
    expect(a.titulo).toMatch(/^Cancelar Maria — Progressiva de dom 22\/11 14h/);
    expect(m.agenda.marcados[0]!.cancelado).toBe(false);
    const { resumo, ...dados } = a.dados;
    void resumo;
    const r = await m.confirmar(m.admin, 'agendamento', dados);
    expect(r.statusCode, r.body).toBe(200);
    expect(m.agenda.marcados[0]!.cancelado).toBe(true);
    const msgs = await m.repo.mensagens(maria.id);
    expect(msgs.some((x) => x.autor === 'sistema' && x.texto.includes('Serena (a pedido de Bruno) cancelou'))).toBe(true);
  });
});

describe('Serena faz: mover no funil', () => {
  it('etapa de perda pede o motivo; o cartão só move no Confirmar; atendente não move várias', async () => {
    const m = await montar();
    const ana = await m.cliente('Ana Lima', 10);
    const bia = await m.cliente('Bia Rocha', 9);
    const semMotivo = await m.chat(m.admin, 'move as duas para perdido', [[usar('mostrar_mover', { conversas: [ana.id, bia.id], funil_id: 'f1', etapa_id: 'e2' })], [texto('Qual o motivo?')]]);
    expect(resultados(semMotivo.pedidos[1]!)[0]!.content).toContain('falta o motivo');
    expect(semMotivo.resp.json().artefatos).toBeUndefined();

    const { resp } = await m.chat(m.admin, 'motivo preço', [[usar('mostrar_mover', { conversas: [ana.id, bia.id], funil_id: 'f1', etapa_id: 'e2', motivo_perda_id: 'preco' })], [texto('ok')]]);
    const a = resp.json().artefatos[0];
    expect(a).toMatchObject({ tipo: 'mover', titulo: 'Mover 2 conversas para "Perdido"' });
    expect(a.dados.perda).toMatchObject({ motivo: 'preco', motivoNome: 'Preço' });
    expect(m.movidos).toHaveLength(0);

    const dados = { funilId: a.dados.funilId, etapaId: a.dados.etapaId, perda: { motivo: 'preco' }, itens: a.dados.itens.map((i: { conversaId: string }) => ({ conversaId: i.conversaId })) };
    expect((await m.confirmar(m.carla, 'mover', dados)).statusCode).toBe(403);
    expect(m.movidos).toHaveLength(0);
    const r = await m.confirmar(m.admin, 'mover', dados);
    expect(r.statusCode, r.body).toBe(200);
    expect(m.movidos.map((x) => x.conversaId)).toEqual([ana.id, bia.id]);
    expect(m.movidos[0]).toMatchObject({ etapaId: 'e2', perda: { motivo: 'preco' }, por: 'Serena (a pedido de Bruno)' });
    const msgs = await m.repo.mensagens(ana.id);
    expect(msgs.some((x) => x.autor === 'sistema' && x.texto.includes('moveu para "Perdido"') && x.texto.includes('Motivo: Preço'))).toBe(true);
    // Sem motivo, o Confirmar recusa.
    expect((await m.confirmar(m.admin, 'mover', { ...dados, perda: null })).statusCode).toBe(400);
  });
});

describe.skipIf(!temPostgres)('Serena faz: transmissão de verdade (Postgres)', () => {
  it('cria e começa a transmissão com a lista escolhida', async () => {
    const pool = await poolDeTeste();
    const { RepositorioPostgres } = await import('../src/store/postgres.js');
    const { ArmazemTagsPostgres, Tags } = await import('../src/tags/tags.js');
    const { ContatosPostgres } = await import('../src/contatos/contatos.js');
    const { Transmissoes } = await import('../src/transmissoes/transmissoes.js');
    const { CanalTeste } = await import('../src/channels/teste.js');
    const repo = new RepositorioPostgres(pool);
    const canal = new CanalFalso();
    const numeros = [{ canalId: 'imperio-norte', unidade: 'norte', canal }];
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora: () => AGORA });
    const t = new Transmissoes({ pool, empresaId: 'imperio', repo, sintonia: () => sintonia, numeros: () => numeros, tags: new Tags(new ArmazemTagsPostgres(pool), 'imperio'), contatos: new ContatosPostgres(pool), agora: () => AGORA });
    void CanalTeste;
    const ids: string[] = [];
    const sufixo = String(Date.now()).slice(-4);
    for (let i = 0; i < 22; i++) {
      const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: `55719${sufixo}${String(i).padStart(4, '0')}`, nome: `Cliente ${i}`, agora: new Date(AGORA.getTime() - 10 * DIA) });
      await repo.salvarConversa({ ...conversa, atualizadaEm: new Date(AGORA.getTime() - 10 * DIA) });
      ids.push(conversa.id);
    }
    const r = await transmitirPelaSerena(t)({ unidade: 'norte', nome: 'Serena: teste (a pedido de Bruno)', conversas: ids, texto: 'Oi {primeiro_nome}!', por: 'Bruno' });
    expect(r).toMatchObject({ status: 'enviando', selecionados: 22 });
    const { rows } = await pool.query('select count(*)::int as n from sintonia.transmissao_destinos where transmissao_id = $1', [r.id]);
    expect(rows[0].n).toBe(22);
    // Unidade sem número: recusa com motivo.
    await expect(transmitirPelaSerena(t)({ unidade: 'sumare', nome: 'x', conversas: ids, texto: 'Oi', por: 'Bruno' })).rejects.toThrow(/não tem WhatsApp/);
  });
});

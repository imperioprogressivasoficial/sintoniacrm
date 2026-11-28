import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agente, type ClienteClaude } from '../src/ai/agente.js';
import { executarFerramenta, novaSessao, type ContextoFerramentas } from '../src/ai/ferramentas.js';
import { esquecerCliente } from '../src/ai/cliente-conhecida.js';
import { acharTabela, tabelaDoAgendamento } from '../src/ai/ferramentas-crm.js';
import type { CrmIa } from '../src/ai/crm-ia.js';
import { limparSaudeAgenda } from '../src/ai/saude-agenda.js';
import { definirEspelho, servicoParaAgendar } from '../src/agenda/espelho.js';
import type { ClienteAgenda, DadosExtrasCliente, DadosNovoAgendamento } from '../src/agenda/sistema.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp, MidiaEnvio } from '../src/channels/tipos.js';
import type { Conversa } from '../src/domain.js';
import { CONFIG_IA_PADRAO, normalizarConfig } from '../src/empresa/empresa.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { definirUnidades, HORARIOS_PADRAO_IMPERIO, reiniciarUnidades, UNIDADES_IMPERIO } from '../src/unidades.js';
import { bahia } from '../src/util/tempo.js';

/**
 * tabela-fim (dono 28/11): depois da confirmação do agendamento o SISTEMA manda a imagem da tabela certa (não depende
 * da IA lembrar), e o agendamento padrão é o serviço "Essencial" (não a avaliação). Claude falso e agenda falsa.
 */

const TEL = '5571988124471';
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

class AgendaFalsa {
  readonly sistema = 'trinks' as const;
  servicos = [
    { id: 5, nome: 'Avaliação técnica', duracaoEmMinutos: 30, preco: 0, valorPromocional: null },
    { id: 12, nome: 'Progressiva Espelhada Essencial', duracaoEmMinutos: 180, preco: 300, valorPromocional: null },
    { id: 13, nome: 'Liso Infinito', duracaoEmMinutos: 180, preco: 350, valorPromocional: null },
  ];
  profissionais = [{ id: 7, nome: 'Jéssica Lima', apelido: 'Jéssica' }];
  livres: Record<number, string[]> = { 7: ['09:00', '12:30', '15:30'] };
  clientes: Array<ClienteAgenda & { tel: string }> = [];
  criados: Array<{ nome: string; telefone: string; extras?: DadosExtrasCliente }> = [];
  gravados: DadosNovoAgendamento[] = [];
  async listarServicos() {
    return this.servicos;
  }
  async listarProfissionais() {
    return this.profissionais;
  }
  async horariosVagos(_l: string, data: string, f?: { profissionalId?: number }) {
    return this.profissionais
      .filter((p) => !f?.profissionalId || p.id === f.profissionalId)
      .map((p) => ({ id: p.id, nome: p.nome, horariosVagos: (this.livres[p.id] ?? []).filter((h) => !this.gravados.some((g) => g.data === data && g.hora === h)) }));
  }
  async buscarClientePorTelefone(_l: string, tel: string) {
    const c = this.clientes.find((x) => x.tel === tel);
    return c ? { id: c.id, nome: c.nome } : null;
  }
  async buscarClientesPorNome() {
    return [];
  }
  async criarCliente(_l: string, nome: string, telefone: string, extras?: DadosExtrasCliente) {
    this.criados.push({ nome, telefone, extras });
    const id = 900 + this.criados.length;
    this.clientes.push({ id, nome, tel: telefone });
    return id;
  }
  async criarAgendamento(_l: string, d: DadosNovoAgendamento) {
    this.gravados.push(d);
    return 7000 + this.gravados.length;
  }
  async listarAgendamentosDoCliente() {
    return [];
  }
  async listarAgendamentosDoPeriodo() {
    return [];
  }
}

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  eventos: string[] = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, _t: string, texto: string) {
    this.eventos.push(`texto:${texto.split('\n')[0]}`);
    return { idExterno: `out-${this.eventos.length}` };
  }
  async enviarMidia(_c: string, _t: string, m: MidiaEnvio) {
    this.eventos.push(`midia:${m.nomeArquivo ?? m.tipo}`);
    return { idExterno: `m-${this.eventos.length}` };
  }
}

const DOCS = [
  { id: 'd1', nome: 'Tabela Liso Infinito', categoria: 'tabela', descricao: '', mimetype: 'image/png' },
  { id: 'd2', nome: 'tabela_seu_primeiro_alisamento.jpg', categoria: 'tabela', descricao: '', mimetype: 'image/jpeg' },
  { id: 'd3', nome: 'Catálogo 2026', categoria: 'catalogo', descricao: '', mimetype: 'application/pdf' },
];
const NOMES = { clienteNova: 'Seu Primeiro Alisamento', jaCliente: 'Liso Infinito' };

function crmFalso(docs = DOCS): CrmIa {
  return {
    funis: async () => [],
    ondeEsta: async () => [],
    motivosPerda: async () => [],
    produtos: async () => [],
    documentos: async () => docs,
    moverFunil: async () => false,
    vincularProduto: async () => undefined,
    criarTarefa: async () => ({ responsavel: 'Gil' }),
    arquivo: async (_c, _o, id) => {
      const d = docs.find((x) => x.id === id);
      return d ? { conteudo: Buffer.from('img'), mimetype: d.mimetype, tipo: 'imagem' as const, nomeArquivo: d.nome } : undefined;
    },
  };
}

let nTool = 0;
type Resposta = { stop_reason: string; content: unknown[] };
const usa = (name: string, input: unknown): Resposta => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${++nTool}`, name, input }] });
const fala = (text: string): Resposta => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
function roteiro(passos: Resposta[]) {
  return { beta: { messages: { create: (async () => passos.shift() ?? fala('ok')) as never } } } as ClienteClaude;
}

const CONFIRMACAO = 'Agendamento confirmado ✅\n📅 Data: 07/11\n⏰ Horário: 09:00\n📍 Shopping Sumaré';
const pedido = (extra: Record<string, unknown> = {}) => ({ unidade: 'sumare', servico_id: null, profissional_id: null, data: '2026-11-07', hora: '09:00', nome_cliente: null, data_nascimento: null, email: null, cliente_id: null, para_outra_pessoa: null, telefone_outra_pessoa: null, ja_conferiu_agendamentos: false, ...extra });
const DADOS_NOVA = { nome_cliente: 'Carla Menezes', data_nascimento: '1992-03-14', email: 'carla@email.com' };

function montar(passos: Resposta[], o: { docs?: typeof DOCS; nomes?: typeof NOMES } = {}) {
  const repo = new RepositorioMemoria();
  const canal = new CanalFalso();
  const agenda = new AgendaFalsa();
  const crm = crmFalso(o.docs);
  const logs: string[] = [];
  const agente = new Agente(roteiro(passos), agenda, 'base', { modelo: 'claude-opus-5-5', esforco: 'low', crm: () => crm, prazoAgendaMs: 50 });
  const s = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente,
    agora: () => quinta(10),
    configIa: async () => ({ modoPadrao: 'ia' }),
    crmIa: crm,
    tabelasAgendamento: async () => o.nomes ?? NOMES,
    log: (m) => void logs.push(m),
  });
  const receber = (texto: string) => s.receber({ canalId: 'imperio-norte', telefone: TEL, nome: 'Marina', texto, deMim: false, idExterno: `in-${++nTool}`, em: quinta(10) });
  return { s, canal, agenda, logs, receber };
}

beforeEach(() => {
  esquecerCliente();
  limparSaudeAgenda();
  reiniciarUnidades();
  definirEspelho(null);
  // Sem "serviço padrão para agendar" no cadastro (como a migração 777 deixou a Império).
  definirUnidades('imperio', UNIDADES_IMPERIO.map((u) => ({ ...u, ...HORARIOS_PADRAO_IMPERIO[u.id], servicoPadraoId: null })));
});
afterEach(() => reiniciarUnidades());

describe('tabela-fim 1. A imagem da tabela vai sozinha depois da confirmação', () => {
  it('cliente nova: confirmação e logo depois a tabela "Seu Primeiro Alisamento" (achada pelo nome do arquivo)', async () => {
    const m = montar([usa('agendar', pedido(DADOS_NOVA)), fala(CONFIRMACAO)]);
    await m.receber('quero às 9 no Sumaré sábado');
    expect(m.agenda.criados).toHaveLength(1);
    expect(m.canal.eventos).toEqual(['texto:Agendamento confirmado ✅', 'midia:tabela_seu_primeiro_alisamento.jpg']);
  });

  it('quem já era cliente: a tabela "Liso Infinito"', async () => {
    const m = montar([usa('agendar', pedido()), fala(CONFIRMACAO)]);
    m.agenda.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    await m.receber('quero às 9 no Sumaré sábado');
    expect(m.agenda.criados).toEqual([]);
    expect(m.canal.eventos).toEqual(['texto:Agendamento confirmado ✅', 'midia:Tabela Liso Infinito']);
  });

  it('a IA já mandou a tabela nesta resposta (mesmo antes de agendar): vai uma vez só, depois da confirmação', async () => {
    const m = montar([usa('enviar_tabela_precos', { nome: 'Liso Infinito', legenda: null }), usa('agendar', pedido()), fala(CONFIRMACAO)]);
    m.agenda.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    await m.receber('quero às 9 no Sumaré sábado');
    expect(m.canal.eventos).toEqual(['texto:Agendamento confirmado ✅', 'midia:Tabela Liso Infinito']);
  });

  it('horário para outra pessoa: não manda tabela', async () => {
    const m = montar([usa('agendar', pedido({ para_outra_pessoa: true, nome_cliente: 'Joana Reis' })), fala(CONFIRMACAO)]);
    m.agenda.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    await m.receber('quero marcar para minha irmã Joana Reis às 9 no Sumaré sábado');
    expect(m.agenda.gravados).toHaveLength(1);
    expect(m.canal.eventos).toEqual(['texto:Agendamento confirmado ✅']);
  });

  it('sem imagem cadastrada: só a confirmação e fica no log', async () => {
    const m = montar([usa('agendar', pedido()), fala(CONFIRMACAO)], { docs: [DOCS[2]!] });
    m.agenda.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    await m.receber('quero às 9 no Sumaré sábado');
    expect(m.canal.eventos).toEqual(['texto:Agendamento confirmado ✅']);
    expect(m.logs).toContain('Agendamento sem imagem da tabela para mandar');
  });

  it('conversa sem agendamento: nenhuma tabela', async () => {
    const m = montar([fala('Para qual unidade deseja agendar?')]);
    await m.receber('oi');
    expect(m.canal.eventos).toEqual(['texto:Para qual unidade deseja agendar?']);
  });

  it('por que não saía: nome com "Tabela de preços -", "_" ou extensão não batia; agora acha. Sem nome configurado, nada', () => {
    expect(acharTabela(DOCS, 'Tabela de preços - Seu Primeiro Alisamento')?.id).toBe('d2');
    expect(acharTabela(DOCS, 'liso infinito')?.id).toBe('d1');
    expect(tabelaDoAgendamento(DOCS, NOMES, true)?.id).toBe('d2');
    expect(tabelaDoAgendamento(DOCS, NOMES, false)?.id).toBe('d1');
    expect(tabelaDoAgendamento(DOCS, { clienteNova: '', jaCliente: '' }, true)).toBeUndefined();
    // Configurável por empresa (config da IA); padrão vazio para empresa nova.
    expect(CONFIG_IA_PADRAO.tabelaAgendamento).toEqual({ clienteNova: '', jaCliente: '' });
    expect(normalizarConfig({ tabelaAgendamento: NOMES }).tabelaAgendamento).toEqual(NOMES);
  });
});

describe('tabela-fim 2. Agendamento padrão: o serviço "Essencial", não a avaliação', () => {
  it('sem serviço padrão no cadastro: o "Essencial"; sem ele, a avaliação (como antes); com padrão, o padrão', () => {
    const ag = new AgendaFalsa();
    expect(servicoParaAgendar('sumare', ag.servicos)?.id).toBe(12);
    expect(servicoParaAgendar('sumare', ag.servicos.filter((s) => s.id !== 12))?.id).toBe(5);
    definirUnidades('imperio', UNIDADES_IMPERIO.map((u) => ({ ...u, ...HORARIOS_PADRAO_IMPERIO[u.id], servicoPadraoId: 13 })));
    expect(servicoParaAgendar('sumare', ag.servicos)?.id).toBe(13);
  });

  it('a IA agenda com servico_id null e o horário entra no "Essencial"', async () => {
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const conversa: Conversa = { id: 'c1', empresaId: 'imperio', unidade: 'sumare', canalId: 'imperio-sumare', telefone: TEL, nome: 'Marina Souza', modo: 'ia', etapa: 'em_conversa', etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9) };
    const ctx = { agenda: ag, conversa, agora: quinta(8), acoes: [], podeEscrever: true, sessao: novaSessao(), prazoAgendaMs: 2000 } as unknown as ContextoFerramentas;
    const r = await executarFerramenta('agendar', pedido(), ctx);
    expect(r.erro).toBe(false);
    expect(ag.gravados[0]!.servicoId).toBe(12);
    expect(JSON.parse(r.conteudo).servico).toBe('Progressiva Espelhada Essencial');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agente, type ClienteClaude } from '../src/ai/agente.js';
import { executarFerramenta, filtrarPelaUnidade, novaSessao, type AcaoAgente, type ContextoFerramentas } from '../src/ai/ferramentas.js';
import { conhecerCliente, esquecerCliente, mesmoNome, textoClienteConhecida } from '../src/ai/cliente-conhecida.js';
import { blocoUnidades, REGRAS_ATENDIMENTO } from '../src/ai/regras-atendimento.js';
import { carregarBase, systemPrompt } from '../src/ai/prompt.js';
import { partirParaWhatsApp } from '../src/ai/guarda.js';
import { acharTabela, rodarFerramentaCrm } from '../src/ai/ferramentas-crm.js';
import type { ServicosCrmIa } from '../src/ai/crm-ia.js';
import { ArmazemEspelhoMemoria, definirEspelho, EspelhoAgenda, servicoParaAgendar } from '../src/agenda/espelho.js';
import { AgendaExterna } from '../src/agenda/agenda-externa.js';
import { horariosLivres } from '../src/agenda/agendar.js';
import type { AgendamentoDaAgenda, ClienteAgenda, DadosExtrasCliente, DadosNovoAgendamento, RoteadorAgenda } from '../src/agenda/sistema.js';
import { Sintonia, pausaDigitando } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { Conversa, Mensagem } from '../src/domain.js';
import { DadosUnidade } from '../src/empresa/cadastro.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { definirUnidades, reiniciarUnidades, UNIDADES_IMPERIO, HORARIOS_PADRAO_IMPERIO, unidadeDe, type UnidadeDoCadastro } from '../src/unidades.js';
import { bahia, MIN } from '../src/util/tempo.js';
import { systemDoAgente } from '../src/agentes-ia/prompt.js';
import { configPadrao, type AgenteIa } from '../src/agentes-ia/tipos.js';

/**
 * serena-regras (dono 28/11): os ajustes do atendimento da IA depois do primeiro agendamento real.
 * Agenda falsa no formato do Trinks e IA falsa (roteiro), como em ia-completa.test.ts.
 */

const TEL = '5571988124471';
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

class AgendaFalsa {
  readonly sistema = 'trinks' as const;
  servicos = [
    { id: 1, nome: 'Progressiva Ultra Liss', duracaoEmMinutos: 180, preco: 269.9, valorPromocional: null },
    { id: 5, nome: 'Avaliação técnica', duracaoEmMinutos: 30, preco: 0, valorPromocional: null },
  ];
  profissionais = [
    { id: 7, nome: 'Jéssica Lima', apelido: 'Jéssica' },
    { id: 8, nome: 'Ana Paula', apelido: 'Ana' },
  ];
  /** Horários livres por profissional (iguais todo dia). */
  livres: Record<number, string[]> = { 7: ['09:00', '10:00', '12:30', '17:00', '19:00'], 8: ['15:30', '16:00'] };
  clientes: Array<ClienteAgenda & { tel: string }> = [];
  criados: Array<{ nome: string; telefone: string; extras?: DadosExtrasCliente }> = [];
  gravados: DadosNovoAgendamento[] = [];
  chamadas: Record<string, number> = {};
  periodo: AgendamentoDaAgenda[] = [];
  historico: Array<{ clienteId: number; data: string; hora: string; servico: string }> = [];
  private conta(n: string) {
    this.chamadas[n] = (this.chamadas[n] ?? 0) + 1;
  }
  async listarServicos() {
    this.conta('servicos');
    return this.servicos;
  }
  async listarProfissionais() {
    this.conta('profissionais');
    return this.profissionais;
  }
  async horariosVagos(_l: string, data: string, f?: { profissionalId?: number; servicoId?: number }) {
    this.conta('vagos');
    return this.profissionais
      .filter((p) => !f?.profissionalId || p.id === f.profissionalId)
      .map((p) => ({ id: p.id, nome: p.nome, horariosVagos: (this.livres[p.id] ?? []).filter((h) => !this.gravados.some((g) => g.data === data && g.hora === h && g.profissionalId === p.id)) }));
  }
  falharTelefone = false;
  async buscarClientePorTelefone(_l: string, tel: string) {
    this.conta('porTelefone');
    if (this.falharTelefone) throw new Error('Trinks fora');
    const c = this.clientes.find((x) => x.tel === tel);
    return c ? { id: c.id, nome: c.nome } : null;
  }
  async buscarClientesPorNome(_l: string, nome: string) {
    this.conta('porNome');
    const n = nome.toLowerCase().split(' ')[0]!;
    return this.clientes.filter((c) => (c.nome ?? '').toLowerCase().includes(n)).map((c) => ({ id: c.id, nome: c.nome }));
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
  async listarAgendamentosDoCliente(_l: string, clienteId: number) {
    this.conta('doCliente');
    return this.historico
      .filter((h) => h.clienteId === clienteId)
      .map((h, i) => ({ id: 100 + i, servico: { id: 1, nome: h.servico }, profissional: { id: 7, nome: 'Jéssica' }, dataHoraInicio: `${h.data}T${h.hora}:00`, duracaoEmMinutos: 60, valor: 100 }));
  }
  async listarAgendamentosDoPeriodo() {
    this.conta('periodo');
    return this.periodo;
  }
}

const conversa = (extra: Partial<Conversa> = {}): Conversa => ({
  id: 'c1',
  empresaId: 'imperio',
  unidade: 'sumare',
  canalId: 'imperio-sumare',
  telefone: TEL,
  nome: 'Marina Souza',
  modo: 'ia',
  etapa: 'em_conversa',
  etiquetas: [],
  criadaEm: quinta(9),
  atualizadaEm: quinta(9),
  ...extra,
});

function ctxDe(agenda: AgendaFalsa, extra: Partial<ContextoFerramentas> = {}): ContextoFerramentas & { acoes: AcaoAgente[] } {
  return { agenda, conversa: conversa(), agora: quinta(8), acoes: [], podeEscrever: true, sessao: novaSessao(), prazoAgendaMs: 2000, ...extra } as ContextoFerramentas & { acoes: AcaoAgente[] };
}
const rodar = async (nome: string, entrada: unknown, ctx: ContextoFerramentas) => {
  const r = await executarFerramenta(nome, entrada, ctx);
  return { ...r, json: (() => { try { return JSON.parse(r.conteudo); } catch { return r.conteudo; } })() };
};

/** Unidades da Império com os horários padrão do dono e o serviço padrão (avaliação, id 5). */
function unidadesComPadrao(extra: Partial<UnidadeDoCadastro> = {}) {
  definirUnidades(
    'imperio',
    UNIDADES_IMPERIO.map((u) => ({ ...u, ...HORARIOS_PADRAO_IMPERIO[u.id], servicoPadraoId: u.id === 'feira' ? null : 5, ...(u.id === 'sumare' ? extra : {}) })),
  );
}

beforeEach(() => {
  esquecerCliente();
  reiniciarUnidades();
  definirEspelho(null);
});
afterEach(() => {
  reiniciarUnidades();
  definirEspelho(null);
});

// ---------------------------------------------------------------- 1 e 2. quem é a cliente

describe('1/2. A cliente pelo número do WhatsApp (sem pedir nome) e a boas-vindas de quem volta', () => {
  it('acha pelo telefone, traz o último atendimento e guarda 10 min (não consulta de novo)', async () => {
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    ag.historico.push({ clienteId: 55, data: '2026-08-10', hora: '10:00', servico: 'Progressiva Ultra Liss' });
    const k = await conhecerCliente(ag, conversa(), quinta(9));
    expect(k).toMatchObject({ conhecida: true, nome: 'Marina Souza', por: 'telefone', confirmar: false, clienteId: 55, ultimoAtendimento: { data: '2026-08-10', servico: 'Progressiva Ultra Liss' } });
    const antes = { ...ag.chamadas };
    await conhecerCliente(ag, conversa(), quinta(9));
    expect(ag.chamadas).toEqual(antes);
    const texto = textoClienteConhecida(k, true);
    expect(texto).toContain('cliente_conhecida: sim');
    expect(texto).toContain('nome no cadastro: Marina Souza');
    expect(texto).toContain('último atendimento: 10/08/2026');
    expect(texto).toContain('não peça nome, nascimento nem e-mail');
  });

  it('segunda chave: nome do perfil só quando a busca pelo telefone dá erro; pede confirmação; nome solto não serve', async () => {
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 66, nome: 'Marina Souza Lima', tel: '5571999990000' });
    // dono 28/11: o telefone basta; sem erro na busca pelo telefone, não procura pelo nome
    expect((await conhecerCliente(ag, conversa(), quinta(9))).conhecida).toBe(false);
    esquecerCliente();
    ag.falharTelefone = true;
    const k = await conhecerCliente(ag, conversa(), quinta(9));
    expect(k).toMatchObject({ conhecida: true, por: 'nome_do_perfil', confirmar: true, clienteId: 66 });
    expect(textoClienteConhecida(k, true)).toContain('É para você');
    esquecerCliente();
    const so = await conhecerCliente(ag, conversa({ nome: 'Marina' }), quinta(9));
    expect(so.conhecida).toBe(false);
    expect(mesmoNome('Marina Souza Lima', 'marina souza')).toBe(true);
    expect(mesmoNome('Marina Lima', 'Marina Souza')).toBe(false);
  });

  it('cliente nova: o bloco diz para pedir os dados só na hora de agendar; quem já agendou pela conversa é conhecida', async () => {
    const ag = new AgendaFalsa();
    const k = await conhecerCliente(ag, conversa({ nome: undefined }), quinta(9));
    expect(textoClienteConhecida(k, true)).toContain('cliente_conhecida: não');
    expect(textoClienteConhecida(k, true)).toContain('Cliente nova');
    esquecerCliente();
    const k2 = await conhecerCliente(ag, conversa({ nome: undefined, trinksClienteId: 77 }), quinta(9));
    expect(k2).toMatchObject({ conhecida: true, por: 'conversa' });
  });

  it('o agente recebe pronto o bloco <cliente_conhecida>, o nome dele e a pergunta da unidade', async () => {
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const recebidos: Array<Record<string, unknown>> = [];
    const claude = { beta: { messages: { create: (async (p: Record<string, unknown>) => (recebidos.push(p), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Que bom ter você de volta, Marina!' }] })) as never } } } as ClienteClaude;
    const agente = new Agente(claude, ag, 'base', { modelo: 'claude-opus-5-5', esforco: 'low', nomeIa: async () => 'Serena' });
    const msgs: Mensagem[] = [{ id: 'm1', conversaId: 'c1', autor: 'cliente', texto: 'oi', em: quinta(9) }];
    const r = await agente.executar({ conversa: conversa(), mensagens: msgs, agora: quinta(9), modo: 'responder' });
    expect(r.texto).toContain('de volta');
    const txt = JSON.stringify(recebidos[0]!.messages);
    expect(txt).toContain('cliente_conhecida: sim');
    expect(txt).toContain('primeira resposta da loja nesta conversa: sim');
    expect(txt).toContain('Seu nome (para se apresentar): Serena.');
    expect(txt).toContain('Para qual unidade deseja agendar seu atendimento?\\n*  Salvador Norte Shopping\\n*  Shopping Sumaré');
    const tools = (recebidos[0]!.tools as Array<{ name: string }>).map((t) => t.name);
    expect(tools).toContain('buscar_cliente');
  });

  it('buscar_cliente procura outra pessoa pelo telefone dela e libera o cliente_id para agendar', async () => {
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 81, nome: 'Joana Reis', tel: '5571977776666' });
    const ctx = ctxDe(ag);
    const r = await rodar('buscar_cliente', { unidade: 'sumare', telefone: '71 97777-6666', nome: null }, ctx);
    expect(r.json.clientes).toEqual([{ cliente_id: 81, nome: 'Joana Reis', achada_por: 'telefone' }]);
    expect(ctx.sessao!.clientesVistos.has('sumare:81')).toBe(true);
    const nada = await rodar('buscar_cliente', { unidade: 'sumare', telefone: null, nome: null }, ctx);
    expect(nada.conteudo).toContain('cliente nova');
  });
});

// ---------------------------------------------------------------- 3. unidade

describe('3. Pergunta da unidade: uma mensagem, uma unidade por linha', () => {
  it('as linhas vêm das unidades que agendam, com o nome para clientes', () => {
    expect(blocoUnidades()).toBe('<unidades_para_agendar>\nPara qual unidade deseja agendar seu atendimento?\n*  Salvador Norte Shopping\n*  Shopping Sumaré\n</unidades_para_agendar>');
    definirUnidades('imperio', [UNIDADES_IMPERIO[0]!]);
    expect(blocoUnidades()).toContain('Não pergunte a unidade');
  });
  it('a base não chama de "rainha" em toda mensagem e tirou a frase do formol da boas-vindas', () => {
    const b = carregarBase();
    expect(b).toContain('"rainha" de vez em quando, nunca em toda mensagem');
    expect(b).toContain('Eu sou a [SEU NOME] e vou seguir com o seu atendimento.');
    expect(b).toContain('Que bom ter você de volta, [PRIMEIRO NOME]!');
    expect(b).toContain('Somos a maior referência em alisamento capilar da Bahia.');
    const roteiro = b.slice(b.indexOf('## Roteiro'), b.indexOf('## Tabela Liso'));
    expect(roteiro).not.toContain('sem formol');
    expect(b).toContain('Pergunta: É com formol?');
  });
});

// ---------------------------------------------------------------- 4. horários padrão

describe('4. Horários: só os padrão da unidade que estão livres; outro horário só se ela pedir, até o especial', () => {
  it('cadastro: horários padrão em ordem e sem repetir; especial e serviço padrão; vão para o cache', () => {
    const d = DadosUnidade.parse({ horariosPadrao: ['15:30', '09:00', '12:30', '09:00'], ultimoHorarioEspecial: '18:00', servicoPadraoId: 5 });
    expect(d).toMatchObject({ horariosPadrao: ['09:00', '12:30', '15:30'], ultimoHorarioEspecial: '18:00', servicoPadraoId: 5 });
    expect(DadosUnidade.parse({}).horariosPadrao).toEqual([]);
    expect(DadosUnidade.parse({ horariosPadrao: ['9h'] }).horariosPadrao).toEqual([]); // dado estranho no banco: sem padrão
    unidadesComPadrao();
    expect(unidadeDe('sumare')).toMatchObject({ horariosPadrao: ['09:00', '12:30', '15:30'], ultimoHorarioEspecial: '18:00', servicoPadraoId: 5 });
    expect(unidadeDe('norte')).toMatchObject({ horariosPadrao: ['09:00', '12:30', '15:30', '18:00'], ultimoHorarioEspecial: null });
  });

  it('consultar_horarios devolve só os padrão livres (Sumaré: 09:00, 12:30, 15:30), sem nome de profissional', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    const r = await rodar('consultar_horarios', { unidade: 'sumare', data: '2026-11-07', servico_id: null, profissional_id: null, profissional_nome: null, outros_horarios: null }, ctxDe(ag));
    expect(r.erro).toBe(false);
    expect(r.json.horarios).toEqual(['09:00', '12:30', '15:30']);
    expect(r.json.instrucao).toContain('Temos os seguintes horários:');
    expect(r.conteudo).not.toMatch(/Jéssica|Ana/);
  });

  it('a cliente pede outro horário: livres até o último horário especial (18:00), nunca depois', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    const r = await rodar('consultar_horarios', { unidade: 'sumare', data: '2026-11-07', servico_id: null, profissional_id: null, profissional_nome: null, outros_horarios: true }, ctxDe(ag));
    expect(r.json.horarios).toEqual(['09:00', '10:00', '12:30', '15:30', '16:00', '17:00']);
    // Salvador Norte não tem especial: mesmo pedindo, só os padrão.
    expect(filtrarPelaUnidade('norte', ['09:00', '10:00', '18:00', '19:00'], true)).toEqual(['09:00', '18:00']);
    // Sem horários padrão: todos os livres da agenda (como antes).
    expect(filtrarPelaUnidade('feira', ['10:00', '19:00'], false)).toEqual(['10:00', '19:00']);
  });

  it('agendar fora do padrão: recusado; 17:00 (até o especial) pode; 19:00 não', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const base = { unidade: 'sumare', servico_id: null, profissional_id: null, data: '2026-11-07', nome_cliente: null, data_nascimento: null, email: null, cliente_id: null, para_outra_pessoa: null, telefone_outra_pessoa: null, ja_conferiu_agendamentos: false };
    const r19 = await rodar('agendar', { ...base, hora: '19:00' }, ctxDe(ag));
    expect(r19.erro).toBe(true);
    expect(r19.conteudo).toContain('só marca nos horários 09:00, 12:30, 15:30');
    const r17 = await rodar('agendar', { ...base, hora: '17:00' }, ctxDe(ag));
    expect(r17.erro).toBe(false);
    expect(ag.gravados[0]).toMatchObject({ hora: '17:00', servicoId: 5, profissionalId: 7, clienteId: 55 });
  });
});

// ---------------------------------------------------------------- 5. profissional

describe('5. Nunca o nome da profissional; pedida pela cliente vira PD no agendamento', () => {
  it('a cliente pede a Ana: consulta só a agenda dela e, agendando com ela, grava "PD" na observação', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const r = await rodar('consultar_horarios', { unidade: 'sumare', data: '2026-11-07', servico_id: null, profissional_id: null, profissional_nome: 'ana', outros_horarios: null }, ctxDe(ag));
    expect(r.json).toMatchObject({ profissional_pedida: 'Ana', profissional_id: 8, livre: true, horarios: ['15:30'] });
    const a = await rodar('agendar', { unidade: 'sumare', servico_id: null, profissional_id: 8, data: '2026-11-07', hora: '15:30', nome_cliente: null, data_nascimento: null, email: null, cliente_id: null, para_outra_pessoa: null, telefone_outra_pessoa: null, ja_conferiu_agendamentos: false }, ctxDe(ag));
    expect(a.erro).toBe(false);
    expect(ag.gravados[0]!.observacoes).toMatch(/^PD - Agendado por IA via WhatsApp/);
    expect(a.conteudo).not.toMatch(/Ana|Jéssica/);
  });

  it('a pedida não está livre: oferece os horários sem citar ninguém; sem pedir, a observação não tem PD', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.livres[8] = [];
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const r = await rodar('consultar_horarios', { unidade: 'sumare', data: '2026-11-07', servico_id: null, profissional_id: null, profissional_nome: 'Ana', outros_horarios: null }, ctxDe(ag));
    expect(r.json).toMatchObject({ livre: false, horarios: ['09:00', '12:30'] });
    expect(r.json.instrucao).toContain('sem citar nome de nenhuma profissional');
    await rodar('agendar', { unidade: 'sumare', servico_id: null, profissional_id: null, data: '2026-11-07', hora: '09:00', nome_cliente: null, data_nascimento: null, email: null, cliente_id: null, para_outra_pessoa: null, telefone_outra_pessoa: null, ja_conferiu_agendamentos: false }, ctxDe(ag));
    expect(ag.gravados[0]!.observacoes).toBe('Agendado por IA via WhatsApp (Sintonia)');
  });

  it('a equipe (Serena da tela) escolhe profissional e horário livres: sem PD e sem a regra dos horários padrão', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    const ctx = ctxDe(ag, { origemAgendamento: 'Serena a pedido de Gil' });
    const r = await rodar('agendar', { unidade: 'sumare', servico_id: 1, profissional_id: 7, data: '2026-11-07', hora: '19:00', nome_cliente: 'Cliente', ja_conferiu_agendamentos: true }, ctx);
    expect(r.erro).toBe(false);
    expect(ag.gravados[0]!.observacoes).toBe('Agendado por Serena a pedido de Gil (Sintonia)');
  });
});

// ---------------------------------------------------------------- 6. serviço padrão e tabela

describe('6. Sem perguntar procedimento (serviço padrão) e a imagem da tabela de preços', () => {
  it('serviço padrão do cadastro; sem cadastro, o único "avaliação"; sem nenhum, recusa explicando', async () => {
    const ag = new AgendaFalsa();
    expect(servicoParaAgendar('sumare', ag.servicos)?.id).toBe(5); // sem padrão no cadastro: o de "Avaliação"
    ag.servicos = ag.servicos.filter((s) => s.id !== 5).concat({ id: 9, nome: 'Escova', duracaoEmMinutos: 60, preco: 80, valorPromocional: null });
    expect(servicoParaAgendar('sumare', ag.servicos)).toBeNull();
    const r = await rodar('consultar_horarios', { unidade: 'sumare', data: '2026-11-07', servico_id: null, profissional_id: null, profissional_nome: null, outros_horarios: null }, ctxDe(ag));
    expect(r.erro).toBe(true);
    expect(r.conteudo).toContain('não tem serviço padrão');
    unidadesComPadrao();
    expect(servicoParaAgendar('sumare', [...ag.servicos, { id: 5, nome: 'Qualquer', duracaoEmMinutos: 30, preco: 0 }])?.id).toBe(5);
  });

  const crm = (docs: Array<{ id: string; nome: string; categoria: string; mimetype?: string }>): ServicosCrmIa => ({
    funis: async () => [],
    ondeEsta: async () => [],
    motivosPerda: async () => [],
    produtos: async () => [],
    documentos: async () => docs.map((d) => ({ descricao: '', ...d })),
  });

  it('enviar_tabela_precos acha a imagem pelo nome (cliente nova: "Seu Primeiro Alisamento"); sem imagem, resumo curto', async () => {
    const docs = [
      { id: 'd1', nome: 'Tabela Liso Infinito', categoria: 'tabela', mimetype: 'image/png' },
      { id: 'd2', nome: 'Seu Primeiro Alisamento', categoria: 'tabela', mimetype: 'image/jpeg' },
      { id: 'd3', nome: 'Seu Primeiro Alisamento (PDF)', categoria: 'catalogo', mimetype: 'application/pdf' },
    ];
    expect(acharTabela(docs, 'Seu Primeiro Alisamento')?.id).toBe('d2');
    expect(acharTabela(docs, 'tabela liso infinito')?.id).toBe('d1');
    const acoes: unknown[] = [];
    const r = await rodarFerramentaCrm('enviar_tabela_precos', { nome: 'Seu Primeiro Alisamento', legenda: null }, { conversa: conversa(), agora: quinta(9), acoes, podeEscrever: true, crm: crm(docs) });
    expect(String(r)).toContain('Não escreva a lista de preços');
    expect(acoes).toEqual([{ tipo: 'enviar_arquivo', origem: 'documento', id: 'd2', nome: 'Seu Primeiro Alisamento', legenda: null }]);
    const sem = await rodarFerramentaCrm('enviar_tabela_precos', { nome: 'Liso Infinito', legenda: null }, { conversa: conversa(), agora: quinta(9), acoes: [], podeEscrever: true, crm: crm([]) });
    expect(String(sem)).toContain('resumo curto');
  });
});

// ---------------------------------------------------------------- 1 + 7. agendar sem duplicar cadastro

describe('1/7. Agendar: quem tem cadastro não informa nada; cliente nova informa nome, nascimento e e-mail', () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({ unidade: 'sumare', servico_id: null, profissional_id: null, data: '2026-11-07', hora: '09:00', nome_cliente: null, data_nascimento: null, email: null, cliente_id: null, para_outra_pessoa: null, telefone_outra_pessoa: null, ja_conferiu_agendamentos: false, ...extra });

  it('com cadastro pelo telefone: agenda sem pedir nome e sem criar cadastro novo; o resultado traz a unidade e o próximo passo', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const r = await rodar('agendar', pedido(), ctxDe(ag));
    expect(r.erro).toBe(false);
    expect(ag.criados).toEqual([]);
    expect(r.json).toMatchObject({ ok: true, data: '2026-11-07', hora: '09:00', unidade: 'Shopping Sumaré' });
    expect(r.json.proximo_passo).toContain('enviar_tabela_precos');
  });

  it('cliente nova sem nome: recusa pedindo nome completo, nascimento e e-mail; com os dados, vão para o cadastro', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    const ctx = ctxDe(ag, { conversa: conversa({ nome: undefined }) });
    const r = await rodar('agendar', pedido(), ctx);
    expect(r.erro).toBe(true);
    expect(r.conteudo).toContain('nome completo, data de nascimento e e-mail');
    const ok = await rodar('agendar', pedido({ nome_cliente: 'Carla Menezes', data_nascimento: '1992-03-14', email: 'Carla@Email.com' }), ctxDe(ag, { conversa: conversa({ nome: undefined }) }));
    expect(ok.erro).toBe(false);
    expect(ag.criados).toEqual([{ nome: 'Carla Menezes', telefone: TEL, extras: { dataNascimento: '1992-03-14', email: 'carla@email.com' } }]);
  });

  it('cadastro achado pelo nome do perfil: o cliente_id que a IA viu evita cadastro duplicado; id inventado é recusado', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 66, nome: 'Marina Souza', tel: '5571999990000' });
    ag.falharTelefone = true; // dono 28/11: pelo nome só quando o telefone dá erro
    await conhecerCliente(ag, conversa(), quinta(8));
    ag.falharTelefone = false;
    const r = await rodar('agendar', pedido({ cliente_id: 66 }), ctxDe(ag));
    expect(r.erro).toBe(false);
    expect(ag.criados).toEqual([]);
    expect(ag.gravados[0]!.clienteId).toBe(66);
    const falso = await rodar('agendar', pedido({ cliente_id: 12345, hora: '12:30' }), ctxDe(ag));
    expect(falso.erro).toBe(true);
    expect(falso.conteudo).toContain('buscar_cliente');
  });

  it('para outra pessoa: cria o cadastro dela e a ação não troca o cadastro da dona da conversa', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const ctx = ctxDe(ag);
    const r = await rodar('agendar', pedido({ para_outra_pessoa: true, nome_cliente: 'Joana Reis', telefone_outra_pessoa: '(71) 97777-6666' }), ctx);
    expect(r.erro).toBe(false);
    expect(ag.criados).toEqual([{ nome: 'Joana Reis', telefone: '5571977776666', extras: undefined }]);
    expect(ctx.acoes[0]).toMatchObject({ tipo: 'agendou', paraOutraPessoa: true });
  });

  it('o horário acabou de ser ocupado (o espelho dizia livre): confere na agenda de verdade e não marca', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    ag.livres[7] = ['12:30'];
    const r = await rodar('agendar', pedido(), ctxDe(ag));
    expect(r.erro).toBe(true);
    expect(r.conteudo).toContain('não está mais livre');
    expect(ag.gravados).toEqual([]);
  });

  it('as regras de conduzir até agendar vão para o agente padrão e para os agentes do estúdio', () => {
    const s = systemPrompt('base');
    expect(s).toContain('"Posso confirmar seu agendamento para [DIA], às [HORA], na unidade [UNIDADE]?"');
    expect(s).toContain('nunca diga nome de profissional');
    expect(s).toContain('Temos os seguintes horários:');
    expect(s).not.toContain('confirme com a cliente: serviço, unidade, dia, hora e profissional');
    const a: AgenteIa = { id: 'a1', empresaId: 'imperio', nome: 'Serena', avatar: null, provedor: 'anthropic', modelo: 'claude-opus-5-5', criatividade: 50, unidades: [], ativo: true, config: configPadrao() } as unknown as AgenteIa;
    const st = systemDoAgente({ agente: a, conhecimento: [], aprendizados: [], ferramentas: ['consultar_horarios', 'agendar'] });
    expect(st).toContain('<como_conduzir_ate_agendar>');
    expect(st).not.toContain('Antes de marcar, confirme serviço, unidade, dia, hora e profissional');
    expect(REGRAS_ATENDIMENTO.join(' ')).toContain('Que bom ter você de volta');
  });

  it('a base traz a confirmação organizada com emojis, por unidade, com o endereço', () => {
    const b = carregarBase();
    expect(b).toContain('Agendamento confirmado ✅\n  Data: [DATA]\n  Horário: [HORÁRIO]\n  Local: Shopping Sumaré — Avenida Tancredo Neves, 2º piso');
    expect(b).toContain('Local: Salvador Norte Shopping — São Cristóvão, Piso L2, em frente à Narciso Enxovais');
    expect(b).toContain('agende direto, sem perguntar');
  });
});

// ---------------------------------------------------------------- 8. mais humana

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  eventos: string[] = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, _t: string, texto: string) {
    this.eventos.push(`texto:${texto}`);
    return { idExterno: `out-${this.eventos.length}` };
  }
  async enviarMidia() {
    return { idExterno: 'm' };
  }
  async enviarPresenca(_c: string, _t: string, tipo: string, ms: number) {
    this.eventos.push(`${tipo}:${ms}`);
  }
}

describe('8. Mais humana: 1 a 3 mensagens com "digitando…" entre elas', () => {
  it('a IA separa as mensagens com "---"; sem separador, continua uma só', () => {
    expect(partirParaWhatsApp('Pronto, perfeito!\n---\nPara qual dia você deseja o seu atendimento?')).toEqual(['Pronto, perfeito!', 'Para qual dia você deseja o seu atendimento?']);
    expect(partirParaWhatsApp('Ótimo!')).toEqual(['Ótimo!']);
    expect(partirParaWhatsApp('a\n---\nb\n---\nc\n---\nd')).toEqual(['a', 'b', 'c\n\nd']);
    // A confirmação com quebras de linha vai inteira, numa mensagem só.
    const conf = 'Agendamento confirmado ✅\n📅 Data: 07/11\n⏰ Horário: 09:00\n📍 Shopping Sumaré — Av. Tancredo Neves\nAté breve! 💜';
    expect(partirParaWhatsApp(conf)).toEqual([conf]);
    expect(pausaDigitando('Ótimo!')).toBe(1800);
    expect(pausaDigitando('x'.repeat(60))).toBe(3700);
    expect(pausaDigitando('x'.repeat(400))).toBe(7000);
  });

  it('entre uma mensagem e outra mostra "digitando…" pelo tempo proporcional e espera', async () => {
    const repo = new RepositorioMemoria();
    const canal = new CanalFalso();
    const esperas: number[] = [];
    const relogio = { t: quinta(10) };
    const claude = { beta: { messages: { create: (async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pronto, perfeito!\n---\nPara qual dia você deseja o seu atendimento?' }] })) as never } } } as ClienteClaude;
    const agente = new Agente(claude, new AgendaFalsa(), 'base', { modelo: 'claude-opus-5-5', esforco: 'low', prazoAgendaMs: 50 });
    const s = new Sintonia({
      empresaId: 'imperio',
      repo,
      numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
      agente,
      agora: () => relogio.t,
      configIa: async () => ({ modoPadrao: 'ia' }),
      esperar: async (ms) => {
        esperas.push(ms);
        relogio.t = new Date(relogio.t.getTime() + ms);
      },
      pausaEntrePartes: (t) => 1000 + t.length,
    });
    await s.receber({ canalId: 'imperio-norte', telefone: TEL, nome: 'Marina', texto: 'Sumaré', deMim: false, idExterno: 'in-1', em: relogio.t });
    const p2 = 'Para qual dia você deseja o seu atendimento?';
    const p1 = 'Pronto, perfeito!';
    expect(canal.eventos).toEqual(['digitando:12000', `digitando:${1000 + p1.length}`, `texto:${p1}`, `digitando:${1000 + p2.length}`, `texto:${p2}`]);
    expect(esperas).toContain(1000 + p1.length);
    expect(esperas).toContain(1000 + p2.length);
  });
});

// ---------------------------------------------------------------- 9. espelho da agenda

describe('9. Espelho da agenda: próximos 14 dias, aos poucos, relido depois de agendar', () => {
  const roteador = (ag: AgendaFalsa): RoteadorAgenda => ({ paraUnidade: (u) => ({ sistema: ag, tipo: 'trinks', local: u === 'sumare' ? '222074' : '240643' }) });

  it('atualiza no máximo `porRodada` leituras por vez, as mais velhas primeiro, e guarda no armazém', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    const armazem = new ArmazemEspelhoMemoria();
    const relogio = { t: quinta(8) };
    const e = new EspelhoAgenda({ empresaId: 'imperio', fonte: roteador(ag), armazem, unidades: () => ['sumare'], agora: () => relogio.t, porRodada: 4 });
    await e.rodada();
    expect(e.leituras).toBe(4);
    for (let i = 0; i < 4; i++) await e.rodada();
    expect(e.leituras).toBe(15); // 14 dias + a lista de marcados
    expect((await armazem.dias('imperio')).length).toBe(14);
    await e.rodada();
    expect(e.leituras).toBe(15); // tudo em dia: nenhuma chamada
    relogio.t = new Date(relogio.t.getTime() + 4 * MIN);
    await e.rodada();
    expect(e.leituras).toBe(19); // os 3 primeiros dias e os marcados (3 min), não os 11 de longe (20 min)
    // Outro processo (reinício): lê do banco, sem chamar a agenda.
    const e2 = new EspelhoAgenda({ empresaId: 'imperio', fonte: roteador(ag), armazem, unidades: () => ['sumare'], agora: () => relogio.t });
    await e2.carregar();
    expect(e2.vagosDe('sumare', '2026-11-10', 5)).not.toBeNull();
    expect(e2.leituras).toBe(0);
  });

  it('a IA consulta horários pelo espelho (sem chamar o Trinks) e, depois de agendar, o dia é relido', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.clientes.push({ id: 55, nome: 'Marina Souza', tel: TEL });
    const relogio = { t: quinta(8) };
    const e = new EspelhoAgenda({ empresaId: 'imperio', fonte: ag, armazem: new ArmazemEspelhoMemoria(), unidades: () => ['sumare'], agora: () => relogio.t, porRodada: 20 });
    definirEspelho(e);
    await e.rodada();
    const antes = ag.chamadas.vagos ?? 0;
    const livres = await horariosLivres(ag, 'sumare', '2026-11-07', 5, undefined, quinta(8), { espelho: true });
    expect(livres.map((p) => p.horarios)).toEqual([['09:00', '10:00', '12:30', '17:00', '19:00'], ['15:30', '16:00']]);
    expect(ag.chamadas.vagos ?? 0).toBe(antes);
    const r = await rodar('agendar', { unidade: 'sumare', servico_id: null, profissional_id: null, data: '2026-11-07', hora: '09:00', nome_cliente: null, data_nascimento: null, email: null, cliente_id: null, para_outra_pessoa: null, telefone_outra_pessoa: null, ja_conferiu_agendamentos: false }, ctxDe(ag));
    expect(r.erro).toBe(false);
    expect(ag.chamadas.vagos).toBeGreaterThan(antes); // conferiu no sistema antes de gravar
    expect(e.vagosDe('sumare', '2026-11-07', 5)).toBeNull(); // sujo: a próxima consulta vai ao sistema
    await e.rodada();
    expect(e.vagosDe('sumare', '2026-11-07', 5)!.find((p) => p.profissionalId === 7)!.horarios).not.toContain('09:00');
  });

  it('a aba Agenda lê os marcados do espelho quando ele cobre o período e está em dia', async () => {
    unidadesComPadrao();
    const ag = new AgendaFalsa();
    ag.periodo = [{ id: 31, dataHoraInicio: '2026-11-06T10:00:00', duracaoEmMinutos: 60, valor: 0, profissional: { id: 7, nome: 'Jéssica Lima' }, cliente: { id: 1, nome: 'Rita' } }];
    const relogio = { t: quinta(8) };
    const e = new EspelhoAgenda({ empresaId: 'imperio', fonte: roteador(ag), armazem: new ArmazemEspelhoMemoria(), unidades: () => ['sumare'], agora: () => relogio.t, porRodada: 20 });
    await e.rodada();
    const n = ag.chamadas.periodo;
    const externa = new AgendaExterna({ roteador: roteador(ag), espelho: () => e, agora: () => relogio.t.getTime() });
    const r = await externa.daUnidade('sumare', '2026-11-06', '2026-11-06');
    expect(r.itens).toMatchObject([{ sistemaId: 31, cliente: 'Rita', profissional: 'Jéssica' }]);
    expect(ag.chamadas.periodo).toBe(n);
    // Período fora do espelho (dias que passaram): vai ao sistema.
    await externa.daUnidade('sumare', '2026-10-01', '2026-10-02');
    expect(ag.chamadas.periodo).toBe((n ?? 0) + 1);
  });
});

describe('dono 28/11: nome errado e emoji de rosto', () => {
  it('cadastro com nome diferente do perfil não vira nome da cliente', async () => {
    const { textoClienteConhecida } = await import('../src/ai/cliente-conhecida.js');
    const t = textoClienteConhecida({ conhecida: true, nome: 'Giovanna Souza', nomeConfirmado: false, por: 'telefone', confirmar: false, unidade: 'norte', clienteId: 1, ultimoAtendimento: null, proximoHorario: null }, true);
    expect(t).not.toContain('nome no cadastro: Giovanna');
    expect(t).toContain('NÃO chame a cliente por nome nenhum');
    expect(t).toContain('boas-vindas sem nome nenhum');
  });
  it('tira emoji de rosto e mantém os de apoio', async () => {
    const { semEmojiDeRosto } = await import('../src/app/sintonia.js');
    expect(semEmojiDeRosto('Me conta sua dúvida que eu te ajudo. 😊')).toBe('Me conta sua dúvida que eu te ajudo.');
    expect(semEmojiDeRosto('Agendamento confirmado ✅ Até breve! 💜')).toBe('Agendamento confirmado ✅ Até breve! 💜');
  });
});

describe('dono 28/11: voz grátis (Kokoro)', () => {
  it('fala sem emoji nem link e devolve o áudio com o tipo certo', async () => {
    const { VozKokoro, textoParaFala } = await import('../src/ai/voz.js');
    expect(textoParaFala('Temos às 09:00 ✅ veja https://x.com *ok*')).toBe('Temos às 09:00 veja ok');
    let corpo = '';
    const v = new VozKokoro('http://voz:8880/', { fetchFn: (async (_u: string, i: RequestInit) => { corpo = String(i.body); return new Response(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(1000)]), { status: 200 }); }) as unknown as typeof fetch });
    const a = await v.falar('Oi! 💜');
    expect(JSON.parse(corpo)).toMatchObject({ texto: 'Oi!', voz: 'pf_dora' });
    expect(a.mimetype).toBe('audio/ogg');
  });
});

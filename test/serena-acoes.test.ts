import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { registrarConversa } from '../src/conversa/rotas.js';
import { RespostasMemoria } from '../src/conversa/respostas.js';
import { TranscricoesMemoria } from '../src/conversa/transcricao.js';
import type { ClienteClaude } from '../src/ai/agente.js';
import { ArmazemTagsMemoria, Tags } from '../src/tags/tags.js';
import { ArmazemFunisMemoria, Funis } from '../src/funis/funis.js';
import { ArmazemAutomacoesMemoria, Automacoes } from '../src/automacoes/automacoes.js';
import { registrarFunis } from '../src/rotas/funis.js';
import { registrarReunioes } from '../src/reunioes/reunioes.js';
import { AcoesSerena, fontesDoBanco, funisComEtapas, type FontesSerena } from '../src/serena/acoes.js';
import { poolDeTeste, temPostgres } from './repos.js';

type Bloco = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
interface Pedido {
  tools?: Array<{ name: string }>;
  system: Array<{ text: string }>;
  messages: Array<{ role: string; content: unknown }>;
}

/** Claude de mentira com roteiro: cada chamada devolve a próxima resposta (texto e/ou ferramentas). */
function claudeRoteiro(respostas: Bloco[][]) {
  const pedidos: Pedido[] = [];
  let i = 0;
  const claude = {
    beta: {
      messages: {
        create: async (p: Pedido) => {
          pedidos.push(structuredClone(p));
          const content = respostas[Math.min(i++, respostas.length - 1)]!;
          return { stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', content };
        },
      },
    },
  } as unknown as ClienteClaude;
  return { claude, pedidos };
}

const usar = (name: string, input: unknown, id = `tu_${name}`): Bloco => ({ type: 'tool_use', id, name, input });
const texto = (t: string): Bloco => ({ type: 'text', text: t });

async function montar(respostas: Bloco[][], extra: { pool?: import('pg').Pool; semAcoes?: boolean } = {}) {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Souza', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const armazemTags = new ArmazemTagsMemoria(() => repo.listarConversas());
  const tags = new Tags(armazemTags, 'imperio');
  const funis = new Funis({ armazem: new ArmazemFunisMemoria(repo, armazemTags), armazemTags, tags, repo, empresaId: 'imperio', comConversa: async (id, fn) => { const c = await repo.buscarConversa(id); return c ? fn(c) : undefined; } });
  const automacoes = new Automacoes({ armazem: new ArmazemAutomacoesMemoria(armazemTags), repo, empresaId: 'imperio', sintonia: () => sintonia, funis, tags, contas });
  const app = criarServidor({ sintonia, repo, auth: { contas }, ...(extra.pool ? { poolReunioes: extra.pool } : {}) });
  const ia = claudeRoteiro(respostas);
  registrarFunis(app, { repo, funis, automacoes });
  registrarConversa(app, {
    repo,
    sintonia,
    empresaId: 'imperio',
    respostas: new RespostasMemoria(),
    transcricoes: new TranscricoesMemoria(),
    ia: { claude: ia.claude, modelo: 'claude-opus-5-5', base: async () => '', ligada: () => true },
    canalDa: () => ({ erro: 'sem número' }),
    serenaAcoes: extra.semAcoes
      ? undefined
      : (empresaId): FontesSerena => ({
          ...(extra.pool ? fontesDoBanco(extra.pool, empresaId) : {}),
          funis: async () => funisComEtapas(await funis.listar(), await tags.listar()),
          tags: () => tags.listar(),
          conferirAutomacao: (d) => automacoes.conferir(d),
        }),
  });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  const admin = await entrar('bruno@imperio.com');
  const carla = await entrar('carla@imperio.com');
  const funil = (await app.inject({ method: 'POST', url: '/api/funis', headers: { cookie: admin }, payload: { nome: 'Vendas', etapas: [{ nome: 'Lead' }, { nome: 'Proposta' }] } })).json() as {
    id: string;
    etapas: Array<{ id: string; nome: string }>;
  };
  const chat = (cookie: string, pergunta: string) => app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie }, payload: { mensagens: [{ papel: 'usuario', texto: pergunta }] } });
  return { app, ia, admin, carla, funil, chat, automacoes };
}

describe('Serena faz coisas no CRM (prévia + Salvar)', () => {
  it('monta um fluxo de automação com ids reais: consulta, mostra o cartão e não salva nada', async () => {
    const m = await montar([]);
    const [lead, proposta] = m.funil.etapas as [{ id: string; nome: string }, { id: string; nome: string }];
    const fluxo = {
      nome: 'Boas-vindas do lead',
      gatilho: { tipo: 'entrou_na_etapa', etapaId: lead.id },
      passos: [
        { tipo: 'enviar_mensagem', texto: 'Oi {primeiro_nome}! Tudo bem?' },
        { tipo: 'esperar', minutos: 1440 },
        { tipo: 'condicao', se: 'cliente_respondeu', entao: [{ tipo: 'mover_etapa', funilId: m.funil.id, etapaId: proposta.id }], senao: [{ tipo: 'lembrete_ligacao', em_minutos: 0, texto: 'Ligar para o lead' }] },
      ],
    };
    const roteiro = claudeRoteiro([[texto('Vou olhar seus funis.'), usar('consultar_crm', {})], [usar('mostrar_automacao', fluxo)], [texto('Montei o fluxo. Quer salvar?')]]);
    // Troca o roteiro do Claude do app (o mesmo objeto foi passado para a rota).
    (m.ia.claude as unknown as { beta: unknown }).beta = (roteiro.claude as unknown as { beta: unknown }).beta;

    const r = await m.chat(m.admin, 'Cria um fluxo para dar boas-vindas a quem entra em Lead');
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.texto).toContain('Montei o fluxo');
    expect(b.artefatos).toHaveLength(1);
    const a = b.artefatos[0];
    expect(a).toMatchObject({ tipo: 'automacao', acao: 'criar', titulo: 'Boas-vindas do lead' });
    expect(a.dados).toMatchObject({ funilId: m.funil.id, ligada: false, opcoes: { parar_se_equipe_responder: true } });
    // Prévia com nomes (gatilho → passos → condição com os dois caminhos).
    expect(a.fluxo.gatilho).toEqual({ tipo: 'entrou_na_etapa', titulo: 'Entrou na etapa', detalhe: '"Lead"' });
    expect(a.fluxo.passos.map((p: { titulo: string }) => p.titulo)).toEqual(['Enviar mensagem', 'Esperar', 'Condição']);
    expect(a.fluxo.passos[1].detalhe).toBe('1 dia');
    expect(a.fluxo.passos[2].entao[0].detalhe).toBe('"Proposta" do funil "Vendas"');
    // A consulta trouxe os ids reais; o resultado de cada ferramenta voltou para a IA.
    const p2 = roteiro.pedidos[1]!;
    const resultado = JSON.stringify(p2.messages.at(-1));
    expect(resultado).toContain(`etapaId ${lead.id}`);
    expect(JSON.stringify(roteiro.pedidos[2]!.messages.at(-1))).toContain('NADA foi salvo');
    expect(roteiro.pedidos[0]!.tools!.map((t) => t.name)).toEqual(expect.arrayContaining(['consultar_crm', 'mostrar_automacao', 'mostrar_etiqueta']));
    expect(roteiro.pedidos[0]!.system.map((s) => s.text).join('\n')).toContain('Você NUNCA salva');
    // Nada gravado ainda.
    expect(await m.automacoes.listar()).toHaveLength(0);
    // "Salvar" no cartão = a rota de sempre, com os dados do artefato.
    const salvo = await m.app.inject({ method: 'POST', url: '/api/automacoes', headers: { cookie: m.admin }, payload: a.dados });
    expect(salvo.statusCode).toBe(201);
    expect(salvo.json()).toMatchObject({ nome: 'Boas-vindas do lead', ligada: false, funilId: m.funil.id });
  });

  it('id inventado volta como erro para a IA corrigir (e não vira cartão)', async () => {
    const m = await montar([]);
    const roteiro = claudeRoteiro([
      [usar('mostrar_automacao', { nome: 'X', gatilho: { tipo: 'entrou_na_etapa', etapaId: 'nao-existe' }, passos: [{ tipo: 'esperar', minutos: 5 }] })],
      [texto('Não achei essa etapa. Qual etapa você quer usar?')],
    ]);
    (m.ia.claude as unknown as { beta: unknown }).beta = (roteiro.claude as unknown as { beta: unknown }).beta;
    const b = (await m.chat(m.admin, 'cria um fluxo')).json();
    expect(b.artefatos).toBeUndefined();
    const res = (roteiro.pedidos[1]!.messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>)[0]!;
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/etapa não encontrada/);
  });

  it('atendente não ganha a ferramenta de automação nem de etiqueta; a IA sabe explicar por quê', async () => {
    const m = await montar([[texto('Só a gestão cria fluxos. Fale com a gerência.')]]);
    const r = await m.chat(m.carla, 'cria uma automação');
    expect(r.statusCode).toBe(200);
    const nomes = m.ia.pedidos[0]!.tools!.map((t) => t.name);
    expect(nomes).not.toContain('mostrar_automacao');
    expect(nomes).not.toContain('mostrar_etiqueta');
    expect(m.ia.pedidos[0]!.system.map((s) => s.text).join('\n')).toMatch(/NÃO pode criar fluxos de automação nem etiquetas/);
    // E a rota de salvar continua barrando.
    expect((await m.app.inject({ method: 'POST', url: '/api/automacoes', headers: { cookie: m.carla }, payload: {} })).statusCode).toBe(403);
  });

  it('sem as ações configuradas a Serena só conversa (sem ferramentas)', async () => {
    const m = await montar([[texto('Oi!')]], { semAcoes: true });
    const r = await m.chat(m.admin, 'oi');
    expect(r.json()).toEqual({ texto: 'Oi!' });
    expect(m.ia.pedidos[0]!.tools).toBeUndefined();
  });

  it('etiqueta repetida e link de agendamento com horário errado voltam como erro; o certo vira cartão', async () => {
    const tags = [{ id: 't1', nome: 'VIP', funilId: null }];
    const acoes = new AcoesSerena({ tags: async () => tags, links: async () => [] }, { automacoes: false, etiquetas: true });
    expect((await acoes.executar('mostrar_etiqueta', { nome: 'vip' })).erro).toBe(true);
    expect((await acoes.executar('mostrar_etiqueta', { nome: 'Indicação', cor: '#106ebe' })).erro).toBeUndefined();
    expect((await acoes.executar('mostrar_link_agendamento', { titulo: 'Reunião', duracao_min: 30, dias: [1], inicio: '18:00', fim: '09:00' })).erro).toBe(true);
    expect((await acoes.executar('mostrar_link_agendamento', { titulo: 'Reunião de 30 min', duracao_min: 30, dias: [5, 1, 1], inicio: '09:00', fim: '18:00' })).erro).toBeUndefined();
    expect(acoes.artefatos.map((a) => [a.tipo, a.titulo])).toEqual([['etiqueta', 'Indicação'], ['link', 'Reunião de 30 min']]);
    expect(acoes.artefatos[1]!.dados).toMatchObject({ dias: [1, 5], antecedencia_h: 2, janela_dias: 21 });
    expect(acoes.ferramentas().map((f) => f.name)).not.toContain('mostrar_automacao');
    // Passo que pede id que a IA não tem (transmissão) não entra.
    const gestor = new AcoesSerena({ funis: async () => [], tags: async () => [] }, { automacoes: true, etiquetas: true });
    const r = await gestor.executar('mostrar_automacao', { nome: 'X', gatilho: { tipo: 'nova_conversa' }, passos: [{ tipo: 'enviar_transmissao', transmissaoId: 'a' }] });
    expect(r).toMatchObject({ erro: true });
  });

  it.skipIf(!temPostgres)('script de venda: cria a prévia, edita um que já existe e salva pelas rotas de Scripts', async () => {
    const pool = await poolDeTeste();
    await pool.query('delete from sintonia.scripts_venda');
    const m = await montar([], { pool });
    const criado = (await m.app.inject({ method: 'POST', url: '/api/scripts', headers: { cookie: m.carla }, payload: { titulo: 'Primeiro contato', etapa: 'Lead', texto: 'Oi {nome}!' } })).json();
    const roteiro = claudeRoteiro([
      [usar('consultar_crm', {})],
      [usar('ler_script', { id: criado.id })],
      [usar('mostrar_script', { id: criado.id, titulo: 'Primeiro contato', etapa: 'Lead', texto: 'Oi {nome}! Vi que você se interessou. Posso te contar como funciona?' })],
      [texto('Deixei o script mais caloroso. Quer salvar?')],
    ]);
    (m.ia.claude as unknown as { beta: unknown }).beta = (roteiro.claude as unknown as { beta: unknown }).beta;
    const b = (await m.chat(m.carla, 'Melhora meu script de primeiro contato')).json();
    expect(JSON.stringify(roteiro.pedidos[1]!.messages.at(-1))).toContain(`id ${criado.id}`);
    expect(JSON.stringify(roteiro.pedidos[2]!.messages.at(-1))).toContain('Oi {nome}!');
    expect(b.artefatos[0]).toMatchObject({ tipo: 'script', acao: 'editar', alvoId: criado.id, dados: { titulo: 'Primeiro contato', etapa: 'Lead' } });
    // Ainda não mudou no banco.
    expect((await pool.query('select texto from sintonia.scripts_venda where id = $1', [criado.id])).rows[0].texto).toBe('Oi {nome}!');
    const put = await m.app.inject({ method: 'PUT', url: `/api/scripts/${criado.id}`, headers: { cookie: m.carla }, payload: b.artefatos[0].dados });
    expect(put.statusCode).toBe(200);
    expect((await pool.query('select texto from sintonia.scripts_venda where id = $1', [criado.id])).rows[0].texto).toMatch(/Posso te contar/);
  });
});

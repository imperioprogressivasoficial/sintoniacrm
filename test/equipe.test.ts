import { describe, expect, it } from 'vitest';
import type { Agenda } from '../src/ai/ferramentas.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas, type Papel, type Usuario } from '../src/auth/contas.js';
import { podeGerenciar, podeVer, recusaAtribuicao } from '../src/auth/acesso.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { Conversa } from '../src/domain.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);
const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);

interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; contas: Contas }>;
}
const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria() }) },
  ...(temPostgres
    ? [{ nome: 'postgres', criar: async () => { const pool = await poolDeTeste(); return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool) }; } }]
    : []),
];

async function montar(amb: Ambiente) {
  const { repo, contas } = await amb.criar();
  const relogio = { t: quinta(14) };
  const enviados: Array<{ telefone: string; texto: string }> = [];
  const canal: CanalWhatsApp = {
    tipo: 'evolution',
    lerWebhook: () => [],
    enviarTexto: async (_c, telefone, texto) => {
      enviados.push({ telefone, texto });
      return { idExterno: `out-${Math.random()}` };
    },
  };
  const criadosTrinks: unknown[] = [];
  const agenda: Agenda = {
    listarServicos: async () => [{ id: 1, nome: 'Progressiva Império', duracaoEmMinutos: 180, preco: 320, visivelParaCliente: true }],
    listarProfissionais: async () => [{ id: 7, nome: 'Jéssica', possuiAgenda: true }],
    horariosVagos: async () => [{ id: 7, nome: 'Jéssica', horariosVagos: ['14:00'] }],
    buscarClientePorTelefone: async () => null,
    criarCliente: async () => 55,
    criarAgendamento: async (_e, dados) => {
      criadosTrinks.push(dados);
      return 999;
    },
    listarAgendamentosDoCliente: async () => [],
  };
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal },
    ],
    agente: { executar: async () => ({ texto: 'Sugestão', acoes: [], recusou: false }) },
    agora: () => relogio.t,
  });
  const app = criarServidor({ sintonia, repo, agenda, agora: () => relogio.t, auth: { contas, agora: () => relogio.t } });

  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    direcao: await pessoa('Diana Reis', 'direcao', []),
    gerenteNorte: await pessoa('Gil Norte', 'gerente', ['norte']),
    gerenteSumare: await pessoa('Sara Sumare', 'gerente', ['sumare']),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
    bia: await pessoa('Bia Souza', 'atendente', ['norte']),
    rita: await pessoa('Rita Recepção', 'recepcionista', ['sumare']),
    nova: await pessoa('Nina Semunidade', 'atendente', []),
  };
  const cookies = new Map<string, string>();
  const cookieDe = async (u: Usuario) => {
    let c = cookies.get(u.id);
    if (!c) {
      c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 24 * 3600_000))}`;
      cookies.set(u.id, c);
    }
    return c;
  };
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: await cookieDe(u) }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  let tel = 0;
  const conversa = async (unidade: 'norte' | 'sumare', nome: string): Promise<Conversa> => {
    const telefone = `55719881200${++tel}`;
    await sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome, texto: 'Oi, quanto custa?', deMim: false, idExterno: `in-${unidade}-${tel}`, em: relogio.t });
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  return { app, repo, contas, sintonia, relogio, gente, como, cookieDe, conversa, enviados, criadosTrinks };
}

const ids = (r: { json(): unknown }) => (r.json() as Array<{ id: string }>).map((c) => c.id).sort();

describe.each(ambientes)('Quem vê o quê ($nome)', (amb) => {
  it('cada papel vê só as conversas que deve, e a de outra pessoa dá 404 em todas as ações', async () => {
    const { gente, como, conversa, sintonia } = await montar(amb);
    const n1 = await conversa('norte', 'Marina');
    const n2 = await conversa('norte', 'Joana');
    const s1 = await conversa('sumare', 'Paula');
    await sintonia.definirResponsavel(n2.id, { id: gente.bia.id, nome: gente.bia.nome }, gente.gerenteNorte, 'transferiu');

    const lista = async (u: Usuario) => ids(await como(u, 'GET', '/api/conversas'));
    expect(await lista(gente.admin)).toEqual([n1.id, n2.id, s1.id].sort());
    expect(await lista(gente.direcao)).toEqual([n1.id, n2.id, s1.id].sort());
    expect(await lista(gente.gerenteNorte)).toEqual([n1.id, n2.id].sort());
    expect(await lista(gente.gerenteSumare)).toEqual([s1.id]);
    expect(await lista(gente.carla)).toEqual([n1.id]); // n2 é da Bia
    expect(await lista(gente.bia)).toEqual([n1.id, n2.id].sort());
    expect(await lista(gente.rita)).toEqual([s1.id]);
    expect(await lista(gente.nova)).toEqual([]); // sem unidade não vê nada

    // Conversa de outra pessoa: 404 em tudo, sem revelar que existe.
    const base = `/api/conversas/${n2.id}`;
    expect((await como(gente.carla, 'GET', base)).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `${base}/enviar`, { texto: 'oi' })).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `${base}/modo`, { modo: 'humano' })).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `${base}/digitando`, {})).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `${base}/revisar`, { rascunho: 'oi' })).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `${base}/assumir`, {})).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `${base}/transferir`, { usuarioId: gente.carla.id })).statusCode).toBe(404);
    expect((await como(gente.carla, 'GET', `${base}/foto`)).statusCode).toBe(204);
    const agendar = { unidade: 'norte', servicoId: 1, profissionalId: 7, data: '2026-11-07', hora: '14:00', nomeCliente: 'Joana Silva' };
    expect((await como(gente.carla, 'POST', `${base}/agendar`, agendar)).statusCode).toBe(404);
    expect((await como(gente.rita, 'GET', `/api/conversas/${n1.id}`)).statusCode).toBe(404); // outra unidade
    expect((await como(gente.carla, 'GET', '/api/conversas/nao-existe')).statusCode).toBe(404);

    // Quem pode, vê.
    expect((await como(gente.bia, 'GET', base)).statusCode).toBe(200);
    expect((await como(gente.gerenteNorte, 'GET', base)).statusCode).toBe(200);
    expect((await como(gente.gerenteSumare, 'GET', base)).statusCode).toBe(404);
  });

  it('painel e relatório só contam as conversas visíveis', async () => {
    const { gente, como, conversa } = await montar(amb);
    await conversa('norte', 'Marina');
    await conversa('norte', 'Joana');
    await conversa('sumare', 'Paula');
    const painel = async (u: Usuario) => (await como(u, 'GET', '/api/painel')).json().conversas;
    expect(await painel(gente.admin)).toBe(3);
    expect(await painel(gente.gerenteNorte)).toBe(2);
    expect(await painel(gente.rita)).toBe(1);
    expect(await painel(gente.nova)).toBe(0);
    expect((await como(gente.rita, 'GET', '/api/relatorio')).json().texto).toContain('1');
    expect((await como(gente.carla, 'GET', '/api/fila/falhas')).statusCode).toBe(403);
  });
});

describe.each(ambientes)('Dona da conversa ($nome)', (amb) => {
  it('a primeira resposta de uma atendente a faz dona; o nome vem da sessão', async () => {
    const { gente, como, conversa, repo, relogio } = await montar(amb);
    const n1 = await conversa('norte', 'Marina');
    // Gerente ajudando não vira dona.
    expect((await como(gente.gerenteNorte, 'POST', `/api/conversas/${n1.id}/enviar`, { texto: 'Oi, Marina!' })).statusCode).toBe(200);
    expect((await repo.buscarConversa(n1.id))!.responsavelId).toBeUndefined();

    relogio.t = quinta(14, 5);
    const r = await como(gente.carla, 'POST', `/api/conversas/${n1.id}/enviar`, { texto: 'Fica R$ 290', atendente: 'Nome Inventado' });
    expect(r.statusCode).toBe(200);
    const c = (await repo.buscarConversa(n1.id))!;
    expect(c.responsavelId).toBe(gente.carla.id);
    expect(c.responsavelNome).toBe('Carla Lima');
    const msgs = await repo.mensagens(n1.id);
    expect(msgs.at(-1)).toMatchObject({ autor: 'equipe', autorNome: 'Carla Lima' });
    const ev = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'transferencia');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.dados).toMatchObject({ paraId: gente.carla.id, paraNome: 'Carla Lima', motivo: 'primeira_resposta' });

    // Agora a Bia não vê mais; a segunda resposta da Carla não gera outro evento.
    expect((await como(gente.bia, 'GET', `/api/conversas/${n1.id}`)).statusCode).toBe(404);
    await como(gente.carla, 'POST', `/api/conversas/${n1.id}/enviar`, { texto: 'Quer marcar?' });
    expect((await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'transferencia')).toHaveLength(1);
  });

  it('assumir, transferir e liberar seguem as regras e ficam registrados', async () => {
    const { gente, como, conversa, repo, contas } = await montar(amb);
    const n1 = await conversa('norte', 'Marina');
    const url = `/api/conversas/${n1.id}`;

    // Sem dona: a atendente não transfere, mas assume.
    expect((await como(gente.carla, 'GET', url)).json().permissoes).toEqual({ assumir: true, transferir: false });
    expect((await como(gente.carla, 'POST', `${url}/transferir`, { usuarioId: gente.bia.id })).statusCode).toBe(403);
    const assumiu = await como(gente.carla, 'POST', `${url}/assumir`, {});
    expect(assumiu.json()).toEqual({ ok: true, responsavelId: gente.carla.id, responsavelNome: 'Carla Lima' });
    expect((await como(gente.carla, 'GET', url)).json().permissoes).toEqual({ assumir: false, transferir: true });

    // Bia não vê mais (404), nem para assumir.
    expect((await como(gente.bia, 'POST', `${url}/assumir`, {})).statusCode).toBe(404);

    // A dona lista para quem pode passar: só quem atende a unidade (sem admin/direção).
    const opcoes = (await como(gente.carla, 'GET', `${url}/transferir`)).json() as Array<{ nome: string }>;
    expect(opcoes.map((p) => p.nome).sort()).toEqual(['Bia Souza', 'Carla Lima', 'Gil Norte']);

    // A dona transfere para a Bia; aí a Carla deixa de ver.
    expect((await como(gente.carla, 'POST', `${url}/transferir`, { usuarioId: gente.bia.id })).json().responsavelNome).toBe('Bia Souza');
    expect((await como(gente.carla, 'GET', url)).statusCode).toBe(404);

    // Não dá para passar para quem não atende a unidade nem para quem está desativada.
    expect((await como(gente.bia, 'POST', `${url}/transferir`, { usuarioId: gente.rita.id })).statusCode).toBe(400);
    await contas.atualizarUsuario(gente.carla.id, { ativo: false });
    expect((await como(gente.bia, 'POST', `${url}/transferir`, { usuarioId: gente.carla.id })).statusCode).toBe(400);
    await contas.atualizarUsuario(gente.carla.id, { ativo: true });

    // Gerente da unidade assume a conversa da Bia e depois libera.
    expect((await como(gente.gerenteNorte, 'POST', `${url}/assumir`, {})).json().responsavelNome).toBe('Gil Norte');
    expect((await como(gente.gerenteNorte, 'POST', `${url}/transferir`, { usuarioId: null })).json()).toEqual({ ok: true, responsavelId: null, responsavelNome: null });
    expect((await como(gente.carla, 'GET', url)).statusCode).toBe(200); // sem dona: volta para todas da unidade

    // Gerente de outra unidade não enxerga.
    expect((await como(gente.gerenteSumare, 'POST', `${url}/assumir`, {})).statusCode).toBe(404);

    const ev = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'transferencia').map((e) => e.dados);
    expect(ev).toEqual([
      expect.objectContaining({ deId: null, paraId: gente.carla.id, porNome: 'Carla Lima', motivo: 'assumiu' }),
      expect.objectContaining({ deId: gente.carla.id, deNome: 'Carla Lima', paraId: gente.bia.id, paraNome: 'Bia Souza', porNome: 'Carla Lima', motivo: 'transferiu' }),
      expect.objectContaining({ deId: gente.bia.id, paraId: gente.gerenteNorte.id, porNome: 'Gil Norte', motivo: 'assumiu' }),
      expect.objectContaining({ deId: gente.gerenteNorte.id, paraId: null, motivo: 'liberou' }),
    ]);
  });
});

describe.each(ambientes)('Anti-duplicidade ($nome)', (amb) => {
  it('quem chegou depois é recusado com 409 enquanto a outra está respondendo', async () => {
    const { gente, como, conversa, relogio, criadosTrinks, enviados } = await montar(amb);
    const n1 = await conversa('norte', 'Marina');
    const url = `/api/conversas/${n1.id}`;

    await como(gente.carla, 'POST', `${url}/digitando`, {});
    relogio.t = new Date(relogio.t.getTime() + 5_000);
    await como(gente.bia, 'POST', `${url}/digitando`, {});

    // Cada uma vê a outra respondendo (nunca a si mesma).
    expect((await como(gente.bia, 'GET', url)).json().digitando).toEqual([{ usuarioId: gente.carla.id, nome: 'Carla Lima' }]);
    expect((await como(gente.carla, 'GET', url)).json().digitando).toEqual([{ usuarioId: gente.bia.id, nome: 'Bia Souza' }]);

    // A Bia começou depois: envio e agendamento recusados, e nada vai para o Trinks.
    const r = await como(gente.bia, 'POST', `${url}/enviar`, { texto: 'Oi!' });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toContain('Carla Lima já está respondendo');
    const ag = await como(gente.bia, 'POST', `${url}/agendar`, { unidade: 'norte', servicoId: 1, profissionalId: 7, data: '2026-11-07', hora: '14:00', nomeCliente: 'Marina Souza' });
    expect(ag.statusCode).toBe(409);
    expect(criadosTrinks).toHaveLength(0);
    expect(enviados).toHaveLength(0);

    // A gerente pode passar por cima.
    expect((await como(gente.gerenteNorte, 'POST', `${url}/enviar`, { texto: 'Oi, Marina, é a gerente.' })).statusCode).toBe(200);

    // A Carla envia (tem a vez), vira dona e para de "digitar".
    expect((await como(gente.carla, 'POST', `${url}/enviar`, { texto: 'Fica R$ 290' })).statusCode).toBe(200);
    expect((await como(gente.gerenteNorte, 'GET', url)).json().digitando).toEqual([{ usuarioId: gente.bia.id, nome: 'Bia Souza' }]);
  });

  it('o sinal vale ~60 s; depois disso a outra pessoa pode responder', async () => {
    const { gente, como, conversa, relogio, repo } = await montar(amb);
    const n1 = await conversa('norte', 'Marina');
    const url = `/api/conversas/${n1.id}`;
    await como(gente.carla, 'POST', `${url}/digitando`, {});
    relogio.t = new Date(relogio.t.getTime() + 30_000);
    expect((await como(gente.bia, 'POST', `${url}/enviar`, { texto: 'Oi!' })).statusCode).toBe(409);
    relogio.t = new Date(relogio.t.getTime() + 31_000);
    expect((await como(gente.bia, 'GET', url)).json().digitando).toEqual([]);
    expect((await como(gente.bia, 'POST', `${url}/enviar`, { texto: 'Oi!' })).statusCode).toBe(200);
    expect((await repo.buscarConversa(n1.id))!.responsavelId).toBe(gente.bia.id);
  });

  it('a sequência de digitação recomeça depois de uma pausa longa', async () => {
    const { repo, conversa, relogio } = await montar(amb);
    const n1 = await conversa('norte', 'Marina');
    const t0 = relogio.t;
    await repo.registrarDigitando(n1.id, { usuarioId: '00000000-0000-4000-8000-000000000001', nome: 'A' }, t0);
    await repo.registrarDigitando(n1.id, { usuarioId: '00000000-0000-4000-8000-000000000002', nome: 'B' }, new Date(t0.getTime() + 10_000));
    await repo.registrarDigitando(n1.id, { usuarioId: '00000000-0000-4000-8000-000000000001', nome: 'A' }, new Date(t0.getTime() + 40_000));
    let d = await repo.digitando(n1.id, t0);
    expect(d.map((x) => x.nome)).toEqual(['A', 'B']);
    expect(d[0]!.desde.getTime()).toBe(t0.getTime());
    // A some por mais de 60 s e volta: entra no fim da fila.
    await repo.registrarDigitando(n1.id, { usuarioId: '00000000-0000-4000-8000-000000000002', nome: 'B' }, new Date(t0.getTime() + 60_000));
    await repo.registrarDigitando(n1.id, { usuarioId: '00000000-0000-4000-8000-000000000001', nome: 'A' }, new Date(t0.getTime() + 110_000));
    d = await repo.digitando(n1.id, t0);
    expect(d.map((x) => x.nome)).toEqual(['B', 'A']);
    await repo.pararDigitando(n1.id, '00000000-0000-4000-8000-000000000002');
    expect((await repo.digitando(n1.id, t0)).map((x) => x.nome)).toEqual(['A']);
  });
});

describe.each(ambientes)('Gestão da equipe ($nome)', (amb) => {
  it('atendente e recepcionista não acessam a equipe', async () => {
    const { gente, como } = await montar(amb);
    expect((await como(gente.carla, 'GET', '/api/equipe')).statusCode).toBe(403);
    expect((await como(gente.rita, 'POST', '/api/equipe', { nome: 'X', email: 'x@x.com', papel: 'atendente', unidades: ['sumare'], senha: SENHA })).statusCode).toBe(403);
    expect((await como(gente.carla, 'POST', `/api/equipe/${gente.bia.id}/desativar`, {})).statusCode).toBe(403);
  });

  it('gerente vê e gerencia só gente das unidades dele, sem dar papéis de gestão', async () => {
    const { gente, como, contas } = await montar(amb);
    const lista = (await como(gente.gerenteNorte, 'GET', '/api/equipe')).json();
    expect(lista.papeis).toEqual(['atendente', 'recepcionista']);
    expect(lista.unidades).toEqual(['norte']);
    const porNome = Object.fromEntries((lista.pessoas as Array<{ nome: string; podeGerenciar: boolean }>).map((p) => [p.nome, p.podeGerenciar]));
    expect(porNome).toEqual({ 'Bia Souza': true, 'Carla Lima': true, 'Gil Norte': false });
    expect(JSON.stringify(lista)).not.toContain('senha');

    const nova = { nome: 'Lara Nova', email: 'lara@imperio.com', papel: 'atendente', unidades: ['norte'], senha: SENHA };
    const criada = await como(gente.gerenteNorte, 'POST', '/api/equipe', nova);
    expect(criada.statusCode).toBe(201);
    expect(criada.json()).toMatchObject({ nome: 'Lara Nova', papel: 'atendente', unidades: ['norte'], ativo: true });
    expect((await como(gente.gerenteNorte, 'POST', '/api/equipe', nova)).statusCode).toBe(409); // e-mail repetido
    expect((await como(gente.gerenteNorte, 'POST', '/api/equipe', { ...nova, email: 'b@x.com', unidades: ['sumare'] })).statusCode).toBe(403);
    expect((await como(gente.gerenteNorte, 'POST', '/api/equipe', { ...nova, email: 'c@x.com', unidades: [] })).statusCode).toBe(403);
    for (const papel of ['gerente', 'direcao', 'admin']) {
      expect((await como(gente.gerenteNorte, 'POST', '/api/equipe', { ...nova, email: `${papel}@x.com`, papel })).statusCode).toBe(403);
    }
    const fraca = await como(gente.gerenteNorte, 'POST', '/api/equipe', { ...nova, email: 'd@x.com', senha: 'curta1' });
    expect(fraca.statusCode).toBe(400);
    expect(fraca.json().erro).toMatch(/10 caracteres/);

    // Editar: pode trocar entre atendente e recepcionista, não promover nem mudar de unidade.
    const carla = `/api/equipe/${gente.carla.id}`;
    expect((await como(gente.gerenteNorte, 'PATCH', carla, { papel: 'gerente' })).statusCode).toBe(403);
    expect((await como(gente.gerenteNorte, 'PATCH', carla, { unidades: ['norte', 'sumare'] })).statusCode).toBe(403);
    expect((await como(gente.gerenteNorte, 'PATCH', carla, { papel: 'recepcionista' })).json()).toMatchObject({ papel: 'recepcionista', unidades: ['norte'] });

    // Gente de fora das unidades dele nem aparece (404): recepcionista do Sumaré, direção.
    expect((await como(gente.gerenteNorte, 'PATCH', `/api/equipe/${gente.rita.id}`, { papel: 'atendente' })).statusCode).toBe(404);
    expect((await como(gente.gerenteNorte, 'POST', `/api/equipe/${gente.direcao.id}/desativar`, {})).statusCode).toBe(404);
    expect((await como(gente.gerenteNorte, 'POST', `/api/equipe/${gente.direcao.id}/senha`, { senha: 'OutraSenha2026' })).statusCode).toBe(404);
    // Aparece mas não é dele: quem também trabalha em outra unidade (403).
    const dupla = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Duda Dupla', email: 'duda@imperio.com', papel: 'atendente', unidades: ['norte', 'sumare'], senhaHash: 'x' });
    expect((await como(gente.gerenteNorte, 'POST', `/api/equipe/${dupla.id}/desativar`, {})).statusCode).toBe(403);
    expect((await como(gente.gerenteSumare, 'POST', `/api/equipe/${dupla.id}/senha`, { senha: 'OutraSenha2026' })).statusCode).toBe(403);
    // Ninguém desativa a si mesmo.
    expect((await como(gente.gerenteNorte, 'POST', `/api/equipe/${gente.gerenteNorte.id}/desativar`, {})).statusCode).toBe(403);
    expect((await como(gente.admin, 'POST', `/api/equipe/${gente.admin.id}/desativar`, {})).statusCode).toBe(403);
  });

  it('direção cria gerente mas não mexe em admin; admin faz tudo', async () => {
    const { gente, como } = await montar(amb);
    const base = { nome: 'Gerente Nova', email: 'gn@imperio.com', papel: 'gerente', unidades: ['sumare'], senha: SENHA };
    expect((await como(gente.direcao, 'POST', '/api/equipe', base)).statusCode).toBe(201);
    expect((await como(gente.direcao, 'POST', '/api/equipe', { ...base, email: 'ad@imperio.com', papel: 'admin' })).statusCode).toBe(403);
    expect((await como(gente.direcao, 'POST', `/api/equipe/${gente.admin.id}/desativar`, {})).statusCode).toBe(403);
    expect((await como(gente.direcao, 'PATCH', `/api/equipe/${gente.carla.id}`, { papel: 'admin' })).statusCode).toBe(403);
    expect((await como(gente.admin, 'PATCH', `/api/equipe/${gente.carla.id}`, { papel: 'direcao', unidades: [] })).json()).toMatchObject({ papel: 'direcao' });
    expect((await como(gente.admin, 'POST', `/api/equipe/${gente.direcao.id}/desativar`, {})).json()).toMatchObject({ ativo: false });
  });

  it('desativar encerra as sessões na hora; reativar devolve o acesso', async () => {
    const { gente, como, app } = await montar(amb);
    expect((await como(gente.carla, 'GET', '/api/conversas')).statusCode).toBe(200);
    expect((await como(gente.gerenteNorte, 'POST', `/api/equipe/${gente.carla.id}/desativar`, {})).json()).toMatchObject({ ativo: false });
    expect((await como(gente.carla, 'GET', '/api/conversas')).statusCode).toBe(401);
    const entrar = () => app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: SENHA } });
    expect((await entrar()).statusCode).toBe(401);
    await como(gente.gerenteNorte, 'POST', `/api/equipe/${gente.carla.id}/reativar`, {});
    expect((await entrar()).statusCode).toBe(200);
  });
});

describe.each(ambientes)('Senhas ($nome)', (amb) => {
  it('trocar a própria senha pede a atual e encerra as outras sessões', async () => {
    const { gente, como, app, contas, relogio } = await montar(amb);
    const outra = `sintonia_sessao=${await contas.criarSessao(gente.carla.id, new Date(relogio.t.getTime() + 3600_000))}`;
    expect((await como(gente.carla, 'POST', '/api/auth/senha', { atual: 'errada123456', nova: 'NovaSenha2026' })).statusCode).toBe(400);
    const fraca = await como(gente.carla, 'POST', '/api/auth/senha', { atual: SENHA, nova: 'somenteletras' });
    expect(fraca.json().erro).toMatch(/letras e números/);
    expect((await como(gente.carla, 'POST', '/api/auth/senha', { atual: SENHA, nova: 'NovaSenha2026' })).statusCode).toBe(200);

    expect((await como(gente.carla, 'GET', '/api/auth/eu')).statusCode).toBe(200); // esta continua
    expect((await app.inject({ url: '/api/auth/eu', headers: { cookie: outra } })).statusCode).toBe(401); // a outra caiu
    const entrar = (senha: string) => app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha } });
    expect((await entrar(SENHA)).statusCode).toBe(401);
    expect((await entrar('NovaSenha2026')).statusCode).toBe(200);
  });

  it('gestor redefine a senha de quem ele gerencia; a pessoa sai de todos os aparelhos', async () => {
    const { gente, como, app } = await montar(amb);
    expect((await como(gente.carla, 'GET', '/api/auth/eu')).statusCode).toBe(200);
    expect((await como(gente.bia, 'POST', `/api/equipe/${gente.carla.id}/senha`, { senha: 'Redefinida2026' })).statusCode).toBe(403);
    expect((await como(gente.gerenteNorte, 'POST', `/api/equipe/${gente.carla.id}/senha`, { senha: 'curta' })).statusCode).toBe(400);
    expect((await como(gente.gerenteNorte, 'POST', `/api/equipe/${gente.carla.id}/senha`, { senha: 'Redefinida2026' })).statusCode).toBe(200);
    expect((await como(gente.carla, 'GET', '/api/auth/eu')).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: 'Redefinida2026' } });
    expect(r.statusCode).toBe(200);
  });
});

describe('Regras de acesso (puras)', () => {
  const u = (papel: Papel, unidades: string[], id: string = papel): Usuario => ({ id, empresaId: 'imperio', nome: id, email: `${id}@x`, papel, unidades, ativo: true });
  const c = (unidade: 'norte' | 'sumare', responsavelId?: string) =>
    ({ id: 'c', empresaId: 'imperio', unidade, responsavelId, canalId: 'x', telefone: '1', modo: 'copiloto', etapa: 'novo_lead', etiquetas: [], criadaEm: new Date(), atualizadaEm: new Date() }) as Conversa;

  it('podeVer por papel', () => {
    expect(podeVer(u('admin', []), c('sumare', 'x'))).toBe(true);
    expect(podeVer(u('gerente', ['norte']), c('norte', 'x'))).toBe(true);
    expect(podeVer(u('gerente', ['norte']), c('sumare'))).toBe(false);
    expect(podeVer(u('atendente', ['norte'], 'a'), c('norte', 'a'))).toBe(true);
    expect(podeVer(u('atendente', ['norte'], 'a'), c('norte', 'b'))).toBe(false);
    expect(podeVer(u('recepcionista', [], 'a'), c('norte'))).toBe(false);
    expect(podeVer({ ...u('admin', []), empresaId: 'outra' }, c('norte'))).toBe(false);
  });

  it('gerente não gerencia quem trabalha também em outra unidade', () => {
    const g = u('gerente', ['norte'], 'g');
    expect(podeGerenciar(g, u('atendente', ['norte', 'sumare'], 'a'))).toBe(false);
    expect(podeGerenciar(g, u('atendente', ['norte'], 'a'))).toBe(true);
    expect(podeGerenciar(g, u('atendente', [], 'a'))).toBe(false);
    expect(recusaAtribuicao(g, 'atendente', ['norte'])).toBeNull();
    expect(recusaAtribuicao(u('direcao', []), 'admin', [])).toMatch(/Administração/);
  });
});

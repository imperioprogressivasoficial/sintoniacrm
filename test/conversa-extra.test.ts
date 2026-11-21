import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { CanalTeste } from '../src/channels/teste.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemPerfisMemoria, ArmazemPerfisPostgres, registrarConta, type ArmazemPerfis } from '../src/conta/conta.js';
import {
  ConversasPessoaisMemoria,
  ConversasPessoaisPostgres,
  estaArquivada,
  estaSilenciada,
  fimDoSilencio,
  type ConversasPessoais,
} from '../src/conversa/pessoal.js';
import { ArmazemNotificacoesMemoria } from '../src/notificacoes/armazem.js';
import { Notificador } from '../src/notificacoes/notificador.js';
import { ChavesPush, type EnviadorPush } from '../src/notificacoes/push.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

// conversa-extra: papel de parede (preferências da conta), silenciar e arquivar conversas — tudo por pessoa.
const SENHA = 'Imperio2026xyz';

interface Pecas {
  repo: Repositorio;
  contas: Contas;
  perfis: ArmazemPerfis;
  pessoais: ConversasPessoais;
}
const ambientes: Array<{ nome: string; criar(): Promise<Pecas> }> = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria(), perfis: new ArmazemPerfisMemoria(), pessoais: new ConversasPessoaisMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.perfis_usuario, sintonia.conversas_pessoais cascade');
            return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), perfis: new ArmazemPerfisPostgres(pool), pessoais: new ConversasPessoaisPostgres(pool) };
          },
        },
      ]
    : []),
];

async function montar(p: Pecas) {
  const { repo, contas, perfis, pessoais } = p;
  const senhaHash = await gerarHash(SENHA);
  const pessoa = (empresaId: string, nome: string, email: string, papel: 'admin' | 'atendente', unidades: string[]) =>
    contas.criarUsuario({ empresaId, nome, email, papel, unidades, senhaHash });
  const gente = {
    bruno: await pessoa('imperio', 'Bruno', 'bruno@imperio.com', 'admin', []),
    carla: await pessoa('imperio', 'Carla', 'carla@imperio.com', 'atendente', ['norte']),
    outra: await pessoa('outra', 'Olga', 'olga@outra.com', 'admin', []),
  };
  const agora = new Date('2026-11-21T12:00:00Z');
  const criar = (empresaId: string, unidade: 'norte' | 'sumare', telefone: string, nome: string) =>
    repo.buscarOuCriarConversa({ empresaId, unidade, canalId: `teste-${unidade}`, telefone, nome, agora }).then((r) => r.conversa);
  const norte = await criar('imperio', 'norte', '5571988887777', 'Juliana');
  const sumare = await criar('imperio', 'sumare', '5571977776666', 'Bia');
  const deFora = await criar('outra', 'norte', '5571966665555', 'Cliente de outra empresa');
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'teste-norte', unidade: 'norte', canal: new CanalTeste() }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const app = criarServidor({ sintonia, repo, auth: { contas }, pessoais });
  registrarConta(app, { contas, perfis });
  const cookies = new Map<string, string>();
  const entrar = async (email: string) => {
    if (!cookies.has(email)) cookies.set(email, String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: SENHA } })).headers['set-cookie']).split(';')[0]!);
    return cookies.get(email)!;
  };
  const como = async (u: { email: string }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: await entrar(u.email) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  type Linha = { id: string; silenciada: boolean; silenciadaAte: string | null; arquivada: boolean };
  const lista = async (u: { email: string }) => (await como(u, 'GET', '/api/conversas')).json() as Linha[];
  const linha = async (u: { email: string }, id: string) => (await lista(u)).find((c) => c.id === id);
  return { app, repo, gente, norte, sumare, deFora, como, lista, linha };
}

describe('Regras de silenciar e arquivar', () => {
  const agora = new Date('2026-11-21T12:00:00Z');
  it('8 horas, 1 semana, sempre e tirar', () => {
    expect((fimDoSilencio('8h', agora) as Date).toISOString()).toBe('2026-11-21T20:00:00.000Z');
    expect((fimDoSilencio('1sem', agora) as Date).toISOString()).toBe('2026-11-28T12:00:00.000Z');
    expect(fimDoSilencio('sempre', agora)).toBe('sempre');
    expect(fimDoSilencio('nao', agora)).toBeNull();
    const ate = new Date('2026-11-21T20:00:00Z');
    expect(estaSilenciada({ silenciadaAte: ate, silenciadaSempre: false, arquivadaEm: null }, agora)).toBe(true);
    expect(estaSilenciada({ silenciadaAte: ate, silenciadaSempre: false, arquivadaEm: null }, new Date('2026-11-21T20:00:01Z'))).toBe(false);
    expect(estaSilenciada({ silenciadaAte: null, silenciadaSempre: true, arquivadaEm: null }, new Date('2030-01-01'))).toBe(true);
    expect(estaSilenciada(undefined, agora)).toBe(false);
  });
  it('mensagem nova da cliente tira do arquivo', () => {
    const e = { silenciadaAte: null, silenciadaSempre: false, arquivadaEm: agora };
    expect(estaArquivada(e, new Date('2026-11-21T11:00:00Z'))).toBe(true);
    expect(estaArquivada(e, undefined)).toBe(true);
    expect(estaArquivada(e, new Date('2026-11-21T12:00:01Z'))).toBe(false);
    expect(estaArquivada(undefined, null)).toBe(false);
  });
});

describe.each(ambientes)('conversa-extra ($nome)', (amb) => {
  it('papel de parede fica na conta da pessoa, separado para claro e escuro', async () => {
    const m = await montar(await amb.criar());
    const c0 = (await m.como(m.gente.carla, 'GET', '/api/conta')).json();
    expect(c0.preferencias.papelParede).toEqual({ claro: { cor: 'padrao', desenho: true }, escuro: { cor: 'padrao', desenho: true } });
    const c1 = (await m.como(m.gente.carla, 'PATCH', '/api/conta', { preferencias: { papelParede: { claro: { cor: 'menta' } } } })).json();
    expect(c1.preferencias.papelParede).toEqual({ claro: { cor: 'menta', desenho: true }, escuro: { cor: 'padrao', desenho: true } });
    // mudar só o escuro (e só o desenho) não apaga o claro nem o tema
    await m.como(m.gente.carla, 'PATCH', '/api/conta', { preferencias: { tema: 'escuro' } });
    const c2 = (await m.como(m.gente.carla, 'PATCH', '/api/conta', { preferencias: { papelParede: { escuro: { cor: 'marinho', desenho: false } } } })).json();
    expect(c2.preferencias).toMatchObject({ tema: 'escuro', papelParede: { claro: { cor: 'menta', desenho: true }, escuro: { cor: 'marinho', desenho: false } } });
    // vale em qualquer aparelho (lido do servidor) e é só dela
    expect((await m.como(m.gente.carla, 'GET', '/api/conta')).json().preferencias.papelParede.escuro.cor).toBe('marinho');
    expect((await m.como(m.gente.bruno, 'GET', '/api/conta')).json().preferencias.papelParede.claro.cor).toBe('padrao');
    // cor que não existe: recusada
    expect((await m.como(m.gente.carla, 'PATCH', '/api/conta', { preferencias: { papelParede: { claro: { cor: 'roxo-neon' } } } })).statusCode).toBe(400);
    expect((await m.como(m.gente.carla, 'PATCH', '/api/conta', { preferencias: { papelParede: { claro: { desenho: 'sim' } } } })).statusCode).toBe(400);
  });

  it('silenciar é por pessoa: 8 h, 1 semana, sempre e voltar a tocar', async () => {
    const m = await montar(await amb.criar());
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ silenciada: false, silenciadaAte: null });
    const r = await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: [m.norte.id], duracao: '8h' });
    expect(r.json()).toMatchObject({ ok: true, conversas: 1, silenciada: true, sempre: false });
    const l = (await m.linha(m.gente.carla, m.norte.id))!;
    expect(l.silenciada).toBe(true);
    const horas = (new Date(l.silenciadaAte!).getTime() - Date.now()) / 3600_000;
    expect(horas).toBeGreaterThan(7.9);
    expect(horas).toBeLessThanOrEqual(8);
    // o Bruno vê a mesma conversa sem silêncio
    expect(await m.linha(m.gente.bruno, m.norte.id)).toMatchObject({ silenciada: false });
    await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: [m.norte.id], duracao: '1sem' });
    expect((new Date((await m.linha(m.gente.carla, m.norte.id))!.silenciadaAte!).getTime() - Date.now()) / 86400_000).toBeGreaterThan(6.9);
    await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: [m.norte.id], duracao: 'sempre' });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ silenciada: true, silenciadaAte: null });
    await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: [m.norte.id], duracao: 'nao' });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ silenciada: false, silenciadaAte: null });
    // dados ruins e sem login
    expect((await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: [m.norte.id], duracao: '3h' })).statusCode).toBe(400);
    expect((await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: ['x'], duracao: '8h' })).statusCode).toBe(400);
    expect((await m.app.inject({ method: 'POST', url: '/api/conversas/silenciar', payload: { ids: [m.norte.id], duracao: '8h' } })).statusCode).toBe(401);
  });

  it('não alcança conversa que a pessoa não vê nem de outra empresa', async () => {
    const m = await montar(await amb.criar());
    // a Carla é da unidade Norte: a Sumaré é ignorada
    expect((await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: [m.sumare.id, m.norte.id], duracao: 'sempre' })).json().conversas).toBe(1);
    expect((await m.como(m.gente.carla, 'POST', '/api/conversas/arquivar', { ids: [m.sumare.id], arquivar: true })).json().conversas).toBe(0);
    expect(await m.linha(m.gente.bruno, m.sumare.id)).toMatchObject({ silenciada: false, arquivada: false });
    // a Olga (outra empresa) não mexe nas conversas da Império, e a da empresa dela não aparece para a Império
    expect((await m.como(m.gente.outra, 'POST', '/api/conversas/arquivar', { ids: [m.norte.id], arquivar: true })).json().conversas).toBe(0);
    expect((await m.como(m.gente.outra, 'POST', '/api/conversas/silenciar', { ids: [m.norte.id], duracao: '8h' })).json().conversas).toBe(0);
    expect((await m.lista(m.gente.outra)).map((c) => c.id)).toEqual([m.deFora.id]);
    expect((await m.como(m.gente.outra, 'POST', '/api/conversas/arquivar', { ids: [m.deFora.id], arquivar: true })).json().conversas).toBe(1);
    expect(await m.linha(m.gente.outra, m.deFora.id)).toMatchObject({ arquivada: true });
    expect((await m.lista(m.gente.bruno)).some((c) => c.id === m.deFora.id)).toBe(false);
    expect(await m.linha(m.gente.bruno, m.norte.id)).toMatchObject({ arquivada: false, silenciada: false });
  });

  it('arquivar é por pessoa e mensagem nova da cliente tira do arquivo', async () => {
    const m = await montar(await amb.criar());
    const r = await m.como(m.gente.carla, 'POST', '/api/conversas/arquivar', { ids: [m.norte.id], arquivar: true });
    expect(r.json()).toMatchObject({ ok: true, conversas: 1, arquivada: true });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ arquivada: true });
    expect(await m.linha(m.gente.bruno, m.norte.id)).toMatchObject({ arquivada: false });
    // equipe respondendo não desarquiva
    const c = (await m.repo.buscarConversa(m.norte.id))!;
    await m.repo.salvarConversa({ ...c, ultimaMensagemEquipe: new Date(Date.now() + 60_000) });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ arquivada: true });
    // a cliente escreveu: volta para a lista principal
    await m.repo.salvarConversa({ ...(await m.repo.buscarConversa(m.norte.id))!, ultimaMensagemCliente: new Date(Date.now() + 60_000) });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ arquivada: false });
    // arquivar de novo (depois da mensagem) vale; desarquivar à mão também
    await m.como(m.gente.carla, 'POST', '/api/conversas/arquivar', { ids: [m.norte.id], arquivar: true });
    // o relógio do servidor está antes da "mensagem do futuro": ainda conta como desarquivada
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ arquivada: false });
    await m.repo.salvarConversa({ ...(await m.repo.buscarConversa(m.norte.id))!, ultimaMensagemCliente: new Date(Date.now() - 60_000) });
    await m.como(m.gente.carla, 'POST', '/api/conversas/arquivar', { ids: [m.norte.id], arquivar: true });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ arquivada: true });
    await m.como(m.gente.carla, 'POST', '/api/conversas/arquivar', { ids: [m.norte.id], arquivar: false });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ arquivada: false });
    // arquivar e silenciar não se atrapalham
    await m.como(m.gente.carla, 'POST', '/api/conversas/silenciar', { ids: [m.norte.id], duracao: 'sempre' });
    await m.como(m.gente.carla, 'POST', '/api/conversas/arquivar', { ids: [m.norte.id], arquivar: true });
    expect(await m.linha(m.gente.carla, m.norte.id)).toMatchObject({ arquivada: true, silenciada: true });
    expect((await m.como(m.gente.carla, 'POST', '/api/conversas/arquivar', { ids: [m.norte.id], arquivar: 'sim' })).statusCode).toBe(400);
  });
});

describe('Push respeita a conversa silenciada', () => {
  it('quem silenciou não recebe push da conversa; os outros recebem; lembrete de ligação continua', async () => {
    const repo = new RepositorioMemoria();
    const contas = new ContasMemoria();
    const armazem = new ArmazemNotificacoesMemoria();
    const pessoais = new ConversasPessoaisMemoria();
    const pushes: Array<{ endpoint: string; carga: Record<string, unknown> }> = [];
    const enviador: EnviadorPush = { async enviar(i, carga) { pushes.push({ endpoint: i.endpoint, carga: JSON.parse(carga) }); } };
    const relogio = { t: new Date('2026-11-21T15:00:00Z') };
    const n = new Notificador({
      armazem, contas, repo, empresaId: 'imperio', agora: () => relogio.t,
      push: { chaves: new ChavesPush(armazem, new Cofre('teste')), enviador, assunto: 'mailto:teste@example.com' },
      silenciaram: (id, agora) => pessoais.silenciaramAgora(id, agora),
    });
    const conversaId = '00000000-0000-4000-8000-000000000001';
    const outra = '00000000-0000-4000-8000-000000000002';
    for (const u of ['u-carla', 'u-bia']) await armazem.inscrever({ endpoint: `https://push.exemplo/${u}`, usuarioId: u, p256dh: 'x', auth: 'y' });
    const aviso = (usuarioId: string, cid: string, tipo: 'ia_equipe' | 'lembrete_ligacao' = 'ia_equipe') =>
      n.entregar({ id: `${usuarioId}-${cid}-${tipo}`, usuarioId, tipo, titulo: 'A IA passou a cliente', texto: 'Motivo', conversaId: cid, contador: 1, criadaEm: relogio.t, atualizadaEm: relogio.t });
    await pessoais.silenciar('u-carla', 'imperio', [conversaId], new Date(relogio.t.getTime() + 8 * 3600_000));
    expect(await aviso('u-carla', conversaId)).toBe(0);
    expect(await aviso('u-bia', conversaId)).toBe(1);
    expect(await aviso('u-carla', outra)).toBe(1);
    expect(await aviso('u-carla', conversaId, 'lembrete_ligacao')).toBe(1);
    // passou o tempo do silêncio: volta a tocar
    relogio.t = new Date(relogio.t.getTime() + 9 * 3600_000);
    expect(await aviso('u-carla', conversaId)).toBe(1);
    expect(pushes.map((p) => p.endpoint)).toEqual(['https://push.exemplo/u-bia', 'https://push.exemplo/u-carla', 'https://push.exemplo/u-carla', 'https://push.exemplo/u-carla']);
  });
});

import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { EvolutionAdmin } from '../src/channels/evolution-admin.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemMemoria, ArmazemPostgres, Conexoes } from '../src/conexoes/conexoes.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

describe('Cofre', () => {
  it('cifra e decifra; outro segredo não abre', () => {
    const a = new Cofre('segredo-1');
    const c = a.cifrar('sk-ant-123');
    expect(c).not.toContain('sk-ant');
    expect(a.decifrar(c)).toBe('sk-ant-123');
    expect(() => new Cofre('outro').decifrar(c)).toThrow();
  });
});

describe('Conexões', () => {
  it('o salvo vale por cima do ambiente; vazio volta ao ambiente; avisa a cada mudança', async () => {
    const armazem = new ArmazemMemoria();
    const c = new Conexoes(armazem, new Cofre('s'), { trinksApiKey: 'do-ambiente' });
    const vistos: Array<string | undefined> = [];
    c.aoMudar((v) => vistos.push(v.trinksApiKey));
    await c.carregar();
    expect(c.get('webhookToken')).toMatch(/^[a-f0-9]{48}$/); // gerado na primeira vez
    await c.salvar({ trinksApiKey: 'da-tela' }, 'bruno');
    expect(c.get('trinksApiKey')).toBe('da-tela');
    expect([...armazem.dados.values()].join()).not.toContain('da-tela'); // guardado cifrado
    await c.salvar({ trinksApiKey: '' }, 'bruno');
    expect(c.get('trinksApiKey')).toBe('do-ambiente');
    expect(vistos.at(-1)).toBe('do-ambiente');
  });

  it('o resumo nunca devolve a chave, só o final', async () => {
    const c = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
    await c.carregar();
    await c.salvar({ anthropicApiKey: 'sk-ant-segredo-9876', evolutionUrl: 'https://evo.exemplo' }, 'x');
    const r = JSON.stringify(c.resumo());
    expect(r).not.toContain('segredo');
    expect(r).toContain('9876');
    expect(r).toContain('https://evo.exemplo');
  });

  it('telefones do relatório: só dígitos e com DDD', async () => {
    const c = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
    await c.carregar();
    await c.salvar({ relatorioDestinos: '(71) 99999-1111, 123, 5571988887777' }, 'x');
    expect(c.destinosRelatorio()).toEqual(['71999991111', '5571988887777']);
  });
});

describe.runIf(temPostgres)('Conexões no Postgres', () => {
  it('guarda cifrado e relê depois de reiniciar', async () => {
    const pool = await poolDeTeste();
    const c1 = new Conexoes(new ArmazemPostgres(pool), new Cofre('s'));
    await c1.carregar();
    await c1.salvar({ anthropicApiKey: 'sk-ant-abc' }, 'bruno@imperio.com');
    const { rows } = await pool.query('select valor, atualizado_por from sintonia.conexoes where chave = $1', ['anthropicApiKey']);
    expect(rows[0].valor).not.toContain('sk-ant');
    expect(rows[0].atualizado_por).toBe('bruno@imperio.com');
    const c2 = new Conexoes(new ArmazemPostgres(pool), new Cofre('s'));
    await c2.carregar();
    expect(c2.get('anthropicApiKey')).toBe('sk-ant-abc');
    expect(c2.get('webhookToken')).toBe(c1.get('webhookToken'));
  });
});

/** Evolution falsa: guarda os pedidos e responde como a v2. */
function evolutionFalsa() {
  const pedidos: Array<{ metodo: string; url: string; corpo?: unknown }> = [];
  const instancias = new Map<string, string>();
  const f = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    pedidos.push({ metodo, url, corpo });
    const u = new URL(url);
    if (u.pathname === '/instance/fetchInstances') {
      const nome = u.searchParams.get('instanceName');
      const lista = [...instancias].map(([name, connectionStatus]) => ({ name, connectionStatus, ownerJid: connectionStatus === 'open' ? '5571988887777@s.whatsapp.net' : null, profileName: 'Império Norte' }));
      return new Response(JSON.stringify(nome ? lista.filter((i) => i.name === nome) : lista));
    }
    if (u.pathname === '/instance/create') {
      instancias.set(corpo.instanceName, 'connecting');
      return new Response(JSON.stringify({ instance: { instanceName: corpo.instanceName }, qrcode: { base64: 'data:image/png;base64,QR' } }), { status: 201 });
    }
    if (u.pathname.startsWith('/webhook/set/')) return new Response('{}');
    if (u.pathname.startsWith('/instance/connect/')) return new Response(JSON.stringify({ base64: 'data:image/png;base64,QR2' }));
    if (u.pathname.startsWith('/instance/logout/')) {
      instancias.set(decodeURIComponent(u.pathname.split('/').pop()!), 'close');
      return new Response('{}');
    }
    return new Response('nao achei', { status: 404 });
  }) as typeof fetch;
  return { f, pedidos, instancias };
}

describe('EvolutionAdmin', () => {
  it('não mexe em instâncias que não são da Sintonia (ex.: Assia)', async () => {
    const { f, pedidos } = evolutionFalsa();
    const adm = new EvolutionAdmin('https://evo', 'k', f);
    await expect(adm.conectar('assia', { url: 'x', token: 't' })).rejects.toThrow('Só instâncias da Sintonia');
    await expect(adm.desconectar('assia')).rejects.toThrow();
    expect(pedidos).toHaveLength(0);
  });
});

async function montar() {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await conexoes.carregar();
  const evo = evolutionFalsa();
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const testes: string[] = [];
  const app = criarServidor({
    sintonia,
    repo,
    auth: { contas },
    conexoes: {
      conexoes,
      fetchFn: evo.f,
      testarIA: async (k) => { testes.push('ia:' + k); if (k === 'ruim') throw new Error('chave inválida'); },
      testarTrinks: async () => ({ resumo: '7 profissionais' }),
    },
  });
  const entrar = async (email: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } });
    return String(r.headers['set-cookie']).split(';')[0]!;
  };
  return { app, conexoes, evo, entrar, testes };
}

describe('Rotas de Conexões', () => {
  it('atendente não vê nem mexe; a página manda ela de volta ao app', async () => {
    const { app, entrar } = await montar();
    const cookie = await entrar('carla@imperio.com');
    expect((await app.inject({ url: '/api/conexoes', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/conexoes', headers: { cookie }, payload: { trinksApiKey: 'x' } })).statusCode).toBe(403);
    const pagina = await app.inject({ url: '/conexoes', headers: { cookie } });
    expect(pagina.statusCode).toBe(302);
    expect(pagina.headers.location).toBe('/app');
    expect((await app.inject({ url: '/conexoes' })).headers.location).toBe('/entrar');
  });

  it('admin salva, testa e não recebe a chave de volta', async () => {
    const { app, entrar, conexoes, testes } = await montar();
    const cookie = await entrar('bruno@imperio.com');
    const r = await app.inject({ method: 'PUT', url: '/api/conexoes', headers: { cookie }, payload: { anthropicApiKey: 'sk-ant-xyz-1234' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('sk-ant-xyz');
    expect(conexoes.get('anthropicApiKey')).toBe('sk-ant-xyz-1234');
    const t = await app.inject({ method: 'POST', url: '/api/conexoes/testar', headers: { cookie }, payload: { alvo: 'ia' } });
    expect(t.json()).toEqual({ ok: true, mensagem: 'IA respondendo' });
    expect(testes).toEqual(['ia:sk-ant-xyz-1234']);
    await app.inject({ method: 'PUT', url: '/api/conexoes', headers: { cookie }, payload: { anthropicApiKey: 'ruim' } });
    const t2 = await app.inject({ method: 'POST', url: '/api/conexoes/testar', headers: { cookie }, payload: { alvo: 'ia' } });
    expect(t2.json()).toMatchObject({ ok: false, erro: 'chave inválida' });
    expect((await app.inject({ method: 'PUT', url: '/api/conexoes', headers: { cookie }, payload: { evolutionUrl: 'nao-e-url' } })).statusCode).toBe(400);
  });

  it('conectar WhatsApp: cria a instância da Sintonia com webhook e token, devolve o QR e registra o número', async () => {
    const { app, entrar, conexoes, evo } = await montar();
    const cookie = await entrar('bruno@imperio.com');
    expect((await app.inject({ method: 'POST', url: '/api/conexoes/whatsapp/norte/conectar', headers: { cookie }, payload: {} })).statusCode).toBe(400); // sem Evolution
    await app.inject({ method: 'PUT', url: '/api/conexoes', headers: { cookie }, payload: { evolutionUrl: 'https://evo.exemplo', evolutionApiKey: 'chave-global' } });
    const r = await app.inject({ method: 'POST', url: '/api/conexoes/whatsapp/norte/conectar', headers: { cookie, host: 'sintonia.n8nimperio.tech' }, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ qr: 'data:image/png;base64,QR', estado: 'conectando' });
    const criar = evo.pedidos.find((p) => p.url.endsWith('/instance/create'))!;
    expect(criar.corpo).toMatchObject({
      instanceName: 'sintonia-norte',
      webhook: { url: 'https://sintonia.n8nimperio.tech/webhooks/evolution', headers: { 'x-sintonia-token': conexoes.get('webhookToken') }, events: ['MESSAGES_UPSERT', 'CALL'] },
    });
    expect(conexoes.numeros()).toEqual([{ canalId: 'sintonia-norte', unidade: 'norte' }]);

    evo.instancias.set('sintonia-norte', 'open');
    const estado = (await app.inject({ url: '/api/conexoes/whatsapp', headers: { cookie } })).json();
    expect(estado.unidades[0]).toMatchObject({ unidade: 'norte', estado: 'conectada', numero: '5571988887777' });
    expect(estado.unidades[1]).toMatchObject({ unidade: 'sumare', estado: 'inexistente' });

    await app.inject({ method: 'POST', url: '/api/conexoes/whatsapp/norte/desconectar', headers: { cookie }, payload: {} });
    expect(conexoes.numeros()).toEqual([]);
    expect(evo.pedidos.some((p) => p.metodo === 'DELETE' && p.url.endsWith('/instance/logout/sintonia-norte'))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, resumoToken, type Contas } from '../src/auth/contas.js';
import { emailRedefinicao, recuperacaoPorEmail } from '../src/auth/recuperacao.js';
import { RESPOSTA_ESQUECI, type Recuperacao } from '../src/auth/rotas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { Usuario } from '../src/auth/contas.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';
const NOVA = 'NovaSenha2026ok';

const ambientes: Array<{ nome: string; criar(): Promise<{ repo: Repositorio; contas: Contas; pool?: import('pg').Pool }> }> = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria() }) },
  ...(temPostgres
    ? [{
        nome: 'postgres',
        criar: async () => {
          const pool = await poolDeTeste();
          return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), pool };
        },
      }]
    : []),
];

async function montar(amb: (typeof ambientes)[number], canais = { email: true, whatsapp: false }) {
  const { repo, contas, pool } = await amb.criar();
  const relogio = { t: bahia(2026, 11, 5, 14) };
  const enviados: Array<{ u: Usuario; link: string; validadeMin: number }> = [];
  const recuperacao: Recuperacao = {
    canais: async () => canais,
    enviar: async (u, link, validadeMin) => {
      enviados.push({ u, link, validadeMin });
      return ['e-mail'];
    },
  };
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora: () => relogio.t });
  const app = criarServidor({ sintonia, repo, agora: () => relogio.t, auth: { contas, agora: () => relogio.t, recuperacao } });
  const sufixo = Math.random().toString(36).slice(2, 8);
  const email = `lia.${sufixo}@imperio.com`;
  const lia = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Lia Souza', email, papel: 'atendente', unidades: ['norte'], senhaHash: await gerarHash(SENHA) });
  let ip = 0;
  const pedir = (e: string, remoteAddress = `10.0.${sufixo.length}.${++ip}`) =>
    app.inject({ method: 'POST', url: '/api/auth/esqueci', payload: { email: e }, remoteAddress });
  const esperarEnvio = async (n: number) => {
    for (let i = 0; i < 100 && enviados.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    return enviados[n - 1];
  };
  const tokenDe = (link: string) => new URL(link).searchParams.get('t')!;
  const entrar = (senha: string) => app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha }, remoteAddress: `10.9.${++ip}.1` });
  return { app, contas, pool, relogio, enviados, lia, email, pedir, esperarEnvio, tokenDe, entrar };
}

describe.each(ambientes)('esqueci minha senha ($nome)', (amb) => {
  it('token válido: troca a senha, encerra as outras sessões e não pode ser reusado', async () => {
    const m = await montar(amb);
    const antes = await m.entrar(SENHA);
    const cookieAntigo = String(antes.headers['set-cookie']).split(';')[0]!;
    expect((await m.app.inject({ method: 'GET', url: '/api/auth/eu', headers: { cookie: cookieAntigo } })).statusCode).toBe(200);

    const r = await m.pedir(m.email.toUpperCase());
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toBe(RESPOSTA_ESQUECI);
    const envio = await m.esperarEnvio(1);
    expect(envio?.u.id).toBe(m.lia.id);
    expect(envio?.validadeMin).toBe(60);
    expect(envio?.link).toMatch(/\/nova-senha\?t=/);
    const t = m.tokenDe(envio!.link);
    expect(t.length).toBeGreaterThanOrEqual(32);

    // só o hash do token fica guardado
    if (m.pool) {
      const { rows } = await m.pool.query('select token_hash, tipo, expira_em from sintonia.acesso_convites where usuario_id = $1', [m.lia.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(resumoToken(t));
      expect(rows[0].token_hash).not.toBe(t);
      expect(rows[0].tipo).toBe('redefinir');
    }

    const ver = await m.app.inject({ method: 'GET', url: `/api/auth/convite?t=${encodeURIComponent(t)}` });
    expect(ver.statusCode).toBe(200);
    expect(ver.json()).toMatchObject({ tipo: 'redefinir', email: m.email });

    const troca = await m.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t, senha: NOVA } });
    expect(troca.statusCode).toBe(200);
    // sessão antiga encerrada; senha antiga não vale; a nova vale
    expect((await m.app.inject({ method: 'GET', url: '/api/auth/eu', headers: { cookie: cookieAntigo } })).statusCode).toBe(401);
    expect((await m.entrar(SENHA)).statusCode).toBe(401);
    expect((await m.entrar(NOVA)).statusCode).toBe(200);

    // reuso do mesmo link
    expect((await m.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t, senha: 'OutraSenha2026' } })).statusCode).toBe(404);
    expect((await m.app.inject({ method: 'GET', url: `/api/auth/convite?t=${encodeURIComponent(t)}` })).statusCode).toBe(404);
  });

  it('token expirado depois de 1 hora', async () => {
    const m = await montar(amb);
    await m.pedir(m.email);
    const t = m.tokenDe((await m.esperarEnvio(1))!.link);
    m.relogio.t = new Date(m.relogio.t.getTime() + 59 * 60_000);
    expect((await m.app.inject({ method: 'GET', url: `/api/auth/convite?t=${encodeURIComponent(t)}` })).statusCode).toBe(200);
    m.relogio.t = new Date(m.relogio.t.getTime() + 2 * 60_000);
    expect((await m.app.inject({ method: 'GET', url: `/api/auth/convite?t=${encodeURIComponent(t)}` })).statusCode).toBe(404);
    expect((await m.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t, senha: NOVA } })).statusCode).toBe(404);
    expect((await m.entrar(SENHA)).statusCode).toBe(200);
  });

  it('conta inexistente ou desativada: mesma resposta e nada é enviado', async () => {
    const m = await montar(amb);
    const existe = await m.pedir(m.email);
    const naoExiste = await m.pedir(`ninguem.${Date.now()}@imperio.com`);
    expect(naoExiste.statusCode).toBe(existe.statusCode);
    expect(naoExiste.json()).toEqual(existe.json());
    await m.esperarEnvio(1);
    await m.contas.atualizarUsuario(m.lia.id, { ativo: false });
    const desativada = await m.pedir(m.email);
    expect(desativada.json()).toEqual(existe.json());
    await new Promise((r) => setTimeout(r, 60));
    expect(m.enviados).toHaveLength(1);
  });

  it('token inventado ou mal formado não passa', async () => {
    const m = await montar(amb);
    expect((await m.app.inject({ method: 'GET', url: '/api/auth/convite?t=abcdefghijklmnopqrstuvwxyz0123456789' })).statusCode).toBe(404);
    expect((await m.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t: 'abcdefghijklmnopqrstuvwxyz0123456789', senha: NOVA } })).statusCode).toBe(404);
    expect((await m.app.inject({ method: 'POST', url: '/api/auth/esqueci', payload: { email: 'não é e-mail' } })).statusCode).toBe(400);
  });

  it('limite de pedidos por e-mail e por IP', async () => {
    const m = await montar(amb);
    for (let i = 0; i < 3; i++) expect((await m.pedir(m.email)).statusCode).toBe(200);
    expect((await m.pedir(m.email)).statusCode).toBe(429);
    const ip = '10.77.0.1';
    for (let i = 0; i < 5; i++) expect((await m.pedir(`x${i}.${Date.now()}@imperio.com`, ip)).statusCode).toBe(200);
    const bloqueado = await m.pedir(`y.${Date.now()}@imperio.com`, ip);
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.json().erro).toMatch(/Muitos pedidos/);
    // passada a hora, libera de novo
    m.relogio.t = new Date(m.relogio.t.getTime() + 61 * 60_000);
    expect((await m.pedir(m.email, ip)).statusCode).toBe(200);
  });

  it('sem e-mail nem WhatsApp configurados: avisa que não há envio', async () => {
    const m = await montar(amb, { email: false, whatsapp: false });
    expect((await m.app.inject({ method: 'GET', url: '/api/auth/esqueci/canais' })).json()).toEqual({ email: false, whatsapp: false, disponivel: false });
    const r = await m.pedir(m.email);
    expect(r.json()).toMatchObject({ ok: true, semEnvio: true });
    await new Promise((x) => setTimeout(x, 40));
    expect(m.enviados).toHaveLength(0);
  });
});

describe('e-mail de redefinição', () => {
  it('monta o texto com o link e escapa o nome', async () => {
    const m = emailRedefinicao('Ana <b>Lima</b>', 'https://app.exemplo.com/nova-senha?t=abc', 60);
    expect(m.texto).toContain('https://app.exemplo.com/nova-senha?t=abc');
    expect(m.texto).toContain('1 hora');
    expect(m.html).not.toContain('<b>Lima');
    const enviados: unknown[] = [];
    const r = recuperacaoPorEmail({ temContaAtiva: async () => true, enviarSistema: async (x) => (enviados.push(x), true) });
    expect(await r.canais()).toEqual({ email: true, whatsapp: false });
    expect(await r.enviar({ id: '1', empresaId: 'e', nome: 'Ana', email: 'ana@x.com', papel: 'atendente', unidades: [], ativo: true }, 'https://x/nova-senha?t=1', 60)).toEqual(['e-mail']);
    const falha = recuperacaoPorEmail({ temContaAtiva: async () => true, enviarSistema: async () => { throw new Error('smtp fora'); } });
    expect(await falha.enviar({ id: '1', empresaId: 'e', nome: 'Ana', email: 'ana@x.com', papel: 'atendente', unidades: [], ativo: true }, 'l', 60)).toEqual([]);
  });
});

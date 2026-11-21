import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { AgenteFalso, ambientes, montarFunis, quinta } from './funis-ambiente.js';
import { analisarPerdas } from '../src/perdas/calculo.js';
import { normalizarConfigPerdas } from '../src/perdas/tipos.js';
import { LIMITES_LOGIN, LimiteLogin, mensagemBloqueio } from '../src/auth/limite-login.js';
import { registrarAuth } from '../src/auth/rotas.js';
import { ContasMemoria, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { FonteSaudeMemoria, FonteSaudePostgres, limparErro, PainelSaude } from '../src/saude/painel.js';
import { registrarSaude } from '../src/saude/rotas.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

type Coluna = { etapa: { id: string; nome: string; chaveSistema: string | null }; cartoes: Array<{ conversaId: string; perda?: { motivo: string; nome: string; detalhe: string | null; automatico: boolean } }> };

// ====================================================================== motivo de perda
describe.each(ambientes)('Motivo de perda obrigatório ($nome)', (amb) => {
  it('mover para "Perdida" sem motivo dá 409 com a lista; com motivo move, grava e aparece no cartão', async () => {
    const { como, gente, conversa, repo, sistema, etapasSistema } = await montarFunis(amb, { perdas: true });
    const c = await conversa('norte', 'Marina');
    const url = `/api/conversas/${c.id}/funis/${sistema.id}`;
    const sem = await como(gente.carla, 'POST', url, { etapaId: etapasSistema.get('perdida') });
    expect(sem.statusCode).toBe(409);
    const j = sem.json();
    expect(j).toMatchObject({ codigo: 'motivo_perda', etapa: 'Perdida', cliente: 'Marina' });
    expect(j.motivos.map((m: { id: string }) => m.id)).toEqual(['preco', 'sem_horario', 'sumiu', 'concorrente', 'desistiu', 'outro']);
    expect((await repo.buscarConversa(c.id))!.etapa).not.toBe('perdida');

    // "Outro" sem texto: 400; motivo que não existe: 400.
    expect((await como(gente.carla, 'POST', url, { etapaId: etapasSistema.get('perdida'), perda: { motivo: 'outro' } })).statusCode).toBe(400);
    expect((await como(gente.carla, 'POST', url, { etapaId: etapasSistema.get('perdida'), perda: { motivo: 'inventado' } })).statusCode).toBe(400);

    const ok = await como(gente.carla, 'POST', url, { etapaId: etapasSistema.get('perdida'), perda: { motivo: 'preco', detalhe: 'Achou caro a progressiva' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ mudou: true, etapa: 'perdida' });

    const q = (await como(gente.carla, 'GET', `/api/funis/${sistema.id}/quadro`)).json() as { colunas: Coluna[] };
    const col = q.colunas.find((x) => x.etapa.chaveSistema === 'perdida')!;
    expect(col.cartoes[0]).toMatchObject({ conversaId: c.id, perda: { motivo: 'preco', nome: 'Preço', detalhe: 'Achou caro a progressiva', automatico: false } });
    // Cartões fora da perda não ganham o selo.
    expect(q.colunas.filter((x) => x !== col).flatMap((x) => x.cartoes).every((x) => !x.perda)).toBe(true);

    // Já está em "Perdida": mandar de novo não pede motivo (nada muda).
    expect((await como(gente.carla, 'POST', url, { etapaId: etapasSistema.get('perdida') })).statusCode).toBe(200);
    // Ir para outra etapa (não é de perda) não pede nada.
    expect((await como(gente.carla, 'POST', url, { etapaId: etapasSistema.get('interessada') })).statusCode).toBe(200);
  });

  it('funil próprio: etapa "Perdido" também pede o motivo; relatório por motivo, etapa, atendente e origem (+ CSV)', async () => {
    const { como, gente, conversa, sistema, etapasSistema, relogio } = await montarFunis(amb, { perdas: true, inicio: quinta(10) });
    const f = (await como(gente.admin, 'POST', '/api/funis', { nome: 'Vendas', etapas: [{ nome: 'Contato' }, { nome: 'Proposta' }, { nome: 'Fechado' }, { nome: 'Perdido' }] })).json() as { id: string; etapas: Array<{ id: string; nome: string }> };
    const etapa = (n: string) => f.etapas.find((e) => e.nome === n)!.id;
    const ana = await conversa('norte', 'Ana');
    const bia = await conversa('norte', 'Bia');
    const cris = await conversa('norte', 'Cris');
    // A Carla assume a Ana (vira a responsável na hora da perda).
    await como(gente.carla, 'POST', `/api/conversas/${ana.id}/assumir`, {});
    for (const c of [ana, bia]) expect((await como(gente.admin, 'POST', `/api/conversas/${c.id}/funis/${f.id}`, { etapaId: etapa('Proposta') })).statusCode).toBe(200);
    expect((await como(gente.admin, 'POST', `/api/conversas/${ana.id}/funis/${f.id}`, { etapaId: etapa('Perdido') })).statusCode).toBe(409);
    expect((await como(gente.admin, 'POST', `/api/conversas/${ana.id}/funis/${f.id}`, { etapaId: etapa('Perdido'), perda: { motivo: 'concorrente' } })).statusCode).toBe(200);
    expect((await como(gente.admin, 'POST', `/api/conversas/${bia.id}/funis/${f.id}`, { etapaId: etapa('Perdido'), perda: { motivo: 'outro', detalhe: 'Mudou de cidade' } })).statusCode).toBe(200);
    expect((await como(gente.admin, 'POST', `/api/conversas/${cris.id}/funis/${sistema.id}`, { etapaId: etapasSistema.get('perdida'), perda: { motivo: 'concorrente' } })).statusCode).toBe(200);
    relogio.t = quinta(18);

    const r = (await como(gente.admin, 'GET', '/api/analises/perdas?periodo=hoje')).json();
    expect(r.totais).toMatchObject({ perdas: 3, manuais: 3, automaticas: 0, semMotivo: 0 });
    expect(r.motivos.map((m: { nome: string; total: number }) => [m.nome, m.total])).toEqual([['Foi para a concorrência', 2], ['Outro', 1]]);
    expect(r.etapas.map((m: { nome: string; total: number }) => [m.nome, m.total])).toEqual([['Proposta', 2], ['Entrada de leads', 1]]); // etapa-entrada: a Cris ainda não tinha resposta
    const carla = r.atendentes.find((a: { id: string }) => a.id === gente.carla.id);
    expect(carla).toMatchObject({ nome: 'Carla Lima', total: 1, principal: { nome: 'Foi para a concorrência' } });
    expect(r.origens[0]).toMatchObject({ nome: 'WhatsApp', total: 3 });
    expect(r.detalhes).toEqual([expect.objectContaining({ cliente: 'Bia', detalhe: 'Mudou de cidade' })]);

    const csv = await como(gente.admin, 'GET', '/api/analises/perdas/csv?periodo=hoje&tabela=lista');
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Mudou de cidade');
    expect(csv.body.split('\n').filter(Boolean)).toHaveLength(4);
    expect((await como(gente.admin, 'GET', '/api/analises/perdas/csv?periodo=hoje&tabela=motivos')).body).toContain('Foi para a concorrência');
    // Atendente não vê análises.
    expect((await como(gente.carla, 'GET', '/api/analises/perdas?periodo=hoje')).statusCode).toBe(403);
  });

  it('perdas automáticas (a IA classificou) entram com o motivo do sistema; a gestão muda a lista', async () => {
    const agente = new AgenteFalso(() => ({ texto: 'Tudo bem!', acoes: [{ tipo: 'etapa', etapa: 'perdida', motivo: 'disse que não quer' }], recusou: false }));
    const { como, gente, conversa, perdas, relogio } = await montarFunis(amb, { perdas: true, agente, inicio: quinta(10) });
    await conversa('norte', 'Duda', 'Não quero mais, obrigada');
    relogio.t = quinta(12);
    const lista = await perdas!.doPeriodo(quinta(0), quinta(23), {});
    expect(lista).toEqual([expect.objectContaining({ motivo: 'ia', motivoNome: 'A IA marcou como perdida', automatico: true, porNome: 'IA' })]);

    // Lista de motivos: atendente não muda; gestão muda (Outro sempre fica).
    expect((await como(gente.carla, 'PUT', '/api/perdas/motivos', { motivos: [{ id: 'preco', nome: 'Caro' }] })).statusCode).toBe(403);
    const nova = await como(gente.admin, 'PUT', '/api/perdas/motivos', { motivos: [{ id: 'preco', nome: 'Achou caro' }, { id: 'agenda', nome: 'Agenda cheia' }] });
    expect(nova.statusCode).toBe(200);
    expect(nova.json().motivos.map((m: { id: string }) => m.id)).toEqual(['preco', 'agenda', 'outro']);
    expect((await como(gente.carla, 'GET', '/api/perdas/motivos')).json()).toMatchObject({ podeEditar: false });
    expect((await como(gente.admin, 'PUT', '/api/perdas/motivos', { motivos: [{ id: 'ia', nome: 'Reservado' }] })).statusCode).toBe(400);
  });
});

describe('perdas: cálculo e lista', () => {
  it('normaliza a lista (Outro sempre ativo e pedindo texto) e agrupa', () => {
    expect(normalizarConfigPerdas(null).motivos).toHaveLength(6);
    const c = normalizarConfigPerdas({ motivos: [{ id: 'x', nome: 'X', ativo: true, pedeTexto: false }, { id: 'outro', nome: 'Outro', ativo: false, pedeTexto: false }] });
    expect(c.motivos.find((m) => m.id === 'outro')).toMatchObject({ ativo: true, pedeTexto: true });
    const base = { empresaId: 'e', funilId: 'f', etapaId: 'p', deEtapaId: 'd', detalhe: null, porId: null, porNome: 'Ana', unidade: 'norte', cliente: 'C' };
    const r = analisarPerdas({
      perdas: [
        { ...base, id: '1', conversaId: 'a', deEtapaNome: 'Proposta', motivo: 'preco', motivoNome: 'Preço', automatico: false, atendenteId: 'u1', atendenteNome: 'Ana', em: new Date(1) },
        { ...base, id: '2', conversaId: 'b', deEtapaNome: 'Proposta', motivo: 'preco', motivoNome: 'Preço', automatico: false, atendenteId: 'u1', atendenteNome: 'Ana', em: new Date(2) },
        { ...base, id: '3', conversaId: 'c', deEtapaNome: 'Contato', motivo: 'sumiu', motivoNome: 'Sumiu', automatico: true, atendenteId: null, atendenteNome: null, em: new Date(3) },
      ],
      origens: new Map([['a', 'Instagram']]),
      nomes: new Map([['u1', 'Ana Paula']]),
      leads: 10,
      anterior: 6,
    });
    expect(r.totais).toMatchObject({ perdas: 3, automaticas: 1, taxaPct: 30, variacaoPct: -50 });
    expect(r.motivos[0]).toMatchObject({ nome: 'Preço', total: 2, pct: 66.7 });
    expect(r.atendentes.map((a) => [a.nome, a.total])).toEqual([['Ana Paula', 2], ['Sem responsável', 1]]);
    expect(r.origens.map((a) => a.nome)).toEqual(['WhatsApp', 'Instagram']);
    expect(r.lista[0]!.conversaId).toBe('c');
  });
});

// ====================================================================== saúde
describe('Painel de saúde', () => {
  it('junta filas, tempo até aparecer, IA pausada, WhatsApp e processo; avisa o que está errado sem segredos', async () => {
    const repo = new RepositorioMemoria();
    const agora = new Date('2026-11-21T12:00:00Z');
    await repo.registrarEvento({ tipo: 'falha', conversaId: null as never, em: new Date(agora.getTime() - 10 * 60_000), dados: { etapa: 'processar', erro: 'AuthenticationError 401 x-api-key sk-ant-api03-abcdefghijklmnop invalid' } });
    const fonte = new FonteSaudeMemoria(repo);
    for (const ms of [100, 120, 150, 200, 3_500, 4_000]) fonte.medir(ms, agora.getTime() - 30 * 60_000);
    const painel = new PainelSaude({
      fonte,
      agora: () => agora,
      filaEntrada: async () => ({ pendentes: 3, processando: 1, falhas: 2 }),
      filaIa: () => ({ esperando: 0, pensando: 2, feitas: 40 }),
      iaPausadaAte: () => new Date(agora.getTime() + 10 * 60_000),
      iaLigada: () => true,
      whatsapp: () => ({ servidor: { ok: true, desde: agora.toISOString(), erro: null }, canais: [{ id: 'n', nome: 'Norte', estado: 'desconectado', desde: agora.toISOString(), motivo: 'token=abc123456789', precisaParear: true, reconectando: false, ultimaMensagemEm: null }] }),
    });
    const r = await painel.montar();
    painel.parar();
    expect(r.nivel).toBe('problema');
    expect(r.fila.entrada).toEqual({ pendentes: 3, processando: 1, falhas: 2 });
    expect(r.aparecer).toMatchObject({ total: 6, maxMs: 4000 });
    expect(r.aparecer!.p95Ms).toBeGreaterThan(2000);
    expect(r.ia).toMatchObject({ pausada: true, falhas: { ultimaHora: 1, ultimas24h: 1 } });
    const textos = r.alertas.map((a) => a.texto).join(' | ');
    expect(textos).toContain('A IA está pausada');
    expect(textos).toContain('Norte saiu do WhatsApp');
    expect(textos).toContain('demorando para aparecer');
    expect(textos).toContain('2 mensagens não entraram');
    const json = JSON.stringify(r);
    expect(json).not.toContain('sk-ant');
    expect(json).not.toContain('abc123456789');
    expect(r.processo.memoria.rss).toBeGreaterThan(0);
    expect(r.processo.noArSeg).toBeGreaterThanOrEqual(0);
  });

  it('tudo bem = "ok"; a rota é só da gestão', async () => {
    const painel = new PainelSaude({ fonte: new FonteSaudeMemoria(new RepositorioMemoria()), filaEntrada: async () => ({ pendentes: 0, processando: 0, falhas: 0 }), iaLigada: () => true });
    const app = Fastify();
    let usuario: Partial<Usuario> | undefined = { papel: 'atendente' };
    app.addHook('onRequest', async (req) => { (req as { usuario?: unknown }).usuario = usuario; });
    registrarSaude(app, { painel });
    expect((await app.inject({ url: '/api/saude/painel' })).statusCode).toBe(403);
    usuario = { papel: 'gerente' };
    const r = await app.inject({ url: '/api/saude/painel' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toMatchObject({ nivel: 'ok', alertas: [] });
    painel.parar();
  });

  it('limparErro apaga chaves, tokens e senhas', () => {
    expect(limparErro('falhou com Bearer abc.def e sk-ant-api03-XYZXYZXYZ')).toBe('falhou com Bearer [oculto] e [chave]');
    expect(limparErro('postgres://sintonia:segredo@db:5432/x caiu')).toBe('postgres://[oculto]@db:5432/x caiu');
  });

  it.runIf(temPostgres)('Postgres: p50/p95 da entrada, falhas de mídia e o banco', async () => {
    const pool = await poolDeTeste();
    const agora = new Date();
    for (let i = 0; i < 20; i++) {
      await pool.query(
        `insert into sintonia.entrada (canal, id_externo, conversa_chave, mensagem, status, criada_em, feita_em) values ('evolution', $1, 'k', '{}', 'feita', $2, $3)`,
        [`x${i}`, new Date(agora.getTime() - 60_000), new Date(agora.getTime() - 60_000 + (i < 19 ? 100 : 5000))],
      );
    }
    const fonte = new FonteSaudePostgres(pool);
    const t = await fonte.tempos(new Date(agora.getTime() - 3 * 3_600_000));
    expect(t.total).toBe(20);
    expect(t.p50Ms).toBe(100);
    expect(t.maxMs).toBe(5000);
    expect(t.porHora.reduce((a, h) => a + h.total, 0)).toBe(20);
    expect(await fonte.midias(agora)).toEqual({ pendentes: 0, tentando: 0, falhas24h: 0 });
    const b = await fonte.banco();
    expect(b).toMatchObject({ ok: true, erro: null });
    expect(b.tamanhoBytes).toBeGreaterThan(0);
    expect((await fonte.falhasIa(agora)).ultimas24h).toBe(0);
  });
});

// ====================================================================== login
describe('Limite de login por conta e por endereço', () => {
  const MIN = 60_000;
  it('por endereço: muitos e-mails diferentes do mesmo lugar param; por conta: de vários endereços, com espera crescente', () => {
    const avisos: Array<{ email: string; nivel: number }> = [];
    const l = new LimiteLogin({ aoBloquearConta: (b) => avisos.push({ email: b.email, nivel: b.nivel }) });
    let t = 1_000_000;
    for (let i = 0; i < LIMITES_LOGIN.endereco.erros; i++) l.errou('1.1.1.1', `pessoa${i}@x.com`, t);
    expect(l.bloqueio('1.1.1.1', 'outra@x.com', t)?.motivo).toBe('endereco');
    expect(l.bloqueio('2.2.2.2', 'outra@x.com', t)).toBeNull();

    // Conta: 8 erros de 8 endereços diferentes bloqueiam a conta por 5 min, até com a senha certa.
    for (let i = 0; i < LIMITES_LOGIN.conta.erros; i++) l.errou(`9.9.9.${i}`, 'Carla@x.com', t);
    const b1 = l.bloqueio('5.5.5.5', 'carla@x.com', t)!;
    expect(b1.motivo).toBe('conta');
    expect(b1.ate - t).toBe(5 * MIN);
    expect(avisos).toEqual([{ email: 'carla@x.com', nivel: 1 }]);
    expect(mensagemBloqueio(b1, t)).toContain('5 minutos');
    // Depois da espera, mais 8 erros: 15 min; depois 1 h.
    t += 6 * MIN;
    for (let i = 0; i < LIMITES_LOGIN.conta.erros; i++) l.errou(`8.8.8.${i}`, 'carla@x.com', t);
    expect(l.bloqueio('5.5.5.5', 'carla@x.com', t)!.ate - t).toBe(15 * MIN);
    t += 16 * MIN;
    for (let i = 0; i < LIMITES_LOGIN.conta.erros; i++) l.errou(`7.7.7.${i}`, 'carla@x.com', t);
    expect(l.bloqueio('5.5.5.5', 'carla@x.com', t)!.ate - t).toBe(60 * MIN);
    expect(mensagemBloqueio(l.bloqueio('5.5.5.5', 'carla@x.com', t)!, t)).toContain('1 hora');
    // "Esqueci minha senha" libera na hora.
    l.liberarConta('carla@x.com');
    expect(l.bloqueio('5.5.5.5', 'carla@x.com', t)).toBeNull();
  });

  it('na rota: avisa quantas tentativas faltam, bloqueia a conta, avisa a dona e libera com senha nova', async () => {
    const contas = new ContasMemoria();
    const carla = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await gerarHash('Imperio2026xyz') });
    const avisadas: string[] = [];
    let t = new Date('2026-11-21T12:00:00Z');
    const app = Fastify();
    let ip = 0;
    // Cada tentativa de um endereço diferente (o limite por endereço+e-mail não entra em jogo).
    app.addHook('onRequest', async (req) => { Object.defineProperty(req, 'ip', { value: `10.0.0.${++ip}` }); });
    registrarAuth(app, { contas, agora: () => t, avisarBloqueio: async (u) => { avisadas.push(u.id); } });
    const entrar = (senha: string) => app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha } });
    const respostas = [];
    for (let i = 0; i < LIMITES_LOGIN.conta.erros; i++) respostas.push(await entrar('errada'));
    expect(respostas[0]!.statusCode).toBe(401);
    expect(respostas[0]!.json().erro).toBe('E-mail ou senha incorretos.');
    expect(respostas[LIMITES_LOGIN.conta.erros - 2]!.json().erro).toContain('Mais 1 tentativa errada');
    const ultima = respostas.at(-1)!.json();
    expect(ultima).toMatchObject({ bloqueio: 'conta', restantes: 0 });
    expect(ultima.erro).toContain('bloqueada por 5 minutos');
    await new Promise((r) => setTimeout(r, 10));
    expect(avisadas).toEqual([carla.id]);
    // Senha certa durante o bloqueio: 429 honesto, com a espera.
    const certa = await entrar('Imperio2026xyz');
    expect(certa.statusCode).toBe(429);
    expect(certa.json()).toMatchObject({ bloqueio: 'conta' });
    expect(certa.json().esperaSeg).toBeGreaterThan(200);
    expect(certa.headers['retry-after']).toBeDefined();
    // Passou a espera: entra.
    t = new Date(t.getTime() + 6 * MIN);
    expect((await entrar('Imperio2026xyz')).statusCode).toBe(200);
    // E-mail que não existe conta igual (não revela quem tem conta).
    const fantasma = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'ninguem@imperio.com', senha: 'x' } });
    expect(fantasma.json().restantes).toBe(LIMITES_LOGIN.par.erros - 1);
  });
});

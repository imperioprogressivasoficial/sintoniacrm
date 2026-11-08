import { problemasDaSituacao } from '../src/notificacoes/rotas.js';
import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas, type Papel, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemNotificacoesMemoria, ArmazemNotificacoesPostgres, type ArmazemNotificacoes } from '../src/notificacoes/armazem.js';
import { classificarFalha, Notificador, observarEventos } from '../src/notificacoes/notificador.js';
import { ChavesPush, type EnviadorPush } from '../src/notificacoes/push.js';
import { emNaoPerturbe, PREFERENCIAS_PADRAO } from '../src/notificacoes/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);
const MIN = 60_000;

interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; contas: Contas; armazem: ArmazemNotificacoes }>;
}
const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria(), armazem: new ArmazemNotificacoesMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), armazem: new ArmazemNotificacoesPostgres(pool) };
          },
        },
      ]
    : []),
];

async function montar(amb: Ambiente) {
  const { repo, contas, armazem } = await amb.criar();
  const relogio = { t: bahia(2026, 11, 5, 14) }; // quinta, 14h: loja aberta
  const canal: CanalWhatsApp = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: `out-${Math.random()}` }) };
  const pushes: Array<{ endpoint: string; carga: Record<string, unknown> }> = [];
  const falso = { status: 0 };
  const enviador: EnviadorPush = {
    async enviar(i, carga) {
      if (falso.status) throw Object.assign(new Error('recusado'), { statusCode: falso.status });
      pushes.push({ endpoint: i.endpoint, carga: JSON.parse(carga) });
    },
  };
  const chaves = new ChavesPush(armazem, new Cofre('teste'));
  const notificador = new Notificador({ armazem, contas, repo, empresaId: 'imperio', agora: () => relogio.t, push: { chaves, enviador, assunto: 'mailto:teste@example.com' } });
  observarEventos(repo, (e) => notificador.aoEvento(e));
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
  const app = criarServidor({ sintonia, repo, agora: () => relogio.t, auth: { contas, agora: () => relogio.t }, notificacoes: { notificador, armazem, chaves } });

  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    gerente: await pessoa('Gil Norte', 'gerente', ['norte']),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
    bia: await pessoa('Bia Souza', 'atendente', ['norte']),
    rita: await pessoa('Rita Recepção', 'recepcionista', ['sumare']),
  };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 24 * 3600_000))}`));
    return app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  let seq = 0;
  const cliente = async (unidade: 'norte' | 'sumare', telefone: string, texto: string, nome = 'Marina') => {
    relogio.t = new Date(relogio.t.getTime() + 1000); // mensagens em segundos diferentes, como na vida real
    await sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome, texto, deMim: false, idExterno: `in-${++seq}`, em: relogio.t });
    await notificador.ocioso();
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const de = async (u: Usuario) => armazem.listar(u.id, relogio.t, 100);
  return { app, repo, armazem, notificador, sintonia, relogio, gente, como, cliente, de, pushes, falso };
}

describe('Regras puras', () => {
  it('não perturbe atravessa a meia-noite (horário da Bahia) e falhas são classificadas', () => {
    const p = { ...PREFERENCIAS_PADRAO, naoPerturbe: { ligado: true, inicio: '22:00', fim: '07:00' } };
    expect(emNaoPerturbe(p, bahia(2026, 11, 5, 23))).toBe(true);
    expect(emNaoPerturbe(p, bahia(2026, 11, 5, 6, 59))).toBe(true);
    expect(emNaoPerturbe(p, bahia(2026, 11, 5, 7))).toBe(false);
    expect(emNaoPerturbe({ ...p, naoPerturbe: { ...p.naoPerturbe, ligado: false } }, bahia(2026, 11, 5, 23))).toBe(false);
    expect(classificarFalha('AuthenticationError: 401 {"type":"authentication_error","message":"invalid x-api-key"}')?.classe).toBe('ia');
    expect(classificarFalha('Error: Evolution recusou o envio (500): Connection Closed')?.classe).toBe('whatsapp');
    expect(classificarFalha('requer modelo aprovado pela Meta')).toBeUndefined();
  });
});

describe('Problemas que impedem o trabalho', () => {
  it('um item por problema, só enquanto existe', () => {
    expect(problemasDaSituacao({ iaLigada: true, numerosReais: 2 })).toEqual([]);
    const p = problemasDaSituacao({ iaLigada: false, numerosReais: 0, agenda: { unidades: [{ nome: 'Sumaré', sistema: 'trinks', pronta: false, falta: ['Chave da API do Trinks'] }, { nome: 'Norte', sistema: 'nenhum', pronta: false, falta: ['x'] }] } });
    expect(p.map((x) => x.chave)).toEqual(['whatsapp', 'ia', 'agenda:Sumaré']);
  });
});

describe.each(ambientes)('Notificações ($nome)', (amb) => {
  it('cliente nova e cada mensagem não viram notificação (a lista de conversas já mostra)', async () => {
    const { gente, cliente, de } = await montar(amb);
    await cliente('norte', '5571988000001', 'Oi, quanto custa a progressiva?');
    await cliente('norte', '5571988000001', 'Tem horário amanhã?');
    for (const u of [gente.carla, gente.bia, gente.rita, gente.gerente, gente.admin]) expect(await de(u)).toHaveLength(0);
  });

  it('clientes esperando contam como um item só no sino; tipos antigos não aparecem nem contam', async () => {
    const { gente, cliente, notificador, armazem, relogio, como } = await montar(amb);
    await cliente('norte', '5571988000011', 'Oi', 'Ana');
    await cliente('norte', '5571988000012', 'Oi', 'Rosana');
    await cliente('norte', '5571988000013', 'Oi', 'Bia');
    relogio.t = new Date(relogio.t.getTime() + 8 * MIN);
    await notificador.tick();
    const esperas = (await armazem.listar(gente.carla.id, relogio.t, 50)).filter((n) => n.tipo === 'espera');
    expect(esperas).toHaveLength(3);
    // Uma notificação antiga de "nova cliente" (de antes da mudança) fica escondida e não conta.
    await armazem.criar({ usuarioId: gente.carla.id, tipo: 'nova_cliente', titulo: 'Nova cliente: Velha', texto: 'x', criadaEm: relogio.t });
    const j = (await como(gente.carla, 'GET', '/api/notificacoes')).json();
    expect(j.itens.map((n: { tipo: string }) => n.tipo)).toEqual(['espera', 'espera', 'espera']);
    expect(j.naoLidas).toBe(1); // três esperando = um item no sino
  });

  it('troca de dona avisa quem recebeu; "quer remarcar" vai para dona e gestão; "agendou" não avisa', async () => {
    const { gente, cliente, de, sintonia, armazem, repo, notificador, relogio } = await montar(amb);
    const c = await cliente('norte', '5571988000002', 'Oi');
    await armazem.marcarTodas(gente.carla.id, relogio.t);
    await armazem.marcarTodas(gente.bia.id, relogio.t);
    relogio.t = new Date(relogio.t.getTime() + MIN);
    await sintonia.definirResponsavel(c.id, { id: gente.carla.id, nome: gente.carla.nome }, { id: gente.gerente.id, nome: gente.gerente.nome }, 'transferiu');
    await notificador.ocioso();
    const t = (await de(gente.carla))[0]!;
    expect(t).toMatchObject({ tipo: 'transferida', titulo: 'Conversa passada para você' });
    expect(t.texto).toContain('Gil Norte');
    expect((await de(gente.bia)).filter((n) => !n.lidaEm)).toHaveLength(0);

    relogio.t = new Date(relogio.t.getTime() + MIN);
    await cliente('norte', '5571988000002', 'Oi de novo');
    expect((await de(gente.carla)).filter((n) => n.tipo === 'mensagem')).toHaveLength(0); // mensagem não vira notificação

    // Assumir a própria conversa não notifica ninguém.
    await sintonia.definirResponsavel(c.id, null, { nome: 'Gil' }, 'liberou');
    await sintonia.definirResponsavel(c.id, { id: gente.bia.id, nome: gente.bia.nome }, { id: gente.bia.id, nome: gente.bia.nome }, 'assumiu');
    await notificador.ocioso();
    expect((await de(gente.bia)).filter((n) => n.tipo === 'transferida')).toHaveLength(0);

    // "Agendou" não avisa mais (aparece na Agenda); "quer remarcar" avisa a dona e a gestão.
    await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: c.id, unidade: 'norte', em: relogio.t, dados: { servico: 'Progressiva', inicio: '2026-11-08T13:00:00Z', atendente: 'Gil Norte', atendenteId: gente.gerente.id } });
    await repo.registrarEvento({ tipo: 'agendamento_ia', conversaId: c.id, unidade: 'norte', em: relogio.t, dados: { servico: 'Progressiva', inicio: '2026-11-08T13:00:00Z' } });
    await notificador.ocioso();
    for (const u of [gente.bia, gente.admin, gente.gerente, gente.carla]) expect((await de(u)).filter((n) => n.tipo === 'agendamento')).toHaveLength(0);
    await repo.registrarEvento({ tipo: 'confirmacao', conversaId: c.id, unidade: 'norte', em: relogio.t, dados: { status: 'remarcar', servico: 'Progressiva', data: '08/11', hora: '10:00' } });
    await notificador.ocioso();
    const ag = (u: Usuario) => de(u).then((l) => l.filter((n) => n.tipo === 'agenda_mudou'));
    expect(await ag(gente.bia)).toHaveLength(1); // dona
    expect((await ag(gente.bia))[0]).toMatchObject({ titulo: 'Marina quer remarcar' });
    expect(await ag(gente.admin)).toHaveLength(1); // gestão
    expect(await ag(gente.carla)).toHaveLength(0);
    expect(await ag(gente.rita)).toHaveLength(0); // outra unidade
  });

  it('sem dona e com a IA respondendo sozinha, mensagem nova não incomoda; IA passa para a equipe avisa', async () => {
    const { gente, cliente, de, sintonia, armazem, repo, notificador, relogio } = await montar(amb);
    const c = await cliente('norte', '5571988000003', 'Oi');
    await armazem.marcarTodas(gente.carla.id, relogio.t);
    await sintonia.mudarModo(c.id, 'ia');
    await cliente('norte', '5571988000003', 'Alô?');
    expect((await de(gente.carla)).filter((n) => !n.lidaEm)).toHaveLength(0);
    await repo.registrarEvento({ tipo: 'passou_para_humano', conversaId: c.id, unidade: 'norte', em: relogio.t, dados: { motivo: 'quer falar com uma pessoa' } });
    await notificador.ocioso();
    const l = (await de(gente.carla)).filter((n) => !n.lidaEm);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ tipo: 'ia_equipe', texto: 'Motivo: quer falar com uma pessoa' });
  });

  it('falha importante só para a administração, no máximo uma por hora', async () => {
    const { gente, de, repo, notificador, relogio } = await montar(amb);
    const falha = (erro: string) => repo.registrarEvento({ tipo: 'falha', em: relogio.t, dados: { erro } });
    await falha('AuthenticationError: 401 invalid x-api-key');
    await falha('AuthenticationError: 401 invalid x-api-key');
    await falha('Erro qualquer sem importância');
    await notificador.ocioso();
    expect(await de(gente.admin)).toHaveLength(1);
    expect((await de(gente.admin))[0]).toMatchObject({ tipo: 'falha', vista: 'conexoes', titulo: 'A chave da IA foi recusada' });
    for (const u of [gente.carla, gente.gerente]) expect(await de(u)).toHaveLength(0);
    relogio.t = new Date(relogio.t.getTime() + 61 * MIN);
    await falha('AuthenticationError: 401 invalid x-api-key');
    await notificador.ocioso();
    expect(await de(gente.admin)).toHaveLength(2);
  });

  it('lembrete de ligação aparece na hora marcada; cliente esperando avisa uma vez', async () => {
    const { gente, de, repo, notificador, relogio, cliente, sintonia, armazem } = await montar(amb);
    const c = await cliente('norte', '5571988000004', 'Oi');
    await sintonia.definirResponsavel(c.id, { id: gente.carla.id, nome: gente.carla.nome }, { id: gente.gerente.id, nome: 'Gil' }, 'transferiu');
    await sintonia.mudarModo(c.id, 'humano');
    await notificador.ocioso();
    await armazem.marcarTodas(gente.carla.id, relogio.t);
    const quando = new Date(relogio.t.getTime() + 30 * MIN);
    await repo.registrarEvento({ tipo: 'lembrete_ligacao', conversaId: c.id, unidade: 'norte', em: relogio.t, dados: { quando: quando.toISOString(), texto: 'Ligar para confirmar', automacaoId: 'a1' } });
    await notificador.ocioso();
    expect((await de(gente.carla)).filter((n) => n.tipo === 'lembrete_ligacao')).toHaveLength(0); // ainda não
    relogio.t = new Date(quando.getTime() + 1000);
    await notificador.tick();
    const lembretes = (await de(gente.carla)).filter((n) => n.tipo === 'lembrete_ligacao');
    expect(lembretes).toHaveLength(1);
    expect(lembretes[0]).toMatchObject({ titulo: 'Ligar para Marina', texto: 'Ligar para confirmar' });
    // A cliente mandou "Oi" há 30 min e ninguém respondeu (modo "Só eu"): espera.
    const espera = (await de(gente.carla)).filter((n) => n.tipo === 'espera');
    expect(espera).toHaveLength(1);
    relogio.t = new Date(relogio.t.getTime() + 2 * MIN);
    await notificador.tick();
    expect((await de(gente.carla)).filter((n) => n.tipo === 'espera')).toHaveLength(1);
    expect((await de(gente.bia)).filter((n) => n.tipo === 'espera')).toHaveLength(0); // tem dona
  });

  it('rotas: lista, marcar lida e todas, preferências, push e contador em /api/atualizacoes', async () => {
    const { gente, como, cliente, pushes, falso, armazem, relogio, repo, notificador } = await montar(amb);
    expect((await como(gente.carla, 'GET', '/api/push/chave')).json().chave).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const insc = { endpoint: 'https://push.exemplo.test/carla-1', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
    expect((await como(gente.carla, 'POST', '/api/push/inscrever', insc)).json()).toMatchObject({ ok: true, aparelhos: 1 });

    // A IA passa conversas para a equipe: é o que vira notificação (e push) para a unidade.
    const pediu = async (tel: string, nome: string, unidade: 'norte' | 'sumare' = 'norte') => {
      const c = await cliente(unidade, tel, 'Oi', nome);
      await repo.registrarEvento({ tipo: 'passou_para_humano', conversaId: c.id, unidade, em: relogio.t, dados: { motivo: 'quer falar com uma pessoa' } });
      await notificador.ocioso();
      return c;
    };
    await pediu('5571988000005', 'Joana');
    await pediu('5571988000006', 'Paula', 'sumare'); // outra unidade: Carla não recebe
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.carga).toMatchObject({ titulo: 'A IA passou Joana para a equipe' });

    // Preferências: sem "A IA passou para a equipe", nada chega.
    const pref = await como(gente.carla, 'PUT', '/api/notificacoes/preferencias', { tipos: { ia_equipe: false } });
    expect(pref.json().tipos).toMatchObject({ ia_equipe: false, espera: true });
    expect((await como(gente.carla, 'PUT', '/api/notificacoes/preferencias', { naoPerturbe: { ligado: true, inicio: '25:00', fim: '07:00' } })).statusCode).toBe(400);
    await pediu('5571988000007', 'Lara');
    expect((await armazem.listar(gente.carla.id, relogio.t, 50)).length).toBe(1);
    expect((await armazem.listar(gente.bia.id, relogio.t, 50)).length).toBe(2);

    // Não perturbe agora: a notificação fica no sino, mas o celular não toca.
    await como(gente.carla, 'PUT', '/api/notificacoes/preferencias', { tipos: { ia_equipe: true }, naoPerturbe: { ligado: true, inicio: '13:00', fim: '15:00' } });
    relogio.t = new Date(relogio.t.getTime() + MIN);
    await pediu('5571988000008', 'Nina');
    expect(pushes).toHaveLength(1);
    await como(gente.carla, 'PUT', '/api/notificacoes/preferencias', { naoPerturbe: { ligado: false, inicio: '22:00', fim: '07:00' } });

    // Lista e contador.
    const r = await como(gente.carla, 'GET', '/api/notificacoes?limite=1');
    const j = r.json();
    expect(j).toMatchObject({ naoLidas: 2, silencio: false });
    expect(j.itens).toHaveLength(1);
    expect(j.itens[0].titulo).toBe('A IA passou Nina para a equipe');
    expect(JSON.parse(String(r.headers['x-notificacoes']))).toMatchObject({ n: 2 });
    const r2 = (await como(gente.carla, 'GET', `/api/notificacoes?limite=5&antes=${j.proximo}`)).json();
    expect(r2.itens.map((n: { titulo: string }) => n.titulo)).toEqual(['A IA passou Joana para a equipe']);
    expect(r2.proximo).toBeNull();

    const at = await como(gente.carla, 'GET', '/api/atualizacoes');
    expect(Array.isArray(at.json())).toBe(true);
    expect(JSON.parse(String(at.headers['x-notificacoes']))).toMatchObject({ n: 2 });
    expect((await como(gente.carla, 'GET', '/api/atualizacoes?notificacoes=1')).json().notificacoes).toMatchObject({ naoLidas: 2 });
    expect(JSON.parse(String((await como(gente.carla, 'GET', '/api/conversas')).headers['x-notificacoes'])).n).toBe(2);

    expect((await como(gente.carla, 'POST', `/api/notificacoes/${j.itens[0].id}/lida`)).statusCode).toBe(200);
    expect((await como(gente.bia, 'POST', `/api/notificacoes/${j.itens[0].id}/lida`)).statusCode).toBe(404); // não é dela
    expect((await como(gente.carla, 'GET', '/api/notificacoes')).json().naoLidas).toBe(1);
    expect((await como(gente.carla, 'POST', '/api/notificacoes/lidas')).json().marcadas).toBe(1);
    expect((await como(gente.carla, 'GET', '/api/notificacoes')).json().naoLidas).toBe(0);

    // Abrir a conversa marca as notificações dela como lidas.
    const naoLidaBia = (await como(gente.bia, 'GET', '/api/notificacoes')).json();
    const alvo = naoLidaBia.itens.find((n: { titulo: string }) => n.titulo === 'A IA passou Lara para a equipe');
    await como(gente.bia, 'POST', `/api/conversas/${alvo.conversaId}/lida`);
    expect((await como(gente.bia, 'GET', '/api/notificacoes')).json().naoLidas).toBe(naoLidaBia.naoLidas - 1);

    // Inscrição que o serviço de push diz que não existe mais (410) é apagada.
    falso.status = 410;
    await como(gente.carla, 'POST', '/api/notificacoes/teste');
    expect(await armazem.inscricoes(gente.carla.id)).toHaveLength(0);
    // Sair do push.
    falso.status = 0;
    await como(gente.carla, 'POST', '/api/push/inscrever', insc);
    expect((await como(gente.carla, 'POST', '/api/push/sair', { endpoint: insc.endpoint })).json().ok).toBe(true);
    expect((await como(gente.bia, 'GET', '/api/notificacoes/preferencias')).json()).toMatchObject({ som: true, push: true, pushDisponivel: true, aparelhos: 0 });
  });

  it('chaves VAPID são geradas uma vez e a privada fica cifrada', async () => {
    const { armazem } = await amb.criar();
    let geradas = 0;
    const gerar = () => (geradas++, { publicKey: 'PUB' + geradas, privateKey: 'PRIV' + geradas });
    const a = await new ChavesPush(armazem, new Cofre('x'), gerar).obter();
    const b = await new ChavesPush(armazem, new Cofre('x'), gerar).obter();
    expect(a.publica).toBe(b.publica);
    expect(b.privada).toBe(a.privada);
    expect(await armazem.config('vapid')).not.toContain(a.privada);
  });
});

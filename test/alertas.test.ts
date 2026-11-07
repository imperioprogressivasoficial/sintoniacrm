import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, type Papel, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemNotificacoesMemoria } from '../src/notificacoes/armazem.js';
import { avaliarEspera, lojaAberta, REGRA_PADRAO } from '../src/notificacoes/espera.js';
import { Notificador, observarEventos } from '../src/notificacoes/notificador.js';
import { ChavesPush, type EnviadorPush } from '../src/notificacoes/push.js';
import { completarPreferencias } from '../src/notificacoes/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';

const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);
const MIN = 60_000;

async function montar(o: { automacaoAtiva?: (id: string) => Promise<boolean> } = {}) {
  const repo = new RepositorioMemoria();
  const contas = new ContasMemoria();
  const armazem = new ArmazemNotificacoesMemoria();
  const relogio = { t: bahia(2026, 11, 5, 14) }; // quinta, 14h: loja aberta
  const canal: CanalWhatsApp = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: `out-${Math.random()}` }) };
  const pushes: Array<{ endpoint: string; carga: Record<string, unknown> }> = [];
  const enviador: EnviadorPush = {
    async enviar(i, carga) {
      pushes.push({ endpoint: i.endpoint, carga: JSON.parse(carga) });
    },
  };
  const chaves = new ChavesPush(armazem, new Cofre('teste'));
  const notificador = new Notificador({ armazem, contas, repo, empresaId: 'imperio', agora: () => relogio.t, push: { chaves, enviador, assunto: 'mailto:teste@example.com' }, ...o });
  observarEventos(repo, (e) => notificador.aoEvento(e));
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: { executar: async () => ({ texto: 'Sugestão', acoes: [], recusou: false }) },
    agora: () => relogio.t,
  });
  const app = criarServidor({ sintonia, repo, agora: () => relogio.t, auth: { contas, agora: () => relogio.t }, notificacoes: { notificador, armazem, chaves, agora: () => relogio.t } });
  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    gerente: await pessoa('Gil Norte', 'gerente', ['norte']),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
    bia: await pessoa('Bia Souza', 'atendente', ['norte']),
  };
  for (const u of Object.values(gente)) await armazem.inscrever({ endpoint: `https://push.exemplo.test/${u.id}`, usuarioId: u.id, p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) });
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 24 * 3600_000))}`));
    return app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  let seq = 0;
  const cliente = async (telefone: string, texto: string, nome = 'Juliana') => {
    relogio.t = new Date(relogio.t.getTime() + 1000);
    await sintonia.receber({ canalId: 'imperio-norte', telefone, nome, texto, deMim: false, idExterno: `in-${++seq}`, em: relogio.t });
    await notificador.ocioso();
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  /** Conversa com dona (Carla) no modo "Só eu", com tudo lido e os pushes zerados. */
  const daCarla = async (telefone: string) => {
    const c = await cliente(telefone, 'Oi');
    await sintonia.definirResponsavel(c.id, { id: gente.carla.id, nome: gente.carla.nome }, { id: gente.gerente.id, nome: 'Gil' }, 'transferiu');
    await sintonia.mudarModo(c.id, 'humano');
    await notificador.ocioso();
    for (const u of Object.values(gente)) await armazem.marcarTodas(u.id, relogio.t);
    pushes.length = 0;
    return c;
  };
  const pushDe = (u: Usuario) => pushes.filter((p) => p.endpoint.endsWith(u.id)).map((p) => p.carga);
  const avancar = async (min: number) => {
    relogio.t = new Date(relogio.t.getTime() + min * MIN);
    await notificador.tick();
  };
  const esperasDe = async (u: Usuario) => (await armazem.listar(u.id, relogio.t, 100)).filter((n) => n.tipo === 'espera');
  return { app, repo, armazem, notificador, sintonia, relogio, gente, como, cliente, daCarla, pushes, pushDe, avancar, esperasDe };
}

describe('Regras de espera (puras)', () => {
  it('níveis por limite; sem alerta com IA, respondida ou fora do horário', () => {
    const agora = bahia(2026, 11, 5, 14);
    const c = { modo: 'humano' as const, unidade: 'norte' as const, ultimaMensagemCliente: new Date(agora.getTime() - 6 * MIN) };
    expect(avaliarEspera(c, REGRA_PADRAO, agora)).toMatchObject({ nivel: 1, minutos: 6 });
    expect(avaliarEspera({ ...c, ultimaMensagemCliente: new Date(agora.getTime() - 16 * MIN) }, REGRA_PADRAO, agora).nivel).toBe(2);
    expect(avaliarEspera({ ...c, ultimaMensagemCliente: new Date(agora.getTime() - 2 * MIN) }, REGRA_PADRAO, agora).nivel).toBe(0);
    expect(avaliarEspera({ ...c, modo: 'ia' }, REGRA_PADRAO, agora).nivel).toBe(0);
    expect(avaliarEspera({ ...c, ultimaMensagemEquipe: agora }, REGRA_PADRAO, agora).nivel).toBe(0);
    expect(avaliarEspera(c, REGRA_PADRAO, agora, true).nivel).toBe(0); // bot/follow-up conduzindo
    const noite = bahia(2026, 11, 5, 23);
    expect(lojaAberta(REGRA_PADRAO, 'norte', noite)).toBe(false);
    expect(avaliarEspera({ ...c, ultimaMensagemCliente: new Date(noite.getTime() - 20 * MIN) }, REGRA_PADRAO, noite).nivel).toBe(0);
    expect(lojaAberta({ ...REGRA_PADRAO, abre: '08:00', fecha: '23:30' }, 'norte', noite)).toBe(true);
    expect(lojaAberta({ ...REGRA_PADRAO, soNoHorario: false }, 'norte', noite)).toBe(true);
  });
});

describe('Push a cada mensagem', () => {
  it('cada mensagem nova toca de novo (mesma etiqueta da conversa), sem repetir a mesma, e respeita o não perturbe', async () => {
    const { gente, cliente, daCarla, pushDe, repo, notificador, armazem, relogio, esperasDe } = await montar();
    const c = await daCarla('5571988100001');
    await cliente('5571988100001', 'Quanto custa a progressiva?');
    await cliente('5571988100001', 'Tem horário amanhã de manhã?');
    await cliente('5571988100001', 'Pode ser às 10h');
    const p = pushDe(gente.carla);
    expect(p).toHaveLength(3);
    expect(p.every((x) => x.etiqueta === `conversa-${c.id}` && !x.silenciosa && x.titulo === 'Juliana' && x.vibrar === true)).toBe(true);
    expect(p[0]!.texto).toBe('Quanto custa a progressiva?');
    expect(p[2]!.texto).toContain('Pode ser às 10h');
    // No sino continua uma notificação só (agrupada).
    const sino = (await armazem.listar(gente.carla.id, relogio.t, 50)).filter((n) => !n.lidaEm);
    expect(sino).toHaveLength(1);
    expect(sino[0]!.contador).toBe(3);
    // Outra atendente da unidade não recebe (a conversa tem dona).
    expect(pushDe(gente.bia)).toHaveLength(0);

    // O mesmo evento repetido (mesma mensagem) não toca de novo.
    await repo.registrarEvento({ tipo: 'mensagem_cliente', conversaId: c.id, unidade: 'norte', em: relogio.t });
    await notificador.ocioso();
    expect(pushDe(gente.carla)).toHaveLength(3);

    // Não perturbe: nada no celular, mas o sino soma.
    await armazem.salvarPreferencias(gente.carla.id, completarPreferencias({ naoPerturbe: { ligado: true, inicio: '13:00', fim: '18:00' } }));
    await cliente('5571988100001', 'Alô?');
    expect(pushDe(gente.carla)).toHaveLength(3);
    expect((await armazem.listar(gente.carla.id, relogio.t, 50))[0]!.contador).toBe(4);

    // Push por mensagem desligado: volta ao aviso agrupado silencioso (no máximo um por minuto).
    await armazem.salvarPreferencias(gente.carla.id, completarPreferencias({ mensagens: { push: false, som: true, vibrar: true, tipoSom: 'gota', volume: 70 } }));
    relogio.t = new Date(relogio.t.getTime() + 2 * MIN);
    await cliente('5571988100001', 'Oi?');
    await cliente('5571988100001', 'Oi??');
    const ult = pushDe(gente.carla).slice(3);
    expect(ult).toHaveLength(1);
    expect(ult[0]!.silenciosa).toBe(true);
    void esperasDe;
  });

  it('sem dona e fora do modo IA, quem vê as conversas sem dona da unidade recebe cada mensagem', async () => {
    const { gente, cliente, sintonia, pushDe, notificador, pushes } = await montar();
    const c = await cliente('5571988100002', 'Oi');
    await sintonia.mudarModo(c.id, 'humano');
    await notificador.ocioso();
    pushes.length = 0;
    await cliente('5571988100002', 'Vocês abrem domingo?');
    await cliente('5571988100002', 'Que horas?');
    for (const u of [gente.carla, gente.bia]) expect(pushDe(u)).toHaveLength(2);
    expect(pushDe(gente.gerente)).toHaveLength(0);
  });
});

describe('Cliente esperando há muito tempo', () => {
  it('aviso e alerta forte uma vez por nível; o forte chega também na gestão; resposta zera', async () => {
    const { gente, daCarla, avancar, esperasDe, pushDe, como, sintonia, cliente } = await montar();
    const c = await daCarla('5571988200001');
    await avancar(4);
    expect(await esperasDe(gente.carla)).toHaveLength(0);
    await avancar(2); // 6 min: aviso
    expect(await esperasDe(gente.carla)).toHaveLength(1);
    expect(await esperasDe(gente.gerente)).toHaveLength(0);
    await avancar(2);
    expect(await esperasDe(gente.carla)).toHaveLength(1); // não repete o mesmo nível
    const faixa = (await como(gente.carla, 'GET', '/api/espera')).json();
    expect(faixa.itens).toHaveLength(1);
    expect(faixa.itens[0]).toMatchObject({ conversaId: c.id, nome: 'Juliana', nivel: 1, minutos: 8, repetirSeg: 45 });
    await avancar(8); // 16 min: forte
    const carla = await esperasDe(gente.carla);
    expect(carla).toHaveLength(2);
    expect(carla[0]!.titulo).toBe('Urgente: Juliana espera há 16 min');
    for (const u of [gente.gerente, gente.admin]) expect(await esperasDe(u)).toHaveLength(1);
    expect(await esperasDe(gente.bia)).toHaveLength(0);
    const forte = pushDe(gente.gerente).find((x) => String(x.etiqueta).startsWith('espera-'));
    expect(forte).toMatchObject({ etiqueta: `espera-${c.id}`, insistente: true });
    await avancar(5);
    expect(await esperasDe(gente.carla)).toHaveLength(2);
    expect((await como(gente.gerente, 'GET', '/api/espera')).json().itens[0]).toMatchObject({ nivel: 2 });
    expect((await como(gente.bia, 'GET', '/api/espera')).json().itens).toHaveLength(0); // não vê a conversa da Carla

    // Alguém respondeu: sai da faixa. Nova mensagem sem resposta começa a contar de novo.
    await sintonia.equipeEnviou(c.id, 'Oi Juliana, já vejo para você!', 'Carla Lima', gente.carla);
    expect((await como(gente.carla, 'GET', '/api/espera')).json().itens).toHaveLength(0);
    await cliente('5571988200001', 'Obrigada!');
    await avancar(6);
    expect(await esperasDe(gente.carla)).toHaveLength(3);
  });

  it('sem alerta com a IA atendendo, fora do horário da loja ou com bot/follow-up ativo', async () => {
    const ativo = new Set<string>();
    const { gente, daCarla, avancar, esperasDe, sintonia, relogio, cliente, como } = await montar({ automacaoAtiva: async (id) => ativo.has(id) });
    const ia = await daCarla('5571988300001');
    await sintonia.mudarModo(ia.id, 'ia');
    const bot = await cliente('5571988300002', 'Oi, quero agendar');
    await sintonia.mudarModo(bot.id, 'humano');
    ativo.add(bot.id);
    await avancar(20);
    for (const u of Object.values(gente)) expect(await esperasDe(u)).toHaveLength(0);
    expect((await como(gente.admin, 'GET', '/api/espera')).json().itens).toHaveLength(0);

    // Fora do horário (23h): a cliente escreve e ninguém é acordado.
    relogio.t = bahia(2026, 11, 5, 22, 30);
    const noite = await daCarla('5571988300003');
    await avancar(30);
    expect((await esperasDe(gente.carla)).filter((n) => n.conversaId === noite.id)).toHaveLength(0);
  });

  it('silenciar por X minutos: sem push nem alarme de espera até passar; regras por unidade só pela gestão', async () => {
    const { gente, daCarla, avancar, esperasDe, pushDe, como } = await montar();
    expect((await como(gente.carla, 'PUT', '/api/espera/regras/norte', { avisoMin: 2, forteMin: 4 })).statusCode).toBe(403);
    const r = await como(gente.gerente, 'PUT', '/api/espera/regras/norte', { avisoMin: 2, forteMin: 4, repetirSeg: 30 });
    expect(r.statusCode).toBe(200);
    expect(r.json().regra).toMatchObject({ avisoMin: 2, forteMin: 4, repetirSeg: 30 });
    expect((await como(gente.gerente, 'PUT', '/api/espera/regras/norte', { avisoMin: 9, forteMin: 4 })).statusCode).toBe(400);
    expect((await como(gente.gerente, 'PUT', '/api/espera/regras/sumare', { avisoMin: 2 })).statusCode).toBe(403); // não é a unidade dele
    expect((await como(gente.carla, 'GET', '/api/espera/regras')).json()).toMatchObject({ podeEditar: false, unidades: [{ id: 'norte', regra: { avisoMin: 2 } }] });

    const c = await daCarla('5571988400001');
    const s = (await como(gente.carla, 'POST', '/api/espera/silenciar', { minutos: 10 })).json();
    expect(s.silencioAte).toBeTruthy();
    await avancar(3); // aviso (2 min) com silêncio: vai para o sino, não para o celular
    expect(await esperasDe(gente.carla)).toHaveLength(1);
    expect(pushDe(gente.carla).filter((x) => String(x.etiqueta).startsWith('espera-'))).toHaveLength(0);
    const faixa = (await como(gente.carla, 'GET', '/api/espera')).json();
    expect(faixa.silencioAte).toBe(s.silencioAte);
    expect(faixa.itens[0]).toMatchObject({ conversaId: c.id, nivel: 1, repetirSeg: 30 });
    await avancar(10); // silêncio acabou e passou do forte
    expect(await esperasDe(gente.carla)).toHaveLength(2);
    expect(pushDe(gente.carla).filter((x) => String(x.etiqueta).startsWith('espera-'))).toHaveLength(1);
    expect((await como(gente.carla, 'GET', '/api/espera')).json().silencioAte).toBeNull();
    // Voltar a tocar antes da hora.
    await como(gente.carla, 'POST', '/api/espera/silenciar', { minutos: 30 });
    expect((await como(gente.carla, 'POST', '/api/espera/silenciar', { minutos: 0 })).json().silencioAte).toBeNull();
  });
});

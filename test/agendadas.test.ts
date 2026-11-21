import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import type { Conversa } from '../src/domain.js';
import {
  AgendadasMemoria,
  AgendadasPostgres,
  conferirHorario,
  ErroNaoEditavel,
  instanteDe,
  MotorAgendadas,
  RESERVA_PRESA_MS,
  type ArmazemAgendadas,
  type EnviadorAgendadas,
  type MensagemAgendada,
} from '../src/agendadas/agendadas.js';
import { registrarAgendadas } from '../src/agendadas/rotas.js';
import { poolDeTeste, temPostgres } from './repos.js';

const EMPRESA = 'imperio';
const INICIO = new Date('2026-11-20T13:00:00Z'); // 10:00 na Bahia

/** Relógio de mentira: o teste anda o tempo na mão. */
function relogio(inicio = INICIO) {
  let t = inicio.getTime();
  return { agora: () => new Date(t), andar: (seg: number) => (t += seg * 1000), ir: (d: Date) => (t = d.getTime()) };
}

/** Canal de mentira: anota tudo que sairia para a cliente. `falhas` = quantas vezes falha antes de dar certo. */
function enviadorFalso(conversaId: string, falhas = 0) {
  const saiu: string[] = [];
  let resta = falhas;
  const estado = { existe: true };
  const c = { id: conversaId, empresaId: EMPRESA, nome: 'Juliana Lima', unidade: 'norte' } as Conversa;
  const e: EnviadorAgendadas = {
    conversa: async (id) => (id === c.id && estado.existe ? c : undefined),
    texto: async (_id, texto, atendente) => {
      if (resta-- > 0) throw new Error('WhatsApp desconectado');
      saiu.push(`texto:${texto}|${atendente}`);
    },
    midia: async (_id, m, atendente) => void saiu.push(`${m.tipo}:${m.nomeArquivo ?? ''}:${m.legenda ?? ''}:${m.conteudo.length}|${atendente}`),
  };
  return { e, saiu, estado };
}

interface Montado {
  a: ArmazemAgendadas;
  conversaId: string;
  /** Apaga a conversa de verdade (no Postgres, a agendada vai junto). */
  apagarConversa: () => Promise<void>;
}
const armazens: Array<{ nome: string; criar: () => Promise<Montado> }> = [
  {
    nome: 'memória',
    criar: async () => {
      const a = new AgendadasMemoria();
      const conversaId = randomUUID();
      return { a, conversaId, apagarConversa: async () => undefined };
    },
  },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async (): Promise<Montado> => {
            const pool = await poolDeTeste();
            const repo = new RepositorioPostgres(pool);
            const { conversa } = await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: 'norte', canalId: 't', telefone: '5571988887777', nome: 'Juliana', agora: new Date() });
            return {
              a: new AgendadasPostgres(pool),
              conversaId: conversa.id,
              apagarConversa: async () => void (await pool.query('delete from sintonia.conversas where id = $1', [conversa.id])),
            };
          },
        },
      ]
    : []),
];

async function agendar(a: ArmazemAgendadas, conversaId: string, enviarEm: Date, extra: Partial<{ texto: string; criadoPorId: string }> = {}) {
  return a.criar({ empresaId: EMPRESA, conversaId, texto: extra.texto ?? 'Oi Juliana, seu horário está confirmado!', anexo: null, enviarEm, criadoPor: 'Carla Souza', criadoPorId: extra.criadoPorId ?? 'u-carla', agora: INICIO });
}

describe('agendadas: horário da empresa', () => {
  it('dia e hora são lidos no fuso da Bahia (UTC-3)', () => {
    expect(instanteDe({ data: '2026-11-21', hora: '09:00' })!.toISOString()).toBe('2026-11-21T12:00:00.000Z');
    expect(instanteDe({ enviarEm: '2026-11-21T12:00:00Z' })!.toISOString()).toBe('2026-11-21T12:00:00.000Z');
    expect(instanteDe({})).toBeUndefined();
    expect(() => instanteDe({ data: '2026-11-21' })).toThrow(/dia e a hora/);
  });
  it('não aceita horário que já passou nem longe demais', () => {
    expect(() => conferirHorario(new Date(INICIO.getTime() - 1000), INICIO)).toThrow(/daqui para a frente/);
    expect(() => conferirHorario(new Date(INICIO.getTime() + 400 * 86_400_000), INICIO)).toThrow(/um ano/);
    expect(() => conferirHorario(new Date(INICIO.getTime() + 60_000), INICIO)).not.toThrow();
  });
});

for (const fab of armazens) {
  describe(`agendadas: relógio (${fab.nome})`, () => {
    it('envia na hora certa, uma vez só, com o nome de quem agendou', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId);
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 3600_000));
      const motor = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora });
      expect(await motor.tick()).toBe(0);
      r.andar(3599);
      await motor.tick();
      expect(saiu).toEqual([]);
      r.andar(1);
      await motor.tick();
      expect(saiu).toEqual(['texto:Oi Juliana, seu horário está confirmado!|Carla Souza']);
      expect(await a.obter(EMPRESA, m.id)).toMatchObject({ situacao: 'enviada', tentativas: 1, erro: null });
      r.andar(600);
      expect(await motor.tick()).toBe(0);
      expect(saiu).toHaveLength(1);
    });

    it('com dois processos ao mesmo tempo, cada mensagem é reservada por um só', async () => {
      const { a, conversaId } = await fab.criar();
      for (let i = 0; i < 3; i++) await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000), { texto: 'm' + i });
      const quando = new Date(INICIO.getTime() + 120_000);
      const [x, y] = await Promise.all([a.reservar(quando, 10), a.reservar(quando, 10)]);
      expect(x.length + y.length).toBe(3);
      expect(new Set([...x, ...y].map((m) => m.id)).size).toBe(3);
      expect(await a.reservar(quando, 10)).toEqual([]);
    });

    it('dois motores rodando juntos não enviam em dobro', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId);
      await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000));
      const m1 = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora });
      const m2 = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora });
      r.andar(61);
      await Promise.all([m1.tick(), m2.tick(), m1.tick()]);
      expect(saiu).toHaveLength(1);
    });

    it('cancelada não sai; o que já saiu não cancela', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId);
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000));
      const motor = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora });
      expect(await a.cancelar(EMPRESA, m.id, 'Carla', r.agora())).toMatchObject({ situacao: 'cancelada', canceladoPor: 'Carla' });
      r.andar(120);
      await motor.tick();
      expect(saiu).toEqual([]);
      const outra = await agendar(a, conversaId, new Date(INICIO.getTime() + 180_000));
      r.andar(120);
      await motor.tick();
      expect(saiu).toHaveLength(1);
      await expect(a.cancelar(EMPRESA, outra.id, 'Carla', r.agora())).rejects.toBeInstanceOf(ErroNaoEditavel);
      await expect(a.alterar(EMPRESA, outra.id, { texto: 'x' }, r.agora())).rejects.toThrow(/já foi enviada/);
    });

    it('WhatsApp fora: tenta de novo (1 e 5 min depois) e envia quando volta', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId, 2);
      const avisos: MensagemAgendada[] = [];
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000));
      const motor = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora, avisar: async (x) => void avisos.push(x) });
      r.andar(60);
      await motor.tick();
      expect(await a.obter(EMPRESA, m.id)).toMatchObject({ situacao: 'agendada', tentativas: 1, erro: 'WhatsApp desconectado' });
      r.andar(59);
      await motor.tick();
      expect((await a.obter(EMPRESA, m.id))!.tentativas).toBe(1); // ainda esperando o 1 min
      r.andar(1);
      await motor.tick();
      expect((await a.obter(EMPRESA, m.id))!.tentativas).toBe(2);
      r.andar(300);
      await motor.tick();
      expect(saiu).toHaveLength(1);
      expect(await a.obter(EMPRESA, m.id)).toMatchObject({ situacao: 'enviada', tentativas: 3, erro: null });
      // o horário que a tela mostra continua o pedido
      expect((await a.obter(EMPRESA, m.id))!.enviarEm.toISOString()).toBe(new Date(INICIO.getTime() + 60_000).toISOString());
      expect(avisos).toEqual([]);
    });

    it('depois de 4 tentativas marca "falhou" e avisa quem agendou uma vez', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId, 99);
      const avisos: MensagemAgendada[] = [];
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000));
      const motor = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora, avisar: async (x) => void avisos.push(x) });
      r.andar(60);
      for (let i = 0; i < 40; i++) {
        await motor.tick();
        r.andar(60);
      }
      expect(saiu).toEqual([]);
      expect(await a.obter(EMPRESA, m.id)).toMatchObject({ situacao: 'falhou', tentativas: 4, erro: expect.stringMatching(/4 tentativas.*desconectado/) });
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ id: m.id, criadoPorId: 'u-carla', situacao: 'falhou' });
      // editar a que falhou com horário novo volta a agendar do zero
      const nova = await a.alterar(EMPRESA, m.id, { enviarEm: new Date(r.agora().getTime() + 600_000) }, r.agora());
      expect(nova).toMatchObject({ situacao: 'agendada', tentativas: 0, erro: null });
    });

    it('conversa apagada: nada sai', async () => {
      const { a, conversaId, apagarConversa } = await fab.criar();
      const r = relogio();
      const { e, saiu, estado } = enviadorFalso(conversaId);
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000));
      await apagarConversa();
      estado.existe = false;
      const motor = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora });
      r.andar(120);
      await motor.tick();
      expect(saiu).toEqual([]);
      const depois = await a.obter(EMPRESA, m.id);
      // Postgres: a linha foi junto com a conversa. Memória: fica cancelada.
      if (depois) expect(depois).toMatchObject({ situacao: 'cancelada', erro: expect.stringMatching(/apagada/) });
    });

    it('servidor caiu no meio do envio: não reenvia às cegas, marca "falhou" e avisa', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId);
      const avisos: MensagemAgendada[] = [];
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000));
      r.andar(60);
      await a.reservar(r.agora(), 10); // reservou e "caiu"
      const motor = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora, avisar: async (x) => void avisos.push(x) });
      await motor.tick();
      expect((await a.obter(EMPRESA, m.id))!.situacao).toBe('enviando');
      r.andar(RESERVA_PRESA_MS / 1000 + 1);
      await motor.tick();
      expect(saiu).toEqual([]);
      expect(await a.obter(EMPRESA, m.id)).toMatchObject({ situacao: 'falhou', erro: expect.stringMatching(/reiniciou/) });
      expect(avisos).toHaveLength(1);
    });

    it('servidor fora do ar por horas: não sai atrasada demais', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId);
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 60_000));
      r.andar(60 + 7 * 3600);
      await new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora }).tick();
      expect(saiu).toEqual([]);
      expect(await a.obter(EMPRESA, m.id)).toMatchObject({ situacao: 'falhou', erro: expect.stringMatching(/Passou muito da hora/) });
    });

    it('anexo: envia o arquivo com o texto de legenda', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId);
      await a.criar({ empresaId: EMPRESA, conversaId, texto: 'Seu orçamento', anexo: { tipo: 'documento', mimetype: 'application/pdf', nome: 'orcamento.pdf', tamanho: 3, conteudo: Buffer.from('pdf') }, enviarEm: new Date(INICIO.getTime() + 60_000), criadoPor: 'Carla', criadoPorId: null, agora: INICIO });
      r.andar(60);
      await new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora }).tick();
      expect(saiu).toEqual(['documento:orcamento.pdf:Seu orçamento:3|Carla']);
    });

    it('enviar agora: sai na hora, antes do horário marcado', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso(conversaId);
      const m = await agendar(a, conversaId, new Date(INICIO.getTime() + 86_400_000));
      const motor = new MotorAgendadas({ armazem: a, enviador: e, agora: r.agora });
      expect(await motor.enviarAgora(EMPRESA, m.id)).toMatchObject({ situacao: 'enviada' });
      expect(saiu).toHaveLength(1);
      await expect(motor.enviarAgora(EMPRESA, m.id)).rejects.toBeInstanceOf(ErroNaoEditavel);
    });
  });
}

describe('agendadas: rotas e permissões', () => {
  async function montar() {
    const contas = new ContasMemoria();
    const senhaHash = await gerarHash('Imperio2026xyz');
    await contas.criarUsuario({ empresaId: EMPRESA, nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
    await contas.criarUsuario({ empresaId: EMPRESA, nome: 'Carla Souza', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
    await contas.criarUsuario({ empresaId: EMPRESA, nome: 'Dani Rocha', email: 'dani@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
    const repo = new RepositorioMemoria();
    const canal = new CanalTeste();
    const sintonia = new Sintonia({ empresaId: EMPRESA, repo, numeros: [{ canalId: 'teste-norte', unidade: 'norte', canal }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: 'norte', canalId: 'teste-norte', telefone: '5571988887777', nome: 'Juliana Lima', agora: new Date() });
    const { conversa: sumare } = await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: 'sumare', canalId: 'teste-sumare', telefone: '5571977776666', nome: 'Bia', agora: new Date() });
    const app = criarServidor({ sintonia, repo, auth: { contas } });
    const r = relogio();
    const armazem = new AgendadasMemoria();
    const motor = new MotorAgendadas({
      armazem,
      agora: r.agora,
      enviador: {
        conversa: (id) => repo.buscarConversa(id),
        texto: (id, t, at) => sintonia.equipeEnviou(id, t, at),
        midia: async (id, m, at) => void (await sintonia.equipeEnviouMidia(id, m, at)),
      },
    });
    registrarAgendadas(app, { repo, empresaId: EMPRESA, armazem, motor, agora: r.agora });
    const login = async (email: string) => {
      const x = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } });
      return String(x.headers['set-cookie']).split(';')[0]!;
    };
    return { app, repo, motor, r, canal, conversa, sumare, bruno: await login('bruno@imperio.com'), carla: await login('carla@imperio.com'), dani: await login('dani@imperio.com') };
  }
  const url = (id: string, resto = '') => `/api/conversas/${id}/agendadas${resto}`;

  it('agenda com dia e hora da empresa, mostra na conversa e envia como mensagem da equipe', async () => {
    const { app, repo, motor, r, conversa, carla } = await montar();
    const c = await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: '  Bom dia! Lembrete do seu horário  ', data: '2026-11-21', hora: '09:00' } });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ texto: 'Bom dia! Lembrete do seu horário', situacao: 'agendada', criadoPor: 'Carla Souza', enviarEm: '2026-11-21T12:00:00.000Z', podeEditar: true });
    const lista = (await app.inject({ method: 'GET', url: url(conversa.id), headers: { cookie: carla } })).json();
    expect(lista.agendadas).toHaveLength(1);
    r.ir(new Date('2026-11-21T12:00:05Z'));
    await motor.tick();
    expect((await repo.mensagens(conversa.id)).at(-1)).toMatchObject({ autor: 'equipe', autorNome: 'Carla Souza', texto: 'Bom dia! Lembrete do seu horário' });
    // enviada sai da lista da conversa (só pendentes); com ?todas=1 aparece
    expect((await app.inject({ method: 'GET', url: url(conversa.id), headers: { cookie: carla } })).json().agendadas).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: url(conversa.id, '?todas=1'), headers: { cookie: carla } })).json().agendadas[0]).toMatchObject({ situacao: 'enviada' });
  });

  it('recusa horário que passou, mensagem vazia e dia sem hora', async () => {
    const { app, conversa, carla } = await montar();
    const passado = await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: 'oi', data: '2026-11-20', hora: '09:00' } });
    expect(passado.statusCode).toBe(400);
    expect(passado.json().erro).toMatch(/daqui para a frente/);
    expect((await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: '  ', data: '2026-11-21', hora: '09:00' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: 'oi', data: '2026-11-21' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: 'oi', hora: '25:00', data: '2026-11-21' } })).statusCode).toBe(400);
  });

  it('permissões: quem não vê a conversa não agenda nem vê; colega vê mas não mexe; gestão mexe', async () => {
    const { app, conversa, sumare, carla, dani, bruno } = await montar();
    expect((await app.inject({ method: 'POST', url: url(sumare.id), headers: { cookie: carla }, payload: { texto: 'oi', data: '2026-11-21', hora: '09:00' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: url(sumare.id), headers: { cookie: carla } })).statusCode).toBe(404);
    const ag = (await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: 'oi', data: '2026-11-21', hora: '09:00' } })).json();
    // Dani (mesma unidade) vê, mas não muda nem cancela
    const vista = (await app.inject({ method: 'GET', url: url(conversa.id), headers: { cookie: dani } })).json();
    expect(vista.agendadas[0]).toMatchObject({ id: ag.id, podeEditar: false });
    expect((await app.inject({ method: 'PATCH', url: url(conversa.id, '/' + ag.id), headers: { cookie: dani }, payload: { texto: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: url(conversa.id, `/${ag.id}/cancelar`), headers: { cookie: dani } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: url(conversa.id, `/${ag.id}/enviar`), headers: { cookie: dani } })).statusCode).toBe(403);
    // a agendada de uma conversa não é achada pela rota de outra
    expect((await app.inject({ method: 'PATCH', url: url(sumare.id, '/' + ag.id), headers: { cookie: bruno }, payload: { texto: 'x' } })).statusCode).toBe(404);
    // gestão muda
    const mudou = await app.inject({ method: 'PATCH', url: url(conversa.id, '/' + ag.id), headers: { cookie: bruno }, payload: { texto: 'Oi de novo', data: '2026-11-22', hora: '18:30' } });
    expect(mudou.statusCode).toBe(200);
    expect(mudou.json()).toMatchObject({ texto: 'Oi de novo', enviarEm: '2026-11-22T21:30:00.000Z', podeEditar: true });
    // quem agendou cancela; cancelar de novo dá 409
    expect((await app.inject({ method: 'POST', url: url(conversa.id, `/${ag.id}/cancelar`), headers: { cookie: carla } })).json()).toMatchObject({ situacao: 'cancelada', canceladoPor: 'Carla Souza' });
    expect((await app.inject({ method: 'DELETE', url: url(conversa.id, `/${ag.id}`), headers: { cookie: carla } })).statusCode).toBe(409);
  });

  it('enviar agora registra na conversa; lista geral filtra minhas e todas', async () => {
    const { app, repo, conversa, carla, dani, bruno } = await montar();
    const a1 = (await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: 'Da Carla', data: '2026-11-21', hora: '09:00' } })).json();
    await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: dani }, payload: { texto: 'Da Dani', data: '2026-11-21', hora: '10:00' } });
    const minhas = (await app.inject({ method: 'GET', url: '/api/agendadas', headers: { cookie: carla } })).json();
    expect(minhas.agendadas.map((x: { texto: string }) => x.texto)).toEqual(['Da Carla']);
    expect(minhas.agendadas[0].conversa).toMatchObject({ id: conversa.id, nome: 'Juliana Lima' });
    expect(minhas.minhasPendentes).toBe(1);
    const todas = (await app.inject({ method: 'GET', url: '/api/agendadas?quem=todas', headers: { cookie: bruno } })).json();
    expect(todas.agendadas).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/api/agendadas?situacao=xyz', headers: { cookie: bruno } })).statusCode).toBe(400);

    const env = await app.inject({ method: 'POST', url: url(conversa.id, `/${a1.id}/enviar`), headers: { cookie: carla } });
    expect(env.statusCode).toBe(200);
    expect(env.json().situacao).toBe('enviada');
    expect((await repo.mensagens(conversa.id)).at(-1)).toMatchObject({ autor: 'equipe', autorNome: 'Carla Souza', texto: 'Da Carla' });
    const enviadas = (await app.inject({ method: 'GET', url: '/api/agendadas?quem=todas&situacao=enviada', headers: { cookie: bruno } })).json();
    expect(enviadas.agendadas.map((x: { texto: string }) => x.texto)).toEqual(['Da Carla']);
  });

  it('anexo: guarda, devolve o arquivo e recusa acima de 16 MB', async () => {
    const { app, conversa, carla } = await montar();
    const r = await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { texto: 'Foto', data: '2026-11-21', hora: '09:00', anexo: { base64: Buffer.from('png').toString('base64'), mimetype: 'image/png', nomeArquivo: 'a.png' } } });
    expect(r.statusCode).toBe(201);
    expect(r.json().anexo).toMatchObject({ tipo: 'imagem', nome: 'a.png', tamanho: 3 });
    const g = await app.inject({ method: 'GET', url: url(conversa.id, `/${r.json().id}/anexo`), headers: { cookie: carla } });
    expect(g.body).toBe('png');
    const grande = Buffer.alloc(16 * 1024 * 1024 + 10).toString('base64');
    const r2 = await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { data: '2026-11-21', hora: '09:00', anexo: { base64: grande, mimetype: 'video/mp4' } } });
    expect(r2.statusCode).toBe(413);
    // tirar o anexo de uma sem texto deixaria vazia
    const soArquivo = (await app.inject({ method: 'POST', url: url(conversa.id), headers: { cookie: carla }, payload: { data: '2026-11-21', hora: '09:00', anexo: { base64: Buffer.from('x').toString('base64'), mimetype: 'application/pdf' } } })).json();
    expect((await app.inject({ method: 'PATCH', url: url(conversa.id, '/' + soArquivo.id), headers: { cookie: carla }, payload: { removerAnexo: true } })).statusCode).toBe(400);
  });
});

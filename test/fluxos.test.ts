import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import type { Conversa } from '../src/domain.js';
import {
  agendaDoPasso,
  DadosFluxo,
  FluxosMemoria,
  FluxosPostgres,
  MotorFluxos,
  preencherTexto,
  type ArmazemFluxos,
  type EnviadorFluxo,
  type Fluxo,
} from '../src/conversa/fluxos.js';
import { registrarFluxos } from '../src/conversa/fluxos-rotas.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { poolDeTeste, temPostgres } from './repos.js';

const EMPRESA = 'imperio';

/** Relógio de mentira: o teste anda o tempo na mão. */
function relogio(inicio = new Date('2026-11-20T13:00:00Z')) {
  let t = inicio.getTime();
  return { agora: () => new Date(t), andar: (seg: number) => (t += seg * 1000) };
}

/** Canal de mentira: anota tudo que sairia para a cliente. */
function enviadorFalso(conversa: Partial<Conversa> & { id: string }) {
  const saiu: string[] = [];
  const c = { nome: 'Juliana Lima', unidade: 'norte', ...conversa } as Conversa;
  const e: EnviadorFluxo = {
    conversa: async (id) => (id === c.id ? c : undefined),
    texto: async (_id, texto, atendente) => void saiu.push(`texto:${texto}|${atendente}`),
    midia: async (_id, m) => void saiu.push(`${m.tipo}:${m.nomeArquivo ?? ''}:${m.legenda ?? ''}:${m.conteudo.length}`),
    presenca: async (_id, tipo, seg) => void saiu.push(`presenca:${tipo}:${seg}`),
  };
  return { e, saiu, c };
}

const armazens: Array<{ nome: string; criar: () => Promise<{ a: ArmazemFluxos; conversaId: string }> }> = [
  { nome: 'memória', criar: async () => ({ a: new FluxosMemoria(), conversaId: randomUUID() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            const repo = new RepositorioPostgres(pool);
            const { conversa } = await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: 'norte', canalId: 't', telefone: '5571988887777', nome: 'Juliana', agora: new Date() });
            return { a: new FluxosPostgres(pool) as ArmazemFluxos, conversaId: conversa.id };
          },
        },
      ]
    : []),
];

async function criarFluxo(a: ArmazemFluxos, bruto: unknown): Promise<Fluxo> {
  const d = DadosFluxo.parse(bruto);
  return a.criar(EMPRESA, { ...d, usuarioId: null, criadaPor: 'Bruno' });
}

describe('fluxos: regras puras', () => {
  it('normaliza o atalho e exige arquivo nos passos de mídia', () => {
    const d = DadosFluxo.parse({ atalho: '/Boas Vindas', nome: 'Boas-vindas', passos: [{ tipo: 'texto', texto: 'Oi' }] });
    expect(d.atalho).toBe('boas-vindas');
    expect(d.passos[0]).toMatchObject({ tipo: 'texto', esperaSeg: 0, presenca: 'nenhuma' });
    expect(() => DadosFluxo.parse({ atalho: 'x', nome: 'X', passos: [{ tipo: 'audio' }] })).toThrow(/arquivo/);
    expect(() => DadosFluxo.parse({ atalho: 'x', nome: 'X', passos: [] })).toThrow(/pelo menos um passo/);
    expect(() => DadosFluxo.parse({ atalho: 'x', nome: 'X', passos: [{ tipo: 'texto', texto: 'a', esperaSeg: 90000 }] })).toThrow(/24 horas/);
  });

  it('agenda: "digitando" aparece no fim da espera (até 25 s) ou por 3 s sem espera', () => {
    const base = new Date(0);
    expect(agendaDoPasso({ esperaSeg: 5, presenca: 'nenhuma' }, base)).toEqual({ fase: 'enviar', quando: new Date(5000) });
    expect(agendaDoPasso({ esperaSeg: 5, presenca: 'digitando' }, base)).toEqual({ fase: 'presenca', quando: new Date(0) });
    expect(agendaDoPasso({ esperaSeg: 120, presenca: 'gravando' }, base)).toEqual({ fase: 'presenca', quando: new Date(95_000) });
    expect(agendaDoPasso({ esperaSeg: 0, presenca: 'digitando' }, base)).toEqual({ fase: 'presenca', quando: new Date(0) });
  });

  it('troca {nome}, {unidade} e {atendente}', () => {
    expect(preencherTexto('Oi {nome}, aqui é {atendente} da {unidade}!', { nome: 'Juliana Lima', unidade: 'norte' }, 'Carla Souza')).toBe(
      'Oi Juliana, aqui é Carla da Salvador Norte Shopping!',
    );
    expect(preencherTexto('Oi {nome}, tudo bem?', { nome: undefined, unidade: 'norte' }, 'Carla')).toBe('Oi, tudo bem?');
  });
});

for (const fab of armazens) {
  describe(`fluxos: envio pelo servidor (${fab.nome})`, () => {
    it('envia em sequência, respeitando as esperas e o "digitando"', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso({ id: conversaId });
      const midiaId = randomUUID();
      await a.guardarMidia({ id: midiaId, empresaId: EMPRESA, nome: 'audio.ogg', mimetype: 'audio/ogg', tamanho: 3, conteudo: Buffer.from('abc') });
      const f = await criarFluxo(a, {
        atalho: 'boas-vindas',
        nome: 'Boas-vindas',
        passos: [
          { tipo: 'texto', texto: 'Oi {nome}!' },
          { tipo: 'audio', midiaId, esperaSeg: 5, presenca: 'gravando' },
          { tipo: 'texto', texto: 'Posso te ajudar?', esperaSeg: 120 },
        ],
      });
      const motor = new MotorFluxos({ armazem: a, enviador: e, agora: r.agora });
      const envio = await motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla Souza' });

      await motor.tick();
      expect(saiu).toEqual(['texto:Oi Juliana!|Carla Souza']);
      expect((await a.envio(EMPRESA, envio.id))!.passo).toBe(1);

      // passo 2: "gravando" logo (espera 5 s, aviso nos 5 s), depois o áudio
      await motor.tick();
      expect(saiu.at(-1)).toBe('presenca:gravando:5');
      r.andar(3);
      await motor.tick();
      expect(saiu).toHaveLength(2); // ainda esperando
      r.andar(2);
      await motor.tick();
      expect(saiu.at(-1)).toBe('audio:audio.ogg::3');

      // passo 3: só depois de 2 minutos
      r.andar(119);
      await motor.tick();
      expect(saiu).toHaveLength(3);
      r.andar(1);
      await motor.tick();
      expect(saiu.at(-1)).toBe('texto:Posso te ajudar?|Carla Souza');
      const fim = (await a.envio(EMPRESA, envio.id))!;
      expect(fim.situacao).toBe('concluido');
      // nada mais sai
      r.andar(600);
      expect(await motor.tick()).toBe(0);
    });

    it('Parar cancela os passos que faltam', async () => {
      const { a, conversaId } = await fab.criar();
      const r = relogio();
      const { e, saiu } = enviadorFalso({ id: conversaId });
      const f = await criarFluxo(a, { atalho: 'p', nome: 'P', passos: [{ tipo: 'texto', texto: 'um' }, { tipo: 'texto', texto: 'dois', esperaSeg: 10 }, { tipo: 'texto', texto: 'três', esperaSeg: 10 }] });
      const motor = new MotorFluxos({ armazem: a, enviador: e, agora: r.agora });
      const envio = await motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla' });
      await motor.tick();
      const parado = await motor.parar(EMPRESA, envio.id, 'Carla');
      expect(parado).toMatchObject({ situacao: 'parado', motivo: 'Parado por Carla.' });
      r.andar(60);
      await motor.tick();
      expect(saiu).toEqual(['texto:um|Carla']);
      // pode começar outro depois de parar
      await expect(motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla' })).resolves.toMatchObject({ situacao: 'andando' });
    });

    it('um fluxo por vez na conversa', async () => {
      const { a, conversaId } = await fab.criar();
      const { e } = enviadorFalso({ id: conversaId });
      const f = await criarFluxo(a, { atalho: 'u', nome: 'U', passos: [{ tipo: 'texto', texto: 'a', esperaSeg: 30 }] });
      const motor = new MotorFluxos({ armazem: a, enviador: e });
      await motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla' });
      await expect(motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla' })).rejects.toThrow(/Já tem um fluxo/);
    });

    it('cliente respondeu no meio: "parar" para, "continuar" segue', async () => {
      for (const opcao of ['parar', 'continuar'] as const) {
        const { a, conversaId } = await fab.criar();
        const r = relogio();
        const { e, saiu, c } = enviadorFalso({ id: conversaId });
        const f = await criarFluxo(a, {
          atalho: 'r-' + opcao,
          nome: 'R',
          seClienteResponder: opcao,
          passos: [{ tipo: 'texto', texto: 'um' }, { tipo: 'texto', texto: 'dois', esperaSeg: 30 }],
        });
        // resposta antiga (antes do disparo) não conta
        c.ultimaMensagemCliente = new Date(r.agora().getTime() - 60_000);
        const motor = new MotorFluxos({ armazem: a, enviador: e, agora: r.agora });
        const envio = await motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla' });
        await motor.tick();
        r.andar(10);
        c.ultimaMensagemCliente = r.agora(); // ela respondeu
        r.andar(20);
        await motor.tick();
        const fim = (await a.envio(EMPRESA, envio.id))!;
        if (opcao === 'parar') {
          expect(saiu).toEqual(['texto:um|Carla']);
          expect(fim).toMatchObject({ situacao: 'parado', motivo: expect.stringMatching(/cliente respondeu/) });
        } else {
          expect(saiu).toEqual(['texto:um|Carla', 'texto:dois|Carla']);
          expect(fim.situacao).toBe('concluido');
        }
      }
    });

    it('falha no envio encerra com erro e não tenta o resto', async () => {
      const { a, conversaId } = await fab.criar();
      const { e } = enviadorFalso({ id: conversaId });
      e.texto = async () => {
        throw new Error('WhatsApp desconectado');
      };
      const f = await criarFluxo(a, { atalho: 'e', nome: 'E', passos: [{ tipo: 'texto', texto: 'um' }, { tipo: 'texto', texto: 'dois' }] });
      const motor = new MotorFluxos({ armazem: a, enviador: e });
      const envio = await motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla' });
      await motor.tick();
      expect(await a.envio(EMPRESA, envio.id)).toMatchObject({ situacao: 'erro', motivo: expect.stringMatching(/passo 1.*desconectado/) });
    });

    it('cada passo vencido é reservado por um processo só', async () => {
      const { a, conversaId } = await fab.criar();
      const f = await criarFluxo(a, { atalho: 'z', nome: 'Z', passos: [{ tipo: 'texto', texto: 'a' }] });
      const motor = new MotorFluxos({ armazem: a, enviador: enviadorFalso({ id: conversaId }).e });
      await motor.iniciar(EMPRESA, conversaId, f, { nome: 'Carla' });
      const agora = new Date(Date.now() + 1000);
      const [x, y] = await Promise.all([a.reivindicar(agora, 10, 60_000), a.reivindicar(agora, 10, 60_000)]);
      expect(x.length + y.length).toBe(1);
    });

    it('limpa arquivos velhos sem uso e mantém os usados', async () => {
      const { a } = await fab.criar();
      const usado = randomUUID();
      const solto = randomUUID();
      for (const id of [usado, solto]) await a.guardarMidia({ id, empresaId: EMPRESA, nome: null, mimetype: 'image/png', tamanho: 1, conteudo: Buffer.from('x') });
      await criarFluxo(a, { atalho: 'img-' + usado.slice(0, 6), nome: 'I', passos: [{ tipo: 'imagem', midiaId: usado }] });
      await a.limparMidias(EMPRESA, new Date(Date.now() + 60_000));
      expect(await a.midia(EMPRESA, usado)).toBeDefined();
      expect(await a.midia(EMPRESA, solto)).toBeUndefined();
    });
  });
}

describe('fluxos: rotas', () => {
  async function montar() {
    const contas = new ContasMemoria();
    const senhaHash = await gerarHash('Imperio2026xyz');
    await contas.criarUsuario({ empresaId: EMPRESA, nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
    await contas.criarUsuario({ empresaId: EMPRESA, nome: 'Carla Souza', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
    const repo = new RepositorioMemoria();
    const canal = new CanalTeste();
    const sintonia = new Sintonia({ empresaId: EMPRESA, repo, numeros: [{ canalId: 'teste-norte', unidade: 'norte', canal }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: 'norte', canalId: 'teste-norte', telefone: '5571988887777', nome: 'Juliana Lima', agora: new Date() });
    const { conversa: sumare } = await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: 'sumare', canalId: 'teste-sumare', telefone: '5571977776666', nome: 'Bia', agora: new Date() });
    const app = criarServidor({ sintonia, repo, auth: { contas } });
    const armazem = new FluxosMemoria();
    const motor = new MotorFluxos({
      armazem,
      enviador: {
        conversa: (id) => repo.buscarConversa(id),
        texto: (id, t, at) => sintonia.equipeEnviou(id, t, at),
        midia: async (id, m, at) => void (await sintonia.equipeEnviouMidia(id, m, at)),
        presenca: (id, tipo, s) => sintonia.mostrarPresenca(id, tipo, s),
      },
    });
    registrarFluxos(app, { repo, empresaId: EMPRESA, armazem, motor });
    const login = async (email: string) => {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } });
      return String(r.headers['set-cookie']).split(';')[0]!;
    };
    return { app, repo, motor, conversa, sumare, bruno: await login('bruno@imperio.com'), carla: await login('carla@imperio.com') };
  }

  it('gestão cria da empresa; atendente só pessoal e não mexe nos da empresa', async () => {
    const { app, bruno, carla } = await montar();
    const passos = [{ tipo: 'texto', texto: 'Oi {nome}' }];
    const r1 = await app.inject({ method: 'POST', url: '/api/fluxos-mensagens', headers: { cookie: bruno }, payload: { atalho: 'oi', nome: 'Oi', passos } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ pessoal: false, podeEditar: true });
    const r2 = await app.inject({ method: 'POST', url: '/api/fluxos-mensagens', headers: { cookie: carla }, payload: { atalho: 'oi', nome: 'Meu oi', passos } });
    expect(r2.json()).toMatchObject({ pessoal: true });
    const lista = (await app.inject({ method: 'GET', url: '/api/fluxos-mensagens', headers: { cookie: carla } })).json();
    expect(lista.fluxos).toHaveLength(2);
    expect(lista.limites).toEqual({ arquivoMb: 16, passos: 20 });
    const daEmpresa = lista.fluxos.find((f: { pessoal: boolean }) => !f.pessoal);
    expect(daEmpresa.podeEditar).toBe(false);
    const r3 = await app.inject({ method: 'PATCH', url: '/api/fluxos-mensagens/' + daEmpresa.id, headers: { cookie: carla }, payload: { nome: 'x' } });
    expect(r3.statusCode).toBe(403);
    // o pessoal da Carla não aparece para o Bruno
    expect((await app.inject({ method: 'GET', url: '/api/fluxos-mensagens', headers: { cookie: bruno } })).json().fluxos).toHaveLength(1);
    // atalho repetido
    const r4 = await app.inject({ method: 'POST', url: '/api/fluxos-mensagens', headers: { cookie: bruno }, payload: { atalho: '/Oi', nome: 'Oi 2', passos } });
    expect(r4.statusCode).toBe(409);
  });

  it('arquivo: guarda, devolve, recusa acima de 16 MB e recusa passo com arquivo inexistente', async () => {
    const { app, bruno } = await montar();
    const r = await app.inject({ method: 'POST', url: '/api/fluxos-mensagens/midias', headers: { cookie: bruno }, payload: { base64: Buffer.from('oi').toString('base64'), mimetype: 'audio/ogg', nomeArquivo: 'oi.ogg' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ tipo: 'audio', tamanho: 2 });
    const g = await app.inject({ method: 'GET', url: '/api/fluxos-mensagens/midias/' + r.json().id, headers: { cookie: bruno } });
    expect(g.statusCode).toBe(200);
    expect(g.body).toBe('oi');
    const grande = Buffer.alloc(16 * 1024 * 1024 + 10).toString('base64');
    const r2 = await app.inject({ method: 'POST', url: '/api/fluxos-mensagens/midias', headers: { cookie: bruno }, payload: { base64: grande, mimetype: 'video/mp4' } });
    expect(r2.statusCode).toBe(413);
    expect(r2.json().erro).toMatch(/16 MB/);
    const r3 = await app.inject({ method: 'POST', url: '/api/fluxos-mensagens', headers: { cookie: bruno }, payload: { atalho: 'a', nome: 'A', passos: [{ tipo: 'imagem', midiaId: randomUUID() }] } });
    expect(r3.statusCode).toBe(400);
  });

  it('na conversa: dispara, mostra o andamento, envia pelo servidor e para', async () => {
    const { app, repo, motor, conversa, sumare, bruno, carla } = await montar();
    const f = (
      await app.inject({
        method: 'POST',
        url: '/api/fluxos-mensagens',
        headers: { cookie: bruno },
        payload: { atalho: 'oi', nome: 'Oi', passos: [{ tipo: 'texto', texto: 'Oi {nome}, aqui é {atendente}' }, { tipo: 'texto', texto: 'Depois', esperaSeg: 60 }] },
      })
    ).json();
    // Carla não vê a conversa de Sumaré
    expect((await app.inject({ method: 'POST', url: `/api/conversas/${sumare.id}/fluxos`, headers: { cookie: carla }, payload: { fluxoId: f.id } })).statusCode).toBe(404);
    const r = await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/fluxos`, headers: { cookie: carla }, payload: { fluxoId: f.id } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ nome: 'Oi', total: 2, passoAtual: 1, situacao: 'andando' });
    expect((await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/fluxos`, headers: { cookie: carla }, payload: { fluxoId: f.id } })).statusCode).toBe(409);
    await motor.tick();
    const msgs = await repo.mensagens(conversa.id);
    expect(msgs.at(-1)).toMatchObject({ autor: 'equipe', autorNome: 'Carla Souza', texto: 'Oi Juliana, aqui é Carla' });
    const and = (await app.inject({ method: 'GET', url: `/api/conversas/${conversa.id}/fluxos/andamento`, headers: { cookie: carla } })).json();
    expect(and.envio).toMatchObject({ passoAtual: 2, enviados: 1, total: 2 });
    const p = await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/fluxos/${and.envio.id}/parar`, headers: { cookie: carla } });
    expect(p.json().envio).toMatchObject({ situacao: 'parado' });
  });
});

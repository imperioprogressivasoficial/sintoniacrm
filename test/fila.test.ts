import { describe, expect, it } from 'vitest';
import type { MensagemRecebida } from '../src/channels/tipos.js';
import { FilaMemoria, FilaPostgres, MAX_TENTATIVAS, RESERVA_MS, type FilaEntrada } from '../src/fila/entrada.js';
import { Trabalhador } from '../src/fila/trabalhador.js';
import { TravaMemoria, TravaPostgres, type Trava } from '../src/fila/trava.js';
import { poolDeTeste, temPostgres } from './repos.js';

interface FabricaFila {
  nome: string;
  criar(): Promise<{ fila: FilaEntrada; trava: Trava }>;
}

const fabricas: FabricaFila[] = [
  { nome: 'memória', criar: async () => ({ fila: new FilaMemoria(), trava: new TravaMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            return { fila: new FilaPostgres(pool), trava: new TravaPostgres(pool) };
          },
        },
      ]
    : []),
];

let seq = 0;
function msg(telefone: string, texto: string, extra: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    canalId: 'imperio-norte',
    telefone,
    nome: 'Cliente',
    texto,
    deMim: false,
    idExterno: `f-${++seq}`,
    em: new Date(Date.UTC(2026, 10, 5, 13, 0, seq % 60)),
    ...extra,
  };
}

const depois = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe.each(fabricas)('Fila de entrada ($nome)', (f) => {
  it('ignora o mesmo webhook duas vezes e guarda a mensagem inteira', async () => {
    const { fila } = await f.criar();
    const a = msg('5571900000001', 'oi');
    expect(await fila.enfileirar('evolution', [a, a])).toBe(1);
    expect(await fila.enfileirar('evolution', [a])).toBe(0);
    const [item] = await fila.reivindicar(depois(new Date(), 1000), 10);
    expect(item!.mensagem).toEqual(a);
    expect(item!.mensagem.em).toBeInstanceOf(Date);
  });

  it('mesma cliente em ordem, uma de cada vez; clientes diferentes em paralelo', async () => {
    const { fila } = await f.criar();
    const m1 = msg('5571900000001', 'primeira');
    const m2 = msg('5571900000001', 'segunda');
    const outra = msg('5571900000002', 'outra cliente');
    await fila.enfileirar('evolution', [m1, m2, outra]);
    const agora = depois(new Date(), 1000);
    const lote1 = await fila.reivindicar(agora, 10);
    expect(lote1.map((i) => i.mensagem.texto)).toEqual(['primeira', 'outra cliente']);
    expect(await fila.reivindicar(agora, 10)).toHaveLength(0);
    await fila.concluir(lote1[0]!.id, agora);
    const lote2 = await fila.reivindicar(agora, 10);
    expect(lote2.map((i) => i.mensagem.texto)).toEqual(['segunda']);
  });

  it('se o processo cair, a reserva vence e outro trabalhador pega a mensagem', async () => {
    const { fila } = await f.criar();
    await fila.enfileirar('evolution', [msg('5571900000001', 'oi')]);
    const agora = depois(new Date(), 1000);
    const [item] = await fila.reivindicar(agora, 10);
    // ninguém concluiu (o processo "caiu")
    expect(await fila.reivindicar(depois(agora, RESERVA_MS - 1000), 10)).toHaveLength(0);
    const [denovo] = await fila.reivindicar(depois(agora, RESERVA_MS + 1000), 10);
    expect(denovo!.id).toBe(item!.id);
    expect(denovo!.tentativas).toBe(2);
  });

  it('erro: tenta de novo com espera; depois do limite vai para a lista de falhas sem travar a cliente', async () => {
    const { fila } = await f.criar();
    const ruim = msg('5571900000001', 'quebra');
    const boa = msg('5571900000001', 'depois');
    await fila.enfileirar('evolution', [ruim, boa]);
    let agora = depois(new Date(), 1000);
    for (let i = 1; i <= MAX_TENTATIVAS; i++) {
      const [item] = await fila.reivindicar(agora, 10);
      expect(item!.mensagem.texto).toBe('quebra');
      expect(item!.tentativas).toBe(i);
      await fila.falhar(item!.id, `erro ${i}`, agora);
      if (i < MAX_TENTATIVAS) {
        // antes da espera, nada sai (nem a mensagem seguinte da mesma cliente)
        expect(await fila.reivindicar(depois(agora, 1000), 10)).toHaveLength(0);
      }
      agora = depois(agora, 5 * 60_000);
    }
    expect(await fila.situacao()).toMatchObject({ falhas: 1 });
    const [falha] = await fila.falhas();
    expect(falha).toMatchObject({ tentativas: MAX_TENTATIVAS, erro: `erro ${MAX_TENTATIVAS}` });
    expect(falha!.mensagem.texto).toBe('quebra');
    // a cliente não fica travada pela mensagem que falhou
    const [seguinte] = await fila.reivindicar(agora, 10);
    expect(seguinte!.mensagem.texto).toBe('depois');
    await fila.concluir(seguinte!.id, agora);
    // depois de corrigido, a falha volta para a fila
    await fila.reprocessar(falha!.id, agora);
    const [devolvida] = await fila.reivindicar(depois(agora, 1000), 10);
    expect(devolvida!.mensagem.texto).toBe('quebra');
    expect(devolvida!.tentativas).toBe(1);
  });

  it('300 mensagens, 30 clientes, 6 trabalhadores: todas uma vez só e em ordem por cliente', async () => {
    const { fila } = await f.criar();
    const clientes = Array.from({ length: 30 }, (_, i) => `55719${String(i).padStart(8, '0')}`);
    const mensagens: MensagemRecebida[] = [];
    for (let n = 0; n < 10; n++) for (const tel of clientes) mensagens.push(msg(tel, String(n)));
    await fila.enfileirar('evolution', mensagens);

    const vistas = new Map<string, number[]>();
    let total = 0;
    const trabalhadores = Array.from(
      { length: 6 },
      () =>
        new Trabalhador({
          fila,
          paralelo: 5,
          agora: () => depois(new Date(), 1000),
          processar: async (m) => {
            await new Promise((r) => setTimeout(r, Math.random() * 3));
            const l = vistas.get(m.telefone) ?? [];
            l.push(Number(m.texto));
            vistas.set(m.telefone, l);
            total++;
          },
        }),
    );
    for (let rodada = 0; rodada < 200 && total < 300; rodada++) {
      await Promise.all(trabalhadores.map((t) => t.rodada()));
    }
    expect(total).toBe(300);
    for (const tel of clientes) expect(vistas.get(tel)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await fila.situacao()).toEqual({ pendentes: 0, processando: 0, falhas: 0 });
  });

  it('trava por conversa: duas tarefas da mesma conversa nunca rodam ao mesmo tempo', async () => {
    const { trava } = await f.criar();
    let dentro = 0;
    let maximo = 0;
    const trabalho = (chave: string) =>
      trava.comTrava(chave, async () => {
        dentro++;
        maximo = Math.max(maximo, dentro);
        await new Promise((r) => setTimeout(r, 5));
        dentro--;
      });
    await Promise.all(Array.from({ length: 8 }, () => trabalho('conversa-1')));
    expect(maximo).toBe(1);
    // e um erro dentro da trava não a deixa presa
    await expect(trava.comTrava('conversa-1', async () => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');
    await expect(trava.comTrava('conversa-1', async () => 'ok')).resolves.toBe('ok');
  });
});

describe.runIf(temPostgres)('Trava entre processos (postgres)', () => {
  it('dois servidores diferentes não pensam a mesma conversa ao mesmo tempo', async () => {
    const pool = await poolDeTeste();
    const servidorA = new TravaPostgres(pool);
    const servidorB = new TravaPostgres(pool);
    let dentro = 0;
    let maximo = 0;
    const trabalho = (t: Trava) =>
      t.comTrava('conversa-x', async () => {
        dentro++;
        maximo = Math.max(maximo, dentro);
        await new Promise((r) => setTimeout(r, 10));
        dentro--;
      });
    await Promise.all([trabalho(servidorA), trabalho(servidorB), trabalho(servidorA), trabalho(servidorB)]);
    expect(maximo).toBe(1);
    // conversas diferentes seguem em paralelo
    dentro = 0;
    maximo = 0;
    const outra = (t: Trava, chave: string) =>
      t.comTrava(chave, async () => {
        dentro++;
        maximo = Math.max(maximo, dentro);
        await new Promise((r) => setTimeout(r, 20));
        dentro--;
      });
    await Promise.all([outra(servidorA, 'c1'), outra(servidorB, 'c2')]);
    expect(maximo).toBe(2);
  });
});

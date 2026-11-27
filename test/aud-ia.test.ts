import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { AVISO_ENVIO_INCERTO, ESPERA_ECO_INCERTO_MS, Sintonia, textoDoEco } from '../src/app/sintonia.js';
import { ErroEnvioWhatsApp } from '../src/channels/evolution.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { bahia, MIN } from '../src/util/tempo.js';

/*
 * aud-ia: envio da IA com "tempo esgotado" (resultado incerto). Antes: o eco (fromMe) virava "a equipe respondeu
 * pelo celular" (a IA saía da conversa) e a parte incerta era reenviada ~2 min depois (a cliente recebia duas vezes).
 */

type Passo = 'ok' | 'incerto' | 'fora' | ((texto: string) => Promise<'ok' | 'incerto'>);

/** Canal falso: cada envio segue o roteiro (sem roteiro: ok). Guarda todas as tentativas. */
class CanalRoteiro implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  tentativas: string[] = [];
  roteiro: Passo[] = [];
  private n = 0;
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, _telefone: string, texto: string) {
    this.tentativas.push(texto);
    let passo = this.roteiro.shift() ?? 'ok';
    if (typeof passo === 'function') passo = await passo(texto);
    if (passo === 'incerto') throw new ErroEnvioWhatsApp('incerto', 'tempo esgotado');
    if (passo === 'fora') throw new ErroEnvioWhatsApp('desconectado');
    return { idExterno: `OUT-${++this.n}` };
  }
}

const TEL = '5571988124471';
let seq = 0;
const msg = (texto: string, em: Date, extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  canalId: 'imperio-norte',
  telefone: TEL,
  nome: 'Marina',
  texto,
  deMim: false,
  idExterno: `aud-${++seq}`,
  em,
  ...extra,
});
/** Eco do WhatsApp: hora em segundos cortados (sem milissegundos). */
const eco = (texto: string, em: Date, id = `ECO-${++seq}`) => msg(texto, new Date(Math.floor(em.getTime() / 1000) * 1000), { deMim: true, idExterno: id });
/** 02h: fora do horário, a IA responde sozinha. Com milissegundos, como o relógio de verdade. */
const madrugada = (m = 0) => new Date(bahia(2026, 11, 5, 2, m).getTime() + 5_300);

function montar(respostas: string[]) {
  const repo = new RepositorioMemoria();
  const canal = new CanalRoteiro();
  const relogio = { t: madrugada() };
  const pedidos: PedidoAgente[] = [];
  const s = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: {
      executar: async (p: PedidoAgente): Promise<RespostaAgente> => {
        pedidos.push(p);
        return { texto: respostas.shift() ?? 'Mais alguma coisa?', acoes: [], recusou: false };
      },
    },
    agora: () => relogio.t,
  });
  const conversa = async () => (await repo.listarConversas())[0]!;
  const mensagens = async () => repo.mensagens((await conversa()).id);
  /** Avança o relógio e roda o relógio da Sintonia (reavaliações e envios sem confirmação). */
  const passar = async (ms: number) => {
    relogio.t = new Date(relogio.t.getTime() + ms);
    await s.tick();
  };
  return { repo, canal, relogio, s, pedidos, conversa, mensagens, passar };
}

describe('aud-ia: envio da IA com "tempo esgotado"', () => {
  it('o eco chega: uma mensagem só, da IA; a IA continua na conversa e nada é reenviado', async () => {
    const m = montar(['Oi, Marina! Temos horário amanhã às 10h.', 'Pode ser às 10h então.']);
    m.canal.roteiro = ['incerto'];
    await m.s.receber(msg('oi, tem horário amanhã?', m.relogio.t));
    const antes = await m.conversa();
    expect(m.canal.tentativas).toHaveLength(1);
    expect(antes.ultimaMensagemIa).toBeDefined(); // conta como respondida: a IA não pensa de novo

    // O eco vem em segundos cortados (antes do horário com milissegundos do envio): mesmo assim é reconhecido.
    await m.s.receber(eco('Oi, Marina! Temos horário amanhã às 10h.', m.relogio.t, 'WA-1'));
    const ms = await m.mensagens();
    expect(ms.map((x) => [x.autor, x.texto])).toEqual([
      ['cliente', 'oi, tem horário amanhã?'],
      ['ia', 'Oi, Marina! Temos horário amanhã às 10h.'],
    ]);
    expect(ms[1]!.idExterno).toBe('WA-1');
    const c = await m.conversa();
    expect(c.modo).toBe(antes.modo); // não virou copiloto
    expect(c.ultimaMensagemEquipe).toBeUndefined();

    // Webhook repetido do mesmo eco: não duplica.
    await m.s.receber(eco('Oi, Marina! Temos horário amanhã às 10h.', m.relogio.t, 'WA-1'));
    expect(await m.mensagens()).toHaveLength(2);

    // Passa o tempo: nada é reenviado e não fica aviso.
    for (let i = 0; i < 4; i++) await m.passar(3 * MIN);
    expect(m.canal.tentativas).toHaveLength(1);
    expect((await m.mensagens()).some((x) => x.autor === 'sistema')).toBe(false);

    // A cliente responde: a IA ainda está ligada e responde.
    await m.s.receber(msg('pode ser', m.relogio.t));
    expect(m.canal.tentativas).toEqual(['Oi, Marina! Temos horário amanhã às 10h.', 'Pode ser às 10h então.']);
    expect((await m.mensagens()).filter((x) => x.autor === 'ia')).toHaveLength(2);
  });

  it('o eco não chega: não reenvia; fica o aviso na conversa para a equipe conferir', async () => {
    const m = montar(['Oi! Posso ajudar?']);
    m.canal.roteiro = ['incerto'];
    await m.s.receber(msg('oi', m.relogio.t));
    await m.passar(2 * MIN);
    expect((await m.mensagens()).some((x) => x.autor === 'sistema')).toBe(false); // ainda esperando o eco
    await m.passar(ESPERA_ECO_INCERTO_MS);
    await m.passar(10 * MIN);
    expect(m.canal.tentativas).toEqual(['Oi! Posso ajudar?']);
    expect(m.pedidos).toHaveLength(1); // a IA não pensou de novo
    const avisos = (await m.mensagens()).filter((x) => x.autor === 'sistema');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain(AVISO_ENVIO_INCERTO);
    expect(avisos[0]!.texto).toContain('Oi! Posso ajudar?');
    expect((await m.conversa()).ultimaMensagemEquipe).toBeUndefined();
  });

  it('o eco chega antes de o envio terminar em "tempo esgotado": vale como enviada, sem aviso', async () => {
    const m = montar(['Oi! Posso ajudar?']);
    m.canal.roteiro = [async (texto) => (await m.s.receber(eco(texto, m.relogio.t, 'WA-CEDO')), 'incerto')];
    await m.s.receber(msg('oi', m.relogio.t));
    const ms = await m.mensagens();
    expect(ms.map((x) => [x.autor, x.idExterno])).toEqual([['cliente', expect.any(String)], ['ia', 'WA-CEDO']]);
    await m.passar(ESPERA_ECO_INCERTO_MS + MIN);
    expect((await m.mensagens()).some((x) => x.autor === 'sistema')).toBe(false);
    expect((await m.conversa()).ultimaMensagemEquipe).toBeUndefined();
  });

  it('resposta em partes: a parte incerta nunca é reenviada; só as que nem foram tentadas', async () => {
    const a = 'Primeiro: temos horário amanhã às 10h e às 15h com a Ana, que é especialista. '.repeat(8).trim();
    const b = 'Segundo: o valor da escova é R$ 80 e dá para pagar no Pix ou no cartão, sem taxa nenhuma. '.repeat(3).trim();
    const m = montar([`${a}\n\n${b}`]);
    m.canal.roteiro = ['incerto'];
    await m.s.receber(msg('quero marcar', m.relogio.t));
    // Parou na parte A (o WhatsApp está demorando): a B nem foi tentada e espera o reenvio.
    expect(m.canal.tentativas).toEqual([a]);
    // A parte A pode ter saído: o eco chega depois.
    await m.s.receber(eco(a, m.relogio.t, 'WA-A'));
    await m.passar(2 * MIN + 1000);
    expect(m.canal.tentativas).toEqual([a, b]);
    await m.passar(10 * MIN);
    expect(m.canal.tentativas).toEqual([a, b]);
    await m.passar(ESPERA_ECO_INCERTO_MS);
    const ms = await m.mensagens();
    expect(ms.filter((x) => x.autor === 'ia').map((x) => x.texto)).toEqual([a, b]);
    expect(ms.some((x) => x.autor === 'sistema' || x.autor === 'equipe')).toBe(false);
    expect(m.pedidos).toHaveLength(1);
  });

  it('envio normal continua igual: o eco é ignorado e a IA segue na conversa', async () => {
    const m = montar(['Oi! Posso ajudar?']);
    await m.s.receber(msg('oi', m.relogio.t));
    const antes = await m.conversa();
    await m.s.receber(eco('Oi! Posso ajudar?', m.relogio.t, 'OUT-1'));
    expect((await m.mensagens()).map((x) => x.autor)).toEqual(['cliente', 'ia']);
    expect((await m.conversa()).modo).toBe(antes.modo);
    await m.passar(ESPERA_ECO_INCERTO_MS + MIN);
    expect((await m.mensagens()).some((x) => x.autor === 'sistema')).toBe(false);
  });

  it('mensagem igual digitada no celular muito depois não é confundida com o eco', async () => {
    const m = montar(['Oi! Posso ajudar?']);
    m.canal.roteiro = ['incerto'];
    await m.s.receber(msg('oi', m.relogio.t));
    await m.passar(ESPERA_ECO_INCERTO_MS + MIN); // aviso: não sabemos se chegou
    await m.s.receber(eco('Oi! Posso ajudar?', m.relogio.t, 'CEL-1'));
    const ms = await m.mensagens();
    expect(ms.filter((x) => x.autor === 'equipe').map((x) => x.texto)).toEqual(['Oi! Posso ajudar?']);
  });

  it('o texto do eco é comparado sem diferença de espaços, quebras e invisíveis', () => {
    expect(textoDoEco(' Oi,​  tudo\n\nbem? ')).toBe(textoDoEco('Oi, tudo bem?'));
  });
});

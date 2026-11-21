import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { Midias } from '../src/app/midias.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { EvolutionAdmin } from '../src/channels/evolution-admin.js';
import { CanalEvolution, lerWebhookEvolution } from '../src/channels/evolution.js';
import { HISTORICO_MIDIA } from '../src/midia.js';
import { registrarResgate } from '../src/resgate/resgate.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { fabricas } from './repos.js';

/**
 * atendimento-extra: o histórico e o "Resgatar mensagens" trazem fotos, áudios, vídeos, documentos e figurinhas.
 * Evolution falsa: o findMessages devolve os registros como a Evolution v2 guarda, e o getBase64FromMediaMessage
 * devolve o arquivo (o mesmo caminho do webhook).
 */

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 9, 9]);
const OGG = Buffer.from('OggS\0\x02audio-do-historico');
const AGORA = new Date('2026-11-21T15:00:00Z');
const seg = (d: Date) => Math.floor(d.getTime() / 1000);
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86400_000);

/** Registro do findMessages da Evolution v2. */
function registro(id: string, message: Record<string, unknown>, em: Date, fromMe = false) {
  return {
    id: `cuid-${id}`,
    key: { id, fromMe, remoteJid: '5571988124471@s.whatsapp.net' },
    pushName: 'Marina Souza',
    messageType: Object.keys(message)[0],
    message,
    messageTimestamp: seg(em),
    instanceId: 'inst-1',
    source: 'android',
  };
}
const foto = (legenda?: string, fileLength = '183442') => ({ imageMessage: { url: 'https://mmg.whatsapp.net/x', mimetype: 'image/jpeg', fileLength, mediaKey: 'a2V5', ...(legenda ? { caption: legenda } : {}) } });
const audio = () => ({ audioMessage: { url: 'https://mmg.whatsapp.net/a', mimetype: 'audio/ogg; codecs=opus', fileLength: '19534', seconds: 7, ptt: true, mediaKey: 'a2V5' } });
const documento = () => ({ documentMessage: { url: 'https://mmg.whatsapp.net/d', mimetype: 'application/pdf', fileName: 'orcamento.pdf', fileLength: '88123', mediaKey: 'a2V5' } });
const figurinha = () => ({ stickerMessage: { url: 'https://mmg.whatsapp.net/s', mimetype: 'image/webp', fileLength: '12440' } });
const texto = (t: string) => ({ conversation: t });

/** Evolution falsa: o baixador pede pelo getBase64FromMediaMessage. */
function evolucaoFalsa(arquivos: Record<string, { conteudo: Buffer; mimetype: string }>) {
  const pedidos: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body ?? '{}')) as { message?: { key?: { id?: string } } };
    const id = corpo.message?.key?.id ?? '';
    pedidos.push(`${String(url).replace('https://evo.exemplo/', '')}#${id}`);
    const a = arquivos[id];
    if (!a) return new Response('{"message":"Message not found"}', { status: 400 });
    return new Response(JSON.stringify({ base64: a.conteudo.toString('base64'), mimetype: a.mimetype }));
  }) as typeof fetch;
  return { canal: new CanalEvolution('https://evo.exemplo/', 'chave', f), pedidos };
}

function montar(repo: Repositorio, arquivos: Record<string, { conteudo: Buffer; mimetype: string }> = {}) {
  const { canal, pedidos } = evolucaoFalsa(arquivos);
  const midias = new Midias(repo, () => canal, () => AGORA);
  const pedidosIa: string[] = [];
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'sintonia-norte', unidade: 'norte', canal }],
    agente: { executar: async (p) => { pedidosIa.push(p.mensagens.at(-1)!.texto); return { texto: 'oi', acoes: [], recusou: false }; } },
    agora: () => AGORA,
    midias,
  });
  return { sintonia, midias, pedidos, pedidosIa };
}

const importar = (s: Sintonia, regs: unknown[]) => s.importarHistorico(lerWebhookEvolution({ event: 'messages.upsert', instance: 'sintonia-norte', data: regs }));

async function mensagensDa(repo: Repositorio) {
  const [c] = await repo.listarConversas();
  if (!c) throw new Error('sem conversa');
  return { c, msgs: await repo.mensagens(c.id, 100) };
}

describe.each(fabricas)('Histórico com mídia ($nome)', (f) => {
  it('foto, áudio, documento e figurinha do histórico entram com o anexo e são baixados por trás (sem IA)', async () => {
    const repo = await f.criar();
    const { sintonia, midias, pedidos, pedidosIa } = montar(repo, {
      F1: { conteudo: JPG, mimetype: 'image/jpeg' },
      A1: { conteudo: OGG, mimetype: 'audio/ogg; codecs=opus' },
      D1: { conteudo: Buffer.from('%PDF-1.4 orçamento'), mimetype: 'application/pdf' },
      S1: { conteudo: Buffer.from('RIFF....WEBP'), mimetype: 'image/webp' },
    });
    const r = await importar(sintonia, [
      registro('T1', texto('oi, tudo bem?'), diasAtras(3)),
      registro('F1', foto('meu cabelo hoje'), diasAtras(3)),
      registro('A1', audio(), diasAtras(2)),
      registro('D1', documento(), diasAtras(2), true),
      registro('S1', figurinha(), diasAtras(1)),
    ]);
    expect(r).toEqual({ conversas: 1, mensagens: 5, midias: 4 });
    await midias.ocioso();
    const { msgs } = await mensagensDa(repo);
    const porTexto = Object.fromEntries(msgs.map((m) => [m.texto, m]));
    expect(porTexto['[foto] meu cabelo hoje']?.anexo).toMatchObject({ tipo: 'imagem', situacao: 'pronta', legenda: 'meu cabelo hoje', tamanho: JPG.length });
    expect(porTexto['[áudio]']?.anexo).toMatchObject({ tipo: 'audio', situacao: 'pronta', voz: true, duracaoSeg: 7 });
    expect(porTexto['[documento: orcamento.pdf]']?.anexo).toMatchObject({ tipo: 'documento', situacao: 'pronta', nomeArquivo: 'orcamento.pdf' });
    expect(porTexto['[documento: orcamento.pdf]']?.autor).toBe('equipe');
    expect(porTexto['[figurinha]']?.anexo).toMatchObject({ tipo: 'figurinha', situacao: 'pronta' });
    expect(porTexto['oi, tudo bem?']?.anexo).toBeUndefined();
    const fotoMsg = porTexto['[foto] meu cabelo hoje']!;
    expect((await repo.midia(fotoMsg.id))?.conteudo).toEqual(JPG);
    // Pelo mesmo caminho do webhook: getBase64FromMediaMessage, uma vez cada.
    expect(pedidos.sort()).toEqual(['chat/getBase64FromMediaMessage/sintonia-norte#A1', 'chat/getBase64FromMediaMessage/sintonia-norte#D1', 'chat/getBase64FromMediaMessage/sintonia-norte#F1', 'chat/getBase64FromMediaMessage/sintonia-norte#S1']);
    // Histórico: a IA não foi chamada.
    expect(pedidosIa).toEqual([]);
  });

  it('mídia com mais de 30 dias ou grande demais fica para baixar com o botão; o botão baixa', async () => {
    const repo = await f.criar();
    const { sintonia, midias, pedidos } = montar(repo, { VELHA: { conteudo: JPG, mimetype: 'image/jpeg' }, GRANDE: { conteudo: JPG, mimetype: 'image/jpeg' } });
    const r = await importar(sintonia, [
      registro('VELHA', foto('de outubro'), diasAtras(HISTORICO_MIDIA.dias + 5)),
      registro('GRANDE', foto('pesada', String(HISTORICO_MIDIA.maxBytes + 1)), diasAtras(1)),
    ]);
    expect(r.mensagens).toBe(2);
    expect(r.midias).toBe(0);
    await midias.ocioso();
    expect(pedidos).toEqual([]);
    const { msgs } = await mensagensDa(repo);
    expect(msgs.map((m) => m.anexo?.situacao)).toEqual(['falhou', 'falhou']);
    // "Baixar" na conversa: volta para a fila e o baixador pega.
    const velha = msgs.find((m) => m.texto === '[foto] de outubro')!;
    expect(await repo.rebaixarMidia(velha.id, AGORA)).toBe(true);
    midias.avisar();
    await midias.ocioso();
    expect((await repo.midia(velha.id))?.anexo.situacao).toBe('pronta');
    expect(pedidos).toEqual(['chat/getBase64FromMediaMessage/sintonia-norte#VELHA']);
  });

  it('resgate completa a mídia de mensagem que tinha entrado só como texto, sem duplicar', async () => {
    const repo = await f.criar();
    const { sintonia, midias, pedidos } = montar(repo, { F9: { conteudo: JPG, mimetype: 'image/jpeg' } });
    // Como o histórico antigo gravava: só o texto, sem anexo.
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'sintonia-norte', telefone: '5571988124471', nome: 'Marina', agora: AGORA });
    await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'cliente', texto: '[foto] olha', em: diasAtras(2), idExterno: 'F9' });
    const r = await importar(sintonia, [registro('F9', foto('olha'), diasAtras(2))]);
    expect(r).toEqual({ conversas: 0, mensagens: 0, midias: 1 });
    await midias.ocioso();
    let { msgs } = await mensagensDa(repo);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.anexo).toMatchObject({ tipo: 'imagem', situacao: 'pronta' });
    // De novo: nada muda e nada é baixado outra vez.
    expect(await importar(sintonia, [registro('F9', foto('olha'), diasAtras(2))])).toEqual({ conversas: 0, mensagens: 0, midias: 0 });
    await midias.ocioso();
    ({ msgs } = await mensagensDa(repo));
    expect(msgs).toHaveLength(1);
    expect(pedidos).toEqual(['chat/getBase64FromMediaMessage/sintonia-norte#F9']);
  });

  it('a Evolution não tem mais o arquivo: a mensagem fica, e o arquivo vai para novas tentativas (sem travar)', async () => {
    const repo = await f.criar();
    const { sintonia, midias } = montar(repo, {});
    const r = await importar(sintonia, [registro('SUMIU', audio(), diasAtras(1)), registro('T2', texto('tá aí?'), diasAtras(1))]);
    expect(r.mensagens).toBe(2);
    await midias.ocioso();
    const { msgs } = await mensagensDa(repo);
    expect(msgs.find((m) => m.texto === '[áudio]')?.anexo?.situacao).toBe('pendente');
  });

  it('muitas mídias: só as primeiras entram na fila de uma vez, as outras ficam com o botão', async () => {
    const repo = await f.criar();
    const { sintonia } = montar(repo, {});
    const limite = HISTORICO_MIDIA.maxPorVez;
    HISTORICO_MIDIA.maxPorVez = 2;
    try {
      const r = await importar(sintonia, [1, 2, 3].map((i) => registro(`M${i}`, foto(`foto ${i}`), diasAtras(1))));
      expect(r.midias).toBe(2);
      const { msgs } = await mensagensDa(repo);
      expect(msgs.map((m) => m.anexo?.situacao).sort()).toEqual(['falhou', 'pendente', 'pendente']);
    } finally {
      HISTORICO_MIDIA.maxPorVez = limite;
    }
  });

  it('POST /api/conversas/:id/resgatar traz a mídia pela Evolution falsa', async () => {
    const repo = await f.criar();
    const { sintonia, midias, pedidos } = montar(repo, { R1: { conteudo: JPG, mimetype: 'image/jpeg' } });
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'sintonia-norte', telefone: '5571988124471', nome: 'Marina', agora: AGORA });
    const admin = { mensagensDoContato: async () => [registro('R1', foto('resgatada'), diasAtras(1)), registro('R2', texto('e aí'), diasAtras(1))] } as unknown as EvolutionAdmin;
    const app = Fastify();
    registrarResgate(app, { repo, admin: () => admin, canais: () => ['sintonia-norte'], importar: (m) => sintonia.importarHistorico(m) });
    const res = await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/resgatar` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ encontradas: 2, novas: 2, midias: 1 });
    await midias.ocioso();
    const { msgs } = await mensagensDa(repo);
    expect(msgs.find((m) => m.texto === '[foto] resgatada')?.anexo?.situacao).toBe('pronta');
    expect(pedidos).toEqual(['chat/getBase64FromMediaMessage/sintonia-norte#R1']);
    await app.close();
  });
});

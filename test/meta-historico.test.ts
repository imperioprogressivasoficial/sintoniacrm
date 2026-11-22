import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalInstagram, CanalMessenger, lerConversasSocial } from '../src/channels/meta-social.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import {
  ArmazemHistoricoMetaMemoria,
  ArmazemHistoricoMetaPostgres,
  HistoricoMeta,
  SEM_PERMISSAO_HISTORICO,
  type ArmazemHistoricoMeta,
} from '../src/conexoes/historico-meta.js';
import { contaHistoricoMeta, numerosSociais } from '../src/conexoes/sociais.js';
import { criarServidor } from '../src/server.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { fabricas, poolDeTeste } from './repos.js';

/* meta-historico: conversas antigas do Instagram (Direct) e do Facebook (Messenger) ao conectar. */

const FB = 'https://graph.facebook.com/v21.0';
const IG = 'https://graph.instagram.com/v21.0';
const PAGE = '1040';
const IGID = '1784';
const DIA = 86_400_000;
const AGORA = new Date('2026-11-22T12:00:00Z');

/** "2026-11-20T14:03:11+0000", como a Graph API manda. */
const dataMeta = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '+0000');

interface Opcoes {
  /** Quantas conversas a conta tem (a i-ésima ficou parada há i dias). */
  conversas: number;
  porDia?: number;
  /** Responde erro em vez das conversas. */
  erro?: { status: number; code: number };
  /** Falha passageira nas primeiras N chamadas. */
  falhasAntes?: number;
}

/** Graph API falsa da Conversations API: paginação por cursor, 3 mensagens por conversa. Nunca vai à rede. */
function graphFalsa(rede: 'messenger' | 'instagram', o: Opcoes) {
  const pedidos: string[] = [];
  let chamadas = 0;
  const loja = rede === 'messenger' ? { id: PAGE, name: 'Império Norte' } : { id: IGID, username: 'imperio' };
  const f = (async (url: string) => {
    pedidos.push(url);
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (o.erro) return json({ error: { message: '(#10) Application does not have permission for this action', type: 'OAuthException', code: o.erro.code } }, o.erro.status);
    if (++chamadas <= (o.falhasAntes ?? 0)) return json({ error: { message: 'Please retry your request later.', code: 2 } }, 500);
    const u = new URL(url);
    const limite = Number(u.searchParams.get('limit') ?? 25);
    const inicio = Number(u.searchParams.get('after')?.replace('c', '') ?? 0);
    const data = [];
    for (let i = inicio; i < Math.min(o.conversas, inicio + limite); i++) {
      const cliente = rede === 'messenger' ? { id: `70${i}`, name: `Cliente ${i}` } : { id: `90${i}`, username: `cliente${i}` };
      const ultima = new Date(AGORA.getTime() - i * DIA * (o.porDia ?? 1) - 60_000);
      const msg = (k: number, deLoja: boolean) => ({
        id: `m_${rede}_${i}_${k}`,
        created_time: dataMeta(new Date(ultima.getTime() - k * 600_000)),
        from: deLoja ? loja : cliente,
        to: { data: [deLoja ? cliente : loja] },
        message: deLoja ? `Resposta ${k}` : `Pergunta ${k} da conversa ${i}`,
      });
      data.push({
        id: `t_${i}`,
        updated_time: dataMeta(ultima),
        participants: { data: [cliente, loja] },
        messages: { data: [msg(0, true), msg(1, false), msg(2, false)] },
      });
    }
    const fim = inicio + limite >= o.conversas;
    return json({
      data,
      paging: { cursors: { before: `c${inicio}`, after: `c${inicio + data.length}` }, ...(fim ? {} : { next: `${u.origin}${u.pathname}?after=c${inicio + data.length}` }) },
    });
  }) as typeof fetch;
  return { f, pedidos };
}

async function conexoesCom(valores: Record<string, string>) {
  const c = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await c.carregar();
  await c.salvar(valores, 'teste');
  return c;
}
const COMPLETO = {
  messengerLigado: '1', messengerUnidade: 'sumare', messengerPageId: PAGE, messengerToken: 'EAAPAGE', messengerAppSecret: 'seg-fb',
  instagramLigado: '1', instagramAccountId: IGID, instagramToken: 'IGAATOKEN', instagramAppSecret: 'seg-ig',
};

const armazens: Array<{ nome: string; criar(): Promise<{ repo: Repositorio; armazem: ArmazemHistoricoMeta }> }> = fabricas.map((fx) => ({
  nome: fx.nome,
  criar: async () => {
    const repo = await fx.criar();
    if (fx.nome !== 'postgres') return { repo, armazem: new ArmazemHistoricoMetaMemoria() };
    const pool = await poolDeTeste();
    await pool.query('delete from sintonia.meta_historico');
    return { repo, armazem: new ArmazemHistoricoMetaPostgres(pool) };
  },
}));

async function montar(rede: 'messenger' | 'instagram', o: Opcoes, base?: { repo: Repositorio; armazem: ArmazemHistoricoMeta }, extra: { importar?: (s: Sintonia) => Sintonia['importarHistorico'] } = {}) {
  const conexoes = await conexoesCom(COMPLETO);
  const g = graphFalsa(rede, o);
  const { repo, armazem } = base ?? { repo: await fabricas[0]!.criar(), armazem: new ArmazemHistoricoMetaMemoria() };
  const numeros = numerosSociais(conexoes, new Map(), (conta) => (conta.rede === 'messenger' ? new CanalMessenger(conta, g.f) : new CanalInstagram(conta, g.f)));
  let iaChamada = 0;
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente: { executar: async () => (iaChamada++, { texto: 'Oi!', acoes: [], recusou: false }) }, agora: () => AGORA });
  const importar = extra.importar?.(sintonia) ?? ((m) => sintonia.importarHistorico(m));
  const historico = new HistoricoMeta({ armazem, conta: (r) => contaHistoricoMeta(conexoes, r, g.f), importar, agora: () => AGORA, esperaFalhaMs: 1, limites: { porPagina: 10, conversas: 300 } });
  const app = criarServidor({ sintonia, repo, conexoes: { conexoes, testarIA: async () => {}, testarTrinks: async () => ({ resumo: '' }), fetchFn: g.f, historicoMeta: historico } });
  return { app, g, repo, armazem, historico, sintonia, ia: () => iaChamada };
}

async function contar(repo: Repositorio) {
  const conversas = await repo.listarConversas();
  let mensagens = 0;
  for (const c of conversas) mensagens += (await repo.mensagens(c.id, 1000)).length;
  return { conversas: conversas.length, mensagens };
}

describe('Leitura das conversas antigas na Graph API', () => {
  it('Messenger: cliente pelo participante, mensagens da Página = deMim, anexo e cursor da próxima página', () => {
    const corpo = {
      data: [{
        id: 't_1', updated_time: '2026-11-20T14:03:11+0000',
        participants: { data: [{ id: '7001', name: 'Marina Souza' }, { id: PAGE, name: 'Império' }] },
        messages: { data: [
          { id: 'm_2', created_time: '2026-11-20T14:03:11+0000', from: { id: PAGE }, message: 'Temos sim!' },
          { id: 'm_1', created_time: '2026-11-20T14:00:00+0000', from: { id: '7001', name: 'Marina Souza' }, message: '', attachments: { data: [{ mime_type: 'image/jpeg', name: 'f.jpg', size: 2048, image_data: { url: 'https://cdn.fb/f.jpg' } }] } },
        ] },
      }],
      paging: { cursors: { after: 'QVFI' }, next: 'https://graph.facebook.com/v21.0/1040/conversations?after=QVFI' },
    };
    const p = lerConversasSocial(corpo, 'facebook', `fb-${PAGE}`, [PAGE]);
    expect(p.proximo).toBe('QVFI');
    expect(p.conversas).toHaveLength(1);
    const c = p.conversas[0]!;
    expect(c).toMatchObject({ id: 't_1', telefone: 'fb:7001', atualizada: new Date('2026-11-20T14:03:11Z') });
    expect(c.mensagens.map((m) => [m.idExterno, m.deMim, m.texto, m.nome])).toEqual([
      ['m_2', true, 'Temos sim!', undefined],
      ['m_1', false, '[foto]', 'Marina Souza'],
    ]);
    expect(c.mensagens[1]!.anexo).toMatchObject({ tipo: 'imagem', ref: 'https://cdn.fb/f.jpg', mimetype: 'image/jpeg', tamanho: 2048 });
    expect(c.mensagens[1]).toMatchObject({ canalId: `fb-${PAGE}`, rede: 'facebook' });
    // Última página: sem "next", sem cursor.
    expect(lerConversasSocial({ data: [], paging: { cursors: { after: 'X' } } }, 'facebook', `fb-${PAGE}`, [PAGE]).proximo).toBeUndefined();
  });

  it('Instagram: cliente pelo usuário (@), sem participantes usa quem escreveu; compartilhamento vira texto', () => {
    const corpo = { data: [{ id: 't_9', updated_time: '2026-11-21T10:00:00+0000', messages: { data: [
      { id: 'ig_2', created_time: '2026-11-21T10:00:00+0000', from: { id: IGID, username: 'imperio' }, to: { data: [{ id: '9001', username: 'analima' }] }, message: 'Oi Ana' },
      { id: 'ig_1', created_time: '2026-11-21T09:59:00+0000', from: { id: '9001', username: 'analima' }, to: { data: [{ id: IGID }] }, shares: { data: [{ link: 'https://instagram.com/p/x' }] } },
    ] } }] };
    const [c] = lerConversasSocial(corpo, 'instagram', `ig-${IGID}`, [IGID]).conversas;
    expect(c!.telefone).toBe('ig:9001');
    expect(c!.mensagens.map((m) => [m.deMim, m.texto, m.nome])).toEqual([[true, 'Oi Ana', undefined], [false, '[publicação compartilhada] https://instagram.com/p/x', '@analima']]);
  });

  it('pede /{page}/conversations (Messenger) e /me/conversations (Instagram), com platform, campos e 20 mensagens', async () => {
    const g = graphFalsa('messenger', { conversas: 0 });
    await new CanalMessenger({ contaId: PAGE, token: 'EAAP' }, g.f).listarConversas({ porPagina: 25, mensagens: 50, depois: 'QVFI' });
    await new CanalInstagram({ contaId: IGID, token: 'IGAAT' }, g.f).listarConversas({ porPagina: 25, mensagens: 20 });
    await new CanalInstagram({ contaId: IGID, token: 'EAAP', pageId: PAGE }, g.f).listarConversas({ porPagina: 25, mensagens: 20 });
    const [fb, ig, igPagina] = g.pedidos.map((u) => new URL(u));
    expect(`${fb!.origin}${fb!.pathname}`).toBe(`${FB}/${PAGE}/conversations`);
    expect(fb!.searchParams.get('platform')).toBe('messenger');
    expect(fb!.searchParams.get('after')).toBe('QVFI');
    expect(fb!.searchParams.get('fields')).toMatch(/^participants,updated_time,messages\.limit\(20\)\{id,created_time,from,to,message,attachments/);
    expect(`${ig!.origin}${ig!.pathname}`).toBe(`${IG}/me/conversations`);
    expect(ig!.searchParams.get('platform')).toBe('instagram');
    expect(`${igPagina!.origin}${igPagina!.pathname}`).toBe(`${FB}/${PAGE}/conversations`);
  });
});

describe('Trazer as conversas antigas ao conectar', () => {
  it.each(armazens)('Messenger: lê página por página e grava como histórico, sem IA nem avisos ($nome)', async (fx) => {
    const m = await montar('messenger', { conversas: 23 }, await fx.criar());
    const r = await m.app.inject({ method: 'POST', url: '/api/conexoes/sociais/messenger/historico' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ situacao: 'rodando', limite: 300, dias: 90 });
    await m.historico.ocioso();
    const a = (await m.app.inject({ url: '/api/conexoes/sociais/messenger/historico' })).json();
    expect(a).toMatchObject({ disponivel: true, situacao: 'pronto', lidas: 23, conversas: 23, mensagens: 69, paginas: 3, erro: null });
    // Três páginas de 10: a 2ª e a 3ª com o cursor da anterior.
    expect(m.g.pedidos.map((u) => new URL(u).searchParams.get('after'))).toEqual([null, 'c10', 'c20']);
    expect(await contar(m.repo)).toEqual({ conversas: 23, mensagens: 69 });
    const conv = (await m.repo.listarConversas()).find((c) => c.telefone === 'fb:705')!;
    expect(conv).toMatchObject({ canalId: `fb-${PAGE}`, unidade: 'sumare', nome: 'Cliente 5' });
    const msgs = await m.repo.mensagens(conv.id, 100);
    expect(msgs.map((x) => [x.autor, x.texto])).toEqual([['cliente', 'Pergunta 2 da conversa 5'], ['cliente', 'Pergunta 1 da conversa 5'], ['equipe', 'Resposta 0']]);
    // Nada de IA, automação ou aviso: é só histórico.
    expect(m.ia()).toBe(0);
    expect(conv.ultimaMensagemCliente?.getTime()).toBe(AGORA.getTime() - 5 * DIA - 60_000 - 600_000);
  });

  it.each(armazens)('Instagram: para nas conversas paradas há mais de 90 dias e no limite de conversas ($nome)', async (fx) => {
    // 40 conversas, uma a cada 3 dias: só as 30 dos últimos 90 dias entram.
    const m = await montar('instagram', { conversas: 40, porDia: 3 }, await fx.criar());
    await m.app.inject({ method: 'POST', url: '/api/conexoes/sociais/instagram/historico' });
    await m.historico.ocioso();
    expect((await m.app.inject({ url: '/api/conexoes/sociais/instagram/historico' })).json()).toMatchObject({ situacao: 'pronto', lidas: 30, conversas: 30 });
    expect(m.g.pedidos).toHaveLength(4);
    expect(new URL(m.g.pedidos[0]!).pathname).toBe('/v21.0/me/conversations');
    const conversas = await m.repo.listarConversas();
    expect(conversas).toHaveLength(30);
    expect(conversas.every((c) => c.telefone.startsWith('ig:') && c.canalId === `ig-${IGID}`)).toBe(true);
    expect(conversas.find((c) => c.telefone === 'ig:903')!.nome).toBe('@cliente3');

    // Limite de conversas (aqui 12, em lotes de 10).
    const fx2 = await fx.criar();
    const conexoes = await conexoesCom(COMPLETO);
    const g = graphFalsa('messenger', { conversas: 50 });
    const numeros = numerosSociais(conexoes, new Map(), (conta) => new CanalMessenger(conta, g.f));
    const s = new Sintonia({ empresaId: 'imperio', repo: fx2.repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora: () => AGORA });
    const h = new HistoricoMeta({ armazem: fx2.armazem, conta: (r) => contaHistoricoMeta(conexoes, r, g.f), importar: (x) => s.importarHistorico(x), agora: () => AGORA, limites: { porPagina: 10, conversas: 12 } });
    await h.iniciar('messenger');
    await h.ocioso();
    expect(await h.situacao('messenger')).toMatchObject({ situacao: 'pronto', lidas: 12, conversas: 12 });
    expect(g.pedidos).toHaveLength(2);
  });

  it.each(armazens)('conectar de novo não duplica: as que já estavam ficam como estão ($nome)', async (fx) => {
    const m = await montar('messenger', { conversas: 15 }, await fx.criar());
    await m.app.inject({ method: 'POST', url: '/api/conexoes/sociais/messenger/historico' });
    await m.historico.ocioso();
    const antes = await contar(m.repo);
    expect(antes).toEqual({ conversas: 15, mensagens: 45 });
    await m.app.inject({ method: 'POST', url: '/api/conexoes/sociais/messenger/historico' });
    await m.historico.ocioso();
    expect((await m.app.inject({ url: '/api/conexoes/sociais/messenger/historico' })).json()).toMatchObject({ situacao: 'pronto', lidas: 15, conversas: 0, mensagens: 0 });
    expect(await contar(m.repo)).toEqual(antes);
  });

  it.each(armazens)('o app reinicia no meio: continua do cursor guardado, sem perder nem duplicar ($nome)', async (fx) => {
    const base = await fx.criar();
    // 1º processo: grava a 1ª página e "cai" no meio da 2ª.
    let paginas = 0;
    let caiu: HistoricoMeta | undefined;
    const m1 = await montar('messenger', { conversas: 27 }, base, {
      importar: (s) => async (msgs) => {
        if (++paginas === 2) {
          await s.importarHistorico(msgs.slice(0, 7));
          void caiu!.encerrar();
          throw new Error('processo caiu');
        }
        return s.importarHistorico(msgs);
      },
    });
    caiu = m1.historico;
    await m1.historico.iniciar('messenger');
    await m1.historico.ocioso();
    expect(await base.armazem.ler('messenger')).toMatchObject({ situacao: 'rodando', cursor: 'c10', lidas: 10, paginas: 1 });

    // 2º processo, depois de subir: continua sozinho de onde parou (a 2ª página é lida de novo).
    const m2 = await montar('messenger', { conversas: 27 }, base);
    await m2.historico.continuar();
    await m2.historico.ocioso();
    expect(m2.g.pedidos.map((u) => new URL(u).searchParams.get('after'))).toEqual(['c10', 'c20']);
    expect(await m2.historico.situacao('messenger')).toMatchObject({ situacao: 'pronto', lidas: 27 });
    expect(await contar(base.repo)).toEqual({ conversas: 27, mensagens: 81 });
  });

  it('falha passageira da Meta: tenta de novo e termina', async () => {
    const m = await montar('messenger', { conversas: 5, falhasAntes: 2 });
    await m.historico.iniciar('messenger');
    await m.historico.ocioso();
    expect(await m.historico.situacao('messenger')).toMatchObject({ situacao: 'pronto', conversas: 5 });
    expect(m.g.pedidos).toHaveLength(3);
  });

  it.each([
    { rede: 'messenger' as const, status: 403, code: 10 },
    { rede: 'instagram' as const, status: 400, code: 200 },
    { rede: 'messenger' as const, status: 400, code: 230 },
  ])('sem permissão ($rede, código $code): para com a mensagem clara, sem tentar de novo', async ({ rede, status, code }) => {
    const m = await montar(rede, { conversas: 5, erro: { status, code } });
    await m.app.inject({ method: 'POST', url: `/api/conexoes/sociais/${rede}/historico` });
    await m.historico.ocioso();
    const a = (await m.app.inject({ url: `/api/conexoes/sociais/${rede}/historico` })).json();
    expect(a).toMatchObject({ situacao: 'erro', conversas: 0, erro: SEM_PERMISSAO_HISTORICO });
    expect(a.erro).toMatch(/a Meta não deu permissão para ler as conversas antigas/i);
    expect(m.g.pedidos).toHaveLength(1);
    expect(await contar(m.repo)).toEqual({ conversas: 0, mensagens: 0 });
  });

  it('token vencido tem a sua própria explicação; TikTok e conta desligada são recusados', async () => {
    const m = await montar('instagram', { conversas: 1, erro: { status: 401, code: 190 } });
    await m.historico.iniciar('instagram');
    await m.historico.ocioso();
    expect((await m.historico.situacao('instagram'))!.erro).toMatch(/token da conta venceu/);
    expect((await m.app.inject({ method: 'POST', url: '/api/conexoes/sociais/tiktok/historico' })).statusCode).toBe(400);

    const conexoes = await conexoesCom({ messengerLigado: '0', messengerPageId: PAGE, messengerToken: 'EAAP' });
    const h = new HistoricoMeta({ armazem: new ArmazemHistoricoMetaMemoria(), conta: (r) => contaHistoricoMeta(conexoes, r), importar: async () => ({ conversas: 0, mensagens: 0 }) });
    await expect(h.iniciar('messenger')).rejects.toThrow(/Ligue o Facebook Messenger/);
    // Antes de começar: "parado".
    expect((await m.app.inject({ url: '/api/conexoes/sociais/messenger/historico' })).json()).toMatchObject({ disponivel: true, situacao: 'parado', conversas: 0 });
  });
});

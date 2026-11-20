import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemRastreioMemoria, ArmazemRastreioPostgres, type ArmazemRastreio, type Origem } from '../src/rastreio/armazem.js';
import { Capi } from '../src/rastreio/capi.js';
import { chaveCriativo, FonteCriativosMemoria, FonteCriativosPostgres, janelaCriativos, resumirCriativos, valorDaVenda, type FonteCriativos, type LeadCriativo } from '../src/rastreio/criativos.js';
import { explicarErroMeta, lerInsights, numeroDaConta } from '../src/rastreio/meta-ads.js';
import { Rastreio } from '../src/rastreio/rastreio.js';
import { configCapiDe, registrarRastreio } from '../src/rastreio/rotas.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const DIA = bahia(2026, 11, 10, 10);
const anuncio = (adId: string, extra: Partial<Origem> = {}): Origem => ({
  canal: 'anuncio_meta', origemPor: 'automatico', em: DIA, adId, anuncioTitulo: `Título ${adId}`, anuncioMiniatura: `https://cdn.exemplo/${adId}.jpg`, fonte: 'instagram',
  campaignId: 'c1', campaignNome: 'Progressiva Nov', ...extra,
});
const lead = (id: string, origem: Origem, extra: Partial<LeadCriativo> = {}): LeadCriativo => ({
  conversaId: id, unidade: 'norte', origem, agendamentos: [], etapaAgendou: false, compareceu: false, ganho: false, valorCartao: null, ...extra,
});

describe('Central de criativos: cálculo por criativo', () => {
  it('junta por anúncio: leads, quem agendou, vendas e R$ (cartão > agendamento > tabela > padrão)', () => {
    const leads = [
      lead('a', anuncio('111'), { agendamentos: [{ valor: 300, servico: 'Progressiva', compareceu: true }], compareceu: true }),
      lead('b', anuncio('111'), { etapaAgendou: true }),
      lead('c', anuncio('111')),
      lead('d', anuncio('222'), { compareceu: true, valorCartao: 900, agendamentos: [{ valor: 100, servico: null, compareceu: true }] }),
      lead('e', anuncio('222'), { compareceu: true, agendamentos: [{ valor: null, servico: 'Botox', compareceu: true }] }),
      lead('f', anuncio('333'), { ganho: true }), // ganho no funil, sem valor nenhum
    ];
    const r = resumirCriativos(leads, { precos: [{ servico: 'botox', valor: 150 }] });
    const por = Object.fromEntries(r.criativos.map((c) => [c.adId, c]));
    expect(por['111']).toMatchObject({ leads: 3, agendaram: 2, vendas: 1, valor: 300, titulo: 'Título 111', imagem: 'https://cdn.exemplo/111.jpg', rede: 'instagram', campanha: { chave: 'id:c1', nome: 'Progressiva Nov' } });
    expect(por['222']).toMatchObject({ leads: 2, agendaram: 2, vendas: 2, valor: 1050 });
    expect(por['333']).toMatchObject({ leads: 1, vendas: 1, valor: 0, vendasSemValor: 1 });
    // Sem conta de anúncios: nada de gasto nem custo.
    expect(por['111']!.gasto).toBeNull();
    expect(por['111']!.custoLead).toBeNull();
    expect(r.totais).toMatchObject({ leads: 6, agendaram: 5, vendas: 4, valor: 1350, gasto: null });
    // Ordem padrão: quem vendeu mais (R$) primeiro.
    expect(r.criativos.map((c) => c.adId)).toEqual(['222', '111', '333']);
    expect(resumirCriativos(leads, { ordem: 'leads' }).criativos[0]!.adId).toBe('111');
    // Valor padrão das Conexões entra quando a venda não tem valor.
    expect(resumirCriativos(leads, { valorPadrao: 250 }).criativos.find((c) => c.adId === '333')).toMatchObject({ valor: 250, vendasSemValor: 0 });
  });

  it('valor da venda: cartão, depois os agendamentos que compareceram, depois todos', () => {
    expect(valorDaVenda(lead('x', anuncio('1'), { valorCartao: 80, agendamentos: [{ valor: 10, servico: null, compareceu: true }] }), [])).toBe(80);
    expect(valorDaVenda(lead('x', anuncio('1'), { agendamentos: [{ valor: 10, servico: null, compareceu: true }, { valor: 99, servico: null, compareceu: false }] }), [])).toBe(10);
    expect(valorDaVenda(lead('x', anuncio('1'), { agendamentos: [{ valor: 40, servico: null, compareceu: false }] }), [])).toBe(40);
    expect(valorDaVenda(lead('x', anuncio('1')), [], undefined)).toBeNull();
  });

  it('chave: anúncio sem id usa o título; link só com utm_content; orgânico não é criativo', () => {
    expect(chaveCriativo(anuncio('123'))).toBe('ad:123');
    const semId = chaveCriativo({ ...anuncio(''), adId: undefined });
    expect(semId).toMatch(/^t:/);
    expect(chaveCriativo({ canal: 'link', origemPor: 'automatico', em: DIA, utmCampaign: 'Black', utmContent: 'Vídeo Antes' })).toBe('utm:black|video antes');
    expect(chaveCriativo({ canal: 'link', origemPor: 'automatico', em: DIA })).toBeUndefined();
    expect(chaveCriativo({ canal: 'organico', origemPor: 'automatico', em: DIA, fonte: 'instagram' })).toBeUndefined();
  });

  it('com a conta de anúncios: gasto, CTR, custo por lead/venda, retorno; anúncio que só gastou também aparece', () => {
    const leads = [
      lead('a', anuncio('111'), { compareceu: true, valorCartao: 500 }),
      lead('b', anuncio('111')),
      lead('c', { canal: 'link', origemPor: 'automatico', em: DIA, utmCampaign: 'Black', utmContent: 'Video Antes' }, { etapaAgendou: true }),
    ];
    const insights = [
      { adId: '111', adNome: 'Antes e depois', campanhaId: 'c1', campanhaNome: 'Progressiva Nov', gasto: 100, impressoes: 10000, cliques: 250 },
      { adId: '999', adNome: 'Carrossel', campanhaId: 'c2', campanhaNome: 'Botox', gasto: 80, impressoes: 4000, cliques: 20, miniatura: 'https://cdn/999.jpg' },
      { adId: '555', adNome: 'Video Antes', campanhaId: 'c3', campanhaNome: 'Black', gasto: 30, impressoes: 1000, cliques: 30 },
      { adId: '000', adNome: 'Pausado', gasto: 0, impressoes: 0, cliques: 0 },
    ];
    const r = resumirCriativos(leads, { insights, ordem: 'gasto' });
    const a = r.criativos.find((c) => c.adId === '111')!;
    expect(a).toMatchObject({ leads: 2, vendas: 1, valor: 500, gasto: 100, impressoes: 10000, cliques: 250, ctr: 2.5, custoLead: 50, custoVenda: 100, retorno: 5 });
    const so = r.criativos.find((c) => c.adId === '999')!;
    expect(so).toMatchObject({ leads: 0, gasto: 80, custoLead: null, titulo: 'Carrossel', imagem: 'https://cdn/999.jpg', campanha: { chave: 'id:c2', nome: 'Botox' } });
    // Link com utm_content = nome do anúncio recebe o gasto daquele anúncio.
    const link = r.criativos.find((c) => c.tipo === 'link')!;
    expect(link).toMatchObject({ leads: 1, agendaram: 1, gasto: 30, custoLead: 30, campanha: { chave: 'id:c3' } });
    // Anúncio sem gasto e sem lead não aparece.
    expect(r.criativos.some((c) => c.adId === '000')).toBe(false);
    expect(r.criativos.map((c) => c.adId ?? c.tipo)).toEqual(['111', '999', 'link']);
    expect(r.totais).toMatchObject({ gasto: 210, leads: 3, custoLead: 70, vendas: 1, custoVenda: 210 });
    // Custo: mais barato primeiro; sem lead vai para o fim.
    expect(resumirCriativos(leads, { insights, ordem: 'custo' }).criativos.map((c) => c.adId ?? c.tipo)).toEqual(['link', '111', '999']);
  });

  it('filtros de unidade e campanha (e a lista de campanhas para o filtro)', () => {
    const leads = [
      lead('a', anuncio('111')),
      lead('b', anuncio('111'), { unidade: 'sumare' }),
      lead('c', anuncio('222', { campaignId: 'c9', campaignNome: 'Botox' }), { unidade: 'sumare' }),
    ];
    const insights = [{ adId: '777', campanhaId: 'c7', campanhaNome: 'Só gasto', gasto: 50, impressoes: 1, cliques: 0 }];
    const tudo = resumirCriativos(leads, { insights });
    expect(tudo.campanhas.map((c) => c.nome)).toEqual(['Botox', 'Progressiva Nov', 'Só gasto']);
    expect(tudo.unidades).toEqual(['norte', 'sumare']);
    const sumare = resumirCriativos(leads, { unidade: 'sumare', insights });
    expect(sumare.criativos.map((c) => [c.adId, c.leads])).toEqual([['111', 1], ['222', 1]]);
    // Com filtro de unidade, anúncio só com gasto (da conta inteira) não entra.
    expect(sumare.criativos.some((c) => c.adId === '777')).toBe(false);
    const botox = resumirCriativos(leads, { campanha: 'id:c9', insights });
    expect(botox.criativos.map((c) => c.adId)).toEqual(['222']);
  });

  it('período na hora da Bahia e datas para a Meta', () => {
    const agora = bahia(2026, 11, 20, 15);
    expect(janelaCriativos('7d', agora)).toMatchObject({ desde: '2026-11-14', ate: '2026-11-20' });
    expect(janelaCriativos('mes', agora)).toMatchObject({ desde: '2026-11-01', ate: '2026-11-20' });
    expect(janelaCriativos('mes_passado', agora)).toMatchObject({ desde: '2026-10-01', ate: '2026-10-31' });
  });

  it('conta de anúncios: aceita act_, só números ou o endereço do Gerenciador; erros da Meta em português', () => {
    expect(numeroDaConta('act_123456789')).toBe('123456789');
    expect(numeroDaConta('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=987654321&nav_entry_point=x')).toBe('987654321');
    expect(explicarErroMeta({ error: { code: 190, message: 'Error validating access token' } }, 400)).toMatch(/expirou/);
    expect(explicarErroMeta({ error: { code: 100 } }, 400)).toMatch(/não encontrou/);
    expect(explicarErroMeta(undefined, 0)).toMatch(/sem resposta/);
  });

  it('lê insights com paginação e junta a miniatura do criativo', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes('/insights?') && !url.includes('after=')) return Response.json({ data: [{ ad_id: '1', ad_name: 'A', campaign_id: 'c', spend: '10.50', impressions: '100', inline_link_clicks: '5' }], paging: { next: 'https://graph.facebook.com/v27.0/act_9/insights?after=x' } });
      if (url.includes('after=')) return Response.json({ data: [{ ad_id: '2', ad_name: 'B', spend: '1', impressions: '10', clicks: '1' }] });
      if (url.includes('?ids=')) return Response.json({ 1: { creative: { thumbnail_url: 'https://t/1.jpg', title: 'Oi' } }, 2: { creative: { image_url: 'javascript:alert(1)' } } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const r = await lerInsights({ token: 'TK', conta: '9', versao: 'v27.0' }, '2026-11-01', '2026-11-20', f);
    expect(r).toEqual([
      expect.objectContaining({ adId: '1', gasto: 10.5, impressoes: 100, cliques: 5, miniatura: 'https://t/1.jpg', titulo: 'Oi' }),
      expect.objectContaining({ adId: '2', gasto: 1, cliques: 1 }),
    ]);
    expect(r[1]!.miniatura).toBeUndefined();
    expect(urls[0]).toContain('act_9/insights?level=ad');
    expect(decodeURIComponent(urls[0]!)).toContain('"since":"2026-11-01","until":"2026-11-20"');
  });
});

// ---------- fonte (memória e Postgres) e rotas ----------

interface Amb {
  nome: string;
  criar(): Promise<{ repo: Repositorio; armazem: ArmazemRastreio; fonte: FonteCriativos; valor: (id: string, v: number) => Promise<void> }>;
}
const ambientes: Amb[] = [
  {
    nome: 'memória',
    criar: async () => {
      const repo = new RepositorioMemoria();
      const armazem = new ArmazemRastreioMemoria();
      const valores = new Map<string, number>();
      return { repo, armazem, fonte: new FonteCriativosMemoria(repo, armazem, { valor: async (id) => valores.get(id) ?? null }), valor: async (id, v) => void valores.set(id, v) };
    },
  },
  ...(temPostgres
    ? [{
        nome: 'postgres',
        criar: async () => {
          const pool = await poolDeTeste();
          return {
            repo: new RepositorioPostgres(pool) as Repositorio,
            armazem: new ArmazemRastreioPostgres(pool) as ArmazemRastreio,
            fonte: new FonteCriativosPostgres(pool) as FonteCriativos,
            valor: async (id: string, v: number) => void (await pool.query('insert into sintonia.cartao_valores (conversa_id, valor) values ($1, $2)', [id, v])),
          };
        },
      }]
    : []),
];

describe.each(ambientes)('Central de criativos: fonte e rota ($nome)', (amb) => {
  it('só a empresa certa; coorte por chegada; agendamento depois da chegada; compareceu e valor do cartão', async () => {
    const { repo, armazem, fonte, valor } = await amb.criar();
    const nova = async (empresaId: string, tel: string, unidade: 'norte' | 'sumare' = 'norte') => (await repo.buscarOuCriarConversa({ empresaId, unidade, canalId: `${empresaId}-${unidade}`, telefone: tel, agora: DIA })).conversa;
    const a = await nova('imperio', '5571900000001');
    const b = await nova('imperio', '5571900000002', 'sumare');
    const fora = await nova('outra', '5571900000003');
    const antiga = await nova('imperio', '5571900000004');
    const organica = await nova('imperio', '5571900000005');
    await armazem.gravarOrigem(a.id, 'primeiro', anuncio('111'), 'se_vazio');
    await armazem.gravarOrigem(b.id, 'primeiro', anuncio('111'), 'se_vazio');
    await armazem.gravarOrigem(fora.id, 'primeiro', anuncio('111'), 'se_vazio');
    await armazem.gravarOrigem(antiga.id, 'primeiro', anuncio('111', { em: bahia(2026, 9, 1) }), 'se_vazio');
    await armazem.gravarOrigem(organica.id, 'primeiro', { canal: 'organico', origemPor: 'automatico', em: DIA, fonte: 'instagram' }, 'se_vazio');
    const depois = new Date(DIA.getTime() + 3600_000);
    await repo.registrarEvento({ tipo: 'agendamento_ia', conversaId: a.id, unidade: 'norte', em: depois, dados: { servico: 'Progressiva', valor: 300 } });
    await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: a.id, unidade: 'norte', em: new Date(DIA.getTime() - 86_400_000), dados: { valor: 999 } }); // antes da chegada: não conta
    await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: a.id, unidade: 'norte', em: new Date(depois.getTime() + 3600_000), dados: { de: 'agendada', para: 'compareceu' } });
    await repo.registrarEvento({ tipo: 'agendamento_ia', conversaId: fora.id, unidade: 'norte', em: depois, dados: { valor: 5000 } });
    await valor(b.id, 700);
    await repo.salvarConversa({ ...b, etapa: 'compareceu' });

    const leads = await fonte.carregar(bahia(2026, 11, 1), bahia(2026, 11, 21), { empresaId: 'imperio' });
    expect(leads.map((l) => l.conversaId).sort()).toEqual([a.id, b.id].sort());
    const la = leads.find((l) => l.conversaId === a.id)!;
    expect(la).toMatchObject({ compareceu: true, valorCartao: null, agendamentos: [{ valor: 300, servico: 'Progressiva', compareceu: true }] });
    expect(leads.find((l) => l.conversaId === b.id)).toMatchObject({ unidade: 'sumare', compareceu: true, valorCartao: 700, etapaAgendou: true });
    // Gerente de uma unidade vê só a dela.
    expect((await fonte.carregar(bahia(2026, 11, 1), bahia(2026, 11, 21), { empresaId: 'imperio', unidades: ['sumare'] })).map((l) => l.conversaId)).toEqual([b.id]);

    const r = resumirCriativos(leads);
    expect(r.criativos).toHaveLength(1);
    expect(r.criativos[0]).toMatchObject({ adId: '111', leads: 2, agendaram: 2, vendas: 2, valor: 1000 });

    // Rota: sem conta de anúncios, sem gasto; com conta, gasto da Meta (e o token nunca volta).
    const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
    await conexoes.carregar();
    const chamadas: string[] = [];
    const fetchFalso = (async (url: string) => {
      chamadas.push(url);
      if (url.includes('/insights?')) return Response.json({ data: [{ ad_id: '111', ad_name: 'Antes e depois', campaign_id: 'c1', spend: '200', impressions: '8000', inline_link_clicks: '160' }] });
      if (url.includes('?ids=')) return Response.json({});
      if (url.includes('/act_')) return Response.json({ name: 'Conta Império', currency: 'BRL', account_status: 1 });
      return Response.json({ error: { code: 190, message: 'Invalid OAuth access token' } }, { status: 400 });
    }) as typeof fetch;
    const app = Fastify();
    const capi = new Capi({ armazem, config: () => configCapiDe(conexoes), buscarConversa: (id) => repo.buscarConversa(id) });
    const rastreio = new Rastreio({ armazem, empresaId: 'imperio' });
    registrarRastreio(app, { repo, rastreio, capi, conexoes, empresaId: 'imperio', agora: () => bahia(2026, 11, 20, 12), criativos: fonte, precos: async () => [], fetchFn: fetchFalso });
    const pedir = async (url: string) => (await app.inject({ method: 'GET', url })).json();
    const sem = await pedir('/api/rastreio/criativos?periodo=mes');
    expect(sem.meta).toEqual({ conectada: false });
    expect(sem.criativos[0]).toMatchObject({ adId: '111', leads: 2, vendas: 2, valor: 1000, gasto: null });
    expect(chamadas).toHaveLength(0);

    const put = await app.inject({ method: 'PUT', url: '/api/rastreio/capi', payload: { adsToken: 'TOKEN-ADS-SECRETO', adsConta: 'act_123456789', valorPadrao: 'R$ 1.250,00' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ adsConta: '123456789', adsToken: { definido: true, final: 'RETO' }, valorPadrao: '1250,00', situacao: { anuncios: { estado: 'nao_conferida' }, conversoes: { estado: 'faltando' } } });
    expect(JSON.stringify(put.json())).not.toContain('TOKEN-ADS-SECRETO');
    const conferido = (await app.inject({ method: 'POST', url: '/api/rastreio/capi/conferir', payload: {} })).json();
    expect(conferido.situacao.anuncios).toMatchObject({ estado: 'ok', texto: expect.stringContaining('Conta Império') });

    const com = await pedir('/api/rastreio/criativos?periodo=mes&ordem=custo');
    expect(com.meta.conectada).toBe(true);
    expect(com.meta.erro).toBeUndefined();
    expect(com.criativos[0]).toMatchObject({ adId: '111', gasto: 200, custoLead: 100, custoVenda: 100, retorno: 5, ctr: 2 });
    expect(chamadas.some((u) => u.includes('act_123456789/insights'))).toBe(true);
    // Filtro errado: mensagem clara.
    expect((await app.inject({ method: 'GET', url: '/api/rastreio/criativos?periodo=ano' })).statusCode).toBe(400);

    // Desconectar a conta de anúncios apaga token e conta.
    const desl = (await app.inject({ method: 'POST', url: '/api/rastreio/capi/desconectar', payload: { parte: 'anuncios' } })).json();
    expect(desl).toMatchObject({ adsConta: '', adsToken: { definido: false }, situacao: { anuncios: { estado: 'faltando' } } });
    expect((await pedir('/api/rastreio/criativos?periodo=mes')).meta).toEqual({ conectada: false });
  });

  it('API de Conversões: erro explicado, conferir com token recusado, desconectar', async () => {
    const { repo, armazem } = await amb.criar();
    const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
    await conexoes.carregar();
    const fetchFalso = (async () => Response.json({ error: { code: 190, message: 'Invalid OAuth access token' } }, { status: 400 })) as unknown as typeof fetch;
    const app = Fastify();
    const capi = new Capi({ armazem, config: () => configCapiDe(conexoes), buscarConversa: (id) => repo.buscarConversa(id) });
    registrarRastreio(app, { repo, rastreio: new Rastreio({ armazem, empresaId: 'imperio' }), capi, conexoes, empresaId: 'imperio', fetchFn: fetchFalso });
    const r1 = await app.inject({ method: 'PUT', url: '/api/rastreio/capi', payload: { datasetId: '12ab' } });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().message).toBe('Use só os números do Dataset ID');
    const vazio = (await app.inject({ method: 'GET', url: '/api/rastreio/capi' })).json();
    expect(vazio.situacao.conversoes).toMatchObject({ estado: 'faltando', texto: 'Falta o Dataset (Pixel) ID e o token de acesso.' });
    await app.inject({ method: 'PUT', url: '/api/rastreio/capi', payload: { datasetId: '987654321', token: 'TK-CAPI', ligado: true } });
    const conf = (await app.inject({ method: 'POST', url: '/api/rastreio/capi/conferir', payload: {} })).json();
    expect(conf.situacao.conversoes).toMatchObject({ estado: 'erro', texto: expect.stringContaining('expirou') });
    // Colar outro token limpa a conferência antiga.
    const novo = (await app.inject({ method: 'PUT', url: '/api/rastreio/capi', payload: { token: 'TK-NOVO' } })).json();
    expect(novo.situacao.conversoes.estado).toBe('ok');
    const fora = (await app.inject({ method: 'POST', url: '/api/rastreio/capi/desconectar', payload: { parte: 'conversoes' } })).json();
    expect(fora).toMatchObject({ ligado: false, datasetId: '', token: { definido: false }, situacao: { conversoes: { estado: 'faltando' } } });

    // Rastreamento: qualquer unidade da empresa (não só Norte/Sumaré); id estranho é 404, não erro interno.
    const link = await app.inject({ method: 'POST', url: '/api/rastreio/links', payload: { nome: 'Bio Feira', unidade: 'feira', numero: '75 99999-0000' } });
    expect(link.statusCode).toBe(201);
    expect(link.json().mensagem).toBe('Olá! Vim pelo link e quero saber mais.');
    expect((await app.inject({ method: 'PATCH', url: '/api/rastreio/links/xyz', payload: { ativo: false } })).statusCode).toBe(404);
    const ruim = await app.inject({ method: 'PATCH', url: `/api/rastreio/links/${link.json().id}`, payload: { nome: 'x' } });
    expect(ruim.statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/rastreio/links/${link.json().id}`, payload: { ativo: false } })).json().ativo).toBe(false);
  });
});

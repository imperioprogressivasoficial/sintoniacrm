import { beforeEach, describe, expect, it } from 'vitest';
import { Sintonia, type NumeroConectado } from '../src/app/sintonia.js';
import { ArmazemAutomacoesPostgres, Automacoes, ligarFunis } from '../src/automacoes/automacoes.js';
import { CanalTeste } from '../src/channels/teste.js';
import type { CanalWhatsApp, ModeloEnvio } from '../src/channels/tipos.js';
import { ContatosPostgres } from '../src/contatos/contatos.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemFunisPostgres, Funis } from '../src/funis/funis.js';
import { ArmazemLeadsPostgres } from '../src/leads/armazem.js';
import { Leads } from '../src/leads/leads.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { ArmazemTagsPostgres, Tags } from '../src/tags/tags.js';
import { componentesDoModelo, ModeloNovo } from '../src/transmissoes/meta-modelos.js';
import { contarVariaveis, dentroDaJanela, ehDescadastro, esperaDepois, montarTexto, parametrosDoModelo, sorteador, variar } from '../src/transmissoes/texto.js';
import { Envio } from '../src/transmissoes/tipos.js';
import { Transmissoes } from '../src/transmissoes/transmissoes.js';
import { AgenteFalso, quinta } from './gestao-ambiente.js';
import { poolDeTeste, temPostgres } from './repos.js';

// ------------------------------------------------------------------ funções puras

describe('Transmissões: texto, variáveis e ritmo', () => {
  it('variações {Oi|Olá} sorteiam uma opção (com semente, sempre a mesma) e variáveis da ficha', () => {
    const r = sorteador('a');
    const t = variar('{Oi|Olá|Oie} tudo {bem|certo}?', r);
    expect(t).toMatch(/^(Oi|Olá|Oie) tudo (bem|certo)\?$/);
    expect(variar('{Oi|Olá|Oie} tudo {bem|certo}?', sorteador('a'))).toBe(t);
    const vistos = new Set(Array.from({ length: 40 }, (_, i) => variar('{A|B|C}', sorteador(String(i)))));
    expect(vistos.size).toBe(3);
    const p = { nome: 'maria JOSÉ souza', telefone: '5571988887777', unidade: 'Salvador Norte Shopping', campos: { Serviço: 'progressiva', abc: 'x' } };
    expect(montarTexto('{Oi|Oi} {primeiro_nome}! Seu {campo:Serviço} na {unidade} ,ok', p)).toBe('Oi Maria! Seu progressiva na Salvador Norte Shopping,ok');
    expect(montarTexto('Oi {primeiro_nome}!', { telefone: '1', unidade: 'X' })).toBe('Oi!');
    // Modelo: nunca parâmetro vazio (a Meta recusa): usa o padrão, senão "-".
    expect(parametrosDoModelo([{ fonte: 'primeiro_nome', padrao: 'cliente' }, { fonte: 'campo:servico', padrao: '' }, { fonte: 'fixo:30%', padrao: '' }], { telefone: '1', unidade: 'X' })).toEqual(['cliente', '-', '30%']);
    expect(parametrosDoModelo([{ fonte: 'campo:servico', padrao: '' }], p)).toEqual(['progressiva']);
    expect(contarVariaveis('Oi {{1}}, {{2}} e {{1}}')).toBe(2);
  });

  it('descadastro: só a mensagem inteira ("SAIR", "Parar!", "não quero mais")', () => {
    for (const t of ['SAIR', 'sair', ' Parar! ', 'PARE', 'Não quero mais', 'stop', 'Parar promoções']) expect(ehDescadastro(t), t).toBe(true);
    for (const t of ['quero sair às 18h', 'pode parar de mandar?', 'Oi', '']) expect(ehDescadastro(t), t).toBe(false);
  });

  it('janela de horário (Bahia) e espera entre envios com pausa a cada N', () => {
    const e = Envio.parse({ janelaInicio: 8, janelaFim: 20 });
    expect(dentroDaJanela(e, quinta(8))).toBe(true);
    expect(dentroDaJanela(e, quinta(7, 59))).toBe(false);
    expect(dentroDaJanela(e, quinta(20))).toBe(false);
    expect(dentroDaJanela(e, new Date(quinta(10).getTime() + 3 * 86400_000))).toBe(false); // domingo
    expect(esperaDepois(Envio.parse({ porMinuto: 20 }), true, 1).ms).toBe(3000);
    const nao = Envio.parse({ intervaloMin: 8, intervaloMax: 25, pausaCada: 30, pausaMin: 5 });
    for (let i = 0; i < 30; i++) {
      const { ms } = esperaDepois(nao, false, 1, Math.random);
      expect(ms).toBeGreaterThanOrEqual(8000);
      expect(ms).toBeLessThanOrEqual(25000);
    }
    expect(esperaDepois(nao, false, 30, () => 0)).toEqual({ ms: 8000 + 5 * 60_000, pausou: true });
  });

  it('modelo para a Meta: componentes com exemplos, rodapé e botões; variáveis em sequência', () => {
    const m = ModeloNovo.parse({ unidade: 'norte', nome: 'Black Friday 2026!', categoria: 'MARKETING', corpo: 'Oi {{1}}, {{2}} de desconto', exemplos: ['Maria', '30%'], rodape: 'Responda SAIR', botoes: [{ tipo: 'resposta', texto: 'Parar promoções' }, { tipo: 'url', texto: 'Ver', url: 'https://imperio.com' }], cabecalho: { tipo: 'texto', texto: 'Black Friday' } });
    expect(m.nome).toBe('black_friday_2026');
    expect(componentesDoModelo(m)).toEqual([
      { type: 'HEADER', format: 'TEXT', text: 'Black Friday' },
      { type: 'BODY', text: 'Oi {{1}}, {{2}} de desconto', example: { body_text: [['Maria', '30%']] } },
      { type: 'FOOTER', text: 'Responda SAIR' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Parar promoções' }, { type: 'URL', text: 'Ver', url: 'https://imperio.com' }] },
    ]);
    expect(() => componentesDoModelo({ ...m, corpo: 'Oi {{2}}' })).toThrow(/sequência/);
    expect(() => componentesDoModelo({ ...m, exemplos: ['Maria'] })).toThrow(/exemplo/);
  });
});

// ------------------------------------------------------------------ com o banco

interface Enviado {
  canalId: string;
  telefone: string;
  texto?: string;
  modelo?: ModeloEnvio;
}

async function montar() {
  const pool = await poolDeTeste();
  await pool.query('truncate sintonia.transmissoes, sintonia.transmissao_destinos, sintonia.transmissao_optout, sintonia.transmissao_ritmo, sintonia.transmissao_modelos cascade');
  const relogio = { t: quinta(10) };
  const agora = () => relogio.t;
  const repo = new RepositorioPostgres(pool);
  const enviados: Enviado[] = [];
  let seq = 0;
  const evolution: CanalWhatsApp = {
    tipo: 'evolution',
    lerWebhook: () => [],
    enviarTexto: async (canalId, telefone, texto) => {
      enviados.push({ canalId, telefone, texto });
      return { idExterno: `evo-${++seq}` };
    },
  };
  const meta: CanalWhatsApp = {
    tipo: 'meta',
    lerWebhook: () => [],
    enviarTexto: async () => {
      throw new Error('texto livre não deveria sair pela API oficial');
    },
    enviarModelo: async (canalId, telefone, modelo) => {
      enviados.push({ canalId, telefone, modelo });
      return { idExterno: `wamid-${++seq}` };
    },
  };
  const numeros: NumeroConectado[] = [
    { canalId: 'imperio-norte', unidade: 'norte', canal: evolution },
    { canalId: 'meta-sumare', unidade: 'sumare', canal: meta },
    { canalId: 'teste-norte', unidade: 'norte', canal: new CanalTeste() },
  ];
  // Graph API falsa: guarda os pedidos e responde com o status dos modelos.
  const meta_ = { pedidos: [] as Array<{ url: string; corpo?: unknown }>, status: new Map<string, { status: string; motivo?: string }>() };
  const fetchMeta = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    meta_.pedidos.push({ url: u, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    if (init?.method === 'POST' && u.includes('/message_templates')) {
      const nome = (JSON.parse(String(init.body)) as { name: string }).name;
      meta_.status.set(nome, { status: 'PENDING' });
      return json({ id: `tpl-${nome}`, status: 'PENDING', category: 'MARKETING' });
    }
    if (u.includes('/message_templates')) {
      return json({
        data: [...meta_.status].map(([nome, s]) => ({ id: `tpl-${nome}`, name: nome, language: 'pt_BR', category: 'MARKETING', status: s.status, ...(s.motivo ? { rejected_reason: s.motivo } : {}), components: [{ type: 'BODY', text: 'Oi {{1}}, a Black Friday chegou!' }] })),
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const tags = new Tags(new ArmazemTagsPostgres(pool), 'imperio', agora);
  const contatos = new ContatosPostgres(pool);
  let sintonia: Sintonia;
  let transmissoes: Transmissoes;
  const funis = new Funis({ armazem: new ArmazemFunisPostgres(pool), armazemTags: new ArmazemTagsPostgres(pool), tags, repo, empresaId: 'imperio', agora, comConversa: (id, fn) => sintonia.comConversa(id, fn) });
  const automacoes = new Automacoes({ armazem: new ArmazemAutomacoesPostgres(pool), repo, empresaId: 'imperio', sintonia: () => sintonia, funis, tags, agora, transmissoes: () => transmissoes });
  const base = ligarFunis({ tags, funis, automacoes });
  funis.aoMover((m) => transmissoes.aoMover(m));
  tags.aoMarcar((c, t) => transmissoes.aoMarcarTag(c, t));
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros,
    agente: new AgenteFalso(),
    agora,
    ganchos: { ...base, mensagemCliente: async (c, m) => { await base.mensagemCliente?.(c, m); await transmissoes.mensagemCliente(c, m); } },
  });
  const leads = new Leads({ repo, armazem: new ArmazemLeadsPostgres(pool), contatos, empresaId: 'imperio', tags, funis, canalDa: (u) => `imperio-${u}`, agora });
  const criarT = () =>
    new Transmissoes({
      pool,
      empresaId: 'imperio',
      repo,
      sintonia: () => sintonia,
      numeros: () => numeros,
      tags,
      contatos,
      leads,
      contaMeta: (u) => (u === 'sumare' ? { token: 'tk', wabaId: 'waba1', phoneNumberId: 'meta-sumare' } : undefined),
      fetchMeta,
      agora,
      aleatorio: sorteador('teste'),
    });
  transmissoes = criarT();
  await funis.garantirSistema();

  let tel = 0;
  const novaConversa = async (nome: string, unidade: 'norte' | 'sumare' = 'norte', tagId?: string): Promise<Conversa> => {
    const telefone = `55719877${String(++tel).padStart(5, '0')}`;
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade, canalId: unidade === 'norte' ? 'imperio-norte' : 'meta-sumare', telefone, nome, agora: relogio.t });
    const c = { ...conversa, modo: 'humano' as const, atualizadaEm: new Date(relogio.t.getTime() - tel * 60_000) };
    await repo.salvarConversa(c);
    if (tagId) await tags.marcar(c, tagId, 'teste');
    return c;
  };
  const escreve = (c: Conversa, texto: string) =>
    sintonia.receber({ canalId: c.canalId, telefone: c.telefone, nome: c.nome, texto, deMim: false, idExterno: `in-${Math.random()}`, em: relogio.t });
  const avancar = (seg: number) => {
    relogio.t = new Date(relogio.t.getTime() + seg * 1000);
  };
  const destinos = async (id: string) => (await pool.query('select telefone, status, erro, id_externo from sintonia.transmissao_destinos where transmissao_id = $1 order by id', [id])).rows;
  return {
    pool,
    repo,
    relogio,
    enviados,
    numeros,
    tags,
    funis,
    automacoes,
    contatos,
    meta: meta_,
    get t() {
      return transmissoes;
    },
    reiniciar() {
      transmissoes = criarT();
    },
    criarT,
    novaConversa,
    escreve,
    avancar,
    destinos,
  };
}

const RAPIDO = { intervaloMin: 10, intervaloMax: 10, pausaCada: 0, janelaInicio: 8, janelaFim: 20 };

describe.skipIf(!temPostgres)('Transmissões (Postgres)', () => {
  let a: Awaited<ReturnType<typeof montar>>;
  beforeEach(async () => {
    a = await montar();
  });

  it('importa a lista (normaliza, junta repetidos) marcando uma tag nova e o público usa essa tag', async () => {
    const r = await a.t.importar(
      {
        unidade: 'norte',
        tagNova: 'Lista Black Friday',
        dddPadrao: '71',
        linhas: [
          { nome: 'Ana', telefone: '(71) 98812-0001' },
          { nome: 'Bia', telefone: '71 8812-0002' }, // sem o 9
          { nome: 'Bia de novo', telefone: '5571988120002' }, // repetida
          { nome: 'Carla', telefone: '98812-0003' }, // sem DDD
          { nome: 'Fixo', telefone: '(71) 3333-4444' },
          { nome: 'Lixo', telefone: '12' },
        ],
      },
      'Gil',
    );
    expect(r.tag?.nome).toBe('Lista Black Friday');
    expect(r.relatorio).toMatchObject({ criados: 4, recusados: 2 });
    // Importar de novo não duplica nada.
    const r2 = await a.t.importar({ unidade: 'norte', tagId: r.tag!.id, linhas: [{ nome: 'Ana', telefone: '+55 71 98812-0001' }] }, 'Gil');
    expect(r2.relatorio.criados).toBe(0);
    const p = await a.t.previaPublico('norte', { tags: [r.tag!.id] });
    expect(p).toMatchObject({ encontrados: 4, disponiveis: 3, selecionados: 3, excluidos: { semCelular: 1 } });
  });

  it('público: quantidade (mais recentes ou sorteio) e exclusões (saiu, recebeu há pouco, conversando agora)', async () => {
    const tag = await a.tags.criar({ nome: 'VIP' }, 'Gil');
    const cs: Conversa[] = [];
    for (let i = 0; i < 10; i++) cs.push(await a.novaConversa(`Cliente ${i}`, 'norte', tag.id));
    await a.novaConversa('Sem tag', 'norte');
    await a.t.descadastrar(cs[0]!.telefone, 'teste');
    // Recebeu outra transmissão há 2 dias.
    const outra = await a.t.criar({ nome: 'Outra', unidade: 'norte', canal: 'nao_oficial', mensagem: { texto: 'x' } }, 'Gil');
    await a.pool.query("insert into sintonia.transmissao_destinos (transmissao_id, telefone, status, enviada_em) values ($1, $2, 'enviada', $3)", [outra.id, cs[1]!.telefone, new Date(a.relogio.t.getTime() - 2 * 86400_000)]);
    // Conversando agora.
    await a.repo.salvarConversa({ ...cs[2]!, ultimaMensagemCliente: new Date(a.relogio.t.getTime() - 3600_000) });

    const todos = await a.t.previaPublico('norte', { tags: [tag.id] });
    expect(todos).toMatchObject({ encontrados: 10, disponiveis: 7, selecionados: 7, excluidos: { descadastrados: 1, receberamRecente: 1, conversando: 1 } });
    const semExcluir = await a.t.previaPublico('norte', { tags: [tag.id], excluirRecebeuDias: 0, excluirConversaAberta: false });
    expect(semExcluir.disponiveis).toBe(9); // quem saiu fica sempre de fora
    expect((await a.t.previaPublico('norte', { tags: [tag.id], excluirRecebeuDias: 1 })).excluidos.receberamRecente).toBe(0);

    const recentes = await a.t.selecionar('norte', { tags: [tag.id], quantidade: 3, ordem: 'recentes' });
    expect(recentes.escolhidos.map((x) => x.nome)).toEqual(['Cliente 3', 'Cliente 4', 'Cliente 5']);
    const sorteio = await a.t.selecionar('norte', { tags: [tag.id], quantidade: 3, ordem: 'aleatorio' });
    expect(sorteio.escolhidos).toHaveLength(3);
    expect(new Set(sorteio.escolhidos.map((x) => x.telefone)).size).toBe(3);
    // Etapa e "sem a tag".
    expect((await a.t.previaPublico('norte', { etapas: ['agendada'] })).encontrados).toBe(0);
    expect((await a.t.previaPublico('norte', { semTags: [tag.id], excluirConversaAberta: false })).encontrados).toBe(1);
  });

  it('envia no ritmo do número, só dentro da janela, com variáveis; pausa, retoma e conclui', async () => {
    const tag = await a.tags.criar({ nome: 'Lista' }, 'Gil');
    for (let i = 0; i < 4; i++) await a.novaConversa(`Ana${i} Souza`, 'norte', tag.id);
    const c = await a.t.criar({ nome: 'Black Friday', unidade: 'norte', canal: 'nao_oficial', publico: { tags: [tag.id], quantidade: 3 }, mensagem: { texto: '{Oi|Olá} {primeiro_nome}! Responda SAIR para sair.' }, envio: { ...RAPIDO, pausaCada: 2, pausaMin: 5 } }, 'Gil');
    expect((await a.t.iniciar(c.id)).status).toBe('enviando');
    expect(await a.t.tick()).toBe(1);
    expect(await a.t.tick()).toBe(0); // ritmo: 10 s entre envios
    a.avancar(9);
    expect(await a.t.tick()).toBe(0);
    a.avancar(1);
    expect(await a.t.tick()).toBe(1);
    // Pausa longa depois de 2.
    a.avancar(10);
    expect(await a.t.tick()).toBe(0);
    a.avancar(5 * 60);
    // Pausada: nada sai.
    await a.t.pausar(c.id);
    expect(await a.t.tick()).toBe(0);
    await a.t.retomar(c.id);
    // Fora da janela (20h): espera até as 8h.
    a.relogio.t = quinta(20, 30);
    expect(await a.t.tick()).toBe(0);
    a.relogio.t = new Date(quinta(8).getTime() + 86400_000); // sexta 8h
    expect(await a.t.tick()).toBe(1);
    expect(a.enviados).toHaveLength(3);
    for (const e of a.enviados) expect(e.texto).toMatch(/^(Oi|Olá) Ana\d! Responda SAIR para sair\.$/);
    expect(new Set(a.enviados.map((e) => e.telefone)).size).toBe(3);
    expect((await a.t.obter(c.id))!.status).toBe('concluida');
    // A mensagem ficou na conversa como automática.
    const conv = (await a.repo.listarConversas()).find((x) => x.telefone === a.enviados[0]!.telefone)!;
    const ms = await a.repo.mensagens(conv.id);
    expect(ms.at(-1)).toMatchObject({ autor: 'ia', autorNome: 'Transmissão: Black Friday' });
    const det = await a.t.detalhe(c.id);
    expect(det.contagem.funil).toMatchObject({ enviadas: 3, fila: 0 });
    expect(det.serie.pontos.length).toBeGreaterThan(0);
  });

  it('limite por dia no número: o resto espera o dia seguinte', async () => {
    for (let i = 0; i < 3; i++) await a.novaConversa(`C${i}`);
    const c = await a.t.criar({ nome: 'Limite', unidade: 'norte', canal: 'nao_oficial', mensagem: { texto: 'Oi' }, envio: { ...RAPIDO, limiteDia: 2 } }, 'Gil');
    await a.t.iniciar(c.id);
    for (let i = 0; i < 5; i++) {
      await a.t.tick();
      a.avancar(11);
    }
    expect(a.enviados).toHaveLength(2);
    a.relogio.t = new Date(quinta(9).getTime() + 86400_000);
    await a.t.tick();
    expect(a.enviados).toHaveLength(3);
  });

  it('sobrevive a reinício sem mandar duas vezes (e dois processos ao mesmo tempo não duplicam)', async () => {
    for (let i = 0; i < 5; i++) await a.novaConversa(`C${i}`);
    const c = await a.t.criar({ nome: 'Reinício', unidade: 'norte', canal: 'nao_oficial', mensagem: { texto: 'Oi {nome}' }, envio: { ...RAPIDO, intervaloMin: 3, intervaloMax: 3 } }, 'Gil');
    await a.t.iniciar(c.id);
    await a.t.tick();
    // O processo caiu no meio de um envio: a linha ficou "enviando".
    const { rows } = await a.pool.query("update sintonia.transmissao_destinos set status = 'enviando', reservada_em = $2 where id = (select id from sintonia.transmissao_destinos where transmissao_id = $1 and status = 'fila' order by id limit 1) returning telefone", [c.id, a.relogio.t]);
    const caiu = rows[0].telefone as string;
    a.reiniciar();
    // Iniciar de novo não duplica a lista.
    await a.pool.query("update sintonia.transmissoes set status = 'rascunho' where id = $1", [c.id]);
    await a.t.iniciar(c.id);
    expect((await a.destinos(c.id)).length).toBe(5);
    a.avancar(3 * 60);
    // Dois "processos" juntos.
    const outro = a.criarT();
    for (let i = 0; i < 6; i++) {
      await Promise.all([a.t.tick(), outro.tick()]);
      a.avancar(3);
    }
    const ds = await a.destinos(c.id);
    expect(ds.find((d) => d.telefone === caiu)).toMatchObject({ status: 'falhou', erro: expect.stringContaining('Não reenviado') });
    expect(a.enviados.map((e) => e.telefone).filter((t) => t === caiu)).toHaveLength(0);
    expect(a.enviados).toHaveLength(4);
    expect(new Set(a.enviados.map((e) => e.telefone)).size).toBe(4);
    expect((await a.t.obter(c.id))!.status).toBe('concluida');
  });

  it('respostas: "SAIR" descadastra (e sai das próximas), outra resposta vira "respondeu" com a tag da campanha', async () => {
    const ana = await a.novaConversa('Ana');
    const bia = await a.novaConversa('Bia');
    const c = await a.t.criar({ nome: 'Promo', unidade: 'norte', canal: 'nao_oficial', mensagem: { texto: 'Oi' }, envio: RAPIDO }, 'Gil');
    await a.t.iniciar(c.id);
    await a.t.tick();
    a.avancar(10);
    await a.t.tick();
    a.avancar(60);
    await a.escreve(ana, 'SAIR');
    await a.escreve(bia, 'Quero! Qual o valor?');
    const ds = await a.destinos(c.id);
    expect(ds.find((d) => d.telefone === ana.telefone)?.status).toBe('descadastrou');
    expect(ds.find((d) => d.telefone === bia.telefone)?.status).toBe('respondeu');
    expect(await a.t.descadastrado(ana.telefone)).toBe(true);
    const tagCamp = (await a.tags.soltas()).find((t) => t.nome === '📣 Promo')!;
    expect(await a.tags.temTag(bia.id, tagCamp.id)).toBe(true);
    // A resposta entrou como conversa normal.
    expect((await a.repo.mensagens(bia.id)).at(-1)).toMatchObject({ autor: 'cliente', texto: 'Quero! Qual o valor?' });
    // Próxima transmissão: Ana fica de fora.
    const p = await a.t.previaPublico('norte', { excluirRecebeuDias: 0, excluirConversaAberta: false });
    expect(p.excluidos.descadastrados).toBe(1);
  });

  it('API oficial: cria o modelo, espera a aprovação da Meta, envia com variáveis e acompanha entrega/leitura', async () => {
    const modelo = await a.t.criarModelo({ unidade: 'sumare', nome: 'black_friday', categoria: 'MARKETING', corpo: 'Oi {{1}}, a Black Friday chegou!', exemplos: ['Maria'], rodape: 'Responda SAIR', botoes: [{ tipo: 'resposta', texto: 'Parar promoções' }] }, 'Gil');
    expect(modelo).toMatchObject({ nome: 'black_friday', status: 'pendente', variaveis: 1 });
    const pedido = a.meta.pedidos.find((p) => p.url.includes('waba1/message_templates') && p.corpo);
    expect(pedido?.corpo).toMatchObject({ name: 'black_friday', language: 'pt_BR', category: 'MARKETING', components: expect.arrayContaining([expect.objectContaining({ type: 'BODY', example: { body_text: [['Maria']] } })]) });

    const maria = await a.novaConversa('maria clara', 'sumare');
    const c = await a.t.criar({ nome: 'BF oficial', unidade: 'sumare', canal: 'oficial', mensagem: { modelo: { nome: 'black_friday', idioma: 'pt_BR', corpo: 'Oi {{1}}, a Black Friday chegou!' }, variaveis: [{ fonte: 'primeiro_nome', padrao: 'cliente' }] }, envio: RAPIDO }, 'Gil');
    expect((await a.t.iniciar(c.id)).status).toBe('aguardando_modelo');
    await a.t.tick();
    expect(a.enviados).toHaveLength(0);
    a.meta.status.set('black_friday', { status: 'APPROVED' });
    await a.t.atualizarModelos('sumare');
    expect((await a.t.obter(c.id))!.status).toBe('agendada');
    expect((await a.t.modelos('sumare'))[0]!.status).toBe('aprovado');
    await a.t.tick();
    expect(a.enviados).toEqual([{ canalId: 'meta-sumare', telefone: maria.telefone, modelo: { nome: 'black_friday', idioma: 'pt_BR', parametros: ['Maria'] } }]);
    expect((await a.repo.mensagens(maria.id)).at(-1)?.texto).toBe('Oi Maria, a Black Friday chegou!');
    // Avisos da Meta: entregue, lida; um "entregue" atrasado não volta atrás.
    const [d] = await a.destinos(c.id);
    await a.t.statusRecebidos([{ canalId: 'meta-sumare', idExterno: d.id_externo, status: 'entregue', em: a.relogio.t }]);
    await a.t.statusRecebidos([{ canalId: 'meta-sumare', idExterno: d.id_externo, status: 'lida', em: a.relogio.t }]);
    await a.t.statusRecebidos([{ canalId: 'meta-sumare', idExterno: d.id_externo, status: 'entregue', em: a.relogio.t }]);
    expect((await a.destinos(c.id))[0].status).toBe('lida');
    expect((await a.t.detalhe(c.id)).contagem.funil).toMatchObject({ enviadas: 1, entregues: 1, lidas: 1 });

    // Rejeitado: com o motivo, e a campanha volta para rascunho com o aviso.
    await a.t.criarModelo({ unidade: 'sumare', nome: 'promo_ruim', categoria: 'MARKETING', corpo: 'Compre já' }, 'Gil');
    const c2 = await a.t.criar({ nome: 'Ruim', unidade: 'sumare', canal: 'oficial', mensagem: { modelo: { nome: 'promo_ruim', idioma: 'pt_BR', corpo: 'Compre já' } } }, 'Gil');
    await a.t.iniciar(c2.id);
    a.meta.status.set('promo_ruim', { status: 'REJECTED', motivo: 'INVALID_FORMAT' });
    await a.t.atualizarModelos('sumare');
    expect((await a.t.modelos('sumare')).find((m) => m.nome === 'promo_ruim')).toMatchObject({ status: 'rejeitado', motivo: 'INVALID_FORMAT' });
    expect(await a.t.obter(c2.id)).toMatchObject({ status: 'rascunho', erro: expect.stringContaining('INVALID_FORMAT') });
    // Texto livre num número da API oficial é recusado logo ao iniciar.
    const c3 = await a.t.criar({ nome: 'Livre', unidade: 'sumare', canal: 'nao_oficial', mensagem: { texto: 'Oi' } }, 'Gil');
    await expect(a.t.iniciar(c3.id)).rejects.toThrow(/API oficial/);
  });

  it('automática: entrou na etapa → entra na fila uma vez só; passo "enviar transmissão" das automações', async () => {
    const sistema = await a.funis.garantirSistema();
    const agendada = (await a.funis.etapas(sistema.id)).find((e) => e.chaveSistema === 'agendada')!;
    const novo = (await a.funis.etapas(sistema.id)).find((e) => e.chaveSistema === 'novo_lead')!;
    const c = await a.t.criar({ nome: 'Confirmação', unidade: 'norte', canal: 'nao_oficial', modo: 'automatico', mensagem: { texto: 'Oi {primeiro_nome}, seu horário está confirmado!' }, envio: { ...RAPIDO, gatilho: { tipo: 'entrou_na_etapa', etapaId: agendada.id } } }, 'Gil');
    expect((await a.t.iniciar(c.id)).status).toBe('enviando');
    const ana = await a.novaConversa('Ana Paula');
    await a.funis.garantirNoSistema(ana);
    await a.funis.mover(ana.id, sistema.id, agendada.id, { nome: 'Gil' });
    await a.t.tick();
    expect(a.enviados.map((e) => e.texto)).toEqual(['Oi Ana, seu horário está confirmado!']);
    // Sai e volta para a etapa: não recebe de novo.
    await a.funis.mover(ana.id, sistema.id, novo.id, { nome: 'Gil' });
    await a.funis.mover(ana.id, sistema.id, agendada.id, { nome: 'Gil' });
    a.avancar(60);
    await a.t.tick();
    expect(a.enviados).toHaveLength(1);
    expect((await a.t.obter(c.id))!.status).toBe('enviando'); // automática não "conclui"

    // Passo de automação.
    const vip = await a.tags.criar({ nome: 'VIP' }, 'Gil');
    const c2 = await a.t.criar({ nome: 'Boas-vindas VIP', unidade: 'norte', canal: 'nao_oficial', modo: 'automatico', mensagem: { texto: 'Bem-vinda ao VIP!' }, envio: { ...RAPIDO, gatilho: { tipo: 'aniversario' } } }, 'Gil');
    await a.t.iniciar(c2.id);
    const auto = await a.automacoes.criar({ nome: 'VIP', ligada: true, gatilho: { tipo: 'tag_marcada', tagId: vip.id }, passos: [{ tipo: 'enviar_transmissao', transmissaoId: c2.id }] }, 'Gil');
    expect(auto.passos[0]).toMatchObject({ tipo: 'enviar_transmissao' });
    const bia = await a.novaConversa('Bia');
    await a.repo.salvarConversa(bia);
    await a.tags.marcar(bia, vip.id, 'Gil');
    await a.automacoes.ocioso();
    await a.automacoes.tick();
    await a.automacoes.ocioso();
    a.avancar(60);
    await a.t.tick();
    expect(a.enviados.at(-1)).toMatchObject({ telefone: bia.telefone, texto: 'Bem-vinda ao VIP!' });
  });

  it('aniversário: entra no dia (uma vez por ano)', async () => {
    const ana = await a.novaConversa('Ana');
    await a.contatos.salvar('imperio', { telefone: ana.telefone, nome: 'Ana', email: null, nascimento: '1990-11-05', observacoes: null, pessoa: 'fisica', empresa: {}, campos: {}, atualizadoEm: null, atualizadoPor: null }, 'Gil');
    await a.novaConversa('Bia');
    const c = await a.t.criar({ nome: 'Parabéns', unidade: 'norte', canal: 'nao_oficial', modo: 'automatico', mensagem: { texto: 'Feliz aniversário, {primeiro_nome}!' }, envio: { ...RAPIDO, gatilho: { tipo: 'aniversario' } } }, 'Gil');
    await a.t.iniciar(c.id);
    expect(await a.t.gatilhosDiarios()).toBe(1);
    expect(await a.t.gatilhosDiarios()).toBe(0);
    await a.t.tick();
    expect(a.enviados.map((e) => e.texto)).toEqual(['Feliz aniversário, Ana!']);
  });
});

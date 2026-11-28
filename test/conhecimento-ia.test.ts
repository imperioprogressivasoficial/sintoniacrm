import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { textoRegrasAtendimento } from '../src/ai/regras-atendimento.js';
import { Aprender } from '../src/aprender/aprender.js';
import { ArmazemAprenderMemoria, ArmazemAprenderPostgres, type ArmazemAprender, type Item, type Rodada } from '../src/aprender/armazem.js';
import { blocosDasRegras } from '../src/aprender/conhecimento.js';
import { FonteConversasRepo } from '../src/aprender/fonte.js';
import { IaAprender } from '../src/aprender/ia.js';
import { registrarAprender } from '../src/aprender/rotas.js';
import { ambientes, montarGestao } from './gestao-ambiente.js';

/** conhecimento-arquivo: Empresa › Documentos › Conhecimento da IA (GET /api/ia/conhecimento). */

const item = (x: Partial<Item>): Item => ({
  id: randomUUID(), empresaId: 'imperio', rodadaId: null, origem: 'conversas', categoria: 'roteiro', acao: 'acrescentar', destino: 'roteiro',
  titulo: 'Comprimento antes do preço', texto: 'Pergunta o comprimento do cabelo antes de falar preço.', pergunta: null, resposta: null,
  trechoAtual: null, conversas: 4, exemplos: [], conferir: false, contradiz: false, motivo: null, situacao: 'aplicado', automatico: false,
  criadoEm: new Date('2026-11-20T12:00:00Z'), decididoEm: new Date('2026-11-21T12:00:00Z'), decididoPor: 'Bruno Batista', desfeitoEm: null, desfeitoPor: null,
  aplicacao: null, ...x,
});
const rodadaDoc = (nome: string, em: Date, situacao: Rodada['situacao'] = 'pronta'): Rodada => ({
  id: randomUUID(), empresaId: 'imperio', origem: 'documento', situacao, pedidaPor: 'Bruno Batista', criadaEm: em, atualizadaEm: em, terminadaEm: em,
  conversas: [], lidas: 0, total: 0, observacoes: [], tokensEntrada: 0, tokensSaida: 0, resultado: null, erro: null,
  documentoNome: nome, documentoTexto: 'texto guardado do documento', documentoPdf: null,
});

describe('regras de atendimento em blocos', () => {
  it('separa título e texto de cada regra', () => {
    const b = blocosDasRegras('- Tamanho: curto.\n- Nome: use o do cadastro.\n  continua aqui.\n- sem título');
    expect(b).toEqual([
      { titulo: 'Tamanho', texto: 'curto.' },
      { titulo: 'Nome', texto: 'use o do cadastro.\n  continua aqui.' },
      { titulo: 'Regra', texto: 'sem título' },
    ]);
    expect(blocosDasRegras().length).toBe(textoRegrasAtendimento().split(/\n(?=- )/).length);
  });
});

describe.each(ambientes)('Conhecimento da IA ($nome)', (amb) => {
  it('mostra as 4 partes, sempre do banco, e só para a gestão', async () => {
    const g = await montarGestao(amb);
    if (g.pool) await g.pool.query('truncate sintonia.aprender_config, sintonia.aprender_rodadas, sintonia.aprender_itens, sintonia.aprender_lidas');
    const armazem: ArmazemAprender = g.pool ? new ArmazemAprenderPostgres(g.pool) : new ArmazemAprenderMemoria();
    const aprender = new Aprender({
      empresaId: 'imperio', armazem, fonte: new FonteConversasRepo(g.repo), base: g.base,
      ia: new IaAprender({} as never, () => 'claude-opus-5-5'), iaLigada: () => true, agora: () => g.relogio.t,
    });
    registrarAprender(g.app, { aprender: (e) => (e === 'imperio' ? aprender : undefined), empresaId: 'imperio' });

    await g.base.adicionarPergunta({ pergunta: 'Vocês atendem sábado?', resposta: 'Sim, das 8h às 18h.' }, 'Bruno Batista');
    await armazem.gravarItem(item({}));
    await armazem.gravarItem(item({ categoria: 'pergunta', destino: 'perguntas-frequentes', titulo: '', texto: 'x', pergunta: 'Dói?', resposta: 'Não dói.', origem: 'documento: manual.pdf', conversas: 0, decididoEm: new Date('2026-11-22T12:00:00Z') }));
    await armazem.gravarItem(item({ texto: 'Recusado não aparece.', situacao: 'recusado' }));
    await armazem.gravarItem(item({ texto: 'Desfeito não aparece.', situacao: 'desfeito' }));
    await armazem.criarRodada(rodadaDoc('manual.pdf', new Date('2026-11-22T10:00:00Z')));
    await armazem.criarRodada(rodadaDoc('quebrado.pdf', new Date('2026-11-23T10:00:00Z'), 'falhou'));

    for (const u of [g.gente.carla, g.gente.rita]) expect((await g.como(u, 'GET', '/api/ia/conhecimento')).statusCode).toBe(403);

    const r = await g.como(g.gente.admin, 'GET', '/api/ia/conhecimento');
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const c = r.json();
    expect(c.partes.map((p: { id: string }) => p.id)).toEqual(['base', 'aprendido', 'documentos', 'regras']);
    const [base, aprendido, docs, regras] = c.partes;

    // (1) base: as seções do Treinamento, com a pergunta frequente cadastrada dentro da seção dela
    expect(base.blocos.map((b: { titulo: string }) => b.titulo)).toEqual(['Quem somos', 'Jeito de falar', 'Perguntas frequentes']);
    expect(base.blocos[0]).toMatchObject({ texto: expect.stringContaining('Império Progressivas.'), por: 'Texto inicial' });
    expect(base.blocos[2].texto).toContain('Pergunta: Vocês atendem sábado?\nResposta: Sim, das 8h às 18h.');

    // (2) aprendido: só o que está valendo, do mais novo para o mais antigo, com data e origem
    expect(aprendido.blocos).toHaveLength(2);
    expect(aprendido.blocos[0]).toMatchObject({ texto: 'Pergunta: Dói?\nResposta: Não dói.', origem: 'Documento manual.pdf', grupo: 'Perguntas que as clientes fazem', titulo: 'Perguntas que as clientes fazem' });
    expect(aprendido.blocos[1]).toMatchObject({ titulo: 'Comprimento antes do preço', origem: 'Conversas da equipe (4 conversas)', por: 'Bruno Batista', em: '2026-11-21T12:00:00.000Z' });
    expect(JSON.stringify(aprendido)).not.toMatch(/Recusado|Desfeito/);

    // (3) documentos: só nome e data (o texto guardado não sai; o que falhou não conta)
    expect(docs.blocos).toEqual([{ titulo: 'manual.pdf', texto: '', em: '2026-11-22T10:00:00.000Z' }]);
    expect(JSON.stringify(c)).not.toContain('texto guardado do documento');

    // (4) regras fixas
    expect(regras.blocos.length).toBeGreaterThan(3);
    expect(regras.blocos.map((b: { titulo: string; texto: string }) => `- ${b.titulo}: ${b.texto}`).join('\n')).toBe(textoRegrasAtendimento());

    // data da última atualização = a mudança mais nova (o documento de 22/11 10h perde para o aprendizado de 22/11 12h)
    expect(c.atualizadoEm).toBe('2026-11-22T12:00:00.000Z');

    // sempre atualizado: editar a base aparece na hora
    await g.base.editar('jeito-de-falar', { conteudo: 'Curto, caloroso e sem emoji.' }, 'Bruno Batista');
    const depois = (await g.como(g.gente.gerenteNorte, 'GET', '/api/ia/conhecimento')).json();
    expect(depois.partes[0].blocos[1]).toMatchObject({ texto: 'Curto, caloroso e sem emoji.', por: 'Bruno Batista' });
  });
});

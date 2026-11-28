import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ArmazemFollowupMemoria } from '../src/followup/armazem.js';
import { Followup } from '../src/followup/followup.js';
import { registrarFollowup } from '../src/followup/rotas.js';
import { configPadrao, MODELOS_CADENCIA, SITUACOES } from '../src/followup/tipos.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

/*
 * sem-exemplos (pedido do dono, 21/11): "não quero nada de exemplo em Fluxos, Chatbot e Follow-up; eu crio".
 * - Nada nasce sozinho (follow-up vazio, nenhuma automação nem bot de exemplo).
 * - As telas abrem vazias, com o botão de criar, e sem "Modelos prontos".
 * - A migração 670 tira do banco só os exemplos nunca mexidos e mantém o que foi editado, ligado ou já rodou.
 */

const raiz = new URL('../', import.meta.url);
const ler = (arquivo: string) => readFileSync(new URL(arquivo, raiz), 'utf8');

function novoFollowup() {
  const repo = new RepositorioMemoria();
  return new Followup({ empresaId: 'imperio', armazem: new ArmazemFollowupMemoria(), repo, sintonia: () => ({}) as never });
}

describe('sem-exemplos: nada nasce sozinho', () => {
  it('follow-up começa com todas as cadências desligadas e vazias (a confirmação de agenda continua)', async () => {
    const cfg = configPadrao();
    expect(cfg.cadencias.map((c) => c.id)).toEqual([...SITUACOES]);
    for (const c of cfg.cadencias) expect(c, c.id).toMatchObject({ ligada: false, passos: [] });
    const f = novoFollowup();
    expect((await f.config()).cadencias.every((c) => c.passos.length === 0)).toBe(true);
    // A confirmação de agenda é a função (não um exemplo): segue igual.
    expect(cfg.confirmacao.ligada).toBe(true);
  });

  it('para ligar uma cadência, precisa escrever a mensagem', async () => {
    const f = novoFollowup();
    const cfg = configPadrao();
    cfg.cadencias[0]!.ligada = true;
    await expect(f.salvarConfig(cfg, 'Bruno')).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('escreva pelo menos uma mensagem') });
    cfg.cadencias[0]!.passos = [{ esperaHoras: 24, texto: '  ', ia: false, objetivo: '', email: false, emailModeloId: null }];
    await expect(f.salvarConfig(cfg, 'Bruno')).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('mensagem 1 está vazia') });
    cfg.cadencias[0]!.passos[0]!.texto = 'Oi, {primeiro_nome}! Ainda posso te ajudar?';
    const salvo = await f.salvarConfig(cfg, 'Bruno');
    expect(salvo.cadencias[0]).toMatchObject({ ligada: true, passos: [{ texto: 'Oi, {primeiro_nome}! Ainda posso te ajudar?' }] });
    // Desligada e vazia salva sem problema.
    expect((await f.salvarConfig(configPadrao(), 'Bruno')).cadencias[0]).toMatchObject({ ligada: false, passos: [] });
  });

  it('a API do follow-up não manda mais o modelo pronto, e a rota "usar modelo" saiu', async () => {
    const app = Fastify();
    registrarFollowup(app, { followup: novoFollowup(), repo: new RepositorioMemoria() });
    const r = await app.inject({ method: 'GET', url: '/api/followup/config' });
    expect(r.statusCode).toBe(200);
    const d = r.json() as { situacoes: Array<Record<string, unknown>>; config: { cadencias: Array<{ passos: unknown[] }> } };
    expect(d.situacoes.every((s) => !('modelo' in s))).toBe(true);
    expect(d.config.cadencias.every((c) => c.passos.length === 0)).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/followup/modelo/sem_resposta', payload: {} })).statusCode).toBe(404);
    await app.close();
  });
});

describe('sem-exemplos: telas vazias, sem "Modelos prontos"', () => {
  it('Chatbot: vazio com "Criar bot" e o "Novo bot" sem galeria de modelos; blocos novos sem texto pronto', () => {
    const js = ler('public/telas/bot.js');
    expect(js).toContain("'Nenhum bot ainda.'");
    expect(js).toContain("'Toque em Criar bot para montar o seu.'");
    expect(js).not.toContain("ui.api('/api/bots/modelos')");
    expect(js).not.toContain('Comece por um modelo pronto');
    expect(js).not.toContain("n.texto = 'Ligar para {primeiro_nome}'");
    expect(js).not.toContain("n.texto = 'Vou chamar uma atendente");
  });

  it('Fluxos (Automações): vazio com "Criar automação" e sem o bloco "Prontos para usar"', () => {
    const js = ler('public/telas/automacoes.js');
    expect(js).toContain("'Toque em Criar automação para montar a sua.'");
    expect(js).not.toContain('nps.prontos');
    expect(js).not.toContain('np-prontos');
    const nps = ler('public/telas/nps.js');
    expect(nps).not.toContain('/api/automacoes/modelos');
    expect(nps).not.toContain('Prontos para usar.');
  });

  it('Follow-up: cadência vazia com "+ Mensagem" e sem "Usar modelo pronto"', () => {
    const js = ler('public/telas/followup.js');
    expect(js).toContain("'Nenhuma mensagem ainda.'");
    expect(js).toContain("'Toque em + Mensagem para montar a sua.'");
    expect(js).not.toContain('Usar modelo pronto');
  });

  it('o item "Modelos prontos" saiu dos menus (celular e computador)', () => {
    const html = ler('public/app.html');
    expect(html).not.toContain('id="lt-auto-modelos"');
    expect(html).not.toContain("nome: 'Modelos prontos'");
    expect(html).not.toContain("irAba?.('modelos'");
  });
});

// ------------------------------------------------------------------------------------------------ migração 670
const MIGRACAO = ler('db/migrations/670_sem_exemplos.sql');

/** Passos da 1ª versão dos modelos (07/11), para conferir que a migração também reconhece essa. */
const V1_SEM_RESPOSTA = [
  { esperaHoras: 3, texto: 'Oi, {primeiro_nome}! Conseguiu ver minha mensagem? Fico à disposição para tirar qualquer dúvida 😊', ia: true, objetivo: 'Retomar a conversa com leveza e perguntar se ficou alguma dúvida.', email: false, emailModeloId: null },
  { esperaHoras: 24, texto: '{primeiro_nome}, ainda pensando no seu cabelo? Temos horários essa semana na {unidade}. Quer que eu veja um para você?', ia: true, objetivo: 'Oferecer ajuda para escolher um horário, sem pressionar.', email: false, emailModeloId: null },
  { esperaHoras: 72, texto: 'Oi, {primeiro_nome}! Vou deixar sua conversa aqui guardadinha. Quando quiser agendar, é só me chamar 💙', ia: false, objetivo: '', email: false, emailModeloId: null },
];

describe.runIf(temPostgres)('sem-exemplos: migração 670 (Postgres)', () => {
  const rodar = async (pool: import('pg').Pool) => {
    const cli = await pool.connect();
    try {
      await cli.query('begin');
      await cli.query(MIGRACAO);
      await cli.query('commit');
    } catch (e) {
      await cli.query('rollback');
      throw e;
    } finally {
      cli.release();
    }
  };

  it('follow-up: esvazia só as cadências de exemplo desligadas e nunca mexidas', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.followup_config');
    const modelo = (id: (typeof SITUACOES)[number], ligada = false) => ({ ...structuredClone(MODELOS_CADENCIA[id]), ligada });
    // Empresa A: como ficava gravado quando alguém salvava a tela sem mexer nas cadências.
    const editada = modelo('pos_atendimento');
    editada.passos[0]!.texto = 'Oi, {primeiro_nome}! Texto que a Império escreveu.';
    const semCampoNovo = modelo('orcamento') as { passos: Array<Record<string, unknown>> };
    for (const p of semCampoNovo.passos) delete p.email, delete p.emailModeloId; // gravado antes desses campos existirem
    const a = { ...configPadrao(), cadencias: [modelo('sem_resposta'), { id: 'preco_sem_agendar', ligada: false, pararSeResponder: true, passos: modelo('preco_sem_agendar').passos }, modelo('faltou', true), editada, semCampoNovo] };
    // Empresa B: régua da 1ª versão desligada (exemplo) e a da 2ª versão ligada pelo botão "Usar e ligar" (fica).
    const b = { ...configPadrao(), cadencias: [{ id: 'sem_resposta', ligada: false, pararSeResponder: true, passos: V1_SEM_RESPOSTA }, modelo('preco_sem_agendar', true)] };
    // Empresa C: já sem nada de exemplo.
    const c = configPadrao();
    for (const [empresa, cfg] of [['a', a], ['b', b], ['c', c]] as const) {
      await pool.query('insert into sintonia.followup_config (empresa_id, config, atualizado_por) values ($1, $2, $3)', [empresa, JSON.stringify(cfg), 'Bruno']);
    }
    const antesC = (await pool.query("select config, atualizado_em from sintonia.followup_config where empresa_id = 'c'")).rows[0];

    await rodar(pool);
    await rodar(pool); // de novo: não estraga nada

    const cfg = async (empresa: string) => (await pool.query('select config from sintonia.followup_config where empresa_id = $1', [empresa])).rows[0].config as { cadencias: Array<{ id: string; ligada: boolean; passos: Array<{ texto: string }> }>; confirmacao: unknown };
    const ca = await cfg('a');
    const porId = Object.fromEntries(ca.cadencias.map((x) => [x.id, x]));
    expect(porId.sem_resposta!.passos).toEqual([]); // exemplo, desligado → vazio
    expect(porId.preco_sem_agendar!.passos).toEqual([]);
    expect(porId.orcamento!.passos).toEqual([]); // exemplo gravado no formato antigo também
    expect(porId.faltou).toMatchObject({ ligada: true, passos: MODELOS_CADENCIA.faltou.passos }); // ligado: fica
    expect(porId.pos_atendimento!.passos[0]!.texto).toBe('Oi, {primeiro_nome}! Texto que a Império escreveu.'); // editado: fica
    expect(porId.pos_atendimento!.passos).toHaveLength(4);
    expect(ca.cadencias.map((x) => x.id)).toEqual(['sem_resposta', 'preco_sem_agendar', 'faltou', 'pos_atendimento', 'orcamento']); // ordem mantida
    expect(ca.confirmacao).toEqual(JSON.parse(JSON.stringify(a.confirmacao))); // confirmação de agenda intacta

    const cb = await cfg('b');
    expect(cb.cadencias[0]).toMatchObject({ id: 'sem_resposta', ligada: false, passos: [] });
    expect(cb.cadencias[1]).toMatchObject({ id: 'preco_sem_agendar', ligada: true });
    expect(cb.cadencias[1]!.passos).toHaveLength(3);

    const depoisC = (await pool.query("select config, atualizado_em from sintonia.followup_config where empresa_id = 'c'")).rows[0];
    expect(depoisC).toEqual(antesC); // nada mudou
  });

  it('Fluxos: apaga só as automações "Exemplo:" da demonstração que ninguém mexeu, ligou ou rodou', async () => {
    const pool = await poolDeTeste();
    const criada = new Date('2026-11-10T12:00:00Z');
    const nova = async (o: { nome: string; por: string; ligada?: boolean; editada?: boolean; demo?: boolean; empresa?: string }) => {
      const id = randomUUID();
      const empresa = o.empresa ?? 'imperio';
      await pool.query(
        `insert into sintonia.automacoes (id, empresa_id, funil_id, nome, ligada, gatilho, passos, opcoes, criada_por, criada_em, atualizada_em)
         values ($1, $2, null, $3, $4, $5, $6, '{}', $7, $8, $9)`,
        [id, empresa, o.nome, o.ligada ?? false, JSON.stringify({ tipo: 'nova_conversa' }), JSON.stringify([{ tipo: 'enviar_mensagem', texto: 'Oi', so_no_horario: true }]), o.por, criada, o.editada ? new Date(criada.getTime() + 60_000) : criada],
      );
      if (o.demo !== false) await pool.query("insert into sintonia.demo_registros (empresa_id, tipo, chave) values ($1, 'automacao', $2)", [empresa, id]);
      return id;
    };
    const EX1 = 'Exemplo: Interessada há 1 dia → mensagem';
    const EX2 = 'Exemplo: Compareceu → Pós-venda';
    const EX3 = 'Exemplo: palavra "endereço" → resposta';
    const intocadas = [await nova({ nome: EX1, por: 'Demonstração' }), await nova({ nome: EX2, por: 'Demonstração' }), await nova({ nome: EX3, por: 'Demonstração', empresa: 'outra' })];
    const ficam = {
      editada: await nova({ nome: EX1, por: 'Demonstração', editada: true }),
      ligada: await nova({ nome: EX2, por: 'Demonstração', ligada: true }),
      semRegistro: await nova({ nome: EX3, por: 'Demonstração', demo: false }),
      daPessoa: await nova({ nome: EX1, por: 'Bruno Batista', demo: false }),
      outraDaDemo: await nova({ nome: 'Boas-vindas da loja', por: 'Demonstração' }),
      comum: await nova({ nome: 'Pós-venda da Império', por: 'Bruno Batista', ligada: true, demo: false }),
    };

    await rodar(pool);
    await rodar(pool);

    const ids = new Set((await pool.query('select id from sintonia.automacoes')).rows.map((r) => r.id as string));
    for (const id of intocadas) expect(ids.has(id), id).toBe(false);
    for (const [nome, id] of Object.entries(ficam)) expect(ids.has(id), nome).toBe(true);
    // O registro de demonstração das apagadas também sai; o das que ficaram, não.
    const registros = new Set((await pool.query("select chave from sintonia.demo_registros where tipo = 'automacao'")).rows.map((r) => r.chave as string));
    for (const id of intocadas) expect(registros.has(id)).toBe(false);
    expect(registros.has(ficam.editada)).toBe(true);
    expect(registros.has(ficam.outraDaDemo)).toBe(true);
  });
});

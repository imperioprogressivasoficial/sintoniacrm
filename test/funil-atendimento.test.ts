import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proximaEtapa, REGRAS_MOTOR_PADRAO } from '../src/engine/etapas.js';
import { etapaDoFunil, NOME_ETAPA } from '../src/domain.js';
import { normalizarRegrasFunil, REGRAS_FUNIL_PADRAO, unidadeAberta } from '../src/funis/regras-funil.js';
import { Notificador } from '../src/notificacoes/notificador.js';
import { ArmazemNotificacoesMemoria } from '../src/notificacoes/armazem.js';
import { AgenteFalso, ambientes, montarFunis, quinta } from './funis-ambiente.js';
import { temPostgres, poolDeTeste } from './repos.js';
import type { Conversa } from '../src/domain.js';

/**
 * funil-atendimento (dono 28/11): etapas Novo lead · Em atendimento · Reagendar · Sem resposta · Agendado <unidade> ·
 * Finalizado · Perdido; o sistema move sozinho por regras que a gestão liga/desliga e cujo tempo edita na tela;
 * alerta de lead parado em Novo lead.
 */

type EtapaJson = { id: string; nome: string; chaveSistema: string | null; unidade?: string | null };
const agendamento = (unidade: string, inicio: Date, duracaoMin = 60) => ({ trinksId: 900 + Math.floor(Math.random() * 1000), unidade, servico: 'Progressiva', inicio, duracaoMin });
const UNIDADES = () => [
  { id: 'norte', nome: 'Salvador Norte' },
  { id: 'sumare', nome: 'Sumaré' },
];

describe('funil de atendimento: regras do motor', () => {
  it('nomes novos e as etapas antigas valendo como a equivalente', () => {
    expect([NOME_ETAPA.entrada, NOME_ETAPA.em_conversa, NOME_ETAPA.reagendar, NOME_ETAPA.sem_resposta, NOME_ETAPA.agendada, NOME_ETAPA.compareceu, NOME_ETAPA.perdida]).toEqual([
      'Novo lead', 'Em atendimento', 'Reagendar', 'Sem resposta', 'Agendado', 'Finalizado', 'Perdido',
    ]);
    expect(etapaDoFunil('novo_lead')).toBe('entrada');
    expect(etapaDoFunil('interessada')).toBe('em_conversa');
    expect(etapaDoFunil('manutencao')).toBe('compareceu');
  });

  it('cada regra liga e desliga', () => {
    const fora = { voltouEscrever: false, lojaRespondeu: false, remarcar: false, agendou: false };
    // A loja respondeu → Em atendimento.
    expect(proximaEtapa('entrada', { tipo: 'primeira_resposta', clienteEscreveu: true })).toBe('em_conversa');
    expect(proximaEtapa('entrada', { tipo: 'primeira_resposta', clienteEscreveu: true }, fora)).toBe('entrada');
    // Sem resposta: ela voltou a responder → Em atendimento (sempre).
    expect(proximaEtapa('sem_resposta', { tipo: 'mensagem_cliente' }, fora)).toBe('em_conversa');
    // Voltou a escrever depois de Perdido/Finalizado → Novo lead.
    expect(proximaEtapa('perdida', { tipo: 'mensagem_cliente' })).toBe('entrada');
    expect(proximaEtapa('compareceu', { tipo: 'mensagem_cliente' })).toBe('entrada');
    expect(proximaEtapa('perdida', { tipo: 'mensagem_cliente' }, fora)).toBe('perdida');
    // Remarcar / cancelou / faltou → Reagendar.
    expect(proximaEtapa('agendada', { tipo: 'pediu_remarcar' })).toBe('reagendar');
    expect(proximaEtapa('em_conversa', { tipo: 'pediu_remarcar' })).toBe('reagendar');
    expect(proximaEtapa('compareceu', { tipo: 'pediu_remarcar' })).toBe('compareceu');
    expect(proximaEtapa('agendada', { tipo: 'pediu_remarcar' }, fora)).toBe('agendada');
    expect(proximaEtapa('agendada', { tipo: 'agendamento_cancelado' })).toBe('reagendar');
    expect(proximaEtapa('agendada', { tipo: 'agendamento_cancelado' }, fora)).toBe('em_conversa');
    expect(proximaEtapa('agendada', { tipo: 'cliente_faltou' })).toBe('reagendar');
    // Agendou / remarcou → Agendado.
    expect(proximaEtapa('reagendar', { tipo: 'agendamento_remarcado' })).toBe('agendada');
    expect(proximaEtapa('em_conversa', { tipo: 'agendamento_criado' })).toBe('agendada');
    expect(proximaEtapa('em_conversa', { tipo: 'agendamento_criado' }, fora)).toBe('em_conversa');
    // Perda só com motivo: follow-ups esgotados = Sem resposta (não Perdido).
    expect(proximaEtapa('em_conversa', { tipo: 'followups_esgotados' })).toBe('sem_resposta');
    expect(proximaEtapa('agendada', { tipo: 'followups_esgotados' })).toBe('agendada');
    // IA: de Agendado só para Reagendar; não leva para Agendado/Finalizado por opinião.
    expect(proximaEtapa('agendada', { tipo: 'ia_classificou', etapa: 'reagendar' })).toBe('reagendar');
    expect(proximaEtapa('agendada', { tipo: 'ia_classificou', etapa: 'perdida' })).toBe('agendada');
    expect(proximaEtapa('em_conversa', { tipo: 'ia_classificou', etapa: 'compareceu' })).toBe('em_conversa');
    expect(REGRAS_MOTOR_PADRAO).toEqual({ voltouEscrever: true, lojaRespondeu: true, remarcar: true, agendou: true });
  });

  it('configuração: nasce ligada e preenchida; gravado parcial ou inválido volta ao padrão por regra', () => {
    expect(REGRAS_FUNIL_PADRAO).toMatchObject({ semResposta: { ligado: true, minutos: 60 }, alertaEntrada: { ligado: true, minutos: 10 }, remarcar: { tag: 'Quer remarcar' } });
    const r = normalizarRegrasFunil({ semResposta: { minutos: 15 }, finalizado: { minutos: -3 }, agendou: { ligado: false }, lixo: 1 });
    expect(r.semResposta).toEqual({ ligado: true, minutos: 15 });
    expect(r.finalizado).toEqual(REGRAS_FUNIL_PADRAO.finalizado);
    expect(r.agendou.ligado).toBe(false);
    expect(normalizarRegrasFunil(null)).toEqual(REGRAS_FUNIL_PADRAO);
  });

  it('horário da unidade: com horário, só aberta; sem nenhum horário cadastrado, sempre', () => {
    expect(unidadeAberta('norte', quinta(14))).toBe(true);
    expect(unidadeAberta('norte', quinta(4))).toBe(false);
    expect(unidadeAberta('feira', quinta(4))).toBe(true);
  });
});

describe.each(ambientes)('funil de atendimento ($nome)', (amb) => {
  it('o funil tem as etapas novas, uma "Agendado" por unidade que agenda (Sumaré e Norte na Império)', async () => {
    const { como, gente, sistema, funis } = await montarFunis(amb, { unidadesQueAgendam: UNIDADES });
    const etapas = ((await como(gente.carla, 'GET', '/api/funis')).json() as Array<{ id: string; etapas: EtapaJson[] }>).find((f) => f.id === sistema.id)!.etapas;
    expect(etapas.map((e) => e.nome)).toEqual(['Novo lead', 'Em atendimento', 'Reagendar', 'Sem resposta', 'Agendado Sumaré', 'Agendado Norte', 'Finalizado', 'Perdido']);
    expect(etapas.filter((e) => e.chaveSistema === 'agendada').map((e) => e.unidade)).toEqual(['sumare', 'norte']);
    // Idempotente.
    expect(await funis.conferirAgendados()).toBe(0);
  });

  it('empresa com uma unidade só: uma etapa "Agendado"', async () => {
    const { como, gente, sistema } = await montarFunis(amb, { unidadesQueAgendam: () => [{ id: 'norte', nome: 'Norte' }] });
    const etapas = ((await como(gente.carla, 'GET', '/api/funis')).json() as Array<{ id: string; etapas: EtapaJson[] }>).find((f) => f.id === sistema.id)!.etapas;
    expect(etapas.filter((e) => e.chaveSistema === 'agendada').map((e) => e.nome)).toEqual(['Agendado']);
  });

  it('Novo lead → loja respondeu → Em atendimento → 60 min sem resposta → Sem resposta → ela responde → Em atendimento', async () => {
    const m = await montarFunis(amb);
    const c = await m.conversa('norte', 'Marina');
    expect((await m.buscar(c.id)).etapa).toBe('entrada');
    m.avancar(2);
    await m.escreve(c, 'Oi Marina! Temos horário amanhã.', true);
    expect((await m.buscar(c.id)).etapa).toBe('em_conversa');
    m.avancar(59);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('em_conversa');
    m.avancar(2);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('sem_resposta');
    const ev = (await m.repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'etapa_mudou' && e.conversaId === c.id).at(-1)!;
    expect(ev.dados).toMatchObject({ de: 'em_conversa', para: 'sem_resposta', motivo: 'sem_resposta' });
    // O cartão acompanha (etapa do funil do sistema).
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa).toMatchObject({ id: m.etapasSistema.get('sem_resposta') });
    await m.escreve(c, 'Oi! Pode ser às 15h?');
    expect((await m.buscar(c.id)).etapa).toBe('em_conversa');
  });

  it('mover à mão vence: a equipe tira de Sem resposta e a regra não devolve; desligada, não move', async () => {
    const m = await montarFunis(amb);
    const c = await m.conversa('norte', 'Bia');
    await m.escreve(c, 'Oi Bia!', true);
    m.avancar(61);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('sem_resposta');
    expect((await m.como(m.gente.carla, 'POST', `/api/conversas/${c.id}/funis/${m.sistema.id}`, { etapaId: m.etapasSistema.get('em_conversa') })).statusCode).toBe(200);
    m.avancar(120);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('em_conversa');

    // Regra desligada pela tela: outra cliente fica em Em atendimento.
    expect((await m.como(m.gente.carla, 'PUT', '/api/funis/regras', { semResposta: { ligado: false } })).statusCode).toBe(403);
    const r = await m.como(m.gente.admin, 'PUT', '/api/funis/regras', { semResposta: { ligado: false } });
    expect(r.statusCode).toBe(200);
    expect(r.json().regras.semResposta).toEqual({ ligado: false, minutos: 60 });
    const d = await m.conversa('norte', 'Duda');
    await m.escreve(d, 'Oi Duda!', true);
    m.avancar(300);
    await m.tickRegras();
    expect((await m.buscar(d.id)).etapa).toBe('em_conversa');
  });

  it('tempo editável: 15 min; e a loja desligando "loja respondeu" deixa em Novo lead', async () => {
    const m = await montarFunis(amb);
    expect((await m.como(m.gente.admin, 'PUT', '/api/funis/regras', { semResposta: { minutos: 2 } })).statusCode).toBe(400);
    expect((await m.como(m.gente.admin, 'PUT', '/api/funis/regras', { semResposta: { minutos: 15 }, lojaRespondeu: { ligado: false } })).statusCode).toBe(200);
    const lida = (await m.como(m.gente.carla, 'GET', '/api/funis/regras')).json();
    expect(lida).toMatchObject({ podeEditar: false, regras: { semResposta: { minutos: 15 }, lojaRespondeu: { ligado: false } }, atualizadoPor: 'Bruno Batista' });
    expect(lida.etapas.map((e: EtapaJson) => e.nome)).toContain('Sem resposta');
    const c = await m.conversa('norte', 'Cris');
    await m.escreve(c, 'Oi Cris!', true);
    expect((await m.buscar(c.id)).etapa).toBe('entrada');
    await m.como(m.gente.admin, 'PUT', '/api/funis/regras', { lojaRespondeu: { ligado: true } });
    await m.regras.config(); // (cache de 10 s no máximo: a tela grava e limpa)
    await m.escreve(c, 'Tudo bem?', true);
    expect((await m.buscar(c.id)).etapa).toBe('em_conversa');
    m.avancar(16);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('sem_resposta');
  });

  it('agendou → Agendado da unidade do horário; remarcou em outra unidade → troca; passou o horário → Finalizado', async () => {
    const m = await montarFunis(amb, { unidadesQueAgendam: UNIDADES });
    const etapas = await m.funis.etapas(m.sistema.id);
    const ag = (u: string) => etapas.find((e) => e.chaveSistema === 'agendada' && e.unidade === u)!.id;
    const c = await m.conversa('norte', 'Ana');
    await m.escreve(c, 'Oi Ana!', true);
    // A equipe agenda no Sumaré (a conversa é do Norte): vai para "Agendado Sumaré".
    await m.sintonia.equipeAgendou(c.id, { tipo: 'agendou', agendamento: agendamento('sumare', quinta(16)), clienteTrinksId: 1 }, 'Carla Lima');
    expect((await m.buscar(c.id)).etapa).toBe('agendada');
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa!.id).toBe(ag('sumare'));
    // Remarcou para o Norte: "Agendado Norte".
    await m.sintonia.equipeMudouAgenda(c.id, [{ tipo: 'remarcou', antigo: { id: 1, unidade: 'sumare', inicio: '2026-11-05T16:00', servico: 'Progressiva' }, agendamento: agendamento('norte', quinta(17), 90), clienteTrinksId: 1, cancelouAntigo: true }], 'Carla Lima');
    expect((await m.buscar(c.id)).etapa).toBe('agendada');
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa!.id).toBe(ag('norte'));
    // Fim do horário 18:30 + 30 min: só depois das 19:00 vai para Finalizado.
    m.relogio.t = quinta(18, 50);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('agendada');
    m.relogio.t = quinta(19, 1);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('compareceu');
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa).toMatchObject({ id: m.etapasSistema.get('compareceu'), chaveSistema: 'compareceu' });
    // Voltou a escrever depois do atendimento: Novo lead de novo (para ser respondida).
    await m.escreve(c, 'Amei o cabelo!');
    expect((await m.buscar(c.id)).etapa).toBe('entrada');
  });

  it('Finalizado: a equipe tirou à mão depois do horário, a regra não devolve', async () => {
    const m = await montarFunis(amb);
    const c = await m.conversa('norte', 'Gabi');
    await m.sintonia.equipeAgendou(c.id, { tipo: 'agendou', agendamento: agendamento('norte', quinta(15)), clienteTrinksId: 2 }, 'Carla Lima');
    m.relogio.t = quinta(16, 10);
    // Antes da regra rodar, a equipe põe em Reagendar (ela não veio).
    await m.como(m.gente.carla, 'POST', `/api/conversas/${c.id}/funis/${m.sistema.id}`, { etapaId: m.etapasSistema.get('reagendar') });
    await m.como(m.gente.carla, 'POST', `/api/conversas/${c.id}/funis/${m.sistema.id}`, { etapaId: m.etapasSistema.get('agendada') });
    m.relogio.t = quinta(20);
    await m.tickRegras();
    expect((await m.buscar(c.id)).etapa).toBe('agendada');
  });

  it('pediu para remarcar (confirmação de agenda ou tag "Quer remarcar") → Reagendar; desligada, não move', async () => {
    const m = await montarFunis(amb);
    const c = await m.conversa('norte', 'Lu');
    await m.sintonia.equipeAgendou(c.id, { tipo: 'agendou', agendamento: agendamento('norte', quinta(18)), clienteTrinksId: 3 }, 'Carla Lima');
    await m.repo.registrarEvento({ tipo: 'confirmacao', conversaId: c.id, unidade: 'norte', em: m.relogio.t, dados: { status: 'remarcar' } });
    await m.regras.ocioso();
    expect((await m.buscar(c.id)).etapa).toBe('reagendar');
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa!.id).toBe(m.etapasSistema.get('reagendar'));

    const d = await m.conversa('norte', 'Rô');
    await m.escreve(d, 'Oi Rô!', true);
    const tag = await m.tags.criar({ nome: 'Quer remarcar' }, 'Sintonia');
    await m.tags.marcar(await m.buscar(d.id), tag.id, 'Sintonia');
    await m.regras.ocioso();
    expect((await m.buscar(d.id)).etapa).toBe('reagendar');

    await m.como(m.gente.admin, 'PUT', '/api/funis/regras', { remarcar: { ligado: false } });
    const e = await m.conversa('norte', 'Sil');
    await m.escreve(e, 'Oi Sil!', true);
    await m.tags.marcar(await m.buscar(e.id), tag.id, 'Sintonia');
    await m.regras.ocioso();
    expect((await m.buscar(e.id)).etapa).toBe('em_conversa');
  });

  it('lead parado em Novo lead há 10 min sem resposta: um alerta por mensagem; com resposta, nada', async () => {
    const m = await montarFunis(amb);
    const c = await m.conversa('norte', 'Tati');
    const r = await m.conversa('norte', 'Respondida');
    await m.escreve(r, 'Oi!', true);
    m.avancar(9);
    await m.tickRegras();
    const parados = async () => (await m.repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'lead_parado');
    expect(await parados()).toHaveLength(0);
    m.avancar(2);
    await m.tickRegras();
    await m.tickRegras();
    const ev = await parados();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ conversaId: c.id, dados: { minutos: 11, limite: 10 } });
    // Nova mensagem dela sem resposta: novo alerta depois de mais 10 min.
    await m.escreve(c, 'Alguém?');
    m.avancar(11);
    await m.tickRegras();
    expect(await parados()).toHaveLength(2);
    // Desligado: nada.
    await m.como(m.gente.admin, 'PUT', '/api/funis/regras', { alertaEntrada: { ligado: false } });
    await m.conversa('norte', 'Outra');
    m.avancar(30);
    await m.tickRegras();
    expect(await parados()).toHaveLength(2);
  });

  it('o alerta vira aviso no sino da dona/unidade e da gerência, uma vez só', async () => {
    const m = await montarFunis(amb);
    const armazem = new ArmazemNotificacoesMemoria();
    const n = new Notificador({ armazem, contas: m.contas, repo: m.repo, empresaId: 'imperio', agora: () => m.relogio.t });
    const c = await m.conversa('norte', 'Vera');
    const e = { tipo: 'lead_parado' as const, conversaId: c.id, unidade: 'norte', em: m.relogio.t, dados: { desde: m.relogio.t.toISOString(), minutos: 12, limite: 10 } };
    n.aoEvento(e);
    n.aoEvento(e);
    await n.ocioso();
    const carla = await armazem.listar(m.gente.carla.id, m.relogio.t, 20);
    const gerente = await armazem.listar(m.gente.gerenteNorte.id, m.relogio.t, 20);
    const rita = await armazem.listar(m.gente.rita.id, m.relogio.t, 20);
    expect(carla.map((x: { titulo: string }) => x.titulo)).toEqual(['Vera está esperando em Novo lead']);
    expect(gerente).toHaveLength(1);
    expect(rita).toHaveLength(0); // outra unidade
  });
});

describe.skipIf(!temPostgres)('migração 779 (postgres)', () => {
  it('leva os leads das etapas antigas para as novas sem perder ninguém nem o histórico', async () => {
    const m = await montarFunis(ambientes.find((a) => a.nome === 'postgres')!);
    const pool = await (async () => m.pool ?? (await poolDeTeste()))();
    const sistema = m.sistema.id;
    // Volta o funil para o jeito de antes (nomes e etapas antigas) e põe leads nelas.
    await pool.query(`delete from sintonia.tags where funil_id = $1 and chave_sistema in ('reagendar', 'sem_resposta')`, [sistema]);
    const antigas = [['novo_lead', 'Novo lead', 0], ['interessada', 'Interessada', 2], ['manutencao', 'Manutenção', 5]] as const;
    await pool.query(`update sintonia.tags set nome = 'Entrada de leads' where funil_id = $1 and chave_sistema = 'entrada'`, [sistema]);
    await pool.query(`update sintonia.tags set nome = 'Em conversa' where funil_id = $1 and chave_sistema = 'em_conversa'`, [sistema]);
    await pool.query(`update sintonia.tags set nome = 'Agendada' where funil_id = $1 and chave_sistema = 'agendada'`, [sistema]);
    await pool.query(`update sintonia.tags set nome = 'Compareceu' where funil_id = $1 and chave_sistema = 'compareceu'`, [sistema]);
    await pool.query(`update sintonia.tags set nome = 'Perdida' where funil_id = $1 and chave_sistema = 'perdida'`, [sistema]);
    const idTag: Record<string, string> = {};
    for (const [chave, nome, ordem] of antigas) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into sintonia.tags (id, empresa_id, nome, cor, ordem, criada_por, funil_id, chave_sistema) values (gen_random_uuid(), 'imperio', $1, '#0090FF', $2, 'sistema', $3, $4) returning id`,
        [nome, ordem, sistema, chave],
      );
      idTag[chave] = rows[0]!.id;
    }
    const nova = async (nome: string, etapa: string, conversou: boolean): Promise<Conversa> => {
      const c = await m.conversa('norte', nome);
      await pool.query(
        `update sintonia.conversas set etapa = $2, ultima_mensagem_equipe = case when $3 then ultima_mensagem_cliente + interval '1 minute' else null end, ultima_mensagem_ia = null where id = $1`,
        [c.id, etapa, conversou],
      );
      await pool.query(`update sintonia.conversa_tags set tag_id = $2 where conversa_id = $1 and funil_id = $3`, [c.id, idTag[etapa] ?? m.etapasSistema.get(etapa as never), sistema]);
      return c;
    };
    const semConversa = await nova('Planilha', 'novo_lead', false);
    const comConversa = await nova('Conversou', 'novo_lead', true);
    const interessada = await nova('Interessada', 'interessada', true);
    const manutencao = await nova('Manutencao', 'manutencao', true);
    const total = (await pool.query(`select count(*)::int as n from sintonia.conversas`)).rows[0].n;
    const eventosAntes = (await pool.query(`select count(*)::int as n from sintonia.eventos`)).rows[0].n;

    // Roda a migração de novo (ela é escrita para isso) dentro de uma transação, como o migrador.
    const sql = readFileSync(new URL('../db/migrations/779_funil_atendimento.sql', import.meta.url), 'utf8');
    const cli = await pool.connect();
    try {
      await cli.query('begin');
      await cli.query(sql);
      await cli.query('commit');
    } finally {
      cli.release();
    }

    const etapa = async (c: Conversa) => (await pool.query(`select etapa from sintonia.conversas where id = $1`, [c.id])).rows[0].etapa;
    expect(await etapa(semConversa)).toBe('entrada');
    expect(await etapa(comConversa)).toBe('em_conversa');
    expect(await etapa(interessada)).toBe('em_conversa');
    expect(await etapa(manutencao)).toBe('compareceu');
    expect((await pool.query(`select count(*)::int as n from sintonia.conversas`)).rows[0].n).toBe(total);
    // Histórico: o que já havia continua e cada mudança ganhou o seu evento.
    const novos = (await pool.query(`select conversa_id, dados from sintonia.eventos where tipo = 'etapa_mudou' and dados->>'motivo' = 'migracao_funil'`)).rows;
    expect(novos).toHaveLength(4);
    expect((await pool.query(`select count(*)::int as n from sintonia.eventos`)).rows[0].n).toBe(eventosAntes + 4);

    // Tela: nomes novos, etapas antigas escondidas (no banco com "(antiga)"), Reagendar e Sem resposta criadas.
    m.reiniciar();
    const etapas = await m.funis.etapas(sistema);
    expect(etapas.map((e) => e.nome)).toEqual(['Novo lead', 'Em atendimento', 'Reagendar', 'Sem resposta', 'Agendado', 'Finalizado', 'Perdido']);
    const guardadas = (await pool.query(`select nome from sintonia.tags where funil_id = $1 and chave_sistema in ('novo_lead','interessada','manutencao') order by ordem`, [sistema])).rows.map((r) => r.nome);
    expect(guardadas).toEqual(['Novo lead (antiga)', 'Interessada (antiga)', 'Manutenção (antiga)']);
    // Cada cartão está na etapa da conversa.
    for (const [c, chave] of [[semConversa, 'entrada'], [comConversa, 'em_conversa'], [interessada, 'em_conversa'], [manutencao, 'compareceu']] as const) {
      expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa).toMatchObject({ chaveSistema: chave });
    }
    // Rodar de novo não muda nada.
    const cli2 = await pool.connect();
    try {
      await cli2.query('begin');
      await cli2.query(sql);
      await cli2.query('commit');
    } finally {
      cli2.release();
    }
    expect((await pool.query(`select count(*)::int as n from sintonia.eventos where dados->>'motivo' = 'migracao_funil'`)).rows[0].n).toBe(4);

  });
});

describe('agendados: a etapa "Agendado" sem unidade vira a da 1ª unidade e os leads vão para a da conversa', () => {
  it.each(ambientes)('$nome', async (amb) => {
    const m = await montarFunis(amb);
    const c = await m.conversa('norte', 'Nina');
    const s = await m.conversa('sumare', 'Sol');
    for (const x of [c, s]) await m.sintonia.equipeAgendou(x.id, { tipo: 'agendou', agendamento: agendamento(x.unidade, quinta(18)), clienteTrinksId: 5 }, 'Carla Lima');
    // Até aqui, sem unidades que agendam: uma etapa "Agendado" só.
    const generica = m.etapasSistema.get('agendada')!;
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa!.id).toBe(generica);
    // Agora a empresa tem duas unidades com agenda.
    const funis = m.funis as unknown as { o: { unidadesQueAgendam?: () => Array<{ id: string; nome: string }> } };
    funis.o.unidadesQueAgendam = UNIDADES;
    expect(await m.funis.conferirAgendados()).toBe(2);
    const etapas = await m.funis.etapas(m.sistema.id);
    const de = (u: string) => etapas.find((e) => e.chaveSistema === 'agendada' && e.unidade === u)!;
    expect(de('sumare').id).toBe(generica);
    expect(de('sumare').nome).toBe('Agendado Sumaré');
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa!.id).toBe(de('norte').id);
    expect((await m.funis.daConversa(await m.buscar(s.id)))[0]!.etapa!.id).toBe(de('sumare').id);
    // Sincronizar ao subir não desfaz.
    await m.funis.sincronizarSistema();
    expect((await m.funis.daConversa(await m.buscar(c.id)))[0]!.etapa!.id).toBe(de('norte').id);
  });
});

void AgenteFalso;

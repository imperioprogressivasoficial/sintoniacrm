import { describe, expect, it } from 'vitest';
import type { Conversa } from '../src/domain.js';
import { decidirQuemResponde, equipeAtuou } from '../src/engine/atendimento.js';
import { proximaEtapa } from '../src/engine/etapas.js';
import { followupsSemAgendamento, lembretesDoAgendamento, posAtendimento } from '../src/engine/followups.js';
import { ajustarParaJanelaAtiva, estaAberta } from '../src/engine/horario.js';
import { UNIDADES } from '../src/unidades.js';
import { bahia, dataISO, horaHHmm, MIN } from '../src/util/tempo.js';
import { normalizarCelular, telefoneDoJid } from '../src/util/telefone.js';

const norte = UNIDADES.norte;
// Quinta-feira, 5/11/2026
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

function conversa(extra: Partial<Conversa> = {}): Conversa {
  return {
    id: 'c1',
    empresaId: 'imperio',
    unidade: 'norte',
    canalId: 'imperio-norte',
    telefone: '5571988124471',
    modo: 'copiloto',
    etapa: 'em_conversa',
    etiquetas: [],
    criadaEm: quinta(9),
    atualizadaEm: quinta(9),
    ...extra,
  };
}

describe('horário', () => {
  it('Bahia é UTC-3', () => {
    expect(quinta(14, 30).toISOString()).toBe('2026-11-05T17:30:00.000Z');
    expect(horaHHmm(quinta(14, 30))).toBe('14:30');
    expect(dataISO(bahia(2026, 11, 5, 23, 59))).toBe('2026-11-05');
  });

  it('loja aberta das 10h às 22h em dia de semana', () => {
    expect(estaAberta(norte, quinta(9, 59))).toBe(false);
    expect(estaAberta(norte, quinta(10))).toBe(true);
    expect(estaAberta(norte, quinta(21, 59))).toBe(true);
    expect(estaAberta(norte, quinta(22))).toBe(false);
  });

  it('envio ativo nunca sai de madrugada', () => {
    expect(ajustarParaJanelaAtiva(quinta(23)).getTime()).toBe(bahia(2026, 11, 6, 8).getTime());
    expect(ajustarParaJanelaAtiva(quinta(3)).getTime()).toBe(quinta(8).getTime());
    expect(ajustarParaJanelaAtiva(quinta(15)).getTime()).toBe(quinta(15).getTime());
  });
});

describe('quem responde', () => {
  it('fora do horário a IA responde na hora', () => {
    const c = conversa({ ultimaMensagemCliente: quinta(2) });
    const d = decidirQuemResponde(c, norte, quinta(2, 1));
    expect(d.acao).toBe('ia_responde');
  });

  it('em horário, no copiloto, sugere e só assume depois de 15 min sem resposta', () => {
    const c = conversa({ ultimaMensagemCliente: quinta(14) });
    const antes = decidirQuemResponde(c, norte, quinta(14, 5));
    expect(antes.acao).toBe('sugerir');
    if (antes.acao === 'sugerir') expect(antes.reavaliarEm.getTime()).toBe(quinta(14, 15).getTime());
    const depois = decidirQuemResponde(c, norte, quinta(14, 15));
    expect(depois).toMatchObject({ acao: 'ia_responde', assumiu: true });
  });

  it('modo "Só eu": a IA nunca responde, nem de madrugada', () => {
    const c = conversa({ modo: 'humano', ultimaMensagemCliente: quinta(2) });
    expect(decidirQuemResponde(c, norte, quinta(3)).acao).toBe('nada');
  });

  it('atendente digitando: a IA espera, mesmo no modo IA', () => {
    const c = conversa({ modo: 'ia', ultimaMensagemCliente: quinta(14), pausaIaAte: quinta(14, 10) });
    expect(decidirQuemResponde(c, norte, quinta(14, 2)).acao).toBe('aguardar');
    expect(decidirQuemResponde(c, norte, quinta(14, 11)).acao).toBe('ia_responde');
  });

  it('nada a fazer se a última palavra já foi da loja', () => {
    const c = conversa({ ultimaMensagemCliente: quinta(14), ultimaMensagemEquipe: quinta(14, 2) });
    expect(decidirQuemResponde(c, norte, quinta(15)).acao).toBe('nada');
  });

  it('quando a equipe atua, a IA vira copiloto e pausa 10 min', () => {
    const r = equipeAtuou(conversa({ modo: 'ia' }), quinta(14));
    expect(r.modo).toBe('copiloto');
    expect(r.pausaIaAte!.getTime()).toBe(quinta(14).getTime() + 10 * MIN);
    expect(equipeAtuou(conversa({ modo: 'humano' }), quinta(14)).modo).toBe('humano');
  });
});

describe('funil automático', () => {
  it('a IA não tira ninguém de Agendada', () => {
    expect(proximaEtapa('agendada', { tipo: 'ia_classificou', etapa: 'perdida' })).toBe('agendada');
  });
  it('a IA não pode marcar Agendada por opinião', () => {
    expect(proximaEtapa('interessada', { tipo: 'ia_classificou', etapa: 'agendada' })).toBe('interessada');
  });
  it('fatos do Trinks movem as etapas importantes', () => {
    expect(proximaEtapa('interessada', { tipo: 'agendamento_criado' })).toBe('agendada');
    expect(proximaEtapa('agendada', { tipo: 'atendimento_finalizado' })).toBe('compareceu');
    expect(proximaEtapa('agendada', { tipo: 'cliente_faltou' })).toBe('interessada');
    expect(proximaEtapa('compareceu', { tipo: 'manutencao_vencida' })).toBe('manutencao');
  });
  it('cliente perdida que volta a falar reabre a conversa', () => {
    expect(proximaEtapa('perdida', { tipo: 'mensagem_cliente' })).toBe('em_conversa');
    expect(proximaEtapa('novo_lead', { tipo: 'mensagem_cliente' })).toBe('em_conversa');
  });
});

describe('lembretes e follow-ups', () => {
  it('lembrete na véspera às 10h e 2h antes', () => {
    const inicio = bahia(2026, 11, 7, 15);
    const l = lembretesDoAgendamento(inicio, quinta(12));
    expect(l.map((x) => x.tipo)).toEqual(['lembrete_vespera', 'lembrete_2h']);
    expect(l[0]!.quando.getTime()).toBe(bahia(2026, 11, 6, 10).getTime());
    expect(l[1]!.quando.getTime()).toBe(bahia(2026, 11, 7, 13).getTime());
  });

  it('horário das 9h não ganha lembrete às 7h', () => {
    const l = lembretesDoAgendamento(bahia(2026, 11, 7, 9), quinta(12));
    expect(l.map((x) => x.tipo)).toEqual(['lembrete_vespera']);
  });

  it('follow-up da noite vai para a manhã seguinte', () => {
    const f = followupsSemAgendamento(quinta(21, 0));
    expect(f[0]!.tipo).toBe('followup_1h');
    expect(f[0]!.quando.getTime()).toBe(bahia(2026, 11, 6, 8).getTime());
  });

  it('manutenção em 90 dias às 10h', () => {
    const p = posAtendimento(quinta(17));
    expect(dataISO(p[1]!.quando)).toBe('2027-02-03');
    expect(horaHHmm(p[1]!.quando)).toBe('10:00');
  });
});

describe('telefone', () => {
  it('normaliza formatos comuns para 55 + DDD + 9', () => {
    expect(normalizarCelular('(71) 98812-4471')).toBe('5571988124471');
    expect(normalizarCelular('557188124471')).toBe('5571988124471');
    expect(normalizarCelular('+55 75 99188-2290')).toBe('5575991882290');
    expect(normalizarCelular('7133334444')).toBeNull(); // fixo
  });
  it('lê o JID do WhatsApp e ignora grupos', () => {
    expect(telefoneDoJid('5571988124471@s.whatsapp.net')).toBe('5571988124471');
    expect(telefoneDoJid('120363025@g.us')).toBeNull();
  });
});

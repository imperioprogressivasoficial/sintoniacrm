import { describe, expect, it } from 'vitest';
import { horariosLivres, instante } from '../src/reunioes/reunioes.js';

const link = { duracao_min: 30, dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '11:00', antecedencia_h: 2, janela_dias: 7 };

describe('Link de agendamento: horários livres', () => {
  it('só dias escolhidos, de 30 em 30 min, respeitando a antecedência (fuso da Bahia)', () => {
    // sexta 20/11/2026 às 08:00 na Bahia
    const agora = instante('2026-11-20', '08:00');
    const r = horariosLivres(link, [], agora);
    expect(r[0]).toEqual({ data: '2026-11-20', horarios: ['10:00', '10:30'] });
    expect(r.map((d) => d.data)).toEqual(['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']);
    expect(r[1]!.horarios).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });
  it('tira o horário já marcado', () => {
    const agora = instante('2026-11-20', '08:00');
    const marcada = { inicio: instante('2026-11-23', '09:30'), fim: instante('2026-11-23', '10:00') };
    expect(horariosLivres(link, [marcada], agora)[1]!.horarios).toEqual(['09:00', '10:00', '10:30']);
  });
});

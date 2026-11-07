import { describe, expect, it } from 'vitest';
import { ETAPAS, type Etapa } from '../src/domain.js';
import { FOTOS_CLIENTES_F, FOTOS_CLIENTES_M, MATERIAL_ESTETICA } from '../src/demo/dados.js';
import { gerarPlano, type ContextoGerador } from '../src/demo/gerador.js';

const ctx = (segmento?: ContextoGerador['segmento']): ContextoGerador => ({
  agora: new Date('2026-11-07T21:00:00Z'),
  empresaId: 'imperio',
  atendentes: [
    { id: 'a1', nome: 'Camila Moreira', unidade: 'norte', ritmo: [1, 6] },
    { id: 'a2', nome: 'Beatriz Nunes', unidade: 'norte', ritmo: [3, 14] },
    { id: 'a3', nome: 'Larissa Moura', unidade: 'sumare', ritmo: [2, 9] },
    { id: 'a4', nome: 'Daniela Reis', unidade: 'sumare', ritmo: [5, 24] },
  ],
  sistema: { funilId: 'f', etapas: Object.fromEntries(ETAPAS.map((e) => [e, 't-' + e])) as Record<Etapa, string> },
  tags: Object.fromEntries(MATERIAL_ESTETICA.tags.map(([n]) => [n, 'tag-' + n])),
  campos: {},
  segmento,
});

describe('gerador de demonstração: segmento e fotos', () => {
  it('cada cliente ganha foto de perfil, sem repetir no topo da lista', () => {
    const p = gerarPlano(ctx());
    expect(p.fotos.length).toBe(p.conversas.length);
    const todas = new Set([...FOTOS_CLIENTES_F, ...FOTOS_CLIENTES_M]);
    expect(p.fotos.every((f) => todas.has(f.arquivo))).toBe(true);
    const porTel = new Map(p.fotos.map((f) => [f.telefone, f.arquivo]));
    const topo = [...p.conversas].sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime()).slice(0, 10).map((c) => porTel.get(c.telefone));
    expect(new Set(topo).size).toBe(topo.length);
  });

  it('a clínica de estética não fala de salão', () => {
    const p = gerarPlano(ctx('estetica'));
    const textos = [...p.mensagens.map((m) => m.texto), ...p.eventos.map((e) => JSON.stringify(e.dados ?? {}))].join('\n');
    expect(textos).not.toMatch(/progressiva|selagem|cabelo|Império|Salvador Norte|Sumaré/i);
    expect(textos).toMatch(/Harmonização facial/);
    expect(textos).toMatch(/Jardins|Itaim/);
  });

  it('o padrão continua sendo a Império (salão)', () => {
    const p = gerarPlano(ctx());
    expect(p.mensagens.map((m) => m.texto).join('\n')).toMatch(/progressiva/i);
  });
});

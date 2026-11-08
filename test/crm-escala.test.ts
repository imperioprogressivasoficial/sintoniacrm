import { describe, expect, it } from 'vitest';
import { ambientes, montarFunis } from './funis-ambiente.js';

/**
 * CRM em escala: milhares de cartões no quadro. Nunca carrega o funil inteiro: cada coluna vem paginada,
 * os totais e as "paradas" vêm de um agregado no servidor e a busca devolve no máximo 20 resultados.
 */
interface Coluna {
  etapa: { id: string; nome: string; chaveSistema: string | null };
  total: number;
  paradas: number;
  cartoes: Array<{ conversaId: string; nome: string; atualizadaEm: string; valor: number | null }>;
  mais: boolean;
  proximo: string | null;
}

const pg = ambientes.find((a) => a.nome === 'postgres');
const N = 4000;

describe.skipIf(!pg)('CRM em escala (postgres)', () => {
  it(`quadro com ${N} cartões: páginas pequenas, totais certos, cursor, busca e valor — rápido`, { timeout: 60_000 }, async () => {
    const m = await montarFunis(pg!);
    const pool = m.pool!;
    const agora = m.relogio.t;
    const etapas = [...m.etapasSistema.entries()];
    // Semeia direto no banco: N conversas espalhadas pelas etapas do funil do sistema; 1 em 5 está parada há 5 dias.
    await pool.query(
      `insert into sintonia.conversas (id, empresa_id, unidade, canal_id, telefone, nome, modo, etapa, criada_em, atualizada_em)
       select gen_random_uuid(), 'imperio', case when i % 2 = 0 then 'norte' else 'sumare' end, 'imperio-norte',
              '557199' || lpad(i::text, 7, '0'), 'Cliente ' || lpad(i::text, 5, '0'), 'humano',
              (array['novo_lead','em_conversa','interessada','agendada','compareceu','manutencao','perdida'])[1 + i % 7],
              $1::timestamptz - make_interval(mins => i), $1::timestamptz - make_interval(mins => i)
         from generate_series(1, $2::int) as i`,
      [agora, N],
    );
    await pool.query(
      `insert into sintonia.conversa_tags (conversa_id, tag_id, funil_id, marcada_por, marcada_em)
       select c.id, t.id, t.funil_id, 'semente', case when right(c.telefone, 1) in ('0', '5') then $2::timestamptz - interval '5 days' else $2::timestamptz end
         from sintonia.conversas c join sintonia.tags t on t.funil_id = $1 and t.chave_sistema = c.etapa
        where c.empresa_id = 'imperio'
       on conflict do nothing`,
      [m.sistema.id, agora],
    );
    await pool.query('analyze sintonia.conversas; analyze sintonia.conversa_tags');
    const esperado = new Map((await pool.query<{ tag_id: string; n: number; paradas: number }>(
      `select tag_id::text, count(*)::int as n, (count(*) filter (where marcada_em < $2))::int as paradas from sintonia.conversa_tags where funil_id = $1 group by tag_id`,
      [m.sistema.id, new Date(agora.getTime() - 3 * 24 * 3600_000)],
    )).rows.map((r) => [r.tag_id, r]));

    const url = `/api/funis/${m.sistema.id}/quadro?limite=25`;
    await m.como(m.gente.admin, 'GET', url); // aquece
    let t0 = performance.now();
    const q = (await m.como(m.gente.admin, 'GET', url)).json() as { colunas: Coluna[] };
    const msQuadro = performance.now() - t0;
    expect(q.colunas).toHaveLength(etapas.length);
    let soma = 0;
    for (const c of q.colunas) {
      const e = esperado.get(c.etapa.id)!;
      expect(c.total).toBe(e.n);
      expect(c.paradas).toBe(e.paradas);
      expect(c.cartoes.length).toBe(Math.min(25, e.n));
      expect(c.mais).toBe(e.n > 25);
      soma += c.total;
    }
    expect(soma).toBe(N);

    // Carregar mais por cursor: as próximas 25, sem repetir e na mesma ordem (última atividade primeiro).
    const col = q.colunas.find((c) => c.mais)!;
    t0 = performance.now();
    const p2 = (await m.como(m.gente.admin, 'GET', `${url}&etapaId=${col.etapa.id}&apos=${encodeURIComponent(col.proximo!)}`)).json() as { colunas: Coluna[] };
    const msMais = performance.now() - t0;
    const segunda = p2.colunas[0]!;
    expect(segunda.cartoes).toHaveLength(25);
    const ids = new Set(col.cartoes.map((c) => c.conversaId));
    expect(segunda.cartoes.some((c) => ids.has(c.conversaId))).toBe(false);
    const datas = [...col.cartoes, ...segunda.cartoes].map((c) => new Date(c.atualizadaEm).getTime());
    expect(datas).toEqual([...datas].sort((a, b) => b - a));
    // O cursor equivale ao offset.
    const porOffset = (await m.como(m.gente.admin, 'GET', `${url}&etapaId=${col.etapa.id}&offset=25`)).json() as { colunas: Coluna[] };
    expect(porOffset.colunas[0]!.cartoes.map((c) => c.conversaId)).toEqual(segunda.cartoes.map((c) => c.conversaId));

    // A atendente do Norte só conta e vê o Norte.
    const daCarla = (await m.como(m.gente.carla, 'GET', url)).json() as { colunas: Coluna[] };
    expect(daCarla.colunas.reduce((s, c) => s + c.total, 0)).toBe(N / 2);

    // Busca: nome (prefixo vem primeiro) e dígitos do telefone; no máximo 20; sem esconder o quadro.
    t0 = performance.now();
    const porNome = (await m.como(m.gente.admin, 'GET', `/api/funis/${m.sistema.id}/buscar?q=Cliente%20012`)).json() as Array<{ nome: string; etapa: { nome: string } }>;
    const msBusca = performance.now() - t0;
    expect(porNome).toHaveLength(20);
    expect(porNome.every((a) => a.nome.startsWith('Cliente 012'))).toBe(true);
    expect(porNome[0]!.etapa.nome).toBeTruthy();
    const porTel = (await m.como(m.gente.admin, 'GET', `/api/funis/${m.sistema.id}/buscar?q=0003999`)).json() as Array<{ nome: string }>;
    expect(porTel.map((a) => a.nome)).toEqual(['Cliente 03999']);
    expect((await m.como(m.gente.admin, 'GET', `/api/funis/${m.sistema.id}/buscar?q=zzzz`)).json()).toEqual([]);
    expect((await m.como(m.gente.carla, 'GET', `/api/funis/${m.sistema.id}/buscar?q=Cliente%2003999`)).json()).toEqual([]); // Sumaré: não é dela

    // Valor do negócio no cartão.
    const alvo = col.cartoes[0]!.conversaId;
    expect((await m.como(m.gente.carla, 'PUT', `/api/conversas/${alvo}/valor`, { valor: 220 })).statusCode).toBe(404); // não vê
    expect((await m.como(m.gente.admin, 'PUT', `/api/conversas/${alvo}/valor`, { valor: -1 })).statusCode).toBe(400);
    expect((await m.como(m.gente.admin, 'PUT', `/api/conversas/${alvo}/valor`, { valor: 220 })).json()).toEqual({ valor: 220 });
    const depois = (await m.como(m.gente.admin, 'GET', `${url}&etapaId=${col.etapa.id}`)).json() as { colunas: Coluna[] };
    expect(depois.colunas[0]!.cartoes.find((c) => c.conversaId === alvo)!.valor).toBe(220);

    console.log(`CRM com ${N} cartões: quadro (7 colunas × 25) ${msQuadro.toFixed(0)} ms · carregar mais ${msMais.toFixed(0)} ms · busca ${msBusca.toFixed(0)} ms`);
    expect(msQuadro).toBeLessThan(1500);
    expect(msMais).toBeLessThan(800);
    expect(msBusca).toBeLessThan(800);
  });
});

describe.each(ambientes)('Busca e valor do CRM ($nome)', (amb) => {
  it('busca devolve etapa e dona; valor aparece no cartão; filtro de dona no servidor', async () => {
    const m = await montarFunis(amb);
    const ana = await m.conversa('norte', 'Ana Paula');
    await m.conversa('norte', 'Mariana');
    const r = (await m.como(m.gente.admin, 'GET', `/api/funis/${m.sistema.id}/buscar?q=ana`)).json() as Array<{ conversaId: string; nome: string; etapa: { nome: string } }>;
    expect(r.map((x) => x.nome)).toEqual(['Ana Paula', 'Mariana']); // quem começa com "ana" vem primeiro
    expect(r[0]!.etapa.nome).toBe('Em conversa');
    expect((await m.como(m.gente.admin, 'GET', `/api/funis/${m.sistema.id}/buscar?q=a`)).json()).toEqual([]); // 1 letra: nada
    await m.como(m.gente.admin, 'PUT', `/api/conversas/${ana.id}/valor`, { valor: 180.5 });
    expect((await m.como(m.gente.admin, 'GET', `/api/conversas/${ana.id}/valor`)).json()).toEqual({ valor: 180.5 });
    const q = (await m.como(m.gente.admin, 'GET', `/api/funis/${m.sistema.id}/quadro?dona=sem`)).json() as { colunas: Coluna[] };
    const cartoes = q.colunas.flatMap((c) => c.cartoes);
    expect(cartoes.find((c) => c.conversaId === ana.id)!.valor).toBe(180.5);
    const deNinguem = (await m.como(m.gente.admin, 'GET', `/api/funis/${m.sistema.id}/quadro?dona=${m.gente.carla.id}`)).json() as { colunas: Coluna[] };
    expect(deNinguem.colunas.reduce((s, c) => s + c.total, 0)).toBe(0);
  });
});

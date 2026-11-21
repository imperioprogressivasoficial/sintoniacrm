import { describe, expect, it } from 'vitest';
import { montarPosVenda, ParamsPosVenda } from '../src/automacoes/modelos.js';
import { preencher } from '../src/automacoes/esquema.js';
import { calcularNps, configNpsPadrao, lerNota, normalizarConfigNps, TEXTOS_NPS } from '../src/nps/tipos.js';
import { HORA } from '../src/util/tempo.js';
import { ambientes, montarFunis } from './funis-ambiente.js';

describe('pesquisa de satisfação: leitura da nota', () => {
  it('aceita as formas comuns de responder', () => {
    const casos: Array<[string, number]> = [
      ['10', 10],
      ['nota 9', 9],
      ['9/10', 9],
      ['9 / 10', 9],
      ['8 de 10', 8],
      ['Nota: 7', 7],
      ['dou 10!!', 10],
      ['0', 0],
      ['dez', 10],
      ['nota dez', 10],
      ['uma nota dez', 10],
      ['nota um', 1],
      ['10 👏👏', 10],
      ['Nota 10, adorei o atendimento!', 10],
      ['minha nota é 6', 6],
      ['10 10 10', 10],
    ];
    for (const [t, n] of casos) expect(lerNota(t)?.nota, t).toBe(n);
  });

  it('recusa o que não é nota', () => {
    for (const t of ['Oi', 'quero marcar amanhã às 10', 'dia 10 pode?', 'às 9', 'custa R$ 10?', '9,5', '8.5', '11', '100', '10h', '7 ou 8', '3 dias', '10:30', '', 'Meu telefone é 71988124471'])
      expect(lerNota(t), t).toBeNull();
  });

  it('separa o comentário que veio junto com a nota', () => {
    expect(lerNota('Nota 10, adorei o atendimento!')).toEqual({ nota: 10, comentario: 'Nota 10, adorei o atendimento!' });
    expect(lerNota('nota 9')).toEqual({ nota: 9, comentario: null });
    expect(lerNota('10 obrigada')).toEqual({ nota: 10, comentario: null });
  });

  it('calcula o NPS (promotores − detratores)', () => {
    expect(calcularNps([10, 9, 8, 7, 6, 0])).toEqual({ nps: 0, total: 6, promotores: 2, neutros: 2, detratores: 2 });
    expect(calcularNps([10, 10, 9, 5])).toMatchObject({ nps: 50 });
    expect(calcularNps([])).toMatchObject({ nps: null, total: 0 });
  });

  it('configuração estragada volta ao padrão campo a campo (e os textos nascem vazios: sem-exemplos)', () => {
    expect(configNpsPadrao()).toMatchObject({ ligada: false, pergunta: '', textoComentario: '', agradecimento: '' });
    const c = normalizarConfigNps({ ligada: true, pergunta: '', validadeHoras: 'x', linkAvaliacao: 'javascript:alert(1)' });
    expect(c.ligada).toBe(true);
    expect(c.pergunta).toBe('');
    expect(c.validadeHoras).toBe(72);
    expect(c.linkAvaliacao).toBe('');
  });

  it('{link_avaliacao} e outras variáveis da empresa entram na mensagem da automação', () => {
    expect(preencher('Avalie: {link_avaliacao}', { nome: 'Ana', unidade: 'Norte' }, { link_avaliacao: 'https://g.page/r/abc' })).toBe('Avalie: https://g.page/r/abc');
  });

  it('pós-venda pronto: cuidados no dia seguinte, retorno no dia X e avaliação para 9–10', () => {
    const [cuidados, avaliacao] = montarPosVenda(ParamsPosVenda.parse({ diasRetorno: 45 }));
    expect(cuidados!.gatilho).toEqual({ tipo: 'atendimento_finalizado', motivos: ['venda_feita'] });
    const esperas = cuidados!.passos.filter((p) => p.tipo === 'esperar').map((p) => (p as { minutos: number }).minutos / 1440);
    expect(esperas).toEqual([1, 30, 14]); // 1 dia, depois 44 dias em passos de até 30
    expect(cuidados!.opcoes.parar_se_equipe_responder).toBe(false);
    expect(avaliacao!.gatilho).toEqual({ tipo: 'nota_nps', min: 9, max: 10 });
    const [soCompareceu] = montarPosVenda(ParamsPosVenda.parse({ comeca: 'compareceu', pedirAvaliacao: false, diasRetorno: 20 }));
    expect(soCompareceu!.gatilho).toEqual({ tipo: 'dias_apos_compareceu', dias: 1 });
    expect(soCompareceu!.passos[0]).toMatchObject({ tipo: 'enviar_mensagem' });
    expect(montarPosVenda(ParamsPosVenda.parse({ pedirAvaliacao: false }))).toHaveLength(1);
  });
});

describe.each(ambientes)('Finalizar atendimento e NPS ($nome)', (amb) => {
  async function preparar(ligada = true) {
    const m = await montarFunis(amb, { nps: true });
    if (ligada) {
      // sem-exemplos: os textos nascem vazios; sem a pergunta, não liga.
      const sem = await m.como(m.gente.admin, 'PUT', '/api/nps/config', { ligada: true });
      expect(sem.statusCode).toBe(400);
      expect(sem.json().erro ?? sem.json().message).toContain('pergunta');
      const r = await m.como(m.gente.admin, 'PUT', '/api/nps/config', { ligada: true, ...TEXTOS_NPS, linkAvaliacao: 'https://g.page/r/empresa/review' });
      expect(r.statusCode, r.body).toBe(200);
    }
    const textos = () => m.enviados.map((e) => e.texto);
    return { ...m, textos };
  }

  it('finaliza, manda a pesquisa, lê a nota e o comentário (a IA não responde ao "10")', async () => {
    const m = await preparar();
    const c = await m.conversa('norte', 'Marina Souza');
    await m.como(m.gente.carla, 'POST', `/api/conversas/${c.id}/assumir`);
    const antes = m.enviados.length;
    const r = await m.como(m.gente.carla, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'venda_feita', observacao: 'Fechou o pacote' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, pesquisa: { estado: 'aguardando_nota' }, aviso: null });
    expect(m.textos().slice(antes)).toEqual([expect.stringContaining('De 0 a 10')]);
    expect(m.textos().at(-1)).toContain('Marina!');

    const n1 = m.enviados.length;
    await m.escreve(c, 'nota 9');
    // Só a pergunta do comentário (a resposta automática conta como resposta: a IA não fala junto).
    expect(m.textos().slice(n1)).toEqual([expect.stringContaining('conte em poucas palavras')]);
    await m.escreve(c, 'Atendimento rápido e educado');
    expect(m.textos().at(-1)).toContain('Muito obrigado, Marina');

    const h = (await m.como(m.gente.carla, 'GET', `/api/conversas/${c.id}/finalizar`)).json() as { pesquisas: Array<Record<string, unknown>>; finalizacoes: Array<Record<string, unknown>> };
    expect(h.finalizacoes[0]).toMatchObject({ motivo: 'venda_feita', observacao: 'Fechou o pacote', atendenteNome: 'Carla Lima', porNome: 'Carla Lima' });
    expect(h.pesquisas[0]).toMatchObject({ estado: 'respondida', nota: 9, comentario: 'Atendimento rápido e educado', atendenteNome: 'Carla Lima' });

    // Depois de respondida, outro número é conversa normal (não vira nota de novo).
    await m.escreve(c, '10');
    expect(((await m.como(m.gente.carla, 'GET', `/api/conversas/${c.id}/finalizar`)).json() as { pesquisas: unknown[] }).pesquisas).toHaveLength(1);

    const eventos = await m.repo.eventosEntre(new Date(0), new Date(m.relogio.t.getTime() + 1));
    expect(eventos.filter((e) => e.tipo === 'atendimento_finalizado')).toHaveLength(1);
    expect(eventos.find((e) => e.tipo === 'nps')?.dados).toMatchObject({ nota: 9, categoria: 'promotor', atendenteNome: 'Carla Lima' });
  });

  it('resposta que não é nota segue normal; pergunta no lugar do comentário fecha sem comentário; prazo vence', async () => {
    const m = await preparar();
    const c = await m.conversa('norte', 'Joana Lima');
    await m.sintonia.mudarModo(c.id, 'ia');
    await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'resolvido' });
    await m.escreve(c, 'Vocês abrem amanhã às 10?');
    let h = (await m.como(m.gente.admin, 'GET', `/api/conversas/${c.id}/finalizar`)).json() as { pesquisas: Array<Record<string, unknown>> };
    expect(h.pesquisas[0]).toMatchObject({ estado: 'aguardando_nota', nota: null });
    expect(m.textos().at(-1)).toBe('Sugestão'); // não era nota: a IA respondeu normalmente
    const n = m.enviados.length;
    await m.escreve(c, '3');
    expect(m.textos().slice(n)).toEqual([expect.stringContaining('conte em poucas palavras')]); // e não responde ao "3"
    await m.escreve(c, 'Qual o endereço?');
    h = (await m.como(m.gente.admin, 'GET', `/api/conversas/${c.id}/finalizar`)).json() as { pesquisas: Array<Record<string, unknown>> };
    expect(h.pesquisas[0]).toMatchObject({ estado: 'respondida', nota: 3, comentario: null });

    // Outra finalização, sem resposta: vence no prazo (72 h).
    const c2 = await m.conversa('norte', 'Paula Reis');
    await m.como(m.gente.admin, 'POST', `/api/conversas/${c2.id}/finalizar`, { motivo: 'agendado' });
    m.relogio.t = new Date(m.relogio.t.getTime() + 73 * HORA);
    expect(await m.nps!.tick()).toBe(1);
    await m.escreve(c2, '10');
    h = (await m.como(m.gente.admin, 'GET', `/api/conversas/${c2.id}/finalizar`)).json() as { pesquisas: Array<Record<string, unknown>> };
    expect(h.pesquisas[0]).toMatchObject({ estado: 'expirada', nota: null });
  });

  it('respeita a configuração: desligada, motivo fora da lista e "não enviar desta vez"', async () => {
    const m = await preparar(false);
    const c = await m.conversa('norte', 'Rosa');
    const n = m.enviados.length;
    let r = await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'resolvido' });
    expect(r.json()).toMatchObject({ ok: true, pesquisa: null });
    await m.como(m.gente.admin, 'PUT', '/api/nps/config', { ligada: true });
    r = await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'sem_interesse' });
    expect(r.json()).toMatchObject({ pesquisa: null });
    r = await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'resolvido', enviarPesquisa: false });
    expect(r.json()).toMatchObject({ pesquisa: null });
    expect(m.enviados.length).toBe(n);
    expect((await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'qualquer' })).statusCode).toBe(400);
    // Só a gestão mexe na configuração; quem não vê a conversa não finaliza.
    expect((await m.como(m.gente.carla, 'PUT', '/api/nps/config', { ligada: false })).statusCode).toBe(403);
    const deSumare = await m.conversa('sumare', 'Lia');
    expect((await m.como(m.gente.carla, 'POST', `/api/conversas/${deSumare.id}/finalizar`, { motivo: 'resolvido' })).statusCode).toBe(404);
    expect((await m.como(m.gente.admin, 'PUT', '/api/nps/config', { linkAvaliacao: 'ftp://x' })).statusCode).toBe(400);
  });

  it('gatilhos "atendimento finalizado" (motivo) e "nota NPS" (faixa); {link_avaliacao} na mensagem', async () => {
    const m = await preparar();
    const criar = async (corpo: Record<string, unknown>) => {
      const r = await m.como(m.gente.admin, 'POST', '/api/automacoes', { ligada: true, ...corpo });
      expect(r.statusCode, r.body).toBe(201);
      return r.json() as { id: string };
    };
    await criar({ nome: 'Ao vender', gatilho: { tipo: 'atendimento_finalizado', motivos: ['venda_feita'] }, passos: [{ tipo: 'enviar_mensagem', texto: 'Obrigado pela compra, {primeiro_nome}!', so_no_horario: false }] });
    await criar({ nome: 'Promotora', gatilho: { tipo: 'nota_nps', min: 9, max: 10 }, passos: [{ tipo: 'enviar_mensagem', texto: 'Avalie: {link_avaliacao}', so_no_horario: false }] });
    await criar({ nome: 'Detratora', gatilho: { tipo: 'nota_nps', min: 0, max: 6 }, passos: [{ tipo: 'enviar_mensagem', texto: 'Sentimos muito, {primeiro_nome}.', so_no_horario: false }] });
    expect((await m.como(m.gente.admin, 'POST', '/api/automacoes', { nome: 'x', gatilho: { tipo: 'nota_nps', min: 8, max: 3 }, passos: [{ tipo: 'esperar', minutos: 1 }] })).statusCode).toBe(400);

    const a = await m.conversa('norte', 'Ana Paula');
    await m.como(m.gente.admin, 'POST', `/api/conversas/${a.id}/finalizar`, { motivo: 'resolvido' });
    expect(m.textos()).not.toContain('Obrigado pela compra, Ana!');
    await m.como(m.gente.admin, 'POST', `/api/conversas/${a.id}/finalizar`, { motivo: 'venda_feita' });
    expect(m.textos()).toContain('Obrigado pela compra, Ana!');
    await m.escreve(a, '10');
    await m.automacoes.ocioso();
    expect(m.textos()).toContain('Avalie: https://g.page/r/empresa/review');
    expect(m.textos()).not.toContain('Sentimos muito, Ana.');

    const b = await m.conversa('norte', 'Bela');
    await m.como(m.gente.admin, 'POST', `/api/conversas/${b.id}/finalizar`, { motivo: 'resolvido' });
    await m.escreve(b, 'nota 2');
    await m.automacoes.ocioso();
    expect(m.textos()).toContain('Sentimos muito, Bela.');
    expect(m.textos().filter((t) => t.startsWith('Avalie:'))).toHaveLength(1);
  });

  it('resultado: NPS geral e por atendente, só para quem vê relatórios', async () => {
    const m = await preparar();
    const responder = async (nome: string, quem: typeof m.gente.carla, nota: string) => {
      const c = await m.conversa('norte', nome);
      await m.como(quem, 'POST', `/api/conversas/${c.id}/assumir`);
      await m.como(quem, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'resolvido' });
      await m.escreve(c, nota);
    };
    await responder('A', m.gente.carla, '10');
    await responder('B', m.gente.carla, '9');
    await responder('C', m.gente.bia, '5');
    await responder('D', m.gente.bia, '8');
    const r = await m.como(m.gente.admin, 'GET', '/api/nps/resumo?periodo=7d');
    expect(r.statusCode, r.body).toBe(200);
    const d = r.json() as { nps: number; total: number; enviadas: number; taxaResposta: number; porAtendente: Array<{ nome: string; nps: number; total: number }>; distribuicao: number[]; finalizados: number };
    expect(d).toMatchObject({ nps: 25, total: 4, enviadas: 4, taxaResposta: 100, finalizados: 4 });
    expect(d.porAtendente).toEqual([expect.objectContaining({ nome: 'Carla Lima', nps: 100, total: 2 }), expect.objectContaining({ nome: 'Bia Souza', nps: -50, total: 2 })]);
    expect(d.distribuicao[10]).toBe(1);
    const so = (await m.como(m.gente.admin, 'GET', `/api/nps/resumo?periodo=7d&atendente=${m.gente.bia.id}`)).json() as { nps: number; total: number };
    expect(so).toMatchObject({ nps: -50, total: 2 });
    expect((await m.como(m.gente.carla, 'GET', '/api/nps/resumo')).statusCode).toBe(403);
    const csv = await m.como(m.gente.admin, 'GET', '/api/nps/csv?periodo=30d');
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Carla Lima');
  });

  it('sem-exemplos: as rotas do pós-venda pronto saíram; o gerador ainda funciona de ponta a ponta (futura Ajuda)', async () => {
    const m = await preparar(false);
    expect((await m.como(m.gente.admin, 'GET', '/api/automacoes/modelos')).statusCode).toBe(404);
    expect((await m.como(m.gente.admin, 'POST', '/api/automacoes/modelos/pos-venda', { diasRetorno: 30 })).statusCode).toBe(404);
    expect((await m.como(m.gente.admin, 'GET', '/api/automacoes')).json()).toEqual([]); // nada nasce sozinho
    await m.como(m.gente.admin, 'PUT', '/api/nps/config', { linkAvaliacao: 'https://g.page/r/xyz/review' });
    for (const a of montarPosVenda(ParamsPosVenda.parse({ diasRetorno: 30 }))) expect((await m.como(m.gente.admin, 'POST', '/api/automacoes', a)).statusCode).toBe(201);

    // Funciona de ponta a ponta: finalizou com venda → no dia seguinte, a mensagem de cuidados.
    const c = await m.conversa('norte', 'Clara');
    await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/finalizar`, { motivo: 'venda_feita' });
    const n = m.enviados.length;
    m.avancar(25 * 60);
    await m.tick();
    expect(m.textos().slice(n).some((t) => t.includes('como você está depois do nosso atendimento'))).toBe(true);
  });
});

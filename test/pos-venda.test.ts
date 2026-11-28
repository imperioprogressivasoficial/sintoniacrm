import { describe, expect, it } from 'vitest';
import { ehGrupo, pediuParaNaoReceber } from '../src/automacoes/limites.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemPosVendaMemoria, ArmazemPosVendaPostgres, ETAPAS_POS_VENDA, PosVenda, TEXTOS_POS_VENDA } from '../src/pos-venda/pos-venda.js';
import { registrarPosVenda } from '../src/pos-venda/rotas.js';
import { ambientes, montarFunis } from './funis-ambiente.js';

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const T = TEXTOS_POS_VENDA.salao;
/** Começo do texto de reserva (para achar a mensagem entre as enviadas). */
const inicio = (t: string) => t.replace('{primeiro_nome}', 'Ana').slice(0, 30);

type Extras = NonNullable<Parameters<typeof montarFunis>[1]>['automacoes'];

async function preparar(amb: (typeof ambientes)[number], o: { extras?: Extras } = {}) {
  const sairam = new Set<string>();
  const ia = { ligada: false };
  const m = await montarFunis(amb, {
    automacoes: {
      descadastrado: async (tel) => sairam.has(tel),
      descadastrar: async (tel) => {
        sairam.add(tel);
      },
      escreverComIa: async (_c, objetivo) => (ia.ligada ? `Escrita pela IA (${objetivo.slice(0, 12)})` : undefined),
      ...o.extras,
    },
  });
  if (m.pool) await m.pool.query('truncate sintonia.pos_venda_config');
  const armazem = m.pool ? new ArmazemPosVendaPostgres(m.pool) : new ArmazemPosVendaMemoria(m.repo, m.armazemTags);
  const posVenda = new PosVenda({ armazem, funis: m.funis, automacoes: m.automacoes, empresaId: 'imperio', agora: () => m.relogio.t, estiloPadrao: 'salao' });
  registrarPosVenda(m.app, { posVenda, repo: m.repo });
  const etapaPv = async (c: Conversa) => {
    const cfg = await posVenda.config();
    const id = cfg.funilId ? await m.funis.etapaNoFunil(c.id, cfg.funilId) : null;
    return id ? (await m.funis.etapas(cfg.funilId!)).find((e) => e.id === id)?.nome ?? null : null;
  };
  const moverSistema = async (c: Conversa, chave: string) => {
    const r = await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/funis/${m.sistema.id}`, { etapaId: m.etapasSistema.get(chave) });
    if (r.statusCode >= 300) throw new Error(`mover: ${r.statusCode} ${r.body}`);
  };
  /** Atendimento terminou: Agendada → Compareceu (Finalizado). */
  const atendida = async (c: Conversa) => {
    await moverSistema(c, 'agendada');
    await moverSistema(c, 'compareceu');
  };
  const agendou = async (c: Conversa) => {
    await m.automacoes.aoEvento({ tipo: 'agendamento_equipe', conversaId: c.id, unidade: c.unidade, em: m.relogio.t, dados: { trinksId: Math.round(Math.random() * 1e6) } });
    await m.automacoes.ocioso();
  };
  const dias = async (n: number) => {
    // Anda de hora em hora para o relógio pegar cada espera (como no servidor, que confere a cada minuto).
    for (let h = 0; h < n * 24; h++) {
      m.avancar(60);
      await m.tick();
    }
  };
  const para = (c: Conversa) => m.enviados.filter((e) => e.telefone === c.telefone).map((e) => e.texto);
  const conta = (c: Conversa, texto: string) => para(c).filter((t) => t.startsWith(inicio(texto))).length;
  return { ...m, posVenda, sairam, ia, etapaPv, moverSistema, atendida, agendou, dias, para, conta };
}

describe('pós-venda: regras simples', () => {
  it('reconhece "não quero mais receber" e grupos', () => {
    for (const t of ['SAIR', 'Parar!', 'não quero mais receber mensagens', 'Pode parar de me mandar mensagem, obrigada', 'me tira dessa lista', 'Não me mande mais nada']) expect(pediuParaNaoReceber(t), t).toBe(true);
    for (const t of ['quero agendar', 'não quero mais esperar, tem horário hoje?', 'cancelar', 'obrigada!', 'vou parar de usar chapinha']) expect(pediuParaNaoReceber(t), t).toBe(false);
    expect(ehGrupo('120363025871234567@g.us')).toBe(true);
    expect(ehGrupo('120363025871234567-1612345678')).toBe(true);
    expect(ehGrupo('5571988130001')).toBe(false);
  });
});

describe.each(ambientes)('pós-venda ($nome)', (amb) => {
  it('cria a sugestão uma vez, não duplica nem sobrescreve; o botão recria depois de apagado', async () => {
    const m = await preparar(amb);
    expect(await m.posVenda.semear('salao')).toBe(true);
    expect(await m.posVenda.semear('salao')).toBe(false);
    const cfg = await m.posVenda.config();
    expect(cfg.funil?.nome).toBe('Pós-venda');
    expect(cfg.funil?.acaoPrincipal).toBe('agendar'); // botão do cartão no celular: Agendar a volta
    expect((await m.funis.etapas(cfg.funilId!)).map((e) => e.nome)).toEqual(['Entrada de leads', ...Object.values(ETAPAS_POS_VENDA).map((e) => e.nome)]);
    const autos = (await m.automacoes.listar()).filter((a) => a.nome.startsWith('Pós-venda'));
    expect(autos.map((a) => a.nome).sort()).toEqual([
      'Pós-venda: começa no Finalizado',
      'Pós-venda: Conscientização',
      'Pós-venda: Retorno 30 dias',
      'Pós-venda: Manutenção 60 dias',
      'Pós-venda: Retorno 90 dias',
      'Pós-venda: Inativa',
      'Pós-venda: Voltou (agendou de novo)',
    ].sort());
    expect(autos.every((a) => a.ligada && a.opcoes.respeitar_limites)).toBe(true);
    const entrada = autos.find((a) => a.nome === 'Pós-venda: começa no Finalizado')!;
    const retorno = autos.find((a) => a.nome === 'Pós-venda: Retorno 30 dias')!;
    expect(entrada.gatilho).toEqual({ tipo: 'entrou_na_etapa', etapaId: m.etapasSistema.get('compareceu') });

    // A equipe edita uma automação e uma etapa: a semente não mexe em nada.
    await m.automacoes.alterar(retorno.id, { nome: 'Retorno de 1 mês' });
    expect(await m.posVenda.semear('salao')).toBe(false);
    expect((await m.automacoes.exigir(retorno.id)).nome).toBe('Retorno de 1 mês');
    expect((await m.automacoes.listar()).length).toBe(autos.length);

    // Botão: já existe → 409.
    expect((await m.como(m.gente.admin, 'POST', '/api/pos-venda/sugerido', {})).statusCode).toBe(409);
    expect((await m.como(m.gente.carla, 'POST', '/api/pos-venda/sugerido', {})).statusCode).toBe(403);

    // Apagou o funil: a semente não volta sozinha; a do Finalizado fica desligada; o botão recria.
    await m.funis.apagar(cfg.funilId!);
    expect(await m.posVenda.semear('salao')).toBe(false);
    expect((await m.automacoes.exigir(entrada.id)).ligada).toBe(false);
    const r = await m.como(m.gente.admin, 'POST', '/api/pos-venda/sugerido', {});
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ funilNome: 'Pós-venda', metaVisitas: 4, automacoes: 7 });

    // Um funil "Pós-venda" feito pela equipe nunca é tocado.
    const m2 = await preparar(amb);
    await m2.funis.criar({ nome: 'Pós-venda', etapas: [{ nome: 'Ligar' }] }, 'Bruno');
    expect(await m2.posVenda.semear('salao')).toBe(false);
    expect((await m2.automacoes.listar()).length).toBe(0);
    expect((await m2.como(m2.gente.admin, 'POST', '/api/pos-venda/sugerido', {})).statusCode).toBe(409);
  });

  it('entra no Finalizado e anda por tempo até Inativa, com mensagens; não duplica quando passa duas vezes', async () => {
    const m = await preparar(amb);
    await m.posVenda.semear('salao');
    const c = await m.conversa('norte', 'Ana Paula');
    await m.atendida(c);
    expect(await m.etapaPv(c)).toBe('Conscientização');
    // Passou de novo pelo Finalizado no mesmo dia: continua uma só.
    await m.atendida(c);
    expect(await m.etapaPv(c)).toBe('Conscientização');

    await m.dias(1);
    expect(m.conta(c, T.obrigada.texto)).toBe(1);
    await m.dias(3);
    expect(m.conta(c, T.foto.texto)).toBe(1);
    expect(await m.etapaPv(c)).toBe('Conscientização');
    await m.dias(27);
    expect(await m.etapaPv(c)).toBe('Retorno 30 dias');
    expect(m.conta(c, T.retorno30.texto)).toBe(1);
    await m.dias(30);
    expect(await m.etapaPv(c)).toBe('Manutenção 60 dias');
    expect(m.conta(c, T.manutencao60.texto)).toBe(1);
    m.ia.ligada = true; // a partir daqui a IA escreve (com o objetivo); sem IA iria o texto de reserva
    await m.dias(30);
    expect(await m.etapaPv(c)).toBe('Retorno 90 dias');
    expect(m.para(c).filter((t) => t.startsWith('Escrita pela IA')).length).toBe(1);
    m.ia.ligada = false;
    await m.dias(11);
    expect(m.conta(c, T.lembrete90.texto)).toBe(1); // não respondeu ao convite: lembrete
    await m.dias(21);
    expect(await m.etapaPv(c)).toBe('Inativa');
    expect(m.conta(c, T.inativa.texto)).toBe(1);
    // Nada repetido no caminho todo.
    for (const k of ['obrigada', 'foto', 'retorno30', 'manutencao60', 'inativa'] as const) expect(m.conta(c, T[k].texto), k).toBe(1);
  });

  it('agendou de novo: vai para Voltou, sai das esperas e recomeça depois do novo atendimento (a visita conta)', async () => {
    const m = await preparar(amb);
    await m.posVenda.semear('salao');
    const c = await m.conversa('norte', 'Ana Paula');
    await m.atendida(c);
    await m.dias(31);
    expect(await m.etapaPv(c)).toBe('Retorno 30 dias');
    const antes = m.para(c).length;

    await m.agendou(c);
    expect(await m.etapaPv(c)).toBe('Voltou');
    const retorno30 = (await m.automacoes.listar()).find((a) => a.nome === 'Pós-venda: Retorno 30 dias')!;
    const ex = await m.automacoes.execucoes(retorno30.id);
    expect(ex[0]).toMatchObject({ status: 'cancelada', erro: 'A cliente saiu da etapa.' });
    await m.dias(31);
    expect(await m.etapaPv(c)).toBe('Voltou'); // não andou para Manutenção 60 dias
    expect(m.para(c).length).toBe(antes);

    // Quem não está no pós-venda e agenda não entra em Voltou.
    const nova = await m.conversa('norte', 'Bia Nova');
    await m.agendou(nova);
    expect(await m.etapaPv(nova)).toBeNull();

    await m.atendida(c);
    expect(await m.etapaPv(c)).toBe('Conscientização');
    await m.dias(1);
    expect(m.conta(c, T.obrigada.texto)).toBe(2);
    expect((await m.posVenda.daConversa(c)).visitasAno).toBe(2);
  });

  it('pediu para não receber mais: para tudo para ela, inclusive no próximo ciclo', async () => {
    const m = await preparar(amb);
    await m.posVenda.semear('salao');
    const c = await m.conversa('norte', 'Ana Paula');
    await m.atendida(c);
    await m.dias(1);
    expect(m.conta(c, T.obrigada.texto)).toBe(1);
    await m.escreve(c, 'Por favor, não quero mais receber mensagens');
    expect(m.sairam.has(c.telefone)).toBe(true);
    const consc = (await m.automacoes.listar()).find((a) => a.nome === 'Pós-venda: Conscientização')!;
    expect((await m.automacoes.execucoes(consc.id))[0]).toMatchObject({ status: 'cancelada', erro: 'A cliente pediu para não receber mais mensagens.' });
    const n = m.para(c).length;
    await m.dias(35);
    expect(await m.etapaPv(c)).toBe('Conscientização'); // o caminho parou
    expect(m.para(c).length).toBe(n);
    // Nova visita: entra de novo no funil, mas nenhuma mensagem sai.
    await m.atendida(c);
    await m.dias(2);
    expect(m.para(c).length).toBe(n);
  });

  it('respeita o limite da semana do follow-up: pula a mensagem e segue o caminho', async () => {
    const m = await preparar(amb, { extras: { limiteSemana: async () => 2, enviadosFollowup: async () => 2 } });
    await m.posVenda.semear('salao');
    const c = await m.conversa('norte', 'Ana Paula');
    await m.atendida(c);
    await m.dias(31);
    expect(m.conta(c, T.obrigada.texto)).toBe(0);
    expect(m.conta(c, T.foto.texto)).toBe(0);
    expect(await m.etapaPv(c)).toBe('Retorno 30 dias');
    const consc = (await m.automacoes.listar()).find((a) => a.nome === 'Pós-venda: Conscientização')!;
    const ex = (await m.automacoes.execucoes(consc.id))[0]!;
    expect(ex.status).toBe('concluida');
    expect(ex.log.some((l) => /Mensagem pulada: a cliente já recebeu 2/.test(l.detalhe))).toBe(true);
  });

  it('conta as visitas no ano (12 meses, um dia conta uma vez), mostra no quadro e na ficha; meta editável', async () => {
    const m = await preparar(amb);
    await m.posVenda.semear('salao');
    const ana = await m.conversa('norte', 'Ana Paula');
    const bia = await m.conversa('sumare', 'Bia Lima');
    const visita = (c: Conversa, diasAtras: number) =>
      m.repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c.id, unidade: c.unidade, em: new Date(m.relogio.t.getTime() - diasAtras * DIA), dados: { de: 'agendada', para: 'compareceu' } });
    await visita(ana, 400); // mais de 12 meses: não conta
    await visita(ana, 200);
    await visita(ana, 100);
    await m.atendida(ana); // hoje (entra no pós-venda)
    await m.atendida(ana); // de novo hoje: o mesmo dia conta uma vez
    await m.atendida(bia);
    expect((await m.posVenda.visitas([ana.id, bia.id])).get(ana.id)).toBe(3);

    const ficha = (await m.como(m.gente.admin, 'GET', `/api/pos-venda/conversas/${ana.id}`)).json();
    expect(ficha).toMatchObject({ visitasAno: 3, meta: 4, etapa: { nome: 'Conscientização' } });
    expect(ficha.dias).toHaveLength(3);
    expect((await m.como(m.gente.carla, 'GET', `/api/pos-venda/conversas/${bia.id}`)).statusCode).toBe(404); // Carla só vê o Norte

    const cfg = await m.posVenda.config();
    const q = await m.posVenda.decorarQuadro(await m.funis.quadro(cfg.funilId!, { escopo: { empresaId: 'imperio' }, offset: 0, limite: 50 }));
    expect('posVenda' in q && q.posVenda).toMatchObject({ meta: 4, media: 2, clientes: 2, naMeta: 0 });
    const cartoes = q.colunas.flatMap((col) => col.cartoes) as Array<{ conversaId: string; visitasAno?: number }>;
    expect(cartoes.find((x) => x.conversaId === ana.id)?.visitasAno).toBe(3);
    expect(cartoes.find((x) => x.conversaId === bia.id)?.visitasAno).toBe(1);
    // Outro funil passa sem mexer.
    const outro = await m.funis.quadro(m.sistema.id, { escopo: { empresaId: 'imperio' }, offset: 0, limite: 50 });
    expect('posVenda' in (await m.posVenda.decorarQuadro(outro))).toBe(false);

    expect((await m.como(m.gente.carla, 'PATCH', '/api/pos-venda', { metaVisitas: 3 })).statusCode).toBe(403);
    expect((await m.como(m.gente.admin, 'PATCH', '/api/pos-venda', { metaVisitas: 0 })).statusCode).toBe(400);
    const r = await m.como(m.gente.admin, 'PATCH', '/api/pos-venda', { metaVisitas: 3 });
    expect(r.json()).toMatchObject({ metaVisitas: 3, resumo: { meta: 3, naMeta: 1 } });
    expect((await m.como(m.gente.carla, 'GET', '/api/pos-venda')).json()).toMatchObject({ metaVisitas: 3, funilNome: 'Pós-venda' });
  });
});

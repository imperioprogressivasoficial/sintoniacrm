import { describe, expect, it } from 'vitest';
import { Agente } from '../src/ai/agente.js';
import type { Agenda } from '../src/ai/ferramentas.js';
import { casaPalavra, preencher } from '../src/automacoes/esquema.js';
import { proximaAbertura } from '../src/engine/horario.js';
import type { Conversa } from '../src/domain.js';
import { UNIDADES } from '../src/unidades.js';
import { bahia } from '../src/util/tempo.js';
import { AgenteFalso, ambientes, montarFunis, quinta } from './funis-ambiente.js';

type FunilJson = { id: string; etapas: Array<{ id: string; nome: string }> };
type ExecJson = { id: string; status: string; erro: string | null; chave: string; proximaEm: string; teste: boolean; log: Array<{ passo: string; ok: boolean; detalhe: string }> };
type AutoJson = { id: string; nome: string; ligada: boolean; opcoes: { parar_se_equipe_responder: boolean }; passos: Array<Record<string, unknown>> };

async function preparar(amb: (typeof ambientes)[number], opcoes: Parameters<typeof montarFunis>[1] = {}) {
  const m = await montarFunis(amb, opcoes);
  const funil = (await m.como(m.gente.admin, 'POST', '/api/funis', { nome: 'Vendas', etapas: [{ nome: 'Lead' }, { nome: 'Proposta' }, { nome: 'Ganhou' }] })).json() as FunilJson;
  const [lead, proposta, ganhou] = funil.etapas as [FunilJson['etapas'][number], FunilJson['etapas'][number], FunilJson['etapas'][number]];
  const criar = async (corpo: Record<string, unknown>): Promise<AutoJson> => {
    const r = await m.como(m.gente.admin, 'POST', '/api/automacoes', { ligada: true, ...corpo });
    if (r.statusCode !== 201) throw new Error(`criar automação: ${r.statusCode} ${r.body}`);
    return r.json();
  };
  const execucoes = async (id: string) => (await m.como(m.gente.admin, 'GET', `/api/automacoes/${id}/execucoes`)).json() as ExecJson[];
  const mover = (c: Conversa, etapaId: string) => m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/funis/${funil.id}`, { etapaId });
  const textos = () => m.enviados.map((e) => e.texto);
  return { ...m, funil, lead, proposta, ganhou, criar, execucoes, mover, textos };
}

describe.each(ambientes)('Automações: cadastro ($nome)', (amb) => {
  it('CRUD, permissões, validação dos passos e configuração', async () => {
    const { como, gente, funil, lead, proposta, sistema, etapasSistema, criar } = await preparar(amb);
    const base = { nome: 'Boas-vindas', funilId: funil.id, gatilho: { tipo: 'entrou_na_etapa', etapaId: lead.id }, passos: [{ tipo: 'enviar_mensagem', texto: 'Oi {primeiro_nome}!' }] };
    expect((await como(gente.carla, 'POST', '/api/automacoes', base)).statusCode).toBe(403);
    expect((await como(gente.carla, 'GET', '/api/automacoes')).statusCode).toBe(403);
    const r = await como(gente.gerenteNorte, 'POST', '/api/automacoes', base);
    expect(r.statusCode).toBe(201);
    const a = r.json() as AutoJson;
    expect(a).toMatchObject({ nome: 'Boas-vindas', ligada: false, opcoes: { parar_se_equipe_responder: true }, passos: [{ tipo: 'enviar_mensagem', so_no_horario: true }] });

    const recusa = async (corpo: Record<string, unknown>) => (await como(gente.admin, 'POST', '/api/automacoes', { ...base, ...corpo })).statusCode;
    expect(await recusa({ gatilho: { tipo: 'entrou_na_etapa', etapaId: '00000000-0000-0000-0000-000000000000' } })).toBe(400);
    expect(await recusa({ gatilho: { tipo: 'entrou_na_etapa', etapaId: etapasSistema.get('agendada') } })).toBe(400); // etapa de outro funil
    expect(await recusa({ passos: [{ tipo: 'enviar_mensagem', texto: '   ' }] })).toBe(400);
    expect(await recusa({ passos: [] })).toBe(400);
    expect(await recusa({ passos: [{ tipo: 'voar' }] })).toBe(400);
    expect(await recusa({ passos: [{ tipo: 'esperar', minutos: 0 }] })).toBe(400);
    expect(await recusa({ passos: [{ tipo: 'mover_etapa', funilId: sistema.id, etapaId: proposta.id }] })).toBe(400);
    expect(await recusa({ passos: [{ tipo: 'desmarcar_tag', tagId: etapasSistema.get('agendada') }] })).toBe(400);
    expect(await recusa({ passos: [{ tipo: 'atribuir', usuarioId: 'ninguem' }] })).toBe(400);
    expect(await recusa({ passos: [{ tipo: 'condicao', se: 'modo', valor: 'voando' }] })).toBe(400);
    const fundo = (n: number): Record<string, unknown> => (n === 0 ? { tipo: 'esperar', minutos: 1 } : { tipo: 'condicao', se: 'horario_loja', entao: [fundo(n - 1)] });
    expect(await recusa({ passos: [fundo(3)] })).toBe(400);
    expect(await recusa({ passos: [fundo(2)] })).toBe(201);

    // Geral (sem funil), com o bot.
    const bot = await criar({ nome: 'Preço', gatilho: { tipo: 'palavra_chave', palavras: ['preço'] }, passos: [{ tipo: 'fluxo_ia', objetivo: 'agendar a avaliação' }] });
    expect(((await como(gente.admin, 'GET', '/api/automacoes?funilId=geral')).json() as AutoJson[]).map((x) => x.nome)).toEqual(['Preço']);
    expect(((await como(gente.admin, 'GET', `/api/automacoes?funilId=${funil.id}`)).json() as AutoJson[]).map((x) => x.nome)).toEqual(['Boas-vindas', 'Boas-vindas']);

    // Alterar, ligar, desligar, apagar.
    expect((await como(gente.admin, 'PATCH', `/api/automacoes/${a.id}`, { nome: 'Recepção', opcoes: { parar_se_equipe_responder: false } })).json()).toMatchObject({
      nome: 'Recepção',
      opcoes: { parar_se_equipe_responder: false },
    });
    expect((await como(gente.admin, 'PATCH', `/api/automacoes/${a.id}`, { passos: [{ tipo: 'esperar', minutos: -1 }] })).statusCode).toBe(400);
    expect((await como(gente.admin, 'POST', `/api/automacoes/${a.id}/ligar`)).json()).toMatchObject({ ligada: true });
    expect((await como(gente.admin, 'POST', `/api/automacoes/${a.id}/desligar`)).json()).toMatchObject({ ligada: false });
    expect((await como(gente.carla, 'POST', `/api/automacoes/${a.id}/ligar`)).statusCode).toBe(403);
    expect((await como(gente.admin, 'GET', `/api/automacoes/${a.id}/execucoes`)).json()).toEqual([]);
    expect((await como(gente.admin, 'DELETE', `/api/automacoes/${bot.id}`)).json()).toEqual({ ok: true });
    expect((await como(gente.admin, 'GET', `/api/automacoes/${bot.id}`)).statusCode).toBe(404);

    // Configuração (limite diário).
    expect((await como(gente.admin, 'GET', '/api/automacoes/config')).json()).toEqual({ limiteDiario: 3 });
    expect((await como(gente.carla, 'PATCH', '/api/automacoes/config', { limiteDiario: 5 })).statusCode).toBe(403);
    expect((await como(gente.admin, 'PATCH', '/api/automacoes/config', { limiteDiario: 5 })).json()).toEqual({ limiteDiario: 5 });
    expect((await como(gente.admin, 'PATCH', '/api/automacoes/config', { limiteDiario: 99 })).statusCode).toBe(400);

    // Apagar o funil leva as automações dele.
    await como(gente.admin, 'DELETE', `/api/funis/${funil.id}`);
    expect(((await como(gente.admin, 'GET', '/api/automacoes')).json() as AutoJson[]).length).toBe(0);
  });
});

describe.each(ambientes)('Automações: gatilhos e passos ($nome)', (amb) => {
  it('entrou_na_etapa: atribuir, enviar com variáveis, marcar tag, mudar modo e lembrete em "Ligar hoje"', async () => {
    const { como, gente, conversa, criar, mover, proposta, execucoes, repo, tags, buscar, textos } = await preparar(amb);
    const vip = (await como(gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
    const a = await criar({
      nome: 'Proposta enviada',
      gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id },
      passos: [
        { tipo: 'atribuir', usuarioId: gente.carla.id },
        { tipo: 'enviar_mensagem', texto: 'Oi {primeiro_nome}, aqui é {atendente} da {unidade}!' },
        { tipo: 'marcar_tag', tagId: vip.id },
        { tipo: 'mudar_modo', modo: 'humano' },
        { tipo: 'atribuir', usuarioId: gente.rita.id, unidade: 'sumare' },
        { tipo: 'lembrete_ligacao', em_minutos: 60, texto: 'Ligar para {primeiro_nome}' },
      ],
    });
    const c = await conversa('norte', 'Marina Souza');
    await mover(c, proposta.id);
    expect(textos()).toContain('Oi Marina, aqui é Carla Lima da Salvador Norte Shopping!');
    const depois = await buscar(c.id);
    expect(depois).toMatchObject({ responsavelId: gente.carla.id, modo: 'humano' });
    expect(await tags.temTag(c.id, vip.id)).toBe(true);
    const msgs = await repo.mensagens(c.id);
    expect(msgs.find((x) => x.autorNome === 'Automação: Proposta enviada')).toMatchObject({ autor: 'ia', texto: 'Oi Marina, aqui é Carla Lima da Salvador Norte Shopping!' });
    const [e] = await execucoes(a.id);
    expect(e).toMatchObject({ status: 'concluida', erro: null });
    expect(e!.log.map((l) => l.passo)).toEqual(['inicio', 'atribuir', 'enviar_mensagem', 'marcar_tag', 'mudar_modo', 'atribuir', 'lembrete_ligacao', 'fim']);
    expect(e!.log[5]!.detalhe).toContain('Pulado');
    const ev = await repo.eventosEntre(quinta(0), quinta(23, 59));
    expect(ev.filter((x) => x.tipo === 'transferencia').at(-1)!.dados).toMatchObject({ paraId: gente.carla.id, motivo: 'automacao' });
    // O lembrete aparece em "Ligar hoje" para quem vê a conversa (com a hora).
    const lig = (await como(gente.carla, 'GET', '/api/ligacoes')).json() as { sugestoes: Array<{ conversaId: string; motivo: string; texto: string }> };
    expect(lig.sugestoes.find((s) => s.conversaId === c.id)).toMatchObject({ motivo: 'lembrete', texto: 'Ligar para Marina (às 15:00)' });
    // Depois de ligar, sai da lista.
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/ligacao`, { resultado: 'atendeu' });
    expect(((await como(gente.carla, 'GET', '/api/ligacoes')).json() as { sugestoes: unknown[] }).sugestoes).toEqual([]);
  });

  it('mover_etapa encadeia outra automação; laço infinito para no limite de encadeamento', async () => {
    const { conversa, criar, mover, lead, proposta, ganhou, execucoes, repo, tags, funil } = await preparar(amb, { maxEncadeamento: 3 });
    // A: entrou em Lead → move para Proposta. B: entrou em Proposta → move para Lead (laço!).
    const a = await criar({ nome: 'A', gatilho: { tipo: 'entrou_na_etapa', etapaId: lead.id }, passos: [{ tipo: 'mover_etapa', funilId: funil.id, etapaId: proposta.id }] });
    const b = await criar({ nome: 'B', gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id }, passos: [{ tipo: 'mover_etapa', funilId: funil.id, etapaId: lead.id }] });
    const c = await conversa('norte', 'Marina');
    await mover(c, lead.id);
    const ea = await execucoes(a.id);
    const eb = await execucoes(b.id);
    // Profundidade 0 (A), 1 (B), 2 (A), 3 (B); a 4ª não dispara.
    expect(ea.length + eb.length).toBe(4);
    expect([...ea, ...eb].every((e) => e.status === 'concluida')).toBe(true);
    const falha = (await repo.eventosEntre(quinta(0), quinta(23))).find((e) => e.tipo === 'falha');
    expect(falha!.dados).toMatchObject({ etapa: 'automacao', erro: 'limite de encadeamento de automações' });
    expect(await tags.temTag(c.id, lead.id)).toBe(true);
    expect(await tags.temTag(c.id, ganhou.id)).toBe(false);
  });

  it('condição: tem_tag, modo, cliente_respondeu e horário da loja escolhem o ramo', async () => {
    const { como, gente, conversa, escreve, criar, mover, proposta, execucoes, textos, avancar, tick } = await preparar(amb);
    const vip = (await como(gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
    const a = await criar({
      nome: 'Ramos',
      gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id },
      passos: [
        { tipo: 'condicao', se: 'tem_tag', valor: vip.id, entao: [{ tipo: 'enviar_mensagem', texto: 'VIP sim' }], senao: [{ tipo: 'enviar_mensagem', texto: 'VIP não' }] },
        { tipo: 'condicao', se: 'modo', valor: 'copiloto', entao: [{ tipo: 'enviar_mensagem', texto: 'copiloto' }] },
        { tipo: 'condicao', se: 'horario_loja', entao: [{ tipo: 'esperar', minutos: 30 }] },
        { tipo: 'condicao', se: 'cliente_respondeu', entao: [{ tipo: 'enviar_mensagem', texto: 'respondeu', so_no_horario: false }], senao: [{ tipo: 'enviar_mensagem', texto: 'sumiu' }] },
      ],
    });
    const c = await conversa('norte', 'Marina');
    await como(gente.admin, 'POST', `/api/conversas/${c.id}/tags`, { tagId: vip.id });
    await mover(c, proposta.id);
    expect(textos()).toEqual(['VIP sim', 'copiloto']);
    avancar(10);
    await escreve(c, 'Voltei');
    avancar(25);
    await tick();
    expect(textos()).toEqual(['VIP sim', 'copiloto', 'respondeu']);
    expect((await execucoes(a.id))[0]!.status).toBe('concluida');
  });

  it('nova_conversa: só na primeira mensagem, só da unidade escolhida, e uma vez por conversa (também no WhatsApp de teste)', async () => {
    const { criar, conversa, escreve, execucoes, textos, sintonia } = await preparar(amb);
    const a = await criar({ nome: 'Boas-vindas', gatilho: { tipo: 'nova_conversa', unidade: 'norte' }, passos: [{ tipo: 'enviar_mensagem', texto: 'Bem-vinda, {primeiro_nome}!' }] });
    const c = await conversa('norte', 'Marina');
    await escreve(c, 'Tem horário amanhã?');
    await conversa('sumare', 'Paula');
    expect(textos()).toEqual(['Bem-vinda, Marina!']);
    // WhatsApp de teste: o mesmo evento chegando duas vezes (mesmo id) não dispara de novo.
    const t = await conversa('norte', 'Teste', 'Oi', 'teste-norte');
    const repetida = { canalId: 'teste-norte', telefone: t.telefone, nome: 'Teste', texto: 'Oi de novo', deMim: false, idExterno: 'teste-fixo', em: t.criadaEm };
    await sintonia.receber(repetida);
    await sintonia.receber(repetida);
    expect(textos()).toEqual(['Bem-vinda, Marina!', 'Bem-vinda, Teste!']);
    expect((await execucoes(a.id)).map((e) => e.chave)).toEqual(['nova_conversa', 'nova_conversa']);
  });

  it('palavra_chave (o bot): só mensagem de cliente; responde antes da IA; modo exata', async () => {
    const agente = new AgenteFalso(() => ({ texto: 'Resposta da IA', acoes: [], recusou: false }));
    const { criar, conversa, escreve, execucoes, textos, sintonia, agente: ag } = await preparar(amb, { agente });
    const bot = await criar({
      nome: 'Preço',
      gatilho: { tipo: 'palavra_chave', palavras: ['preço', 'quanto custa'], modo: 'contem' },
      passos: [{ tipo: 'enviar_mensagem', texto: 'A progressiva começa em R$ 150.' }],
    });
    const oi = await criar({ nome: 'Oi', gatilho: { tipo: 'palavra_chave', palavras: ['oi'], modo: 'exata' }, passos: [{ tipo: 'enviar_mensagem', texto: 'Olá! 😊' }] });
    const c = await conversa('norte', 'Marina', 'Bom dia');
    await sintonia.mudarModo(c.id, 'ia');
    const antes = textos().length;
    const pedidosAntes = ag.pedidos.length;
    await escreve(c, 'Qual o PREÇO da progressiva?');
    // O bot respondeu; a IA viu que a mensagem já tinha resposta e não respondeu de novo.
    expect(textos().slice(antes)).toEqual(['A progressiva começa em R$ 150.']);
    expect(ag.pedidos.length).toBe(pedidosAntes);
    // "precos" não é "preço" (palavra inteira); a mensagem da loja com a palavra não dispara.
    await escreve(c, 'Quanto custa?', true);
    expect((await execucoes(bot.id)).length).toBe(1);
    await escreve(c, 'oi tudo bem');
    await escreve(c, 'Oi!');
    expect(textos()).toContain('Olá! 😊');
    expect((await execucoes(oi.id)).length).toBe(1);
  });

  it('tag_marcada: dispara com tag solta (pela API) e com etapa', async () => {
    const { como, gente, criar, conversa, mover, ganhou, textos } = await preparar(amb);
    const vip = (await como(gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
    await criar({ nome: 'VIP', gatilho: { tipo: 'tag_marcada', tagId: vip.id }, passos: [{ tipo: 'enviar_mensagem', texto: 'Você é VIP!' }] });
    await criar({ nome: 'Ganhou', gatilho: { tipo: 'tag_marcada', tagId: ganhou.id }, passos: [{ tipo: 'enviar_mensagem', texto: 'Obrigada!' }] });
    const c = await conversa('norte', 'Marina');
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/tags`, { tagId: vip.id });
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/tags`, { tagId: vip.id }); // já estava: não dispara
    await mover(c, ganhou.id);
    expect(textos()).toEqual(['Você é VIP!', 'Obrigada!']);
  });

  it('parada_na_etapa: uma vez por estadia, de novo se sair e voltar', async () => {
    const { criar, conversa, mover, lead, proposta, tick, avancar, textos, execucoes } = await preparar(amb);
    const a = await criar({ nome: 'Parada', gatilho: { tipo: 'parada_na_etapa', etapaId: lead.id, horas: 2 }, passos: [{ tipo: 'enviar_mensagem', texto: 'Ainda tem interesse?' }] });
    const c = await conversa('norte', 'Marina');
    await mover(c, lead.id);
    avancar(60);
    await tick();
    expect(textos()).toEqual([]);
    avancar(61);
    await tick();
    await tick();
    expect(textos()).toEqual(['Ainda tem interesse?']);
    await mover(c, proposta.id);
    await mover(c, lead.id);
    avancar(121);
    await tick();
    expect(textos()).toEqual(['Ainda tem interesse?', 'Ainda tem interesse?']);
    expect((await execucoes(a.id)).every((e) => e.chave.startsWith(`parada:${lead.id}:`))).toBe(true);
  });

  it('fluxo_ia: põe a conversa com a IA e passa o objetivo para o agente (agente falso)', async () => {
    const { criar, conversa, mover, proposta, agente, buscar, escreve, sintonia } = await preparar(amb);
    await criar({ nome: 'Qualificar', gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id }, passos: [{ tipo: 'fluxo_ia', objetivo: 'qualificar e agendar a avaliação', dias: 2 }] });
    const c = await conversa('norte', 'Marina');
    expect(agente.pedidos.at(-1)!.objetivo).toBeUndefined();
    await mover(c, proposta.id);
    expect((await buscar(c.id)).modo).toBe('ia');
    await escreve(c, 'Quero sim');
    expect(agente.pedidos.at(-1)).toMatchObject({ modo: 'responder', objetivo: 'qualificar e agendar a avaliação' });
    // Saiu do modo IA: o objetivo não vale mais.
    await sintonia.mudarModo(c.id, 'copiloto');
    await escreve(c, 'Oi?');
    expect(agente.pedidos.at(-1)!.objetivo).toBeUndefined();
  });

  it('esperar sobrevive a reinício: outra instância continua do banco', async () => {
    const { criar, conversa, mover, proposta, avancar, tick, textos, execucoes, reiniciar } = await preparar(amb);
    const a = await criar({
      nome: 'Sequência',
      gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id },
      passos: [{ tipo: 'enviar_mensagem', texto: 'Primeira' }, { tipo: 'esperar', minutos: 60 }, { tipo: 'enviar_mensagem', texto: 'Segunda' }],
    });
    const c = await conversa('norte', 'Marina');
    await mover(c, proposta.id);
    expect(textos()).toEqual(['Primeira']);
    const [e] = await execucoes(a.id);
    expect(e).toMatchObject({ status: 'pendente', proximaEm: quinta(15).toISOString() });
    reiniciar();
    avancar(59);
    await tick();
    expect(textos()).toEqual(['Primeira']);
    avancar(2);
    await tick();
    expect(textos()).toEqual(['Primeira', 'Segunda']);
    expect((await execucoes(a.id))[0]!.status).toBe('concluida');
  });

  it('uma execução ativa da mesma automação por conversa', async () => {
    const { criar, conversa, mover, lead, proposta, execucoes } = await preparar(amb);
    const a = await criar({ nome: 'Longa', gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id }, passos: [{ tipo: 'esperar', minutos: 600 }, { tipo: 'enviar_mensagem', texto: 'x' }] });
    const c = await conversa('norte', 'Marina');
    await mover(c, proposta.id);
    await mover(c, lead.id);
    await mover(c, proposta.id);
    expect((await execucoes(a.id)).length).toBe(1);
  });
});

describe.each(ambientes)('Automações: proteções ($nome)', (amb) => {
  it('fora do horário espera a abertura da loja (so_no_horario), ou envia na hora se desligado', async () => {
    // Quinta 23h: a loja (10h-22h) está fechada.
    const { criar, conversa, mover, lead, proposta, avancar, tick, textos, execucoes, relogio } = await preparar(amb, { inicio: quinta(23) });
    const a = await criar({ nome: 'Horário', gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id }, passos: [{ tipo: 'enviar_mensagem', texto: 'Bom dia!' }] });
    await criar({ nome: 'Já', gatilho: { tipo: 'entrou_na_etapa', etapaId: lead.id }, passos: [{ tipo: 'enviar_mensagem', texto: 'Agora', so_no_horario: false }] });
    const c = await conversa('norte', 'Marina');
    const inicio = textos().length;
    await mover(c, lead.id);
    expect(textos().slice(inicio)).toEqual(['Agora']);
    await mover(c, proposta.id);
    const [e] = await execucoes(a.id);
    const sexta10 = bahia(2026, 11, 6, 10);
    expect(e).toMatchObject({ status: 'pendente', proximaEm: sexta10.toISOString() });
    relogio.t = bahia(2026, 11, 6, 9, 59);
    await tick();
    expect(textos().slice(inicio)).toEqual(['Agora']);
    avancar(1);
    await tick();
    expect(textos().slice(inicio)).toEqual(['Agora', 'Bom dia!']);
    expect(proximaAbertura(UNIDADES.norte, bahia(2026, 11, 8, 9))!.toISOString()).toBe(bahia(2026, 11, 8, 14).toISOString()); // domingo abre 14h
  });

  it('limite de mensagens automáticas por conversa por dia', async () => {
    const { como, gente, criar, conversa, mover, proposta, textos, execucoes, avancar, lead } = await preparar(amb);
    await como(gente.admin, 'PATCH', '/api/automacoes/config', { limiteDiario: 2 });
    const a = await criar({
      nome: 'Muitas',
      gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id },
      passos: [{ tipo: 'enviar_mensagem', texto: '1' }, { tipo: 'enviar_mensagem', texto: '2' }, { tipo: 'enviar_mensagem', texto: '3' }],
    });
    const c = await conversa('norte', 'Marina');
    await mover(c, proposta.id);
    expect(textos()).toEqual(['1', '2']);
    expect((await execucoes(a.id))[0]).toMatchObject({ status: 'cancelada', erro: 'Limite de 2 mensagem(ns) automática(s) por dia nesta conversa.' });
    // No outro dia volta a valer.
    avancar(24 * 60);
    await mover(c, lead.id);
    await mover(c, proposta.id);
    expect(textos()).toEqual(['1', '2', '1', '2']);
  });

  it('se a equipe responder, o envio pendente é cancelado (a menos que a opção esteja desligada)', async () => {
    const { como, gente, criar, conversa, mover, proposta, ganhou, avancar, tick, textos, execucoes } = await preparar(amb);
    const passos = (t: string) => [{ tipo: 'esperar', minutos: 30 }, { tipo: 'enviar_mensagem', texto: t }];
    const para = await criar({ nome: 'Para', gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id }, passos: passos('não deve sair') });
    const segue = await criar({ nome: 'Segue', gatilho: { tipo: 'entrou_na_etapa', etapaId: ganhou.id }, passos: passos('sai mesmo assim'), opcoes: { parar_se_equipe_responder: false } });
    const c1 = await conversa('norte', 'Marina');
    const c2 = await conversa('norte', 'Joana');
    await mover(c1, proposta.id);
    await mover(c2, ganhou.id);
    await como(gente.carla, 'POST', `/api/conversas/${c1.id}/enviar`, { texto: 'Oi, Marina! Já te ajudo.' });
    await como(gente.carla, 'POST', `/api/conversas/${c2.id}/enviar`, { texto: 'Oi, Joana!' });
    expect((await execucoes(para.id))[0]).toMatchObject({ status: 'cancelada', erro: 'A equipe respondeu a conversa.' });
    avancar(31);
    await tick();
    expect(textos()).not.toContain('não deve sair');
    expect(textos()).toContain('sai mesmo assim');
    expect((await execucoes(segue.id))[0]!.status).toBe('concluida');
  });

  it('automação desligada no meio: a continuação não roda', async () => {
    const { como, gente, criar, conversa, mover, proposta, avancar, tick, textos, execucoes } = await preparar(amb);
    const a = await criar({ nome: 'X', gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id }, passos: [{ tipo: 'esperar', minutos: 5 }, { tipo: 'enviar_mensagem', texto: 'x' }] });
    const c = await conversa('norte', 'Marina');
    await mover(c, proposta.id);
    await como(gente.admin, 'POST', `/api/automacoes/${a.id}/desligar`);
    avancar(6);
    await tick();
    expect(textos()).toEqual([]);
    expect((await execucoes(a.id))[0]).toMatchObject({ status: 'cancelada', erro: 'A automação foi desligada.' });
  });

  it('testar: só em conversa de teste (ou confirmando), sem esperar, e devolve o que aconteceu', async () => {
    const { como, gente, criar, conversa, proposta, textos } = await preparar(amb);
    const a = await criar({
      nome: 'Teste',
      ligada: false,
      gatilho: { tipo: 'entrou_na_etapa', etapaId: proposta.id },
      passos: [{ tipo: 'enviar_mensagem', texto: 'Oi {primeiro_nome}' }, { tipo: 'esperar', minutos: 600 }, { tipo: 'mudar_modo', modo: 'humano' }],
    });
    const real = await conversa('norte', 'Marina');
    const r = await como(gente.admin, 'POST', `/api/automacoes/${a.id}/testar`, { conversaId: real.id });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'conversa_real' });
    const t = await conversa('norte', 'Teste Silva', 'Oi', 'teste-norte');
    expect((await como(gente.carla, 'POST', `/api/automacoes/${a.id}/testar`, { conversaId: t.id })).statusCode).toBe(403);
    const ok = await como(gente.admin, 'POST', `/api/automacoes/${a.id}/testar`, { conversaId: t.id });
    expect(ok.statusCode).toBe(200);
    const e = ok.json() as ExecJson;
    expect(e).toMatchObject({ status: 'concluida', teste: true });
    expect(e.log.map((l) => l.passo)).toEqual(['inicio', 'enviar_mensagem', 'esperar', 'mudar_modo', 'fim']);
    expect(e.log[2]!.detalhe).toContain('no teste não espera');
    expect(textos()).toContain('Oi Teste');
    // Confirmando, roda numa conversa real.
    expect((await como(gente.admin, 'POST', `/api/automacoes/${a.id}/testar`, { conversaId: real.id, permitirReal: true })).json()).toMatchObject({ status: 'concluida' });
  });
});

describe('Automações: funções puras e prompt', () => {
  it('palavra-chave casa palavra inteira, sem acento e sem maiúsculas; exata só a mensagem toda', () => {
    expect(casaPalavra('Qual o PREÇO?', ['preco'], 'contem')).toBe(true);
    expect(casaPalavra('Quais os preços?', ['preço'], 'contem')).toBe(false);
    expect(casaPalavra('quanto custa a progressiva', ['quanto custa'], 'contem')).toBe(true);
    expect(casaPalavra('Oi!!', ['oi'], 'exata')).toBe(true);
    expect(casaPalavra('oi tudo bem', ['oi'], 'exata')).toBe(false);
    expect(preencher('Oi {primeiro_nome}, {atendente} aqui.', { nome: 'Marina Souza', unidade: 'Norte' })).toBe('Oi Marina, nossa equipe aqui.');
    expect(preencher('Oi {primeiro_nome}!', { unidade: 'Norte' })).toBe('Oi!');
  });

  it('o objetivo do fluxo de IA vai para o prompt do agente de verdade', async () => {
    const recebidos: Array<{ messages: Array<{ content: string }> }> = [];
    const claude = {
      beta: {
        messages: {
          create: (async (p: { messages: Array<{ content: string }> }) => {
            recebidos.push(structuredClone(p));
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi!' }] };
          }) as never,
        },
      },
    };
    const agente = new Agente(claude, {} as Agenda, 'BASE', { modelo: 'claude-opus-5-5', esforco: 'low' });
    const conversa: Conversa = { id: 'c1', empresaId: 'imperio', unidade: 'norte', canalId: 'x', telefone: '1', nome: 'Marina', modo: 'ia', etapa: 'em_conversa', etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9) };
    const mensagens = [{ id: '1', conversaId: 'c1', autor: 'cliente' as const, texto: 'Oi', em: quinta(9) }];
    await agente.executar({ conversa, mensagens, agora: quinta(9), modo: 'responder', objetivo: 'qualificar e agendar a avaliação' });
    await agente.executar({ conversa, mensagens, agora: quinta(9), modo: 'responder' });
    expect(recebidos[0]!.messages.at(-1)!.content).toContain('<objetivo_da_loja>qualificar e agendar a avaliação</objetivo_da_loja>');
    expect(recebidos[1]!.messages.at(-1)!.content).not.toContain('objetivo_da_loja');
  });
});

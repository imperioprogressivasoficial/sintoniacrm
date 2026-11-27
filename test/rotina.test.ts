import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { dataBahia, inicioDoDia, periodoDe, segundaDaSemana, valeNoDia, visaoDa } from '../src/rotina/rotina.js';
import { poolDeTeste, temPostgres } from './repos.js';

describe('Rotina: regras de data (fuso da Bahia)', () => {
  it('dia da Bahia e segunda-feira da semana', () => {
    expect(dataBahia(new Date('2026-11-21T02:00:00Z'))).toBe('2026-11-20'); // 23h de sexta na Bahia
    expect(segundaDaSemana('2026-11-20')).toBe('2026-11-16'); // sexta → segunda
    expect(segundaDaSemana('2026-11-22')).toBe('2026-11-16'); // domingo fecha a semana
    expect(segundaDaSemana('2026-11-23')).toBe('2026-11-23');
  });
  it('item entra no checklist conforme a frequência', () => {
    expect(valeNoDia({ frequencia: 'diaria', dias: [], ativa: true }, '2026-11-22')).toBe(true);
    expect(valeNoDia({ frequencia: 'dias', dias: [1, 3, 5], ativa: true }, '2026-11-20')).toBe(true); // sexta
    expect(valeNoDia({ frequencia: 'dias', dias: [1, 3, 5], ativa: true }, '2026-11-21')).toBe(false); // sábado
    expect(valeNoDia({ frequencia: 'diaria', dias: [], ativa: false }, '2026-11-20')).toBe(false);
    expect(periodoDe({ frequencia: 'semanal' }, '2026-11-20')).toBe('2026-11-16');
    expect(periodoDe({ frequencia: 'diaria' }, '2026-11-20')).toBe('2026-11-20');
  });
  it('visão da tarefa: atrasada, hoje, próximas, feitas', () => {
    const agora = new Date('2026-11-20T14:00:00-03:00');
    expect(visaoDa({ feita: false, venceEm: new Date('2026-11-20T10:00:00-03:00') }, agora)).toBe('atrasadas');
    expect(visaoDa({ feita: false, venceEm: new Date('2026-11-20T23:30:00-03:00') }, agora)).toBe('hoje');
    expect(visaoDa({ feita: false, venceEm: inicioDoDia('2026-11-21') }, agora)).toBe('proximas');
    expect(visaoDa({ feita: false, venceEm: null }, agora)).toBe('proximas');
    expect(visaoDa({ feita: true, venceEm: new Date('2026-11-01T10:00:00Z') }, agora)).toBe('feitas');
  });
});

async function montar() {
  const pool = await poolDeTeste();
  await pool.query('truncate sintonia.rotina_tarefas, sintonia.rotina_itens, sintonia.rotina_marcas');
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  const bruno = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  const carla = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const davi = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Davi', email: 'davi@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  await contas.criarUsuario({ empresaId: 'outra', nome: 'Estranho', email: 'x@outra.com', papel: 'admin', unidades: [], senhaHash });
  const repo = new RepositorioMemoria();
  const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'c1', telefone: '5571999990000', nome: 'Maria Cliente', agora: new Date() });
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  let agora = new Date('2026-11-20T09:00:00-03:00'); // sexta
  const app = criarServidor({ sintonia, repo, auth: { contas }, poolRotina: pool, agora: () => agora });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  const ck = { bruno: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com'), davi: await entrar('davi@imperio.com'), estranho: await entrar('x@outra.com') };
  const chamar = (quem: keyof typeof ck, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: ck[quem] }, ...(payload ? { payload } : {}) });
  return { app, chamar, ids: { bruno: bruno.id, carla: carla.id, davi: davi.id }, conversa, mudarAgora: (d: Date) => { agora = d; } };
}

describe.skipIf(!temPostgres)('Rotina: tarefas e checklist (Postgres)', () => {
  it('sem login recusa', async () => {
    const { app } = await montar();
    expect((await app.inject({ method: 'GET', url: '/api/rotina/tarefas' })).statusCode).toBe(401);
  });

  it('vendedor cria e vê só as suas; gestor vê a equipe e filtra por pessoa', async () => {
    const { chamar, ids } = await montar();
    expect((await chamar('carla', 'POST', '/api/rotina/tarefas', { titulo: 'Ligar para a Ana', venceEm: '2026-11-20T08:00:00-03:00', prioridade: 'alta' })).statusCode).toBe(200);
    expect((await chamar('carla', 'POST', '/api/rotina/tarefas', { titulo: 'Mandar proposta', venceEm: '2026-11-20T17:00:00-03:00' })).statusCode).toBe(200);
    expect((await chamar('davi', 'POST', '/api/rotina/tarefas', { titulo: 'Tarefa do Davi', venceEm: null })).statusCode).toBe(200);
    // vendedor não cria para outra pessoa
    expect((await chamar('carla', 'POST', '/api/rotina/tarefas', { titulo: 'Para o Davi', responsavelId: ids.davi })).statusCode).toBe(403);
    // dono 27/11: atendente cria tarefa para a gestão (e a recepção), não para outra atendente
    const paraBruno = await chamar('carla', 'POST', '/api/rotina/tarefas', { titulo: 'Para o Bruno', responsavelId: ids.bruno });
    expect(paraBruno.statusCode).toBe(200);
    expect((await chamar('carla', 'DELETE', `/api/rotina/tarefas/${paraBruno.json().id ?? paraBruno.json().tarefa?.id}`)).statusCode).toBe(200);
    // gestor cria para alguém da equipe, mas não para pessoa de fora
    expect((await chamar('bruno', 'POST', '/api/rotina/tarefas', { titulo: 'Atualizar o funil', responsavelId: ids.carla, venceEm: '2026-11-23T10:00:00-03:00' })).statusCode).toBe(200);
    expect((await chamar('bruno', 'POST', '/api/rotina/tarefas', { titulo: 'Inventado', responsavelId: 'nao-existe' })).statusCode).toBe(400);
    // campos extras e título vazio são recusados
    expect((await chamar('carla', 'POST', '/api/rotina/tarefas', { titulo: 'x' })).statusCode).toBe(400);
    expect((await chamar('carla', 'POST', '/api/rotina/tarefas', { titulo: 'Ok ok', empresaId: 'outra' })).statusCode).toBe(400);

    const c = (await chamar('carla', 'GET', '/api/rotina/tarefas?visao=atrasadas')).json();
    expect(c.contagem).toEqual({ atrasadas: 1, hoje: 1, proximas: 1, feitas: 0 });
    expect(c.tarefas.map((t: { titulo: string }) => t.titulo)).toEqual(['Ligar para a Ana']);
    expect(c.gestor).toBe(false);
    // vendedor pedindo a equipe toda continua vendo só as suas
    expect((await chamar('carla', 'GET', '/api/rotina/tarefas?visao=proximas&pessoa=todos')).json().tarefas.map((t: { titulo: string }) => t.titulo)).toEqual(['Atualizar o funil']);

    const g = (await chamar('bruno', 'GET', '/api/rotina/tarefas?visao=proximas')).json();
    expect(g.gestor).toBe(true);
    expect(g.tarefas.map((t: { titulo: string }) => t.titulo)).toEqual(['Atualizar o funil', 'Tarefa do Davi']);
    expect(g.equipe.map((p: { nome: string }) => p.nome)).toEqual(['Bruno', 'Carla', 'Davi']);
    const soDavi = (await chamar('bruno', 'GET', `/api/rotina/tarefas?visao=proximas&pessoa=${ids.davi}`)).json();
    expect(soDavi.tarefas.map((t: { responsavelNome: string }) => t.responsavelNome)).toEqual(['Davi']);
    // outra empresa não enxerga nada
    expect((await chamar('estranho', 'GET', '/api/rotina/tarefas?visao=proximas')).json().tarefas).toEqual([]);
  });

  it('marcar feita, editar e apagar respeitam o dono', async () => {
    const { chamar } = await montar();
    const { id } = (await chamar('carla', 'POST', '/api/rotina/tarefas', { titulo: 'Retornar o Paulo', venceEm: '2026-11-20T08:00:00-03:00' })).json();
    expect((await chamar('davi', 'POST', `/api/rotina/tarefas/${id}/feita`, { feita: true })).statusCode).toBe(404);
    expect((await chamar('estranho', 'DELETE', `/api/rotina/tarefas/${id}`)).statusCode).toBe(404);
    expect((await chamar('carla', 'POST', `/api/rotina/tarefas/${id}/feita`, { feita: true })).statusCode).toBe(200);
    const r = (await chamar('carla', 'GET', '/api/rotina/tarefas?visao=feitas')).json();
    expect(r.tarefas[0]).toMatchObject({ titulo: 'Retornar o Paulo', feita: true, visao: 'feitas' });
    expect((await chamar('carla', 'GET', '/api/rotina/resumo')).json().atrasadas).toBe(0);
    expect((await chamar('carla', 'PUT', `/api/rotina/tarefas/${id}`, { titulo: 'Retornar o Paulo amanhã', venceEm: '2026-11-21T10:00:00-03:00' })).statusCode).toBe(200);
    expect((await chamar('bruno', 'DELETE', `/api/rotina/tarefas/${id}`)).statusCode).toBe(200);
    expect((await chamar('carla', 'GET', '/api/rotina/tarefas?visao=feitas')).json().tarefas).toEqual([]);
  });

  it('checklist do dia: diária, dias da semana e semanal, com progresso', async () => {
    const { chamar, ids, mudarAgora } = await montar();
    const criar = async (quem: 'bruno' | 'carla', p: object) => (await chamar(quem, 'POST', '/api/rotina/itens', p)).json().id as string;
    const radar = await criar('bruno', { titulo: 'Responder todos do Radar', frequencia: 'diaria', ate: '10:00' });
    await criar('bruno', { titulo: 'Mandar 10 follow-ups', frequencia: 'dias', dias: [1, 2, 3, 4, 5] });
    const funil = await criar('bruno', { titulo: 'Atualizar o funil', frequencia: 'semanal' });
    await criar('bruno', { titulo: 'Só do Davi', frequencia: 'diaria', paraId: ids.davi });
    await criar('carla', { titulo: 'Minha anotação', frequencia: 'dias', dias: [6] }); // sábado: não aparece na sexta
    // vendedor não cria "para toda a equipe": vira dele
    const meu = (await chamar('carla', 'GET', '/api/rotina/itens')).json();
    expect(meu.itens.find((i: { titulo: string }) => i.titulo === 'Minha anotação').paraId).toBe(ids.carla);
    expect(meu.itens.some((i: { titulo: string }) => i.titulo === 'Só do Davi')).toBe(false);
    expect((await chamar('carla', 'POST', '/api/rotina/itens', { titulo: 'Sem dias', frequencia: 'dias', dias: [] })).statusCode).toBe(400);

    let dia = (await chamar('carla', 'GET', '/api/rotina/dia')).json();
    expect(dia.data).toBe('2026-11-20');
    expect(dia.itens.map((i: { titulo: string }) => i.titulo)).toEqual(['Responder todos do Radar', 'Mandar 10 follow-ups', 'Atualizar o funil']);
    expect([dia.feitas, dia.total]).toEqual([0, 3]);

    await chamar('carla', 'POST', `/api/rotina/dia/${radar}`, { feita: true });
    await chamar('carla', 'POST', `/api/rotina/dia/${funil}`, { feita: true });
    dia = (await chamar('carla', 'GET', '/api/rotina/dia')).json();
    expect([dia.feitas, dia.total]).toEqual([2, 3]);
    expect((await chamar('carla', 'GET', '/api/rotina/resumo')).json()).toMatchObject({ rotinaFeitas: 2, rotinaTotal: 3 });

    // gestor vê o progresso de cada pessoa
    const g = (await chamar('bruno', 'GET', '/api/rotina/dia')).json();
    expect(g.equipe.find((p: { nome: string }) => p.nome === 'Carla')).toMatchObject({ feitas: 2, total: 3 });
    expect(g.equipe.find((p: { nome: string }) => p.nome === 'Davi')).toMatchObject({ feitas: 0, total: 4 });

    // vendedor não apaga item da gestão
    expect((await chamar('carla', 'DELETE', `/api/rotina/itens/${radar}`)).statusCode).toBe(403);

    // sábado: o diário zera, o semanal continua feito, o de seg–sex some, o de sábado aparece
    mudarAgora(new Date('2026-11-21T09:00:00-03:00'));
    dia = (await chamar('carla', 'GET', '/api/rotina/dia')).json();
    expect(dia.itens.map((i: { titulo: string; feita: boolean }) => [i.titulo, i.feita])).toEqual([
      ['Responder todos do Radar', false], ['Atualizar o funil', true], ['Minha anotação', false]]);
    // segunda: semana nova, o semanal volta a ficar por fazer
    mudarAgora(new Date('2026-11-23T09:00:00-03:00'));
    dia = (await chamar('carla', 'GET', '/api/rotina/dia')).json();
    expect(dia.itens.find((i: { titulo: string }) => i.titulo === 'Atualizar o funil').feita).toBe(false);
  });

  it('tarefa ligada a conversa: da mesma empresa e visível', async () => {
    const { chamar, conversa } = await montar();
    const c = conversa;
    expect((await chamar('bruno', 'POST', '/api/rotina/tarefas', { titulo: 'Mandar orçamento', conversaId: c.id })).statusCode).toBe(200);
    const t = (await chamar('bruno', 'GET', '/api/rotina/tarefas?visao=proximas')).json().tarefas[0];
    expect(t).toMatchObject({ conversaId: c.id, clienteNome: 'Maria Cliente' });
    expect((await chamar('bruno', 'GET', `/api/rotina/conversa/${c.id}`)).json().tarefas).toHaveLength(1);
    expect((await chamar('estranho', 'POST', '/api/rotina/tarefas', { titulo: 'Bisbilhotar', conversaId: c.id })).statusCode).toBe(404);
    expect((await chamar('bruno', 'POST', '/api/rotina/tarefas', { titulo: 'Inventada', conversaId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
  });
});

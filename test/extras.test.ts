import { describe, expect, it } from 'vitest';
import { ContatosMemoria, ContatosPostgres } from '../src/contatos/contatos.js';
import { chaveTelefone, normalizarTelefoneBR } from '../src/leads/telefone-br.js';
import { encontrarDuplicatas, nomesParecidos } from '../src/leads/duplicatas.js';
import { montarExtras, registrarExtras } from '../src/rotas/extras.js';
import type { ArmazemTags } from '../src/tags/tags.js';
import { ambientes, montarGestao, quinta } from './gestao-ambiente.js';

// ------------------------------------------------------------------ funções puras

describe('Telefone brasileiro (importação)', () => {
  it('normaliza máscara, 55, 0 de longa distância, operadora e 9º dígito', () => {
    const casos: Array<[string, string]> = [
      ['+55 (71) 98812-4471', '5571988124471'],
      ['71 98812-4471', '5571988124471'],
      ['(71) 8812-4471', '5571988124471'], // sem o 9
      ['557188124471', '5571988124471'], // com 55, sem o 9
      ['071988124471', '5571988124471'], // 0 + DDD
      ['0 41 71 98812-4471', '5571988124471'], // operadora
      ['0055 71 98812 4471', '5571988124471'],
      ['(71) 3333-4444', '557133334444'], // fixo fica com 12
    ];
    for (const [bruto, esperado] of casos) expect(normalizarTelefoneBR(bruto)).toMatchObject({ ok: true, telefone: esperado });
    expect(normalizarTelefoneBR('(71) 3333-4444')).toMatchObject({ tipo: 'fixo' });
    expect(normalizarTelefoneBR('(71) 8812-4471')).toMatchObject({ ajuste: expect.stringContaining('9º dígito') });
  });

  it('recusa o que não dá para ter certeza; DDD padrão completa número sem DDD', () => {
    expect(normalizarTelefoneBR('98812-4471')).toEqual({ ok: false, motivo: 'Sem DDD' });
    expect(normalizarTelefoneBR('98812-4471', { dddPadrao: '71' })).toMatchObject({ ok: true, telefone: '5571988124471' });
    expect(normalizarTelefoneBR('+1 415 555 2671')).toMatchObject({ ok: false, motivo: 'Número de fora do Brasil' });
    expect(normalizarTelefoneBR('(20) 98812-4471')).toMatchObject({ ok: false, motivo: 'DDD 20 não existe' });
    expect(normalizarTelefoneBR('123')).toMatchObject({ ok: false });
    expect(normalizarTelefoneBR('')).toMatchObject({ ok: false, motivo: 'Sem telefone' });
    expect(normalizarTelefoneBR('(71) 1234-5678')).toMatchObject({ ok: false });
  });

  it('mesma chave com/sem 55 e com/sem o 9', () => {
    const k = chaveTelefone('5571988124471');
    for (const t of ['557188124471', '71988124471', '7188124471', '+55 71 9 8812-4471']) expect(chaveTelefone(t)).toBe(k);
    expect(chaveTelefone('5571988124472')).not.toBe(k);
  });
});

describe('Detecção de duplicatas', () => {
  it('nomes parecidos: acento, erro de digitação, nome do meio', () => {
    expect(nomesParecidos('Maria José', 'maria jose')).toBe(true);
    expect(nomesParecidos('Fernanda Oliveira', 'Fernanda Olivera')).toBe(true);
    expect(nomesParecidos('Ana Paula Souza', 'Ana Souza')).toBe(true);
    expect(nomesParecidos('Ana Souza', 'Bruna Souza')).toBe(false);
    expect(nomesParecidos('Ana', 'Ana Clara')).toBe(false);
  });

  it('agrupa por telefone normalizado, e-mail e nome + final do telefone; respeita "não é duplicata"', () => {
    const leads = [
      { telefone: '5571988124471', nome: 'Joana' },
      { telefone: '557188124471', nome: 'Joana S.' }, // mesmo número sem o 9
      { telefone: '5571977770000', nome: 'Paula', email: 'paula@x.com' },
      { telefone: '5571966661111', nome: 'Paula Lima', email: 'PAULA@x.com' }, // mesmo e-mail
      { telefone: '5571955554321', nome: 'Fernanda Oliveira' },
      { telefone: '5571944444321', nome: 'Fernanda Olivera' }, // nome parecido, mesmo final
      { telefone: '5571933334321', nome: 'Carla Dias' }, // mesmo final, nome diferente
    ];
    const g = encontrarDuplicatas(leads);
    expect(g.map((x) => [x.telefones, x.motivos])).toEqual([
      [['557188124471', '5571988124471'], ['telefone']],
      [['5571966661111', '5571977770000'], ['email']],
      [['5571944444321', '5571955554321'], ['nome']],
    ]);
    expect(encontrarDuplicatas(leads, new Set(['5571966661111|5571977770000'])).map((x) => x.id)).not.toContain('5571966661111|5571977770000');
  });
});

// ------------------------------------------------------------------ rotas

for (const amb of ambientes) {
  describe(`Relatórios, leads e agenda (${amb.nome})`, () => {
    async function montar() {
      const g = await montarGestao(amb, { inicio: quinta(10) });
      const contatos = g.pool ? new ContatosPostgres(g.pool) : new ContatosMemoria();
      const armazemTags = (g.tags as unknown as { armazem: ArmazemTags }).armazem;
      const extras = montarExtras({
        repo: g.repo,
        pool: g.pool,
        contatos,
        armazemTags,
        tags: g.tags,
        empresaId: 'imperio',
        canalDa: (u) => `imperio-${u}`,
        comConversa: (id, fn) => g.sintonia.comConversa(id, fn),
        agora: () => g.relogio.t,
      });
      registrarExtras(g.app, { repo: g.repo, empresaId: 'imperio', relatorios: extras.relatorios, leads: extras.leads, contas: g.contas, agora: () => g.relogio.t });
      const mover = (d: Date) => (g.relogio.t = d);
      return { ...g, contatos, mover };
    }

    it('só a gestão vê relatórios e mexe em leads; gerente fica nas unidades dele', async () => {
      const g = await montar();
      for (const url of ['/api/relatorios', '/api/relatorios/origem/csv', '/api/leads', '/api/leads/exportar', '/api/leads/duplicatas']) {
        expect((await g.como(g.gente.carla, 'GET', url)).statusCode).toBe(403);
      }
      expect((await g.como(g.gente.carla, 'POST', '/api/leads/importar', { unidade: 'norte', linhas: [{ telefone: '71988124471' }] })).statusCode).toBe(403);
      expect((await g.como(g.gente.gerenteNorte, 'GET', '/api/relatorios?unidade=sumare')).statusCode).toBe(403);
      expect((await g.como(g.gente.gerenteNorte, 'POST', '/api/leads/importar', { unidade: 'sumare', linhas: [{ telefone: '71988124471' }] })).statusCode).toBe(403);
      const r = (await g.como(g.gente.gerenteNorte, 'GET', '/api/relatorios')).json();
      expect(r.opcoes.unidades.map((u: { id: string }) => u.id)).toEqual(['norte']);
    });

    it('importa planilha: normaliza, recusa, evita duplicata e nunca envia mensagem', async () => {
      const g = await montar();
      const origem = await g.contatos.criarCampo('imperio', { nome: 'Origem', tipo: 'lista', opcoes: ['Instagram', 'Indicação'] });
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json();
      const joana = await g.conversa('norte', 'Joana'); // chegou pelo WhatsApp: 5571988130001
      const enviadosAntes = g.enviados.length;
      const linhas = [
        { nome: 'Ana Souza', telefone: '(71) 98888-1111', email: 'ANA@exemplo.com', campos: { [origem.id]: 'instagram' }, tags: 'VIP' },
        { nome: 'Joana Lima', telefone: '7188130001', email: 'joana@exemplo.com' }, // a Joana do WhatsApp, sem 55 e sem o 9
        { nome: 'Bia', telefone: '123' },
        { nome: 'Ana de novo', telefone: '+55 71 9 8888-1111' }, // repetida na planilha
        { nome: 'Sem DDD', telefone: '97777-2222' },
        { nome: 'Outra Ana', telefone: '71 96666-3333', email: 'ana@exemplo.com' }, // e-mail da primeira
        { nome: 'Etapa', telefone: '71955554444', etapa: 'Agendada', unidade: 'Sumaré', tags: 'Inexistente' },
      ];
      const pedido = { unidade: 'norte', etapa: 'interessada', linhas, dddPadrao: '71', criarConversa: true };

      const previa = (await g.como(g.gente.admin, 'POST', '/api/leads/importar', { ...pedido, simular: true })).json();
      expect(previa).toMatchObject({ simulado: true, total: 7, criados: 3, atualizados: 1, recusados: 3, conversasCriadas: 3 });
      expect((await g.como(g.gente.admin, 'GET', '/api/leads')).json().total).toBe(1); // nada gravado

      const r = (await g.como(g.gente.admin, 'POST', '/api/leads/importar', pedido)).json();
      expect(r).toMatchObject({ simulado: false, total: 7, criados: 3, atualizados: 1, recusados: 3, conversasCriadas: 3 });
      expect(r.linhas.find((l: { linha: number }) => l.linha === 2)).toMatchObject({ situacao: 'atualizado', telefone: '5571988130001' });
      expect(r.linhas.find((l: { linha: number }) => l.linha === 3)).toMatchObject({ situacao: 'recusado' });
      expect(r.linhas.find((l: { linha: number }) => l.linha === 4)).toMatchObject({ situacao: 'recusado', motivo: 'Repetido na planilha (mesmo telefone do #1)' });
      expect(r.linhas.find((l: { linha: number }) => l.linha === 5)).toMatchObject({ situacao: 'criado', telefone: '5571977772222' });
      expect(r.linhas.find((l: { linha: number }) => l.linha === 6)).toMatchObject({ situacao: 'recusado', motivo: expect.stringContaining('E-mail já é de outro contato') });
      expect(r.linhas.find((l: { linha: number }) => l.linha === 7).avisos).toContain('Tag "Inexistente" não existe (crie em Tags)');
      expect(g.enviados.length).toBe(enviadosAntes); // ninguém recebeu mensagem

      const conversas = await g.repo.listarConversas();
      expect(conversas.filter((c) => c.telefone === '5571988130001')).toHaveLength(1); // a Joana não duplicou
      expect((await g.repo.mensagens(joana.id)).length).toBeGreaterThan(0);
      const ana = conversas.find((c) => c.telefone === '5571988881111')!;
      expect(ana).toMatchObject({ unidade: 'norte', etapa: 'interessada', modo: 'humano', nome: 'Ana Souza' });
      expect(await g.repo.mensagens(ana.id)).toHaveLength(0);
      expect((await g.tags.daConversa(ana.id)).map((t) => t.id)).toEqual([vip.id]);
      expect(conversas.find((c) => c.telefone === '5571955554444')).toMatchObject({ unidade: 'sumare', etapa: 'agendada' });
      expect(await g.contatos.obter('imperio', '5571988881111')).toMatchObject({ email: 'ana@exemplo.com', campos: { [origem.id]: 'Instagram' } });
      expect(await g.contatos.obter('imperio', '5571988130001')).toMatchObject({ nome: 'Joana Lima', email: 'joana@exemplo.com' });

      // Importar de novo: tudo igual, nada criado.
      const de_novo = (await g.como(g.gente.admin, 'POST', '/api/leads/importar', { ...pedido, linhas: [linhas[0]] })).json();
      expect(de_novo).toMatchObject({ criados: 0, iguais: 1 });
      // Conferência para quem cadastra à mão.
      expect((await g.como(g.gente.carla, 'GET', '/api/leads/conferir?telefone=7188881111')).json().duplicata).toEqual({ telefone: '5571988881111', motivo: 'telefone' });
      expect(previa.linhas.find((l: { linha: number }) => l.linha === 6)).toMatchObject({ situacao: 'recusado' });
    });

    it('exporta CSV para o Excel (BOM, ponto e vírgula) com filtros e campos personalizados', async () => {
      const g = await montar();
      const cabelo = await g.contatos.criarCampo('imperio', { nome: 'Tipo de cabelo', tipo: 'texto', opcoes: [] });
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json();
      const marina = await g.conversa('norte', 'Marina; "a do sábado"');
      await g.conversa('sumare', 'Paula');
      await g.como(g.gente.admin, 'POST', `/api/conversas/${marina.id}/tags`, { tagId: vip.id });
      await g.contatos.salvar('imperio', { telefone: marina.telefone, nome: 'Marina', email: 'marina@x.com', nascimento: null, observacoes: null, pessoa: 'fisica', empresa: {}, campos: { [cabelo.id]: 'Cacheado' }, atualizadoEm: null, atualizadoPor: null }, 'teste');
      const r = await g.como(g.gente.admin, 'GET', '/api/leads/exportar');
      expect(r.headers['content-type']).toContain('text/csv');
      expect(r.headers['content-disposition']).toContain('attachment; filename="leads-imperio-2026-11-05.csv"');
      expect(r.body.startsWith('\uFEFFNome;Telefone;E-mail;Unidade;Etapa;Tags;Dona;Criado em;Tipo de cabelo\r\n')).toBe(true);
      expect(r.body).toContain('Marina;5571988130001;marina@x.com;Salvador Norte Shopping;Em conversa;VIP;;05/11/2026 10:00;Cacheado');
      expect(r.body.split('\r\n').filter(Boolean)).toHaveLength(3);
      const soNorte = (await g.como(g.gente.admin, 'GET', `/api/leads/exportar?unidade=norte&tag=${vip.id}`)).body;
      expect(soNorte.split('\r\n').filter(Boolean)).toHaveLength(2);
      expect((await g.como(g.gente.admin, 'GET', '/api/leads/exportar?de=2026-11-06')).body.split('\r\n').filter(Boolean)).toHaveLength(1);
      expect((await g.como(g.gente.gerenteSumare, 'GET', '/api/leads/exportar')).body).not.toContain('Marina');
    });

    it('detecta duplicata, mescla (mensagens, tags, etapa, ficha, evento) e marca "não é duplicata"', async () => {
      const g = await montar();
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json();
      const loira = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'Loira' })).json();
      const joana = await g.conversa('norte', 'Joana', 'Oi, quero marcar');
      await g.como(g.gente.admin, 'POST', `/api/conversas/${joana.id}/tags`, { tagId: vip.id });
      // A mesma cliente, gravada sem o 9 (planilha antiga), com histórico e outra tag.
      const velho = joana.telefone.slice(0, 4) + joana.telefone.slice(5);
      const { conversa: dup } = await g.repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: velho, nome: 'Joana Silva', agora: quinta(8) });
      await g.repo.salvarConversa({ ...dup, etapa: 'agendada' });
      await g.repo.adicionarMensagem({ conversaId: dup.id, autor: 'cliente', texto: 'mensagem antiga', em: quinta(8, 5) });
      await g.como(g.gente.admin, 'POST', `/api/conversas/${dup.id}/tags`, { tagId: loira.id });
      await g.contatos.salvar('imperio', { telefone: velho, nome: 'Joana Silva', email: 'joana@x.com', nascimento: null, observacoes: 'Prefere sábado', pessoa: 'fisica', empresa: {}, campos: {}, atualizadoEm: null, atualizadoPor: null }, 'teste');
      // Na outra unidade, com o número velho também.
      const { conversa: noSumare } = await g.repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'imperio-sumare', telefone: velho, nome: 'Joana', agora: quinta(9) });
      // Gente diferente com o mesmo e-mail.
      const p1 = await g.conversa('norte', 'Paula');
      const p2 = await g.conversa('norte', 'Patrícia');
      for (const p of [p1, p2]) await g.contatos.salvar('imperio', { telefone: p.telefone, nome: p.nome!, email: 'familia@x.com', nascimento: null, observacoes: null, pessoa: 'fisica', empresa: {}, campos: {}, atualizadoEm: null, atualizadoPor: null }, 'teste');

      const lista = (await g.como(g.gente.admin, 'GET', '/api/leads/duplicatas')).json();
      expect(lista.grupos).toHaveLength(2);
      const grupo = lista.grupos.find((x: { motivos: Array<{ codigo: string }> }) => x.motivos[0]!.codigo === 'telefone');
      expect(grupo.leads.map((l: { telefone: string }) => l.telefone).sort()).toEqual([velho, joana.telefone].sort());
      // Gerente do Sumaré não vê (a conversa do Norte não é dele) e não consegue mesclar.
      expect((await g.como(g.gente.gerenteSumare, 'GET', '/api/leads/duplicatas')).json().grupos).toHaveLength(0);
      expect((await g.como(g.gente.gerenteSumare, 'POST', '/api/leads/mesclar', { principal: joana.telefone, outros: [velho] })).statusCode).toBe(403);

      const r = await g.como(g.gente.admin, 'POST', '/api/leads/mesclar', { principal: joana.telefone, outros: [velho] });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ conversasJuntadas: 1, conversasMovidas: 1 });
      expect(await g.repo.buscarConversa(dup.id)).toBeUndefined();
      const principal = (await g.repo.buscarConversa(joana.id))!;
      expect(principal).toMatchObject({ etapa: 'agendada', nome: 'Joana' });
      expect(principal.criadaEm.getTime()).toBe(quinta(8).getTime());
      expect((await g.repo.mensagens(joana.id)).map((m) => m.texto).sort()).toEqual(['Oi, quero marcar', 'mensagem antiga']);
      expect((await g.tags.daConversa(joana.id)).map((t) => t.nome).sort()).toEqual(['Loira', 'VIP']);
      expect((await g.repo.buscarConversa(noSumare.id))?.telefone).toBe(joana.telefone); // a do Sumaré agora usa o número certo
      expect(await g.contatos.obter('imperio', velho)).toBeUndefined();
      expect(await g.contatos.obter('imperio', joana.telefone)).toMatchObject({ nome: 'Joana Silva', email: 'joana@x.com', observacoes: 'Prefere sábado' });
      const eventos = await g.repo.eventosEntre(quinta(0), quinta(23));
      expect(eventos.filter((e) => e.tipo === 'leads_mesclados' && e.conversaId === joana.id)[0]?.dados).toMatchObject({ principal: joana.telefone, mesclados: [velho], por: 'Bruno Batista' });

      // O par do e-mail: "não é duplicata" (mãe e filha).
      expect((await g.como(g.gente.admin, 'POST', '/api/leads/nao-duplicata', { telefones: [p1.telefone, p2.telefone] })).statusCode).toBe(200);
      expect((await g.como(g.gente.admin, 'GET', '/api/leads/duplicatas')).json()).toMatchObject({ grupos: [], naoDuplicatas: 1 });
    });

    it('relatórios: origem por dia, conversão, equipe, IA × equipe, perdas e tags; CSV de cada um', async () => {
      const g = await montar();
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json();
      g.mover(quinta(10));
      const joana = await g.conversa('norte', 'Joana');
      g.mover(quinta(10, 2));
      await g.como(g.gente.carla, 'POST', `/api/conversas/${joana.id}/enviar`, { texto: 'Oi Joana!' });
      g.mover(quinta(10, 5));
      await g.sintonia.equipeAgendou(joana.id, { tipo: 'agendou', clienteTrinksId: 5, agendamento: { trinksId: 77, unidade: 'norte', servico: 'Progressiva', profissional: 'Lia', inicio: quinta(19), duracaoMin: 180 } }, 'Carla Lima', g.gente.carla);
      await g.como(g.gente.carla, 'POST', `/api/conversas/${joana.id}/tags`, { tagId: vip.id });
      g.mover(quinta(11));
      const paula = await g.conversa('sumare', 'Paula');
      await g.repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: paula.id, unidade: 'sumare', em: quinta(11, 30), dados: { de: 'novo_lead', para: 'perdida', motivo: 'Achou caro' } });
      await g.repo.salvarConversa({ ...(await g.repo.buscarConversa(paula.id))!, etapa: 'perdida' });
      g.mover(quinta(12));

      const r = (await g.como(g.gente.admin, 'GET', '/api/relatorios?periodo=hoje')).json();
      expect(r.origem).toMatchObject({ total: 2, origens: [{ origem: 'WhatsApp', total: 2 }], dias: [{ dia: '2026-11-05', total: 2 }] });
      expect(r.conversao.etapas.map((e: { total: number }) => e.total)).toEqual([2, 1, 1, 0]);
      expect(r.conversao.perdidas).toBe(1);
      const carla = r.atendentes.find((a: { nome: string }) => a.nome === 'Carla Lima');
      expect(carla).toMatchObject({ respostas: 1, primeirasRespostas: 1, primeiraRespostaSeg: 120, agendamentos: 1 });
      expect(r.iaEquipe.equipe).toMatchObject({ respostas: 1, agendamentos: 1, agendamentosPct: 100 });
      expect(r.perdas).toMatchObject({ total: 1, motivos: [{ motivo: 'Achou caro', total: 1 }] });
      expect(r.tags).toEqual([expect.objectContaining({ nome: 'VIP', marcacoes: 1, conversasAgora: 1 })]);

      const soSumare = (await g.como(g.gente.admin, 'GET', '/api/relatorios?periodo=hoje&unidade=sumare')).json();
      expect(soSumare.origem.total).toBe(1);
      const daCarla = (await g.como(g.gente.admin, 'GET', `/api/relatorios?periodo=hoje&atendente=${g.gente.carla.id}`)).json();
      expect(daCarla.origem.total).toBe(1);
      expect(daCarla.atendentes.map((a: { nome: string }) => a.nome)).toEqual(['Carla Lima']);
      const pers = (await g.como(g.gente.admin, 'GET', '/api/relatorios?periodo=personalizado&de=2026-11-01&ate=2026-11-04')).json();
      expect(pers.origem.total).toBe(0);
      expect(pers.origem.dias).toHaveLength(4);
      expect((await g.como(g.gente.admin, 'GET', '/api/relatorios?periodo=personalizado&de=2026-01-01&ate=2026-11-04')).statusCode).toBe(400);

      for (const nome of ['origem', 'conversao', 'atendentes', 'ia-equipe', 'perdas', 'tags']) {
        const c = await g.como(g.gente.admin, 'GET', `/api/relatorios/${nome}/csv?periodo=hoje`);
        expect(c.statusCode).toBe(200);
        expect(c.body.startsWith('\uFEFF')).toBe(true);
      }
      expect((await g.como(g.gente.admin, 'GET', '/api/relatorios/perdas/csv?periodo=hoje')).body).toContain('Achou caro;1;100');
    });

    it('agenda: agendamentos da Sintonia por dia, unidade e profissional', async () => {
      const g = await montar();
      const joana = await g.conversa('norte', 'Joana');
      const paula = await g.conversa('sumare', 'Paula');
      await g.sintonia.equipeAgendou(joana.id, { tipo: 'agendou', clienteTrinksId: 5, agendamento: { trinksId: 77, unidade: 'norte', servico: 'Progressiva', profissional: 'Lia', inicio: quinta(19), duracaoMin: 180 } }, 'Carla Lima', g.gente.carla);
      await g.sintonia.equipeAgendou(paula.id, { tipo: 'agendou', clienteTrinksId: 6, agendamento: { trinksId: 78, unidade: 'sumare', servico: 'Hidratação', inicio: quinta(15), duracaoMin: 60 } }, 'Rita Recepção', g.gente.rita);
      const r = (await g.como(g.gente.admin, 'GET', '/api/agenda/agendamentos?de=2026-11-05&dias=1')).json();
      expect(r.itens.map((i: { cliente: string }) => i.cliente)).toEqual(['Paula', 'Joana']);
      expect(r.itens[1]).toMatchObject({ servico: 'Progressiva', profissional: 'Lia', duracaoMin: 180, por: 'Carla Lima', unidade: 'norte', podeAbrir: true, conversaId: joana.id });
      expect(r.profissionais).toEqual(['Lia']);
      expect((await g.como(g.gente.admin, 'GET', '/api/agenda/agendamentos?de=2026-11-06&dias=1')).json().itens).toHaveLength(0);
      expect((await g.como(g.gente.admin, 'GET', '/api/agenda/agendamentos?de=2026-11-05&profissional=Lia')).json().itens).toHaveLength(1);
      // Atendente do Norte vê a agenda do Norte (inclusive de conversa que não é dela), não a do Sumaré.
      const bia = (await g.como(g.gente.bia, 'GET', '/api/agenda/agendamentos?de=2026-11-05')).json();
      expect(bia.itens.map((i: { cliente: string; podeAbrir: boolean }) => [i.cliente, i.podeAbrir])).toEqual([['Joana', false]]);
      expect((await g.como(g.gente.bia, 'GET', '/api/agenda/agendamentos?unidade=sumare')).statusCode).toBe(403);
    });
  });
}

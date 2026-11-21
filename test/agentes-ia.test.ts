import { describe, expect, it } from 'vitest';
import type { ClienteClaude } from '../src/ai/agente.js';
import type { Agenda } from '../src/ai/ferramentas.js';
import { montarAgentesIa } from '../src/agentes-ia/montar.js';
import { conferirPassagem } from '../src/agentes-ia/passagem.js';
import { interpretarPorRegras } from '../src/agentes-ia/comandos.js';
import { textoDoHtml, textoDoPdf } from '../src/agentes-ia/importar.js';
import { ConfigAgente, type Provedor } from '../src/agentes-ia/tipos.js';
import { Sintonia } from '../src/app/sintonia.js';
import { gerarHash } from '../src/auth/senha.js';
import type { Papel } from '../src/auth/contas.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { criarServidor } from '../src/server.js';
import { AgenteFalso, ambientes, quinta } from './gestao-ambiente.js';
import { deflateSync } from 'node:zlib';

/** Claude falso: grava o que recebeu e responde a sequência combinada (repete a última). */
function claudeFalso(respostas: Array<Record<string, unknown>>) {
  const recebidos: Array<Record<string, unknown>> = [];
  const cli: ClienteClaude = {
    beta: {
      messages: {
        create: (async (p: Record<string, unknown>) => {
          recebidos.push(structuredClone(p));
          return respostas.length > 1 ? respostas.shift() : respostas[0];
        }) as never,
      },
    },
  };
  return { cli, recebidos };
}
const fim = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const usa = (name: string, input: unknown, id = 'u1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const systemDe = (p: Record<string, unknown>) => (p.system as Array<{ text: string }>)[0]!.text;
const nomesTools = (p: Record<string, unknown>) => ((p.tools as Array<{ name: string }>) ?? []).map((t) => t.name).sort();

const agendaFalsa: Agenda = {
  listarServicos: async () => [{ id: 1, nome: 'Progressiva', preco: 300, duracaoEmMinutos: 180 }] as never,
  listarProfissionais: async () => [],
  horariosVagos: async () => [] as never,
  buscarClientePorTelefone: async () => undefined as never,
  criarCliente: async () => ({ id: 1 }) as never,
  criarAgendamento: async () => ({ id: 1 }) as never,
  listarAgendamentosDoCliente: async () => [],
};

async function montar(amb: (typeof ambientes)[number], o: { chaveGeral?: boolean; respostas?: Array<Record<string, unknown>> } = {}) {
  const { repo, contas, pool } = await amb.criar();
  const relogio = { t: quinta(14) };
  const agora = () => relogio.t;
  const enviados: Array<{ telefone: string; texto: string }> = [];
  const canal: CanalWhatsApp = {
    tipo: 'evolution',
    lerWebhook: () => [],
    enviarTexto: async (_c, telefone, texto) => {
      enviados.push({ telefone, texto });
      return { idExterno: `out-${Math.random()}` };
    },
  };
  const falso = claudeFalso(o.respostas ?? [fim('Oi! Seu cabelo bate no ombro? Tenho horário amanhã às 14h.')]);
  const chamadas: Array<{ provedor: Provedor; chave?: string }> = [];
  const padrao = new AgenteFalso(() => ({ texto: 'Resposta do agente padrão', acoes: [], recusou: false }));
  const cofre = new Cofre('teste');
  let sintonia!: Sintonia;
  const ag = montarAgentesIa({
    empresaId: 'imperio',
    pool,
    repo,
    cofre,
    agenda: agendaFalsa,
    baseGeral: async () => 'Endereço: Salvador Norte Shopping.',
    padrao,
    chaveGeral: (p) => (o.chaveGeral === false ? undefined : p === 'anthropic' ? 'geral' : undefined),
    claudeGeral: falso.cli as never,
    claudeComChave: () => falso.cli,
    cliente: (provedor, chave) => {
      chamadas.push({ provedor, chave });
      return falso.cli;
    },
    sintonia: () => sintonia,
    moverEtapa: async (id, etapa, por) =>
      Boolean(
        await sintonia.comConversa(id, async (c) => {
          if (c.etapa === etapa) return false;
          c.etapa = etapa;
          await repo.salvarConversa(c);
          await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c.id, unidade: c.unidade, em: agora(), dados: { para: etapa, por } });
          return true;
        }),
      ),
    agora,
  });
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal },
    ],
    agente: ag.agente,
    modoInicial: ag.modoInicial,
    agora,
  });
  const app = criarServidor({ sintonia, repo, agora, auth: { contas, agora } });
  ag.registrar(app);
  const h = await gerarHash('Imperio2026xyz');
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = { admin: await pessoa('Bruno Batista', 'admin', []), carla: await pessoa('Carla Lima', 'atendente', ['norte']) };
  const cookies = new Map<string, string>();
  const como = async (u: { id: string }, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 400 * 86400_000))}`));
    return app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  let tel = 0;
  const escreve = async (unidade: 'norte' | 'sumare', texto: string, telefone = `55719881300${String(++tel).padStart(2, '0')}`) => {
    await sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome: 'Marina', texto, deMim: false, idExterno: `in-${Math.random()}`, em: relogio.t });
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const criarAgente = async (extra: Record<string, unknown> = {}) => {
    const r = await como(gente.admin, 'POST', '/api/agentes-ia', {
      nome: 'Lia',
      avatar: '💇‍♀️',
      config: {
        persona: { quemE: 'Lia, consultora de progressiva da Império', comoFala: 'calorosa e direta', emojis: false, tamanho: 'curta' },
        regras: { sempre: ['Sempre oferecer horário'], nunca: ['Nunca dar preço sem perguntar o comprimento do cabelo'] },
        padroes: [{ situacao: 'Gestante', resposta: 'Temos opção sem formol para gestantes.' }],
        exemplos: [{ cliente: 'quanto é?', resposta: 'Depende do comprimento! Bate no ombro?' }],
      },
      ...extra,
    });
    expect(r.statusCode).toBe(201);
    return r.json() as { id: string; temChavePropria: boolean };
  };
  return { app, repo, pool, ag, sintonia, relogio, gente, como, escreve, enviados, falso, chamadas, padrao, criarAgente, cofre };
}

describe('passagem e comandos por regras (puro)', () => {
  const p = ConfigAgente.parse({}).passagem;
  it('detecta reclamação, pedido de pessoa, irritação, palavra e valor', () => {
    expect(conferirPassagem('quero falar com uma atendente', p).passar).toBe(true);
    expect(conferirPassagem('isso é um absurdo, meu cabelo queimou', p).passar).toBe(true);
    expect(conferirPassagem('VOCÊS NÃO RESPONDEM NUNCA', p).passar).toBe(true);
    expect(conferirPassagem('oi, quanto custa a progressiva?', p).passar).toBe(false);
    expect(conferirPassagem('pago R$ 1.200 se fizer hoje', { ...p, valorAcimaDe: 800 }).passar).toBe(true);
    expect(conferirPassagem('quero cancelar', { ...p, palavras: ['cancelar'] }).motivo).toContain('cancelar');
  });
  it('entende os comandos mais comuns sem IA', () => {
    const a = interpretarPorRegras('mova para Interessada todas que pediram preço hoje e não agendaram', [])!;
    expect(a.acao).toMatchObject({ tipo: 'mover_etapa', etapa: 'interessada' });
    expect(a.filtro).toMatchObject({ pediuPrecoDias: 0, naoAgendou: true });
    const b = interpretarPorRegras('marque VIP quem gastou mais de 500', ['VIP', 'Instagram'])!;
    expect(b.acao).toMatchObject({ tipo: 'marcar_tag', tag: 'VIP' });
    expect(b.filtro.gastouAcimaDe).toBe(500);
    expect(interpretarPorRegras('liste quem sumiu há 3 dias', [])!.filtro.sumiuDias).toBe(3);
    expect(interpretarPorRegras('apague todas as conversas', [])).toBeUndefined();
  });
  it('importa texto de HTML e de PDF simples', () => {
    expect(textoDoHtml('<html><script>x()</script><h1>Preços</h1><p>Progressiva &amp; botox</p></html>')).toBe('Preços\nProgressiva & botox');
    const fluxo = deflateSync(Buffer.from('BT /F1 12 Tf (Progressiva sem formol) Tj T* (para gestantes) Tj ET', 'latin1'));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<<>>stream\n', 'latin1'), fluxo, Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')]);
    expect(textoDoPdf(pdf)).toContain('Progressiva sem formol');
  });
});

describe.each(ambientes)('Agentes de IA ($nome)', (amb) => {
  it('CRUD: só a gestão cria e muda; a chave nunca volta para a tela; nota com sugestões', async () => {
    const m = await montar(amb);
    expect((await m.como(m.gente.carla, 'POST', '/api/agentes-ia', { nome: 'X' })).statusCode).toBe(403);
    const a = await m.criarAgente({ chave: 'sk-ant-propria-123' });
    expect(a.temChavePropria).toBe(true);
    // Atendente não vê o estúdio da IA (nem a lista, nem o detalhe, nem o prompt).
    expect((await m.como(m.gente.carla, 'GET', '/api/agentes-ia')).statusCode).toBe(403);
    expect((await m.como(m.gente.carla, 'GET', `/api/agentes-ia/${a.id}`)).statusCode).toBe(403);
    expect((await m.como(m.gente.carla, 'GET', `/api/agentes-ia/${a.id}/prompt`)).statusCode).toBe(403);
    expect((await m.como(m.gente.carla, 'GET', '/api/agentes-ia/controle')).statusCode).toBe(403);
    const lista = (await m.como(m.gente.admin, 'GET', '/api/agentes-ia')).json();
    expect(lista.agentes).toHaveLength(1);
    expect(JSON.stringify(lista)).not.toContain('sk-ant-propria');
    expect(JSON.stringify(lista)).not.toContain('chaveCifrada');
    const d = (await m.como(m.gente.admin, 'GET', `/api/agentes-ia/${a.id}`)).json();
    expect(d.nota.nota).toBeGreaterThan(0);
    expect(d.nota.sugestoes.length).toBeGreaterThan(0);
    const p = await m.como(m.gente.admin, 'PATCH', `/api/agentes-ia/${a.id}`, { chave: null, criatividade: 10 });
    expect(p.json()).toMatchObject({ temChavePropria: false, criatividade: 10 });
    expect((await m.como(m.gente.admin, 'DELETE', `/api/agentes-ia/${a.id}`)).statusCode).toBe(200);
  });

  it('prompt montado com persona, regras, padrões, exemplos, conhecimento, aprendizados e memória da cliente', async () => {
    const m = await montar(amb);
    const a = await m.criarAgente();
    await m.como(m.gente.admin, 'POST', `/api/agentes-ia/${a.id}/conhecimento`, { tipo: 'faq', titulo: 'Atende criança?', conteudo: 'A partir de 12 anos.' });
    const ap = (await m.como(m.gente.carla, 'POST', `/api/agentes-ia/${a.id}/aprendizados`, { texto: 'Chamar a cliente de "flor" nunca.' })).json();
    expect((await m.como(m.gente.carla, 'POST', `/api/agentes-ia/aprendizados/${ap.id}/aprovar`, {})).statusCode).toBe(403);
    await m.como(m.gente.admin, 'POST', `/api/agentes-ia/aprendizados/${ap.id}/aprovar`, {});
    await m.como(m.gente.admin, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true, agenteId: a.id } });
    const telefone = '5571999990001';
    await m.ag.armazem.gravarMemoria('imperio', { telefone, chave: 'tipo_cabelo', valor: 'cacheado', agenteId: null, conversaId: null, fonte: 'ia', atualizadoEm: m.relogio.t });
    await m.escreve('norte', 'oi, quanto custa?', telefone);
    const p = m.falso.recebidos.at(-1)!;
    const sys = systemDe(p);
    for (const t of ['Lia, consultora de progressiva', 'calorosa e direta', 'Não use emojis', 'NUNCA: Nunca dar preço sem perguntar', 'SEMPRE: Sempre oferecer horário', 'Temos opção sem formol', '<resposta_ideal>Depende do comprimento', 'A partir de 12 anos', 'Chamar a cliente de "flor" nunca', 'Salvador Norte Shopping']) {
      expect(sys).toContain(t);
    }
    expect(JSON.stringify(p.messages)).toContain('Tipo de cabelo: cacheado');
    expect(p).not.toHaveProperty('temperature'); // Claude: criatividade vira tom no prompt
  });

  it('usa a chave própria do agente quando existe; sem ela, a geral', async () => {
    const m = await montar(amb);
    const a = await m.criarAgente({ chave: 'sk-propria-xyz' });
    await m.como(m.gente.admin, 'POST', `/api/agentes-ia/${a.id}/testar`, { mensagem: 'oi' });
    expect(m.chamadas.at(-1)).toEqual({ provedor: 'anthropic', chave: 'sk-propria-xyz' });
    await m.como(m.gente.admin, 'PATCH', `/api/agentes-ia/${a.id}`, { chave: null });
    await m.como(m.gente.admin, 'POST', `/api/agentes-ia/${a.id}/testar`, { mensagem: 'oi' });
    expect(m.chamadas.at(-1)).toEqual({ provedor: 'anthropic', chave: undefined });
  });

  it('ferramentas restritas: só as liberadas vão para a IA e o resto é recusado', async () => {
    const m = await montar(amb, { respostas: [usa('agendar', { unidade: 'norte', servico_id: 1, profissional_id: 1, data: '2026-11-06', hora: '10:00', nome_cliente: 'Marina' }), fim('Posso ver com a equipe.')] });
    const a = await m.criarAgente({ config: { ferramentas: ['responder', 'consultar_agenda'] } });
    const r = (await m.como(m.gente.admin, 'POST', `/api/agentes-ia/${a.id}/testar`, { mensagem: 'quero marcar amanhã 10h' })).json();
    const tools = nomesTools(m.falso.recebidos[0]!);
    expect(tools).toContain('ver_servicos');
    expect(tools).not.toContain('agendar');
    expect(tools).not.toContain('passar_para_humano');
    expect(tools).not.toContain('registrar_etapa');
    expect(r.ferramentas[0]).toMatchObject({ nome: 'agendar', ok: false, resultado: 'Ferramenta não permitida para este agente.' });
    expect(r.resposta).toBe('Posso ver com a equipe.');
  });

  it('passagem para humano pelas condições do agente, sem chamar a IA', async () => {
    const m = await montar(amb);
    const a = await m.criarAgente();
    await m.como(m.gente.admin, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true, agenteId: a.id } });
    const c = await m.escreve('norte', 'quero falar com uma atendente agora');
    const depois = await m.repo.buscarConversa(c.id);
    expect(depois!.modo).toBe('humano');
    expect(depois!.etiquetas).toContain('precisa da equipe');
    expect(m.falso.recebidos).toHaveLength(0);
    const t = (await m.como(m.gente.admin, 'POST', `/api/agentes-ia/${a.id}/testar`, { mensagem: 'isso é um absurdo' })).json();
    expect(t.passagemDireta).toContain('Reclamação');
  });

  it('IA atende primeiro só quando ligada (e respeita a unidade); a atendente assume e devolve', async () => {
    const m = await montar(amb);
    const a = await m.criarAgente();
    const antes = await m.escreve('norte', 'oi');
    expect((await m.repo.buscarConversa(antes.id))!.modo).toBe('copiloto');
    expect(m.padrao.pedidos.length).toBeGreaterThan(0); // agente de sempre
    expect(m.falso.recebidos).toHaveLength(0);

    expect((await m.como(m.gente.carla, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true, agenteId: a.id } })).statusCode).toBe(403);
    expect((await m.como(m.gente.admin, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true } })).statusCode).toBe(400);
    await m.como(m.gente.admin, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true, agenteId: a.id } });
    const nova = await m.escreve('norte', 'oi, tudo bem?');
    const n = (await m.repo.buscarConversa(nova.id))!;
    expect(n.modo).toBe('ia');
    expect(m.enviados.at(-1)!.texto).toContain('Tenho horário amanhã');
    expect(m.falso.recebidos).toHaveLength(1);
    const outra = await m.escreve('sumare', 'oi');
    expect((await m.repo.buscarConversa(outra.id))!.modo).toBe('copiloto');

    const info = (await m.como(m.gente.carla, 'GET', `/api/agentes-ia/conversa/${nova.id}`)).json();
    expect(info).toMatchObject({ noControle: 'ia', agente: { nome: 'Lia' } });
    await m.como(m.gente.carla, 'POST', `/api/agentes-ia/conversa/${nova.id}/assumir`, {});
    expect((await m.repo.buscarConversa(nova.id))!.modo).toBe('humano');
    await m.como(m.gente.carla, 'POST', `/api/agentes-ia/conversa/${nova.id}/devolver`, {});
    expect((await m.repo.buscarConversa(nova.id))!.modo).toBe('ia');
  });

  it('sem chave (nem própria nem geral): IA primeiro não liga e a tela pede a chave', async () => {
    const m = await montar(amb, { chaveGeral: false });
    const a = await m.criarAgente();
    await m.como(m.gente.admin, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true, agenteId: a.id } });
    const c = await m.escreve('norte', 'oi');
    expect((await m.repo.buscarConversa(c.id))!.modo).not.toBe('ia');
    expect((await m.como(m.gente.admin, 'GET', '/api/agentes-ia')).json().chaves).toEqual({ anthropic: false, openai: false });
  });

  it('memória: a IA grava fatos da cliente e a equipe vê na conversa', async () => {
    const m = await montar(amb, { respostas: [usa('lembrar_cliente', { fatos: [{ chave: 'ultima_quimica', valor: 'progressiva em agosto' }] }), fim('Anotado!')] });
    const a = await m.criarAgente();
    await m.como(m.gente.admin, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true, agenteId: a.id } });
    const c = await m.escreve('norte', 'fiz progressiva em agosto');
    const info = (await m.como(m.gente.carla, 'GET', `/api/agentes-ia/conversa/${c.id}`)).json();
    expect(info.memoria).toEqual([expect.objectContaining({ chave: 'ultima_quimica', valor: 'progressiva em agosto' })]);
  });

  it('comandos: plano com prévia, nada muda antes de confirmar, executa e fica na auditoria', async () => {
    const m = await montar(amb);
    const c1 = await m.escreve('norte', 'quanto custa a progressiva?');
    const c2 = await m.escreve('norte', 'oi, bom dia');
    expect((await m.como(m.gente.carla, 'POST', '/api/ia/comando', { texto: 'liste todas' })).statusCode).toBe(403);
    const r = await m.como(m.gente.admin, 'POST', '/api/ia/comando', { texto: 'mova para Interessada todas que pediram preço hoje e não agendaram' });
    expect(r.statusCode).toBe(200);
    const plano = r.json();
    expect(plano.situacao).toBe('planejado');
    expect(plano.plano.itens.map((i: { conversaId: string }) => i.conversaId)).toEqual([c1.id]);
    expect(plano.plano.explicacao).toContain('Interessada');
    expect((await m.repo.buscarConversa(c1.id))!.etapa).not.toBe('interessada');
    const ok = await m.como(m.gente.admin, 'POST', `/api/ia/comando/${plano.id}/confirmar`, {});
    expect(ok.json()).toMatchObject({ situacao: 'executado', resultado: { feitos: 1, confirmadoPor: 'Bruno Batista' } });
    expect((await m.repo.buscarConversa(c1.id))!.etapa).toBe('interessada');
    expect((await m.repo.buscarConversa(c2.id))!.etapa).not.toBe('interessada');
    expect((await m.como(m.gente.admin, 'POST', `/api/ia/comando/${plano.id}/confirmar`, {})).statusCode).toBe(409);
    const hist = (await m.como(m.gente.admin, 'GET', '/api/ia/comandos')).json();
    expect(hist[0]).toMatchObject({ id: plano.id, por: 'Bruno Batista', situacao: 'executado' });
    expect((await m.como(m.gente.admin, 'POST', '/api/ia/comando', { texto: 'apague tudo agora' })).statusCode).toBe(422);
  });

  it('correção da equipe vira aprendizado pendente', async () => {
    const m = await montar(amb);
    const a = await m.criarAgente();
    await m.como(m.gente.admin, 'PUT', '/api/agentes-ia/controle', { norte: { ligado: true, agenteId: a.id } });
    const c = await m.escreve('norte', 'vocês fazem em gestante?');
    await m.repo.guardarSugestao(c.id, 'Sim, fazemos qualquer progressiva.');
    m.relogio.t = new Date(m.relogio.t.getTime() + 60_000);
    await m.sintonia.equipeEnviou(c.id, 'Para gestantes usamos só a linha sem formol, com liberação médica.', 'Carla');
    await m.ag.controle.aoEvento({ tipo: 'equipe_respondeu', conversaId: c.id, em: m.relogio.t });
    const pend = (await m.como(m.gente.admin, 'GET', '/api/agentes-ia/aprendizados?situacao=pendente')).json();
    expect(pend).toHaveLength(1);
    expect(pend[0].texto).toContain('sem formol');
  });
});

import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { Agente, type ClienteClaude } from '../src/ai/agente.js';
import { ehGestor } from '../src/auth/acesso.js';
import { pode } from '../src/auth/permissoes.js';
import { conversarComIa, LIMITES_CHAT, type ContextoChat } from '../src/conversa/chat-ia.js';
import { RespostasMemoria } from '../src/conversa/respostas.js';
import { registrarConversa } from '../src/conversa/rotas.js';
import { TranscricoesMemoria } from '../src/conversa/transcricao.js';
import type { Conversa } from '../src/domain.js';
import { AuditoriaMemoria } from '../src/seguranca/auditoria.js';
import { AcoesSerena } from '../src/serena/acoes.js';
import { EnvioAosPoucos, registrarSerenaFaz } from '../src/serena/confirmar.js';
import { ferramentasInternet, fontesDe, limparConsulta, MAX_BUSCAS } from '../src/serena/internet.js';
import { trecho } from '../src/serena/ler.js';
import { ambientes, montarGestao, quinta } from './gestao-ambiente.js';
import { fabricas } from './repos.js';

/**
 * serena-super: a Serena é o próprio CRM, vivo. Ela lê tudo o que a pessoa pode ver (mensagens, leads,
 * números, documentos, agenda, equipe), pesquisa na internet (só no chat interno), pensa mais quando pedem,
 * e muda o CRM só depois do "Confirmar". IA de mentira: nada chama a API de verdade.
 */

type Bloco =
  | { type: 'text'; text: string; citations?: unknown[] }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'server_tool_use'; id: string; name: string; input: unknown }
  | { type: 'web_search_tool_result'; tool_use_id: string; content: unknown };
interface Pedido {
  model: string;
  max_tokens: number;
  tools?: Array<{ name: string; type?: string; max_uses?: number }>;
  thinking?: { type: string; display?: string };
  output_config?: { effort?: string };
  system: string | Array<{ text: string }>;
  messages: Array<{ role: string; content: unknown }>;
}
type Resposta = Bloco[] | { content: Bloco[]; stop_reason?: string; usage?: { output_tokens: number } };

/** IA de mentira: responde um roteiro e guarda cada pedido (e as opções, como o timeout). */
function claudeRoteiro(respostas: Resposta[] | ((p: Pedido, i: number) => Resposta)) {
  const pedidos: Pedido[] = [];
  const opcoes: unknown[] = [];
  let i = 0;
  const beta = {
    messages: {
      create: async (p: Pedido, o?: unknown) => {
        pedidos.push(structuredClone(p));
        opcoes.push(o);
        const r = typeof respostas === 'function' ? respostas(p, i++) : respostas[Math.min(i++, respostas.length - 1)]!;
        const content = Array.isArray(r) ? r : r.content;
        const stop = Array.isArray(r) ? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn') : (r.stop_reason ?? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'));
        return { stop_reason: stop, content, ...(Array.isArray(r) ? {} : { usage: r.usage }) };
      },
    },
  };
  return { beta, pedidos, opcoes };
}
let nTool = 0;
const usar = (name: string, input: unknown): Bloco => ({ type: 'tool_use', id: `tu_${++nTool}`, name, input });
const texto = (t: string): Bloco => ({ type: 'text', text: t });
const sistemaDe = (p: Pedido) => (typeof p.system === 'string' ? p.system : p.system.map((s) => s.text).join('\n'));
/** Resultados de ferramenta que a IA recebeu num pedido. */
const resultados = (p: Pedido) => {
  const ult = p.messages.at(-1)!;
  return Array.isArray(ult.content) ? (ult.content as Array<{ content: string; is_error?: boolean }>) : [];
};
const pedidosPrincipais = (pedidos: Pedido[]) => pedidos.filter((p) => typeof p.system !== 'string');

for (const amb of ambientes) {
  describe(`Serena super (${amb.nome})`, () => {
    async function montar() {
      const g = await montarGestao(amb, { inicio: quinta(14) });
      const ia = claudeRoteiro([[texto('oi')]]);
      const auditoria = new AuditoriaMemoria();
      const tarefas: Array<{ corpo: unknown; por: string }> = [];
      const pausas: Array<{ corpo: unknown; por: string }> = [];
      const analises: Array<{ tipo: string; query: unknown; por: string }> = [];
      // Rotas que no servidor de verdade vêm de outros módulos (Rotina, Análises, pausa): dublês com a mesma regra.
      g.app.post('/api/rotina/tarefas', async (req: FastifyRequest) => (tarefas.push({ corpo: req.body, por: req.usuario?.nome ?? '' }), { id: 't1' }));
      g.app.put('/api/ia/pausa', async (req: FastifyRequest, reply) => {
        if (!req.usuario || !ehGestor(req.usuario)) return reply.code(403).send({ erro: 'Só a gestão liga e desliga a Serena.' });
        pausas.push({ corpo: req.body, por: req.usuario.nome });
        return { pausada: true };
      });
      g.app.get('/api/analises/:tipo', async (req: FastifyRequest, reply) => {
        if (req.usuario && !pode(req, 'relatorios')) return reply.code(403).send({ erro: 'As análises ficam com a gerência, a direção e a administração.' });
        analises.push({ tipo: (req.params as { tipo: string }).tipo, query: req.query, por: req.usuario?.nome ?? '' });
        return { total: { vendas: 12, valor: 4870 }, porOrigem: [{ origem: 'Instagram', vendas: 7 }, { origem: 'Google', vendas: 5 }] };
      });
      registrarConversa(g.app, {
        repo: g.repo,
        sintonia: g.sintonia,
        empresaId: 'imperio',
        agora: () => g.relogio.t,
        respostas: new RespostasMemoria(),
        transcricoes: new TranscricoesMemoria(),
        ia: { claude: ia as unknown as ClienteClaude, modelo: 'claude-opus-5-5', base: () => g.base.texto(), ligada: () => true },
        canalDa: () => ({ erro: 'sem número' }),
        serenaAcoes: () => ({ tags: () => g.tags.listar() }),
        serenaFaz: {},
      });
      registrarSerenaFaz(g.app, { repo: g.repo, empresaId: 'imperio', sintonia: g.sintonia, servicos: {}, auditoria, envio: new EnvioAosPoucos({ esperar: async () => {}, intervaloMs: () => 0 }), agora: () => g.relogio.t });
      const { admin, carla } = g.gente;
      /** Troca o roteiro da IA e conversa com a Serena (com progresso, se pedir). */
      const chat = async (quem: typeof admin, pergunta: string, respostas: Parameters<typeof claudeRoteiro>[0], extra: { pensarMais?: boolean; aosPoucos?: boolean } = {}) => {
        const r = claudeRoteiro(respostas);
        ia.beta = r.beta as typeof ia.beta;
        const resp = await g.app.inject({
          method: 'POST',
          url: '/api/ia/chat',
          headers: { cookie: await cookie(quem), ...(extra.aosPoucos ? { accept: 'application/x-ndjson' } : {}) },
          payload: { mensagens: [{ papel: 'usuario', texto: pergunta }], ...(extra.pensarMais ? { pensarMais: true } : {}) },
        });
        return { resp, pedidos: r.pedidos, opcoes: r.opcoes };
      };
      const cookies = new Map<string, string>();
      const cookie = async (u: typeof admin) => {
        if (!cookies.has(u.id)) cookies.set(u.id, `sintonia_sessao=${await g.contas.criarSessao(u.id, new Date(g.relogio.t.getTime() + 30 * 24 * 3600_000))}`);
        return cookies.get(u.id)!;
      };
      const confirmar = async (quem: typeof admin, dados: unknown) => g.app.inject({ method: 'POST', url: '/api/serena/confirmar', headers: { cookie: await cookie(quem) }, payload: { tipo: 'mudar', dados } });
      return { ...g, ia, auditoria, tarefas, pausas, analises, chat, confirmar, cookie };
    }

    // ------------------------------------------------------------ internet e "Pensar mais"
    describe('internet e Pensar mais: o que vai para a API', () => {
      it('mensagem normal: a pesquisa na internet está nas ferramentas; sem raciocínio extra, esforço baixo', async () => {
        const m = await montar();
        const { resp, pedidos } = await m.chat(m.gente.admin, 'oi', [[texto('Oi!')]]);
        expect(resp.statusCode, resp.body).toBe(200);
        const p = pedidos[0]!;
        expect(p.tools!.map((t) => t.name)).toEqual(expect.arrayContaining(['pesquisar_internet', 'buscar_mensagens', 'buscar_leads', 'ver_numeros', 'mostrar_tarefa']));
        // A busca de verdade roda num pedido à parte (só com a consulta limpa): nada de web_search aqui.
        expect(p.tools!.some((t) => t.type?.startsWith('web_search'))).toBe(false);
        expect(p.thinking).toBeUndefined();
        expect(p.output_config).toEqual({ effort: 'low' });
        expect(p.max_tokens).toBe(LIMITES_CHAT.normal.maxTokens);
        const s = sistemaDe(p);
        expect(s).toContain('o próprio CRM da Sintonia, vivo');
        expect(s).toContain('Nunca ponha nome, telefone, e-mail ou qualquer dado de cliente na pesquisa');
        expect(s).toContain('inventar preço, horário, regra');
        expect(resp.json()).not.toHaveProperty('pensouMais');
      });

      it('"Pensar mais": raciocínio adaptativo com resumo, esforço alto e mais espaço; devolve o "Ver raciocínio"', async () => {
        const m = await montar();
        const { resp, pedidos } = await m.chat(m.gente.admin, 'qual o melhor plano para esta semana?', [[{ type: 'thinking', thinking: 'Comparei a agenda com as conversas paradas.', signature: 's' }, texto('Foque nas paradas.')]], { pensarMais: true });
        expect(resp.statusCode, resp.body).toBe(200);
        expect(pedidos[0]!.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
        expect(pedidos[0]!.output_config).toEqual({ effort: 'high' });
        expect(pedidos[0]!.max_tokens).toBe(LIMITES_CHAT.pensarMais.maxTokens);
        expect(resp.json()).toMatchObject({ texto: 'Foque nas paradas.', raciocinio: 'Comparei a agenda com as conversas paradas.', pensouMais: true });
      });

      it('pesquisa: pedido separado com web_search (máx. 5) e web_fetch, SEM telefone nem nome de cliente; volta com as fontes e o "Pesquisando na internet…"', async () => {
        const m = await montar();
        await m.conversa('norte', 'Fabiana Matos');
        const { resp, pedidos } = await m.chat(
          m.gente.admin,
          'pesquisa preço médio de progressiva em Salvador',
          (p, i) => {
            if (typeof p.system === 'string')
              return {
                content: [
                  { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'preço progressiva Salvador' } },
                  { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://exemplo.com.br/precos', title: 'Preços de progressiva', encrypted_content: 'x', page_age: null }] },
                  { type: 'text', text: 'Em Salvador, fica entre R$ 150 e R$ 400.', citations: [{ type: 'web_search_result_location', url: 'https://exemplo.com.br/precos', title: 'Preços de progressiva', cited_text: '...', encrypted_index: 'e' }] },
                ],
                stop_reason: 'end_turn',
              };
            return i === 0 ? [usar('pesquisar_internet', { consulta: 'preço progressiva Salvador para Fabiana Matos (71) 98812-4471 fabi@gmail.com' })] : [texto('Na internet: de R$ 150 a R$ 400.')];
          },
          { aosPoucos: true },
        );
        expect(resp.statusCode, resp.body).toBe(200);
        expect(resp.headers['content-type']).toContain('application/x-ndjson');
        const linhas = resp.body.trim().split('\n').map((l) => JSON.parse(l));
        expect(linhas.map((l) => l.progresso?.texto).filter(Boolean)).toEqual(expect.arrayContaining(['Pensando…', 'Pesquisando na internet…']));
        const fim = linhas.at(-1);
        expect(fim.fim).toBe(true);
        expect(fim.resposta.fontes).toEqual([{ titulo: 'Preços de progressiva', url: 'https://exemplo.com.br/precos' }]);
        // O pedido da pesquisa: só as ferramentas de servidor, com limite, e a consulta limpa.
        const busca = pedidos.find((p) => typeof p.system === 'string')!;
        expect(busca.tools).toEqual([
          expect.objectContaining({ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS }),
          expect.objectContaining({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }),
        ]);
        const enviado = JSON.stringify(busca.messages);
        expect(enviado).toContain('progressiva Salvador');
        expect(enviado).not.toMatch(/98812|4471/);
        expect(enviado).not.toContain('Fabiana');
        expect(enviado).not.toContain('@gmail');
        // Nada de CRM no pedido da pesquisa (nem o contexto nem as ferramentas do CRM).
        expect(enviado).not.toContain('esperando_resposta');
        expect(resultados(pedidosPrincipais(pedidos)[1]!)[0]!.content).toContain('dados pessoais tirados da consulta');
      });

      it('no máximo 2 pesquisas por mensagem', async () => {
        const m = await montar();
        const { pedidos } = await m.chat(m.gente.admin, 'pesquisa 3 coisas', (p, i) =>
          typeof p.system === 'string' ? { content: [texto('achei')], stop_reason: 'end_turn' } : i === 0 ? [usar('pesquisar_internet', { consulta: 'a coisa um' }), usar('pesquisar_internet', { consulta: 'a coisa dois' }), usar('pesquisar_internet', { consulta: 'a coisa três' })] : [texto('ok')],
        );
        expect(pedidos.filter((p) => typeof p.system === 'string')).toHaveLength(2);
        const r = resultados(pedidosPrincipais(pedidos)[1]!);
        expect(r.filter((x) => x.is_error)).toHaveLength(1);
      });
    });

    // ------------------------------------------------------------ leitura (age direto, respeita quem vê)
    describe('leitura do CRM', () => {
      it('buscar_mensagens: acha o texto, mostra os trechos com o botão de abrir e respeita a unidade de quem pergunta', async () => {
        const m = await montar();
        const ana = await m.conversa('norte', 'Ana Lima', 'Vocês têm promoção de progressiva?');
        const bia = await m.conversa('sumare', 'Bia Rocha', 'Vi a promoção no Instagram');
        await m.conversa('norte', 'Clara Nova', 'Bom dia');
        const ida = [usar('buscar_mensagens', { texto: 'promoção' })];
        const admin = await m.chat(m.gente.admin, 'quem falou de promoção?', [ida, [texto('Ana [[c1]] e Bia.')]]);
        expect(admin.resp.statusCode, admin.resp.body).toBe(200);
        const lista = resultados(admin.pedidos[1]!)[0]!.content;
        expect(lista).toContain('Ana Lima');
        expect(lista).toContain('Bia Rocha');
        expect(lista).not.toContain('Clara Nova');
        const card = admin.resp.json().artefatos.find((a: { tipo: string }) => a.tipo === 'mensagens');
        expect(card.dados.itens.map((i: { conversaId: string }) => i.conversaId).sort()).toEqual([ana.id, bia.id].sort());
        expect(card.dados.itens[0].trecho).toMatch(/promoção/);
        // A referência que a ferramenta deu vira o botão de abrir a conversa.
        const refs = admin.resp.json().clientes;
        expect(Object.values(refs).map((r) => (r as { conversaId: string }).conversaId)).toEqual(expect.arrayContaining([expect.any(String)]));

        const carla = await m.chat(m.gente.carla, 'quem falou de promoção?', [ida, [texto('Só a Ana.')]]);
        const daCarla = resultados(carla.pedidos[1]!)[0]!.content;
        expect(daCarla).toContain('Ana Lima');
        expect(daCarla).not.toContain('Bia Rocha'); // Sumaré: a Carla não vê
        const filtro = await m.chat(m.gente.admin, 'quem mandou "bom"?', [[usar('buscar_mensagens', { texto: 'bom', quem: 'equipe' })], [texto('ninguém')]]);
        expect(resultados(filtro.pedidos[1]!)[0]!.content).toContain('Nenhuma mensagem');
      });

      it('buscar_leads: por etiqueta (e etapa), só o que a pessoa vê', async () => {
        const m = await montar();
        const ana = await m.conversa('norte', 'Ana Lima');
        await m.conversa('norte', 'Clara Nova');
        const bia = await m.conversa('sumare', 'Bia Rocha');
        const vip = (await m.como(m.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
        for (const c of [ana, bia]) expect((await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/tags`, { tagId: vip.id })).statusCode).toBe(200);
        const ida = [usar('buscar_leads', { etiqueta: 'vip' })];
        const admin = await m.chat(m.gente.admin, 'quem é VIP?', [ida, [texto('ok')]]);
        const l = resultados(admin.pedidos[1]!)[0]!.content;
        expect(l).toContain('Ana Lima');
        expect(l).toContain('Bia Rocha');
        expect(l).not.toContain('Clara Nova');
        expect(l).toContain('etiquetas: VIP');
        const carla = await m.chat(m.gente.carla, 'quem é VIP?', [ida, [texto('ok')]]);
        const lc = resultados(carla.pedidos[1]!)[0]!.content;
        expect(lc).toContain('Ana Lima');
        expect(lc).not.toContain('Bia Rocha');
        const nada = await m.chat(m.gente.admin, 'quem é ouro?', [[usar('buscar_leads', { etiqueta: 'ouro' })], [texto('ok')]]);
        expect(resultados(nada.pedidos[1]!)[0]).toMatchObject({ is_error: true });
      });

      it('ver_numeros: lê a mesma rota da tela, com o período certo; quem não tem acesso ouve o motivo', async () => {
        const m = await montar();
        await m.conversa('norte', 'Ana Lima');
        const ida = [usar('ver_numeros', { relatorio: 'vendas', periodo: '7d' })];
        const admin = await m.chat(m.gente.admin, 'vendas da semana?', [ida, [usar('mostrar_numeros', { titulo: 'Vendas por origem', formato: 'barras', itens: [{ rotulo: 'Instagram', valor: 7 }, { rotulo: 'Google', valor: 5 }], abrir: 'analises' })], [texto('Instagram lidera.')]]);
        expect(admin.resp.statusCode, admin.resp.body).toBe(200);
        expect(m.analises).toEqual([{ tipo: 'vendas', query: { periodo: '7d' }, por: 'Bruno Batista' }]);
        expect(resultados(admin.pedidos[1]!)[0]!.content).toContain('"valor":4870');
        const card = admin.resp.json().artefatos.find((a: { tipo: string }) => a.tipo === 'numeros');
        expect(card).toMatchObject({ titulo: 'Vendas por origem', dados: { formato: 'barras', abrir: 'analises', itens: [{ rotulo: 'Instagram', valor: 7 }, { rotulo: 'Google', valor: 5 }] } });

        const carla = await m.chat(m.gente.carla, 'vendas da semana?', [ida, [texto('Você não tem acesso.')]]);
        const r = resultados(carla.pedidos[1]!)[0]!;
        expect(r.is_error).toBe(true);
        expect(r.content).toContain('não tem acesso');
        expect(m.analises).toHaveLength(1); // a da Carla nem chegou

        const painel = await m.chat(m.gente.admin, 'como está o dia?', [[usar('ver_numeros', { relatorio: 'dashboard', periodo: 'hoje' })], [texto('ok')]]);
        expect(resultados(painel.pedidos[1]!)[0]!.content).toContain('Fonte: o Dashboard');
      });

      it('buscar_documentos: acha no treinamento e diz de onde veio', async () => {
        const m = await montar();
        const { pedidos } = await m.chat(m.gente.carla, 'como é o jeito de falar?', [[usar('buscar_documentos', { busca: 'caloroso', onde: ['treinamento'] })], [texto('Curto e caloroso.')]]);
        const r = resultados(pedidos[1]!)[0]!.content;
        expect(r).toContain('Agente de IA › Treinamento');
        expect(r).toContain('Curto e caloroso');
      });
    });

    // ------------------------------------------------------------ mudanças (só no Confirmar)
    describe('mudanças no CRM: só depois do Confirmar', () => {
      it('tarefa: o cartão não cria nada; o Confirmar chama a Rotina como quem pediu e vai para a auditoria', async () => {
        const m = await montar();
        const ana = await m.conversa('norte', 'Ana Lima');
        const { resp } = await m.chat(m.gente.admin, 'cria uma tarefa para a Carla ligar para a Ana amanhã', [
          [usar('mostrar_tarefa', { titulo: 'Ligar para a Ana', responsavel: 'Carla', conversa_id: ana.id, data: '2026-11-06', hora: '10:00', prioridade: 'alta' })],
          [texto('Preparei a tarefa. Confira e confirme.')],
        ]);
        expect(resp.statusCode, resp.body).toBe(200);
        const card = resp.json().artefatos[0];
        expect(card).toMatchObject({ tipo: 'mudar', titulo: 'Ligar para a Ana', dados: { acao: 'tarefa', botao: 'Confirmar e criar' } });
        expect(card.dados.linhas).toEqual(expect.arrayContaining([{ rotulo: 'Para', valor: 'Carla Lima' }, { rotulo: 'Cliente', valor: 'Ana Lima' }]));
        expect(m.tarefas).toHaveLength(0);
        const r = await m.confirmar(m.gente.admin, { acao: card.dados.acao, params: card.dados.params });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json().resumo).toContain('Tarefa criada');
        expect(m.tarefas).toEqual([{ corpo: expect.objectContaining({ titulo: 'Ligar para a Ana', responsavelId: m.gente.carla.id, conversaId: ana.id, prioridade: 'alta', venceEm: expect.stringMatching(/^2026-11-06T13:00/) }), por: 'Bruno Batista' }]);
        expect(m.auditoria.linhas.map((l) => l.acao)).toEqual(['serena_tarefa']);
      });

      it('etiqueta: marca pela rota de sempre só depois do Confirmar', async () => {
        const m = await montar();
        const ana = await m.conversa('norte', 'Ana Lima');
        const vip = (await m.como(m.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
        const { resp } = await m.chat(m.gente.admin, 'marca a Ana como VIP', [[usar('mostrar_etiqueta_conversa', { acao: 'marcar', etiqueta: 'VIP', conversas: [ana.id] })], [texto('ok')]]);
        const card = resp.json().artefatos[0];
        expect(card.titulo).toBe('Marcar "VIP" em Ana Lima');
        expect((await m.tags.daConversa(ana.id)).map((t) => t.id)).toEqual([]);
        const r = await m.confirmar(m.gente.admin, { acao: 'etiqueta', params: card.dados.params });
        expect(r.statusCode, r.body).toBe(200);
        expect((await m.tags.daConversa(ana.id)).map((t) => t.id)).toEqual([vip.id]);
        expect(m.auditoria.linhas.map((l) => l.acao)).toEqual(['serena_etiqueta']);
      });

      it('pausar a Serena: a atendente nem recebe a ferramenta, e o Confirmar dela é recusado pela rota', async () => {
        const m = await montar();
        const carla = await m.chat(m.gente.carla, 'pausa a Serena', [[texto('Só a gestão pode.')]]);
        expect(carla.pedidos[0]!.tools!.map((t) => t.name)).not.toContain('mostrar_pausa_serena');
        expect(sistemaDe(carla.pedidos[0]!)).toMatch(/NÃO pode: .*pausar a Serena/);
        const r = await m.confirmar(m.gente.carla, { acao: 'pausa_serena', params: { pausada: true, duracao: '1h' } });
        expect(r.statusCode).toBe(403);
        expect(m.pausas).toHaveLength(0);
        const admin = await m.chat(m.gente.admin, 'pausa a Serena por 1 hora', [[usar('mostrar_pausa_serena', { pausar: true, duracao: '1h' })], [texto('ok')]]);
        const card = admin.resp.json().artefatos[0];
        expect(m.pausas).toHaveLength(0);
        expect((await m.confirmar(m.gente.admin, { acao: 'pausa_serena', params: card.dados.params })).statusCode).toBe(200);
        expect(m.pausas).toEqual([{ corpo: { pausada: true, duracao: '1h' }, por: 'Bruno Batista' }]);
      });

      it('treinamento: mostra o antes e o depois; só muda no Confirmar', async () => {
        const m = await montar();
        const { resp } = await m.chat(m.gente.admin, 'muda o jeito de falar para mais formal', [[usar('mostrar_treinamento', { secao: 'Jeito de falar', conteudo: 'Formal e gentil.' })], [texto('ok')]]);
        const card = resp.json().artefatos[0];
        expect(card.dados).toMatchObject({ acao: 'treinamento', antes: 'Curto e caloroso.', depois: 'Formal e gentil.' });
        expect(await m.base.texto()).toContain('Curto e caloroso.');
        const r = await m.confirmar(m.gente.admin, { acao: 'treinamento', params: card.dados.params });
        expect(r.statusCode, r.body).toBe(200);
        expect(await m.base.texto()).toContain('Formal e gentil.');
        // A atendente não muda o treinamento (nem a ferramenta vem).
        const carla = await m.chat(m.gente.carla, 'oi', [[texto('oi')]]);
        expect(carla.pedidos[0]!.tools!.map((t) => t.name)).not.toContain('mostrar_treinamento');
        expect((await m.confirmar(m.gente.carla, { acao: 'treinamento', params: card.dados.params })).statusCode).toBe(403);
      });

      it('o Confirmar só aceita as mudanças da lista (nunca um endereço vindo do cartão)', async () => {
        const m = await montar();
        expect((await m.confirmar(m.gente.admin, { acao: 'qualquer', params: {} })).statusCode).toBe(400);
        expect((await m.confirmar(m.gente.admin, { acao: 'etiqueta', params: { acao: 'marcar', tagId: '../../api/conta', conversas: ['x'] } })).statusCode).toBe(400);
        expect(m.auditoria.linhas).toHaveLength(0);
      });
    });
  });
}

// ------------------------------------------------------------ sem a API de verdade: peças soltas

describe('Serena super: limites e privacidade', () => {
  const contexto: ContextoChat = {
    agora: quinta(14),
    baseConhecimento: '',
    hoje: { conversasAtendidas: 0, respostas: 0, assumiu: 0, agendamentos: { total: 0 }, pediuAjuda: { total: 0, lista: [] }, envios: { total: 0, lembretes: 0, followups: 0 }, tempoMedioRespostaSeg: null, conduzindoAgora: [] },
    esperando: [],
    agenda: [],
  };

  it('limparConsulta tira telefone, e-mail, CPF e nome completo de cliente; deixa o assunto e os links', () => {
    const r = limparConsulta('progressiva Fabiana Matos +55 (71) 98812-4471 cpf 123.456.789-00 fabi@x.com https://site.com/a?b=1', ['Fabiana Matos', 'Ana']);
    expect(r.limpou).toBe(true);
    expect(r.consulta).toBe('progressiva cpf https://site.com/a?b=1');
    expect(limparConsulta('tendências de cabelo 2027').consulta).toBe('tendências de cabelo 2027');
  });

  it('fontes: citadas primeiro, sem repetir, só http(s)', () => {
    const f = fontesDe([
      { type: 'web_search_tool_result', tool_use_id: 'a', content: [{ type: 'web_search_result', url: 'https://b.com', title: 'B', encrypted_content: '', page_age: null }, { type: 'web_search_result', url: 'javascript:alert(1)', title: 'X', encrypted_content: '', page_age: null }] },
      { type: 'text', text: 'x', citations: [{ type: 'web_search_result_location', url: 'https://a.com', title: 'A', cited_text: '', encrypted_index: '' }] },
    ] as never);
    expect(f).toEqual([{ titulo: 'A', url: 'https://a.com' }, { titulo: 'B', url: 'https://b.com' }]);
    expect(ferramentasInternet().map((t) => (t as { type: string }).type)).toEqual(['web_search_20260209', 'web_fetch_20260209']);
  });

  it('a IA que atende as CLIENTES no WhatsApp não tem internet', async () => {
    const recebidos: Array<{ tools?: Array<{ name: string; type?: string }> }> = [];
    const claude = { beta: { messages: { create: (async (p: { tools?: Array<{ name: string }> }) => (recebidos.push(p), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi!' }] })) as never } } } as ClienteClaude;
    const agente = new Agente(claude, {} as never, 'BASE', { modelo: 'claude-opus-5-5', esforco: 'low' });
    const conversa: Conversa = { id: 'c1', empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: '5571', nome: 'Marina', modo: 'ia', etapa: 'em_conversa', etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9) };
    await agente.executar({ conversa, agora: quinta(14), modo: 'responder', mensagens: [{ id: '1', conversaId: 'c1', autor: 'cliente', texto: 'oi', em: quinta(14) }] });
    const nomes = (recebidos[0]!.tools ?? []).map((t) => t.type ?? t.name);
    expect(nomes.length).toBeGreaterThan(0);
    expect(nomes.some((n) => /web_search|web_fetch|pesquisar_internet/.test(n))).toBe(false);
  });

  it('sem leitura do CRM (sem as ferramentas novas), nada de internet nem de pensar mais', async () => {
    const ia = claudeRoteiro([[texto('oi')]]);
    await conversarComIa(ia as unknown as ClienteClaude, { modelo: 'm' }, [{ papel: 'usuario', texto: 'oi' }], contexto, new AcoesSerena({}, { automacoes: false, etiquetas: false }));
    expect(ia.pedidos[0]!.tools!.map((t) => t.name)).not.toContain('pesquisar_internet');
    expect(ia.pedidos[0]!.thinking).toBeUndefined();
  });

  it('prazo: cada pedido leva o tempo que sobra como timeout; passou do prazo, ela para e avisa', async () => {
    let t = 0;
    const ia = claudeRoteiro((_p, i) => {
      t += 60_000; // cada resposta "demora" 1 minuto
      return i === 0 ? [texto('Começando.'), usar('consultar_crm', {})] : [texto('Mais.'), usar('consultar_crm', {})];
    });
    const r = await conversarComIa(ia as unknown as ClienteClaude, { modelo: 'm', agoraMs: () => t, prazoMs: 100_000 }, [{ papel: 'usuario', texto: 'oi' }], contexto, new AcoesSerena({}, { automacoes: false, etiquetas: false }));
    expect(ia.pedidos).toHaveLength(2);
    expect(ia.opcoes[0]).toMatchObject({ timeout: 100_000, maxRetries: 1 });
    expect(ia.opcoes[1]).toMatchObject({ timeout: 40_000 });
    expect(r.texto).toContain('Parei aqui porque estava demorando muito');
  });

  it('teto de gasto: passou do orçamento de tokens da mensagem, para de chamar ferramentas', async () => {
    const ia = claudeRoteiro(() => ({ content: [texto('parte'), usar('consultar_crm', {})], usage: { output_tokens: LIMITES_CHAT.normal.orcamento } }));
    const r = await conversarComIa(ia as unknown as ClienteClaude, { modelo: 'm' }, [{ papel: 'usuario', texto: 'oi' }], contexto, new AcoesSerena({}, { automacoes: false, etiquetas: false }));
    expect(ia.pedidos).toHaveLength(1);
    expect(r.texto).toContain('para não gastar demais');
  });

  it('trecho: corta em volta do termo, sem ligar para acento', () => {
    expect(trecho(`${'a'.repeat(200)} quero a promocao de hoje ${'b'.repeat(200)}`, 'promoção', 10)).toBe('…a quero a promocao de hoje b…');
  });
});

// A busca no texto das mensagens (índice da robustez): memória e Postgres iguais.
for (const f of fabricas) {
  describe(`buscarMensagens (${f.nome})`, () => {
    it('acha pelo texto (sem diferenciar maiúscula), com escopo, período, quem mandou e conversa', async () => {
      const repo = await f.criar();
      const a = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: '5571999990001', nome: 'Ana', agora: quinta(9) })).conversa;
      const b = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'imperio-sumare', telefone: '5571999990002', nome: 'Bia', agora: quinta(9) })).conversa;
      await repo.adicionarMensagem({ conversaId: a.id, autor: 'cliente', texto: 'Tem PROMOÇÃO hoje?', em: quinta(10) });
      await repo.adicionarMensagem({ conversaId: a.id, autor: 'equipe', autorNome: 'Carla', texto: 'A promoção vale até sexta', em: quinta(11) });
      await repo.adicionarMensagem({ conversaId: b.id, autor: 'cliente', texto: 'vi a promoção', em: quinta(12) });
      await repo.adicionarMensagem({ conversaId: b.id, autor: 'sistema', texto: 'nota: promoção', em: quinta(12, 30) });
      const tudo = await repo.buscarMensagens({ texto: 'promoção', limite: 10 });
      expect(tudo.map((m) => m.texto)).toEqual(['vi a promoção', 'A promoção vale até sexta', 'Tem PROMOÇÃO hoje?']);
      expect((await repo.buscarMensagens({ texto: 'promoção', escopo: { empresaId: 'imperio', unidades: ['norte'] }, limite: 10 })).map((m) => m.conversaId)).toEqual([a.id, a.id]);
      expect((await repo.buscarMensagens({ texto: 'promoção', autores: ['equipe'], limite: 10 })).map((m) => m.autorNome)).toEqual(['Carla']);
      expect((await repo.buscarMensagens({ texto: 'promoção', desde: quinta(11), ate: quinta(12), limite: 10 })).map((m) => m.texto)).toEqual(['A promoção vale até sexta']);
      expect((await repo.buscarMensagens({ texto: 'promoção', conversaIds: [b.id], limite: 10 })).map((m) => m.texto)).toEqual(['vi a promoção']);
      expect(await repo.buscarMensagens({ texto: 'p', limite: 10 })).toEqual([]);
      expect((await repo.buscarMensagens({ texto: '50%_', limite: 10 }))).toEqual([]);
    });
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Contas } from '../auth/contas.js';
import { ehGestor, escopoDe, veTudo } from '../auth/acesso.js';
import { PALETA_TAGS, type Tags } from '../tags/tags.js';
import { AlteracaoConfigIA, AlteracaoMeta, type Empresa } from '../empresa/empresa.js';
import type { BaseConhecimento } from '../ai/base.js';
import type { PedidoSimulacao, RespostaSimulacao } from '../ai/simulacao.js';
import { mesDe, montarPainel, PERIODOS, type FontePainel } from '../painel/painel.js';
import { iaHoje } from '../painel/ia-hoje.js';

/**
 * Rotas de gestão: tags, aba IA (o que fez, configuração, treinamento, testar), painel completo e empresa.
 * Sem login configurado (teste local) tudo fica liberado, como no resto da API.
 */
export interface OpcoesGestao {
  repo: Repositorio;
  agora: () => Date;
  visivelPara: (req: FastifyRequest) => (c: Conversa) => boolean;
  conversaVisivel: (req: FastifyRequest) => Promise<Conversa>;
  contas?: Contas;
  tags?: Tags;
  empresa?: Empresa;
  base?: BaseConhecimento;
  painel: FontePainel;
  /** "Testar a IA". Ausente = recurso desligado. */
  simularIa?: (p: Omit<PedidoSimulacao, 'agora'>) => Promise<RespostaSimulacao>;
  /** A chave da IA está configurada? */
  iaLigada?: () => boolean;
  /** Nomes de tags que a IA pode marcar agora (para o "Testar a IA" se comportar igual). */
  tagsDaIa?: () => Promise<string[]>;
}

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });
const naoConfigurado = (o: string) => Object.assign(new Error(`${o} não está configurado neste servidor.`), { statusCode: 501 });

export function registrarGestao(app: FastifyInstance, o: OpcoesGestao): void {
  /** Nome de quem fez (para "criada por", "editada por"). */
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const exigeGestao = (req: FastifyRequest, msg = 'Só a gerência, a direção e a administração podem mudar isso.') => {
    if (req.usuario && !ehGestor(req.usuario)) throw proibido(msg);
  };
  const exige = <T>(x: T | undefined, nome: string): T => {
    if (!x) throw naoConfigurado(nome);
    return x;
  };

  // ------------------------------------------------------------ tags
  const TagNova = z.object({ nome: z.string().max(60), cor: z.string().max(10).optional() });
  const TagAlteracao = z
    .object({ nome: z.string().max(60).optional(), cor: z.string().max(10).optional() })
    .refine((v) => v.nome !== undefined || v.cor !== undefined, 'Informe o nome ou a cor.');
  const Ordem = z.object({ ids: z.array(z.string().min(1)).max(500) });
  const Marcar = z.object({ tagId: z.string().min(1) });
  const idDe = (req: FastifyRequest) => (req.params as { id: string }).id;

  app.get('/api/tags/cores', async () => PALETA_TAGS);

  app.get('/api/tags', async (req) => exige(o.tags, 'Tags').listarComContagem(escopoDe(req.usuario)));

  app.post('/api/tags', async (req, reply) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração criam tags.');
    const b = TagNova.parse(req.body);
    return reply.code(201).send(await exige(o.tags, 'Tags').criar(b, quem(req)));
  });

  app.patch('/api/tags/:id', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração mudam tags.');
    return exige(o.tags, 'Tags').alterar(idDe(req), TagAlteracao.parse(req.body));
  });

  app.post('/api/tags/ordem', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração mudam a ordem das tags.');
    return exige(o.tags, 'Tags').reordenar(Ordem.parse(req.body).ids);
  });

  app.delete('/api/tags/:id', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração apagam tags.');
    return { ok: true, removidaDe: await exige(o.tags, 'Tags').apagar(idDe(req)) };
  });

  const eventoTag = async (req: FastifyRequest, c: Conversa, tipo: 'tag_marcada' | 'tag_desmarcada', tag: { id: string; nome: string }) =>
    o.repo.registrarEvento({ tipo, conversaId: c.id, unidade: c.unidade, em: o.agora(), dados: { tagId: tag.id, nome: tag.nome, por: quem(req), porId: req.usuario?.id ?? null } });

  app.post('/api/conversas/:id/tags', async (req) => {
    const tags = exige(o.tags, 'Tags');
    const { tagId } = Marcar.parse(req.body);
    const c = await o.conversaVisivel(req);
    const r = await tags.marcar(c, tagId, quem(req));
    if (r.mudou) await eventoTag(req, c, 'tag_marcada', r.tag);
    return { tags: await tags.daConversa(c.id) };
  });

  app.delete('/api/conversas/:id/tags/:tagId', async (req) => {
    const tags = exige(o.tags, 'Tags');
    const c = await o.conversaVisivel(req);
    const r = await tags.desmarcar(c, (req.params as { tagId: string }).tagId);
    if (r.mudou) await eventoTag(req, c, 'tag_desmarcada', r.tag);
    return { tags: await tags.daConversa(c.id) };
  });

  // ------------------------------------------------------------ aba IA
  app.get('/api/ia/hoje', async (req) => iaHoje(o.repo, o.agora(), o.visivelPara(req)));

  app.get('/api/ia/config', async () => {
    const e = exige(o.empresa, 'A configuração da IA');
    return { ...(await e.configIa()), iaLigada: o.iaLigada?.() ?? null };
  });

  app.patch('/api/ia/config', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração mudam a configuração da IA.');
    const e = exige(o.empresa, 'A configuração da IA');
    return { ...(await e.alterarConfigIa(AlteracaoConfigIA.parse(req.body), quem(req))), iaLigada: o.iaLigada?.() ?? null };
  });

  // ---- treinamento (base de conhecimento)
  const SecaoNova = z.object({ titulo: z.string().trim().min(1).max(80), conteudo: z.string().max(20_000).default('') });
  const SecaoEdicao = z
    .object({ titulo: z.string().trim().min(1).max(80).optional(), conteudo: z.string().max(20_000).optional(), ordem: z.number().int().min(0).max(1000).optional() })
    .refine((v) => v.titulo !== undefined || v.conteudo !== undefined || v.ordem !== undefined, 'Nada para mudar.');
  const PerguntaNova = z.object({ pergunta: z.string().trim().min(3).max(500), resposta: z.string().trim().min(1).max(2000) });
  const PerguntaEdicao = z.object({
    pergunta: z.string().trim().min(3).max(500).optional(),
    resposta: z.string().trim().min(1).max(2000).optional(),
    ordem: z.number().int().min(0).max(10_000).optional(),
  });
  const chaveDe = (req: FastifyRequest) => (req.params as { chave: string }).chave;
  const base = () => exige(o.base, 'O treinamento da IA');

  app.get('/api/ia/base', async () => {
    const b = base();
    const [secoes, perguntas, pendencias] = await Promise.all([b.secoes(), b.perguntas(), b.pendencias()]);
    return {
      secoes: secoes.map((s) => ({ ...s, pendencias: pendencias.filter((p) => p.chave === s.chave).length })),
      perguntas,
      pendencias,
    };
  });

  app.get('/api/ia/base/texto', async () => ({ texto: await base().texto() }));

  app.post('/api/ia/base', async (req, reply) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração treinam a IA.');
    return reply.code(201).send(await base().criar(SecaoNova.parse(req.body), quem(req)));
  });

  app.put('/api/ia/base/:chave', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração treinam a IA.');
    return base().editar(chaveDe(req), SecaoEdicao.parse(req.body), quem(req));
  });

  app.delete('/api/ia/base/:chave', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração treinam a IA.');
    await base().apagar(chaveDe(req));
    return { ok: true };
  });

  app.get('/api/ia/base/:chave/historico', async (req) => base().historico(chaveDe(req)));

  app.get('/api/ia/perguntas', async () => base().perguntas());

  app.post('/api/ia/perguntas', async (req, reply) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração treinam a IA.');
    return reply.code(201).send(await base().adicionarPergunta(PerguntaNova.parse(req.body), quem(req)));
  });

  app.patch('/api/ia/perguntas/:id', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração treinam a IA.');
    return base().editarPergunta(idDe(req), PerguntaEdicao.parse(req.body), quem(req));
  });

  app.delete('/api/ia/perguntas/:id', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração treinam a IA.');
    await base().apagarPergunta(idDe(req));
    return { ok: true };
  });

  // ---- testar a IA (nada é enviado nem gravado)
  const Testar = z.object({
    mensagem: z.string().trim().min(1).max(2000),
    historico: z.array(z.object({ autor: z.enum(['cliente', 'ia']), texto: z.string().trim().min(1).max(2000) })).max(30).optional(),
    unidade: z.enum(['norte', 'sumare', 'feira']).optional(),
    nome: z.string().trim().min(1).max(60).optional(),
  });
  app.post('/api/ia/testar', async (req, reply) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração testam a IA.');
    const b = Testar.parse(req.body);
    if (!o.simularIa) return reply.code(501).send({ erro: 'Testar a IA não está disponível neste servidor.' });
    if (o.iaLigada && !o.iaLigada()) {
      return reply.code(400).send({ erro: 'A IA está sem chave. Cadastre a chave da IA em Conexões para testar.', codigo: 'ia_sem_chave' });
    }
    return o.simularIa({ ...b, tagsDisponiveis: (await o.tagsDaIa?.()) || undefined });
  });

  // ------------------------------------------------------------ painel completo
  const PainelQ = z.object({ periodo: z.enum(PERIODOS).default('hoje') });
  app.get('/api/painel/completo', async (req) => {
    const { periodo } = PainelQ.parse(req.query);
    const u = req.usuario;
    const equipe = u && o.contas ? await o.contas.listarUsuarios(u.empresaId) : undefined;
    return montarPainel(o.painel, { periodo, agora: o.agora(), escopo: escopoDe(u), usuario: u, equipe });
  });

  // ---- meta do mês (agendamentos): todos veem o progresso do seu alcance; só a gestão muda o número
  const progressoMeta = async (req: FastifyRequest) => {
    const meta = await exige(o.empresa, 'A empresa').meta();
    const agora = o.agora();
    const m = mesDe(agora);
    const d = await o.painel.periodo(m.inicio, agora, escopoDe(req.usuario), agora);
    const feitos = d.agendamentos.ia + d.agendamentos.equipe;
    const alvo = meta.agendamentosMes;
    return {
      mes: m.mes,
      meta: alvo,
      agendamentos: feitos,
      ia: d.agendamentos.ia,
      equipe: d.agendamentos.equipe,
      leads: d.leads,
      progressoPct: alvo ? Math.round((feitos / alvo) * 1000) / 10 : null,
      faltam: alvo ? Math.max(0, alvo - feitos) : null,
      diasNoMes: m.diasNoMes,
      diasRestantes: m.diasRestantes,
      atualizadaEm: meta.atualizadaEm,
      atualizadaPor: meta.atualizadaPor,
      podeEditar: !req.usuario || ehGestor(req.usuario),
    };
  };
  app.get('/api/painel/meta', async (req) => progressoMeta(req));
  app.put('/api/painel/meta', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração mudam a meta do mês.');
    await exige(o.empresa, 'A empresa').alterarMeta(AlteracaoMeta.parse(req.body), quem(req));
    return progressoMeta(req);
  });

  // ------------------------------------------------------------ empresa
  const EmpresaQ = z.object({ nome: z.string().trim().min(2).max(80) });
  app.get('/api/empresa', async () => exige(o.empresa, 'A empresa').dados());
  app.patch('/api/empresa', async (req) => {
    if (req.usuario && !veTudo(req.usuario)) throw proibido('Só a direção e a administração mudam o nome da empresa.');
    return exige(o.empresa, 'A empresa').renomear(EmpresaQ.parse(req.body).nome, quem(req));
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa, UnidadeId } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehGestor, podeVer, veTudo } from '../auth/acesso.js';
import { normalizarCelular } from '../util/telefone.js';
import type { ArmazemChamadas, Chamada } from './chamadas.js';

/**
 * Tela "Ligações": histórico (efetuadas pelo app, recebidas/perdidas avisadas pelo WhatsApp), favoritos,
 * ligações programadas e "limpar histórico". Quem vê: as chamadas das conversas que a pessoa vê; as de número
 * digitado (sem conversa) só quem ligou e a gestão da unidade.
 */
export interface OpcoesLigacoes {
  repo: Repositorio;
  chamadas: ArmazemChamadas;
  empresaId: string;
  agora: () => Date;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

export function registrarLigacoes(app: FastifyInstance, o: OpcoesLigacoes): void {
  const ve = (req: FastifyRequest, c: Conversa) => c.empresaId === o.empresaId && (!req.usuario || podeVer(req.usuario, c));
  const quem = (req: FastifyRequest) => ({ id: req.usuario?.id ?? null, nome: req.usuario?.nome ?? 'Equipe' });
  async function conversaVisivel(req: FastifyRequest, id: string) {
    const c = await o.repo.buscarConversa(id).catch(() => undefined);
    if (!c || !ve(req, c)) throw erro('Conversa não encontrada', 404);
    return c;
  }
  const podeVerChamada = (req: FastifyRequest, conversas: Map<string, Conversa>) => (x: Chamada) => {
    const u = req.usuario;
    if (x.conversaId) {
      const c = conversas.get(x.conversaId);
      return Boolean(c && ve(req, c));
    }
    if (!u) return true;
    if (x.atendenteId === u.id) return true;
    return ehGestor(u) && (veTudo(u) || !x.unidade || u.unidades.includes(x.unidade));
  };
  const paraTela = (conversas: Map<string, Conversa>) => (x: Chamada) => {
    const c = x.conversaId ? conversas.get(x.conversaId) : undefined;
    return {
      id: x.id,
      conversaId: x.conversaId,
      cliente: c?.nome ?? null,
      telefone: x.telefone,
      direcao: x.direcao,
      resultado: x.resultado,
      atendente: x.atendenteNome,
      unidade: x.unidade,
      em: x.em,
      origem: x.origem,
    };
  };
  const lerCursor = (s?: string) => {
    const m = s?.match(/^(\d+)_([0-9a-f-]{36})$/i);
    return m ? { em: new Date(Number(m[1])), id: m[2]! } : undefined;
  };

  // Histórico (mais novas primeiro), "Todas" ou "Perdidas", em páginas.
  const Historico = z.object({ filtro: z.enum(['todas', 'perdidas']).default('todas'), antes: z.string().max(80).optional(), limite: z.coerce.number().int().min(1).max(100).default(30) });
  app.get('/api/ligacoes/historico', async (req) => {
    const q = Historico.parse(req.query);
    const conversas = new Map((await o.repo.listarConversas()).map((c) => [c.id, c]));
    const desde = req.usuario ? await o.chamadas.limpeza(req.usuario.id) : undefined;
    const itens = await o.chamadas.listar({ empresaId: o.empresaId, perdidas: q.filtro === 'perdidas', desde, antes: lerCursor(q.antes), limite: q.limite + 1 }, podeVerChamada(req, conversas));
    const pagina = itens.slice(0, q.limite);
    const ult = pagina.at(-1);
    return { itens: pagina.map(paraTela(conversas)), proximo: itens.length > q.limite && ult ? `${ult.em.getTime()}_${ult.id}` : null };
  });

  // Ligar (contato ou número digitado): a ligação sai do celular; aqui só fica registrado quem ligou e quando.
  const Efetuada = z.object({ conversaId: z.string().min(1).max(64).optional(), telefone: z.string().max(40).optional() }).refine((b) => b.conversaId || b.telefone, 'Informe o contato ou o número.');
  app.post('/api/ligacoes/efetuada', async (req, reply) => {
    const b = Efetuada.parse(req.body);
    let c: Conversa | undefined;
    let telefone: string | null;
    if (b.conversaId) {
      c = await conversaVisivel(req, b.conversaId);
      telefone = c.telefone;
    } else {
      telefone = normalizarCelular(b.telefone!) ?? (b.telefone!.replace(/\D/g, '').length >= 8 ? b.telefone!.replace(/\D/g, '') : null);
      if (!telefone) throw erro('Número inválido.', 400);
      // Número de uma cliente que a pessoa vê: liga à conversa dela.
      c = (await o.repo.listarConversas()).find((x) => x.telefone === telefone && ve(req, x));
    }
    const u = quem(req);
    const unidade: UnidadeId | null = c?.unidade ?? (req.usuario?.unidades?.[0] as UnidadeId | undefined) ?? null;
    const x = await o.chamadas.registrar({ empresaId: o.empresaId, conversaId: c?.id ?? null, telefone, direcao: 'efetuada', atendenteId: u.id, atendenteNome: u.nome, unidade, em: o.agora(), origem: 'app' });
    return reply.code(201).send({ id: x.id, telefone, conversaId: x.conversaId });
  });

  // Programar uma ligação (vira lembrete na hora marcada e entra em "Programadas para hoje").
  const Programar = z.object({ conversaId: z.string().min(1).max(64), quando: z.string().datetime({ offset: true }), texto: z.string().trim().max(200).optional() });
  app.post('/api/ligacoes/programar', async (req, reply) => {
    const b = Programar.parse(req.body);
    const c = await conversaVisivel(req, b.conversaId);
    const quando = new Date(b.quando);
    if (quando.getTime() < o.agora().getTime() - 5 * 60_000) throw erro('Escolha um horário daqui para a frente.', 400);
    await o.repo.registrarEvento({ tipo: 'lembrete_ligacao', conversaId: c.id, unidade: c.unidade, em: o.agora(), dados: { quando: quando.toISOString(), texto: b.texto || 'Ligar para a cliente', por: quem(req).nome, porId: quem(req).id } });
    return reply.code(201).send({ ok: true });
  });

  // Favoritos (de cada pessoa).
  app.get('/api/ligacoes/favoritos', async (req) => {
    if (!req.usuario) return [];
    const ids = await o.chamadas.favoritos(req.usuario.id);
    const conversas = new Map((await o.repo.listarConversas()).map((c) => [c.id, c]));
    return ids.map((id) => conversas.get(id)).filter((c): c is Conversa => Boolean(c && ve(req, c))).map((c) => ({ conversaId: c.id, nome: c.nome ?? null, telefone: c.telefone, unidade: c.unidade }));
  });
  const Favorito = z.object({ conversaId: z.string().min(1).max(64), favorito: z.boolean() });
  app.post('/api/ligacoes/favoritos', async (req) => {
    if (!req.usuario) throw erro('Faça login para continuar.', 401);
    const b = Favorito.parse(req.body);
    const c = await conversaVisivel(req, b.conversaId);
    await o.chamadas.favoritar(req.usuario.id, c.id, b.favorito);
    return { ok: true, favorito: b.favorito };
  });

  // "Limpar histórico": some da tela desta pessoa (a equipe continua vendo).
  app.post('/api/ligacoes/limpar', async (req) => {
    if (!req.usuario) throw erro('Faça login para continuar.', 401);
    await o.chamadas.limpar(req.usuario.id, o.agora());
    return { ok: true };
  });
}

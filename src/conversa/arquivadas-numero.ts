import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, escopoDe, podeVer } from '../auth/acesso.js';
import type { Conversa } from '../domain.js';
import type { Auditoria } from '../seguranca/auditoria.js';
import type { Repositorio } from '../store/repositorio.js';

/**
 * trocar-numero: Conversas › "Arquivadas do número antigo".
 * As conversas arquivadas pela empresa (troca de número em Conexões) saem da lista de todo mundo; aqui dá para
 * consultar (cada pessoa vê só as que já via) e desarquivar (gestão: gerente, direção e administração).
 */
export interface OpcoesArquivadasNumero {
  repo: Repositorio;
  empresaId: string;
  auditoria?: Auditoria;
  agora?: () => Date;
}

const Lista = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(100),
  antes: z.string().max(200).optional(),
  q: z.string().trim().max(100).optional(),
});
const Desarquivar = z.object({ ids: z.array(z.string().uuid()).min(1).max(2000) });

function cursor(c?: string): { em: Date; id: string } | undefined {
  if (!c) return undefined;
  const [em, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const data = new Date(em ?? '');
  return Number.isNaN(data.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? '') ? undefined : { em: data, id: id! };
}

export function registrarArquivadasNumero(app: FastifyInstance, o: OpcoesArquivadasNumero): void {
  const ve = (req: FastifyRequest) => (c: Conversa) => c.empresaId === o.empresaId && (!req.usuario || podeVer(req.usuario, c));

  app.get('/api/conversas/arquivadas-numero', async (req) => {
    const q = Lista.parse(req.query ?? {});
    const pagina = await o.repo.paginaConversas({
      escopo: { ...escopoDe(req.usuario), empresaId: o.empresaId },
      limite: q.limite,
      antes: cursor(q.antes),
      busca: q.q && q.q.length >= 2 ? q.q : undefined,
      arquivadas: true,
    });
    const conversas = pagina.conversas.filter(ve(req)).map((c) => {
      const m = pagina.ultimas.get(c.id);
      return {
        id: c.id,
        nome: c.nome ?? null,
        telefone: c.telefone,
        unidade: c.unidade,
        canalId: c.canalId,
        arquivadaEm: c.arquivadaEm?.toISOString() ?? null,
        atualizadaEm: c.atualizadaEm.toISOString(),
        ultima: m ? { autor: m.autor, texto: m.texto.slice(0, 140), em: m.em.toISOString() } : null,
      };
    });
    return {
      conversas,
      proximo: pagina.proximo ? Buffer.from(`${pagina.proximo.em.toISOString()}|${pagina.proximo.id}`).toString('base64url') : null,
      podeDesarquivar: !req.usuario || ehGestor(req.usuario),
    };
  });

  app.post('/api/conversas/desarquivar-numero', async (req, reply) => {
    if (req.usuario && !ehGestor(req.usuario)) return reply.code(403).send({ erro: 'Só a gestão desarquiva conversas do número antigo.' });
    const b = Desarquivar.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ erro: 'Escolha as conversas para desarquivar.' });
    const visiveis = (await o.repo.listarConversas({ ids: b.data.ids })).filter(ve(req)).map((c) => c.id);
    const n = await o.repo.arquivarConversas(o.empresaId, visiveis, null);
    if (n && o.auditoria) {
      const u = req.usuario;
      await o.auditoria
        .registrar({ empresaId: o.empresaId, acao: 'desarquivou conversas do número antigo', autorId: u?.id ?? null, autorNome: u?.nome ?? null, papel: u?.papel ?? null, detalhe: { conversas: n }, ip: req.ip, em: (o.agora ?? (() => new Date()))() })
        .catch(() => {});
    }
    return { ok: true, desarquivadas: n };
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { podeVer } from '../auth/acesso.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Radar } from './radar.js';
import type { ItemRadar } from './tipos.js';

/**
 * Rotas /api/radar/... (registradas depois de criarServidor: valem o login e o tratamento de erros de lá).
 * Quem vê a conversa pode colocar, mudar e tirar do radar.
 */
export interface OpcoesRotasRadar {
  radar: Radar;
  repo: Repositorio;
  iaLigada: () => boolean;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

function paraTela(x: ItemRadar, eu?: string) {
  return {
    conversaId: x.conversaId,
    vigiar: x.vigiar,
    prazo: x.prazo ?? null,
    acao: x.acao,
    instrucao: x.instrucao ?? null,
    donoId: x.donoId ?? null,
    donoNome: x.donoNome ?? null,
    meu: !x.donoId || !eu || x.donoId === eu,
    estado: x.estado,
    motivo: x.motivo ?? null,
    disparadoEm: x.disparadoEm ?? null,
    visto: Boolean(x.vistoEm),
    resposta: x.resposta ?? null,
    criadoEm: x.criadoEm,
  };
}

export function registrarRadar(app: FastifyInstance, o: OpcoesRotasRadar): void {
  const conversa = async (req: FastifyRequest) => {
    const id = (req.params as { id: string }).id;
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await o.repo.buscarConversa(id) : undefined;
    if (!c || (req.usuario && (c.empresaId !== req.usuario.empresaId || !podeVer(req.usuario, c)))) throw erro('Conversa não encontrada.', 404);
    return c;
  };
  const quem = (req: FastifyRequest) => ({ id: req.usuario?.id, nome: req.usuario?.nome ?? 'teste' });
  const detalhe = async (id: string, eu?: string) => {
    const d = await o.radar.daConversa(id);
    return { item: d.item ? paraTela(d.item, eu) : null, historico: d.historico.map((h) => ({ tipo: h.tipo, texto: h.texto, por: h.por ?? null, em: h.em })), iaLigada: o.iaLigada() };
  };

  /** As conversas no radar que esta pessoa vê. */
  app.get('/api/radar', async (req) => {
    const itens = await o.radar.listar();
    const saida = [];
    for (const x of itens) {
      if (req.usuario) {
        const c = await o.repo.buscarConversa(x.conversaId);
        if (!c || c.empresaId !== req.usuario.empresaId || !podeVer(req.usuario, c)) continue;
      }
      saida.push(paraTela(x, req.usuario?.id));
    }
    return { itens: saida, iaLigada: o.iaLigada() };
  });

  app.get('/api/radar/conversa/:id', async (req) => detalhe((await conversa(req)).id, req.usuario?.id));

  app.put('/api/radar/conversa/:id', async (req) => {
    const c = await conversa(req);
    try {
      await o.radar.colocar(c, req.body, quem(req));
    } catch (e) {
      if (e instanceof z.ZodError) throw erro(e.issues[0]?.message ?? 'Dados inválidos.', 400);
      throw e;
    }
    return detalhe(c.id, req.usuario?.id);
  });

  app.delete('/api/radar/conversa/:id', async (req) => {
    const c = await conversa(req);
    await o.radar.tirar(c.id, quem(req));
    return detalhe(c.id, req.usuario?.id);
  });

  app.post('/api/radar/conversa/:id/visto', async (req) => {
    const c = await conversa(req);
    return { ok: await o.radar.visto(c.id, quem(req)) };
  });

  app.post('/api/radar/conversa/:id/de-novo', async (req) => {
    const c = await conversa(req);
    if (!(await o.radar.vigiarDeNovo(c, quem(req)))) throw erro('Esta conversa não está no radar.', 404);
    return detalhe(c.id, req.usuario?.id);
  });
}

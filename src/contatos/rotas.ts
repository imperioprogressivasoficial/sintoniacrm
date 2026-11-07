import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import { aplicarEdicao, contatoVazio, EdicaoContato, ErroCampoRepetido, TIPOS_CAMPO, type ArmazemContatos } from './contatos.js';

export interface OpcoesContatos {
  contatos: ArmazemContatos;
  empresaId: string;
  /** Conversa que a pessoa logada pode ver (outra dá 404). */
  conversaVisivel: (req: FastifyRequest) => Promise<Conversa>;
  /** Grava o nome da cliente também na conversa (lista, busca, cabeçalho). */
  renomear: (conversaId: string, nome: string | null) => Promise<void>;
}

const GESTAO = new Set(['gerente', 'direcao', 'admin']);
const proibido = () => Object.assign(new Error('Só a gestão mexe nos campos da ficha.'), { statusCode: 403 });

const NovoCampo = z.object({
  nome: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_CAMPO),
  opcoes: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
});
const EdicaoCampo = z.object({
  nome: z.string().trim().min(1).max(60).optional(),
  opcoes: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  ordem: z.number().int().min(0).max(999).optional(),
});

/** Ficha do contato (dados, e-mail, empresa, campos personalizados) e os campos que a empresa criou. */
export function registrarContatos(app: FastifyInstance, o: OpcoesContatos): void {
  const quem = (req: FastifyRequest) => req.usuario?.email ?? 'sistema';
  const gestao = (req: FastifyRequest) => {
    if (req.usuario && !GESTAO.has(req.usuario.papel)) throw proibido();
  };

  app.get('/api/conversas/:id/contato', async (req) => {
    const c = await o.conversaVisivel(req);
    const contato = (await o.contatos.obter(o.empresaId, c.telefone)) ?? contatoVazio(c.telefone, c.nome);
    return { contato, campos: await o.contatos.campos(o.empresaId) };
  });

  app.put('/api/conversas/:id/contato', async (req, reply) => {
    const c = await o.conversaVisivel(req);
    const edicao = EdicaoContato.parse(req.body);
    const defs = await o.contatos.campos(o.empresaId);
    const atual = (await o.contatos.obter(o.empresaId, c.telefone)) ?? contatoVazio(c.telefone, c.nome);
    let nova;
    try {
      nova = aplicarEdicao(atual, edicao, defs);
    } catch (e) {
      return reply.code(400).send({ erro: (e as Error).message });
    }
    const salvo = await o.contatos.salvar(o.empresaId, nova, quem(req));
    if (edicao.nome !== undefined && (edicao.nome ?? null) !== (c.nome ?? null)) await o.renomear(c.id, edicao.nome ?? null);
    return { contato: salvo, campos: defs };
  });

  app.get('/api/campos-contato', async () => o.contatos.campos(o.empresaId));

  app.post('/api/campos-contato', async (req, reply) => {
    gestao(req);
    const b = NovoCampo.parse(req.body);
    if (b.tipo === 'lista' && !b.opcoes.length) return reply.code(400).send({ erro: 'Uma lista precisa de pelo menos uma opção.' });
    try {
      return reply.code(201).send(await o.contatos.criarCampo(o.empresaId, { ...b, opcoes: b.tipo === 'lista' ? b.opcoes : [] }));
    } catch (e) {
      if (e instanceof ErroCampoRepetido) return reply.code(409).send({ erro: e.message });
      throw e;
    }
  });

  app.patch('/api/campos-contato/:id', async (req, reply) => {
    gestao(req);
    const b = EdicaoCampo.parse(req.body);
    try {
      const c = await o.contatos.atualizarCampo(o.empresaId, (req.params as { id: string }).id, b);
      return c ?? reply.code(404).send({ erro: 'Campo não encontrado' });
    } catch (e) {
      if (e instanceof ErroCampoRepetido) return reply.code(409).send({ erro: e.message });
      throw e;
    }
  });

  app.delete('/api/campos-contato/:id', async (req, reply) => {
    gestao(req);
    const ok = await o.contatos.apagarCampo(o.empresaId, (req.params as { id: string }).id);
    return ok ? { ok: true } : reply.code(404).send({ erro: 'Campo não encontrado' });
  });
}

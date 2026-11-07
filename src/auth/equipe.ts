import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PAPEIS, type Contas, type Usuario } from './contas.js';
import { apareceNaEquipe, ehGestor, papeisQuePodeDar, podeGerenciar, recusaAtribuicao, UNIDADES_EQUIPE, unidadesQuePodeDar } from './acesso.js';
import { gerarHash, senhaFraca } from './senha.js';

/** Gestão da equipe: listar, criar, editar papel/unidades, desativar/reativar e redefinir senha. */

const erro = (statusCode: number, mensagem: string) => Object.assign(new Error(mensagem), { statusCode });

const Unidades = z.array(z.enum(UNIDADES_EQUIPE as [string, ...string[]])).max(UNIDADES_EQUIPE.length).transform((l) => [...new Set(l)]);
const Senha = z.string().max(200);

const Nova = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
  papel: z.enum(PAPEIS),
  unidades: Unidades,
  senha: Senha,
});
const Edicao = z.object({ papel: z.enum(PAPEIS).optional(), unidades: Unidades.optional() });

/** O que a tela mostra de cada pessoa (nunca a senha). */
const publico = (u: Usuario, g: Usuario) => ({
  id: u.id,
  nome: u.nome,
  email: u.email,
  papel: u.papel,
  unidades: u.unidades,
  ativo: u.ativo,
  eu: u.id === g.id,
  podeGerenciar: podeGerenciar(g, u),
});

export function registrarEquipe(app: FastifyInstance, contas: Contas): void {
  const gestor = (req: FastifyRequest): Usuario => {
    const u = req.usuario!;
    if (!ehGestor(u)) throw erro(403, 'Só gerente, direção e administração cuidam da equipe.');
    return u;
  };
  /** Pessoa que este gestor pode gerenciar; quem ele não enxerga dá 404. */
  const alvoDe = async (req: FastifyRequest, g: Usuario): Promise<Usuario> => {
    const alvo = await contas.buscarPorId((req.params as { id: string }).id).catch(() => undefined);
    if (!alvo || !apareceNaEquipe(g, alvo)) throw erro(404, 'Pessoa não encontrada.');
    if (g.id === alvo.id) throw erro(403, 'Você não pode mudar o próprio acesso. Peça a outra pessoa da gestão.');
    if (!podeGerenciar(g, alvo)) throw erro(403, 'Você não pode mudar o acesso desta pessoa.');
    const { senhaHash: _, ...resto } = alvo;
    return resto;
  };

  app.get('/api/equipe', async (req) => {
    const g = gestor(req);
    const todos = await contas.listarUsuarios(g.empresaId);
    return {
      pessoas: todos.filter((u) => apareceNaEquipe(g, u)).map((u) => publico(u, g)),
      papeis: papeisQuePodeDar(g),
      unidades: unidadesQuePodeDar(g),
    };
  });

  app.post('/api/equipe', async (req, reply) => {
    const g = gestor(req);
    const b = Nova.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: b.error.issues[0]?.message ?? 'Confira os dados.' });
    const recusa = recusaAtribuicao(g, b.data.papel, b.data.unidades);
    if (recusa) return reply.code(403).send({ erro: recusa });
    const fraca = senhaFraca(b.data.senha);
    if (fraca) return reply.code(400).send({ erro: fraca });
    try {
      const u = await contas.criarUsuario({
        empresaId: g.empresaId,
        nome: b.data.nome,
        email: b.data.email,
        papel: b.data.papel,
        unidades: b.data.unidades,
        senhaHash: await gerarHash(b.data.senha),
      });
      return reply.code(201).send(publico(u, g));
    } catch (e) {
      if (/Já existe/.test((e as Error).message)) return reply.code(409).send({ erro: 'Já existe uma pessoa com esse e-mail.' });
      throw e;
    }
  });

  app.patch('/api/equipe/:id', async (req, reply) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const b = Edicao.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Confira o papel e as unidades.' });
    const papel = b.data.papel ?? alvo.papel;
    const unidades = b.data.unidades ?? alvo.unidades;
    const recusa = recusaAtribuicao(g, papel, unidades);
    if (recusa) return reply.code(403).send({ erro: recusa });
    const u = await contas.atualizarUsuario(alvo.id, { papel, unidades });
    return publico(u!, g);
  });

  const ativar = (ativo: boolean) => async (req: FastifyRequest) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const u = await contas.atualizarUsuario(alvo.id, { ativo });
    // Desativada: sai na hora de todos os aparelhos.
    if (!ativo) await contas.encerrarSessoesDe(alvo.id);
    return publico(u!, g);
  };
  app.post('/api/equipe/:id/desativar', ativar(false));
  app.post('/api/equipe/:id/reativar', ativar(true));

  app.post('/api/equipe/:id/senha', async (req, reply) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const b = z.object({ senha: Senha }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Informe a nova senha.' });
    const fraca = senhaFraca(b.data.senha);
    if (fraca) return reply.code(400).send({ erro: fraca });
    await contas.definirSenha(alvo.id, await gerarHash(b.data.senha));
    // Senha nova: quem estava logado com a antiga precisa entrar de novo.
    await contas.encerrarSessoesDe(alvo.id);
    return { ok: true };
  });
}

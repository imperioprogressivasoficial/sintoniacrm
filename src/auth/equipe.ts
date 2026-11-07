import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PAPEIS, type Contas, type Usuario } from './contas.js';
import { apareceNaEquipe, ehGestor, papeisQuePodeDar, podeGerenciar, recusaAtribuicao, UNIDADES_EQUIPE, unidadesQuePodeDar } from './acesso.js';
import { pode } from './permissoes.js';
import { gerarHash, senhaFraca } from './senha.js';
import { seriaUltimoAdmin } from './usuarios-rotas.js';

/** Foto já reduzida pela tela (~256 px): bem abaixo disto. */
export const LIMITE_FOTO = 300 * 1024;
/** Confere os primeiros bytes (não confia só no tipo que veio no pedido). */
export function assinaturaDeImagem(b: Buffer, tipo: string): boolean {
  if (tipo === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (tipo === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (tipo === 'image/webp') return b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

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
    if (!pode(req, 'equipe')) throw erro(403, 'Só gerente, direção e administração cuidam da equipe.');
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
    if (seriaUltimoAdmin(await contas.listarUsuarios(g.empresaId), alvo, { papel })) return reply.code(409).send({ erro: 'Esta é a última pessoa da Administração.' });
    const u = await contas.atualizarUsuario(alvo.id, { papel, unidades });
    return publico(u!, g);
  });

  const ativar = (ativo: boolean) => async (req: FastifyRequest) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    if (!ativo && seriaUltimoAdmin(await contas.listarUsuarios(g.empresaId), alvo, { ativo })) throw erro(409, 'Esta é a última pessoa da Administração.');
    const u = await contas.atualizarUsuario(alvo.id, { ativo });
    // Desativada: sai na hora de todos os aparelhos.
    if (!ativo) await contas.encerrarSessoesDe(alvo.id);
    return publico(u!, g);
  };
  app.post('/api/equipe/:id/desativar', ativar(false));
  app.post('/api/equipe/:id/reativar', ativar(true));

  // ---------------------------------------------------------------- foto (rosto)
  // Todo mundo logado vê o rosto da equipe da própria empresa; trocar: a própria pessoa ou quem a gerencia.
  const daEmpresa = async (req: FastifyRequest): Promise<Usuario> => {
    const eu = req.usuario!;
    const alvo = await contas.buscarPorId((req.params as { id: string }).id).catch(() => undefined);
    if (!alvo || alvo.empresaId !== eu.empresaId) throw erro(404, 'Pessoa não encontrada.');
    const { senhaHash: _, ...resto } = alvo;
    return resto;
  };
  const podeTrocarFoto = (eu: Usuario, alvo: Usuario) => eu.id === alvo.id || (ehGestor(eu) && apareceNaEquipe(eu, alvo) && podeGerenciar(eu, alvo));

  app.get('/api/equipe/fotos', async (req) => {
    const mapa = await contas.fotosDaEmpresa(req.usuario!.empresaId);
    return { fotos: Object.fromEntries([...mapa].map(([id, em]) => [id, em.getTime()])) };
  });

  app.get('/api/equipe/:id/foto', async (req, reply) => {
    const alvo = await daEmpresa(req);
    const f = await contas.fotoDe(alvo.id);
    // Sem foto: a tela mostra as iniciais (nada fica guardado no navegador).
    if (!f) return reply.header('cache-control', 'no-store').code(204).send();
    return reply.header('cache-control', 'private, max-age=600').type(f.tipo).send(f.conteudo);
  });

  const FotoNova = z.object({ base64: z.string().min(10).max(600_000), mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']) });
  app.put('/api/equipe/:id/foto', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const alvo = await daEmpresa(req);
    if (!podeTrocarFoto(req.usuario!, alvo)) throw erro(403, 'Você não pode trocar a foto desta pessoa.');
    const b = FotoNova.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Envie uma foto JPG, PNG ou WebP.' });
    const conteudo = Buffer.from(b.data.base64.replace(/^data:[^,]*,/, ''), 'base64');
    if (conteudo.length > LIMITE_FOTO) return reply.code(413).send({ erro: 'Foto grande demais (até 300 KB depois de reduzida).' });
    if (!assinaturaDeImagem(conteudo, b.data.mimetype)) return reply.code(400).send({ erro: 'O arquivo não é uma imagem válida.' });
    await contas.salvarFotoDe(alvo.id, { conteudo, tipo: b.data.mimetype }, new Date());
    return { ok: true };
  });

  app.delete('/api/equipe/:id/foto', async (req) => {
    const alvo = await daEmpresa(req);
    if (!podeTrocarFoto(req.usuario!, alvo)) throw erro(403, 'Você não pode trocar a foto desta pessoa.');
    await contas.salvarFotoDe(alvo.id, null, new Date());
    return { ok: true };
  });

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

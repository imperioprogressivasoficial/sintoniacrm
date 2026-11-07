import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { apareceNaEquipe, NOME_PAPEL, papeisQuePodeDar, podeGerenciar, recusaAtribuicao, UNIDADES_EQUIPE, unidadesQuePodeDar } from './acesso.js';
import type { Acessos } from './acessos.js';
import { PAPEIS, type Contas, type Papel, type Usuario } from './contas.js';
import {
  CATALOGO,
  diferencaDoPadrao,
  limparAjustes,
  limparHorario,
  NIVEIS_CONVERSAS,
  NOME_NIVEL,
  perfilPadrao,
  recusaAjustes,
  resolver,
  type Ajustes,
  type Permissoes,
} from './permissoes.js';
import { gerarHash, senhaFraca } from './senha.js';

/**
 * "Usuários e acessos": convidar/criar, editar papel/unidades/permissões, desativar/reativar,
 * redefinir senha por link, forçar troca, horário permitido, sessões ativas e auditoria.
 * As regras de quem gerencia quem são as mesmas da Equipe (acesso.ts); aqui somam-se:
 * só admin/direção editam perfis; ninguém tira o último admin; ninguém dá o que não tem.
 */

export interface OpcoesUsuarios {
  contas: Contas;
  acessos: Acessos;
  agora: () => Date;
  invalidar: () => void;
  permissoesDe: (u: Usuario) => Promise<Permissoes>;
}

const erro = (statusCode: number, mensagem: string) => Object.assign(new Error(mensagem), { statusCode });
const Unidades = z.array(z.enum(UNIDADES_EQUIPE as [string, ...string[]])).max(UNIDADES_EQUIPE.length).transform((l) => [...new Set(l)]);
const Validade = z.number().int().min(1).max(24 * 14).optional();
const HorarioZ = z.object({ dias: z.array(z.number().int().min(0).max(6)).min(1).max(7), inicio: z.string(), fim: z.string() }).nullable().optional();

const Nova = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
  papel: z.enum(PAPEIS),
  unidades: Unidades,
  /** Sem senha = gera link de convite. */
  senha: z.string().max(200).optional(),
  validadeHoras: Validade,
  trocarSenha: z.boolean().optional(),
  ajustes: z.record(z.string(), z.unknown()).optional(),
  horario: HorarioZ,
});
const Edicao = z.object({
  papel: z.enum(PAPEIS).optional(),
  unidades: Unidades.optional(),
  ajustes: z.record(z.string(), z.unknown()).optional(),
  horario: HorarioZ,
  trocarSenha: z.boolean().optional(),
});

const podeEditarPerfis = (u: Pick<Usuario, 'papel'>) => u.papel === 'admin' || u.papel === 'direcao';

/** Tirar este admin (rebaixar ou desativar) deixaria a empresa sem nenhum admin ativo? */
export function seriaUltimoAdmin(todos: Usuario[], alvo: Usuario, depois: { papel?: Papel; ativo?: boolean }): boolean {
  if (alvo.papel !== 'admin' || !alvo.ativo) return false;
  const continuaAdmin = (depois.papel ?? alvo.papel) === 'admin' && (depois.ativo ?? alvo.ativo);
  if (continuaAdmin) return false;
  return !todos.some((u) => u.id !== alvo.id && u.empresaId === alvo.empresaId && u.papel === 'admin' && u.ativo);
}

const MSG_ULTIMO_ADMIN = 'Esta é a última pessoa da Administração. Dê o papel de Administração a outra pessoa antes.';

export function registrarUsuarios(app: FastifyInstance, o: OpcoesUsuarios): void {
  const { contas, acessos } = o;
  const gestor = (req: FastifyRequest): Usuario => {
    const u = req.usuario;
    if (!u) throw erro(401, 'Faça login para continuar.');
    if (!req.permissoes?.equipe) throw erro(403, 'Você não cuida da equipe. Fale com a gestão.');
    return u;
  };
  const alvoDe = async (req: FastifyRequest, g: Usuario): Promise<Usuario> => {
    const id = (req.params as { id: string }).id;
    const alvo = await contas.buscarPorId(id).catch(() => undefined);
    if (!alvo || !apareceNaEquipe(g, alvo)) throw erro(404, 'Pessoa não encontrada.');
    if (g.id === alvo.id) throw erro(403, 'Você não pode mudar o próprio acesso. Peça a outra pessoa da gestão.');
    if (!podeGerenciar(g, alvo)) throw erro(403, 'Você não pode mudar o acesso desta pessoa.');
    const { senhaHash: _, ...resto } = alvo;
    return resto;
  };
  const auditar = (g: Usuario, alvo: Pick<Usuario, 'id' | 'nome'> | null, acao: string, detalhe?: string) =>
    acessos.auditar({ empresaId: g.empresaId, autorId: g.id, autorNome: g.nome, alvoId: alvo?.id ?? null, alvoNome: alvo?.nome ?? null, acao, detalhe: detalhe ?? null, em: o.agora() });
  const link = (req: FastifyRequest, token: string) => {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? (req.protocol || 'http');
    return `${proto}://${host}/convite?t=${encodeURIComponent(token)}`;
  };
  /** Ajustes que este gestor pode dar (admin dá qualquer coisa; os outros, só o que têm). */
  const conferirAjustes = (g: Usuario, meu: Permissoes, bruto: unknown): Ajustes => {
    const a = limparAjustes(bruto);
    if (g.papel !== 'admin') {
      const recusa = recusaAjustes(meu, a);
      if (recusa) throw erro(403, recusa);
    }
    return a;
  };

  const resumo = async (u: Usuario, g: Usuario, perfis: Partial<Record<Papel, Ajustes>>) => {
    const ex = await acessos.extras(u.id);
    const sessoes = await acessos.sessoes(u.id, o.agora());
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      papel: u.papel,
      unidades: u.unidades,
      ativo: u.ativo,
      eu: u.id === g.id,
      podeGerenciar: podeGerenciar(g, u),
      ultimoAcesso: ex.ultimoAcesso?.toISOString() ?? null,
      sessoesAtivas: u.ativo ? sessoes.length : 0,
      trocarSenha: ex.trocarSenha,
      horario: ex.horario,
      ajustes: ex.ajustes,
      permissoes: resolver(u.papel, perfis[u.papel], ex.ajustes),
    };
  };

  // ---------------------------------------------------------------- perfis
  app.get('/api/acessos/catalogo', async (req) => {
    const g = gestor(req);
    const perfis = await acessos.perfis(g.empresaId);
    return {
      catalogo: CATALOGO,
      niveis: NIVEIS_CONVERSAS.map((n) => ({ id: n, nome: NOME_NIVEL[n] })),
      papeis: PAPEIS.map((p) => ({ id: p, nome: NOME_PAPEL[p] })),
      perfis: Object.fromEntries(PAPEIS.map((p) => [p, resolver(p, perfis[p])])),
      padrao: Object.fromEntries(PAPEIS.map((p) => [p, perfilPadrao(p)])),
      podeEditarPerfis: podeEditarPerfis(g),
      perfisEditaveis: podeEditarPerfis(g) ? PAPEIS.filter((p) => g.papel === 'admin' || p !== 'admin') : [],
    };
  });

  app.put('/api/acessos/perfis/:papel', async (req) => {
    const g = gestor(req);
    if (!podeEditarPerfis(g)) throw erro(403, 'Só a direção e a administração mudam os perfis.');
    const papel = z.enum(PAPEIS).safeParse((req.params as { papel: string }).papel);
    if (!papel.success) throw erro(404, 'Perfil não encontrado.');
    if (papel.data === 'admin' && g.papel !== 'admin') throw erro(403, 'Só a administração muda o perfil da Administração.');
    const b = z.object({ permissoes: z.record(z.string(), z.unknown()) }).safeParse(req.body);
    if (!b.success) throw erro(400, 'Envie as permissões.');
    const pedido = limparAjustes(b.data.permissoes);
    if (g.papel !== 'admin') {
      const recusa = recusaAjustes(await o.permissoesDe(g), pedido);
      if (recusa) throw erro(403, recusa);
    }
    // O perfil da Administração nunca perde a equipe (senão ninguém conserta depois).
    if (papel.data === 'admin') pedido.equipe = true;
    const antes = (await acessos.perfis(g.empresaId))[papel.data] ?? {};
    const diff = diferencaDoPadrao(papel.data, { ...antes, ...pedido });
    await acessos.salvarPerfil(g.empresaId, papel.data, diff);
    o.invalidar();
    await auditar(g, null, 'perfil', `Perfil ${NOME_PAPEL[papel.data]}: ${Object.entries(pedido).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    return { perfil: resolver(papel.data, diff) };
  });

  // ---------------------------------------------------------------- pessoas
  app.get('/api/acessos/usuarios', async (req) => {
    const g = gestor(req);
    const [todos, perfis] = await Promise.all([contas.listarUsuarios(g.empresaId), acessos.perfis(g.empresaId)]);
    const pessoas = await Promise.all(todos.filter((u) => apareceNaEquipe(g, u)).map((u) => resumo(u, g, perfis)));
    return { pessoas, papeis: papeisQuePodeDar(g), unidades: unidadesQuePodeDar(g), minhas: await o.permissoesDe(g) };
  });

  app.post('/api/acessos/usuarios', async (req, reply) => {
    const g = gestor(req);
    const b = Nova.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: b.error.issues[0]?.message ?? 'Confira os dados.' });
    const recusa = recusaAtribuicao(g, b.data.papel, b.data.unidades);
    if (recusa) return reply.code(403).send({ erro: recusa });
    const convite = !b.data.senha;
    if (b.data.senha) {
      const fraca = senhaFraca(b.data.senha);
      if (fraca) return reply.code(400).send({ erro: fraca });
    }
    const ajustes = conferirAjustes(g, await o.permissoesDe(g), b.data.ajustes);
    let u: Usuario;
    try {
      u = await contas.criarUsuario({
        empresaId: g.empresaId,
        nome: b.data.nome,
        email: b.data.email,
        papel: b.data.papel,
        unidades: b.data.unidades,
        // Convite: senha aleatória que ninguém sabe, até a pessoa criar a dela pelo link.
        senhaHash: await gerarHash(b.data.senha ?? randomBytes(24).toString('base64url')),
      });
    } catch (e) {
      if (/Já existe/.test((e as Error).message)) return reply.code(409).send({ erro: 'Já existe uma pessoa com esse e-mail.' });
      throw e;
    }
    await acessos.salvarExtras(u.id, { ajustes, horario: limparHorario(b.data.horario), trocarSenha: !convite && (b.data.trocarSenha ?? true) });
    let url: string | undefined;
    let expiraEm: Date | undefined;
    if (convite) {
      expiraEm = new Date(o.agora().getTime() + (b.data.validadeHoras ?? 72) * 3600_000);
      url = link(req, await acessos.criarConvite(u.id, 'convite', expiraEm));
    }
    await auditar(g, u, convite ? 'convidou' : 'criou', `${NOME_PAPEL[u.papel]}${u.unidades.length ? ` · ${u.unidades.join(', ')}` : ''}`);
    const perfis = await acessos.perfis(g.empresaId);
    return reply.code(201).send({ pessoa: await resumo(u, g, perfis), link: url, expiraEm: expiraEm?.toISOString() });
  });

  app.patch('/api/acessos/usuarios/:id', async (req, reply) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const b = Edicao.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Confira os dados.' });
    const papel = b.data.papel ?? alvo.papel;
    const unidades = b.data.unidades ?? alvo.unidades;
    if (b.data.papel !== undefined || b.data.unidades !== undefined) {
      const recusa = recusaAtribuicao(g, papel, unidades);
      if (recusa) return reply.code(403).send({ erro: recusa });
      if (seriaUltimoAdmin(await contas.listarUsuarios(g.empresaId), alvo, { papel })) return reply.code(409).send({ erro: MSG_ULTIMO_ADMIN });
    }
    const mudancas: string[] = [];
    let u: Usuario = alvo;
    if (papel !== alvo.papel || unidades.join() !== alvo.unidades.join()) {
      u = (await contas.atualizarUsuario(alvo.id, { papel, unidades }))!;
      if (papel !== alvo.papel) mudancas.push(`papel ${NOME_PAPEL[alvo.papel]} → ${NOME_PAPEL[papel]}`);
      if (unidades.join() !== alvo.unidades.join()) mudancas.push(`unidades ${unidades.join(', ') || 'nenhuma'}`);
    }
    const extras: Parameters<Acessos['salvarExtras']>[1] = {};
    if (b.data.ajustes !== undefined) {
      extras.ajustes = conferirAjustes(g, await o.permissoesDe(g), b.data.ajustes);
      mudancas.push(`permissões próprias: ${Object.entries(extras.ajustes).map(([k, v]) => `${k}=${v}`).join(', ') || 'iguais ao perfil'}`);
    }
    if (b.data.horario !== undefined) {
      extras.horario = limparHorario(b.data.horario);
      mudancas.push(extras.horario ? `horário ${extras.horario.inicio}–${extras.horario.fim}` : 'sem limite de horário');
    }
    if (b.data.trocarSenha !== undefined) {
      extras.trocarSenha = b.data.trocarSenha;
      mudancas.push(b.data.trocarSenha ? 'troca de senha no próximo login' : 'sem troca de senha obrigatória');
    }
    if (Object.keys(extras).length) await acessos.salvarExtras(alvo.id, extras);
    o.invalidar();
    if (mudancas.length) await auditar(g, alvo, 'editou', mudancas.join('; '));
    return resumo(u, g, await acessos.perfis(g.empresaId));
  });

  const ativar = (ativo: boolean) => async (req: FastifyRequest) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    if (!ativo && seriaUltimoAdmin(await contas.listarUsuarios(g.empresaId), alvo, { ativo })) throw erro(409, MSG_ULTIMO_ADMIN);
    const u = await contas.atualizarUsuario(alvo.id, { ativo });
    if (!ativo) await contas.encerrarSessoesDe(alvo.id);
    o.invalidar();
    await auditar(g, alvo, ativo ? 'reativou' : 'desativou');
    return resumo(u!, g, await acessos.perfis(g.empresaId));
  };
  app.post('/api/acessos/usuarios/:id/desativar', ativar(false));
  app.post('/api/acessos/usuarios/:id/reativar', ativar(true));

  app.post('/api/acessos/usuarios/:id/redefinir', async (req) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const b = z.object({ validadeHoras: Validade }).safeParse(req.body ?? {});
    const horas = (b.success && b.data.validadeHoras) || 24;
    const expiraEm = new Date(o.agora().getTime() + horas * 3600_000);
    const token = await acessos.criarConvite(alvo.id, 'redefinir', expiraEm);
    await auditar(g, alvo, 'redefinir', `link válido por ${horas} h`);
    return { link: link(req, token), expiraEm: expiraEm.toISOString() };
  });

  app.get('/api/acessos/usuarios/:id/sessoes', async (req) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const l = await acessos.sessoes(alvo.id, o.agora());
    return { sessoes: l.map((s) => ({ ...s, criadaEm: s.criadaEm.toISOString(), expiraEm: s.expiraEm.toISOString(), usadaEm: s.usadaEm?.toISOString() ?? null })) };
  });
  app.delete('/api/acessos/usuarios/:id/sessoes/:sessao', async (req) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const ok = await acessos.encerrarSessao(alvo.id, (req.params as { sessao: string }).sessao);
    if (!ok) throw erro(404, 'Sessão não encontrada.');
    await auditar(g, alvo, 'desconectou', 'uma sessão');
    return { ok: true };
  });
  app.post('/api/acessos/usuarios/:id/desconectar', async (req) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    await contas.encerrarSessoesDe(alvo.id);
    await auditar(g, alvo, 'desconectou', 'todos os aparelhos');
    return { ok: true };
  });

  app.get('/api/acessos/auditoria', async (req) => {
    const g = gestor(req);
    const limite = Math.min(200, Math.max(1, Number((req.query as { limite?: string }).limite) || 50));
    const todos = await acessos.auditoria(g.empresaId, limite * 3);
    // Gerente vê o que aconteceu com quem ele enxerga na equipe (e o que ele mesmo fez).
    const visiveis = podeEditarPerfis(g)
      ? todos
      : await (async () => {
          const ids = new Set((await contas.listarUsuarios(g.empresaId)).filter((u) => apareceNaEquipe(g, u)).map((u) => u.id));
          return todos.filter((e) => e.autorId === g.id || (e.alvoId && ids.has(e.alvoId)));
        })();
    return { eventos: visiveis.slice(0, limite).map((e) => ({ ...e, em: e.em.toISOString() })) };
  });

  // ---------------------------------------------------------------- convite (público)
  app.get('/api/auth/convite', async (req) => {
    const t = String((req.query as { t?: string }).t ?? '');
    const v = t ? await acessos.verConvite(t, o.agora()) : undefined;
    if (!v) throw erro(404, 'Este link venceu ou já foi usado. Peça um novo para a gestão.');
    const u = await contas.buscarPorId(v.usuarioId);
    if (!u || !u.ativo) throw erro(404, 'Este link venceu ou já foi usado. Peça um novo para a gestão.');
    return { nome: u.nome, email: u.email, tipo: v.tipo };
  });
  app.post('/api/auth/convite', async (req) => {
    const b = z.object({ t: z.string().min(10).max(200), senha: z.string().max(200) }).safeParse(req.body);
    if (!b.success) throw erro(400, 'Informe a nova senha.');
    const fraca = senhaFraca(b.data.senha);
    if (fraca) throw erro(400, fraca);
    const v0 = await acessos.verConvite(b.data.t, o.agora());
    const u = v0 ? await contas.buscarPorId(v0.usuarioId) : undefined;
    if (!v0 || !u || !u.ativo) throw erro(404, 'Este link venceu ou já foi usado. Peça um novo para a gestão.');
    const v = await acessos.usarConvite(b.data.t, o.agora());
    if (!v) throw erro(404, 'Este link venceu ou já foi usado. Peça um novo para a gestão.');
    await contas.definirSenha(u.id, await gerarHash(b.data.senha));
    await contas.encerrarSessoesDe(u.id);
    await acessos.salvarExtras(u.id, { trocarSenha: false });
    o.invalidar();
    await acessos.auditar({ empresaId: u.empresaId, autorId: u.id, autorNome: u.nome, alvoId: u.id, alvoNome: u.nome, acao: v.tipo === 'convite' ? 'aceitou convite' : 'redefiniu senha', em: o.agora() });
    return { ok: true, email: u.email };
  });
}

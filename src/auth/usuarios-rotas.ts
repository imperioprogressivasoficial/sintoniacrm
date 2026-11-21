import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { apareceNaEquipe, NOME_PAPEL, papeisQuePodeDar, podeGerenciar, recusaAtribuicao, unidadesQuePodeDar, zUnidadesPessoa } from './acesso.js';
import { nomeDoAparelho, type Acessos, type TipoConvite } from './acessos.js';
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
import type { Recuperacao } from './rotas.js';
import { nomeUnidade } from '../unidades.js';

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
  /** perdas-saude: senha nova pelo link (convite ou "Esqueci minha senha"): libera a conta bloqueada por tentativas. */
  aoDefinirSenha?: (u: Usuario) => void;
  /** usuarios: endereço público do app (base dos links de convite e de nova senha). */
  linkBase?: (req: FastifyRequest) => string;
  /** usuarios: e-mail do sistema (Conexões › E-mail). Sem ele, a tela oferece só o link (copiar ou WhatsApp). */
  recuperacao?: Recuperacao;
  /** usuarios: telefone da pessoa (o mesmo da Conta › Perfil). Sem armazém, fica só na memória do processo. */
  telefones?: TelefonesEquipe;
}

/** usuarios: onde fica o telefone de cada pessoa da equipe. */
export interface TelefonesEquipe {
  de(usuarioId: string): Promise<string>;
  definir(usuarioId: string, telefone: string): Promise<void>;
}

/** Telefone para o wa.me: só dígitos, com 55 quando veio só DDD + número. Vazio se não dá para usar. */
export function telefoneWhatsApp(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : '';
}

/** Endereço do WhatsApp com o texto pronto (com o número, se houver). */
export function linkWhatsApp(telefone: string | null | undefined, texto: string): string {
  const n = telefoneWhatsApp(telefone);
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

/** Texto da mensagem que a gestão manda com o link. */
export function textoDoLink(nome: string, tipo: TipoConvite, link: string, expiraEm: Date): string {
  const primeiro = nome.trim().split(/\s+/)[0] || nome;
  const ate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).format(expiraEm).replace(',', ' às');
  return tipo === 'convite'
    ? `Oi, ${primeiro}! Seu acesso ao Sintonia está pronto. Crie a sua senha por este link (vale até ${ate} e funciona uma vez só):\n${link}`
    : `Oi, ${primeiro}! Aqui está o link para criar uma senha nova no Sintonia (vale até ${ate} e funciona uma vez só):\n${link}`;
}

class TelefonesMemoria implements TelefonesEquipe {
  private m = new Map<string, string>();
  async de(id: string) {
    return this.m.get(id) ?? '';
  }
  async definir(id: string, t: string) {
    this.m.set(id, t);
  }
}

/** Limite simples por chave (tentativas na janela). */
function limitador(maximo: number, janelaMs: number) {
  const m = new Map<string, number[]>();
  return (chave: string, agora: number): boolean => {
    const l = (m.get(chave) ?? []).filter((t) => agora - t < janelaMs);
    if (l.length >= maximo) {
      m.set(chave, l);
      return false;
    }
    l.push(agora);
    m.set(chave, l);
    if (m.size > 20_000) m.clear();
    return true;
  };
}

const erro = (statusCode: number, mensagem: string) => Object.assign(new Error(mensagem), { statusCode });
const Unidades = zUnidadesPessoa();
const Validade = z.number().int().min(1).max(24 * 14).optional();
const Telefone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => !v || /^[\d\s()+.-]{8,30}$/.test(v), 'Telefone inválido. Use DDD e número, ex.: (71) 99999-0000.');
const HorarioZ = z.object({ dias: z.array(z.number().int().min(0).max(6)).min(1).max(7), inicio: z.string(), fim: z.string() }).nullable().optional();

const Nova = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
  papel: z.enum(PAPEIS),
  unidades: Unidades,
  telefone: Telefone.optional(),
  /** Sem senha = gera link de convite. */
  senha: z.string().max(200).optional(),
  validadeHoras: Validade,
  trocarSenha: z.boolean().optional(),
  ajustes: z.record(z.string(), z.unknown()).optional(),
  horario: HorarioZ,
});
const Edicao = z.object({
  nome: z.string().trim().min(2, 'O nome precisa de pelo menos 2 letras.').max(120).optional(),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200).optional(),
  telefone: Telefone.optional(),
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
  const telefones = o.telefones ?? new TelefonesMemoria();
  const podeConvite = limitador(30, 15 * 60_000);
  const emailConfigurado = async () => (o.recuperacao ? (await o.recuperacao.canais().catch(() => ({ email: false }))).email : false);
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
  const base = (req: FastifyRequest) => {
    if (o.linkBase) return o.linkBase(req);
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? (req.protocol || 'http');
    return `${proto}://${host}`;
  };
  const link = (req: FastifyRequest, token: string, pagina = 'convite') => `${base(req)}/${pagina}?t=${encodeURIComponent(token)}`;
  /**
   * Gera o link (convite para quem nunca entrou; senão, nova senha), manda por e-mail se houver e-mail do sistema
   * e devolve tudo o que a tela precisa para copiar ou mandar pelo WhatsApp.
   */
  const gerarLink = async (req: FastifyRequest, g: Usuario, alvo: Usuario, tipo: TipoConvite, horas: number, porEmail: boolean) => {
    const expiraEm = new Date(o.agora().getTime() + horas * 3600_000);
    const url = link(req, await acessos.criarConvite(alvo.id, tipo, expiraEm), tipo === 'convite' ? 'convite' : 'nova-senha');
    const configurado = await emailConfigurado();
    let enviado = false;
    if (porEmail && configurado && o.recuperacao) {
      enviado =
        tipo === 'convite'
          ? ((await o.recuperacao.convidar?.(alvo, url, horas, g.nome).catch(() => false)) ?? false)
          : (await o.recuperacao.enviar(alvo, url, horas * 60).catch(() => [] as string[])).length > 0;
    }
    const telefone = await telefones.de(alvo.id).catch(() => '');
    const texto = textoDoLink(alvo.nome, tipo, url, expiraEm);
    return {
      link: url,
      tipo,
      expiraEm: expiraEm.toISOString(),
      email: { configurado, enviado, para: alvo.email },
      telefone: telefone || null,
      texto,
      whatsapp: linkWhatsApp(telefone, texto),
    };
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
    const [ex, sessoes, convite, telefone] = await Promise.all([
      acessos.extras(u.id),
      acessos.sessoes(u.id, o.agora()),
      acessos.conviteAberto(u.id, o.agora()),
      telefones.de(u.id).catch(() => ''),
    ]);
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      telefone,
      /** Link de convite ou de nova senha ainda sem uso. */
      convite: convite ? { tipo: convite.tipo, expiraEm: convite.expiraEm.toISOString() } : null,
      nuncaEntrou: !ex.ultimoAcesso,
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
    const unidades = unidadesQuePodeDar(g);
    const nomes = new Set<string>([...unidades, ...todos.flatMap((u) => u.unidades)]);
    return {
      pessoas,
      papeis: papeisQuePodeDar(g),
      unidades,
      /** Nomes do cadastro (unidade criada agora já aparece com o nome certo). */
      nomesUnidades: Object.fromEntries([...nomes].map((id) => [id, nomeUnidade(id, g.empresaId)])),
      minhas: await o.permissoesDe(g),
      envio: { email: await emailConfigurado() },
      admins: todos.filter((u) => u.papel === 'admin' && u.ativo).length,
    };
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
    if (b.data.telefone) await telefones.definir(u.id, b.data.telefone).catch(() => undefined);
    const envio = convite ? await gerarLink(req, g, u, 'convite', b.data.validadeHoras ?? 72, true) : undefined;
    await auditar(g, u, convite ? 'convidou' : 'criou', `${NOME_PAPEL[u.papel]}${u.unidades.length ? ` · ${u.unidades.map((x) => nomeUnidade(x, g.empresaId)).join(', ')}` : ''}${envio?.email.enviado ? ' · convite enviado por e-mail' : ''}`);
    const perfis = await acessos.perfis(g.empresaId);
    return reply.code(201).send({ pessoa: await resumo(u, g, perfis), ...(envio ?? {}) });
  });

  app.patch('/api/acessos/usuarios/:id', async (req, reply) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const b = Edicao.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: b.error.issues[0]?.message ?? 'Confira os dados.' });
    const papel = b.data.papel ?? alvo.papel;
    const unidades = b.data.unidades ?? alvo.unidades;
    if (b.data.papel !== undefined || b.data.unidades !== undefined) {
      const recusa = recusaAtribuicao(g, papel, unidades);
      if (recusa) return reply.code(403).send({ erro: recusa });
      if (seriaUltimoAdmin(await contas.listarUsuarios(g.empresaId), alvo, { papel })) return reply.code(409).send({ erro: MSG_ULTIMO_ADMIN });
    }
    const mudancas: string[] = [];
    let u: Usuario = alvo;
    if (b.data.nome !== undefined && b.data.nome !== alvo.nome) {
      u = (await contas.atualizarUsuario(alvo.id, { nome: b.data.nome }))!;
      mudancas.push(`nome ${alvo.nome} → ${b.data.nome}`);
    }
    if (b.data.email !== undefined && b.data.email !== alvo.email.toLowerCase()) {
      try {
        u = (await contas.atualizarUsuario(alvo.id, { email: b.data.email }))!;
      } catch (e) {
        if (/Já existe/.test((e as Error).message)) return reply.code(409).send({ erro: 'Já existe uma pessoa com esse e-mail.' });
        throw e;
      }
      mudancas.push(`e-mail ${alvo.email} → ${b.data.email}`);
    }
    if (b.data.telefone !== undefined && b.data.telefone !== (await telefones.de(alvo.id).catch(() => ''))) {
      await telefones.definir(alvo.id, b.data.telefone);
      mudancas.push(b.data.telefone ? 'telefone atualizado' : 'telefone apagado');
    }
    if (papel !== alvo.papel || unidades.join() !== alvo.unidades.join()) {
      u = (await contas.atualizarUsuario(alvo.id, { papel, unidades }))!;
      if (papel !== alvo.papel) mudancas.push(`papel ${NOME_PAPEL[alvo.papel]} → ${NOME_PAPEL[papel]}`);
      if (unidades.join() !== alvo.unidades.join()) mudancas.push(`unidades ${unidades.map((x) => nomeUnidade(x, g.empresaId)).join(', ') || 'nenhuma'}`);
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

  // Link para a pessoa criar a senha: quem nunca entrou recebe um convite novo; quem já entrou, um link de nova senha.
  // Vai por e-mail quando há e-mail do sistema; a tela sempre mostra o link (copiar ou WhatsApp).
  const CorpoLink = z.object({ validadeHoras: Validade, tipo: z.enum(['convite', 'redefinir']).optional(), email: z.boolean().optional() });
  const rotaLink = (padrao?: TipoConvite) => async (req: FastifyRequest) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    if (!alvo.ativo) throw erro(409, 'Esta pessoa está desativada. Reative o acesso antes de mandar um link.');
    const b = CorpoLink.safeParse(req.body ?? {});
    if (!b.success) throw erro(400, 'Confira a validade do link.');
    const ex = await acessos.extras(alvo.id);
    const tipo: TipoConvite = b.data.tipo ?? padrao ?? (ex.ultimoAcesso ? 'redefinir' : 'convite');
    const horas = b.data.validadeHoras ?? (tipo === 'convite' ? 72 : 24);
    const r = await gerarLink(req, g, alvo, tipo, horas, b.data.email ?? true);
    await auditar(g, alvo, tipo === 'convite' ? 'novo convite' : 'redefinir', `link válido por ${horas} h${r.email.enviado ? ' · enviado por e-mail' : ''}`);
    return r;
  };
  app.post('/api/acessos/usuarios/:id/redefinir', rotaLink('redefinir'));
  app.post('/api/acessos/usuarios/:id/link', rotaLink());

  // Apagar só quem não deixou rastro (convite que ninguém usou, cadastro errado). Quem tem histórico, só desativa.
  app.delete('/api/acessos/usuarios/:id', async (req) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    if (seriaUltimoAdmin(await contas.listarUsuarios(g.empresaId), alvo, { ativo: false })) throw erro(409, MSG_ULTIMO_ADMIN);
    const motivo = await acessos.historico(alvo.id);
    if (motivo) throw erro(409, `Não dá para apagar: ${alvo.nome.split(/\s+/)[0]} ${motivo}. Desative o acesso: a pessoa sai na hora e o histórico continua guardado.`);
    await contas.encerrarSessoesDe(alvo.id);
    if (!(await contas.apagarUsuario(alvo.id))) throw erro(404, 'Pessoa não encontrada.');
    o.invalidar();
    await auditar(g, alvo, 'apagou', `${NOME_PAPEL[alvo.papel]} · ${alvo.email}`);
    return { ok: true };
  });

  app.get('/api/acessos/usuarios/:id/sessoes', async (req) => {
    const g = gestor(req);
    const alvo = await alvoDe(req, g);
    const l = await acessos.sessoes(alvo.id, o.agora());
    return { sessoes: l.map((s) => ({ ...s, aparelho: nomeDoAparelho(s.aparelho), criadaEm: s.criadaEm.toISOString(), expiraEm: s.expiraEm.toISOString(), usadaEm: s.usadaEm?.toISOString() ?? null })) };
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
    if (!podeConvite(`ver|${req.ip}`, o.agora().getTime())) throw erro(429, 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.');
    const t = String((req.query as { t?: string }).t ?? '');
    const v = t ? await acessos.verConvite(t, o.agora()) : undefined;
    if (!v) throw erro(404, 'Este link venceu ou já foi usado. Peça um novo para a gestão.');
    const u = await contas.buscarPorId(v.usuarioId);
    if (!u || !u.ativo) throw erro(404, 'Este link venceu ou já foi usado. Peça um novo para a gestão.');
    return { nome: u.nome, email: u.email, tipo: v.tipo };
  });
  app.post('/api/auth/convite', async (req) => {
    if (!podeConvite(`usar|${req.ip}`, o.agora().getTime())) throw erro(429, 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.');
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
    o.aoDefinirSenha?.(u);
    await contas.encerrarSessoesDe(u.id);
    await acessos.salvarExtras(u.id, { trocarSenha: false });
    o.invalidar();
    await acessos.auditar({ empresaId: u.empresaId, autorId: u.id, autorNome: u.nome, alvoId: u.id, alvoNome: u.nome, acao: v.tipo === 'convite' ? 'aceitou convite' : 'redefiniu senha', em: o.agora() });
    return { ok: true, email: u.email };
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { NOME_PAPEL } from '../auth/acesso.js';
import type { Contas, ContasMemoria } from '../auth/contas.js';
import { randomBytes } from 'node:crypto';
import { COOKIE } from '../auth/rotas.js';
import { conferirSenha, gerarHash } from '../auth/senha.js';
import type { Usuario } from '../auth/contas.js';
import { assinaturaDeImagem } from '../auth/equipe.js';

/**
 * Conta da pessoa logada (abre pelo nome/foto no rodapé do menu): perfil (nome, e-mail, telefone,
 * assinatura das mensagens) e preferências da área de trabalho (tema, idioma, tela inicial, densidade).
 * Foto e senha usam as rotas que já existem (/api/equipe/:id/foto e /api/auth/senha).
 * Guardado em sintonia.perfis_usuario (migração 490): vale em qualquer aparelho.
 */

export const TELAS_INICIAIS = ['conversas', 'painel', 'funil', 'agenda', 'ligacoes', 'clientes', 'serena', 'rotina'] as const;

export const Assinatura = z
  .object({
    ligada: z.boolean().default(false),
    /** Vazio = o primeiro nome da pessoa. */
    texto: z.string().trim().max(60).default(''),
    posicao: z.enum(['inicio', 'fim']).default('inicio'),
  })
  .prefault({});
export type Assinatura = z.infer<typeof Assinatura>;

/**
 * conversa-extra: papel de parede das conversas (fundo atrás dos balões), separado para o tema claro e o escuro,
 * como no WhatsApp. 'padrao' = a cor de sempre; desenho = os pontinhos sutis por cima. As cores de verdade
 * (versão clara e escura de cada uma) ficam em public/telas/papel-parede.js.
 */
export const CORES_PAPEL = ['padrao', 'ceu', 'menta', 'marinho', 'aqua', 'areia', 'lavanda', 'grafite'] as const;
const LadoPapel = z.object({ cor: z.enum(CORES_PAPEL).catch('padrao').default('padrao'), desenho: z.boolean().catch(true).default(true) }).prefault({});
export const PapelParede = z.object({ claro: LadoPapel, escuro: LadoPapel }).prefault({});
export type PapelParede = z.infer<typeof PapelParede>;

/**
 * capa-perfil (dono 21/11): capa atrás do perfil em Configurações (celular) e no topo da Conta.
 * 5 fotos de paisagem prontas (public/capas/, créditos em public/capas/CREDITOS.txt), "nenhuma" (só a cor)
 * ou "minha" (a foto que a pessoa mandou, guardada em sintonia.usuario_capas, migração 700).
 */
export const CAPAS = ['praia', 'montanha', 'por-do-sol', 'floresta', 'cidade'] as const;
export const OPCOES_CAPA = [...CAPAS, 'nenhuma', 'minha'] as const;
export const CAPA_PADRAO = 'montanha' satisfies (typeof CAPAS)[number];
/** Foto de capa já reduzida pela tela (~1200 px de largura): bem abaixo disto. */
export const LIMITE_CAPA = 400 * 1024;

/**
 * capa-perfil: atalhos redondos de Configurações (celular), escolhidos por pessoa, na ordem dela. Cada um é o código
 * de um item do app ("grupo:nome", "conta:nome" ou "aba:tela"); a tela ignora o que a pessoa não pode abrir.
 */
export const MAX_ATALHOS = 8;
export const ATALHOS_PADRAO = ['atendimento:agenda', 'atendimento:respostas-rapidas', 'atendimento:rotina', 'aba:serena'];
const CodigoAtalho = z.string().regex(/^[a-z0-9]+(?:[:-][a-z0-9]+)*$/, 'Atalho inválido.').max(60);
const ListaAtalhos = z
  .array(CodigoAtalho)
  .max(MAX_ATALHOS, `Escolha até ${MAX_ATALHOS} atalhos.`)
  .transform((l) => [...new Set(l)]);

export const Preferencias = z
  .object({
    tema: z.enum(['claro', 'escuro', 'auto']).default('auto'),
    idioma: z.enum(['pt-BR']).default('pt-BR'),
    telaInicial: z.enum(TELAS_INICIAIS).default('conversas'),
    densidade: z.enum(['confortavel', 'compacta']).default('confortavel'),
    papelParede: PapelParede,
    /** ligacoes-modos: o último jeito de ligar que a pessoa usou (vem marcado na próxima vez). Sem valor = o padrão da unidade. */
    modoLigacao: z.enum(['telefone', 'whatsapp']).optional().catch(undefined),
    /* capa-perfil */
    capa: z.enum(OPCOES_CAPA).catch(CAPA_PADRAO).default(CAPA_PADRAO),
    atalhos: ListaAtalhos.catch([...ATALHOS_PADRAO]).default([...ATALHOS_PADRAO]),
    /** fluidez2: "Ocultar dados dos clientes" (nomes, números e fotos desfocados para mostrar a tela). */
    ocultarDados: z.boolean().default(false).catch(false),
  })
  .prefault({});
export type Preferencias = z.infer<typeof Preferencias>;

export interface Perfil {
  telefone: string;
  assinatura: Assinatura;
  preferencias: Preferencias;
  atualizadoEm: Date | null;
}

const ler = <T>(s: z.ZodType<T>, b: unknown): T => {
  const r = s.safeParse(b ?? {});
  return r.success ? r.data : s.parse({});
};

/** capa-perfil: a foto de capa que a pessoa mandou. */
export interface CapaUsuario {
  conteudo: Buffer;
  tipo: string;
  atualizadaEm: Date;
}

export interface ArmazemPerfis {
  ler(usuarioId: string): Promise<Perfil>;
  gravar(usuarioId: string, p: Omit<Perfil, 'atualizadoEm'>): Promise<void>;
  /* capa-perfil: foto de capa da própria pessoa (null apaga). */
  capaDe(usuarioId: string): Promise<CapaUsuario | undefined>;
  capaEm(usuarioId: string): Promise<Date | undefined>;
  salvarCapaDe(usuarioId: string, capa: { conteudo: Buffer; tipo: string } | null): Promise<void>;
}

export class ArmazemPerfisMemoria implements ArmazemPerfis {
  private readonly m = new Map<string, Perfil>();
  async ler(usuarioId: string) {
    const p = this.m.get(usuarioId);
    return p ? structuredClone(p) : { telefone: '', assinatura: Assinatura.parse({}), preferencias: Preferencias.parse({}), atualizadoEm: null };
  }
  async gravar(usuarioId: string, p: Omit<Perfil, 'atualizadoEm'>) {
    this.m.set(usuarioId, { ...structuredClone(p), atualizadoEm: new Date() });
  }
  private readonly capas = new Map<string, CapaUsuario>();
  async capaDe(usuarioId: string) {
    return this.capas.get(usuarioId);
  }
  async capaEm(usuarioId: string) {
    return this.capas.get(usuarioId)?.atualizadaEm;
  }
  async salvarCapaDe(usuarioId: string, capa: { conteudo: Buffer; tipo: string } | null) {
    if (!capa) this.capas.delete(usuarioId);
    else this.capas.set(usuarioId, { ...capa, atualizadaEm: new Date() });
  }
}

export class ArmazemPerfisPostgres implements ArmazemPerfis {
  constructor(private readonly pool: pg.Pool) {}
  async ler(usuarioId: string) {
    const { rows } = await this.pool.query<{ telefone: string | null; assinatura: unknown; preferencias: unknown; atualizado_em: Date }>(
      'select telefone, assinatura, preferencias, atualizado_em from sintonia.perfis_usuario where usuario_id = $1',
      [usuarioId],
    );
    const r = rows[0];
    return { telefone: r?.telefone ?? '', assinatura: ler(Assinatura, r?.assinatura), preferencias: ler(Preferencias, r?.preferencias), atualizadoEm: r?.atualizado_em ?? null };
  }
  async gravar(usuarioId: string, p: Omit<Perfil, 'atualizadoEm'>) {
    await this.pool.query(
      `insert into sintonia.perfis_usuario (usuario_id, telefone, assinatura, preferencias, atualizado_em) values ($1, $2, $3, $4, now())
       on conflict (usuario_id) do update set telefone = excluded.telefone, assinatura = excluded.assinatura, preferencias = excluded.preferencias, atualizado_em = now()`,
      [usuarioId, p.telefone, JSON.stringify(p.assinatura), JSON.stringify(p.preferencias)],
    );
  }
  async capaDe(usuarioId: string) {
    const { rows } = await this.pool.query<{ conteudo: Buffer; tipo: string; atualizada_em: Date }>(
      'select conteudo, tipo, atualizada_em from sintonia.usuario_capas where usuario_id = $1',
      [usuarioId],
    );
    const r = rows[0];
    return r ? { conteudo: r.conteudo, tipo: r.tipo, atualizadaEm: r.atualizada_em } : undefined;
  }
  async capaEm(usuarioId: string) {
    const { rows } = await this.pool.query<{ atualizada_em: Date }>('select atualizada_em from sintonia.usuario_capas where usuario_id = $1', [usuarioId]);
    return rows[0]?.atualizada_em;
  }
  async salvarCapaDe(usuarioId: string, capa: { conteudo: Buffer; tipo: string } | null) {
    if (!capa) {
      await this.pool.query('delete from sintonia.usuario_capas where usuario_id = $1', [usuarioId]);
      return;
    }
    await this.pool.query(
      `insert into sintonia.usuario_capas (usuario_id, conteudo, tipo, atualizada_em) values ($1, $2, $3, now())
       on conflict (usuario_id) do update set conteudo = excluded.conteudo, tipo = excluded.tipo, atualizada_em = now()`,
      [usuarioId, capa.conteudo, capa.tipo],
    );
  }
}

/** usuarios: o telefone da Conta › Perfil também serve para a gestão mandar o convite pelo WhatsApp. */
export const telefonesDosPerfis = (perfis: ArmazemPerfis) => ({
  de: async (usuarioId: string) => (await perfis.ler(usuarioId)).telefone,
  definir: async (usuarioId: string, telefone: string) => {
    const { atualizadoEm: _, ...atual } = await perfis.ler(usuarioId);
    await perfis.gravar(usuarioId, { ...atual, telefone });
  },
});

/** Troca o e-mail de login. Devolve false se outro login já usa esse e-mail. */
export type TrocarEmail = (usuarioId: string, email: string) => Promise<boolean>;
export const trocarEmailPostgres =
  (pool: pg.Pool): TrocarEmail =>
  async (id, email) => {
    try {
      await pool.query('update sintonia.usuarios set email = $2 where id = $1', [id, email]);
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return false;
      throw e;
    }
  };
export const trocarEmailMemoria =
  (contas: ContasMemoria): TrocarEmail =>
  async (id, email) => {
    if (contas.usuarios.some((u) => u.id !== id && u.email.toLowerCase() === email.toLowerCase())) return false;
    const u = contas.usuarios.find((x) => x.id === id);
    if (u) u.email = email;
    return true;
  };

/** Texto com a assinatura (ex.: "*Carla:*\nOi!"), quando a pessoa ligou. */
export function assinar(texto: string, a: Assinatura, nome: string): string {
  if (!a.ligada) return texto;
  const quem = (a.texto || nome.trim().split(/\s+/)[0] || '').replace(/[*_~]/g, '').trim();
  if (!quem) return texto;
  const marca = `*${quem}:*`;
  if (texto.startsWith(marca)) return texto;
  return a.posicao === 'fim' ? `${texto}\n\n_${quem}_` : `${marca}\n${texto}`;
}

const Telefone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => !v || /^[\d\s()+-]{8,30}$/.test(v), 'Telefone inválido');
const PerfilCorpo = z.object({
  nome: z.string().trim().min(2, 'O nome precisa de pelo menos 2 letras.').max(120).optional(),
  telefone: Telefone.optional(),
  assinatura: z.object({ ligada: z.boolean().optional(), texto: z.string().trim().max(60).optional(), posicao: z.enum(['inicio', 'fim']).optional() }).optional(),
  preferencias: z
    .object({
      tema: z.enum(['claro', 'escuro', 'auto']).optional(),
      idioma: z.enum(['pt-BR']).optional(),
      telaInicial: z.enum(TELAS_INICIAIS).optional(),
      densidade: z.enum(['confortavel', 'compacta']).optional(),
      modoLigacao: z.enum(['telefone', 'whatsapp']).optional(), // ligacoes-modos
      capa: z.enum(OPCOES_CAPA).optional(), // capa-perfil
      atalhos: ListaAtalhos.optional(), // capa-perfil
      ocultarDados: z.boolean().optional(), // fluidez2: modo privacidade
      papelParede: z
        .object({
          claro: z.object({ cor: z.enum(CORES_PAPEL).optional(), desenho: z.boolean().optional() }).optional(),
          escuro: z.object({ cor: z.enum(CORES_PAPEL).optional(), desenho: z.boolean().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
});
const TrocaEmail = z.object({ email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200), senha: z.string().min(1).max(200) });

export interface OpcoesConta {
  contas: Contas;
  perfis: ArmazemPerfis;
  trocarEmail?: TrocarEmail;
  /** sem-pagamento: depois de a pessoa excluir a própria conta (registro na auditoria, por exemplo). */
  aoExcluir?: (u: Usuario) => Promise<void>;
}

/** sem-pagamento: como a conta excluída aparece no histórico da empresa. */
export const NOME_EXCLUIDO = 'Usuário excluído';
/** E-mail que ninguém usa (o e-mail é único): libera o e-mail real para um convite novo no futuro. */
export const emailExcluido = (id: string) => `excluido-${id}@excluido.invalid`;

const erro = (statusCode: number, msg: string) => Object.assign(new Error(msg), { statusCode });
/** Valida o corpo e devolve a primeira mensagem do problema (em português quando o campo tem uma). */
const validar = <S extends z.ZodTypeAny>(s: S, v: unknown): z.infer<S> => {
  const r = s.safeParse(v ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  const campo = i?.path?.length ? ` (${i.path.join('.')})` : '';
  throw Object.assign(new Error(i?.message && !/^(Invalid|Expected|Too|Number must|String must)/.test(i.message) ? i.message : `Confira os dados${campo}.`), { statusCode: 400 });
};

const semIndefinidos = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export function registrarConta(app: FastifyInstance, o: OpcoesConta): void {
  const eu = (req: FastifyRequest) => {
    if (!req.usuario) throw erro(401, 'Faça login para continuar.');
    return req.usuario;
  };
  const conta = async (req: FastifyRequest) => {
    const u = eu(req);
    const p = await o.perfis.ler(u.id);
    const capaEm = await o.perfis.capaEm(u.id).catch(() => undefined);
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      papel: u.papel,
      papelNome: NOME_PAPEL[u.papel],
      unidades: u.unidades,
      telefone: p.telefone,
      assinatura: p.assinatura,
      preferencias: p.preferencias,
      atualizadoEm: p.atualizadoEm,
      podeTrocarEmail: Boolean(o.trocarEmail),
      /* capa-perfil: quando a foto de capa própria mudou (a tela põe no endereço para não pegar a antiga do cache). */
      capaEm: capaEm ? capaEm.getTime() : null,
    };
  };

  app.get('/api/conta', async (req) => conta(req));

  app.patch('/api/conta', async (req) => {
    const u = eu(req);
    const b = validar(PerfilCorpo, req.body);
    if (b.nome && b.nome !== u.nome) {
      await o.contas.atualizarUsuario(u.id, { nome: b.nome });
      req.usuario = { ...u, nome: b.nome };
    }
    const atual = await o.perfis.ler(u.id);
    // capa-perfil: "minha" só vale se a pessoa já mandou a foto dela.
    if (b.preferencias?.capa === 'minha' && !(await o.perfis.capaEm(u.id))) throw erro(400, 'Envie a sua foto de capa primeiro.');
    await o.perfis.gravar(u.id, {
      telefone: b.telefone ?? atual.telefone,
      assinatura: Assinatura.parse({ ...atual.assinatura, ...semIndefinidos(b.assinatura ?? {}) }),
      preferencias: (() => {
        const { papelParede: pp, ...resto } = b.preferencias ?? {};
        const papel = atual.preferencias.papelParede;
        return Preferencias.parse({
          ...atual.preferencias,
          ...semIndefinidos(resto),
          // conversa-extra: mudar só o claro (ou só a cor) não apaga o resto do papel de parede.
          papelParede: {
            claro: { ...papel.claro, ...semIndefinidos(pp?.claro ?? {}) },
            escuro: { ...papel.escuro, ...semIndefinidos(pp?.escuro ?? {}) },
          },
        });
      })(),
    });
    return conta(req);
  });

  // Trocar o próprio e-mail de login: pede a senha (quem pegou o celular destravado não troca).
  const tentativas = new Map<string, number[]>();
  app.post('/api/conta/email', async (req) => {
    const u = eu(req);
    if (!o.trocarEmail) throw erro(501, 'Trocar o e-mail ainda não está disponível aqui. Peça para a administração.');
    const b = TrocaEmail.safeParse(req.body ?? {});
    if (!b.success) throw erro(400, b.error.issues[0]?.message ?? 'Informe o e-mail novo e a sua senha.');
    const agora = Date.now();
    const l = (tentativas.get(u.id) ?? []).filter((t) => agora - t < 15 * 60_000);
    if (l.length >= 5) throw erro(429, 'Muitas tentativas. Espere 15 minutos e tente de novo.');
    const com = await o.contas.buscarPorId(u.id);
    if (!com || !(await conferirSenha(b.data.senha, com.senhaHash))) {
      tentativas.set(u.id, [...l, agora]);
      throw erro(400, 'A senha não confere.');
    }
    tentativas.delete(u.id);
    if (b.data.email === u.email.toLowerCase()) return conta(req);
    if (!(await o.trocarEmail(u.id, b.data.email))) throw erro(409, 'Esse e-mail já é usado por outro login.');
    req.usuario = { ...u, email: b.data.email };
    return conta(req);
  });

  /* sem-pagamento: excluir a própria conta (App Store, diretriz 5.1.1(v)). Pede que a pessoa digite EXCLUIR.
     Desativa o login, encerra todas as sessões e apaga os dados pessoais (nome, e-mail, telefone, foto, assinatura e
     preferências). O histórico da empresa (conversas, vendas, agenda) fica, ligado a "Usuário excluído".
     A única pessoa com acesso de administração não pode se excluir: a empresa ficaria sem ninguém para administrar. */
  const Excluir = z.object({ confirmacao: z.string().max(40) });
  app.post('/api/conta/excluir', async (req, reply) => {
    const u = eu(req);
    const b = Excluir.safeParse(req.body ?? {});
    if (!b.success || b.data.confirmacao.trim().toUpperCase() !== 'EXCLUIR') throw erro(400, 'Para confirmar, digite EXCLUIR.');
    if (u.papel === 'admin') {
      const outros = (await o.contas.listarUsuarios(u.empresaId)).filter((x) => x.id !== u.id && x.ativo && x.papel === 'admin');
      if (!outros.length) {
        throw erro(409, 'Você é a única pessoa com acesso de administração desta empresa. Antes de excluir a sua conta, dê o acesso de administração para outra pessoa em Atendentes e acessos.');
      }
    }
    await o.contas.atualizarUsuario(u.id, { ativo: false, nome: NOME_EXCLUIDO, email: emailExcluido(u.id) });
    // Senha aleatória que ninguém conhece: mesmo reativado por engano, ninguém entra com a senha antiga.
    await o.contas.definirSenha(u.id, await gerarHash(randomBytes(24).toString('base64url')));
    await o.contas.salvarFotoDe(u.id, null, new Date());
    await o.perfis.gravar(u.id, { telefone: '', assinatura: Assinatura.parse({}), preferencias: Preferencias.parse({}) });
    await o.perfis.salvarCapaDe(u.id, null); // capa-perfil
    await o.contas.encerrarSessoesDe(u.id);
    await o.aoExcluir?.(u).catch(() => undefined);
    reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true, mensagem: 'Sua conta foi excluída. Seus dados pessoais foram apagados.' };
  });

  /* capa-perfil: foto de capa própria. A tela reduz para ~1200 px (WebP ou JPEG) antes de mandar; aqui confere tipo,
     tamanho e os primeiros bytes (igual à foto do rosto). Só a própria pessoa vê e troca a capa dela. */
  app.get('/api/conta/capa', async (req, reply) => {
    const u = eu(req);
    const c = await o.perfis.capaDe(u.id);
    if (!c) return reply.header('cache-control', 'no-store').code(204).send();
    return reply.header('cache-control', 'private, max-age=600').type(c.tipo).send(c.conteudo);
  });
  const CapaNova = z.object({ base64: z.string().min(10).max(Math.ceil((LIMITE_CAPA * 4) / 3) + 200), mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']) });
  app.put('/api/conta/capa', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const u = eu(req);
    const b = CapaNova.safeParse(req.body ?? {});
    if (!b.success) {
      const grande = b.error.issues.some((i) => i.path[0] === 'base64' && i.code === 'too_big');
      return reply.code(grande ? 413 : 400).send({ erro: grande ? 'Foto grande demais (até 400 KB depois de reduzida).' : 'Envie uma foto JPG, PNG ou WebP.' });
    }
    const conteudo = Buffer.from(b.data.base64.replace(/^data:[^,]*,/, ''), 'base64');
    if (conteudo.length > LIMITE_CAPA) return reply.code(413).send({ erro: 'Foto grande demais (até 400 KB depois de reduzida).' });
    if (!assinaturaDeImagem(conteudo, b.data.mimetype)) return reply.code(400).send({ erro: 'O arquivo não é uma imagem válida.' });
    await o.perfis.salvarCapaDe(u.id, { conteudo, tipo: b.data.mimetype });
    const atual = await o.perfis.ler(u.id);
    await o.perfis.gravar(u.id, { telefone: atual.telefone, assinatura: atual.assinatura, preferencias: { ...atual.preferencias, capa: 'minha' } });
    return conta(req);
  });
  app.delete('/api/conta/capa', async (req) => {
    const u = eu(req);
    await o.perfis.salvarCapaDe(u.id, null);
    const atual = await o.perfis.ler(u.id);
    if (atual.preferencias.capa === 'minha') {
      await o.perfis.gravar(u.id, { telefone: atual.telefone, assinatura: atual.assinatura, preferencias: { ...atual.preferencias, capa: CAPA_PADRAO } });
    }
    return conta(req);
  });

  // Assinatura nas mensagens que a pessoa manda pela conversa (só quem ligou em Conta › Perfil).
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'POST' || !req.usuario || !/^\/api\/conversas\/[^/]+\/enviar$/.test(req.url.split('?')[0]!)) return;
    const corpo = req.body as { texto?: unknown } | undefined;
    if (!corpo || typeof corpo.texto !== 'string' || !corpo.texto.trim()) return;
    const p = await o.perfis.ler(req.usuario.id).catch(() => null);
    if (p?.assinatura.ligada) corpo.texto = assinar(corpo.texto, p.assinatura, req.usuario.nome);
  });
}

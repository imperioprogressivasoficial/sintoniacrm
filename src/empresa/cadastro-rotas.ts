import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, veTudo } from '../auth/acesso.js';
import { assinaturaDeImagem } from '../auth/equipe.js';
import { normalizar } from '../comercial/calculo.js';
import { LIMITE_ENVIO, nomeParaCabecalho, semPrefixoDataUrl, tamanhoBase64 } from '../midia.js';
import {
  CATEGORIAS_DOCUMENTO,
  DadosEmpresa,
  DadosUnidade,
  Endereco,
  ErroDuplicado,
  Horario,
  HorariosPadrao,
  TIPOS_PRODUTO,
  type ArmazemCadastro,
  type Documento,
  type NovoProduto,
  type Produto,
  type Unidade,
} from './cadastro.js';
import { definirIdentidade } from './identidade.js';
import { definirUnidades, faixasDoHorario, IDS_LEGADOS, textoEndereco } from '../unidades.js';

/**
 * Rotas do menu Empresa:
 * - /api/empresa/cadastro, /api/empresa/logo      dados da empresa e logo (direção e administração editam)
 * - /api/unidades                                  unidades (todos leem os nomes; direção e administração editam)
 * - /api/produtos, /api/produtos/:id/foto          produtos e serviços (todos leem; gestão edita)
 * - /api/tabelas-preco                             tabelas de preço (todos leem; gestão edita)
 * - /api/documentos, /api/documentos/:id/arquivo   documentos da empresa (gestão envia; "só gestão" some para a equipe)
 * Tudo pela empresa de quem está logado (req.usuario.empresaId).
 */
export interface OpcoesCadastro {
  armazem: ArmazemCadastro;
  /** Empresa quando não há login (teste local). */
  empresaId: string;
  /** Nome da empresa (o mesmo de /api/empresa): renomear passa por aqui para o cache dele valer na hora. */
  empresa?: { dados(): Promise<{ nome: string }>; renomear(nome: string, por: string): Promise<unknown> };
  /**
   * Unidades criadas no 1º uso, quando a empresa ainda não tem nenhuma (a Império recebe as que o sistema já
   * conhecia, para nada mudar de nome sem querer; empresa nova recebe uma "Unidade principal").
   */
  unidadesPadrao: ListaPadrao | ((empresaId: string) => ListaPadrao);
  /** Ids antigos que as conversas e as pessoas já usam: podem ser desativados, nunca apagados (padrão: norte, sumare, feira). */
  idsFixos?: readonly string[];
  /** A unidade já tem conversas, pessoas ou números ligados? (não deixa apagar; só desativar) */
  emUso?: (empresaId: string, id: string) => Promise<boolean>;
  /** Mantém o cache do servidor (src/unidades.ts e src/empresa/identidade.ts) igual ao cadastro. Padrão: sim. */
  sincronizarCache?: boolean;
  /** Tabela de preços antiga do Comercial (para copiar para Produtos e serviços). */
  precosComercial?: (empresaId: string) => Promise<Array<{ servico: string; valor: number }>>;
  /** Avisado quando as unidades mudam (o servidor pode atualizar nomes guardados em memória). */
  aoMudarUnidades?: (empresaId: string, unidades: Unidade[]) => void;
}

type ListaPadrao = Array<{ id: string; nome: string; nomeCliente?: string; horario?: Horario | null; ativa?: boolean; horariosPadrao?: string[]; ultimoHorarioEspecial?: string }>;

/** O que o registro devolve: o index carrega o cache das unidades e da empresa ao subir. */
export interface CadastroRegistrado {
  /** Lê (e semeia, se preciso) as unidades e os dados da empresa e atualiza o cache do servidor. */
  carregar(empresaId: string): Promise<Unidade[]>;
}

const erro = (statusCode: number, msg: string) => Object.assign(new Error(msg), { statusCode });
/** Valida o corpo e devolve a primeira mensagem do problema (em português quando o campo tem uma). */
const validar = <S extends z.ZodTypeAny>(s: S, v: unknown): z.infer<S> => {
  const r = s.safeParse(v ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  const campo = i?.path?.length ? ` (${i.path.join('.')})` : '';
  throw Object.assign(new Error(i?.message && !/^(Invalid|Expected|Too|Number must|String must)/.test(i.message) ? i.message : `Confira os dados${campo}.`), { statusCode: 400 });
};

const LIMITE_LOGO = 600 * 1024;
const LIMITE_DOC = LIMITE_ENVIO;
const CORPO_DOC = Math.ceil((LIMITE_DOC * 4) / 3) + 64 * 1024;
const CORPO_FOTO = Math.ceil((LIMITE_LOGO * 4) / 3) + 16 * 1024;

/** Tipos de documento aceitos (o resto é recusado: nada de HTML ou executável guardado). */
export const TIPOS_DOCUMENTO: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'Imagem',
  'image/png': 'Imagem',
  'image/webp': 'Imagem',
  'text/plain': 'Texto',
  'text/csv': 'Planilha',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/vnd.oasis.opendocument.text': 'Documento',
  'application/vnd.oasis.opendocument.spreadsheet': 'Planilha',
  'application/zip': 'ZIP',
};
/** Mostrados dentro do navegador; o resto vai como download. */
const EXIBIVEIS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/** Confere a assinatura do arquivo quando dá (PDF, imagens, Office/ZIP). */
export function arquivoConfere(b: Buffer, tipo: string): boolean {
  if (tipo.startsWith('image/')) return assinaturaDeImagem(b, tipo);
  if (tipo === 'application/pdf') return b.subarray(0, 5).toString('latin1') === '%PDF-';
  if (tipo.includes('openxmlformats') || tipo.includes('opendocument') || tipo === 'application/zip') return b[0] === 0x50 && b[1] === 0x4b;
  if (tipo === 'application/msword' || tipo === 'application/vnd.ms-excel') return b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  // Texto: sem bytes nulos (um binário disfarçado de .txt é recusado).
  return !b.subarray(0, 4096).includes(0);
}

/** Id curto e estável para unidade nova ("Shopping Barra" → "shopping-barra"). */
export function idDeUnidade(nome: string, usados: Set<string>): string {
  const base = normalizar(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'unidade';
  let id = base;
  for (let i = 2; usados.has(id); i++) id = `${base.slice(0, 16 - String(i).length - 1).replace(/-+$/, '')}-${i}`;
  return id;
}

const T = (max: number) => z.string().trim().max(max);
const Dinheiro = z
  .number()
  .min(0, 'Preço não pode ser negativo.')
  .max(10_000_000)
  .transform((v) => Math.round(v * 100) / 100);
const ImagemCorpo = z.object({ base64: z.string().min(10).max(CORPO_FOTO), mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']) });

const CadastroCorpo = z.object({
  nome: z.string().trim().min(2, 'O nome precisa de pelo menos 2 letras.').max(80).optional(),
  dados: z.record(z.string(), z.unknown()).optional(),
});

const UnidadeCorpo = z.object({
  nome: z.string().trim().min(2, 'O nome precisa de pelo menos 2 letras.').max(60),
  ativa: z.boolean().default(true),
  endereco: Endereco.optional(),
  telefone: T(30).optional(),
  whatsapp: T(30).optional(),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail inválido').max(200)]).optional(),
  horario: Horario.nullable().optional(),
  observacao: T(500).optional(),
  nomeCliente: T(80).optional(),
  modoLigacao: z.enum(['telefone', 'whatsapp']).optional(), // ligacoes-modos
  /* serena-regras: horários que a IA oferece, último horário especial e serviço padrão para agendar */
  horariosPadrao: HorariosPadrao.optional(),
  ultimoHorarioEspecial: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato 18:00')]).optional(),
  servicoPadraoId: z.number().int().positive().nullable().optional(),
});

const ProdutoBase = z.object({
  nome: z.string().trim().min(2, 'O nome precisa de pelo menos 2 letras.').max(80),
  tipo: z.enum(TIPOS_PRODUTO),
  categoria: T(60)
    .nullable()
    .transform((v) => (v ? v : null)),
  preco: Dinheiro.nullable(),
  duracaoMin: z.number().int().min(5, 'Duração mínima: 5 minutos.').max(24 * 60).nullable(),
  descricao: T(2000),
  codigo: T(40),
  ativo: z.boolean(),
});
const ProdutoNovo = ProdutoBase.extend({
  categoria: ProdutoBase.shape.categoria.default(null),
  preco: ProdutoBase.shape.preco.default(null),
  duracaoMin: ProdutoBase.shape.duracaoMin.default(null),
  descricao: ProdutoBase.shape.descricao.default(''),
  codigo: ProdutoBase.shape.codigo.default(''),
  ativo: z.boolean().default(true),
});
const ProdutoEdicao = ProdutoBase.partial();

const Data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD')
  .nullable()
  .default(null);
const TabelaCorpo = z
  .object({
    nome: z.string().trim().min(2, 'O nome precisa de pelo menos 2 letras.').max(80),
    descricao: T(500).default(''),
    unidade: z.string().trim().max(20).nullable().default(null),
    ativa: z.boolean().default(true),
    inicio: Data,
    fim: Data,
    itens: z.array(z.object({ produtoId: z.string().uuid(), preco: Dinheiro })).max(5000).default([]),
  })
  .refine((t) => !t.inicio || !t.fim || t.inicio <= t.fim, 'A data final precisa ser depois da inicial.');

const DocumentoNovo = z.object({
  nome: z.string().trim().min(1, 'Dê um nome ao documento.').max(160),
  categoria: z.enum(CATEGORIAS_DOCUMENTO).default('outro'),
  descricao: T(500).default(''),
  visivel: z.enum(['equipe', 'gestao']).default('equipe'),
  mimetype: z
    .string()
    .trim()
    .toLowerCase()
    .transform((m) => m.split(';')[0]!.trim())
    .refine((m) => m in TIPOS_DOCUMENTO, 'Tipo de arquivo não aceito. Envie PDF, imagem, Word, Excel, PowerPoint, texto ou ZIP.'),
  base64: z.string().min(1).max(CORPO_DOC),
});
const DocumentoEdicao = z.object({
  nome: z.string().trim().min(1).max(160).optional(),
  categoria: z.enum(CATEGORIAS_DOCUMENTO).optional(),
  descricao: T(500).optional(),
  visivel: z.enum(['equipe', 'gestao']).optional(),
});

export function registrarCadastro(app: FastifyInstance, o: OpcoesCadastro): CadastroRegistrado {
  const empresaDe = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const ehDirecao = (req: FastifyRequest) => !req.usuario || veTudo(req.usuario);
  const ehGestao = (req: FastifyRequest) => !req.usuario || ehGestor(req.usuario);
  const exigeDirecao = (req: FastifyRequest, msg: string) => {
    if (!ehDirecao(req)) throw erro(403, msg);
  };
  const exigeGestao = (req: FastifyRequest, msg = 'Só a gerência, a direção e a administração mudam produtos, preços e documentos.') => {
    if (!ehGestao(req)) throw erro(403, msg);
  };
  const imagem = (corpo: unknown) => {
    const b = ImagemCorpo.safeParse(corpo);
    if (!b.success) throw erro(400, 'Envie uma imagem JPG, PNG ou WebP.');
    const conteudo = Buffer.from(semPrefixoDataUrl(b.data.base64), 'base64');
    if (conteudo.length > LIMITE_LOGO) throw erro(413, 'Imagem grande demais (até 600 KB).');
    if (!assinaturaDeImagem(conteudo, b.data.mimetype)) throw erro(400, 'O arquivo não é uma imagem válida.');
    return { conteudo, tipo: b.data.mimetype };
  };
  const enviarArquivo = (reply: FastifyReply, a: { conteudo: Buffer; tipo: string }) =>
    reply.header('cache-control', 'private, max-age=600').header('x-content-type-options', 'nosniff').type(a.tipo).send(a.conteudo);

  // ------------------------------------------------------------ dados da empresa
  const nomeDaEmpresa = async (empresaId: string, salvo?: string) =>
    (empresaId === o.empresaId && o.empresa ? (await o.empresa.dados().catch(() => null))?.nome : undefined) ?? salvo ?? empresaId;
  /** Antes de gravar: a empresa nasce com o nome certo (o armazém cria a linha com o id quando ela ainda não existe). */
  const garantirEmpresa = async (empresaId: string) => {
    if (empresaId === o.empresaId && o.empresa) await o.empresa.dados().catch(() => null);
  };
  const cadastro = async (req: FastifyRequest) => {
    const empresaId = empresaDe(req);
    const r = await o.armazem.lerDados(empresaId);
    const dados = r?.dados ?? DadosEmpresa.parse({});
    return {
      nome: await nomeDaEmpresa(empresaId, r?.nome),
      dados,
      logoEm: r?.logoEm ? r.logoEm.getTime() : null,
      atualizadaEm: r?.atualizadaEm ?? null,
      atualizadaPor: r?.atualizadaPor ?? null,
      podeEditar: ehDirecao(req),
    };
  };
  app.get('/api/empresa/cadastro', async (req) => cadastro(req));
  app.patch('/api/empresa/cadastro', async (req) => {
    exigeDirecao(req, 'Só a direção e a administração mudam os dados da empresa.');
    const b = validar(CadastroCorpo, req.body);
    const empresaId = empresaDe(req);
    await garantirEmpresa(empresaId);
    if (b.dados) {
      const atual = (await o.armazem.lerDados(empresaId))?.dados ?? DadosEmpresa.parse({});
      await o.armazem.gravarDados(empresaId, validar(DadosEmpresa, { ...atual, ...b.dados }), quem(req));
    }
    if (b.nome) {
      if (empresaId === o.empresaId && o.empresa) await o.empresa.renomear(b.nome, quem(req));
    }
    // Nome, segmento, cidade e "sobre" entram na hora nos textos da IA, da Serena e dos e-mails.
    await sincronizar(empresaId);
    return cadastro(req);
  });

  app.get('/api/empresa/logo', async (req, reply) => {
    const l = await o.armazem.logo(empresaDe(req));
    if (!l) return reply.header('cache-control', 'no-store').code(204).send();
    return enviarArquivo(reply, l);
  });
  app.put('/api/empresa/logo', { bodyLimit: CORPO_FOTO + 1024 }, async (req) => {
    exigeDirecao(req, 'Só a direção e a administração trocam a logo.');
    await garantirEmpresa(empresaDe(req));
    await o.armazem.gravarLogo(empresaDe(req), imagem(req.body));
    return { ok: true, logoEm: Date.now() };
  });
  app.delete('/api/empresa/logo', async (req) => {
    exigeDirecao(req, 'Só a direção e a administração trocam a logo.');
    await o.armazem.gravarLogo(empresaDe(req), null);
    return { ok: true };
  });

  // ------------------------------------------------------------ unidades
  const fixas = new Set(o.idsFixos ?? IDS_LEGADOS);
  const semeadas = new Set<string>();
  async function unidades(empresaId: string): Promise<Unidade[]> {
    let l = await o.armazem.unidades(empresaId);
    if (!l.length && !semeadas.has(empresaId)) {
      semeadas.add(empresaId);
      const padrao = typeof o.unidadesPadrao === 'function' ? o.unidadesPadrao(empresaId) : o.unidadesPadrao;
      for (const [i, u] of padrao.entries()) {
        await o.armazem.salvarUnidade(empresaId, {
          id: u.id,
          nome: u.nome,
          ativa: u.ativa ?? true,
          ordem: i,
          dados: DadosUnidade.parse({ horario: u.horario ?? null, nomeCliente: u.nomeCliente && u.nomeCliente !== u.nome ? u.nomeCliente : '', horariosPadrao: u.horariosPadrao ?? [], ultimoHorarioEspecial: u.ultimoHorarioEspecial ?? '' }),
          atualizadaPor: null,
        });
      }
      l = await o.armazem.unidades(empresaId);
      await sincronizar(empresaId, l);
      o.aoMudarUnidades?.(empresaId, l);
    }
    return l;
  }
  /** Cache do servidor = cadastro: unidades (com o horário da empresa quando a unidade segue o dela) e a identidade. */
  async function sincronizar(empresaId: string, lista?: Unidade[]) {
    if (o.sincronizarCache === false) return;
    const reg = await o.armazem.lerDados(empresaId).catch(() => undefined);
    const dados = reg?.dados ?? DadosEmpresa.parse({});
    const l = lista ?? (await o.armazem.unidades(empresaId));
    if (l.length) {
      definirUnidades(
        empresaId,
        l.map((u) => ({
          id: u.id,
          nome: u.nome,
          nomeCliente: u.dados.nomeCliente,
          ativa: u.ativa,
          ordem: u.ordem,
          horario: faixasDoHorario(u.dados.horario ?? dados.horario),
          /* serena-regras */
          horariosPadrao: u.dados.horariosPadrao,
          ultimoHorarioEspecial: u.dados.ultimoHorarioEspecial || null,
          servicoPadraoId: u.dados.servicoPadraoId,
          endereco: textoEndereco(u.dados.endereco),
        })),
      );
    }
    definirIdentidade(empresaId, {
      nome: await nomeDaEmpresa(empresaId, reg?.nome),
      segmento: dados.segmento,
      cidade: dados.endereco.cidade,
      uf: dados.endereco.uf,
      sobre: dados.sobre,
    });
  }
  const publicaUnidade = (u: Unidade) => ({ ...u, fixa: fixas.has(u.id) });
  app.get('/api/unidades', async (req) => ({ unidades: (await unidades(empresaDe(req))).map(publicaUnidade), podeEditar: ehDirecao(req) }));

  const mudou = async (empresaId: string) => {
    const l = await o.armazem.unidades(empresaId);
    await sincronizar(empresaId, l);
    o.aoMudarUnidades?.(empresaId, l);
  };
  const dadosUnidade = (b: z.infer<typeof UnidadeCorpo>, atual?: Unidade) =>
    DadosUnidade.parse({
      ...(atual?.dados ?? {}),
      ...Object.fromEntries(Object.entries({ endereco: b.endereco, telefone: b.telefone, whatsapp: b.whatsapp, email: b.email, horario: b.horario, observacao: b.observacao, nomeCliente: b.nomeCliente, modoLigacao: b.modoLigacao, horariosPadrao: b.horariosPadrao, ultimoHorarioEspecial: b.ultimoHorarioEspecial, servicoPadraoId: b.servicoPadraoId }).filter(([, v]) => v !== undefined)),
    });

  app.post('/api/unidades', async (req, reply) => {
    exigeDirecao(req, 'Só a direção e a administração cadastram unidades.');
    const b = validar(UnidadeCorpo, req.body);
    const empresaId = empresaDe(req);
    const atuais = await unidades(empresaId);
    if (atuais.length >= 50) throw erro(400, 'Limite de 50 unidades.');
    if (atuais.some((u) => normalizar(u.nome) === normalizar(b.nome))) throw erro(409, 'Já existe uma unidade com esse nome.');
    const id = idDeUnidade(b.nome, new Set([...atuais.map((u) => u.id), ...fixas]));
    const u = await o.armazem.salvarUnidade(empresaId, { id, nome: b.nome, ativa: b.ativa, ordem: atuais.length, dados: dadosUnidade(b), atualizadaPor: quem(req) });
    await mudou(empresaId);
    return reply.code(201).send(publicaUnidade(u));
  });

  app.patch('/api/unidades/:id', async (req) => {
    exigeDirecao(req, 'Só a direção e a administração mudam unidades.');
    const { id } = req.params as { id: string };
    const empresaId = empresaDe(req);
    const atuais = await unidades(empresaId);
    const atual = atuais.find((u) => u.id === id);
    if (!atual) throw erro(404, 'Unidade não encontrada.');
    const b = validar(UnidadeCorpo.partial(), req.body);
    if (b.nome && atuais.some((u) => u.id !== id && normalizar(u.nome) === normalizar(b.nome!))) throw erro(409, 'Já existe uma unidade com esse nome.');
    const ativa = b.ativa ?? atual.ativa;
    if (!ativa && !atuais.some((u) => u.id !== id && u.ativa)) throw erro(409, 'A empresa precisa ter pelo menos uma unidade ativa.');
    const u = await o.armazem.salvarUnidade(empresaId, {
      ...atual,
      nome: b.nome ?? atual.nome,
      ativa,
      dados: dadosUnidade({ ...b, nome: b.nome ?? atual.nome, ativa } as z.infer<typeof UnidadeCorpo>, atual),
      atualizadaPor: quem(req),
    });
    await mudou(empresaId);
    return publicaUnidade(u);
  });

  app.put('/api/unidades/ordem', async (req) => {
    exigeDirecao(req, 'Só a direção e a administração mudam unidades.');
    const { ids } = z.object({ ids: z.array(z.string().max(40)).max(50) }).parse(req.body ?? {});
    const empresaId = empresaDe(req);
    const atuais = await unidades(empresaId);
    const pos = new Map(ids.map((id, i) => [id, i]));
    for (const u of atuais) {
      const ordem = pos.get(u.id) ?? ids.length + u.ordem;
      if (ordem !== u.ordem) await o.armazem.salvarUnidade(empresaId, { ...u, ordem, atualizadaPor: quem(req) });
    }
    await mudou(empresaId);
    return { unidades: (await o.armazem.unidades(empresaId)).map(publicaUnidade) };
  });

  app.delete('/api/unidades/:id', async (req) => {
    exigeDirecao(req, 'Só a direção e a administração apagam unidades.');
    const { id } = req.params as { id: string };
    const empresaId = empresaDe(req);
    if (fixas.has(id) || (await o.emUso?.(empresaId, id))) throw erro(409, 'Esta unidade já tem conversas, pessoas ou números ligados a ela. Desative em vez de apagar.');
    await unidades(empresaId);
    if (!(await o.armazem.apagarUnidade(empresaId, id))) throw erro(404, 'Unidade não encontrada.');
    await mudou(empresaId);
    return { ok: true };
  });

  // ------------------------------------------------------------ produtos e serviços
  const publicoProduto = (p: Produto) => ({ ...p, fotoEm: p.fotoEm ? p.fotoEm.getTime() : null });
  const ListaQ = z.object({ tipo: z.enum(TIPOS_PRODUTO).optional(), ativos: z.enum(['1', '0']).optional(), busca: z.string().max(80).optional() });
  app.get('/api/produtos', async (req) => {
    const q = validar(ListaQ, req.query);
    const todos = await o.armazem.produtos(empresaDe(req));
    const b = normalizar(q.busca);
    const produtos = todos
      .filter((p) => !q.tipo || p.tipo === q.tipo)
      .filter((p) => q.ativos !== '1' || p.ativo)
      .filter((p) => !b || normalizar(`${p.nome} ${p.categoria ?? ''} ${p.codigo}`).includes(b));
    const categorias = [...new Set(todos.map((p) => p.categoria).filter((c): c is string => Boolean(c)))].sort((a, c) => a.localeCompare(c, 'pt-BR'));
    return { produtos: produtos.map(publicoProduto), categorias, podeEditar: ehGestao(req) };
  });
  const produtoDe = async (req: FastifyRequest) => {
    const p = await o.armazem.produto(empresaDe(req), (req.params as { id: string }).id);
    if (!p) throw erro(404, 'Produto ou serviço não encontrado.');
    return p;
  };
  app.get('/api/produtos/:id', async (req) => publicoProduto(await produtoDe(req)));

  const comDuplicado = async <R>(fn: () => Promise<R>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroDuplicado) throw erro(409, e.message);
      throw e;
    }
  };
  app.post('/api/produtos', async (req, reply) => {
    exigeGestao(req);
    const b = validar(ProdutoNovo, req.body);
    const empresaId = empresaDe(req);
    if ((await o.armazem.produtos(empresaId)).length >= 5000) throw erro(400, 'Limite de 5.000 produtos e serviços.');
    const p = await comDuplicado(() => o.armazem.criarProduto(empresaId, { ...b, duracaoMin: b.tipo === 'servico' ? b.duracaoMin : null }, quem(req)));
    return reply.code(201).send(publicoProduto(p));
  });
  app.patch('/api/produtos/:id', async (req) => {
    exigeGestao(req);
    const atual = await produtoDe(req);
    const b = validar(ProdutoEdicao, req.body);
    const tipo = b.tipo ?? atual.tipo;
    const mudanca: Partial<NovoProduto> = { ...b, ...(tipo === 'produto' ? { duracaoMin: null } : {}) };
    const p = await comDuplicado(() => o.armazem.alterarProduto(empresaDe(req), atual.id, mudanca, quem(req)));
    if (!p) throw erro(404, 'Produto ou serviço não encontrado.');
    return publicoProduto(p);
  });
  app.delete('/api/produtos/:id', async (req) => {
    exigeGestao(req);
    const p = await produtoDe(req);
    await o.armazem.apagarProduto(empresaDe(req), p.id);
    return { ok: true };
  });

  app.get('/api/produtos/:id/foto', async (req, reply) => {
    const f = await o.armazem.fotoProduto(empresaDe(req), (req.params as { id: string }).id);
    if (!f) return reply.header('cache-control', 'no-store').code(204).send();
    return enviarArquivo(reply, f);
  });
  app.put('/api/produtos/:id/foto', { bodyLimit: CORPO_FOTO + 1024 }, async (req) => {
    exigeGestao(req);
    const p = await produtoDe(req);
    await o.armazem.gravarFotoProduto(empresaDe(req), p.id, imagem(req.body));
    return { ok: true };
  });
  app.delete('/api/produtos/:id/foto', async (req) => {
    exigeGestao(req);
    const p = await produtoDe(req);
    await o.armazem.gravarFotoProduto(empresaDe(req), p.id, null);
    return { ok: true };
  });

  /** Copia a tabela de preços do Comercial (só o que ainda não existe com o mesmo nome). */
  async function importar(empresaId: string, por: string): Promise<number> {
    const precos = (await o.precosComercial?.(empresaId).catch(() => [])) ?? [];
    const existentes = new Set((await o.armazem.produtos(empresaId)).map((p) => normalizar(p.nome)));
    let n = 0;
    for (const p of precos) {
      const nome = p.servico.trim().slice(0, 80);
      if (nome.length < 2 || existentes.has(normalizar(nome))) continue;
      existentes.add(normalizar(nome));
      await o.armazem
        .criarProduto(empresaId, { nome, tipo: 'servico', categoria: null, preco: Math.round(p.valor * 100) / 100, duracaoMin: null, descricao: '', codigo: '', ativo: true, origem: 'comercial' }, por)
        .then(() => n++)
        .catch((e) => {
          if (!(e instanceof ErroDuplicado)) throw e;
        });
    }
    return n;
  }
  app.post('/api/produtos/importar-comercial', async (req) => {
    exigeGestao(req);
    const empresaId = empresaDe(req);
    const importados = await importar(empresaId, quem(req));
    await o.armazem.marcarImportacao(empresaId);
    return { importados };
  });
  // Primeira vez de cada empresa: copia sozinho (uma vez só; apagar depois não traz de volta).
  const jaImportou = new Set<string>();
  app.addHook('onRequest', async (req) => {
    if (req.method !== 'GET' || !req.url.startsWith('/api/produtos')) return;
    const empresaId = empresaDe(req);
    if (jaImportou.has(empresaId)) return;
    jaImportou.add(empresaId);
    await garantirEmpresa(empresaId);
    if (await o.armazem.marcarImportacao(empresaId).catch(() => false)) await importar(empresaId, 'Sintonia (cópia do Comercial)').catch(() => 0);
  });

  // ------------------------------------------------------------ tabelas de preço
  app.get('/api/tabelas-preco', async (req) => ({ tabelas: await o.armazem.tabelas(empresaDe(req)), podeEditar: ehGestao(req) }));
  const conferirUnidade = async (empresaId: string, id: string | null) => {
    if (id && !(await unidades(empresaId)).some((u) => u.id === id)) throw erro(400, 'Essa unidade não existe.');
  };
  app.post('/api/tabelas-preco', async (req, reply) => {
    exigeGestao(req);
    const b = validar(TabelaCorpo, req.body);
    const empresaId = empresaDe(req);
    await conferirUnidade(empresaId, b.unidade);
    if ((await o.armazem.tabelas(empresaId)).length >= 100) throw erro(400, 'Limite de 100 tabelas de preço.');
    return reply.code(201).send(await o.armazem.criarTabela(empresaId, b, quem(req)));
  });
  app.put('/api/tabelas-preco/:id', async (req) => {
    exigeGestao(req);
    const b = validar(TabelaCorpo, req.body);
    const empresaId = empresaDe(req);
    await conferirUnidade(empresaId, b.unidade);
    const t = await o.armazem.alterarTabela(empresaId, (req.params as { id: string }).id, b, quem(req));
    if (!t) throw erro(404, 'Tabela de preço não encontrada.');
    return t;
  });
  app.delete('/api/tabelas-preco/:id', async (req) => {
    exigeGestao(req);
    if (!(await o.armazem.apagarTabela(empresaDe(req), (req.params as { id: string }).id))) throw erro(404, 'Tabela de preço não encontrada.');
    return { ok: true };
  });

  // ------------------------------------------------------------ documentos
  const podeVerDoc = (req: FastifyRequest, d: Documento) => d.visivel === 'equipe' || ehGestao(req);
  app.get('/api/documentos', async (req) => ({
    documentos: (await o.armazem.documentos(empresaDe(req))).filter((d) => podeVerDoc(req, d)),
    tipos: TIPOS_DOCUMENTO,
    limite: LIMITE_DOC,
    podeEditar: ehGestao(req),
  }));
  app.post('/api/documentos', { bodyLimit: CORPO_DOC + 4096 }, async (req, reply) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração enviam documentos.');
    const b = validar(DocumentoNovo, req.body);
    const b64 = semPrefixoDataUrl(b.base64);
    if (tamanhoBase64(b64) > LIMITE_DOC) throw erro(413, `Arquivo grande demais (até ${Math.round(LIMITE_DOC / 1024 / 1024)} MB).`);
    const conteudo = Buffer.from(b64, 'base64');
    if (!conteudo.length) throw erro(400, 'O arquivo veio vazio.');
    if (!arquivoConfere(conteudo, b.mimetype)) throw erro(400, 'O arquivo não confere com o tipo informado.');
    const empresaId = empresaDe(req);
    if ((await o.armazem.documentos(empresaId)).length >= 500) throw erro(400, 'Limite de 500 documentos. Apague os que não usa mais.');
    const d = await o.armazem.criarDocumento(empresaId, { nome: b.nome, categoria: b.categoria, descricao: b.descricao, visivel: b.visivel, mimetype: b.mimetype, conteudo, enviadoPor: quem(req) });
    return reply.code(201).send(d);
  });
  app.patch('/api/documentos/:id', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração mudam documentos.');
    const d = await o.armazem.alterarDocumento(empresaDe(req), (req.params as { id: string }).id, validar(DocumentoEdicao, req.body));
    if (!d) throw erro(404, 'Documento não encontrado.');
    return d;
  });
  app.delete('/api/documentos/:id', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração apagam documentos.');
    if (!(await o.armazem.apagarDocumento(empresaDe(req), (req.params as { id: string }).id))) throw erro(404, 'Documento não encontrado.');
    return { ok: true };
  });
  app.get('/api/documentos/:id/arquivo', async (req, reply) => {
    const a = await o.armazem.arquivoDocumento(empresaDe(req), (req.params as { id: string }).id);
    // "Só gestão" para quem é da equipe: 404 (nem conta que existe).
    if (!a || !podeVerDoc(req, a.doc)) throw erro(404, 'Documento não encontrado.');
    const baixar = (req.query as { baixar?: string })?.baixar === '1' || !EXIBIVEIS.has(a.tipo);
    const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[a.tipo] ?? '';
    const nome = /\.[a-z0-9]{2,5}$/i.test(a.doc.nome) ? a.doc.nome : a.doc.nome + ext;
    return reply
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .header('content-disposition', `${baixar ? 'attachment' : 'inline'}; ${nomeParaCabecalho(nome)}`)
      .type(a.tipo)
      .send(a.conteudo);
  });

  return {
    async carregar(empresaId: string) {
      const l = await unidades(empresaId);
      await sincronizar(empresaId, l);
      return l;
    },
  };
}

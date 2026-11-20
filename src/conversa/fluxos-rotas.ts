import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehGestor, podeVer, type Quem } from '../auth/acesso.js';
import { nomeParaCabecalho, semPrefixoDataUrl, tamanhoBase64, tipoPeloMimetype } from '../midia.js';
import {
  DadosFluxo,
  envioParaTela,
  ErroAtalhoFluxoRepetido,
  ErroFluxoAndando,
  LIMITE_MIDIA_FLUXO,
  MAX_PASSOS,
  type ArmazemFluxos,
  type Fluxo,
  type MotorFluxos,
} from './fluxos.js';

/**
 * Rotas dos fluxos de mensagens:
 * - GET/POST /api/fluxos-mensagens, PATCH/DELETE /api/fluxos-mensagens/:id   (editor, em Respostas rápidas › Fluxos)
 * - POST /api/fluxos-mensagens/midias, GET /api/fluxos-mensagens/midias/:id  (arquivos dos passos, até 16 MB)
 * - POST /api/conversas/:id/fluxos                     dispara um fluxo na conversa
 * - GET  /api/conversas/:id/fluxos/andamento           a faixa "Enviando fluxo 2 de 5"
 * - POST /api/conversas/:id/fluxos/:envioId/parar      cancela os passos que faltam
 * Mesma regra das respostas rápidas: os da empresa a gestão cuida; os pessoais só quem criou vê.
 */
export interface OpcoesFluxos {
  repo: Repositorio;
  empresaId: string;
  armazem: ArmazemFluxos;
  motor: MotorFluxos;
  /** Anti-duplicidade da conversa (outra pessoa respondendo agora → 409). */
  conferirVez?: (conversaId: string, quem: Quem) => Promise<void>;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });
/** base64 cresce 1/3: o corpo cabe o arquivo de 16 MB com folga. */
const LIMITE_CORPO = Math.ceil((LIMITE_MIDIA_FLUXO * 4) / 3) + 64 * 1024;
const EXIBIVEIS = /^(image\/(jpeg|png|gif|webp)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;

const NovoArquivo = z.object({
  base64: z.string().min(1),
  mimetype: z
    .string()
    .trim()
    .max(150)
    .regex(/^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/, 'Tipo de arquivo inválido'),
  nomeArquivo: z.string().trim().min(1).max(200).optional(),
});

export function registrarFluxos(app: FastifyInstance, o: OpcoesFluxos): void {
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const daTela = (req: FastifyRequest) => (f: Fluxo) => ({
    ...f,
    pessoal: f.usuarioId !== null,
    podeEditar: !req.usuario || (f.usuarioId === null ? ehGestor(req.usuario) : f.usuarioId === req.usuario.id),
  });
  const NovoFluxo = DadosFluxo.extend({ pessoal: z.boolean().optional() });
  const AlteraFluxo = DadosFluxo.partial();

  /** O fluxo que a pessoa pode USAR (os da empresa e os pessoais dela). */
  async function fluxoVisivel(req: FastifyRequest, id: string): Promise<Fluxo> {
    const f = await o.armazem.obter(o.empresaId, id);
    const u = req.usuario;
    if (!f || (u && f.usuarioId !== null && f.usuarioId !== u.id)) throw erro('Fluxo não encontrado', 404);
    return f;
  }
  async function fluxoEditavel(req: FastifyRequest): Promise<Fluxo> {
    const f = await fluxoVisivel(req, (req.params as { id: string }).id);
    if (req.usuario && f.usuarioId === null && !ehGestor(req.usuario)) throw erro('Só a gestão muda os fluxos da empresa. Crie um pessoal com o seu jeito.', 403);
    return f;
  }
  const repetido = (e: unknown) => {
    if (e instanceof ErroAtalhoFluxoRepetido) throw erro(e.message, 409);
    throw e;
  };
  /** Cada arquivo citado nos passos precisa existir e ser desta empresa. */
  async function conferirArquivos(passos: { midiaId?: string }[] | undefined) {
    for (const p of passos ?? []) {
      if (p.midiaId && !(await o.armazem.midia(o.empresaId, p.midiaId))) throw erro('Um arquivo do fluxo não foi encontrado. Envie de novo.', 400);
    }
  }

  app.get('/api/fluxos-mensagens', async (req) => ({
    fluxos: (await o.armazem.listar(o.empresaId, req.usuario?.id ?? null)).map(daTela(req)),
    limites: { arquivoMb: LIMITE_MIDIA_FLUXO / 1024 / 1024, passos: MAX_PASSOS },
  }));

  app.post('/api/fluxos-mensagens', async (req, reply) => {
    const b = NovoFluxo.parse(req.body);
    const u = req.usuario;
    if (u && !ehGestor(u) && b.pessoal === false) throw erro('Só a gestão cria fluxos da empresa. O seu fica pessoal.', 403);
    const pessoal = u ? (ehGestor(u) ? b.pessoal === true : true) : false;
    await conferirArquivos(b.passos);
    const { pessoal: _p, ...dados } = b;
    const f = await o.armazem.criar(o.empresaId, { ...dados, usuarioId: pessoal ? u!.id : null, criadaPor: quem(req) }).catch(repetido);
    return reply.code(201).send(daTela(req)(f));
  });

  app.patch('/api/fluxos-mensagens/:id', async (req) => {
    const b = AlteraFluxo.parse(req.body);
    const f = await fluxoEditavel(req);
    await conferirArquivos(b.passos);
    const novo = await o.armazem.alterar(o.empresaId, f.id, b, quem(req)).catch(repetido);
    if (!novo) throw erro('Fluxo não encontrado', 404);
    return daTela(req)(novo);
  });

  app.delete('/api/fluxos-mensagens/:id', async (req) => {
    const f = await fluxoEditavel(req);
    await o.armazem.apagar(o.empresaId, f.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ arquivos dos passos
  app.post('/api/fluxos-mensagens/midias', { bodyLimit: LIMITE_CORPO }, async (req, reply) => {
    const b = NovoArquivo.parse(req.body);
    const base64 = semPrefixoDataUrl(b.base64).replace(/\s/g, '');
    const tamanho = tamanhoBase64(base64);
    if (tamanho > LIMITE_MIDIA_FLUXO) throw erro(`Arquivo grande demais: o limite é ${LIMITE_MIDIA_FLUXO / 1024 / 1024} MB.`, 413);
    if (tamanho === 0) throw erro('Arquivo vazio.', 400);
    const conteudo = Buffer.from(base64, 'base64');
    const id = randomUUID();
    await o.armazem.guardarMidia({ id, empresaId: o.empresaId, nome: b.nomeArquivo ?? null, mimetype: b.mimetype, tamanho: conteudo.length, conteudo });
    return reply.code(201).send({ id, nome: b.nomeArquivo ?? null, mimetype: b.mimetype, tamanho: conteudo.length, tipo: tipoPeloMimetype(b.mimetype) });
  });

  app.get('/api/fluxos-mensagens/midias/:id', async (req, reply) => {
    const m = await o.armazem.midia(o.empresaId, (req.params as { id: string }).id);
    if (!m) return reply.code(404).send({ erro: 'Arquivo não encontrado' });
    const base = m.mimetype.split(';')[0]!.trim().toLowerCase();
    const exibe = EXIBIVEIS.test(base);
    return reply
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
      .header('content-disposition', `${exibe ? 'inline' : 'attachment'}; ${nomeParaCabecalho(m.nome ?? 'arquivo')}`)
      .type(exibe ? m.mimetype : 'application/octet-stream')
      .send(m.conteudo);
  });

  // ------------------------------------------------------------ na conversa
  async function conversaVisivel(req: FastifyRequest): Promise<Conversa> {
    const c = await o.repo.buscarConversa((req.params as { id: string }).id).catch(() => undefined);
    if (!c || c.empresaId !== o.empresaId || (req.usuario && !podeVer(req.usuario, c))) throw erro('Conversa não encontrada', 404);
    return c;
  }

  app.post('/api/conversas/:id/fluxos', async (req, reply) => {
    const b = z.object({ fluxoId: z.string().uuid('Escolha um fluxo.') }).parse(req.body);
    const c = await conversaVisivel(req);
    const f = await fluxoVisivel(req, b.fluxoId);
    if (req.usuario && o.conferirVez) await o.conferirVez(c.id, req.usuario);
    try {
      const e = await o.motor.iniciar(o.empresaId, c.id, f, { nome: quem(req), id: req.usuario?.id ?? null });
      return reply.code(201).send(envioParaTela(e));
    } catch (x) {
      if (x instanceof ErroFluxoAndando) throw erro(x.message, 409);
      throw x;
    }
  });

  app.get('/api/conversas/:id/fluxos/andamento', async (req) => {
    const c = await conversaVisivel(req);
    const e = await o.armazem.envioDaConversa(o.empresaId, c.id);
    return { envio: e ? envioParaTela(e) : null };
  });

  app.post('/api/conversas/:id/fluxos/:envioId/parar', async (req) => {
    const c = await conversaVisivel(req);
    const e = await o.armazem.envio(o.empresaId, (req.params as { envioId: string }).envioId);
    if (!e || e.conversaId !== c.id) throw erro('Envio não encontrado', 404);
    const parado = await o.motor.parar(o.empresaId, e.id, quem(req));
    return { envio: parado ? envioParaTela(parado) : null };
  });
}

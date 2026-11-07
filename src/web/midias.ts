import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Quem } from '../auth/acesso.js';
import { z } from 'zod';
import type { Sintonia } from '../app/sintonia.js';
import type { Repositorio } from '../store/repositorio.js';
import { LIMITE_ENVIO, nomeParaCabecalho, semPrefixoDataUrl, tamanhoBase64, tipoPeloMimetype } from '../midia.js';

/**
 * Rotas de mídia das conversas (fotos, áudios, vídeos, documentos):
 * - GET  /api/conversas/:id/midias/:mensagemId          arquivo (aceita Range, para áudio e vídeo no iPhone)
 * - POST /api/conversas/:id/midias/:mensagemId/baixar   tenta baixar de novo o que falhou
 * - POST /api/conversas/:id/enviar-midia                a atendente envia foto, vídeo, documento ou nota de voz
 * Ficam em /api: exigem login como todo o resto.
 */
export interface DependenciasMidias {
  sintonia: Sintonia;
  repo: Repositorio;
  /** Baixador: avisado quando a equipe pede para tentar de novo. */
  midias?: { avisar(): void };
  agora?: () => Date;
  /** Permissões: só a conversa que a pessoa logada pode ver (outra dá 404). */
  conversaVisivel?: (req: FastifyRequest) => Promise<unknown>;
  /** Quem está agindo (vez de responder, dona da conversa). */
  quemDe?: (req: FastifyRequest) => Quem | undefined;
}

/** Tipos mostrados dentro da página. O resto vai como download (um HTML ou SVG mandado pela cliente nunca roda aqui). */
const EXIBIVEIS = /^(image\/(jpeg|png|gif|webp|heic|heif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;

/** Corpo do envio: o arquivo em base64 cabe no limite com folga (base64 cresce 1/3). */
const LIMITE_CORPO = Math.ceil((LIMITE_ENVIO * 4) / 3) + 64 * 1024;

const EnvioMidia = z.object({
  tipo: z.enum(['imagem', 'video', 'documento', 'audio']).optional(),
  base64: z.string().min(1),
  mimetype: z
    .string()
    .trim()
    .max(150)
    .regex(/^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/, 'Tipo de arquivo inválido'),
  nomeArquivo: z.string().trim().min(1).max(200).optional(),
  legenda: z.string().max(3000).optional(),
  duracaoSeg: z.number().min(0).max(4 * 3600).optional(),
  atendente: z.string().min(1).max(120).optional(),
});

export function registrarRotasMidia(app: FastifyInstance, d: DependenciasMidias): void {
  const agora = d.agora ?? (() => new Date());

  async function midiaDaConversa(conversaId: string, mensagemId: string) {
    const m = z.string().uuid().safeParse(mensagemId).success ? await d.repo.midia(mensagemId) : undefined;
    // A mídia precisa ser desta conversa: o endereço não serve para ler arquivo de outra.
    return m && m.conversaId === conversaId ? m : undefined;
  }

  app.get('/api/conversas/:id/midias/:mensagemId', async (req, reply) => {
    const { id, mensagemId } = req.params as { id: string; mensagemId: string };
    await d.conversaVisivel?.(req);
    const m = await midiaDaConversa(id, mensagemId);
    if (!m) return reply.code(404).header('cache-control', 'no-store').send({ erro: 'Arquivo não encontrado' });
    if (!m.conteudo) {
      const erro =
        m.anexo.situacao === 'grande' ? 'Arquivo grande demais para guardar' : m.anexo.situacao === 'pendente' ? 'Ainda baixando' : 'Não foi possível baixar';
      return reply.code(m.anexo.situacao === 'pendente' ? 409 : 404).header('cache-control', 'no-store').send({ erro, situacao: m.anexo.situacao });
    }

    const tipo = (m.anexo.mimetype ?? 'application/octet-stream').toLowerCase();
    const base = tipo.split(';')[0]!.trim();
    const baixar = (req.query as { baixar?: string }).baixar === '1' || !EXIBIVEIS.test(base);
    const nome = m.anexo.nomeArquivo ?? `${m.anexo.tipo}-${mensagemId.slice(0, 8)}${extensao(base)}`;
    reply
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
      .header('content-disposition', `${baixar ? 'attachment' : 'inline'}; ${nomeParaCabecalho(nome)}`)
      .header('accept-ranges', 'bytes')
      .type(EXIBIVEIS.test(base) ? tipo : 'application/octet-stream');

    // Pedaço do arquivo (o Safari só toca áudio e vídeo assim).
    const total = m.conteudo.length;
    const faixa = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (faixa && (faixa[1] || faixa[2])) {
      let inicio = faixa[1] ? Number(faixa[1]) : Math.max(0, total - Number(faixa[2]));
      let fim = faixa[1] && faixa[2] ? Number(faixa[2]) : total - 1;
      fim = Math.min(fim, total - 1);
      if (inicio > fim || inicio >= total) {
        return reply.code(416).header('content-range', `bytes */${total}`).send();
      }
      inicio = Math.max(0, inicio);
      return reply
        .code(206)
        .header('content-range', `bytes ${inicio}-${fim}/${total}`)
        .send(m.conteudo.subarray(inicio, fim + 1));
    }
    return reply.send(m.conteudo);
  });

  app.post('/api/conversas/:id/midias/:mensagemId/baixar', async (req, reply) => {
    const { id, mensagemId } = req.params as { id: string; mensagemId: string };
    await d.conversaVisivel?.(req);
    const m = await midiaDaConversa(id, mensagemId);
    if (!m) return reply.code(404).send({ erro: 'Arquivo não encontrado' });
    if (m.anexo.situacao === 'pronta') return { ok: true, situacao: 'pronta' };
    if (!(await d.repo.rebaixarMidia(mensagemId, agora()))) {
      return reply.code(409).send({ erro: m.anexo.situacao === 'grande' ? 'Arquivo grande demais para guardar' : 'Já está baixando' });
    }
    d.midias?.avisar();
    return { ok: true, situacao: 'pendente' };
  });

  app.post('/api/conversas/:id/enviar-midia', { bodyLimit: LIMITE_CORPO }, async (req, reply) => {
    await d.conversaVisivel?.(req);
    const b = EnvioMidia.parse(req.body);
    const base64 = semPrefixoDataUrl(b.base64);
    const tamanho = tamanhoBase64(base64);
    if (tamanho === 0) return reply.code(400).send({ erro: 'Arquivo vazio' });
    if (tamanho > LIMITE_ENVIO) {
      return reply.code(413).send({ erro: `Arquivo grande demais: o limite é ${LIMITE_ENVIO / 1024 / 1024} MB.` });
    }
    const mimetype = b.mimetype.toLowerCase();
    const pelo = tipoPeloMimetype(mimetype);
    const tipo = b.tipo ?? (pelo === 'figurinha' ? 'imagem' : pelo);
    const confere = { imagem: 'image/', video: 'video/', audio: 'audio/' } as const;
    if (tipo !== 'documento' && !mimetype.startsWith(confere[tipo])) {
      return reply.code(400).send({ erro: 'O tipo do arquivo não confere' });
    }
    const atendente = req.usuario?.nome ?? b.atendente;
    if (!atendente) return reply.code(400).send({ erro: 'Informe quem está enviando' });
    const nomeArquivo = b.nomeArquivo ?? (tipo === 'documento' ? `arquivo${extensao(mimetype.split(';')[0]!)}` : undefined);
    const r = await d.sintonia.equipeEnviouMidia(
      (req.params as { id: string }).id,
      { tipo, conteudo: Buffer.from(base64, 'base64'), mimetype, nomeArquivo, legenda: b.legenda, duracaoSeg: b.duracaoSeg === undefined ? undefined : Math.round(b.duracaoSeg) },
      atendente,
      d.quemDe?.(req),
    );
    return { ok: true, mensagemId: r.mensagemId };
  });
}

const EXTENSOES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};
const extensao = (mimetype: string) => EXTENSOES[mimetype] ?? '';

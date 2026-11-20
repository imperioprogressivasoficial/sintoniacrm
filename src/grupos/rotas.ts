import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, podeVer } from '../auth/acesso.js';
import type { Conversa } from '../domain.js';
import { LIMITE_ENVIO, nomeParaCabecalho, semPrefixoDataUrl, tamanhoBase64, tipoPeloMimetype } from '../midia.js';
import type { ArmazemGrupos, Grupo, MensagemGrupo } from './armazem.js';
import { erroGrupo, type Grupos } from './grupos.js';

/**
 * Rotas /api/grupos/... (Conversas de grupo). Registradas depois de criarServidor: valem o login e o tratamento
 * de erros de lá. Quem vê o grupo segue a regra das conversas: a unidade do número que recebe o grupo.
 */
export interface OpcoesRotasGrupos {
  grupos: Grupos;
  armazem: ArmazemGrupos;
  empresaId: string;
}

/** Tipos mostrados dentro da página; o resto vai como download. */
const EXIBIVEIS = /^(image\/(jpeg|png|gif|webp|heic|heif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;
const LIMITE_CORPO = Math.ceil((LIMITE_ENVIO * 4) / 3) + 64 * 1024;

const Envio = z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem').max(4096) });
const EnvioMidia = z.object({
  tipo: z.enum(['imagem', 'video', 'documento', 'audio']).optional(),
  base64: z.string().min(1),
  mimetype: z.string().trim().max(150).regex(/^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/, 'Tipo de arquivo inválido'),
  nomeArquivo: z.string().trim().min(1).max(200).optional(),
  legenda: z.string().max(3000).optional(),
  duracaoSeg: z.number().min(0).max(4 * 3600).optional(),
});
const Pagina = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(80),
  antes: z.string().datetime({ offset: true }).optional(),
});

/** Nome de quem mandou no grupo: o do perfil, senão o número. */
function quemMandou(m: MensagemGrupo): string {
  if (m.autor === 'equipe') return m.autorNome ?? 'Equipe';
  if (m.participanteNome) return m.participanteNome;
  if (m.participante) return `+${m.participante}`;
  return 'Participante';
}

const paraTelaMensagem = (m: MensagemGrupo) => ({
  id: m.id,
  autor: m.autor,
  nome: quemMandou(m),
  participante: m.participante,
  /** Chave estável para a cor do nome de quem mandou. */
  chave: m.participante ?? m.participanteJid ?? m.participanteNome ?? m.autorNome ?? '',
  texto: m.texto,
  em: m.em,
  anexo: m.anexo ? { tipo: m.anexo.tipo, mimetype: m.anexo.mimetype ?? null, nomeArquivo: m.anexo.nomeArquivo ?? null, legenda: m.anexo.legenda ?? null, duracaoSeg: m.anexo.duracaoSeg ?? null, voz: Boolean(m.anexo.voz) } : null,
});

const nomeDoGrupo = (g: Grupo) => g.nome ?? 'Grupo do WhatsApp';

export function registrarGrupos(app: FastifyInstance, o: OpcoesRotasGrupos): void {
  /** Mesma regra de quem vê as conversas: grupo não tem dona, então vale a unidade. Sem login, tudo. */
  const ve = (req: FastifyRequest) => (g: Grupo) =>
    g.empresaId === o.empresaId &&
    (!req.usuario || podeVer(req.usuario, { empresaId: g.empresaId, unidade: g.unidade, responsavelId: undefined } as unknown as Conversa));

  async function grupoVisivel(req: FastifyRequest): Promise<Grupo> {
    const id = (req.params as { id: string }).id;
    const g = await o.armazem.buscar(id);
    if (!g || !ve(req)(g)) throw erroGrupo('Grupo não encontrado.', 404);
    return g;
  }
  const quem = (req: FastifyRequest) => ({ id: req.usuario?.id, nome: req.usuario?.nome ?? 'Equipe' });

  app.get('/api/grupos', async (req) => {
    // Primeira vez (e depois de hora em hora): desliga o "ignorar grupos" da Evolution, por trás.
    o.grupos.prepararPorTras();
    const lista = (await o.armazem.listar(o.empresaId)).filter(ve(req));
    const ids = lista.map((g) => g.id);
    const [ultimas, naoLidas] = await Promise.all([
      o.armazem.ultimas(ids),
      req.usuario ? o.armazem.naoLidas(req.usuario.id, ids) : Promise.resolve(new Map<string, number>()),
    ]);
    for (const g of lista) o.grupos.talvezAtualizarInfo(g);
    const grupos = lista
      // Grupo sem nenhuma mensagem (veio só da lista da Evolution) aparece depois dos que têm conversa.
      .map((g) => {
        const u = ultimas.get(g.id);
        return {
          id: g.id,
          nome: nomeDoGrupo(g),
          unidade: g.unidade,
          participantes: g.participantes,
          temFoto: g.temFoto,
          ultimaEm: g.ultimaEm,
          naoLidas: naoLidas.get(g.id) ?? 0,
          ultima: u ? { autor: u.autor, nome: quemMandou(u), texto: u.texto.slice(0, 140), em: u.em, anexo: u.anexo?.tipo ?? null } : null,
        };
      });
    return { grupos, naoLidas: grupos.filter((g) => g.naoLidas > 0).length, podeSincronizar: !req.usuario || ehGestor(req.usuario) };
  });

  app.get('/api/grupos/:id/mensagens', async (req) => {
    const g = await grupoVisivel(req);
    const q = Pagina.parse(req.query);
    const mensagens = await o.armazem.mensagens(g.id, q.limite, q.antes ? new Date(q.antes) : undefined);
    return {
      grupo: { id: g.id, nome: nomeDoGrupo(g), participantes: g.participantes, temFoto: g.temFoto, unidade: g.unidade },
      mensagens: mensagens.map(paraTelaMensagem),
      mais: mensagens.length === q.limite,
    };
  });

  app.post('/api/grupos/:id/lida', async (req) => {
    const g = await grupoVisivel(req);
    if (req.usuario) await o.armazem.marcarLida(req.usuario.id, [g.id], new Date());
    return { ok: true };
  });

  app.post('/api/grupos/:id/enviar', async (req) => {
    const b = Envio.parse(req.body);
    const g = await grupoVisivel(req);
    const m = await o.grupos.enviarTexto(g, b.texto, quem(req));
    return { ok: true, mensagem: paraTelaMensagem(m) };
  });

  app.post('/api/grupos/:id/enviar-midia', { bodyLimit: LIMITE_CORPO }, async (req, reply) => {
    const g = await grupoVisivel(req);
    const b = EnvioMidia.parse(req.body);
    const base64 = semPrefixoDataUrl(b.base64);
    const tamanho = tamanhoBase64(base64);
    if (tamanho === 0) return reply.code(400).send({ erro: 'Arquivo vazio' });
    if (tamanho > LIMITE_ENVIO) return reply.code(413).send({ erro: `Arquivo grande demais: o limite é ${LIMITE_ENVIO / 1024 / 1024} MB.` });
    const mimetype = b.mimetype.toLowerCase();
    const pelo = tipoPeloMimetype(mimetype);
    const tipo = b.tipo ?? (pelo === 'figurinha' ? 'imagem' : pelo);
    const confere = { imagem: 'image/', video: 'video/', audio: 'audio/' } as const;
    if (tipo !== 'documento' && !mimetype.startsWith(confere[tipo])) return reply.code(400).send({ erro: 'O tipo do arquivo não confere' });
    const m = await o.grupos.enviarMidia(
      g,
      { tipo, conteudo: Buffer.from(base64, 'base64'), mimetype, nomeArquivo: b.nomeArquivo ?? (tipo === 'documento' ? 'arquivo' : undefined), legenda: b.legenda },
      quem(req),
    );
    return { ok: true, mensagem: paraTelaMensagem(m) };
  });

  app.get('/api/grupos/:id/foto', async (req, reply) => {
    const g = await grupoVisivel(req).catch(() => undefined);
    const foto = g?.temFoto ? await o.armazem.foto(g.id) : undefined;
    if (!foto) return reply.header('cache-control', 'no-store').code(204).send();
    return reply.header('cache-control', 'private, max-age=3600').header('x-content-type-options', 'nosniff').type(foto.tipo).send(foto.conteudo);
  });

  app.get('/api/grupos/:id/midias/:mensagemId', async (req, reply) => {
    const g = await grupoVisivel(req);
    const m = await o.armazem.mensagem((req.params as { mensagemId: string }).mensagemId);
    // O arquivo precisa ser deste grupo: o endereço não serve para ler arquivo de outro.
    if (!m || m.grupoId !== g.id || !m.anexo) return reply.code(404).header('cache-control', 'no-store').send({ erro: 'Arquivo não encontrado' });
    const conteudo = await o.grupos.midia(m, g).catch(() => undefined);
    if (!conteudo) return reply.code(404).header('cache-control', 'no-store').send({ erro: 'Não foi possível baixar o arquivo' });
    const tipo = (m.anexo.mimetype ?? 'application/octet-stream').toLowerCase();
    const base = tipo.split(';')[0]!.trim();
    const baixar = (req.query as { baixar?: string }).baixar === '1' || !EXIBIVEIS.test(base);
    const nome = m.anexo.nomeArquivo ?? `${m.anexo.tipo}-${m.id.slice(0, 8)}`;
    reply
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
      .header('content-disposition', `${baixar ? 'attachment' : 'inline'}; ${nomeParaCabecalho(nome)}`)
      .header('accept-ranges', 'bytes')
      .type(EXIBIVEIS.test(base) ? tipo : 'application/octet-stream');
    const total = conteudo.length;
    const faixa = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (faixa && (faixa[1] || faixa[2])) {
      const inicio = Math.max(0, faixa[1] ? Number(faixa[1]) : total - Number(faixa[2]));
      const fim = Math.min(faixa[1] && faixa[2] ? Number(faixa[2]) : total - 1, total - 1);
      if (inicio > fim || inicio >= total) return reply.code(416).header('content-range', `bytes */${total}`).send();
      return reply.code(206).header('content-range', `bytes ${inicio}-${fim}/${total}`).send(conteudo.subarray(inicio, fim + 1));
    }
    return reply.send(conteudo);
  });

  // Puxa a lista de grupos e as mensagens recentes da Evolution (e desliga o "ignorar grupos"). Só a gestão.
  app.post('/api/grupos/sincronizar', async (req) => {
    if (req.usuario && !ehGestor(req.usuario)) throw erroGrupo('Só a gerência sincroniza os grupos.', 403);
    return o.grupos.sincronizar();
  });
}

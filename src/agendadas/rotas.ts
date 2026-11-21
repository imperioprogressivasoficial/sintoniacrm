import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehGestor, podeVer, type Quem } from '../auth/acesso.js';
import { LIMITE_ENVIO, nomeParaCabecalho } from '../midia.js';
import {
  agendadaParaTela,
  anexoDe,
  conferirHorario,
  EntradaAgendada,
  ErroNaoEditavel,
  instanteDe,
  SITUACOES_AGENDADA,
  type ArmazemAgendadas,
  type MensagemAgendada,
  type MotorAgendadas,
  type SituacaoAgendada,
} from './agendadas.js';

/**
 * msg-agendada: rotas das mensagens agendadas.
 * - GET    /api/conversas/:id/agendadas                 as da conversa (balões "Agendada para…"); ?todas=1 inclui enviadas e canceladas
 * - POST   /api/conversas/:id/agendadas                 agenda (texto e/ou anexo, dia + hora da empresa)
 * - PATCH  /api/conversas/:id/agendadas/:agId           muda texto, horário ou anexo (o que ainda não saiu)
 * - POST   /api/conversas/:id/agendadas/:agId/cancelar  cancela (DELETE também cancela)
 * - POST   /api/conversas/:id/agendadas/:agId/enviar    envia agora
 * - GET    /api/conversas/:id/agendadas/:agId/anexo     o arquivo anexado
 * - GET    /api/agendadas?quem=minhas|todas&situacao=…  lista geral (Atendimento › Mensagens agendadas)
 * Quem vê a conversa vê o que está agendado nela. Mudar, cancelar e enviar agora: quem agendou, ou a gestão que vê a conversa.
 */
export interface OpcoesRotasAgendadas {
  repo: Repositorio;
  empresaId: string;
  armazem: ArmazemAgendadas;
  motor: MotorAgendadas;
  agora?: () => Date;
  /** Anti-duplicidade da conversa (outra pessoa respondendo agora → 409) no "Enviar agora". */
  conferirVez?: (conversaId: string, quem: Quem) => Promise<void>;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });
const LIMITE_CORPO = Math.ceil((LIMITE_ENVIO * 4) / 3) + 64 * 1024;
const EXIBIVEIS = /^(image\/(jpeg|png|gif|webp)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;
const PENDENTES: SituacaoAgendada[] = ['agendada', 'enviando', 'falhou'];

const FiltroLista = z.object({
  quem: z.enum(['minhas', 'todas']).default('minhas'),
  situacao: z.enum(['pendentes', 'todas', ...SITUACOES_AGENDADA]).default('pendentes'),
});

export function registrarAgendadas(app: FastifyInstance, o: OpcoesRotasAgendadas): void {
  const agora = o.agora ?? (() => new Date());
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const podeEditar = (req: FastifyRequest, m: MensagemAgendada, c: Conversa) => {
    const u = req.usuario;
    if (!u) return true;
    return m.criadoPorId === u.id || (ehGestor(u) && podeVer(u, c));
  };
  const daTela = (req: FastifyRequest, c: Conversa) => (m: MensagemAgendada) => agendadaParaTela(m, podeEditar(req, m, c));
  const naoEditavel = (x: unknown): never => {
    if (x instanceof ErroNaoEditavel) throw erro(x.message, 409);
    throw x;
  };

  async function conversaVisivel(req: FastifyRequest): Promise<Conversa> {
    const c = await o.repo.buscarConversa((req.params as { id: string }).id).catch(() => undefined);
    if (!c || c.empresaId !== o.empresaId || (req.usuario && !podeVer(req.usuario, c))) throw erro('Conversa não encontrada', 404);
    return c;
  }
  /** A agendada desta conversa, que esta pessoa pode mudar. */
  async function agendadaEditavel(req: FastifyRequest): Promise<{ c: Conversa; m: MensagemAgendada }> {
    const c = await conversaVisivel(req);
    const m = await o.armazem.obter(o.empresaId, (req.params as { agId: string }).agId);
    if (!m || m.conversaId !== c.id) throw erro('Mensagem agendada não encontrada', 404);
    if (!podeEditar(req, m, c)) throw erro('Só quem agendou (ou a gestão) pode mudar esta mensagem.', 403);
    return { c, m };
  }

  app.get('/api/conversas/:id/agendadas', async (req) => {
    const c = await conversaVisivel(req);
    const todas = (req.query as { todas?: string }).todas === '1';
    const lista = await o.armazem.listar(o.empresaId, { conversaId: c.id, ...(todas ? {} : { situacoes: PENDENTES }) });
    return { agendadas: lista.map(daTela(req, c)) };
  });

  app.post('/api/conversas/:id/agendadas', { bodyLimit: LIMITE_CORPO }, async (req, reply) => {
    const b = EntradaAgendada.parse(req.body);
    const c = await conversaVisivel(req);
    const texto = (b.texto ?? '').trim();
    if (!texto && !b.anexo) throw erro('Escreva a mensagem ou anexe um arquivo.', 400);
    const quando = instanteDe(b);
    if (!quando) throw erro('Escolha o dia e a hora do envio.', 400);
    const t = agora();
    conferirHorario(quando, t);
    const m = await o.armazem.criar({
      empresaId: o.empresaId,
      conversaId: c.id,
      texto,
      anexo: b.anexo ? anexoDe(b.anexo) : null,
      enviarEm: quando,
      criadoPor: quem(req),
      criadoPorId: req.usuario?.id ?? null,
      agora: t,
    });
    return reply.code(201).send(daTela(req, c)(m));
  });

  app.patch('/api/conversas/:id/agendadas/:agId', { bodyLimit: LIMITE_CORPO }, async (req) => {
    const b = EntradaAgendada.parse(req.body);
    const { c, m } = await agendadaEditavel(req);
    const t = agora();
    const quando = instanteDe(b);
    if (quando) conferirHorario(quando, t);
    // "falhou" sem horário novo: volta a valer o horário antigo só se ainda não passou.
    if (!quando && m.situacao === 'falhou' && m.enviarEm.getTime() <= t.getTime()) throw erro('Escolha um horário novo (o anterior já passou) ou use "Enviar agora".', 400);
    const texto = b.texto === undefined ? undefined : b.texto.trim();
    const anexo = b.anexo ? anexoDe(b.anexo) : b.removerAnexo ? null : undefined;
    const ficaSemNada = (texto ?? m.texto).trim() === '' && (anexo === null || (anexo === undefined && !m.anexo));
    if (ficaSemNada) throw erro('Escreva a mensagem ou anexe um arquivo.', 400);
    const novo = await o.armazem.alterar(o.empresaId, m.id, { ...(texto !== undefined ? { texto } : {}), ...(quando ? { enviarEm: quando } : {}), ...(anexo !== undefined ? { anexo } : {}) }, t).catch(naoEditavel);
    if (!novo) throw erro('Mensagem agendada não encontrada', 404);
    return daTela(req, c)(novo);
  });

  const cancelar = async (req: FastifyRequest) => {
    const { c, m } = await agendadaEditavel(req);
    const r = await o.armazem.cancelar(o.empresaId, m.id, quem(req), agora()).catch(naoEditavel);
    if (!r) throw erro('Mensagem agendada não encontrada', 404);
    return daTela(req, c)(r);
  };
  app.post('/api/conversas/:id/agendadas/:agId/cancelar', cancelar);
  app.delete('/api/conversas/:id/agendadas/:agId', cancelar);

  app.post('/api/conversas/:id/agendadas/:agId/enviar', async (req) => {
    const { c, m } = await agendadaEditavel(req);
    if (req.usuario && o.conferirVez) await o.conferirVez(c.id, req.usuario);
    const r = await o.motor.enviarAgora(o.empresaId, m.id).catch(naoEditavel);
    if (!r) throw erro('Mensagem agendada não encontrada', 404);
    if (r.situacao === 'falhou') throw erro(r.erro || 'Não foi enviada.', 502);
    return daTela(req, c)(r);
  });

  app.get('/api/conversas/:id/agendadas/:agId/anexo', async (req, reply) => {
    const c = await conversaVisivel(req);
    const m = await o.armazem.obter(o.empresaId, (req.params as { agId: string }).agId);
    if (!m || m.conversaId !== c.id || !m.anexo) return reply.code(404).send({ erro: 'Arquivo não encontrado' });
    const conteudo = await o.armazem.conteudoAnexo(o.empresaId, m.id);
    if (!conteudo) return reply.code(404).send({ erro: 'Arquivo não encontrado' });
    const base = m.anexo.mimetype.split(';')[0]!.trim().toLowerCase();
    const exibe = EXIBIVEIS.test(base);
    return reply
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
      .header('content-disposition', `${exibe ? 'inline' : 'attachment'}; ${nomeParaCabecalho(m.anexo.nome ?? 'arquivo')}`)
      .type(exibe ? m.anexo.mimetype : 'application/octet-stream')
      .send(conteudo);
  });

  // ------------------------------------------------------------ lista geral (gestão e "as minhas")
  app.get('/api/agendadas', async (req) => {
    const f = FiltroLista.parse(req.query);
    const u = req.usuario;
    const situacoes = f.situacao === 'pendentes' ? PENDENTES : f.situacao === 'todas' ? undefined : [f.situacao];
    const lista = await o.armazem.listar(o.empresaId, {
      ...(f.quem === 'minhas' && u ? { criadoPorId: u.id } : {}),
      ...(situacoes ? { situacoes } : {}),
      limite: 300,
    });
    // Só o que está em conversas que a pessoa vê (mesma regra da lista de conversas).
    const conversas = new Map<string, Conversa | undefined>();
    const itens = [];
    for (const m of lista) {
      if (!conversas.has(m.conversaId)) conversas.set(m.conversaId, await o.repo.buscarConversa(m.conversaId).catch(() => undefined));
      const c = conversas.get(m.conversaId);
      if (!c || c.empresaId !== o.empresaId || (u && !podeVer(u, c))) continue;
      itens.push({ ...daTela(req, c)(m), conversa: { id: c.id, nome: c.nome ?? null, telefone: c.telefone, unidade: c.unidade } });
    }
    // Enviadas e canceladas: as mais recentes primeiro; pendentes: a próxima primeiro.
    if (f.situacao === 'enviada' || f.situacao === 'cancelada') itens.reverse();
    const minhasPendentes = u
      ? (await o.armazem.listar(o.empresaId, { criadoPorId: u.id, situacoes: PENDENTES, limite: 300 })).length
      : itens.filter((i) => PENDENTES.includes(i.situacao)).length;
    return { agendadas: itens, minhasPendentes };
  });
}

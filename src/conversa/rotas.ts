import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa, ModoAtendimento, UnidadeId } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Sintonia } from '../app/sintonia.js';
import type { ClienteClaude } from '../ai/agente.js';
import { ehGestor, escopoDe, podeVer, veTudo } from '../auth/acesso.js';
import { normalizarCelular } from '../util/telefone.js';
import { DadosResposta, ErroAtalhoRepetido, type ArmazemRespostas, type RespostaRapida } from './respostas.js';
import { ErroTranscricao, type ArmazemTranscricoes, type Transcritor } from './transcricao.js';
import { ACOES_IA, ajudarComIa, ErroAssistente } from './assistente.js';
import { relatorioDaConversa } from './relatorio.js';
import { conversarComIa, LIMITE_TEXTO } from './chat-ia.js';
import { iaHoje } from '../painel/ia-hoje.js';
import { agendamentosEntre } from '../agenda/agenda-dia.js';
import { bahia, DIA, partesBahia } from '../util/tempo.js';

/**
 * Recursos da tela de conversa:
 * - respostas rápidas (/api/respostas-rapidas);
 * - ajuda da IA no topo da conversa (/api/conversas/:id/ia);
 * - transcrição dos áudios (/api/conversas/:id/transcricoes, .../midias/:mensagemId/transcrever);
 * - nova conversa por número (/api/conversas/nova);
 * - relatório do cliente na ficha (/api/conversas/:id/relatorio);
 * - chat "Ajuda da IA" da bolinha de acesso rápido (/api/ia/chat).
 * Registradas depois de criarServidor (src/index.ts): valem o login e o tratamento de erros de lá.
 * Sem login (teste local) tudo fica liberado, como no resto da API.
 */
export interface OpcoesConversa {
  repo: Repositorio;
  sintonia: Pick<Sintonia, 'equipeEnviou' | 'mudarModo'>;
  empresaId: string;
  agora?: () => Date;
  respostas: ArmazemRespostas;
  transcricoes: ArmazemTranscricoes;
  /** Whisper. A chave pode faltar: `transcricaoLigada` diz se está configurada. */
  transcritor?: Transcritor;
  transcricaoLigada?: () => boolean;
  /** Claude, para o botão "IA". */
  ia?: { claude: ClienteClaude; modelo: string; base: () => Promise<string>; ligada: () => boolean };
  /** Por qual número a unidade fala (o real; o de teste só sem número real). Texto = motivo de não ter. */
  canalDa: (unidade: UnidadeId) => { canalId: string } | { erro: string };
  /** Modo em que a conversa criada aqui nasce. */
  modoInicial?: () => Promise<ModoAtendimento>;
}

const UNIDADE = z.enum(['norte', 'sumare', 'feira']);
// O tratamento de erros do servidor só repassa a mensagem de 4xx e 501: falha de serviço de fora vira 424.
const erro = (msg: string, statusCode: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(msg), { statusCode, ...extra });

export function registrarConversa(app: FastifyInstance, o: OpcoesConversa): void {
  const agora = o.agora ?? (() => new Date());
  const visivel = (req: FastifyRequest, c: Conversa) => !req.usuario || podeVer(req.usuario, c);
  async function conversaVisivel(req: FastifyRequest): Promise<Conversa> {
    const c = await o.repo.buscarConversa((req.params as { id: string }).id).catch(() => undefined);
    if (!c || c.empresaId !== o.empresaId || !visivel(req, c)) throw erro('Conversa não encontrada', 404);
    return c;
  }
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';

  // ------------------------------------------------------------ respostas rápidas
  const daTela = (req: FastifyRequest) => (r: RespostaRapida) => ({
    ...r,
    pessoal: r.usuarioId !== null,
    podeEditar: !req.usuario || (r.usuarioId === null ? ehGestor(req.usuario) : r.usuarioId === req.usuario.id),
  });
  const NovaResposta = DadosResposta.extend({ pessoal: z.boolean().optional() });
  const AlteraResposta = z
    .object({ atalho: DadosResposta.shape.atalho.optional(), texto: DadosResposta.shape.texto.optional() })
    .refine((v) => v.atalho !== undefined || v.texto !== undefined, 'Informe o atalho ou o texto.');

  async function respostaEditavel(req: FastifyRequest): Promise<RespostaRapida> {
    const r = await o.respostas.obter(o.empresaId, (req.params as { id: string }).id);
    const u = req.usuario;
    // Pessoal de outra pessoa: nem aparece.
    if (!r || (u && r.usuarioId !== null && r.usuarioId !== u.id)) throw erro('Resposta não encontrada', 404);
    if (u && r.usuarioId === null && !ehGestor(u)) throw erro('Só a gestão muda as respostas da empresa. Crie uma pessoal com o seu jeito.', 403);
    return r;
  }
  const repetida = (e: unknown) => {
    if (e instanceof ErroAtalhoRepetido) throw erro(e.message, 409);
    throw e;
  };

  app.get('/api/respostas-rapidas', async (req) => (await o.respostas.listar(o.empresaId, req.usuario?.id ?? null)).map(daTela(req)));

  app.post('/api/respostas-rapidas', async (req, reply) => {
    const b = NovaResposta.parse(req.body);
    const u = req.usuario;
    // Atendente só cria pessoal; gestão escolhe (padrão: da empresa).
    if (u && !ehGestor(u) && b.pessoal === false) throw erro('Só a gestão cria respostas da empresa. A sua fica pessoal.', 403);
    const pessoal = u ? (ehGestor(u) ? b.pessoal === true : true) : false;
    const r = await o.respostas.criar(o.empresaId, { atalho: b.atalho, texto: b.texto, usuarioId: pessoal ? u!.id : null, criadaPor: quem(req) }).catch(repetida);
    return reply.code(201).send(daTela(req)(r));
  });

  app.patch('/api/respostas-rapidas/:id', async (req) => {
    const b = AlteraResposta.parse(req.body);
    const r = await respostaEditavel(req);
    const nova = await o.respostas.alterar(o.empresaId, r.id, b, quem(req)).catch(repetida);
    if (!nova) throw erro('Resposta não encontrada', 404);
    return daTela(req)(nova);
  });

  app.delete('/api/respostas-rapidas/:id', async (req) => {
    const r = await respostaEditavel(req);
    await o.respostas.apagar(o.empresaId, r.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ o que está ligado
  app.get('/api/conversa/recursos', async () => ({
    ia: Boolean(o.ia?.ligada()),
    transcricao: Boolean(o.transcritor && (o.transcricaoLigada?.() ?? true)),
  }));

  // ------------------------------------------------------------ transcrição dos áudios
  const emAndamento = new Map<string, Promise<string>>();

  /** Transcreve (uma vez) e guarda. Duas pessoas pedindo juntas esperam a mesma transcrição. */
  async function transcrever(c: Conversa, mensagemId: string, por: string): Promise<{ texto: string; nova: boolean }> {
    const ja = await o.transcricoes.obter(mensagemId);
    if (ja) return { texto: ja.texto, nova: false };
    const m = z.string().uuid().safeParse(mensagemId).success ? await o.repo.midia(mensagemId) : undefined;
    if (!m || m.conversaId !== c.id) throw erro('Áudio não encontrado', 404);
    if (m.anexo.tipo !== 'audio' && m.anexo.tipo !== 'video') throw erro('Só áudio e vídeo podem ser transcritos.', 400);
    if (!m.conteudo) throw erro(m.anexo.situacao === 'pendente' ? 'O áudio ainda está baixando. Tente daqui a pouco.' : 'Este áudio não foi baixado.', 409);
    if (!o.transcritor || o.transcricaoLigada?.() === false) {
      throw erro('Configure a chave da OpenAI em Conexões (Transcrição de áudio) para transcrever.', 501, { codigo: 'sem_chave' });
    }
    let p = emAndamento.get(mensagemId);
    if (!p) {
      const t = o.transcritor;
      p = (async () => {
        const texto = (await t.transcrever(m.conteudo!, m.anexo.mimetype ?? 'audio/ogg')) || '(áudio sem fala)';
        return (await o.transcricoes.guardar(c.id, { mensagemId, texto, modelo: t.modelo, criadaPor: por })).texto;
      })().finally(() => emAndamento.delete(mensagemId));
      emAndamento.set(mensagemId, p);
    }
    try {
      return { texto: await p, nova: true };
    } catch (e) {
      if (e instanceof ErroTranscricao) {
        throw erro(e.message, e.codigo === 'sem_chave' ? 501 : e.codigo === 'grande' ? 413 : 424, { codigo: e.codigo });
      }
      throw e;
    }
  }

  // ------------------------------------------------------------ relatório do cliente
  app.get('/api/conversas/:id/relatorio', async (req) => relatorioDaConversa(o.repo, await conversaVisivel(req), agora()));

  app.get('/api/conversas/:id/transcricoes', async (req) => {
    const c = await conversaVisivel(req);
    return Object.fromEntries((await o.transcricoes.daConversa(c.id)).map((t) => [t.mensagemId, t.texto]));
  });

  app.post('/api/conversas/:id/midias/:mensagemId/transcrever', async (req) => {
    const c = await conversaVisivel(req);
    const r = await transcrever(c, (req.params as { mensagemId: string }).mensagemId, quem(req));
    return { ok: true, ...r };
  });

  // ------------------------------------------------------------ botão "IA"
  const PedidoIa = z.object({ acao: z.enum(ACOES_IA), texto: z.string().max(4000).optional() });
  app.post('/api/conversas/:id/ia', async (req) => {
    const b = PedidoIa.parse(req.body);
    const c = await conversaVisivel(req);
    if (!o.ia || !o.ia.ligada()) throw erro('A IA está desligada: configure a chave da IA (Anthropic) em Conexões.', 501, { codigo: 'sem_chave' });
    if (b.acao === 'melhorar' && !b.texto?.trim()) throw erro('Escreva sua mensagem no campo primeiro; a IA melhora o que estiver lá.', 400);
    const mensagens = await o.repo.mensagens(c.id, 200);
    const transcricoes = new Map((await o.transcricoes.daConversa(c.id)).map((t) => [t.mensagemId, t.texto]));
    if (b.acao === 'explicar_audio') {
      const audios = mensagens.filter((m) => m.autor === 'cliente' && m.anexo?.tipo === 'audio');
      if (!audios.length) throw erro('A cliente ainda não mandou áudio nesta conversa.', 400);
      const ultimo = audios.at(-1)!;
      if (!transcricoes.has(ultimo.id)) transcricoes.set(ultimo.id, (await transcrever(c, ultimo.id, quem(req))).texto);
    }
    try {
      return await ajudarComIa(o.ia.claude, { modelo: o.ia.modelo, baseConhecimento: await o.ia.base() }, {
        acao: b.acao,
        conversa: c,
        mensagens,
        transcricoes,
        rascunho: b.texto?.trim(),
        atendente: req.usuario?.nome,
        agora: agora(),
      });
    } catch (e) {
      if (e instanceof ErroAssistente) throw erro(e.message, e.statusCode >= 500 ? 424 : e.statusCode);
      const status = (e as { status?: number }).status;
      if (status === 401) throw erro('A chave da IA foi recusada. Confira em Conexões.', 501, { codigo: 'sem_chave' });
      if (status === 429 || (status && status >= 500)) throw erro('A IA está ocupada agora. Tente de novo em instantes.', 424);
      throw e;
    }
  });

  // ------------------------------------------------------------ chat "Ajuda da IA" (bolinha de acesso rápido)
  const PedidoChat = z.object({
    mensagens: z
      .array(z.object({ papel: z.enum(['usuario', 'ia']), texto: z.string().max(LIMITE_TEXTO * 3) }))
      .min(1)
      .max(200),
  });
  app.post('/api/ia/chat', async (req) => {
    const b = PedidoChat.parse(req.body);
    const ultima = b.mensagens.at(-1)!;
    if (ultima.papel !== 'usuario' || !ultima.texto.trim()) throw erro('Escreva sua pergunta.', 400);
    if (ultima.texto.length > LIMITE_TEXTO) throw erro(`A pergunta ficou longa demais (máximo ${LIMITE_TEXTO} letras).`, 400);
    if (!o.ia || !o.ia.ligada()) throw erro('A IA está desligada: configure a chave da IA (Anthropic) em Conexões.', 501, { codigo: 'sem_chave' });
    const ag = agora();
    const ve = (c: Conversa) => c.empresaId === o.empresaId && visivel(req, c);
    const p = partesBahia(ag);
    const inicioHoje = bahia(p.ano, p.mes, p.dia);
    const [baseConhecimento, hoje, todas, agenda] = await Promise.all([
      o.ia.base().catch(() => ''),
      iaHoje(o.repo, ag, ve),
      o.repo.listarConversas(),
      agendamentosEntre(o.repo, inicioHoje, new Date(inicioHoje.getTime() + 2 * DIA), { ...escopoDe(req.usuario), empresaId: o.empresaId }).catch(() => []),
    ]);
    const esperando = todas.filter(ve).filter((c) => {
      const cli = c.ultimaMensagemCliente?.getTime() ?? 0;
      return cli > 0 && cli > Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
    });
    try {
      return await conversarComIa(o.ia.claude, { modelo: o.ia.modelo }, b.mensagens, {
        agora: ag,
        pessoa: req.usuario ? { nome: req.usuario.nome, papel: req.usuario.papel } : undefined,
        baseConhecimento,
        hoje,
        esperando,
        agenda,
      });
    } catch (e) {
      if (e instanceof ErroAssistente) throw erro(e.message, e.statusCode >= 500 ? 424 : e.statusCode);
      const status = (e as { status?: number }).status;
      if (status === 401) throw erro('A chave da IA foi recusada. Confira em Conexões.', 501, { codigo: 'sem_chave' });
      if (status === 429 || (status && status >= 500)) throw erro('A IA está ocupada agora. Tente de novo em instantes.', 424);
      throw e;
    }
  });

  // ------------------------------------------------------------ nova conversa por número
  const Nova = z.object({
    telefone: z.string().max(40),
    nome: z.string().trim().max(80).optional(),
    unidade: UNIDADE,
    texto: z.string().trim().min(1, 'Escreva a primeira mensagem.').max(4000),
    atendente: z.string().min(1).max(120).optional(),
  });
  // ---- "Novo contato" (Nova conversa como no WhatsApp): cria a conversa vazia, sem mandar mensagem.
  // A unidade (número que fala) é escolhida sozinha: a da conversa que a cliente já tem, senão a da pessoa,
  // senão a primeira com WhatsApp conectado.
  const NovoContato = z.object({
    telefone: z.string().max(40),
    nome: z.string().trim().max(80).optional(),
    canal: z.enum(['whatsapp']).default('whatsapp'),
    unidade: UNIDADE.optional(),
  });
  app.post('/api/conversas/contato', async (req, reply) => {
    const b = NovoContato.parse(req.body);
    const u = req.usuario;
    const telefone = normalizarCelular(b.telefone);
    if (!telefone) throw erro('Número inválido. Use DDD + celular, por exemplo (71) 98812-4471.', 400);
    const todas = (await o.repo.listarConversas()).filter((c) => c.empresaId === o.empresaId && c.telefone === telefone);
    const minhas = todas.filter((c) => visivel(req, c)).sort((a, x) => x.atualizadaEm.getTime() - a.atualizadaEm.getTime());
    if (minhas.length && !b.unidade) return reply.code(200).send({ ok: true, id: minhas[0]!.id, nova: false, telefone });
    if (todas.length && !minhas.length) {
      const dona = todas[0]!;
      throw erro(`Essa cliente já conversa com ${dona.responsavelNome ?? 'outra pessoa'}. Peça para a gerente transferir para você.`, 409);
    }
    const podeUnidade = (x: UnidadeId) => !u || veTudo(u) || u.unidades.includes(x);
    const conectada = (x: UnidadeId) => !('erro' in o.canalDa(x));
    const candidatas: UnidadeId[] = [
      ...(b.unidade ? [b.unidade] : []),
      ...(u && !veTudo(u) ? (u.unidades as UnidadeId[]) : []),
      ...(UNIDADE.options as UnidadeId[]),
    ];
    const unidade = candidatas.find((x) => podeUnidade(x) && conectada(x));
    if (!unidade) {
      const motivo = candidatas.find(podeUnidade);
      throw erro(motivo ? (o.canalDa(motivo) as { erro: string }).erro : 'Você ainda não tem unidade. Peça para a gestão liberar.', 400);
    }
    const canal = o.canalDa(unidade) as { canalId: string };
    const { conversa, nova } = await o.repo.buscarOuCriarConversa({ empresaId: o.empresaId, unidade, canalId: canal.canalId, telefone, nome: b.nome || undefined, agora: agora() });
    if (nova) {
      await o.repo.registrarEvento({ tipo: 'conversa_nova', conversaId: conversa.id, unidade: conversa.unidade, em: agora() });
      if (o.modoInicial) await o.sintonia.mudarModo(conversa.id, await o.modoInicial());
    }
    return reply.code(nova ? 201 : 200).send({ ok: true, id: conversa.id, nova, telefone, unidade });
  });

  app.post('/api/conversas/nova', async (req, reply) => {
    const b = Nova.parse(req.body);
    const u = req.usuario;
    const telefone = normalizarCelular(b.telefone);
    if (!telefone) throw erro('Número inválido. Use DDD + celular, por exemplo (71) 98812-4471.', 400);
    if (u && !veTudo(u) && !u.unidades.includes(b.unidade)) throw erro('Você não atende essa unidade.', 403);
    const atendente = u?.nome ?? b.atendente;
    if (!atendente) throw erro('Informe quem está enviando.', 400);
    const canal = o.canalDa(b.unidade);
    if ('erro' in canal) throw erro(canal.erro, 400);

    // Já existe? Reaproveita (sem duplicar). Se for de outra pessoa, avisa em vez de mostrar.
    const existente = (await o.repo.listarConversas()).find((c) => c.empresaId === o.empresaId && c.unidade === b.unidade && c.telefone === telefone);
    if (existente && !visivel(req, existente)) {
      throw erro(`Essa cliente já conversa com ${existente.responsavelNome ?? 'outra pessoa'}. Peça para a gerente transferir para você.`, 409);
    }
    const { conversa, nova } = await o.repo.buscarOuCriarConversa({
      empresaId: o.empresaId,
      unidade: b.unidade,
      canalId: canal.canalId,
      telefone,
      nome: b.nome || undefined,
      agora: agora(),
    });
    if (nova) {
      await o.repo.registrarEvento({ tipo: 'conversa_nova', conversaId: conversa.id, unidade: conversa.unidade, em: agora() });
      if (o.modoInicial) await o.sintonia.mudarModo(conversa.id, await o.modoInicial());
    }
    try {
      await o.sintonia.equipeEnviou(conversa.id, b.texto, atendente, u);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      const msg = (e as Error).message;
      return reply.code(status && status < 500 ? status : 502).send({ erro: `A conversa está aberta, mas a mensagem não saiu: ${msg}`, id: conversa.id, nova });
    }
    return reply.code(nova ? 201 : 200).send({ ok: true, id: conversa.id, nova, telefone });
  });
}

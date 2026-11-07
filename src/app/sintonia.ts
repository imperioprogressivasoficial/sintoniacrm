import { randomUUID } from 'node:crypto';
import type { Anexo, Conversa, Etapa, ModoAtendimento, UnidadeId } from '../domain.js';
import type { AnexoRecebido, CanalWhatsApp, EnvioResultado, MensagemRecebida, MidiaEnvio, ModeloAprovado, ModeloEnvio, StatusRecebido } from '../channels/tipos.js';
import { FORA_DA_JANELA, textoDoModelo } from '../channels/meta.js';
import { LIMITE_MIDIA, textoDoAnexo } from '../midia.js';
import { VALIDADE_DIGITANDO_MS, type Evento, type Repositorio, type Tarefa } from '../store/repositorio.js';
import { bloqueioPorDigitacao, viraDonaAoResponder, type Quem } from '../auth/acesso.js';
import type { PedidoAgente, RespostaAgente } from '../ai/agente.js';
import type { AcaoAgente } from '../ai/ferramentas.js';
import { decidirQuemResponde, equipeAtuou, REGRAS_PADRAO, type RegrasAtendimento } from '../engine/atendimento.js';
import { proximaEtapa, type EventoFunil } from '../engine/etapas.js';
import { followupsSemAgendamento, lembretesDoAgendamento } from '../engine/followups.js';
import { UNIDADES } from '../unidades.js';
import { bahia, DIA, partesBahia } from '../util/tempo.js';
import { resumir, textoRelatorio } from './relatorio.js';
import { TravaMemoria, type Trava } from '../fila/trava.js';

/** Número de WhatsApp conectado: por qual canal e de qual unidade. */
export interface NumeroConectado {
  canalId: string;
  unidade: UnidadeId;
  canal: CanalWhatsApp;
}

export interface DependenciasSintonia {
  empresaId: string;
  repo: Repositorio;
  numeros: NumeroConectado[];
  agente: { executar(p: PedidoAgente): Promise<RespostaAgente> };
  agora?: () => Date;
  regras?: RegrasAtendimento;
  /** Trava por conversa. Com vários processos, use a do Postgres. */
  trava?: Trava;
  /**
   * Configuração da IA da empresa (gravada no banco), lida a cada decisão: mudou na tela, vale na hora.
   * Sobrepõe `regras`; `modoPadrao` é o modo em que a conversa nova nasce.
   */
  configIa?: () => Promise<Partial<RegrasAtendimento> & { modoPadrao?: ModoAtendimento }>;
  /** A IA marcando tags existentes (vazio/ausente = não marca). */
  tagsIa?: {
    nomes(): Promise<string[]>;
    aplicar(c: Conversa, nome: string): Promise<{ id: string; nome: string } | undefined>;
  };
  /** Avisa a equipe (ex.: WhatsApp da gerente) quando a IA passa uma conversa adiante. */
  avisarEquipe?: (texto: string, conversa: Conversa) => Promise<void>;
  /** Baixador de mídias: avisado quando chega foto/áudio/vídeo/documento para baixar (sem esperar o relógio). */
  midias?: { avisar(): void };
  log?: (msg: string, extra?: unknown) => void;
  /** Funis e automações (src/funis, src/automacoes). Ausente = nada muda no atendimento. */
  ganchos?: GanchosSintonia;
}

/**
 * Ganchos para os funis por tags e as automações. São chamados SOB a trava da conversa (a conversa
 * pode ainda não estar gravada): quem implementa não pode esperar pela trava dela, só registrar e
 * agendar o trabalho para depois. Uma falha aqui é registrada e nunca derruba o atendimento.
 */
export interface GanchosSintonia {
  /** O motor ou a IA mudou `conversa.etapa` (a tag do funil do sistema acompanha). */
  etapaMudou?(c: Conversa, de: Etapa, para: Etapa, por: 'IA' | 'Sintonia'): Promise<void>;
  /** Mensagem nova da cliente (já gravada). `primeira` = a primeira mensagem dela nesta conversa. */
  mensagemCliente?(c: Conversa, m: { texto: string; idExterno: string; primeira: boolean }): Promise<void>;
  /** Alguém da equipe respondeu (pelo CRM ou pelo celular da loja). */
  equipeRespondeu?(c: Conversa): Promise<void>;
  /** Objetivo do "fluxo de IA" em vigor para a conversa: vai como instrução extra para a IA. */
  objetivoIa?(c: Conversa): Promise<string | undefined>;
}

const FOLLOWUPS: Tarefa['tipo'][] = ['followup_1h', 'followup_1d', 'followup_3d'];

/**
 * Quando a Sintonia "viu" a mensagem da cliente: o mais tarde entre a hora do WhatsApp e agora.
 * Se a cliente manda duas mensagens seguidas, a resposta à primeira pode sair depois da hora
 * da segunda; contando pela hora em que a segunda foi vista, ela não fica sem resposta.
 */
const vistaEm = (enviadaEm: Date, agora: Date, c: Conversa) =>
  // Uma mensagem nova é sempre posterior a tudo o que a loja já disse: a resposta anterior não a viu.
  new Date(
    Math.max(
      enviadaEm.getTime(),
      agora.getTime(),
      (c.ultimaMensagemIa?.getTime() ?? 0) + 1,
      (c.ultimaMensagemEquipe?.getTime() ?? 0) + 1,
    ),
  );

/**
 * Orquestra tudo: recebe mensagens, decide quem responde, chama a IA, envia,
 * move o funil e programa lembretes e follow-ups.
 */
export class Sintonia {
  private readonly trava: Trava;
  /** Envios em andamento: a Evolution pode avisar do nosso próprio envio antes de ele retornar o id. */
  private readonly enviando = new Map<string, number>();
  private readonly agora: () => Date;
  private readonly regras: RegrasAtendimento;
  private readonly log: (msg: string, extra?: unknown) => void;

  constructor(private readonly d: DependenciasSintonia) {
    this.agora = d.agora ?? (() => new Date());
    this.regras = d.regras ?? REGRAS_PADRAO;
    this.log = d.log ?? (() => {});
    this.trava = d.trava ?? new TravaMemoria();
  }

  // ---------- entrada pelo WhatsApp ----------

  async receber(msg: MensagemRecebida): Promise<void> {
    const numero = this.d.numeros.find((n) => n.canalId === msg.canalId);
    if (!numero) {
      this.log('Mensagem de número não cadastrado', msg.canalId);
      return;
    }
    // A própria Sintonia enviou: a Evolution devolve como fromMe. Ignorar.
    if (msg.deMim) {
      if (await this.d.repo.foiEnviadoPorNos(msg.idExterno)) return;
      const chave = this.chaveEnvio(msg.canalId, msg.telefone, msg.texto);
      if (this.enviando.has(chave)) {
        this.enviando.delete(chave);
        return;
      }
    }

    const config = await this.configAgora();
    const criada = await this.d.repo.buscarOuCriarConversa({
      empresaId: this.d.empresaId,
      unidade: numero.unidade,
      canalId: numero.canalId,
      telefone: msg.telefone,
      nome: msg.deMim ? undefined : msg.nome,
      agora: this.agora(),
    });

    // Toda alteração na conversa acontece sob a trava dela, lendo a versão mais nova:
    // dois processos nunca gravam um por cima do outro.
    let baixar = false;
    const pensar = await this.mutar(criada.conversa.id, async (conversa) => {
      const agora = this.agora();
      // Conversa nova nasce no modo padrão da empresa (configuração da IA).
      if (criada.nova && config.modoPadrao) conversa.modo = config.modoPadrao;
      // A mensagem (com os dados da mídia) é gravada primeiro; o arquivo é baixado depois, fora daqui.
      const mensagemId = randomUUID();
      const anexo = msg.anexo ? anexoInicial(msg.anexo, numero.canal) : undefined;
      const gravou = await this.d.repo.adicionarMensagem({
        id: mensagemId,
        conversaId: conversa.id,
        autor: msg.deMim ? 'equipe' : 'cliente',
        autorNome: msg.deMim ? 'celular da loja' : undefined,
        texto: msg.texto,
        em: msg.em,
        idExterno: msg.idExterno,
        ...(anexo ? { anexo } : {}),
        ...(msg.anexo?.ref ? { refMidia: msg.anexo.ref } : {}),
      });
      if (gravou && msg.anexo && anexo) baixar = await this.guardarAnexoRecebido(mensagemId, msg.anexo, anexo);

      if (msg.deMim) {
        if (!gravou) return false;
        // A atendente respondeu pelo celular: a IA sai da frente e os follow-ups recomeçam a contar.
        Object.assign(conversa, equipeAtuou(conversa, agora, config.regras), { ultimaMensagemEquipe: msg.em, atualizadaEm: agora });
        await this.d.repo.salvarConversa(conversa);
        await this.d.repo.cancelarTarefas(conversa.id, ['reavaliar', ...FOLLOWUPS]);
        await this.programarFollowups(conversa, agora);
        await this.evento('equipe_respondeu', conversa);
        await this.gancho('equipeRespondeu', () => this.d.ganchos?.equipeRespondeu?.(conversa));
        return false;
      }

      if (!gravou) {
        // Já estava gravada: webhook repetido, ou a mensagem foi retomada depois de uma queda
        // no meio do processamento. Garante que a conversa a registra e confere se foi respondida.
        if (!conversa.ultimaMensagemCliente || conversa.ultimaMensagemCliente.getTime() < msg.em.getTime()) {
          conversa.ultimaMensagemCliente = vistaEm(msg.em, agora, conversa);
          conversa.atualizadaEm = agora;
          await this.d.repo.salvarConversa(conversa);
        }
        return true;
      }

      if (criada.nova) await this.evento('conversa_nova', conversa);
      const primeira = !conversa.ultimaMensagemCliente;
      conversa.ultimaMensagemCliente = vistaEm(msg.em, agora, conversa);
      conversa.atualizadaEm = agora;
      await this.moverFunil(conversa, { tipo: 'mensagem_cliente' });
      await this.d.repo.salvarConversa(conversa);
      await this.d.repo.cancelarTarefas(conversa.id, FOLLOWUPS);
      await this.evento('mensagem_cliente', conversa);
      await this.gancho('mensagemCliente', () => this.d.ganchos?.mensagemCliente?.(conversa, { texto: msg.texto, idExterno: msg.idExterno, primeira }));
      return true;
    });
    if (baixar) this.d.midias?.avisar();
    if (pensar) await this.processar(criada.conversa.id);
  }

  /** Arquivo que já veio no webhook é guardado na hora. Retorna true se ainda falta baixar. */
  private async guardarAnexoRecebido(mensagemId: string, recebido: AnexoRecebido, anexo: Anexo): Promise<boolean> {
    if (anexo.situacao !== 'pendente') return false;
    if (!recebido.base64) return true;
    try {
      const conteudo = Buffer.from(recebido.base64, 'base64');
      if (conteudo.length > LIMITE_MIDIA) await this.d.repo.midiaGrande(mensagemId, conteudo.length);
      else await this.d.repo.guardarMidia(mensagemId, { conteudo });
      return false;
    } catch (e) {
      // Não conseguiu guardar agora: fica pendente e o baixador tenta pelo canal.
      this.log('Falha ao guardar mídia do webhook', String(e));
      return true;
    }
  }

  // ---------- ações vindas da tela do CRM ----------

  /** Atendente começou a digitar ou abriu a conversa para responder. Com `quem`, fica registrado quem é. */
  async equipeDigitando(conversaId: string, quem?: Pick<Quem, 'id' | 'nome'>): Promise<void> {
    const { regras } = await this.configAgora();
    await this.mutar(conversaId, async (c) => {
      Object.assign(c, equipeAtuou(c, this.agora(), regras));
      await this.d.repo.salvarConversa(c);
      if (quem) await this.d.repo.registrarDigitando(c.id, { usuarioId: quem.id, nome: quem.nome }, this.agora());
    });
  }

  /** Quem está respondendo agora (sinal de digitação recente), de quem começou primeiro para quem começou depois. */
  async quemEstaRespondendo(conversaId: string) {
    return this.d.repo.digitando(conversaId, new Date(this.agora().getTime() - VALIDADE_DIGITANDO_MS));
  }

  /**
   * Anti-duplicidade: recusa (409) se outra pessoa já está respondendo e `quem` não é a dona nem gestor.
   * Use antes de ações demoradas (ex.: agendar no Trinks); o envio confere de novo sob a trava.
   */
  async conferirVez(conversaId: string, quem: Quem): Promise<void> {
    const c = await this.d.repo.buscarConversa(conversaId);
    if (c) await this.conferirVezEm(c, quem);
  }

  private async conferirVezEm(c: Conversa, quem: Quem): Promise<void> {
    const recusa = bloqueioPorDigitacao(quem, c, await this.quemEstaRespondendo(c.id));
    if (recusa) throw Object.assign(new Error(recusa), { statusCode: 409, codigo: 'outra_pessoa_respondendo' });
  }

  /** Atendente enviou pelo CRM. Com `quem` (usuária logada), vale a anti-duplicidade e ela pode virar a dona. */
  async equipeEnviou(conversaId: string, texto: string, atendente: string, quem?: Quem): Promise<void> {
    const { regras } = await this.configAgora();
    const feito = await this.mutar(conversaId, (c) => this.equipeEnviouAgora(c, texto, atendente, regras, quem));
    if (feito === undefined) throw new Error('Conversa não encontrada');
  }

  private async equipeEnviouAgora(c: Conversa, texto: string, atendente: string, regras: RegrasAtendimento, quem?: Quem): Promise<true> {
    if (quem) await this.conferirVezEm(c, quem);
    const agora = this.agora();
    const espera = this.tempoDeResposta(c, agora);
    const id = await this.enviar(c, texto);
    await this.d.repo.adicionarMensagem({ conversaId: c.id, autor: 'equipe', autorNome: atendente, texto, em: agora, idExterno: id });
    await this.depoisDoEnvioDaEquipe(c, agora, atendente, espera, regras, quem);
    return true;
  }

  /**
   * Atendente enviou foto, vídeo, documento ou nota de voz pelo CRM.
   * O arquivo fica guardado com a mensagem; o texto leva o marcador para a IA ("[foto] legenda").
   */
  async equipeEnviouMidia(
    conversaId: string,
    midia: MidiaEnvio & { duracaoSeg?: number },
    atendente: string,
    quem?: Quem,
  ): Promise<{ mensagemId: string }> {
    const { regras } = await this.configAgora();
    const feito = await this.mutar(conversaId, async (c) => {
      if (quem) await this.conferirVezEm(c, quem);
      const n = this.numeroDa(c);
      if (!n.canal.enviarMidia) {
        throw Object.assign(new Error('Este número ainda não envia arquivos pela Sintonia.'), { statusCode: 501 });
      }
      const agora = this.agora();
      const espera = this.tempoDeResposta(c, agora);
      const legenda = midia.tipo === 'audio' ? undefined : midia.legenda?.trim() || undefined;
      const texto = textoDoAnexo(midia.tipo, legenda, midia.tipo === 'documento' ? midia.nomeArquivo : undefined);
      const id = await this.enviarCom(c, texto, () => n.canal.enviarMidia!(n.canalId, c.telefone, { ...midia, legenda }));
      const mensagemId = randomUUID();
      const anexo: Anexo = { tipo: midia.tipo, mimetype: midia.mimetype, tamanho: midia.conteudo.length, situacao: 'pendente' };
      if (midia.nomeArquivo) anexo.nomeArquivo = midia.nomeArquivo;
      if (legenda) anexo.legenda = legenda;
      if (midia.duracaoSeg !== undefined) anexo.duracaoSeg = midia.duracaoSeg;
      if (midia.tipo === 'audio') anexo.voz = true;
      await this.d.repo.adicionarMensagem({ id: mensagemId, conversaId: c.id, autor: 'equipe', autorNome: atendente, texto, em: agora, idExterno: id, anexo });
      await this.d.repo.guardarMidia(mensagemId, { conteudo: midia.conteudo });
      await this.depoisDoEnvioDaEquipe(c, agora, atendente, espera, regras, quem);
      return { mensagemId };
    });
    if (!feito) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    return feito;
  }

  /**
   * Atendente enviou um modelo aprovado (API oficial): a única forma de escrever para quem não fala com a loja há mais de 24 h.
   * O texto da conversa é o corpo do modelo com as variáveis preenchidas.
   */
  async equipeEnviouModelo(conversaId: string, modelo: ModeloEnvio, atendente: string, quem?: Quem): Promise<{ texto: string }> {
    const { regras } = await this.configAgora();
    const feito = await this.mutar(conversaId, async (c) => {
      if (quem) await this.conferirVezEm(c, quem);
      const n = this.numeroDa(c);
      if (!n.canal.enviarModelo) {
        throw Object.assign(new Error('Modelos aprovados só existem na API oficial do WhatsApp.'), { statusCode: 400 });
      }
      const corpo = n.canal.listarModelos
        ? await n.canal.listarModelos(n.canalId).then((l) => l.find((m) => m.nome === modelo.nome && m.idioma === modelo.idioma)?.corpo).catch(() => undefined)
        : undefined;
      const texto = textoDoModelo(corpo, modelo);
      const agora = this.agora();
      const espera = this.tempoDeResposta(c, agora);
      const id = await this.enviarCom(c, texto, () => n.canal.enviarModelo!(n.canalId, c.telefone, modelo), { modelo: true });
      await this.d.repo.adicionarMensagem({ conversaId: c.id, autor: 'equipe', autorNome: atendente, texto, em: agora, idExterno: id });
      await this.depoisDoEnvioDaEquipe(c, agora, atendente, espera, regras, quem);
      return { texto };
    });
    if (!feito) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    return feito;
  }

  /** Modelos aprovados do número da conversa (API oficial). */
  async modelosDa(conversaId: string): Promise<ModeloAprovado[]> {
    const c = await this.d.repo.buscarConversa(conversaId);
    if (!c) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    const n = this.numeroDa(c);
    if (!n.canal.listarModelos) throw Object.assign(new Error('Modelos aprovados só existem na API oficial do WhatsApp.'), { statusCode: 400 });
    return n.canal.listarModelos(n.canalId);
  }

  /**
   * Janela de 24 h da API oficial: a loja escreve livremente até 24 h depois da última mensagem da cliente.
   * Fora dela, só modelo aprovado. Nos outros canais, sempre aberta.
   */
  janelaDa(c: Conversa): { canal: CanalWhatsApp['tipo'] | null; aberta: boolean; fechaEm: Date | null } {
    const n = this.d.numeros.find((x) => x.canalId === c.canalId);
    if (!n || n.canal.tipo !== 'meta') return { canal: n?.canal.tipo ?? null, aberta: true, fechaEm: null };
    const ult = c.ultimaMensagemCliente?.getTime();
    const fechaEm = ult ? new Date(ult + DIA) : null;
    return { canal: 'meta', aberta: Boolean(fechaEm && fechaEm.getTime() > this.agora().getTime()), fechaEm };
  }

  /** Marca a última mensagem da cliente como lida no WhatsApp (só onde o canal permite, ex.: API oficial). */
  async marcarLida(conversaId: string): Promise<boolean> {
    const c = await this.d.repo.buscarConversa(conversaId);
    const n = c && this.d.numeros.find((x) => x.canalId === c.canalId);
    if (!c || !n?.canal.marcarLida) return false;
    const ultima = (await this.d.repo.mensagens(c.id, 30)).filter((m) => m.autor === 'cliente' && m.idExterno).at(-1);
    if (!ultima?.idExterno) return false;
    await n.canal.marcarLida(n.canalId, ultima.idExterno);
    return true;
  }

  /** Avisos de entrega e leitura (API oficial): ficam na mensagem; falha vai para o log. */
  async statusRecebidos(lista: StatusRecebido[]): Promise<number> {
    let n = 0;
    for (const s of lista) {
      if (await this.d.repo.registrarEntrega(s.idExterno, s.status, s.em)) n++;
      if (s.status === 'falhou') this.log('WhatsApp avisou falha na entrega', { canal: s.canalId, mensagem: s.idExterno, erro: s.erro });
    }
    return n;
  }

  private async depoisDoEnvioDaEquipe(c: Conversa, agora: Date, atendente: string, espera: number | undefined, regras: RegrasAtendimento, quem?: Quem): Promise<void> {
    Object.assign(c, equipeAtuou(c, agora, regras), { ultimaMensagemEquipe: agora, atualizadaEm: agora });
    if (quem) await this.donaPelaPrimeiraResposta(c, quem);
    await this.d.repo.salvarConversa(c);
    if (quem) await this.d.repo.pararDigitando(c.id, quem.id);
    await this.d.repo.cancelarTarefas(c.id, ['reavaliar', ...FOLLOWUPS]);
    await this.programarFollowups(c, agora);
    await this.evento('equipe_respondeu', c, { atendente, atendenteId: quem?.id, tempoRespostaMs: espera });
    await this.gancho('equipeRespondeu', () => this.d.ganchos?.equipeRespondeu?.(c));
  }

  /** Nome da cliente editado na ficha: vale para a lista, a busca e o que a IA vê. */
  async renomearCliente(conversaId: string, nome: string | null): Promise<void> {
    await this.mutar(conversaId, async (c) => {
      c.nome = nome ?? undefined;
      await this.d.repo.salvarConversa(c);
    });
  }

  async mudarModo(conversaId: string, modo: ModoAtendimento): Promise<void> {
    const existe = await this.mutar(conversaId, async (c) => {
      c.modo = modo;
      c.pausaIaAte = undefined;
      await this.d.repo.salvarConversa(c);
      return true;
    });
    if (existe && modo !== 'humano') await this.processar(conversaId);
  }

  /** Agendamento feito pela atendente no botão "Agendar" do CRM (já gravado no Trinks). */
  async equipeAgendou(conversaId: string, acao: Extract<AcaoAgente, { tipo: 'agendou' }>, atendente: string, quem?: Quem): Promise<void> {
    await this.mutar(conversaId, async (c) => {
      await this.aplicarAcoes(c, [acao], 'equipe', atendente, quem?.id);
      if (quem) await this.donaPelaPrimeiraResposta(c, quem);
      await this.d.repo.salvarConversa(c);
    });
  }

  /**
   * Muda a dona da conversa (assumir, transferir ou liberar com `para` = null) e registra o evento.
   * As permissões são conferidas antes, no servidor (ver auth/acesso.ts).
   */
  async definirResponsavel(
    conversaId: string,
    para: { id: string; nome: string } | null,
    por: { id?: string; nome: string },
    motivo: 'assumiu' | 'transferiu' | 'liberou',
  ): Promise<Conversa | undefined> {
    return this.mutar(conversaId, async (c) => {
      if ((c.responsavelId ?? null) === (para?.id ?? null)) return c;
      await this.trocarDona(c, para, por, motivo);
      await this.d.repo.salvarConversa(c);
      return c;
    });
  }

  /** Atendente/recepcionista que responde uma conversa sem dona vira a dona dela. */
  private async donaPelaPrimeiraResposta(c: Conversa, quem: Quem): Promise<void> {
    if (c.responsavelId || !viraDonaAoResponder(quem)) return;
    await this.trocarDona(c, { id: quem.id, nome: quem.nome }, { id: quem.id, nome: quem.nome }, 'primeira_resposta');
  }

  private async trocarDona(
    c: Conversa,
    para: { id: string; nome: string } | null,
    por: { id?: string; nome: string },
    motivo: string,
  ): Promise<void> {
    const de = c.responsavelId ? { id: c.responsavelId, nome: c.responsavelNome } : null;
    c.responsavelId = para?.id;
    c.responsavelNome = para?.nome;
    await this.evento('transferencia', c, {
      deId: de?.id ?? null,
      deNome: de?.nome ?? null,
      paraId: para?.id ?? null,
      paraNome: para?.nome ?? null,
      porId: por.id ?? null,
      porNome: por.nome,
      motivo,
    });
  }

  // ---------- para os funis e as automações ----------

  /** Roda `fn` com a conversa mais nova, sob a trava dela (undefined se não existe). Não chame de dentro de outra trava da mesma conversa. */
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined> {
    return this.mutar(conversaId, fn);
  }

  /** "Quem responde?" de novo para a conversa (ex.: uma automação ligou a IA). Fora da trava. */
  async reavaliar(conversaId: string): Promise<void> {
    await this.processar(conversaId);
  }

  /** Tipo do canal da conversa (a API oficial da Meta não aceita mensagem ativa fora da janela de 24 h). */
  canalDa(c: Conversa): CanalWhatsApp['tipo'] {
    return this.numeroDa(c).canal.tipo;
  }

  /**
   * Mensagem automática (automação), já sob a trava da conversa: envia, grava como da IA (com `autorNome`)
   * e marca a conversa como respondida. Quem chama grava a conversa.
   */
  async enviarAutomatico(c: Conversa, texto: string, autorNome: string): Promise<string> {
    // Nunca antes da última mensagem da cliente: a resposta automática conta como resposta a ela.
    const agora = new Date(Math.max(this.agora().getTime(), c.ultimaMensagemCliente?.getTime() ?? 0));
    const id = await this.enviar(c, texto);
    await this.d.repo.adicionarMensagem({ conversaId: c.id, autor: 'ia', autorNome, texto, em: agora, idExterno: id });
    c.ultimaMensagemIa = agora;
    c.atualizadaEm = agora;
    return id;
  }

  /** Troca a dona já sob a trava (automação). Quem chama grava a conversa. */
  async trocarDonaSobTrava(c: Conversa, para: { id: string; nome: string } | null, por: { id?: string; nome: string }, motivo: string): Promise<void> {
    if ((c.responsavelId ?? null) === (para?.id ?? null)) return;
    await this.trocarDona(c, para, por, motivo);
  }

  private async gancho(nome: string, fn: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.log(`Falha no gancho ${nome}`, String(e));
    }
  }

  private async objetivoDe(c: Conversa): Promise<string | undefined> {
    if (!this.d.ganchos?.objetivoIa) return undefined;
    try {
      return await this.d.ganchos.objetivoIa(c);
    } catch (e) {
      this.log('Falha ao ler o objetivo da IA', String(e));
      return undefined;
    }
  }

  // ---------- relógio: reavaliações, lembretes e follow-ups ----------

  async tick(): Promise<void> {
    const agora = this.agora();
    for (const t of await this.d.repo.reivindicarTarefas(agora)) {
      try {
        if (t.tipo === 'reavaliar') await this.processar(t.conversaId);
        else await this.mutar(t.conversaId, (c) => this.enviarAtivo(t, c));
      } catch (e) {
        this.log('Falha ao executar tarefa', { tarefa: t, erro: String(e) });
        await this.d.repo.registrarEvento({ tipo: 'falha', conversaId: t.conversaId, em: agora, dados: { tarefa: t.tipo, erro: String(e) } });
      }
    }
  }

  /**
   * Eventos do dia. Com `visivel`, só os das conversas que a pessoa pode ver
   * (eventos sem conversa, como falhas gerais, ficam de fora).
   */
  private async eventosDoDia(dia: Date, visivel?: (c: Conversa) => boolean, ocultar?: Set<string>): Promise<{ eventos: Evento[]; conversas: Conversa[] }> {
    const p = partesBahia(dia);
    const inicio = bahia(p.ano, p.mes, p.dia);
    const [brutos, todas] = await Promise.all([
      this.d.repo.eventosEntre(inicio, new Date(inicio.getTime() + DIA)),
      this.d.repo.listarConversas(),
    ]);
    // `ocultar`: conversas que não entram (as de demonstração, no relatório que sai pelo WhatsApp às 20h).
    const todos = ocultar?.size ? brutos.filter((e) => !e.conversaId || !ocultar.has(e.conversaId)) : brutos;
    const conversas = ocultar?.size ? todas.filter((c) => !ocultar.has(c.id)) : todas;
    if (!visivel) return { eventos: todos, conversas };
    const vistas = conversas.filter(visivel);
    const ids = new Set(vistas.map((c) => c.id));
    return { eventos: todos.filter((e) => e.conversaId && ids.has(e.conversaId)), conversas: vistas };
  }

  /** Números do dia (painel do gestor). */
  async resumoDoDia(dia: Date, visivel?: (c: Conversa) => boolean) {
    return resumir((await this.eventosDoDia(dia, visivel)).eventos);
  }

  /** Texto do relatório do dia (o envio às 20h fica no index). */
  async relatorioDoDia(dia: Date, visivel?: (c: Conversa) => boolean, ocultar?: Set<string>): Promise<string> {
    const { eventos, conversas } = await this.eventosDoDia(dia, visivel, ocultar);
    const hoje = new Set(eventos.filter((e) => e.tipo === 'mensagem_cliente').map((e) => e.conversaId));
    const semAgendar = conversas.filter((c) => hoje.has(c.id) && c.etapa !== 'agendada' && c.etapa !== 'compareceu').length;
    return textoRelatorio(resumir(eventos), dia, semAgendar);
  }

  // ---------- núcleo ----------

  /**
   * Roda `fn` com a conversa mais nova, sob a trava dela. Retorna undefined se a conversa não existe.
   * Nunca chamar `processar` de dentro (a trava não é reentrante).
   */
  private mutar<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined> {
    return this.trava.comTrava(conversaId, async () => {
      const c = await this.d.repo.buscarConversa(conversaId);
      return c ? fn(c) : undefined;
    });
  }

  /** Uma conversa por vez: mensagens em sequência não geram respostas cruzadas. */
  private async processar(conversaId: string): Promise<void> {
    try {
      await this.trava.comTrava(conversaId, () => this.processarAgora(conversaId));
    } catch (e) {
      // A mensagem já está salva; a falha foi ao pensar ou enviar (IA fora, WhatsApp fora).
      // Registra e tenta de novo daqui a 2 minutos, para a cliente não ficar sem resposta.
      this.log('Falha ao processar', String(e));
      await this.d.repo.registrarEvento({ tipo: 'falha', conversaId, em: this.agora(), dados: { etapa: 'processar', erro: String(e) } });
      await this.reavaliarEm(conversaId, new Date(this.agora().getTime() + 2 * 60_000));
    }
  }

  private async processarAgora(conversaId: string): Promise<void> {
    const { regras } = await this.configAgora();
    for (let rodada = 0; rodada < 3; rodada++) {
      const c = await this.d.repo.buscarConversa(conversaId);
      if (!c) return;
      const agora = this.agora();
      const decisao = decidirQuemResponde(c, UNIDADES[c.unidade], agora, regras);

      if (decisao.acao === 'nada') return;
      if (decisao.acao === 'aguardar') {
        await this.reavaliarEm(c.id, decisao.reavaliarEm);
        return;
      }

      const marco = c.ultimaMensagemCliente?.getTime();
      const mensagens = await this.d.repo.mensagens(c.id);
      const modo = decisao.acao === 'sugerir' ? 'sugerir' : 'responder';
      const r = await this.d.agente.executar({ conversa: c, mensagens, agora, modo, tagsDisponiveis: await this.tagsParaIa(), objetivo: await this.objetivoDe(c) });

      // Chegou mensagem nova enquanto a IA pensava: descarta e pensa de novo com tudo.
      const depois = await this.d.repo.buscarConversa(c.id);
      if (!depois) return;
      if (depois.ultimaMensagemCliente?.getTime() !== marco) continue;
      // A equipe assumiu enquanto a IA pensava: não atropela.
      if (modo === 'responder' && decidirQuemResponde(depois, UNIDADES[depois.unidade], this.agora(), regras).acao !== 'ia_responde') {
        return;
      }

      if (decisao.acao === 'sugerir') {
        await this.d.repo.guardarSugestao(depois.id, r.texto);
        await this.aplicarAcoes(depois, r.acoes, 'ia');
        await this.d.repo.salvarConversa(depois);
        await this.evento('sugestao_gerada', depois);
        await this.reavaliarEm(depois.id, decisao.reavaliarEm);
        return;
      }

      const enviadoEm = this.agora();
      const id = await this.enviar(depois, r.texto);
      const espera = this.tempoDeResposta(depois, enviadoEm);
      await this.d.repo.adicionarMensagem({ conversaId: depois.id, autor: 'ia', texto: r.texto, em: enviadoEm, idExterno: id });
      depois.ultimaMensagemIa = enviadoEm;
      depois.atualizadaEm = enviadoEm;
      if (decisao.assumiu) {
        depois.modo = 'ia';
        await this.evento('ia_assumiu', depois, { motivo: decisao.motivo });
      }
      await this.aplicarAcoes(depois, r.acoes, 'ia');
      await this.d.repo.salvarConversa(depois);
      await this.evento('ia_respondeu', depois, espera === undefined ? undefined : { tempoRespostaMs: espera });
      await this.d.repo.cancelarTarefas(depois.id, ['reavaliar']);
      await this.programarFollowups(depois, enviadoEm);
      return;
    }
  }

  private async enviarAtivo(t: Tarefa, c: Conversa): Promise<void> {
    if (c.modo === 'humano' || t.tipo === 'reavaliar') return;
    const numero = this.numeroDa(c);
    // Na API oficial, mensagem ativa fora da janela de 24h exige modelo aprovado (Fase 3).
    if (numero.canal.tipo === 'meta') {
      const ult = c.ultimaMensagemCliente?.getTime() ?? 0;
      if (this.agora().getTime() - ult > DIA) {
        await this.d.repo.registrarEvento({ tipo: 'falha', conversaId: c.id, em: this.agora(), dados: { tarefa: t.tipo, erro: 'requer modelo aprovado pela Meta' } });
        return;
      }
    }
    const mensagens = await this.d.repo.mensagens(c.id);
    const r = await this.d.agente.executar({
      conversa: c,
      mensagens,
      agora: this.agora(),
      modo: 'responder',
      tipoAtivo: t.tipo,
      tagsDisponiveis: await this.tagsParaIa(),
      objetivo: await this.objetivoDe(c),
    });
    const enviadoEm = this.agora();
    const id = await this.enviar(c, r.texto);
    await this.d.repo.adicionarMensagem({ conversaId: c.id, autor: 'ia', texto: r.texto, em: enviadoEm, idExterno: id });
    c.ultimaMensagemIa = enviadoEm;
    await this.aplicarAcoes(c, r.acoes, 'ia');
    if (t.tipo === 'followup_3d') await this.moverFunil(c, { tipo: 'followups_esgotados' });
    await this.d.repo.salvarConversa(c);
    await this.evento('envio_ativo', c, { tipo: t.tipo });
  }

  private async aplicarAcoes(c: Conversa, acoes: AcaoAgente[], autor: 'ia' | 'equipe', atendente?: string, atendenteId?: string): Promise<void> {
    for (const a of acoes) {
      if (a.tipo === 'marcar_tag' && autor === 'ia') {
        // Só tags que existem e só com a opção ligada (conferido de novo aqui, não só na ferramenta).
        const tag = await this.d.tagsIa?.aplicar(c, a.nome).catch((e) => {
          this.log('Falha ao marcar tag da IA', String(e));
          return undefined;
        });
        if (tag) await this.evento('tag_marcada', c, { tagId: tag.id, nome: tag.nome, por: 'IA' });
      }
      if (a.tipo === 'etapa') await this.moverFunil(c, { tipo: 'ia_classificou', etapa: a.etapa }, a.motivo);
      if (a.tipo === 'agendou') {
        c.trinksClienteId = a.clienteTrinksId;
        await this.moverFunil(c, { tipo: 'agendamento_criado' });
        await this.d.repo.cancelarTarefas(c.id, FOLLOWUPS);
        for (const l of lembretesDoAgendamento(a.agendamento.inicio, this.agora())) {
          await this.d.repo.programar({ conversaId: c.id, tipo: l.tipo, quando: l.quando });
        }
        await this.evento(autor === 'ia' ? 'agendamento_ia' : 'agendamento_equipe', c, {
          trinksId: a.agendamento.trinksId,
          atendente: autor === 'equipe' ? atendente : undefined,
          atendenteId: autor === 'equipe' ? atendenteId : undefined,
          servico: a.agendamento.servico,
          inicio: a.agendamento.inicio.toISOString(),
          // Para a Agenda (src/agenda/agenda-dia.ts).
          profissional: a.agendamento.profissional,
          duracaoMin: a.agendamento.duracaoMin,
        });
      }
      if (a.tipo === 'passar_para_humano') {
        c.modo = 'humano';
        if (!c.etiquetas.includes('precisa da equipe')) c.etiquetas.push('precisa da equipe');
        await this.d.repo.cancelarTarefas(c.id, ['reavaliar', ...FOLLOWUPS]);
        await this.evento('passou_para_humano', c, { motivo: a.motivo });
        await this.d.avisarEquipe?.(`A IA passou a conversa com ${c.nome ?? c.telefone} (${UNIDADES[c.unidade].nome}) para a equipe. Motivo: ${a.motivo}`, c);
      }
    }
  }

  /** Regras em vigor: as do código por baixo, a configuração da empresa por cima. Se a leitura falhar, fica no padrão. */
  private async configAgora(): Promise<{ regras: RegrasAtendimento; modoPadrao?: ModoAtendimento }> {
    if (!this.d.configIa) return { regras: this.regras };
    try {
      const { modoPadrao, ...resto } = await this.d.configIa();
      const regras = { ...this.regras };
      for (const [k, v] of Object.entries(resto)) if (v !== undefined) (regras as Record<string, unknown>)[k] = v;
      return { regras, modoPadrao };
    } catch (e) {
      this.log('Falha ao ler a configuração da IA; usando o padrão', String(e));
      return { regras: this.regras };
    }
  }

  private async tagsParaIa(): Promise<string[] | undefined> {
    if (!this.d.tagsIa) return undefined;
    const nomes = await this.d.tagsIa.nomes().catch(() => []);
    return nomes.length ? nomes : undefined;
  }

  private async moverFunil(c: Conversa, ev: EventoFunil, motivo?: string): Promise<void> {
    const nova = proximaEtapa(c.etapa, ev);
    if (nova === c.etapa) return;
    const de = c.etapa;
    c.etapa = nova;
    await this.evento('etapa_mudou', c, { de, para: nova, motivo: motivo ?? ev.tipo });
    await this.gancho('etapaMudou', () => this.d.ganchos?.etapaMudou?.(c, de, nova, ev.tipo === 'ia_classificou' ? 'IA' : 'Sintonia'));
  }

  private async programarFollowups(c: Conversa, desde: Date): Promise<void> {
    if (c.modo === 'humano' || c.etapa === 'agendada' || c.etapa === 'compareceu' || c.etapa === 'perdida') return;
    await this.d.repo.cancelarTarefas(c.id, FOLLOWUPS);
    for (const f of followupsSemAgendamento(desde)) await this.d.repo.programar({ conversaId: c.id, tipo: f.tipo, quando: f.quando });
  }

  private async reavaliarEm(conversaId: string, quando: Date): Promise<void> {
    await this.d.repo.cancelarTarefas(conversaId, ['reavaliar']);
    await this.d.repo.programar({ conversaId, tipo: 'reavaliar', quando });
  }

  /** Quanto a cliente esperou pela resposta da equipe (para o painel por atendente). */
  private tempoDeResposta(c: Conversa, agora: Date): number | undefined {
    const cli = c.ultimaMensagemCliente?.getTime();
    const ultLoja = Math.max(c.ultimaMensagemIa?.getTime() ?? 0, c.ultimaMensagemEquipe?.getTime() ?? 0);
    if (!cli || ultLoja > cli) return undefined;
    return agora.getTime() - cli;
  }

  private numeroDa(c: Conversa): NumeroConectado {
    const n = this.d.numeros.find((x) => x.canalId === c.canalId);
    if (!n) throw new Error(`Número ${c.canalId} não está conectado`);
    return n;
  }

  private enviar(c: Conversa, texto: string): Promise<string> {
    return this.enviarCom(c, texto, (n) => n.canal.enviarTexto(n.canalId, c.telefone, texto));
  }

  /**
   * Envia pelo canal da conversa e marca o id como nosso. `texto` é o que volta no eco do webhook.
   * API oficial: fora da janela de 24 h só passa modelo aprovado (`modelo: true`).
   */
  private async enviarCom(
    c: Conversa,
    texto: string,
    envio: (n: NumeroConectado) => Promise<EnvioResultado>,
    opcoes: { modelo?: boolean } = {},
  ): Promise<string> {
    const n = this.numeroDa(c);
    if (n.canal.tipo === 'meta' && !opcoes.modelo && !this.janelaDa(c).aberta) {
      throw Object.assign(new Error(FORA_DA_JANELA), { statusCode: 422, codigo: 'fora_da_janela' });
    }
    const chave = this.chaveEnvio(n.canalId, c.telefone, texto);
    this.enviando.set(chave, Date.now());
    try {
      const r = await envio(n);
      await this.d.repo.registrarEnviadoPorNos(r.idExterno);
      // Respondeu: a cliente vê os dois tiques azuis na mensagem dela (onde o canal permite).
      if (n.canal.marcarLida && !opcoes.modelo) this.marcarLida(c.id).catch((e) => this.log('Falha ao marcar como lida', String(e)));
      return r.idExterno;
    } finally {
      // Dá um tempo para o eco do webhook chegar e depois esquece.
      setTimeout(() => this.enviando.delete(chave), 60_000).unref?.();
    }
  }

  private chaveEnvio(canalId: string, telefone: string, texto: string): string {
    return `${canalId}|${telefone}|${texto.trim()}`;
  }

  private evento(tipo: Parameters<Repositorio['registrarEvento']>[0]['tipo'], c: Conversa, dados?: Record<string, unknown>) {
    return this.d.repo.registrarEvento({ tipo, conversaId: c.id, unidade: c.unidade, em: this.agora(), dados });
  }
}

/** Situação inicial da mídia recebida: grande demais, sem como baixar, ou pendente (baixa em seguida). */
function anexoInicial(r: AnexoRecebido, canal: CanalWhatsApp): Anexo {
  const a: Anexo = { tipo: r.tipo, situacao: 'pendente' };
  if (r.mimetype) a.mimetype = r.mimetype;
  if (r.nomeArquivo) a.nomeArquivo = r.nomeArquivo;
  if (r.duracaoSeg !== undefined) a.duracaoSeg = r.duracaoSeg;
  if (r.legenda) a.legenda = r.legenda;
  if (r.tamanho !== undefined) a.tamanho = r.tamanho;
  if (r.voz) a.voz = true;
  if (r.tamanho !== undefined && r.tamanho > LIMITE_MIDIA) a.situacao = 'grande';
  else if (!r.base64 && !canal.baixarMidia) a.situacao = 'falhou';
  return a;
}

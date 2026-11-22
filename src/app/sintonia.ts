import { FORA_DA_JANELA_SOCIAL, TIPOS_COM_JANELA_24H } from '../channels/meta-social.js';
import { randomUUID } from 'node:crypto';
import type { Anexo, Conversa, Etapa, ModoAtendimento, UnidadeId } from '../domain.js';
import type { AlvoMensagem, AnexoRecebido, CanalWhatsApp, EnvioResultado, MensagemRecebida, MidiaEnvio, ModeloAprovado, ModeloEnvio, StatusRecebido } from '../channels/tipos.js';
import { FORA_DA_JANELA, textoDoModelo } from '../channels/meta.js';
import { HISTORICO_MIDIA, LIMITE_MIDIA, textoDoAnexo } from '../midia.js';
import { VALIDADE_DIGITANDO_MS, type Evento, type Repositorio, type Tarefa } from '../store/repositorio.js';
import { bloqueioPorDigitacao, viraDonaAoResponder, type Quem } from '../auth/acesso.js';
import type { PedidoAgente, RespostaAgente } from '../ai/agente.js';
import type { AcaoAgente } from '../ai/ferramentas.js';
import { decidirQuemResponde, equipeAtuou, REGRAS_PADRAO, type RegrasAtendimento } from '../engine/atendimento.js';
import { proximaEtapa, type EventoFunil } from '../engine/etapas.js';
import { followupsSemAgendamento, lembretesDoAgendamento } from '../engine/followups.js';
import { unidadeDe } from '../unidades.js';
import { bahia, DIA, partesBahia } from '../util/tempo.js';
import { resumir, textoRelatorio } from './relatorio.js';
import { TravaMemoria, type Trava } from '../fila/trava.js';
/* ia-completa */
import { textoPassagem } from '../ai/agente.js';
import type { AplicadorCrmIa } from '../ai/crm-ia.js';
import { partirParaWhatsApp, type GuardaCusto } from '../ai/guarda.js';
import { PREFIXO_NOTA_IA, type Percepcao } from '../ai/prompt.js';
import { dataISO, horaHHmm } from '../util/tempo.js';
import { nomeDoWhatsapp, nomeOuTelefone, nomeParaTrocar } from '../contatos/nome.js';

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
  /** Assinatura das respostas da IA para a cliente (Agente de IA › Assinatura). Sem: sem assinatura. */
  assinaturaIa?: () => Promise<{ ligada: boolean; texto: string; posicao: 'inicio' | 'fim' }>;
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
  /**
   * Rastreamento de leads (src/rastreio): tira o "(ref: ...)" do texto guardado e grava a origem
   * (anúncio de clique para WhatsApp, link rastreado). Ausente = nada muda. Falha nunca derruba o atendimento.
   */
  rastreio?: {
    textoParaGuardar(msg: MensagemRecebida): string;
    aoMensagem(c: Conversa, msg: MensagemRecebida): Promise<unknown>;
  };
  /** Funis e automações (src/funis, src/automacoes). Ausente = nada muda no atendimento. */
  ganchos?: GanchosSintonia;
  /**
   * "IA atende primeiro" (src/agentes-ia): modo em que a conversa nova nasce, por unidade e horário.
   * undefined = vale o modo padrão da empresa (comportamento de sempre).
   */
  modoInicial?: (c: Conversa, agora: Date) => Promise<ModoAtendimento | undefined>;
  /**
   * Follow-up configurável (src/followup): quando a cadência "Não respondeu" ou a confirmação de agenda estão ligadas,
   * os follow-ups fixos (1h/1d/3d) e os lembretes fixos (véspera/2h) do motor saem. Ausente = tudo como sempre.
   */
  motor?: (c: Conversa) => Promise<{ followups: boolean; lembretes: boolean }>;
  /**
   * robustez: há IA para esta conversa agora (chave geral em Conexões ou chave própria do agente dela)?
   * Sem IA: a conversa nova nasce em "Minha resposta" (equipe), a IA não é chamada e nada fica reagendado para sempre.
   * Ausente = sempre há (comportamento antigo, testes).
   */
  iaDisponivel?: (c: Conversa) => Promise<boolean>;
  /**
   * serena-chave: a mensagem da cliente chegou durante a última pausa da Serena e já tem mais de 30 min: a IA não
   * responde mais (fica com a equipe, sem responder alguém horas depois). Ausente = nunca.
   */
  respostaVencida?: (c: Conversa, agora: Date) => boolean;
  /**
   * robustez: fila própria da IA. Com ela, `receber` só grava e mostra a mensagem (rápido) e pede para a IA pensar
   * por trás (src/app/fila-ia.ts). Ausente = pensa na hora, dentro de `receber` (comportamento antigo, testes).
   */
  filaIa?: { pedir(conversaId: string): void; executar?(conversaId: string): Promise<void> };
  /**
   * ia-completa: a cliente costuma mandar várias mensagens seguidas ("oi" / "tudo bem?" / "quanto é a progressiva?").
   * A IA espera este silêncio (ms) depois da última antes de responder, e responde tudo de uma vez (no máximo
   * JUNTAR_MAX_MS de espera). Ausente/0 = responde na hora (comportamento antigo, testes).
   */
  juntarMs?: number;
  /** Como esperar (testes trocam por um relógio falso). */
  esperar?: (ms: number) => Promise<void>;
  /** ia-completa: transcreve os áudios e pega as fotos da cliente antes de a IA pensar. */
  percepcao?: { preparar(c: Conversa, mensagens: import('../domain.js').Mensagem[], agora: Date): Promise<{ percepcao: Percepcao; esperar: boolean }> };
  /** ia-completa: o que a IA mexe no CRM (pipeline, produto do lead, tarefa da equipe, arquivo para a cliente). */
  crmIa?: AplicadorCrmIa;
  /** ia-completa: limite de uso da IA por conversa por dia. */
  guardaCusto?: GuardaCusto;
  /** ia-completa: quem da equipe está disponível agora (vai para a IA em cada resposta). */
  equipeAgora?: (c: Conversa) => Promise<{ texto: string; disponiveis: number; responsavelDisponivel: boolean | null } | undefined>;
}

/** ia-completa: espera máxima para juntar mensagens seguidas ou esperar uma mídia baixar. */
export const JUNTAR_MAX_MS = 25_000;
/** ia-completa: lembretes do agendamento (cancelados quando a IA remarca ou cancela). */
const LEMBRETES: Tarefa['tipo'][] = ['lembrete_vespera', 'lembrete_2h'];
/** ia-completa: ações que já aconteceram fora da Sintonia (na agenda) e precisam entrar no CRM de qualquer jeito. */
const FATOS: AcaoAgente['tipo'][] = ['agendou', 'remarcou', 'cancelou'];
const diaHora = (d: Date) => `${dataISO(d).split('-').reverse().slice(0, 2).join('/')} às ${horaHHmm(d)}`;

/** robustez: pausa da IA depois de a chave ser recusada (401). Trocar a chave em Conexões vale depois da pausa. */
export const PAUSA_IA_RECUSADA_MS = 15 * 60_000;
/** robustez: falhas seguidas da IA numa conversa antes de desistir (a conversa fica para a equipe). */
export const MAX_FALHAS_IA = 5;
/** Espera antes de a IA tentar de novo: 2, 4, 8, 16 e 30 min (teto). */
export const esperaFalhaIa = (falhas: number) => Math.min(2 * 60_000 * 2 ** Math.max(0, falhas - 1), 30 * 60_000);

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
  /** etapa-entrada: a loja respondeu (equipe ou a própria IA; mensagens de automação não contam). Tira da "Entrada de leads". */
  lojaRespondeu?(c: Conversa, por: 'equipe' | 'ia'): Promise<void>;
  /** Objetivo do "fluxo de IA" em vigor para a conversa: vai como instrução extra para a IA. */
  objetivoIa?(c: Conversa): Promise<string | undefined>;
  /** Um bot (src/bot) está conduzindo a conversa: a IA não responde nem sugere (o bot responde primeiro). */
  botNoControle?(c: Conversa): Promise<boolean>;
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
      // ia-completa: duas mensagens da cliente no mesmo milissegundo ainda contam como "chegou mensagem nova".
      (c.ultimaMensagemCliente?.getTime() ?? 0) + 1,
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
  /** Envios sem confirmação (tempo esgotado): se o eco chegar, a mensagem saiu e é gravada na conversa. */
  private readonly incertos = new Set<string>();
  private readonly agora: () => Date;
  private readonly regras: RegrasAtendimento;
  private readonly log: (msg: string, extra?: unknown) => void;
  /** robustez: falhas seguidas da IA por conversa (zera quando dá certo). */
  private readonly falhasIa = new Map<string, number>();
  /** robustez: até quando a IA fica pausada depois de recusar a chave (401 / sem chave). */
  private iaRecusadaAte = 0;
  /** robustez: dentro deste processo, a mesma conversa é pensada pela IA uma vez por vez (fora da trava do banco). */
  private readonly vezDaIa = new TravaMemoria();
  /**
   * ia-completa: resposta pronta que não saiu (WhatsApp desconectado na hora de enviar). As ações já foram aplicadas;
   * na próxima tentativa só o texto é reenviado (a IA não pensa de novo nem agenda duas vezes).
   */
  private readonly naoEnviadas = new Map<string, { partes: string[]; marco: number | undefined; criadaEm: number }>();
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(private readonly d: DependenciasSintonia) {
    this.esperar = d.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.agora = d.agora ?? (() => new Date());
    this.regras = d.regras ?? REGRAS_PADRAO;
    this.log = d.log ?? (() => {});
    this.trava = d.trava ?? new TravaMemoria();
  }

  /**
   * Quem mandou pelo WhatsApp do celular (fora da Sintonia: o WhatsApp não diz quem digitou). Dono 21/11: nunca
   * "celular da loja", sempre o nome de uma pessoa: a dona da conversa; senão, quem da equipe respondeu por último
   * pela Sintonia nas últimas 12 h; senão "Equipe".
   */
  private async quemPeloCelular(c: Conversa): Promise<string> {
    if (c.responsavelNome?.trim()) return c.responsavelNome.trim();
    try {
      const desde = this.agora().getTime() - 12 * 3600_000;
      const ms = await this.d.repo.mensagens(c.id, 40);
      const ultima = [...ms].reverse().find((m) => m.autor === 'equipe' && m.autorNome && !/^(celular da loja|equipe)$/i.test(m.autorNome) && m.em.getTime() >= desde);
      if (ultima?.autorNome) return ultima.autorNome;
    } catch { /* sem histórico: fica "Equipe" */ }
    return 'Equipe';
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
        // Envio que deu "tempo esgotado" mas saiu: grava (como do celular da loja) para ninguém mandar de novo.
        if (!this.incertos.delete(chave)) return;
      }
    }

    const config = await this.configAgora();
    const criada = await this.d.repo.buscarOuCriarConversa({
      empresaId: this.d.empresaId,
      unidade: numero.unidade,
      canalId: numero.canalId,
      telefone: msg.telefone,
      // contato-nome: nome do perfil do WhatsApp limpo (sem invisíveis, até 60 letras); número, pontos ou emojis sozinhos não contam.
      nome: msg.deMim ? undefined : nomeDoWhatsapp(msg.nome),
      agora: this.agora(),
    });

    // Toda alteração na conversa acontece sob a trava dela, lendo a versão mais nova:
    // dois processos nunca gravam um por cima do outro.
    let baixar = false;
    const pensar = await this.mutar(criada.conversa.id, async (conversa) => {
      const agora = this.agora();
      // Conversa nova nasce no modo padrão da empresa (configuração da IA).
      if (criada.nova) {
        const inicial = this.d.modoInicial ? await this.d.modoInicial(conversa, agora).catch(() => undefined) : undefined;
        if (inicial) conversa.modo = inicial;
        else if (config.modoPadrao) conversa.modo = config.modoPadrao;
        // robustez: sem chave da IA, nasce com a equipe ("Minha resposta"), não em Sugestões/IA esperando uma IA que não existe.
        if (conversa.modo !== 'humano' && !(await this.temIa(conversa))) conversa.modo = 'humano';
      }
      // A mensagem (com os dados da mídia) é gravada primeiro; o arquivo é baixado depois, fora daqui.
      const mensagemId = randomUUID();
      const anexo = msg.anexo ? anexoInicial(msg.anexo, numero.canal) : undefined;
      const gravou = await this.d.repo.adicionarMensagem({
        id: mensagemId,
        conversaId: conversa.id,
        autor: msg.deMim ? 'equipe' : 'cliente',
        autorNome: msg.deMim ? await this.quemPeloCelular(conversa) : undefined,
        texto: this.d.rastreio ? this.d.rastreio.textoParaGuardar(msg) : msg.texto,
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
        await this.primeiraResposta(conversa, 'equipe');
        await this.d.repo.salvarConversa(conversa);
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

      // etapa-entrada: lead novo (a cliente escreveu primeiro) nasce na "Entrada de leads".
      if (criada.nova && conversa.etapa === 'novo_lead') conversa.etapa = 'entrada';
      // automacao-vendas: origem "cliente" = a cliente escreveu primeiro (o rodízio de leads só distribui estas).
      if (criada.nova) await this.evento('conversa_nova', conversa, { origem: 'cliente' });
      await this.gancho('rastreio', () => this.d.rastreio?.aoMensagem(conversa, msg));
      const primeira = !conversa.ultimaMensagemCliente;
      conversa.ultimaMensagemCliente = vistaEm(msg.em, agora, conversa);
      conversa.atualizadaEm = agora;
      await this.moverFunil(conversa, { tipo: 'mensagem_cliente' });
      await this.d.repo.salvarConversa(conversa);
      await this.d.repo.cancelarTarefas(conversa.id, FOLLOWUPS);
      // robustez: rede de segurança da fila da IA (que fica em memória): se o processo cair antes de a IA pensar,
      // o relógio reavalia daqui a 3 min. Quando a IA responde ou sugere, esta tarefa é trocada ou cancelada.
      if (this.d.filaIa && conversa.modo !== 'humano') await this.reavaliarEm(conversa.id, new Date(agora.getTime() + 3 * 60_000));
      await this.evento('mensagem_cliente', conversa);
      await this.gancho('mensagemCliente', () => this.d.ganchos?.mensagemCliente?.(conversa, { texto: msg.texto, idExterno: msg.idExterno, primeira }));
      return true;
    });
    if (baixar) this.d.midias?.avisar();
    if (!pensar) return;
    // robustez: com a fila da IA, a mensagem já está na tela; a IA pensa por trás, sem segurar a fila de entrada.
    if (this.d.filaIa) this.d.filaIa.pedir(criada.conversa.id);
    else await this.processar(criada.conversa.id);
  }

  /** robustez: há IA para esta conversa? Falha ao conferir = considera que há (não cala a IA por um erro de leitura). */
  private async temIa(c: Conversa): Promise<boolean> {
    // robustez: a IA recusou a chave (401) há pouco: não chama de novo a cada mensagem (pausa de 15 min).
    if (this.iaRecusadaAte > this.agora().getTime()) return false;
    if (!this.d.iaDisponivel) return true;
    try {
      return await this.d.iaDisponivel(c);
    } catch (e) {
      this.log('Falha ao conferir se há IA', String(e));
      return true;
    }
  }

  /**
   * Conversas antigas puxadas do WhatsApp logo depois de conectar: grava as mensagens e as datas,
   * sem acionar a IA, follow-ups, avisos ou funil (é histórico, não mensagem nova).
   */
  async importarHistorico(mensagens: MensagemRecebida[]): Promise<{ conversas: number; mensagens: number; midias: number }> {
    const ids = new Set<string>();
    let n = 0;
    // atendimento-extra: fotos, áudios, vídeos, documentos e figurinhas também entram. A mensagem é gravada na hora
    // (com o anexo "pendente") e o arquivo é baixado depois, por trás, pelo mesmo baixador do webhook — sem travar
    // a importação. Limites: só os últimos dias de HISTORICO_MIDIA e até um tamanho; o resto fica "não baixado",
    // com o botão para baixar na conversa. Mensagem que já estava só como texto ganha o anexo agora.
    const agora = this.agora();
    // Depois das mídias que acabaram de chegar pelo webhook (essas são "-infinito" na fila).
    const proximaMidia = agora;
    let midias = 0;
    let naFila = 0;
    let baixar = false;
    const anexoDoHistorico = (msg: MensagemRecebida, canal: CanalWhatsApp): Anexo | undefined => {
      if (!msg.anexo) return undefined;
      const a = anexoInicial(msg.anexo, canal);
      if (a.situacao !== 'pendente' || msg.anexo.base64) return a;
      const antiga = agora.getTime() - msg.em.getTime() > HISTORICO_MIDIA.dias * DIA;
      const pesada = (msg.anexo.tamanho ?? 0) > HISTORICO_MIDIA.maxBytes;
      if (antiga || pesada || naFila >= HISTORICO_MIDIA.maxPorVez) return { ...a, situacao: 'falhou' };
      naFila++;
      return a;
    };
    for (const msg of [...mensagens].sort((a, b) => a.em.getTime() - b.em.getTime())) {
      const numero = this.d.numeros.find((x) => x.canalId === msg.canalId);
      if (!numero) continue;
      const criada = await this.d.repo.buscarOuCriarConversa({
        empresaId: this.d.empresaId, unidade: numero.unidade, canalId: numero.canalId, telefone: msg.telefone,
        nome: msg.deMim ? undefined : nomeDoWhatsapp(msg.nome), agora: this.agora(),
      });
      await this.mutar(criada.conversa.id, async (conversa) => {
        const mensagemId = randomUUID();
        const anexo = anexoDoHistorico(msg, numero.canal);
        const gravou = await this.d.repo.adicionarMensagem({
          id: mensagemId,
          conversaId: conversa.id, autor: msg.deMim ? 'equipe' : 'cliente', autorNome: msg.deMim ? await this.quemPeloCelular(conversa) : undefined,
          texto: msg.texto, em: msg.em, idExterno: msg.idExterno,
          ...(anexo ? { anexo, proximaMidia } : {}),
          ...(msg.anexo?.ref ? { refMidia: msg.anexo.ref } : {}),
        });
        if (!gravou) {
          // Já estava gravada: se entrou só como texto, sem a mídia, completa agora (resgate).
          if (anexo && msg.anexo) {
            const completada = await this.d.repo.completarMidia(conversa.id, msg.idExterno, anexo, { ref: msg.anexo.ref, proxima: proximaMidia });
            if (completada) {
              if (anexo.situacao === 'pendente') midias++;
              if (await this.guardarAnexoRecebido(completada, msg.anexo, anexo)) baixar = true;
            } else if (anexo.situacao === 'pendente' && !msg.anexo.base64) naFila--; // já tinha mídia: não ocupa a cota
          }
          return false;
        }
        if (anexo && msg.anexo) {
          if (anexo.situacao === 'pendente') midias++;
          if (await this.guardarAnexoRecebido(mensagemId, msg.anexo, anexo)) baixar = true;
        }
        n++;
        ids.add(conversa.id);
        const campo = msg.deMim ? 'ultimaMensagemEquipe' : 'ultimaMensagemCliente';
        const atual = conversa[campo];
        if (!atual || atual.getTime() < msg.em.getTime()) conversa[campo] = msg.em;
        if (!conversa.atualizadaEm || conversa.atualizadaEm.getTime() < msg.em.getTime()) conversa.atualizadaEm = msg.em;
        await this.d.repo.salvarConversa(conversa);
        return false;
      });
    }
    if (baixar) this.d.midias?.avisar();
    return { conversas: ids.size, mensagens: n, midias };
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
  /**
   * menu-mensagem: `opcoes.citada` responde citando outra mensagem (no WhatsApp ela aparece em cima, onde o canal permite);
   * `opcoes.id` é o id que a mensagem gravada recebe (para guardar a citação junto).
   */
  async equipeEnviou(conversaId: string, texto: string, atendente: string, quem?: Quem, opcoes: { citada?: AlvoMensagem & { texto: string }; id?: string } = {}): Promise<void> {
    const { regras } = await this.configAgora();
    const feito = await this.mutar(conversaId, (c) => this.equipeEnviouAgora(c, texto, atendente, regras, quem, opcoes));
    if (feito === undefined) throw new Error('Conversa não encontrada');
  }

  /** menu-mensagem: o número (canal) por onde a conversa fala, para reagir, editar e apagar. */
  canalDaConversa(c: Conversa): NumeroConectado | undefined {
    return this.d.numeros.find((x) => x.canalId === c.canalId);
  }

  private async equipeEnviouAgora(c: Conversa, texto: string, atendente: string, regras: RegrasAtendimento, quem?: Quem, opcoes: { citada?: AlvoMensagem & { texto: string }; id?: string } = {}): Promise<true> {
    if (quem) await this.conferirVezEm(c, quem);
    const agora = this.agora();
    const espera = this.tempoDeResposta(c, agora);
    const citada = opcoes.citada;
    const id = citada
      ? await this.enviarCom(c, texto, (n) => (n.canal.enviarCitando ? n.canal.enviarCitando(n.canalId, c.telefone, texto, citada) : n.canal.enviarTexto(n.canalId, c.telefone, texto)))
      : await this.enviar(c, texto);
    await this.d.repo.adicionarMensagem({ ...(opcoes.id ? { id: opcoes.id } : {}), conversaId: c.id, autor: 'equipe', autorNome: atendente, texto, em: agora, idExterno: id });
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
    if (!n || !TIPOS_COM_JANELA_24H.includes(n.canal.tipo)) return { canal: n?.canal.tipo ?? null, aberta: true, fechaEm: null };
    const ult = c.ultimaMensagemCliente?.getTime();
    const fechaEm = ult ? new Date(ult + DIA) : null;
    return { canal: n.canal.tipo, aberta: Boolean(fechaEm && fechaEm.getTime() > this.agora().getTime()), fechaEm };
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
    await this.primeiraResposta(c, 'equipe');
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

  /**
   * contato-nome: nome do perfil do WhatsApp para uma conversa que ainda está sem nome de verdade (rotina que preenche os
   * antigos). Nome de verdade (pode ter sido digitado pela equipe) nunca é trocado. Retorna true se trocou.
   */
  async nomeDoWhatsapp(conversaId: string, nome: string): Promise<boolean> {
    const trocou = await this.mutar(conversaId, async (c) => {
      const novo = nomeParaTrocar(c.nome, nome);
      if (!novo) return false;
      c.nome = novo;
      await this.d.repo.salvarConversa(c);
      return true;
    });
    return Boolean(trocou);
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

  /**
   * serena-faz: a Serena remarcou ou cancelou na agenda a pedido de alguém da equipe (depois do "Confirmar").
   * Mesmos efeitos da IA (lembretes, funil, nota e aviso), com o nome de quem pediu.
   */
  async equipeMudouAgenda(conversaId: string, acoes: Array<Extract<AcaoAgente, { tipo: 'remarcou' | 'cancelou' }>>, atendente: string, quem?: Quem): Promise<void> {
    await this.mutar(conversaId, async (c) => {
      await this.aplicarAcoes(c, acoes, 'equipe', atendente, quem?.id);
      await this.d.repo.salvarConversa(c);
    });
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

  /**
   * Transmissão (src/transmissoes), já sob a trava da conversa: envia pelo canal da conversa (marcando o id como nosso,
   * para o eco não parecer a atendente), grava como mensagem automática e marca a conversa como respondida.
   * `modelo` = modelo aprovado da API oficial (passa fora da janela de 24 h). Quem chama grava a conversa.
   */
  async enviarTransmissao(c: Conversa, texto: string, envio: (n: NumeroConectado) => Promise<EnvioResultado>, autorNome: string, modelo: boolean): Promise<string> {
    const agora = new Date(Math.max(this.agora().getTime(), c.ultimaMensagemCliente?.getTime() ?? 0));
    const id = await this.enviarCom(c, texto, envio, { modelo });
    await this.d.repo.adicionarMensagem({ conversaId: c.id, autor: 'ia', autorNome, texto, em: agora, idExterno: id });
    c.ultimaMensagemIa = agora;
    c.atualizadaEm = agora;
    return id;
  }

  /** Fluxos de mensagens: mostra "digitando…"/"gravando áudio…" para a cliente. Canal sem esse recurso: não faz nada. */
  async mostrarPresenca(conversaId: string, tipo: 'digitando' | 'gravando', segundos: number): Promise<void> {
    const c = await this.d.repo.buscarConversa(conversaId);
    if (!c) return;
    const n = this.numeroDa(c);
    await n.canal.enviarPresenca?.(n.canalId, c.telefone, tipo, segundos * 1000);
  }

  /** Foto/arquivo automático (bot), já sob a trava: envia, guarda o arquivo e grava como da IA (com `autorNome`). Quem chama grava a conversa. */
  async enviarMidiaAutomatico(c: Conversa, midia: MidiaEnvio, autorNome: string): Promise<string> {
    const n = this.numeroDa(c);
    if (!n.canal.enviarMidia) throw new Error('Este número ainda não envia arquivos pela Sintonia.');
    const agora = new Date(Math.max(this.agora().getTime(), c.ultimaMensagemCliente?.getTime() ?? 0));
    const legenda = midia.tipo === 'audio' ? undefined : midia.legenda?.trim() || undefined;
    const texto = textoDoAnexo(midia.tipo, legenda, midia.tipo === 'documento' ? midia.nomeArquivo : undefined);
    const id = await this.enviarCom(c, texto, () => n.canal.enviarMidia!(n.canalId, c.telefone, { ...midia, legenda }));
    const mensagemId = randomUUID();
    const anexo: Anexo = { tipo: midia.tipo, mimetype: midia.mimetype, tamanho: midia.conteudo.length, situacao: 'pendente' };
    if (midia.nomeArquivo) anexo.nomeArquivo = midia.nomeArquivo;
    if (legenda) anexo.legenda = legenda;
    await this.d.repo.adicionarMensagem({ id: mensagemId, conversaId: c.id, autor: 'ia', autorNome, texto, em: agora, idExterno: id, anexo });
    await this.d.repo.guardarMidia(mensagemId, { conteudo: midia.conteudo });
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

  private async botConduz(c: Conversa): Promise<boolean> {
    if (!this.d.ganchos?.botNoControle) return false;
    try {
      return await this.d.ganchos.botNoControle(c);
    } catch (e) {
      this.log('Falha ao conferir o bot da conversa', String(e));
      return false;
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
    const tarefas = await this.d.repo.reivindicarTarefas(agora);
    // robustez: com a fila da IA, as reavaliações vão para ela (várias em paralelo, no limite da fila) e o relógio
    // não fica preso esperando uma IA de cada vez. Sem a fila, uma por vez, como sempre.
    const reavaliar = this.d.filaIa && 'executar' in this.d.filaIa ? (this.d.filaIa as { executar(id: string): Promise<void> }) : undefined;
    const paralelas: Promise<void>[] = [];
    for (const t of tarefas) {
      try {
        if (t.tipo === 'reavaliar' && reavaliar) paralelas.push(reavaliar.executar(t.conversaId));
        else if (t.tipo === 'reavaliar') await this.processar(t.conversaId);
        else await this.mutar(t.conversaId, (c) => this.enviarAtivo(t, c));
      } catch (e) {
        this.log('Falha ao executar tarefa', { tarefa: t, erro: String(e) });
        await this.d.repo.registrarEvento({ tipo: 'falha', conversaId: t.conversaId, em: agora, dados: { tarefa: t.tipo, erro: String(e) } });
      }
    }
    await Promise.all(paralelas);
  }

  /**
   * Eventos do dia. Com `visivel`, só os das conversas que a pessoa pode ver
   * (eventos sem conversa, como falhas gerais, ficam de fora).
   */
  private async eventosDoDia(dia: Date, visivel?: (c: Conversa) => boolean, ocultar?: Set<string>): Promise<{ eventos: Evento[]; conversas: Conversa[] }> {
    const p = partesBahia(dia);
    const inicio = bahia(p.ano, p.mes, p.dia);
    // robustez: só as conversas dos eventos do dia (antes: as 500 mais recentes; as outras sumiam do relatório).
    const brutos = await this.d.repo.eventosEntre(inicio, new Date(inicio.getTime() + DIA));
    const todas = await this.d.repo.listarConversas({ ids: [...new Set(brutos.flatMap((e) => (e.conversaId ? [e.conversaId] : [])))] });
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
  /** Pensa a resposta (IA) para a conversa agora. Usado pela fila da IA (src/app/fila-ia.ts). */
  async pensar(conversaId: string): Promise<void> {
    await this.processar(conversaId);
  }

  private async processar(conversaId: string): Promise<void> {
    try {
      await this.vezDaIa.comTrava(conversaId, () => this.processarAgora(conversaId));
      this.falhasIa.delete(conversaId);
    } catch (e) {
      // robustez: chave da IA ausente ou recusada (401): não adianta tentar de novo nem chamar a IA na próxima
      // mensagem. Pausa a IA por 15 min (todas as conversas ficam para a equipe), com UM aviso no log e um evento,
      // em vez de "Falha ao processar AuthenticationError 401" a cada mensagem recebida.
      if ((e as { codigo?: string }).codigo === 'sem_chave' || (e as { status?: number }).status === 401) {
        this.falhasIa.delete(conversaId);
        const jaPausada = this.iaRecusadaAte > this.agora().getTime();
        this.iaRecusadaAte = this.agora().getTime() + PAUSA_IA_RECUSADA_MS;
        if (!jaPausada) {
          this.log('A IA recusou a chave (confira em Conexões); a IA fica pausada por 15 min e as conversas ficam com a equipe', String((e as Error)?.message ?? e).slice(0, 200));
          await this.d.repo.registrarEvento({ tipo: 'falha', conversaId, em: this.agora(), dados: { etapa: 'processar', erro: 'chave da IA recusada (401)', pausaMin: PAUSA_IA_RECUSADA_MS / 60_000 } }).catch(() => undefined);
          // ia-completa: a equipe fica sabendo (uma vez por pausa) que as conversas estão com ela.
          const c = await this.d.repo.buscarConversa(conversaId).catch(() => undefined);
          if (c) await this.d.avisarEquipe?.('A IA está pausada: a chave da IA foi recusada. Confira a chave em Mais › Conexões. Enquanto isso, as conversas ficam com a equipe.', c)?.catch(() => undefined);
        }
        return;
      }
      // A mensagem já está salva; a falha foi ao pensar ou enviar (IA fora, WhatsApp fora).
      this.log('Falha ao processar', String(e));
      await this.d.repo.registrarEvento({ tipo: 'falha', conversaId, em: this.agora(), dados: { etapa: 'processar', erro: String(e) } }).catch(() => undefined);
      // robustez: novas tentativas com espera crescente (2, 4, 8, 16, 30 min) e teto; depois desiste e a conversa
      // fica para a equipe (a próxima mensagem da cliente recomeça a contagem).
      const falhas = (this.falhasIa.get(conversaId) ?? 0) + 1;
      if (falhas > MAX_FALHAS_IA) {
        this.falhasIa.delete(conversaId);
        this.log(`A IA falhou ${MAX_FALHAS_IA} vezes seguidas nesta conversa; ela fica para a equipe`, conversaId);
        await this.d.repo.registrarEvento({ tipo: 'falha', conversaId, em: this.agora(), dados: { etapa: 'processar', erro: 'IA desistiu depois de várias falhas', desistiu: true } }).catch(() => undefined);
        // ia-completa: a conversa não fica esquecida: etiqueta "precisa da equipe" e aviso (o modo não muda: a próxima
        // mensagem da cliente ainda tenta a IA de novo).
        this.naoEnviadas.delete(conversaId);
        await this.mutar(conversaId, async (c) => {
          if (!c.etiquetas.includes('precisa da equipe')) c.etiquetas.push('precisa da equipe');
          await this.d.repo.salvarConversa(c);
          await this.d.avisarEquipe?.(`A IA não conseguiu responder ${nomeOuTelefone(c.nome, c.telefone)} (${unidadeDe(c.unidade).nome}) depois de várias tentativas. Alguém da equipe pode responder?`, c)?.catch(() => undefined);
        }).catch(() => undefined);
        return;
      }
      if (this.falhasIa.size > 5000) this.falhasIa.clear();
      this.falhasIa.set(conversaId, falhas);
      await this.reavaliarEm(conversaId, new Date(this.agora().getTime() + esperaFalhaIa(falhas)));
    }
  }

  /** perdas-saude: até quando a IA está pausada por chave recusada (painel de saúde); null = não está. */
  iaPausadaAte(): Date | null {
    return this.iaRecusadaAte > this.agora().getTime() ? new Date(this.iaRecusadaAte) : null;
  }

  /** robustez: a chave da IA mudou em Conexões: tira a pausa (a próxima mensagem já tenta com a chave nova). */
  liberarIa(): void {
    this.iaRecusadaAte = 0;
  }

  /** robustez: quantas falhas seguidas da IA esta conversa tem (testes e painel). */
  falhasDaIa(conversaId: string): number {
    return this.falhasIa.get(conversaId) ?? 0;
  }

  /**
   * robustez: a IA pensa FORA da trava da conversa (antes segurava a trava os ~8 s da IA, e a mensagem seguinte da
   * mesma cliente, a resposta da atendente e as automações ficavam esperando). Só a parte de enviar e gravar é feita
   * sob a trava, relendo a conversa: se chegou mensagem nova enquanto a IA pensava, pensa de novo com tudo; se a
   * equipe assumiu, não atropela. Dentro do mesmo processo, a mesma conversa é pensada uma vez por vez (`vezDaIa`).
   */
  private async processarAgora(conversaId: string): Promise<void> {
    const { regras } = await this.configAgora();
    for (let rodada = 0; rodada < 4; rodada++) {
      // Lê e decide sob a trava (rápido): o que já estava esperando a conversa (bot, automação, resposta da equipe)
      // termina antes, e a IA nem é chamada se a mensagem já foi respondida.
      let c = await this.trava.comTrava(conversaId, () => this.d.repo.buscarConversa(conversaId));
      if (!c) return;
      // ia-completa: resposta que já estava pronta e não saiu (WhatsApp fora): só reenvia, sem pensar de novo.
      if (await this.reenviarPendente(c)) return;
      const agora = this.agora();
      let decisao = decidirQuemResponde(c, unidadeDe(c.unidade), agora, regras);

      if (decisao.acao === 'nada') return;
      if (await this.botConduz(c)) return;
      if (decisao.acao === 'aguardar') {
        await this.reavaliarEm(c.id, decisao.reavaliarEm);
        return;
      }
      // robustez: sem chave da IA (ou IA desligada), não chama nem reagenda: a conversa fica para a equipe.
      if (!(await this.temIa(c))) return;
      // serena-chave: chegou durante a pausa e já passou de 30 min: fica com a equipe.
      if (this.d.respostaVencida?.(c, agora)) return;

      // ia-completa: várias mensagens seguidas viram uma resposta só (espera a cliente parar de digitar).
      if (this.d.juntarMs) {
        const juntada = await this.esperarSilencio(c);
        if (!juntada) return;
        c = juntada;
        decisao = decidirQuemResponde(c, unidadeDe(c.unidade), this.agora(), regras);
        if (decisao.acao !== 'ia_responde' && decisao.acao !== 'sugerir') continue;
      }

      const modo = decisao.acao === 'sugerir' ? 'sugerir' : 'responder';
      // ia-completa: limite de uso da IA por conversa por dia.
      if (await this.limiteDeCusto(c, modo)) return;

      const marco = c.ultimaMensagemCliente?.getTime();
      let mensagens = await this.d.repo.mensagens(c.id);
      // ia-completa: áudio transcrito e foto como imagem; mídia que acabou de chegar e ainda baixa: espera um pouco.
      let percepcao: Percepcao | undefined;
      if (this.d.percepcao) {
        const limite = this.agora().getTime() + JUNTAR_MAX_MS;
        for (;;) {
          const r = await this.d.percepcao.preparar(c, mensagens, this.agora()).catch(() => undefined);
          percepcao = r?.percepcao;
          if (!r?.esperar || this.agora().getTime() >= limite) break;
          await this.esperar(5_000);
          mensagens = await this.d.repo.mensagens(c.id);
        }
      }
      const atual = c;
      const continuar = async (): Promise<boolean> => {
        const d = await this.d.repo.buscarConversa(atual.id).catch(() => undefined);
        if (!d) return false;
        if (d.ultimaMensagemCliente?.getTime() !== marco) return false;
        return modo !== 'responder' || decidirQuemResponde(d, unidadeDe(d.unidade), this.agora(), regras).acao === 'ia_responde';
      };
      const r = await this.d.agente.executar({
        conversa: c,
        mensagens,
        agora,
        modo,
        tagsDisponiveis: await this.tagsParaIa(),
        objetivo: await this.objetivoDe(c),
        ...(percepcao?.size ? { percepcao } : {}),
        ...(await this.equipeDe(c)),
        continuar,
      });

      const resultado = await this.trava.comTrava(conversaId, async (): Promise<'fim' | 'de_novo'> => {
        // Chegou mensagem nova enquanto a IA pensava: descarta e pensa de novo com tudo.
        const depois = await this.d.repo.buscarConversa(c!.id);
        if (!depois) return 'fim';
        if (depois.ultimaMensagemCliente?.getTime() !== marco) {
          // ia-completa: o que a IA já fez na agenda vale (e fica anotado para a próxima resposta saber).
          await this.aplicarFatos(depois, r.acoes, 'chegou mensagem nova antes de a IA responder');
          return 'de_novo';
        }
        // A equipe assumiu enquanto a IA pensava: não atropela.
        if (modo === 'responder' && decidirQuemResponde(depois, unidadeDe(depois.unidade), this.agora(), regras).acao !== 'ia_responde') {
          await this.aplicarFatos(depois, r.acoes, 'a equipe assumiu a conversa antes de a IA responder');
          return 'fim';
        }
        if (r.interrompida) {
          await this.aplicarFatos(depois, r.acoes, 'a resposta foi interrompida');
          return 'de_novo';
        }

        if (decisao.acao === 'sugerir') {
          await this.d.repo.guardarSugestao(depois.id, r.texto);
          await this.aplicarAcoes(depois, r.acoes, 'ia');
          await this.d.repo.salvarConversa(depois);
          await this.evento('sugestao_gerada', depois);
          await this.reavaliarEm(depois.id, decisao.reavaliarEm);
          return 'fim';
        }

        if (!r.texto.trim()) {
          // Agente que só organiza o CRM (sem "responder"): aplica as ações e não envia nada.
          await this.aplicarAcoes(depois, r.acoes, 'ia');
          await this.d.repo.salvarConversa(depois);
          return 'fim';
        }
        const enviadoEm = this.agora();
        const espera = this.tempoDeResposta(depois, enviadoEm);
        // ia-completa: sem markdown e em até 3 mensagens curtas.
        const partes = partirParaWhatsApp(r.texto);
        const enviadas = await this.enviarPartes(depois, partes, enviadoEm);
        if (enviadas.erro) {
          // ia-completa: o WhatsApp não aceitou (desconectado). O que a IA fez vale; a resposta espera para ser reenviada.
          this.naoEnviadas.set(depois.id, { partes: partes.slice(enviadas.n), marco, criadaEm: enviadoEm.getTime() });
          if (enviadas.n > 0) {
            depois.ultimaMensagemIa = enviadoEm;
            depois.atualizadaEm = enviadoEm;
            await this.primeiraResposta(depois, 'ia');
          }
          if (decisao.assumiu) depois.modo = 'ia';
          await this.aplicarAcoes(depois, r.acoes, 'ia');
          await this.d.repo.salvarConversa(depois);
          throw enviadas.erro;
        }
        depois.ultimaMensagemIa = enviadoEm;
        depois.atualizadaEm = enviadoEm;
        await this.primeiraResposta(depois, 'ia');
        if (decisao.assumiu) {
          depois.modo = 'ia';
          await this.evento('ia_assumiu', depois, { motivo: decisao.motivo });
        }
        await this.aplicarAcoes(depois, r.acoes, 'ia');
        await this.d.repo.salvarConversa(depois);
        await this.evento('ia_respondeu', depois, espera === undefined ? undefined : { tempoRespostaMs: espera });
        await this.d.repo.cancelarTarefas(depois.id, ['reavaliar']);
        await this.programarFollowups(depois, enviadoEm);
        return 'fim';
      });
      if (resultado === 'fim') return;
    }
    // ia-completa: a cliente não parou de escrever em 4 rodadas: tenta de novo em 30 s (nunca fica sem resposta).
    await this.reavaliarEm(conversaId, new Date(this.agora().getTime() + 30_000));
  }

  /** ia-completa: espera a cliente parar de mandar mensagens (juntarMs de silêncio, no máximo JUNTAR_MAX_MS). */
  private async esperarSilencio(c: Conversa): Promise<Conversa | undefined> {
    const juntar = this.d.juntarMs ?? 0;
    const limite = this.agora().getTime() + JUNTAR_MAX_MS;
    let atual = c;
    for (;;) {
      const falta = Math.min((atual.ultimaMensagemCliente?.getTime() ?? 0) + juntar, limite) - this.agora().getTime();
      if (falta <= 0) return atual;
      await this.esperar(falta);
      const d = await this.d.repo.buscarConversa(c.id);
      if (!d) return undefined;
      atual = d;
    }
  }

  /** Assinatura da IA (dono 21/11): "*Serena:*" antes da 1ª parte ou "_Serena_" depois da última. Desligada: igual. */
  private async assinarPartes(partes: string[]): Promise<string[]> {
    if (!partes.length || !this.d.assinaturaIa) return partes;
    let a: { ligada: boolean; texto: string; posicao: 'inicio' | 'fim' };
    try { a = await this.d.assinaturaIa(); } catch { return partes; }
    const quem = (a?.texto || '').replace(/[*_~]/g, '').trim();
    if (!a?.ligada || !quem) return partes;
    const saida = [...partes];
    if (a.posicao === 'fim') saida[saida.length - 1] = `${saida[saida.length - 1]}\n\n_${quem}_`;
    else if (!saida[0]!.startsWith(`*${quem}:*`)) saida[0] = `*${quem}:*\n${saida[0]}`;
    return saida;
  }

  /**
   * ia-completa: envia as partes da resposta em ordem. Para na primeira que falhar e devolve quantas saíram e o erro
   * (as que saíram ficam gravadas na conversa).
   */
  private async enviarPartes(c: Conversa, partes: string[], em: Date): Promise<{ n: number; erro?: unknown }> {
    partes = await this.assinarPartes(partes);
    let n = 0;
    for (const texto of partes) {
      try {
        const id = await this.enviar(c, texto);
        // Cada parte 1 ms depois da anterior: a ordem na tela é a ordem em que saíram.
        await this.d.repo.adicionarMensagem({ conversaId: c.id, autor: 'ia', texto, em: new Date(em.getTime() + n), idExterno: id });
        n++;
      } catch (erro) {
        return { n, erro };
      }
    }
    return { n };
  }

  /**
   * ia-completa: reenvia a resposta que não saiu, se a conversa ainda está como estava (a cliente não escreveu de
   * novo e a equipe não respondeu). Devolve true se tratou a conversa (enviou ou falhou de novo).
   */
  private async reenviarPendente(c: Conversa): Promise<boolean> {
    const p = this.naoEnviadas.get(c.id);
    if (!p) return false;
    const valeAinda = c.ultimaMensagemCliente?.getTime() === p.marco && (c.ultimaMensagemEquipe?.getTime() ?? 0) < p.criadaEm;
    if (!valeAinda) {
      this.naoEnviadas.delete(c.id);
      return false;
    }
    const r = await this.trava.comTrava(c.id, async () => {
      const d = await this.d.repo.buscarConversa(c.id);
      if (!d) return { n: 0 };
      const em = this.agora();
      const e = await this.enviarPartes(d, p.partes, em);
      if (e.n > 0) {
        d.ultimaMensagemIa = em;
        d.atualizadaEm = em;
        await this.primeiraResposta(d, 'ia');
        await this.d.repo.salvarConversa(d);
      }
      if (e.erro) {
        p.partes = p.partes.slice(e.n);
        return e;
      }
      this.naoEnviadas.delete(c.id);
      await this.evento('ia_respondeu', d, { reenvio: true });
      await this.d.repo.cancelarTarefas(d.id, ['reavaliar']);
      await this.programarFollowups(d, em);
      return e;
    });
    if (r.erro) throw r.erro;
    return true;
  }

  /**
   * ia-completa: a IA pensou mas a resposta não vai sair (mensagem nova ou a equipe assumiu). O que ela já fez na
   * agenda (agendou, remarcou, cancelou) aconteceu de verdade: entra no CRM e fica anotado na conversa.
   */
  private async aplicarFatos(c: Conversa, acoes: AcaoAgente[], porque: string): Promise<void> {
    const fatos = acoes.filter((a) => FATOS.includes(a.tipo));
    if (!fatos.length) return;
    await this.aplicarAcoes(c, fatos, 'ia');
    for (const a of fatos) {
      if (a.tipo === 'agendou') await this.nota(c, `IA marcou ${a.agendamento.servico} em ${diaHora(a.agendamento.inicio)} (${porque}; a cliente ainda não recebeu a confirmação).`);
    }
    await this.d.repo.salvarConversa(c);
  }

  /** ia-completa: limite de uso por conversa. Devolve true se a IA não deve ser chamada agora. */
  private async limiteDeCusto(c: Conversa, modo: 'responder' | 'sugerir'): Promise<boolean> {
    const g = this.d.guardaCusto;
    if (!g) return false;
    const sit = g.situacao(c.id);
    if (sit === 'perto' && g.primeiroAviso(c.id, 'perto')) {
      await this.d.repo.registrarEvento({ tipo: 'falha', conversaId: c.id, unidade: c.unidade, em: this.agora(), dados: { etapa: 'custo', aviso: 'A IA já usou 80% do limite desta conversa hoje.' } }).catch(() => undefined);
    }
    if (sit !== 'estourou') return false;
    if (!g.primeiroAviso(c.id, 'estourou')) return true;
    // Primeira vez que estoura no dia: a conversa vai para a equipe, com aviso; a cliente recebe a mensagem de passagem.
    await this.mutar(c.id, async (d) => {
      if (modo === 'responder' && d.modo !== 'humano') {
        const em = this.agora();
        const e = await this.enviarPartes(d, [textoPassagem((await this.equipeDe(d)).equipe)], em);
        if (e.n) d.ultimaMensagemIa = em;
      }
      await this.aplicarAcoes(d, [{ tipo: 'passar_para_humano', motivo: 'A IA chegou ao limite de uso desta conversa hoje (proteção de custo).' }], 'ia');
      await this.d.repo.salvarConversa(d);
    });
    return true;
  }

  /** ia-completa: o que a IA sabe da equipe agora (falha = segue sem). */
  private async equipeDe(c: Conversa): Promise<{ equipe?: { texto: string; disponiveis: number; responsavelDisponivel: boolean | null } }> {
    if (!this.d.equipeAgora) return {};
    const e = await this.d.equipeAgora(c).catch(() => undefined);
    return e ? { equipe: e } : {};
  }

  /** ia-completa: nota interna na conversa (a equipe vê; a IA lê nas próximas respostas). */
  private async nota(c: Conversa, texto: string): Promise<void> {
    await this.d.repo
      .adicionarMensagem({ conversaId: c.id, autor: 'sistema', texto: `${PREFIXO_NOTA_IA}${texto}`, em: this.agora() })
      .catch((e) => this.log('Falha ao anotar na conversa', String(e)));
  }

  private async enviarAtivo(t: Tarefa, c: Conversa): Promise<void> {
    if (c.modo === 'humano' || t.tipo === 'reavaliar') return;
    if (await this.botConduz(c)) return;
    // robustez: follow-up e lembrete da IA sem chave: não chama a IA (nada sai).
    if (!(await this.temIa(c))) return;
    // ia-completa: conversa que já estourou o limite de uso da IA hoje não recebe mensagem automática da IA.
    if (this.d.guardaCusto?.situacao(c.id) === 'estourou') return;
    const numero = this.numeroDa(c);
    // Na API oficial, mensagem ativa fora da janela de 24h exige modelo aprovado (Fase 3).
    if (TIPOS_COM_JANELA_24H.includes(numero.canal.tipo)) {
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
      ...(await this.equipeDe(c)),
    });
    if (!r.texto.trim()) {
      await this.aplicarAcoes(c, r.acoes, 'ia');
      await this.d.repo.salvarConversa(c);
      return;
    }
    const enviadoEm = this.agora();
    // ia-completa: sem markdown e em até 3 mensagens; nada saiu = erro (o relógio registra a falha).
    const e = await this.enviarPartes(c, partirParaWhatsApp(r.texto), enviadoEm);
    if (!e.n && e.erro) throw e.erro;
    c.ultimaMensagemIa = enviadoEm;
    await this.primeiraResposta(c, 'ia');
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
        if ((await this.motorDe(c)).lembretes) {
          for (const l of lembretesDoAgendamento(a.agendamento.inicio, this.agora())) {
            await this.d.repo.programar({ conversaId: c.id, tipo: l.tipo, quando: l.quando });
          }
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
      if (a.tipo === 'remarcou' || a.tipo === 'cancelou') await this.aplicarMudancaDeAgenda(c, a, autor === 'equipe' && atendente ? atendente : 'IA');
      if (a.tipo === 'mover_funil' || a.tipo === 'vincular_produto' || a.tipo === 'tarefa_equipe' || a.tipo === 'retorno' || a.tipo === 'enviar_arquivo') {
        await this.aplicarCrm(c, a).catch(async (e) => {
          this.log(`Falha ao aplicar ação da IA (${a.tipo})`, String(e));
          await this.d.repo.registrarEvento({ tipo: 'falha', conversaId: c.id, unidade: c.unidade, em: this.agora(), dados: { etapa: 'ia_acao', acao: a.tipo, erro: String(e).slice(0, 300) } }).catch(() => undefined);
          await this.nota(c, `IA tentou ${a.tipo === 'enviar_arquivo' ? `mandar "${a.nome}"` : a.tipo.replace(/_/g, ' ')} e não conseguiu (${String((e as Error)?.message ?? e).slice(0, 120)}).`);
        });
      }
      if (a.tipo === 'passar_para_humano') {
        c.modo = 'humano';
        if (!c.etiquetas.includes('precisa da equipe')) c.etiquetas.push('precisa da equipe');
        await this.d.repo.cancelarTarefas(c.id, ['reavaliar', ...FOLLOWUPS]);
        await this.evento('passou_para_humano', c, { motivo: a.motivo });
        await this.d.avisarEquipe?.(`A IA passou a conversa com ${nomeOuTelefone(c.nome, c.telefone)} (${unidadeDe(c.unidade).nome}) para a equipe. Motivo: ${a.motivo}`, c);
      }
    }
  }

  /** ia-completa: a IA remarcou ou cancelou na agenda: lembretes, funil, nota na conversa e aviso para a equipe. */
  private async aplicarMudancaDeAgenda(c: Conversa, a: Extract<AcaoAgente, { tipo: 'remarcou' | 'cancelou' }>, por = 'IA'): Promise<void> {
    await this.d.repo.cancelarTarefas(c.id, LEMBRETES);
    const quem = `${nomeOuTelefone(c.nome, c.telefone)} (${unidadeDe(c.unidade).nome})`;
    const antigo = `${a.antigo.servico ?? 'horário'} de ${a.antigo.inicio.replace('T', ' ').slice(0, 16)}`;
    if (a.tipo === 'remarcou') {
      c.trinksClienteId = a.clienteTrinksId;
      if ((await this.motorDe(c)).lembretes) {
        for (const l of lembretesDoAgendamento(a.agendamento.inicio, this.agora())) await this.d.repo.programar({ conversaId: c.id, tipo: l.tipo, quando: l.quando });
      }
      await this.evento('agendamento_ia', c, {
        trinksId: a.agendamento.trinksId,
        servico: a.agendamento.servico,
        inicio: a.agendamento.inicio.toISOString(),
        profissional: a.agendamento.profissional,
        duracaoMin: a.agendamento.duracaoMin,
        remarcadoDe: a.antigo.id,
      });
      await this.nota(c, `${por} remarcou ${antigo} para ${diaHora(a.agendamento.inicio)}${a.cancelouAntigo ? '' : ' (o horário antigo NÃO foi cancelado na agenda: cancele à mão)'}.`);
      await this.d.avisarEquipe?.(`${por === 'IA' ? 'A IA' : por} remarcou ${quem}: ${antigo} → ${diaHora(a.agendamento.inicio)}.${a.cancelouAntigo ? '' : ` ATENÇÃO: o horário antigo não foi cancelado na agenda (${a.erroCancelar ?? 'erro'}). Cancele à mão.`}`, c)?.catch(() => undefined);
    } else {
      if (a.restam === 0) await this.moverFunil(c, { tipo: 'agendamento_cancelado' });
      await this.nota(c, `${por} cancelou ${antigo}. Motivo: ${a.motivo || 'não informado'}.`);
      await this.d.avisarEquipe?.(`${por === 'IA' ? 'A IA' : por} cancelou o horário de ${quem}: ${antigo}. Motivo: ${a.motivo || 'não informado'}.`, c)?.catch(() => undefined);
    }
    await this.evento('ia_acao', c, { acao: a.tipo, agendamentoId: a.antigo.id, inicio: a.antigo.inicio, servico: a.antigo.servico, ...(a.tipo === 'cancelou' ? { motivo: a.motivo } : { para: a.agendamento.inicio.toISOString(), cancelouAntigo: a.cancelouAntigo }) });
  }

  /** ia-completa: ações de CRM da IA (já sob a trava da conversa; quem chama grava a conversa). */
  private async aplicarCrm(c: Conversa, a: Extract<AcaoAgente, { tipo: 'mover_funil' | 'vincular_produto' | 'tarefa_equipe' | 'retorno' | 'enviar_arquivo' }>): Promise<void> {
    const crm = this.d.crmIa;
    switch (a.tipo) {
      case 'mover_funil': {
        if (!crm) return;
        const mudou = await crm.moverFunil(c, a);
        if (mudou) await this.evento('ia_acao', c, { acao: a.tipo, funilId: a.funilId, etapaId: a.etapaId, etapa: a.etapa, motivo: a.motivo, perda: a.perda });
        if (mudou && a.perda) await this.nota(c, `IA moveu para "${a.etapa}" (${a.funil}). Motivo: ${a.motivo}${a.perda.detalhe ? ` — ${a.perda.detalhe}` : ''}.`);
        return;
      }
      case 'vincular_produto':
        if (!crm) return;
        await crm.vincularProduto(c, a.produtoId, a.quantidade);
        await this.evento('ia_acao', c, { acao: a.tipo, produtoId: a.produtoId, nome: a.nome, quantidade: a.quantidade });
        return;
      case 'tarefa_equipe': {
        if (!crm) return;
        const r = await crm.criarTarefa(c, a);
        await this.evento('ia_acao', c, { acao: a.tipo, titulo: a.titulo, responsavel: r.responsavel, venceEm: a.venceEm?.toISOString() ?? null });
        await this.nota(c, `IA criou a tarefa "${a.titulo}" para ${r.responsavel}${a.venceEm ? ` (prazo ${diaHora(a.venceEm)})` : ''}.`);
        return;
      }
      case 'retorno':
        await this.d.repo.cancelarTarefas(c.id, ['retorno_ia']);
        await this.d.repo.programar({ conversaId: c.id, tipo: 'retorno_ia', quando: a.quando });
        await this.evento('ia_acao', c, { acao: a.tipo, quando: a.quando.toISOString(), motivo: a.motivo });
        await this.nota(c, `Retorno combinado para ${diaHora(a.quando)}: ${a.motivo}`);
        return;
      case 'enviar_arquivo': {
        if (!crm) return;
        const arq = await crm.arquivo(c, a.origem, a.id);
        if (!arq) throw new Error('arquivo não encontrado');
        await this.enviarMidiaAutomatico(
          c,
          { tipo: arq.tipo, conteudo: arq.conteudo, mimetype: arq.mimetype, ...(arq.nomeArquivo ? { nomeArquivo: arq.nomeArquivo } : {}), ...(a.legenda ? { legenda: a.legenda } : {}) },
          'IA',
        );
        await this.evento('ia_acao', c, { acao: a.tipo, origem: a.origem, id: a.id, nome: a.nome });
        return;
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

  /**
   * etapa-entrada: a loja respondeu (equipe ou a IA). Quem está na "Entrada de leads" vai para "Novo lead" (ou "Em conversa",
   * se a cliente já tinha escrito: a regra de sempre). Nos funis da empresa, a Entrada passa para a etapa seguinte (gancho).
   * Mensagens de automação, bot e pesquisa (enviarAutomatico) não contam. Quem chama grava a conversa.
   */
  private async primeiraResposta(c: Conversa, por: 'equipe' | 'ia'): Promise<void> {
    if (c.etapa === 'entrada') await this.moverFunil(c, { tipo: 'primeira_resposta', clienteEscreveu: Boolean(c.ultimaMensagemCliente) }, por === 'ia' ? 'primeira_resposta_ia' : 'primeira_resposta_equipe');
    await this.gancho('lojaRespondeu', () => this.d.ganchos?.lojaRespondeu?.(c, por));
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
    if (!(await this.motorDe(c)).followups) return;
    for (const f of followupsSemAgendamento(desde)) await this.d.repo.programar({ conversaId: c.id, tipo: f.tipo, quando: f.quando });
  }

  /** O que o motor fixo ainda faz (o follow-up configurável pode assumir). Se a leitura falhar, faz tudo. */
  private async motorDe(c: Conversa): Promise<{ followups: boolean; lembretes: boolean }> {
    if (!this.d.motor) return { followups: true, lembretes: true };
    return this.d.motor(c).catch(() => ({ followups: true, lembretes: true }));
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
    if (TIPOS_COM_JANELA_24H.includes(n.canal.tipo) && !opcoes.modelo && !this.janelaDa(c).aberta) {
      throw Object.assign(new Error(n.canal.tipo === 'meta' ? FORA_DA_JANELA : FORA_DA_JANELA_SOCIAL), { statusCode: 422, codigo: 'fora_da_janela' });
    }
    const chave = this.chaveEnvio(n.canalId, c.telefone, texto);
    this.enviando.set(chave, Date.now());
    try {
      const r = await envio(n);
      await this.d.repo.registrarEnviadoPorNos(r.idExterno);
      // Respondeu: a cliente vê os dois tiques azuis na mensagem dela (onde o canal permite).
      if (n.canal.marcarLida && !opcoes.modelo) this.marcarLida(c.id).catch((e) => this.log('Falha ao marcar como lida', String(e)));
      // Dá um tempo para o eco do webhook chegar e depois esquece.
      setTimeout(() => this.enviando.delete(chave), 60_000).unref?.();
      return r.idExterno;
    } catch (e) {
      if ((e as { codigo?: string }).codigo === 'incerto') {
        // Pode ter saído: se o eco chegar nos próximos minutos, ele entra na conversa.
        this.incertos.add(chave);
        setTimeout(() => {
          this.enviando.delete(chave);
          this.incertos.delete(chave);
        }, 5 * 60_000).unref?.();
      } else this.enviando.delete(chave); // não saiu: uma mensagem igual mandada pelo celular não pode sumir
      throw e;
    }
  }

  /**
   * Envio fora de conversa (aviso para a equipe, relatório do dia): o id fica marcado como nosso, para o eco
   * do WhatsApp (fromMe) não voltar como "a equipe respondeu pelo celular".
   */
  async enviarAvulso(n: NumeroConectado, telefone: string, texto: string): Promise<string> {
    const chave = this.chaveEnvio(n.canalId, telefone, texto);
    this.enviando.set(chave, Date.now());
    try {
      const r = await n.canal.enviarTexto(n.canalId, telefone, texto);
      await this.d.repo.registrarEnviadoPorNos(r.idExterno);
      setTimeout(() => this.enviando.delete(chave), 60_000).unref?.();
      return r.idExterno;
    } catch (e) {
      if ((e as { codigo?: string }).codigo === 'incerto') setTimeout(() => this.enviando.delete(chave), 5 * 60_000).unref?.();
      else this.enviando.delete(chave);
      throw e;
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

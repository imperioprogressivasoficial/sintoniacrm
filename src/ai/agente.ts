import Anthropic from '@anthropic-ai/sdk';
import type { Conversa, Mensagem } from '../domain.js';
import { contextoDaConversa, INSTRUCAO_ATIVA, instrucaoObjetivo, montarTurnos, PREFIXO_NOTA_IA, systemPrompt, type Percepcao } from './prompt.js';
import { apresentacao, identidade } from '../empresa/identidade.js';
import {
  type AcaoAgente,
  type Agenda,
  executarFerramenta,
  ferramentaMarcarTag,
  FERRAMENTAS_AGENDA_MUDAR,
  FERRAMENTAS_ESCRITA,
  FERRAMENTAS_LEITURA,
  novaSessao,
  type SessaoFerramentas,
} from './ferramentas.js';
import { completarNulos } from './ferramenta-base.js';
import { FERRAMENTAS_CRM_ESCRITA, FERRAMENTAS_CRM_LEITURA } from './ferramentas-crm.js';
import type { ServicosCrmIa } from './crm-ia.js';
import { precosConhecidosDe, precosDoTexto, precosInventados, reais } from './guarda.js';
import { conferirPassagem } from '../agentes-ia/passagem.js';
import { conhecerCliente, primeiraResposta, textoClienteConhecida } from './cliente-conhecida.js';

/**
 * serena-regras: bloco <cliente_conhecida> (cadastro na agenda pelo telefone/nome do perfil e se é a primeira resposta).
 * No teste da tela (simulação) a cliente é fictícia: não consulta a agenda.
 */
export async function blocoClienteConhecida(agenda: Agenda, p: PedidoAgente, prazoMs: number): Promise<string> {
  const primeira = primeiraResposta(p.mensagens);
  if (p.simulacao) return textoClienteConhecida({ conhecida: false, nome: null, por: null, confirmar: false, unidade: null, clienteId: null, ultimoAtendimento: null, proximoHorario: null }, primeira);
  const k = await conhecerCliente(agenda, p.conversa, p.agora, { prazoMs }).catch(() => null);
  return k ? textoClienteConhecida(k, primeira) : '';
}

type Esforco = 'low' | 'medium' | 'high';

export interface OpcoesAgente {
  modelo: string;
  esforco: Esforco;
  /** Limite de idas e vindas com ferramentas por resposta. */
  maxPassos?: number;
  /** produtos-lead: produtos e serviços vinculados ao lead (texto curto ou null). Vai no contexto da conversa. */
  produtosDoLead?: (c: Conversa) => Promise<string | null>;
  /** ia-completa: pipelines, produtos e arquivos da empresa (ausente = só agenda, como antes). */
  crm?: () => ServicosCrmIa | undefined;
  /** ia-completa: passa para a equipe sem chamar a IA quando a cliente pede pessoa, reclama ou está brava (padrão: sim). */
  passagemAutomatica?: boolean;
  /** ia-completa: quanto esperar a agenda antes de desistir (padrão 25 s). */
  prazoAgendaMs?: number;
  /** serena-regras: nome com que a IA se apresenta (Agente de IA › Assinatura; padrão "Serena"). */
  nomeIa?: () => Promise<string>;
}

export interface PedidoAgente {
  conversa: Conversa;
  mensagens: Mensagem[];
  agora: Date;
  /** responder = envia para a cliente; sugerir = só gera sugestão para a atendente (nada é gravado no Trinks). */
  modo: 'responder' | 'sugerir';
  /** Para mensagens ativas (follow-up, lembrete, manutenção). */
  tipoAtivo?: keyof typeof INSTRUCAO_ATIVA;
  /** Tags existentes que a IA pode marcar (só quando a empresa ligou "IA marca tags"). */
  tagsDisponiveis?: string[];
  /** "Testar a IA": responde como responderia, sem instrução de copiloto e sem gravar nada no Trinks. */
  simulacao?: boolean;
  /** Objetivo do "fluxo de IA" (automação) em vigor nesta conversa: instrução extra da loja. */
  objetivo?: string;
  /** ia-completa: áudios transcritos e fotos da cliente (por id da mensagem). */
  percepcao?: Percepcao;
  /**
   * ia-completa: a IA ainda deve continuar? Conferido antes de cada nova ida à IA e antes de gravar na agenda:
   * se a equipe assumiu (ou chegou mensagem nova), a IA para na hora, sem gastar nem agendar.
   */
  continuar?: () => Promise<boolean>;
  /** ia-completa: quem da equipe está disponível agora (src/presenca/cobertura.ts). */
  equipe?: { texto: string; disponiveis: number; responsavelDisponivel: boolean | null };
}

export interface RespostaAgente {
  texto: string;
  acoes: AcaoAgente[];
  /** true quando a IA se recusou e a resposta é a mensagem padrão de passagem para a equipe. */
  recusou: boolean;
  /** ia-completa: parou no meio porque `continuar` disse não (nada deve ser enviado). */
  interrompida?: boolean;
}

export const TEXTO_PASSAGEM =
  'Vou pedir para alguém da nossa equipe continuar seu atendimento por aqui, tá bom? Já já te respondem.';
/** ia-completa: passagem quando ninguém da equipe está disponível agora (almoço, fim do expediente). */
export const TEXTO_PASSAGEM_DEPOIS =
  'Vou deixar seu atendimento separado para a nossa equipe. Assim que alguém voltar, te responde por aqui, tá bom?';
/** A mensagem de passagem certa para o momento da equipe. */
export const textoPassagem = (equipe?: { disponiveis: number }) => (equipe && equipe.disponiveis === 0 ? TEXTO_PASSAGEM_DEPOIS : TEXTO_PASSAGEM);

/** Cliente mínimo da API que o agente usa (facilita testes). */
export type ClienteClaude = { beta: { messages: Pick<Anthropic['beta']['messages'], 'create'> } };

/** Passagem automática do agente padrão: as mesmas condições ligadas por padrão no estúdio. */
const PASSAGEM_PADRAO = { reclamacao: true, pedidoPessoa: true, irritada: true, naoSabe: true, valorAcimaDe: null, palavras: [] as string[] };

/** A última mensagem que importa é da cliente (está esperando resposta)? */
export function esperandoResposta(ms: Mensagem[]): Mensagem | undefined {
  const ult = ms.filter((m) => m.autor !== 'sistema').at(-1);
  return ult?.autor === 'cliente' ? ult : undefined;
}

/** Texto das mensagens da cliente que ainda não foram respondidas (várias seguidas contam juntas). */
export function ultimasDaCliente(ms: Mensagem[]): string {
  const l = ms.filter((m) => m.autor !== 'sistema');
  const r: string[] = [];
  for (let i = l.length - 1; i >= 0 && l[i]!.autor === 'cliente'; i--) r.unshift(l[i]!.texto);
  return r.join('\n');
}

/**
 * ia-completa: preço inventado. Valores conhecidos = os que vieram das ferramentas nesta resposta, da base de
 * conhecimento, dos produtos do lead e os que a loja (IA ou equipe) já disse nesta conversa.
 * Devolve a correção para mandar de volta à IA, ou null se está tudo certo.
 */
export function conferirPrecos(texto: string, sessao: SessaoFerramentas, referencias: Array<string | null | undefined>, mensagens: Mensagem[]): string | null {
  if (!precosDoTexto(texto).length) return null;
  const conhecidos = precosConhecidosDe([...referencias, ...mensagens.filter((m) => m.autor === 'ia' || m.autor === 'equipe').map((m) => m.texto)]);
  for (const c of sessao.precos) conhecidos.add(c);
  const inventados = precosInventados(texto, conhecidos);
  if (!inventados.length) return null;
  return `Sua resposta cita ${inventados.map(reais).join(', ')}, que não veio do sistema. Preço só pode vir de ver_servicos, ver_produtos ou da base de conhecimento. Consulte e reescreva a resposta (ou, se não achar, diga que vai confirmar o valor com a equipe, sem citar número).`;
}

export class Agente {
  private system?: { base: string; texto: string };

  /**
   * `baseConhecimento`: o texto fixo, ou uma função que devolve a versão mais nova
   * (base no banco: a edição vale na próxima resposta, sem reiniciar).
   */
  constructor(
    private readonly claude: ClienteClaude,
    private readonly agenda: Agenda,
    private readonly baseConhecimento: string | (() => Promise<string>),
    private readonly opcoes: OpcoesAgente,
  ) {}

  private async baseAtual(): Promise<string> {
    return typeof this.baseConhecimento === 'string' ? this.baseConhecimento : this.baseConhecimento();
  }

  /** System prompt da base atual (refeito só quando a base muda, para aproveitar o cache de prompt). */
  private async systemAtual(base: string): Promise<string> {
    // A empresa entra no system prompt: refeito também quando o nome/segmento muda em Empresa › Dados.
    const chave = `${base}\u0000${apresentacao()}\u0000${identidade().sobre}`;
    if (this.system?.base !== chave) this.system = { base: chave, texto: systemPrompt(base) };
    return this.system.texto;
  }

  async executar(p: PedidoAgente): Promise<RespostaAgente> {
    const acoes: AcaoAgente[] = [];
    const escreve = p.modo === 'responder' && !p.simulacao;
    const crm = this.opcoes.crm?.();

    // Passagem sem gastar IA: a cliente pediu pessoa, reclamou ou está brava.
    const ultima = esperandoResposta(p.mensagens);
    if (escreve && !p.tipoAtivo && ultima && this.opcoes.passagemAutomatica !== false) {
      const pass = conferirPassagem(ultimasDaCliente(p.mensagens), PASSAGEM_PADRAO);
      if (pass.passar) return { texto: textoPassagem(p.equipe), acoes: [{ tipo: 'passar_para_humano', motivo: pass.motivo! }], recusou: false };
    }

    const ferramentas = [
      ...FERRAMENTAS_LEITURA,
      ...(crm ? FERRAMENTAS_CRM_LEITURA : []),
      ...(escreve ? [...FERRAMENTAS_ESCRITA, ...FERRAMENTAS_AGENDA_MUDAR, ...(crm ? FERRAMENTAS_CRM_ESCRITA : [])] : []),
      ...(p.tagsDisponiveis?.length ? [ferramentaMarcarTag(p.tagsDisponiveis)] : []),
    ];
    const base = await this.baseAtual();
    const system = await this.systemAtual(base);
    const produtos = this.opcoes.produtosDoLead ? await this.opcoes.produtosDoLead(p.conversa).catch(() => null) : null;
    // serena-regras: quem é a cliente (cadastro na agenda) e o nome da IA, prontos no contexto.
    const [cliente, nomeIa] = await Promise.all([
      blocoClienteConhecida(this.agenda, p, Math.min(this.opcoes.prazoAgendaMs ?? 6000, 6000)),
      this.opcoes.nomeIa ? this.opcoes.nomeIa().catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const messages = this.montarMensagens(p, produtos, cliente, nomeIa);
    const maxPassos = this.opcoes.maxPassos ?? 12;
    const sessao = novaSessao();
    let correcoes = 0;

    for (let passo = 0; passo < maxPassos; passo++) {
      if (passo > 0 && p.continuar && !(await p.continuar().catch(() => true))) return { texto: '', acoes, recusou: false, interrompida: true };
      const resp = await this.claude.beta.messages.create({
        model: this.opcoes.modelo,
        max_tokens: 16000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: ferramentas,
        messages,
        output_config: { effort: this.opcoes.esforco },
        // Se o modelo principal recusar, a API tenta o modelo de reserva recomendado.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });

      if (resp.stop_reason === 'refusal') {
        return { texto: textoPassagem(p.equipe), acoes: [{ tipo: 'passar_para_humano', motivo: 'A IA recusou responder.' }], recusou: true };
      }

      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const resultados: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
        for (const bloco of resp.content) {
          if (bloco.type !== 'tool_use') continue;
          const r = await executarFerramenta(bloco.name, completarNulos(bloco.name, bloco.input), {
            agenda: this.agenda,
            conversa: p.conversa,
            agora: p.agora,
            acoes,
            podeEscrever: escreve,
            tagsDisponiveis: p.tagsDisponiveis,
            crm,
            aindaComIa: p.continuar,
            sessao,
            prazoAgendaMs: this.opcoes.prazoAgendaMs,
          });
          resultados.push({ type: 'tool_result', tool_use_id: bloco.id, content: r.conteudo, is_error: r.erro });
        }
        messages.push({ role: 'user', content: resultados });
        continue;
      }

      if (resp.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: resp.content });
        continue;
      }

      const texto = resp.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // Preço que não veio do sistema: devolve para a IA corrigir (uma vez); se insistir, a equipe assume.
      const correcao = texto ? conferirPrecos(texto, sessao, [base, produtos], p.mensagens) : null;
      if (correcao) {
        if (correcoes++ === 0 && passo + 1 < maxPassos) {
          messages.push({ role: 'assistant', content: resp.content });
          messages.push({ role: 'user', content: [{ type: 'text', text: `[verificação automática da Sintonia, não é a cliente] ${correcao}` }] });
          continue;
        }
        return {
          texto: escreve ? textoPassagem(p.equipe) : '',
          acoes: [...acoes, ...(escreve ? [{ tipo: 'passar_para_humano' as const, motivo: 'A IA citou um valor que não está no sistema; a equipe confirma o preço.' }] : [])],
          recusou: false,
        };
      }
      return { texto: texto || textoPassagem(p.equipe), acoes, recusou: false };
    }

    return {
      texto: textoPassagem(p.equipe),
      acoes: [...acoes, { tipo: 'passar_para_humano', motivo: 'A IA não concluiu a resposta no limite de passos.' }],
      recusou: false,
    };
  }

  private montarMensagens(p: PedidoAgente, produtos: string | null, cliente?: string, nomeIa?: string): Anthropic.Beta.Messages.BetaMessageParam[] {
    const extra: string[] = [contextoDaConversa(p.conversa, p.agora, { nomeIa })];
    if (cliente) extra.push(cliente);
    if (p.equipe) extra.push(`<equipe>\n${p.equipe.texto}\n</equipe>`);
    if (produtos) extra.push(`<produtos_do_lead>${produtos}</produtos_do_lead>`);
    if (p.tipoAtivo) {
      extra.push(
        `<instrucao_da_loja>${INSTRUCAO_ATIVA[p.tipoAtivo]}</instrucao_da_loja>\nEsta instrução é da loja, não da cliente. Escreva a mensagem que será enviada à cliente.`,
      );
    }
    if (p.objetivo?.trim()) extra.push(instrucaoObjetivo(p.objetivo));
    if (p.modo === 'sugerir' && !p.simulacao) {
      extra.push('Você está em modo copiloto: escreva a resposta que a atendente vai revisar e enviar.');
    }
    return montarTurnos(p.mensagens, extra, p.percepcao);
  }
}

export { PREFIXO_NOTA_IA };

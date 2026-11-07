import Anthropic from '@anthropic-ai/sdk';
import type { Conversa, Mensagem } from '../domain.js';
import { contextoDaConversa, historicoParaTurnos, INSTRUCAO_ATIVA, systemPrompt } from './prompt.js';
import {
  type AcaoAgente,
  type Agenda,
  executarFerramenta,
  ferramentaMarcarTag,
  FERRAMENTAS_ESCRITA,
  FERRAMENTAS_LEITURA,
} from './ferramentas.js';

type Esforco = 'low' | 'medium' | 'high';

export interface OpcoesAgente {
  modelo: string;
  esforco: Esforco;
  /** Limite de idas e vindas com ferramentas por resposta. */
  maxPassos?: number;
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
}

export interface RespostaAgente {
  texto: string;
  acoes: AcaoAgente[];
  /** true quando a IA se recusou e a resposta é a mensagem padrão de passagem para a equipe. */
  recusou: boolean;
}

export const TEXTO_PASSAGEM =
  'Vou pedir para alguém da nossa equipe continuar seu atendimento por aqui, tá bom? Já já te respondem.';

/** Cliente mínimo da API que o agente usa (facilita testes). */
export type ClienteClaude = { beta: { messages: Pick<Anthropic['beta']['messages'], 'create'> } };

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

  /** System prompt da base atual (refeito só quando a base muda, para aproveitar o cache de prompt). */
  private async systemAtual(): Promise<string> {
    const base = typeof this.baseConhecimento === 'string' ? this.baseConhecimento : await this.baseConhecimento();
    if (this.system?.base !== base) this.system = { base, texto: systemPrompt(base) };
    return this.system.texto;
  }

  async executar(p: PedidoAgente): Promise<RespostaAgente> {
    const acoes: AcaoAgente[] = [];
    const escreve = p.modo === 'responder' && !p.simulacao;
    const ferramentas = [
      ...FERRAMENTAS_LEITURA,
      ...(escreve ? FERRAMENTAS_ESCRITA : []),
      ...(p.tagsDisponiveis?.length ? [ferramentaMarcarTag(p.tagsDisponiveis)] : []),
    ];
    const system = await this.systemAtual();
    const messages = this.montarMensagens(p);
    const maxPassos = this.opcoes.maxPassos ?? 8;

    for (let passo = 0; passo < maxPassos; passo++) {
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
        return { texto: TEXTO_PASSAGEM, acoes: [{ tipo: 'passar_para_humano', motivo: 'A IA recusou responder.' }], recusou: true };
      }

      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const resultados: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
        for (const bloco of resp.content) {
          if (bloco.type !== 'tool_use') continue;
          const r = await executarFerramenta(bloco.name, bloco.input, {
            agenda: this.agenda,
            conversa: p.conversa,
            agora: p.agora,
            acoes,
            podeEscrever: escreve,
            tagsDisponiveis: p.tagsDisponiveis,
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
      return { texto: texto || TEXTO_PASSAGEM, acoes, recusou: false };
    }

    return {
      texto: TEXTO_PASSAGEM,
      acoes: [...acoes, { tipo: 'passar_para_humano', motivo: 'A IA não concluiu a resposta no limite de passos.' }],
      recusou: false,
    };
  }

  private montarMensagens(p: PedidoAgente): Anthropic.Beta.Messages.BetaMessageParam[] {
    const turnos = historicoParaTurnos(p.mensagens);
    const contexto = contextoDaConversa(p.conversa, p.agora);
    const extra: string[] = [contexto];
    if (p.tipoAtivo) {
      extra.push(
        `<instrucao_da_loja>${INSTRUCAO_ATIVA[p.tipoAtivo]}</instrucao_da_loja>\nEsta instrução é da loja, não da cliente. Escreva a mensagem que será enviada à cliente.`,
      );
    }
    if (p.modo === 'sugerir' && !p.simulacao) {
      extra.push('Você está em modo copiloto: escreva a resposta que a atendente vai revisar e enviar.');
    }
    const ultimo = turnos.at(-1);
    if (ultimo?.role === 'user') ultimo.content = `${ultimo.content}\n\n${extra.join('\n')}`;
    else turnos.push({ role: 'user', content: `[sem nova mensagem da cliente]\n\n${extra.join('\n')}` });
    return turnos.map((t) => ({ role: t.role, content: t.content }));
  }
}

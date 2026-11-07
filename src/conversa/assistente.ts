import type Anthropic from '@anthropic-ai/sdk';
import type { Conversa, Mensagem } from '../domain.js';
import { contextoDaConversa } from '../ai/prompt.js';
import type { ClienteClaude } from '../ai/agente.js';

/**
 * Botão "IA" no topo da conversa: ajuda a atendente sem enviar nada para a cliente.
 * Sugere a próxima resposta, melhora o texto do campo, resume, diz o próximo passo e explica áudios.
 */

export const ACOES_IA = ['sugerir', 'melhorar', 'resumir', 'proximo', 'explicar_audio'] as const;
export type AcaoIa = (typeof ACOES_IA)[number];

export const TITULO_ACAO: Record<AcaoIa, string> = {
  sugerir: 'Resposta sugerida',
  melhorar: 'Seu texto, melhorado',
  resumir: 'Resumo da conversa',
  proximo: 'Próximo passo',
  explicar_audio: 'O que ela disse no áudio',
};

export interface RespostaIa {
  acao: AcaoIa;
  titulo: string;
  /** O que mostrar na folha. */
  texto: string;
  /** Mensagem pronta para pôr no campo (sugerir, melhorar e, quando houver, o próximo passo). */
  mensagem: string | null;
}

export class ErroAssistente extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

const INSTRUCOES = `Você ajuda as atendentes da Império Progressivas (salões de alisamento e progressiva em Salvador) dentro do CRM. Você NÃO fala com a cliente: quem lê o que você escreve é a atendente.
Regras:
- Português do Brasil, jeito de WhatsApp: curto, caloroso, direto. Sem markdown, sem asteriscos, sem títulos.
- Use só o que está na conversa e na base de conhecimento. Nunca invente preço, horário, endereço ou regra; se faltar a informação, diga para a atendente conferir.
- "[áudio]", "[foto]", "[vídeo]" e "[documento]" são mídias; quando houver transcrição do áudio, ela vem logo depois.
- Mensagens "[Equipe: nome]" foram escritas por atendentes; "[IA]" pela IA da Sintonia.`;

const TAREFA: Record<AcaoIa, string> = {
  sugerir:
    'Escreva a próxima mensagem que a atendente deve mandar para a cliente agora, respondendo o que ela perguntou e levando ao próximo passo (normalmente propor um horário). Devolva só o texto da mensagem, pronto para enviar.',
  melhorar:
    'Reescreva o rascunho da atendente (abaixo) para ficar mais claro, gentil e correto, mantendo o sentido, os dados e o jeito dela. Corrija português. Não acrescente informação que não está no rascunho ou na base. Devolva só o texto reescrito.',
  resumir:
    'Resuma a conversa para uma atendente que vai assumir agora: quem é a cliente, o que ela quer, o que já foi combinado (serviço, unidade, dia, preço) e o que está pendente. No máximo 5 linhas curtas, cada uma começando com "• ".',
  proximo:
    'Diga qual é o melhor próximo passo com esta cliente e por quê, em até 3 frases. Depois escreva a mensagem sugerida para esse passo. Responda exatamente neste formato:\nPASSO: <o que fazer e por quê>\nMENSAGEM: <a mensagem para a cliente, ou "nenhuma" se não for hora de escrever>',
  explicar_audio:
    'Explique para a atendente o que a cliente disse no(s) último(s) áudio(s) transcritos abaixo: o que ela quer, perguntou ou reclamou, em até 3 frases. Se o áudio estiver em outra língua, traduza. Depois, numa linha começando com "MENSAGEM: ", sugira a resposta para a cliente.',
};

/** Histórico como texto para a IA: quem falou, o quê, e a transcrição dos áudios. */
export function historicoComTranscricoes(mensagens: Mensagem[], transcricoes: Map<string, string>): string {
  return mensagens
    .filter((m) => m.autor !== 'sistema')
    .map((m) => {
      const quem = m.autor === 'cliente' ? 'Cliente' : m.autor === 'ia' ? '[IA]' : `[Equipe: ${m.autorNome ?? 'atendente'}]`;
      const t = transcricoes.get(m.id);
      return `${quem}: ${m.texto}${t ? ` (transcrição do áudio: "${t}")` : ''}`;
    })
    .join('\n');
}

/** Separa "PASSO:/MENSAGEM:" (ou o texto + "MENSAGEM:") da resposta da IA. */
export function separarMensagem(bruto: string): { texto: string; mensagem: string | null } {
  const i = bruto.search(/^\s*MENSAGEM:/im);
  if (i < 0) return { texto: bruto.replace(/^\s*PASSO:\s*/i, '').trim(), mensagem: null };
  const texto = bruto.slice(0, i).replace(/^\s*PASSO:\s*/i, '').trim();
  const msg = bruto.slice(i).replace(/^\s*MENSAGEM:\s*/i, '').trim();
  return { texto, mensagem: !msg || /^nenhuma\.?$/i.test(msg) ? null : msg };
}

export async function ajudarComIa(
  claude: ClienteClaude,
  opcoes: { modelo: string; baseConhecimento: string },
  p: {
    acao: AcaoIa;
    conversa: Conversa;
    mensagens: Mensagem[];
    transcricoes: Map<string, string>;
    rascunho?: string;
    atendente?: string;
    agora: Date;
  },
): Promise<RespostaIa> {
  const partes = [contextoDaConversa(p.conversa, p.agora)];
  if (p.atendente) partes.push(`Atendente que pediu ajuda: ${p.atendente}.`);
  const recentes = p.mensagens.slice(-40);
  partes.push(`<conversa>\n${historicoComTranscricoes(recentes, p.transcricoes) || '(sem mensagens ainda)'}\n</conversa>`);
  if (p.acao === 'melhorar') partes.push(`<rascunho_da_atendente>\n${p.rascunho}\n</rascunho_da_atendente>`);
  if (p.acao === 'explicar_audio') {
    const audios = recentes.filter((m) => m.autor === 'cliente' && m.anexo?.tipo === 'audio' && p.transcricoes.has(m.id)).slice(-3);
    partes.push(`<audios_da_cliente>\n${audios.map((m) => `- "${p.transcricoes.get(m.id)}"`).join('\n')}\n</audios_da_cliente>`);
  }
  partes.push(`<tarefa>\n${TAREFA[p.acao]}\n</tarefa>`);

  const resp = await claude.beta.messages.create({
    model: opcoes.modelo,
    max_tokens: 16000,
    system: [{ type: 'text', text: `${INSTRUCOES}\n\n<base_de_conhecimento>\n${opcoes.baseConhecimento}\n</base_de_conhecimento>`, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: partes.join('\n\n') }],
    output_config: { effort: 'low' },
    // Se o modelo principal recusar, a API tenta o modelo de reserva recomendado.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (resp.stop_reason === 'refusal') throw new ErroAssistente('A IA não quis responder este pedido. Tente outra opção.', 422);
  const bruto = resp.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!bruto) throw new ErroAssistente('A IA não devolveu nada agora. Tente de novo.', 502);

  const titulo = TITULO_ACAO[p.acao];
  if (p.acao === 'sugerir' || p.acao === 'melhorar') return { acao: p.acao, titulo, texto: bruto, mensagem: bruto };
  if (p.acao === 'resumir') return { acao: p.acao, titulo, texto: bruto, mensagem: null };
  return { acao: p.acao, titulo, ...separarMensagem(bruto) };
}

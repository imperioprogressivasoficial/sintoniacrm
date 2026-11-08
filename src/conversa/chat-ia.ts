import type Anthropic from '@anthropic-ai/sdk';
import type { Conversa } from '../domain.js';
import type { ClienteClaude } from '../ai/agente.js';
import type { ItemAgenda } from '../agenda/agenda-dia.js';
import { UNIDADES } from '../unidades.js';
import { partesBahia } from '../util/tempo.js';
import { ErroAssistente } from './assistente.js';

/**
 * "Ajuda da IA" da bolinha de acesso rápido: um chat (como o ChatGPT) para a equipe do salão.
 * A IA só responde com base no contexto que a Sintonia monta aqui (base de conhecimento, o dia da IA,
 * quem está esperando resposta e a agenda de hoje e amanhã), restrito ao que a pessoa pode ver.
 * Nada é enviado para cliente nenhuma.
 */

export const LIMITE_HISTORICO = 20;
export const LIMITE_TEXTO = 4000;

export interface MensagemChat {
  papel: 'usuario' | 'ia';
  texto: string;
}

export interface ContextoChat {
  agora: Date;
  pessoa?: { nome: string; papel?: string };
  baseConhecimento: string;
  /** Resultado de iaHoje (já filtrado pelo que a pessoa vê). */
  hoje: {
    conversasAtendidas: number;
    respostas: number;
    assumiu: number;
    agendamentos: { total: number };
    pediuAjuda: { total: number; lista: Array<{ cliente: string | null; motivo: string | null }> };
    envios: { total: number; lembretes: number; followups: number };
    tempoMedioRespostaSeg: number | null;
    conduzindoAgora: unknown[];
  };
  /** Conversas visíveis cuja última mensagem é da cliente (esperando resposta). */
  esperando: Conversa[];
  /** Agendamentos de hoje e amanhã (já filtrados pelo escopo). */
  agenda: ItemAgenda[];
}

const INSTRUCOES = `Você é a "Ajuda da IA" da Sintonia, o CRM de WhatsApp da Império Progressivas (salões de alisamento e progressiva em Salvador). Quem fala com você é alguém da equipe do salão (atendente, gerente ou direção), nunca uma cliente.
Regras:
- Português do Brasil, tom simples, direto e gentil. Respostas curtas; use listas com "- " quando ajudar. Pode usar **negrito** com moderação. Sem títulos com #.
- Baseie números, nomes, horários, preços e regras SOMENTE no <contexto> abaixo. Se a informação não estiver lá, diga claramente que não sabe ou que não tem esse dado aqui, e sugira onde conferir no app (Conversas, Agenda, CRM, Painel). Nunca invente números.
- Você pode escrever mensagens prontas para a equipe mandar às clientes (ex.: chamar clientes sumidas), no jeito de WhatsApp, curtas e calorosas, sem prometer preço ou horário que não esteja no contexto.
- Você não executa ações no sistema (não envia, não agenda, não move no CRM); explique como a pessoa faz pelo app quando perguntarem.`;

const hm = (d: Date) => {
  const p = partesBahia(d);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
};
const dataBr = (d: Date) => {
  const p = partesBahia(d);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
};
const nomeUnidade = (u: string) => (UNIDADES as Record<string, { nome: string }>)[u]?.nome ?? u;

/** Texto do contexto que vai para a IA. */
export function montarContexto(c: ContextoChat): string {
  const linhas: string[] = [];
  linhas.push(`Agora: ${dataBr(c.agora)} ${hm(c.agora)} (horário da Bahia).`);
  if (c.pessoa) linhas.push(`Quem pergunta: ${c.pessoa.nome}${c.pessoa.papel ? ` (${c.pessoa.papel})` : ''}. Os dados abaixo já são só o que essa pessoa pode ver.`);

  const h = c.hoje;
  linhas.push(
    '',
    '<ia_hoje>',
    `Conversas atendidas pela IA hoje: ${h.conversasAtendidas}`,
    `Respostas enviadas pela IA hoje: ${h.respostas}`,
    `Vezes que a IA assumiu conversa parada: ${h.assumiu}`,
    `Agendamentos feitos pela IA hoje: ${h.agendamentos.total}`,
    `Conversas que a IA passou para a equipe hoje: ${h.pediuAjuda.total}${h.pediuAjuda.lista.length ? ` (${h.pediuAjuda.lista.slice(0, 10).map((p) => `${p.cliente ?? 'sem nome'}${p.motivo ? `: ${p.motivo}` : ''}`).join('; ')})` : ''}`,
    `Mensagens ativas enviadas hoje: ${h.envios.total} (lembretes: ${h.envios.lembretes}, follow-ups: ${h.envios.followups})`,
    `Tempo médio de resposta da IA hoje: ${h.tempoMedioRespostaSeg === null ? 'sem dado' : `${h.tempoMedioRespostaSeg} s`}`,
    `Conversas que a IA está conduzindo agora: ${h.conduzindoAgora.length}`,
    '</ia_hoje>',
  );

  const agoraMs = c.agora.getTime();
  const esperando = [...c.esperando].sort((a, b) => (a.ultimaMensagemCliente?.getTime() ?? 0) - (b.ultimaMensagemCliente?.getTime() ?? 0));
  linhas.push('', `<esperando_resposta total="${esperando.length}">`);
  for (const e of esperando.slice(0, 25)) {
    const min = Math.max(0, Math.round((agoraMs - (e.ultimaMensagemCliente?.getTime() ?? agoraMs)) / 60_000));
    const espera = min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dia(s)`;
    linhas.push(`- ${e.nome ?? 'Sem nome'} · ${nomeUnidade(e.unidade)} · esperando há ${espera} · quem responde: ${e.modo === 'ia' ? 'IA' : 'equipe'}${e.responsavelNome ? ` · dona: ${e.responsavelNome}` : ''}`);
  }
  if (esperando.length > 25) linhas.push(`- … e mais ${esperando.length - 25}`);
  if (!esperando.length) linhas.push('(ninguém esperando resposta agora)');
  linhas.push('</esperando_resposta>');

  const hojeDia = partesBahia(c.agora).dia;
  linhas.push('', '<agenda_hoje_e_amanha observacao="só o que foi marcado pela Sintonia (IA ou botão Agendar); o que foi marcado direto no sistema de agenda não aparece">');
  for (const a of c.agenda.slice(0, 60)) {
    const dia = partesBahia(a.inicio).dia === hojeDia ? 'hoje' : 'amanhã';
    linhas.push(`- ${dia} ${hm(a.inicio)} · ${a.cliente ?? 'Sem nome'} · ${a.servico ?? 'serviço não informado'}${a.profissional ? ` com ${a.profissional}` : ''} · ${nomeUnidade(a.unidade)} · marcado por ${a.por}`);
  }
  if (!c.agenda.length) linhas.push('(nenhum agendamento registrado para hoje e amanhã)');
  linhas.push('</agenda_hoje_e_amanha>');
  return linhas.join('\n');
}

/** Últimas mensagens no formato da API: começa pela pessoa, alterna papéis e termina na pessoa. */
export function paraMensagensClaude(mensagens: MensagemChat[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const recentes = mensagens
    .map((m) => ({ papel: m.papel, texto: String(m.texto ?? '').trim().slice(0, LIMITE_TEXTO) }))
    .filter((m) => m.texto)
    .slice(-LIMITE_HISTORICO);
  const saida: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of recentes) {
    const role = m.papel === 'ia' ? 'assistant' : 'user';
    const ultima = saida.at(-1);
    if (ultima && ultima.role === role) ultima.content += `\n\n${m.texto}`;
    else saida.push({ role, content: m.texto });
  }
  while (saida.length && saida[0]!.role !== 'user') saida.shift();
  if (!saida.length || saida.at(-1)!.role !== 'user') throw new ErroAssistente('Escreva sua pergunta.', 400);
  return saida;
}

export async function conversarComIa(
  claude: ClienteClaude,
  opcoes: { modelo: string },
  mensagens: MensagemChat[],
  contexto: ContextoChat,
): Promise<{ texto: string }> {
  const msgs = paraMensagensClaude(mensagens);
  const resp = await claude.beta.messages.create({
    model: opcoes.modelo,
    max_tokens: 4000,
    system: [
      { type: 'text', text: `${INSTRUCOES}\n\n<base_de_conhecimento>\n${contexto.baseConhecimento || '(vazia)'}\n</base_de_conhecimento>`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `<contexto>\n${montarContexto(contexto)}\n</contexto>` },
    ],
    messages: msgs,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (resp.stop_reason === 'refusal') throw new ErroAssistente('A IA não quis responder este pedido. Tente perguntar de outro jeito.', 422);
  const texto = resp.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!texto) throw new ErroAssistente('A IA não devolveu nada agora. Tente de novo.', 502);
  return { texto };
}

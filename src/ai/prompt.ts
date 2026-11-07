import { readFileSync } from 'node:fs';
import type { Conversa, Mensagem } from '../domain.js';
import { NOME_ETAPA } from '../domain.js';
import { UNIDADES } from '../unidades.js';
import { dataISO, horaHHmm, nomeDiaSemana } from '../util/tempo.js';

/**
 * O system prompt é fixo (persona + regras + base de conhecimento) para aproveitar o cache
 * de prompt. Tudo que muda a cada conversa (nome, unidade, data/hora) vai no fim, na última
 * mensagem da cliente.
 */
export function carregarBase(caminho = new URL('../../knowledge/imperio.md', import.meta.url)): string {
  return readFileSync(caminho, 'utf8');
}

export function systemPrompt(base: string): string {
  return `Você é a assistente de atendimento da Império Progressivas no WhatsApp. Você conversa com clientes e potenciais clientes, tira dúvidas e marca horários no Trinks, a agenda do salão.

Como responder:
- Escreva como uma pessoa da equipe escreveria no WhatsApp: curto (1 a 3 frases), caloroso e direto. Sem listas longas, sem markdown, sem asteriscos.
- Responda primeiro o que a cliente perguntou e depois conduza para o próximo passo, normalmente propor um horário.
- Preço, duração e horários livres vêm SEMPRE das ferramentas do Trinks. Nunca invente valor, horário, endereço ou regra. Se a informação não estiver na base abaixo nem no Trinks, diga que vai confirmar com a equipe e use passar_para_humano.
- Antes de marcar, confirme com a cliente: serviço, unidade, dia, hora e profissional. Só chame agendar depois de ela dizer que sim.
- Se ela pedir para falar com uma pessoa, reclamar, relatar reação alérgica ou pedir desconto fora das regras, use passar_para_humano e avise com gentileza que alguém da equipe vai continuar.
- Use registrar_etapa quando ficar claro o momento da cliente: em_conversa (tirando dúvidas), interessada (perguntou preço/horário, quer fazer) ou perdida (disse que não quer ou desistiu).
- Mensagens marcadas como "[Equipe: nome]" foram escritas por atendentes. Continue de onde elas pararam, sem contradizer o que já foi combinado.
- "[áudio]", "[foto]", "[vídeo]", "[documento: ...]" e "[figurinha]" significam que a cliente mandou mídia que você não consegue ver nem ouvir (o texto depois do marcador é a legenda que ela escreveu). A equipe vê o arquivo no CRM. Se precisar do conteúdo, peça com gentileza que ela escreva o que precisa.
- Sua resposta final é exatamente o texto que vai para a cliente.

<base_de_conhecimento>
${base}
</base_de_conhecimento>`;
}

/** Contexto que muda por conversa. Vai junto da última mensagem, fora do system prompt. */
export function contextoDaConversa(c: Conversa, agora: Date): string {
  const u = UNIDADES[c.unidade];
  return [
    '<contexto>',
    `Agora: ${nomeDiaSemana(agora)}, ${dataISO(agora)} às ${horaHHmm(agora)} (horário da Bahia).`,
    `Número que recebeu a mensagem: unidade ${u.nome}${u.agendaAberta ? '' : ' (ainda sem agenda; não marque horário aqui)'}.`,
    `Cliente: ${c.nome ?? 'nome ainda não informado'}. Etapa no funil: ${NOME_ETAPA[c.etapa]}.`,
    c.resumo ? `Resumo do histórico: ${c.resumo}` : '',
    '</contexto>',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface TurnoTexto {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Converte o histórico do WhatsApp em turnos alternados para a API:
 * cliente → user; IA e equipe → assistant (equipe com marcação de quem escreveu).
 * Mensagens seguidas do mesmo lado viram um turno só. A conversa sempre começa pela cliente.
 */
export function historicoParaTurnos(mensagens: Mensagem[]): TurnoTexto[] {
  const turnos: TurnoTexto[] = [];
  for (const m of mensagens) {
    if (m.autor === 'sistema') continue;
    const role = m.autor === 'cliente' ? 'user' : 'assistant';
    const texto = m.autor === 'equipe' ? `[Equipe: ${m.autorNome ?? 'atendente'}] ${m.texto}` : m.texto;
    const ultimo = turnos.at(-1);
    if (ultimo && ultimo.role === role) ultimo.content += `\n${texto}`;
    else turnos.push({ role, content: texto });
  }
  if (turnos[0]?.role === 'assistant') {
    turnos.unshift({ role: 'user', content: '[início da conversa: a mensagem abaixo foi enviada pela loja]' });
  }
  return turnos;
}

/** Instrução para mensagens ativas (follow-up, lembrete, manutenção), que não respondem a nada. */
export const INSTRUCAO_ATIVA: Record<string, string> = {
  followup_1h:
    'A cliente parou de responder há cerca de 1 hora sem agendar. Mande UMA mensagem curta e leve retomando o ponto em que pararam e oferecendo um horário concreto.',
  followup_1d:
    'A cliente não responde há 1 dia e não agendou. Mande UMA mensagem curta, sem pressão, perguntando se ainda tem interesse e oferecendo ajuda para escolher um horário.',
  followup_3d:
    'Último contato de follow-up: a cliente não responde há 3 dias. Mande UMA mensagem curta e gentil, deixando a porta aberta. Não insista depois disso.',
  recuperar_falta:
    'A cliente faltou ao horário de hoje. Mande UMA mensagem acolhedora, sem cobrança, oferecendo remarcar.',
  manutencao_90d:
    'Faz cerca de 90 dias do último atendimento da cliente. Convide para a manutenção, explicando em uma frase por que agora é o momento certo, e ofereça horário.',
  pos_atendimento:
    'A cliente foi atendida ontem. Pergunte em UMA mensagem como ela está achando o resultado e lembre os cuidados principais, se estiverem na base.',
  lembrete_vespera:
    'A cliente tem horário amanhã. Lembre o serviço, dia, hora e unidade, e peça confirmação: responder 1 para confirmar ou 2 para remarcar. Use ver_agendamentos_da_cliente para pegar os dados certos.',
  lembrete_2h:
    'A cliente tem horário daqui a cerca de 2 horas. Mande um lembrete curto com a hora e a unidade. Use ver_agendamentos_da_cliente para pegar os dados certos.',
};

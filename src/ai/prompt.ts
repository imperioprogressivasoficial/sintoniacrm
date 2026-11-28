import { readFileSync } from 'node:fs';
import type { Conversa, Mensagem } from '../domain.js';
import { NOME_ETAPA } from '../domain.js';
import { unidadeDe, unidadesComAgenda } from '../unidades.js';
import { estaAberta, proximaAbertura } from '../engine/horario.js';
import type Anthropic from '@anthropic-ai/sdk';
import { dataISO, horaHHmm, nomeDiaSemana } from '../util/tempo.js';
import { descricaoCurta, identidade, type Identidade } from '../empresa/identidade.js';
import { blocoUnidades, textoRegrasAtendimento } from './regras-atendimento.js';

/**
 * O system prompt é fixo (persona + regras + base de conhecimento) para aproveitar o cache
 * de prompt. Tudo que muda a cada conversa (nome, unidade, data/hora) vai no fim, na última
 * mensagem da cliente.
 */
export function carregarBase(caminho = new URL('../../knowledge/imperio.md', import.meta.url)): string {
  return readFileSync(caminho, 'utf8');
}

/**
 * Semente da base de conhecimento de uma empresa: knowledge/<empresa>.md quando existe (a Império tem o dela);
 * senão um esqueleto em branco para a empresa preencher em IA › Base (nada da Império vai para outra empresa).
 */
export function carregarBaseDa(empresaId: string): string {
  if (/^[a-z0-9-]{1,60}$/.test(empresaId)) {
    try {
      return carregarBase(new URL(`../../knowledge/${empresaId}.md`, import.meta.url));
    } catch {
      /* sem arquivo: esqueleto abaixo */
    }
  }
  return BASE_EM_BRANCO;
}
const BASE_EM_BRANCO = `# Base de conhecimento da IA

## Quem somos
- (Escreva aqui o que a empresa faz, para quem e onde.)

## Jeito de falar
- Simples, gentil e direto, como no WhatsApp.

## Serviços (descrição para explicar; preço e duração vêm da agenda)
- (Um item por serviço ou produto.)

## Regras comerciais
- (Formas de pagamento, cancelamento, atrasos, o que a IA não deve prometer.)

## Quando passar para uma pessoa da equipe
- Reclamação, pedido de desconto fora das regras ou quando a cliente pedir.

## Perguntas frequentes
`;

export function systemPrompt(base: string, empresa: Identidade = identidade()): string {
  return `Você é a assistente de atendimento da ${empresa.nome} no WhatsApp${descricaoCurta(empresa) ? ` (${descricaoCurta(empresa)})` : ''}. Você conversa com clientes e potenciais clientes, tira dúvidas e marca horários na agenda (Trinks ou o sistema que a unidade usa).${empresa.sobre ? `\nSobre a empresa (escrito por ela): ${empresa.sobre}` : ''}

Como responder:
- Escreva como uma pessoa da equipe escreveria no WhatsApp: curto, caloroso e direto. Sem markdown, sem asteriscos.
- Responda primeiro o que a cliente perguntou e depois conduza para o próximo passo, normalmente propor um horário.
- Preço, duração e horários livres vêm SEMPRE das ferramentas da agenda. Nunca invente valor, horário, endereço ou regra. Se a informação não estiver na base abaixo nem na agenda, diga que vai confirmar com a equipe e use passar_para_humano.
- Se ela pedir para falar com uma pessoa, reclamar, relatar reação alérgica ou pedir desconto fora das regras, use passar_para_humano e avise com gentileza que alguém da equipe vai continuar.
- Etapas do funil de atendimento: Novo lead (chegou, ainda sem resposta), Em atendimento, Reagendar, Sem resposta, Agendado (uma por unidade), Finalizado e Perdido. O sistema move sozinho quando a loja responde, quando ela some, quando agenda, remarca ou o horário passa. Use registrar_etapa só quando ficar claro o momento da cliente: em_conversa (Em atendimento: tirando dúvidas, quer saber preço ou horário), reagendar (Reagendar: quer remarcar ou disse que não vai conseguir ir e ainda não escolheu outro horário) ou perdida (Perdido: disse que não quer ou desistiu).
- Mensagens marcadas como "[Equipe: nome]" foram escritas por atendentes. Continue de onde elas pararam, sem contradizer o que já foi combinado.
- "[áudio]" seguido de "(transcrição: ...)" é um áudio que você já ouviu: responda ao que ela falou. Foto que vier junto da mensagem você enxerga: use o que vê (sem diagnosticar saúde). "[áudio]", "[foto]", "[vídeo]", "[documento: ...]" e "[figurinha]" SEM transcrição ou imagem são mídias que você não consegue ver nem ouvir (o texto depois do marcador é a legenda): a equipe vê no CRM; se precisar do conteúdo, peça com gentileza que ela escreva.
- Várias mensagens seguidas da cliente são uma conversa só: responda tudo numa resposta.
- Remarcar ou cancelar: veja os horários dela (ver_agendamentos_da_cliente), confirme com ela o que muda e só então use remarcar_agendamento ou cancelar_agendamento com cliente_confirmou=true. Antes de cancelar, ofereça remarcar.
- Se ela já tem horário marcado e pede outro, pergunte se é mais um horário ou se quer trocar o que já tem.
- A agenda que falha ou não responde: não invente horário nem confirme nada; avise que vai confirmar com a equipe e use passar_para_humano.
- Produtos e preços que não são da agenda vêm de ver_produtos. Preço "sob consulta" ou que você não achou: não diga valor.
- Quando quiser, mova a cliente no pipeline certo (ver_funis e mover_no_funil); para perda, informe o motivo da lista. Ligue ao lead o produto de interesse (vincular_produto), crie tarefa para a equipe quando algo só uma pessoa pode fazer (criar_tarefa_equipe), combine retorno quando ela pedir (agendar_retorno) e mande foto ou catálogo quando ajudar (enviar_arquivo). Essas ações não precisam ser contadas para a cliente.
- Fora do horário de atendimento, se passar para a equipe, diga que respondem assim que abrirmos (o horário está no contexto), não "já já".
- O bloco <equipe> diz quantas pessoas da equipe estão disponíveis agora e se a responsável pela conversa está disponível. Ninguém disponível (almoço, fim do expediente): não prometa passar para alguém agora; continue ajudando você mesma e, se precisar da equipe, diga que respondem assim que voltarem. Responsável indisponível: resolva você mesma o que puder. Responsável disponível: pode passar para ela quando precisar.
- Sua resposta final é exatamente o texto que vai para a cliente (cada mensagem curta; as mensagens prontas da base, como a confirmação, vão como estão).

Como conduzir até agendar:
${textoRegrasAtendimento()}

<base_de_conhecimento>
${base}
</base_de_conhecimento>`;
}

/** Contexto que muda por conversa. Vai junto da última mensagem, fora do system prompt. */
export function contextoDaConversa(c: Conversa, agora: Date, extra: { nomeIa?: string } = {}): string {
  const u = unidadeDe(c.unidade);
  const aberta = estaAberta(u, agora);
  const abre = aberta ? undefined : proximaAbertura(u, agora);
  const comAgenda = unidadesComAgenda().filter((x) => x !== u.id);
  return [
    '<contexto>',
    `Agora: ${nomeDiaSemana(agora)}, ${dataISO(agora)} às ${horaHHmm(agora)} (horário da Bahia).`,
    `Número que recebeu a mensagem: unidade ${u.nome}${u.agendaAberta ? '' : ' (ainda sem agenda; não marque horário aqui)'}.`,
    aberta
      ? 'A equipe está em horário de atendimento agora.'
      : `A equipe está fora do horário de atendimento agora${abre ? `; volta ${dataISO(abre) === dataISO(agora) ? 'hoje' : `${nomeDiaSemana(abre)} (${dataISO(abre)})`} às ${horaHHmm(abre)}` : ''}.`,
    comAgenda.length ? `Outras unidades que marcam horário: ${comAgenda.map((x) => `${unidadeDe(x).nome} (${x})`).join(', ')}. Se a cliente quiser outra unidade, use a unidade dela nas ferramentas.` : '',
    `Cliente: ${c.nome ? `"${c.nome}" é como ela aparece no WhatsApp (pode ser apelido ou frase, ex.: "Deus é fiel"): NUNCA chame a cliente por esse nome; use só o nome que ela mesma disser ou o nome do cadastro em <cliente_conhecida>` : 'nome ainda não informado'}. Etapa no funil: ${NOME_ETAPA[c.etapa]}.`,
    extra.nomeIa ? `Seu nome (para se apresentar): ${extra.nomeIa}.` : '',
    c.resumo ? `Resumo do histórico: ${c.resumo}` : '',
    '</contexto>',
    blocoUnidades(c.empresaId), // serena-regras: a pergunta da unidade pronta, uma por linha
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Objetivo do "fluxo de IA" de uma automação (ex.: "qualificar e agendar a avaliação"). Vai junto da
 * última mensagem, fora do system prompt (não quebra o cache), e vale enquanto o fluxo estiver ativo.
 */
export function instrucaoObjetivo(objetivo: string): string {
  return `<objetivo_da_loja>${objetivo.trim()}</objetivo_da_loja>\nEste objetivo foi definido pela loja para esta conversa (não pela cliente). Conduza a conversa na direção dele, sem pular as regras de atendimento e sem inventar informação.`;
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
  retorno_ia:
    'Você combinou com a cliente de voltar a falar com ela agora (o motivo está nas notas internas). Mande UMA mensagem curta retomando exatamente esse assunto.',
};

/** ia-completa: notas que a Sintonia/IA deixam na conversa (mensagens de sistema que começam com o robô). */
export const PREFIXO_NOTA_IA = '🤖 ';

/**
 * ia-completa: o que a IA percebeu das mídias da cliente antes de pensar: transcrição dos áudios e as fotos
 * (por id da mensagem). Fora daqui, mídia continua sendo só o marcador.
 */
export type Percepcao = Map<string, { transcricao?: string; imagem?: { base64: string; mimetype: string } }>;

type Bloco = Anthropic.Beta.Messages.BetaContentBlockParam;
type Turno = { role: 'user' | 'assistant'; content: Bloco[] };

/**
 * ia-completa: turnos para a API (agente padrão e agentes do estúdio), com áudio transcrito e foto como imagem.
 * `extras` vão no fim da última mensagem da cliente (contexto, memória, instruções), fora do system (cache).
 * No máximo 4 fotos (as mais novas) por resposta.
 */
export function montarTurnos(mensagens: Mensagem[], extras: string[], percepcao?: Percepcao): Anthropic.Beta.Messages.BetaMessageParam[] {
  const fotos = new Set(
    mensagens
      .filter((m) => m.autor === 'cliente' && percepcao?.get(m.id)?.imagem)
      .slice(-4)
      .map((m) => m.id),
  );
  const notas = mensagens.filter((m) => m.autor === 'sistema' && m.texto.startsWith(PREFIXO_NOTA_IA)).slice(-6).map((m) => `- ${m.texto.slice(PREFIXO_NOTA_IA.length)}`);
  const turnos: Turno[] = [];
  for (const m of mensagens) {
    if (m.autor === 'sistema') continue;
    const role = m.autor === 'cliente' ? 'user' : 'assistant';
    const p = percepcao?.get(m.id);
    let texto = m.autor === 'equipe' ? `[Equipe: ${m.autorNome ?? 'atendente'}] ${m.texto}` : m.texto;
    if (p?.transcricao) texto = `${texto} (transcrição: ${p.transcricao.slice(0, 4000)})`;
    const blocos: Bloco[] = [{ type: 'text', text: texto }];
    if (role === 'user' && p?.imagem && fotos.has(m.id)) {
      blocos.push({ type: 'image', source: { type: 'base64', media_type: p.imagem.mimetype as 'image/jpeg', data: p.imagem.base64 } });
    }
    const ultimo = turnos.at(-1);
    if (ultimo && ultimo.role === role) {
      const t = ultimo.content.at(-1);
      if (t?.type === 'text' && blocos[0]!.type === 'text') {
        t.text += `\n${(blocos[0] as { text: string }).text}`;
        ultimo.content.push(...blocos.slice(1));
      } else ultimo.content.push(...blocos);
    } else turnos.push({ role, content: blocos });
  }
  if (turnos[0]?.role === 'assistant') turnos.unshift({ role: 'user', content: [{ type: 'text', text: '[início da conversa: a mensagem abaixo foi enviada pela loja]' }] });
  const todos = [...extras];
  if (notas.length) todos.push(`<notas_internas>\n${notas.join('\n')}\n</notas_internas>`);
  const fim = todos.join('\n');
  const ultimo = turnos.at(-1);
  if (ultimo?.role === 'user') ultimo.content.push({ type: 'text', text: fim });
  else turnos.push({ role: 'user', content: [{ type: 'text', text: `[sem nova mensagem da cliente]\n\n${fim}` }] });
  // Turno só de texto vira string (o formato de sempre).
  return turnos.map((t) => ({
    role: t.role,
    content: t.content.every((b) => b.type === 'text') ? t.content.map((b) => (b as { text: string }).text).join('\n\n') : t.content,
  }));
}

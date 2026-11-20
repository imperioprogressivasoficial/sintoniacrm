import type Anthropic from '@anthropic-ai/sdk';
import type { Conversa } from '../domain.js';
import type { ClienteClaude } from '../ai/agente.js';
import type { ItemAgenda } from '../agenda/agenda-dia.js';
import { UNIDADES } from '../unidades.js';
import { partesBahia } from '../util/tempo.js';
import { ErroAssistente } from './assistente.js';
import type { SugestaoLigacao } from '../app/ligacoes.js';

/**
 * Serena (botão do meio da barra; antes "Ajuda da IA"): um chat (como o ChatGPT) para a equipe do salão.
 * A IA só responde com base no contexto que a Sintonia monta aqui (base de conhecimento, o dia da IA,
 * quem está esperando resposta e a agenda de hoje e amanhã), restrito ao que a pessoa pode ver.
 * Nada é enviado para cliente nenhuma.
 */

export const LIMITE_HISTORICO = 20;
export const LIMITE_TEXTO = 4000;

/** Imagem anexada (print de conversa, foto): só na última mensagem da pessoa; nunca fica guardada. */
export const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Tamanho máximo da imagem em base64 (~1,5 MB de arquivo). O app reduz antes de mandar. */
export const LIMITE_IMAGEM_B64 = 2_000_000;

export interface ImagemChat {
  tipo: (typeof TIPOS_IMAGEM)[number];
  dados: string;
}

export interface MensagemChat {
  papel: 'usuario' | 'ia';
  texto: string;
  imagem?: ImagemChat;
}

/** Cliente citada na resposta: a tela mostra uma linha que abre a conversa. */
export interface ClienteCitada {
  conversaId: string;
  nome: string | null;
  unidade: string;
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
  /** Quem ligar hoje (aba Ligações), já filtrado pelo escopo. */
  ligar?: SugestaoLigacao[];
}

const INSTRUCOES = `Você é a Serena, a assistente de IA da Sintonia, o CRM de WhatsApp da Império Progressivas (salões de alisamento e progressiva em Salvador). Quem fala com você é alguém da equipe do salão (atendente, gerente ou direção), nunca uma cliente.
Regras:
- Português do Brasil, tom simples, direto e gentil. Respostas curtas; use listas com "- " quando ajudar. Pode usar **negrito** com moderação. Sem títulos com #.
- Baseie números, nomes, horários, preços e regras SOMENTE no <contexto> abaixo. Se a informação não estiver lá, diga claramente que não sabe ou que não tem esse dado aqui, e sugira onde conferir no app (Conversas, Agenda, CRM, Ligações, Dashboard). Nunca invente números.
- Quando citar uma cliente que aparece no contexto com "ref", ponha a referência logo depois do nome, assim: Fabiana Matos [[c3]]. Para listar clientes, use um item "- " por cliente com a referência e o motivo curto. Nunca invente referências.
- Você pode escrever mensagens prontas para a equipe mandar às clientes (ex.: chamar clientes sumidas, responder quem achou caro), no jeito de WhatsApp, curtas e calorosas, sem prometer preço ou horário que não esteja no contexto. Ponha a mensagem pronta sozinha num parágrafo, entre aspas ("assim"), para a equipe copiar.
- Se a pessoa mandar uma imagem (por exemplo, o print de uma conversa), leia o que dá para ler e ajude com base nela.
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

const ordemEsperando = (c: ContextoChat) =>
  [...c.esperando].sort((a, b) => (a.ultimaMensagemCliente?.getTime() ?? 0) - (b.ultimaMensagemCliente?.getTime() ?? 0)).slice(0, 25);

/** Referências curtas ("c1", "c2"...) das clientes do contexto, na mesma ordem em que aparecem no texto. */
export function referencias(c: ContextoChat): Map<string, ClienteCitada> {
  const porConversa = new Map<string, string>();
  const refs = new Map<string, ClienteCitada>();
  const dar = (conversaId: string, nome: string | null, unidade: string) => {
    if (porConversa.has(conversaId)) return;
    const ref = `c${porConversa.size + 1}`;
    porConversa.set(conversaId, ref);
    refs.set(ref, { conversaId, nome, unidade });
  };
  for (const e of ordemEsperando(c)) dar(e.id, e.nome ?? null, e.unidade);
  for (const l of (c.ligar ?? []).slice(0, 15)) dar(l.conversaId, l.cliente, l.unidade);
  for (const a of c.agenda.slice(0, 60)) dar(a.conversaId, a.cliente, a.unidade);
  return refs;
}

/** Só as referências que a resposta usou (as inventadas somem da tela). */
export function clientesCitadas(texto: string, refs: Map<string, ClienteCitada>): Record<string, ClienteCitada> {
  const saida: Record<string, ClienteCitada> = {};
  for (const m of texto.matchAll(/\[\[(c\d{1,3})\]\]/g)) {
    const r = refs.get(m[1]!);
    if (r) saida[m[1]!] = r;
  }
  return saida;
}

/** Texto do contexto que vai para a IA. */
export function montarContexto(c: ContextoChat): string {
  const refs = new Map([...referencias(c)].map(([ref, v]) => [v.conversaId, ref]));
  const ref = (id: string) => (refs.has(id) ? ` · ref ${refs.get(id)}` : '');
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
  const esperando = c.esperando;
  linhas.push('', `<esperando_resposta total="${esperando.length}">`);
  for (const e of ordemEsperando(c)) {
    const min = Math.max(0, Math.round((agoraMs - (e.ultimaMensagemCliente?.getTime() ?? agoraMs)) / 60_000));
    const espera = min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dia(s)`;
    linhas.push(`- ${e.nome ?? 'Sem nome'} · ${nomeUnidade(e.unidade)} · esperando há ${espera} · quem responde: ${e.modo === 'ia' ? 'IA' : 'equipe'}${e.responsavelNome ? ` · dona: ${e.responsavelNome}` : ''}${ref(e.id)}`);
  }
  if (esperando.length > 25) linhas.push(`- … e mais ${esperando.length - 25}`);
  if (!esperando.length) linhas.push('(ninguém esperando resposta agora)');
  linhas.push('</esperando_resposta>');

  if (c.ligar) {
    linhas.push('', `<quem_ligar_hoje total="${c.ligar.length}" observacao="sugestões da aba Ligações">`);
    for (const l of c.ligar.slice(0, 15)) linhas.push(`- ${l.cliente ?? 'Sem nome'} · ${nomeUnidade(l.unidade)} · ${l.texto}${ref(l.conversaId)}`);
    if (c.ligar.length > 15) linhas.push(`- … e mais ${c.ligar.length - 15}`);
    if (!c.ligar.length) linhas.push('(ninguém para ligar hoje)');
    linhas.push('</quem_ligar_hoje>');
  }

  const hojeDia = partesBahia(c.agora).dia;
  linhas.push('', '<agenda_hoje_e_amanha observacao="só o que foi marcado pela Sintonia (IA ou botão Agendar); o que foi marcado direto no sistema de agenda não aparece">');
  for (const a of c.agenda.slice(0, 60)) {
    const dia = partesBahia(a.inicio).dia === hojeDia ? 'hoje' : 'amanhã';
    linhas.push(`- ${dia} ${hm(a.inicio)} · ${a.cliente ?? 'Sem nome'} · ${a.servico ?? 'serviço não informado'}${a.profissional ? ` com ${a.profissional}` : ''} · ${nomeUnidade(a.unidade)} · marcado por ${a.por}${ref(a.conversaId)}`);
  }
  if (!c.agenda.length) linhas.push('(nenhum agendamento registrado para hoje e amanhã)');
  linhas.push('</agenda_hoje_e_amanha>');
  return linhas.join('\n');
}

type Conteudo = string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: ImagemChat['tipo']; data: string } }>;

/** Imagem válida? (tipo aceito, base64 limpo e dentro do tamanho). */
export function imagemValida(i: ImagemChat | undefined): i is ImagemChat {
  return Boolean(i && (TIPOS_IMAGEM as readonly string[]).includes(i.tipo) && i.dados.length > 0 && i.dados.length <= LIMITE_IMAGEM_B64 && /^[A-Za-z0-9+/]+={0,2}$/.test(i.dados));
}

/**
 * Últimas mensagens no formato da API: começa pela pessoa, alterna papéis e termina na pessoa.
 * A imagem (se houver) só vale na última mensagem da pessoa: as antigas não ficam guardadas.
 */
export function paraMensagensClaude(mensagens: MensagemChat[]): Array<{ role: 'user' | 'assistant'; content: Conteudo }> {
  const imagem = mensagens.at(-1)?.papel === 'usuario' && imagemValida(mensagens.at(-1)!.imagem) ? mensagens.at(-1)!.imagem! : undefined;
  const recentes = mensagens
    .map((m, i) => ({ papel: m.papel, texto: String(m.texto ?? '').trim().slice(0, LIMITE_TEXTO) || (imagem && i === mensagens.length - 1 ? 'O que você vê nesta imagem? Me ajude com ela.' : '') }))
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
  if (!imagem) return saida;
  const ultima = saida.at(-1)!;
  return [...saida.slice(0, -1), { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: imagem.tipo, data: imagem.dados } }, { type: 'text', text: ultima.content }] }];
}

export async function conversarComIa(
  claude: ClienteClaude,
  opcoes: { modelo: string },
  mensagens: MensagemChat[],
  contexto: ContextoChat,
): Promise<{ texto: string; clientes?: Record<string, ClienteCitada> }> {
  const msgs = paraMensagensClaude(mensagens);
  const resp = await claude.beta.messages.create({
    model: opcoes.modelo,
    max_tokens: 4000,
    system: [
      { type: 'text', text: `${INSTRUCOES}\n\n<base_de_conhecimento>\n${contexto.baseConhecimento || '(vazia)'}\n</base_de_conhecimento>`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `<contexto>\n${montarContexto(contexto)}\n</contexto>` },
    ],
    messages: msgs as Anthropic.Beta.Messages.BetaMessageParam[],
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
  const clientes = clientesCitadas(texto, referencias(contexto));
  return Object.keys(clientes).length ? { texto, clientes } : { texto };
}

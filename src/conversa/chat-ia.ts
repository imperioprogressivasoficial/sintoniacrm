import type Anthropic from '@anthropic-ai/sdk';
import type { Conversa } from '../domain.js';
import type { ClienteClaude } from '../ai/agente.js';
import type { ItemAgenda } from '../agenda/agenda-dia.js';
import { unidadeDe } from '../unidades.js';
import { partesBahia } from '../util/tempo.js';
import { ErroAssistente } from './assistente.js';
import type { SugestaoLigacao } from '../app/ligacoes.js';
import type { AcoesSerena, Artefato } from '../serena/acoes.js';
import { apresentacao, identidade } from '../empresa/identidade.js';

/**
 * Serena (botão do meio da barra; antes "Ajuda da IA"): um chat (como o ChatGPT) para a equipe da empresa.
 * A IA só responde com base no contexto que a Sintonia monta aqui (base de conhecimento, o dia da IA,
 * quem está esperando resposta e a agenda de hoje e amanhã), restrito ao que a pessoa pode ver.
 * serena-faz: ela também envia, agenda e move, mas só pelo cartão com "Confirmar" (src/serena/fazer.ts).
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
  /** serena-faz: regras "sempre/nunca" dos agentes de IA ativos (o treinamento também vale aqui). */
  regrasEmpresa?: string;
}

/**
 * serena-faz: o que a Serena da tela é. Antes dizia "não envia mensagens, não agenda e não move conversas";
 * o dono pediu o contrário: ela FAZ (como uma gerente de vendas que trabalha), sempre com prévia e confirmação,
 * e só não inventa preço, horário ou regra: segue o treinamento (regras, princípios e valores da empresa).
 * `faz` = as ferramentas de ação estão ligadas (cartões com Confirmar); sem elas, ela só conversa e escreve.
 */
const INSTRUCOES = (faz: boolean) => `Você é a Serena, a gerente de vendas de IA da Sintonia, o CRM de WhatsApp da ${apresentacao()}. Quem fala com você é alguém da equipe da empresa (atendente, gerente ou direção), nunca uma cliente.${identidade().sobre ? `\nSobre a empresa (escrito por ela): ${identidade().sobre}` : ''}
Regras:
- Português do Brasil, tom simples, direto e gentil. Respostas curtas; use listas com "- " quando ajudar. Pode usar **negrito** com moderação. Sem títulos com #.
- Siga o treinamento da empresa: a <base_de_conhecimento> (aba Treinamento da IA) e as <regras_da_empresa> trazem as regras, os princípios e os valores dela. Eles valem mais do que o seu jeito; nunca vá contra eles, nem para agradar quem pede.
- Números, nomes, horários, preços e regras: só do <contexto>, do treinamento ou do que as ferramentas devolverem. Ao falar de preço ou duração, diga de onde veio (cadastro de Produtos e serviços ou agenda do salão). Se não estiver em nenhum desses lugares, diga claramente que não sabe e onde conferir. Nunca invente números, preços nem regras.
- Quando citar uma cliente que aparece no contexto com "ref", ponha a referência logo depois do nome, assim: Fabiana Matos [[c3]]. Para listar clientes, use um item "- " por cliente com a referência e o motivo curto. Nunca invente referências.
- Você pode escrever mensagens prontas (ex.: chamar clientes sumidas, responder quem achou caro), no jeito de WhatsApp, curtas e calorosas, sem prometer preço ou horário que não esteja no contexto. Ponha a mensagem pronta sozinha num parágrafo, entre aspas ("assim").
- Se a pessoa mandar uma imagem (por exemplo, o print de uma conversa), leia o que dá para ler e ajude com base nela.
${
  faz
    ? `O que você faz (sempre com prévia e confirmação):
- mandar mensagem para clientes, uma ou várias (monta a lista e o texto; a pessoa confere e confirma);
- agendar, remarcar e cancelar horários na agenda do salão (consulta os horários livres antes);
- mover conversas no funil/pipeline (com o motivo quando é etapa de perda);
- criar scripts de venda, fluxos de automação, links de agendamento e etiquetas;
- ler preços e durações do cadastro e da agenda do salão.
Como agir: entenda o pedido, consulte o que precisar (buscar_clientes, ver_funis, ver_produtos, consultar_horarios…) e chame a ferramenta "mostrar_…" certa. Ela vira um cartão com Confirmar e Cancelar: só a pessoa confirma. Nunca diga que já enviou, agendou, moveu ou salvou; diga que preparou e peça para conferir no cartão.
O que você não faz:
- inventar preço, horário, regra ou qualquer dado;
- agir sem a confirmação da pessoa;
- mostrar ou mexer no que esta pessoa não pode ver (as listas já vêm só com o que ela vê) nem passar do que ela tem permissão (ver <o_que_voce_pode_criar>).`
    : `Nesta tela ainda não dá para agir pelo chat: ajude com respostas, listas e mensagens prontas, e explique como fazer pelo app (Conversas, Agenda, CRM) quando pedirem para enviar, agendar ou mover.`
}`;
/** Quando a Serena pode criar coisas no CRM (ferramentas "mostrar_…"): sempre com prévia e confirmação. */
const INSTRUCOES_ACOES = `Criar coisas no CRM (scripts, fluxos de automação, links de agendamento, etiquetas):
- Converse como gente: entenda o objetivo e pergunte só o que faltar (uma ou duas perguntas por vez). Se já der para montar uma boa primeira versão, monte e deixe a pessoa ajustar.
- Para mostrar o que vai criar, chame a ferramenta "mostrar_…" certa. Ela aparece para a pessoa como um cartão com os botões Salvar, Ajustar e Abrir no app. Você NUNCA salva: só a pessoa salva, clicando em Salvar. Nunca diga que salvou ou criou; diga que montou a prévia.
- Para fluxos de automação, chame antes "consultar_crm" e use só ids reais de etapas e etiquetas. Se faltar uma etapa ou etiqueta, diga qual falta e sugira criar antes.
- Se a pessoa pedir ajuste, chame a ferramenta de novo com a versão nova inteira.
- Nas mensagens anteriores, "[cartão …]" mostra o que já foi mostrado e se a pessoa salvou ou confirmou.`;

const hm = (d: Date) => {
  const p = partesBahia(d);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
};
const dataBr = (d: Date) => {
  const p = partesBahia(d);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
};
const nomeUnidade = (u: string) => unidadeDe(u).nome;

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

/** Rodadas de ferramenta por mensagem (consultar → mostrar → corrigir…). */
export const LIMITE_RODADAS = 6;

export async function conversarComIa(
  claude: ClienteClaude,
  opcoes: { modelo: string },
  mensagens: MensagemChat[],
  contexto: ContextoChat,
  acoes?: AcoesSerena,
): Promise<{ texto: string; clientes?: Record<string, ClienteCitada>; artefatos?: Artefato[] }> {
  type Msg = Anthropic.Beta.Messages.BetaMessageParam;
  const msgs = paraMensagensClaude(mensagens) as Msg[];
  const ferramentas = acoes?.ferramentas() ?? [];
  const instrucoes = ferramentas.length ? `${INSTRUCOES(Boolean(acoes?.faz))}\n\n${INSTRUCOES_ACOES}` : INSTRUCOES(false);
  const regras = acoes ? `\n\n<o_que_voce_pode_criar>\n${acoes.regras()}\n</o_que_voce_pode_criar>` : '';
  const textos: string[] = [];
  for (let rodada = 0; ; rodada++) {
    const resp = await claude.beta.messages.create({
      model: opcoes.modelo,
      max_tokens: 8000,
      system: [
        {
          type: 'text',
          text: `${instrucoes}\n\n<base_de_conhecimento>\n${contexto.baseConhecimento || '(vazia)'}\n</base_de_conhecimento>${contexto.regrasEmpresa?.trim() ? `\n\n<regras_da_empresa observacao="do estúdio de agentes de IA">\n${contexto.regrasEmpresa.trim()}\n</regras_da_empresa>` : ''}`,
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: `<contexto>\n${montarContexto(contexto)}\n</contexto>${regras}` },
      ],
      messages: msgs,
      ...(ferramentas.length ? { tools: ferramentas } : {}),
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
    if (texto) textos.push(texto);
    const usos = resp.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !usos.length || !acoes || rodada >= LIMITE_RODADAS) break;
    // Devolve a resposta inteira (pensamento e chamadas) e todos os resultados numa mensagem só.
    msgs.push({ role: 'assistant', content: resp.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    const resultados = await Promise.all(
      usos.map(async (u) => {
        const r = await acoes.executar(u.name, u.input);
        return { type: 'tool_result' as const, tool_use_id: u.id, content: r.conteudo, ...(r.erro ? { is_error: true } : {}) };
      }),
    );
    msgs.push({ role: 'user', content: resultados });
  }
  const artefatos = acoes?.artefatos.length ? [...acoes.artefatos] : undefined;
  const acao = artefatos?.some((a) => a.tipo === 'envio' || a.tipo === 'agendamento' || a.tipo === 'mover');
  const texto = textos.join('\n\n').trim() || (artefatos ? (acao ? 'Preparei abaixo. Confira e, se estiver certo, toque em Confirmar.' : 'Montei a prévia abaixo. Quer salvar ou ajustar alguma coisa?') : '');
  if (!texto) throw new ErroAssistente('A IA não devolveu nada agora. Tente de novo.', 502);
  const clientes = clientesCitadas(texto, referencias(contexto));
  return { texto, ...(Object.keys(clientes).length ? { clientes } : {}), ...(artefatos ? { artefatos } : {}) };
}

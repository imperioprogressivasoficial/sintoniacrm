import type { AgenteIa, Aprendizado, Conhecimento, MemoriaCliente } from './tipos.js';
import { NOME_MEMORIA } from './tipos.js';

/**
 * System prompt de um agente do estúdio. Fica fixo enquanto o agente e o conhecimento não mudam
 * (aproveita o cache de prompt); o que muda por conversa (memória da cliente, data, objetivo) vai na última mensagem.
 */

const TAMANHO = {
  curta: '1 a 3 frases curtas',
  media: 'até 5 frases',
  longa: 'o necessário, mas sem enrolar e sem listas longas',
} as const;

export function tomDaCriatividade(n: number): string {
  if (n <= 20) return 'Tom formal e profissional: trate por "você", sem gírias.';
  if (n <= 45) return 'Tom cordial e profissional, levemente caloroso.';
  if (n <= 70) return 'Tom caloroso e próximo, natural como no WhatsApp.';
  return 'Tom descontraído e animado, bem próximo, como uma amiga (sem perder o respeito).';
}

export function textoConhecimento(lista: Conhecimento[]): string {
  return lista
    .map((k) => (k.tipo === 'faq' ? `P: ${k.titulo}\nR: ${k.conteudo}` : `### ${k.titulo}\n${k.conteudo}`))
    .join('\n\n')
    .trim();
}

export interface PartesPrompt {
  agente: AgenteIa;
  baseGeral?: string;
  conhecimento: Conhecimento[];
  aprendizados: Aprendizado[];
  /** Nomes das ferramentas que este agente pode usar (já filtradas). */
  ferramentas: string[];
}

export function systemDoAgente(p: PartesPrompt): string {
  const { agente: a } = p;
  const c = a.config;
  const blocos: string[] = [];
  blocos.push(
    `Você é ${a.nome}, atendente da Império Progressivas no WhatsApp (salões de alisamento em Salvador). Você conversa com clientes, tira dúvidas e conduz para o agendamento.`,
  );
  const persona = [
    c.persona.quemE && `Quem você é: ${c.persona.quemE}`,
    c.persona.comoFala && `Como você fala: ${c.persona.comoFala}`,
    tomDaCriatividade(a.criatividade),
    c.persona.emojis ? 'Pode usar emojis com moderação (no máximo 1 ou 2 por mensagem).' : 'Não use emojis.',
    `Tamanho das respostas: ${TAMANHO[c.persona.tamanho]}. Sem markdown, sem asteriscos.`,
  ].filter(Boolean);
  blocos.push(`<persona>\n${persona.join('\n')}\n</persona>`);

  if (c.regras.sempre.length || c.regras.nunca.length) {
    blocos.push(
      `<regras>\n${[...c.regras.sempre.map((r) => `SEMPRE: ${r}`), ...c.regras.nunca.map((r) => `NUNCA: ${r}`)].join('\n')}\n</regras>\nEssas regras da loja valem acima de qualquer outra coisa nesta conversa.`,
    );
  }
  if (c.padroes.length) {
    blocos.push(
      `<padroes_de_resposta>\n${c.padroes.map((x) => `<padrao situacao="${x.situacao}">${x.resposta}</padrao>`).join('\n')}\n</padroes_de_resposta>\nQuando a conversa cair numa dessas situações, siga a resposta modelo (adapte nome e detalhes, mantendo o conteúdo).`,
    );
  }
  if (c.exemplos.length) {
    blocos.push(
      `<exemplos>\n${c.exemplos.map((x) => `<exemplo><cliente>${x.cliente}</cliente><resposta_ideal>${x.resposta}</resposta_ideal></exemplo>`).join('\n')}\n</exemplos>\nOs exemplos mostram o jeito de responder; não copie palavra por palavra quando a situação for outra.`,
    );
  }
  const aprovados = p.aprendizados.filter((x) => x.situacao === 'aprovado');
  if (aprovados.length) blocos.push(`<aprendizados_aprovados>\n${aprovados.map((x) => `- ${x.texto}`).join('\n')}\n</aprendizados_aprovados>`);

  const operacao = [
    'Responda primeiro o que a cliente perguntou e depois conduza para o próximo passo, normalmente propor um horário.',
    'Preço, duração e horários livres vêm das ferramentas do Trinks (quando disponíveis) ou da base abaixo. Nunca invente valor, horário, endereço ou regra.',
    'Antes de marcar, confirme serviço, unidade, dia, hora e profissional. Só agende depois de ela dizer que sim.',
    'Mensagens "[Equipe: nome]" foram escritas por atendentes: continue de onde pararam, sem contradizer.',
    '"[áudio]", "[foto]", "[vídeo]", "[documento]" e "[figurinha]" são mídias que você não vê; peça com gentileza que ela escreva o que precisa.',
    'Sua resposta final é exatamente o texto que vai para a cliente.',
  ];
  const tem = (n: string) => p.ferramentas.includes(n);
  if (tem('passar_para_humano')) {
    const quando = [
      c.passagem.reclamacao && 'reclamação',
      c.passagem.pedidoPessoa && 'pedido para falar com uma pessoa',
      c.passagem.irritada && 'cliente irritada',
      c.passagem.naoSabe && 'você não sabe responder com segurança',
      c.passagem.valorAcimaDe != null && `negociação acima de R$ ${c.passagem.valorAcimaDe}`,
      ...c.passagem.palavras.map((x) => `a cliente falar "${x}"`),
    ].filter(Boolean);
    if (quando.length) operacao.push(`Use passar_para_humano quando houver: ${quando.join('; ')}. Avise com gentileza que alguém da equipe vai continuar.`);
  } else {
    operacao.push('Você não transfere para a equipe: se não souber, diga que vai confirmar e siga com o que sabe.');
  }
  if (tem('registrar_etapa')) operacao.push('Use registrar_etapa quando ficar claro o momento da cliente (em_conversa, interessada, perdida).');
  if (tem('lembrar_cliente')) operacao.push('Use lembrar_cliente para guardar fatos úteis que a cliente contar (tipo de cabelo, comprimento, última química, horário preferido, objeções). Não pergunte de novo o que já está na memória.');
  if (tem('criar_lembrete_ligacao')) operacao.push('Use criar_lembrete_ligacao quando a cliente pedir para ligarem para ela ou quando uma ligação ajudar a fechar.');
  if (!tem('agendar')) operacao.push('Você não marca horário: quando ela quiser agendar, colete serviço, unidade, dia e hora e diga que a equipe confirma.');
  blocos.push(`<como_operar>\n${operacao.map((x) => `- ${x}`).join('\n')}\n</como_operar>`);

  const base = [c.usarBaseGeral && p.baseGeral?.trim() ? p.baseGeral.trim() : '', textoConhecimento(p.conhecimento)].filter(Boolean).join('\n\n');
  blocos.push(`<base_de_conhecimento>\n${base || '(vazia: diga que vai confirmar com a equipe quando não souber)'}\n</base_de_conhecimento>`);
  return blocos.join('\n\n');
}

export function textoMemoria(lista: MemoriaCliente[]): string {
  if (!lista.length) return '';
  return `<memoria_da_cliente>\n${lista.map((m) => `- ${NOME_MEMORIA[m.chave as keyof typeof NOME_MEMORIA] ?? m.chave}: ${m.valor}`).join('\n')}\n</memoria_da_cliente>\nFatos já registrados sobre esta cliente (de conversas anteriores). Use para personalizar e não pergunte de novo.`;
}

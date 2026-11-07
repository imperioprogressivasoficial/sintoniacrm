import type { AgenteIa, Conhecimento } from './tipos.js';

/**
 * Nota de qualidade do agente (0 a 10) com sugestões. É uma conferência do que está configurado,
 * feita sem IA: funciona mesmo sem chave.
 */
export interface NotaAgente {
  nota: number;
  itens: Array<{ ok: boolean; texto: string; peso: number }>;
  sugestoes: string[];
}

export function notaDoAgente(a: AgenteIa, conhecimento: Conhecimento[], aprovados: number, baseGeralTemConteudo: boolean): NotaAgente {
  const c = a.config;
  const itens: NotaAgente['itens'] = [];
  const sugestoes: string[] = [];
  const conta = (ok: boolean, texto: string, peso: number, sugestao: string) => {
    itens.push({ ok, texto, peso });
    if (!ok) sugestoes.push(sugestao);
  };
  conta(c.persona.quemE.length >= 20, 'Persona descrita', 1.5, 'Escreva quem é o agente (nome, especialidade, para quem fala).');
  conta(c.persona.comoFala.length >= 15, 'Jeito de falar definido', 1, 'Descreva como ele fala (ex.: “calorosa, chama pelo nome, frases curtas”).');
  conta(c.regras.sempre.length + c.regras.nunca.length >= 3, 'Pelo menos 3 regras', 1.5, 'Adicione regras do que SEMPRE e NUNCA fazer (ex.: “nunca dar preço sem perguntar o comprimento”).');
  conta(c.padroes.length >= 2, 'Padrões de resposta', 1.5, 'Cadastre respostas modelo para preço, horário, gestante, química anterior e promoção.');
  conta(c.exemplos.length >= 2, 'Exemplos de conversa', 1.5, 'Adicione pelo menos 2 exemplos de “cliente pergunta → resposta ideal”.');
  conta(conhecimento.length > 0 || (c.usarBaseGeral && baseGeralTemConteudo), 'Tem conhecimento', 1.5, 'Dê conhecimento ao agente: use a base geral ou adicione textos, perguntas e respostas ou um link.');
  conta(c.ferramentas.includes('transferir'), 'Pode passar para a equipe', 0.5, 'Ligue “Transferir para a equipe” para ele não ficar sem saída.');
  conta(c.ferramentas.includes('responder'), 'Pode responder', 0.5, 'Ligue “Responder a cliente”, senão ele só organiza o CRM.');
  conta(aprovados > 0, 'Já aprendeu com a equipe', 0.5, 'Aprove aprendizados na aba Memória para ele melhorar com as correções da equipe.');
  const total = itens.reduce((s, i) => s + i.peso, 0);
  const feitos = itens.filter((i) => i.ok).reduce((s, i) => s + i.peso, 0);
  return { nota: Math.round((feitos / total) * 100) / 10, itens, sugestoes };
}

/** Conferência rápida de uma resposta de teste contra a configuração. */
export function avaliarResposta(a: AgenteIa, resposta: string): string[] {
  const avisos: string[] = [];
  const frases = resposta.split(/[.!?]+\s/).filter((f) => f.trim()).length;
  if (a.config.persona.tamanho === 'curta' && frases > 4) avisos.push('Resposta mais longa que o combinado (curta).');
  if (!a.config.persona.emojis && /\p{Extended_Pictographic}/u.test(resposta)) avisos.push('Usou emoji, mas a persona diz “sem emojis”.');
  if (/\*\*|^#|^- /m.test(resposta)) avisos.push('Usou formatação (markdown), que no WhatsApp aparece estranha.');
  if (a.config.regras.sempre.some((r) => /hor[aá]rio/i.test(r)) && !/hor[aá]rio|dia|amanh|hoje|semana|\d{1,2}h/i.test(resposta)) {
    avisos.push('A regra pede para sempre oferecer horário, e esta resposta não ofereceu.');
  }
  return avisos;
}

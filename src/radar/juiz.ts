import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { ClienteClaudeParse } from '../ai/copiloto.js';
import type { Mensagem } from '../domain.js';
import { historicoParaTurnos } from '../ai/prompt.js';
import { partesBahia } from '../util/tempo.js';
import { curto, type Veredito } from './tipos.js';

/**
 * O "juiz" do radar: lê a mensagem nova da cliente e diz se o que a equipe pediu para vigiar aconteceu.
 * Com IA (Claude), entende o sentido; sem IA, compara palavras (bem mais simples, só para não deixar de avisar).
 */

export interface PedidoJuiz {
  vigiar: string;
  prazo?: Date;
  mensagens: Mensagem[];
  /** Texto da(s) mensagem(ns) nova(s) da cliente. */
  novas: string;
  agora: Date;
}

export type Juiz = (p: PedidoJuiz) => Promise<Veredito>;

const Resposta = z.object({
  situacao: z.enum(['aconteceu', 'ainda_nao', 'nao_precisa_mais']).describe('aconteceu = o que se vigia aconteceu agora; ainda_nao = não aconteceu; nao_precisa_mais = não pode mais acontecer (ex.: vigiava "se não responder" e ela respondeu)'),
  motivo: z.string().describe('Uma frase curta para a atendente, em português simples, dizendo o que a cliente falou. Ex.: "Ela disse que o salário caiu hoje."'),
});

const INSTRUCOES = `Você ajuda a equipe de atendimento de uma empresa a vigiar conversas de WhatsApp ("radar").
A equipe escreveu o que quer vigiar nesta conversa. Leia a(s) mensagem(ns) nova(s) da cliente, com a conversa de contexto, e responda:
- aconteceu: a mensagem nova mostra que aquilo aconteceu (mesmo com outras palavras).
- ainda_nao: não aconteceu.
- nao_precisa_mais: aquilo não pode mais acontecer (ex.: vigiava "se ela não responder até sexta" e ela respondeu).
Seja criterioso: só "aconteceu" quando der para afirmar pelo que ela escreveu. O motivo é uma frase curta e simples, sem jargão.`;

const fmt = (d: Date) => {
  const p = partesBahia(d);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano} ${dois(p.hora)}:${dois(p.minuto)}`;
};

export function juizClaude(claude: ClienteClaudeParse, opcoes: { modelo: string }): Juiz {
  return async (p) => {
    const conversa = historicoParaTurnos(p.mensagens.slice(-14))
      .map((t) => `${t.role === 'user' ? 'Cliente' : 'Loja'}: ${t.content}`)
      .join('\n');
    const resp = await claude.beta.messages.parse({
      model: opcoes.modelo,
      max_tokens: 1000,
      system: [{ type: 'text', text: INSTRUCOES }],
      messages: [
        {
          role: 'user',
          content: `Agora: ${fmt(p.agora)} (horário de Brasília/Bahia).\n<o_que_vigiar>${p.vigiar}</o_que_vigiar>${p.prazo ? `\n<prazo>${fmt(p.prazo)}</prazo>` : ''}\n\n<conversa>\n${conversa}\n</conversa>\n\n<mensagem_nova_da_cliente>\n${p.novas}\n</mensagem_nova_da_cliente>`,
        },
      ],
      output_config: { effort: 'low', format: betaZodOutputFormat(Resposta) },
    });
    if (resp.stop_reason === 'refusal' || !resp.parsed_output) return { situacao: 'ainda_nao', motivo: '' };
    return { situacao: resp.parsed_output.situacao, motivo: curto(resp.parsed_output.motivo.trim(), 200) };
  };
}

const PARADAS = new Set(
  'a o as os e de da do das dos em no na nos nas um uma uns umas que se ela ele elas eles for para pra por com sem quando ate até falar disser dizer mandar pedir pediu falou disse mensagem cliente sobre como mais muito ja já vai ser ter tem sua seu'.split(' '),
);
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const raiz = (p: string) => (p.length > 5 ? p.slice(0, 5) : p);

/**
 * Sem IA (desligada ou sem chave): "se não responder" vira "não precisa mais" quando ela escreve;
 * nos outros casos dispara quando uma palavra importante do que se vigia aparece na mensagem.
 */
export const juizSemIa: Juiz = async (p) => {
  const vigiar = semAcento(p.vigiar);
  const texto = semAcento(p.novas);
  if (/\bnao (responder|respond|retornar|der retorno|falar|mandar)|sem resposta|sumir|sumiu/.test(vigiar)) {
    return { situacao: 'nao_precisa_mais', motivo: 'Ela escreveu de novo.' };
  }
  const palavras = [...new Set(vigiar.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PARADAS.has(w)))].map(raiz);
  const doTexto = texto.split(/[^a-z0-9]+/).filter(Boolean).map(raiz);
  const achou = palavras.filter((w) => doTexto.includes(w));
  if (achou.length) return { situacao: 'aconteceu', motivo: `Ela escreveu: "${curto(p.novas.trim(), 120)}"` };
  return { situacao: 'ainda_nao', motivo: '' };
};

import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { ClienteClaudeParse } from '../ai/copiloto.js';
import { CATEGORIAS, type Observacao } from './armazem.js';

/**
 * ia-aprende: as três conversas com a IA (Claude).
 * 1) observar: lê um lote de ~10 conversas (já sem dados pessoais) e anota o que a equipe faz;
 * 2) juntar: junta as anotações de todos os lotes, compara com a base e propõe só o que é NOVO ou DIFERENTE;
 * 3) documento: lê um PDF/texto do dono e propõe o que muda na base.
 * Tudo em português simples. A IA devolve JSON no formato pedido (structured outputs).
 */

export interface ConversaLote {
  /** Número da conversa na rodada (1, 2, 3...). */
  n: number;
  agendou: boolean;
  /** Linhas já anonimizadas: "Cliente: ...", "Equipe: ...". */
  linhas: string[];
}

export interface ItemExistente {
  id: string;
  categoria: string;
  titulo: string;
  texto: string;
  situacao: string;
}

export interface SecaoResumo {
  chave: string;
  titulo: string;
}

const zCategoria = z.enum(CATEGORIAS as [string, ...string[]]);

const RespostaObservar = z.object({
  observacoes: z.array(
    z.object({
      categoria: zCategoria.describe('roteiro = etapas e ordem até agendar; tom = jeito de escrever; pergunta = pergunta frequente da cliente com a resposta da equipe; objecao = objeção e como contornam; fato = preço, duração, regra, endereço citado; evitar = o que não fazer'),
      texto: z.string().describe('Uma frase ou duas, em português simples, dizendo o que a equipe faz. Ex.: "Antes de falar preço, pergunta o comprimento e se o cabelo tem química."'),
      conversas: z.array(z.number().int()).describe('Números das conversas (n) em que isso aparece'),
      exemplo: z.string().nullable().describe('Um trecho curto real (até 200 letras) que mostra isso, copiado do texto já anonimizado, ou null'),
    }),
  ),
});

export const Proposta = z.object({
  categoria: zCategoria,
  acao: z.enum(['acrescentar', 'pergunta', 'corrigir']).describe('acrescentar = texto novo numa seção; pergunta = pergunta frequente nova; corrigir = troca um trecho que já está na base'),
  destino: z.string().describe('Chave da seção da base onde entra (uma das chaves listadas), "perguntas-frequentes" para pergunta, ou "" se nenhuma seção serve'),
  titulo: z.string().describe('Nome curto do aprendizado (até 60 letras). Ex.: "Pergunta o comprimento antes do preço"'),
  texto: z.string().describe('Texto pronto para entrar na base, escrito como instrução para a IA que atende. Em "corrigir", o texto novo que substitui o trecho.'),
  pergunta: z.string().nullable().describe('Só em acao=pergunta: a pergunta da cliente'),
  resposta: z.string().nullable().describe('Só em acao=pergunta: a resposta que a equipe dá'),
  trecho_atual: z.string().nullable().describe('Só em acao=corrigir: o trecho EXATO da base que muda (copiado letra por letra)'),
  observacoes: z.array(z.number().int()).describe('Números das anotações que este aprendizado junta (vazio em documento)'),
  exemplos: z.array(z.string()).describe('1 ou 2 trechos curtos de exemplo (do texto anonimizado). Pode ser vazio.'),
  conferir: z.boolean().describe('true quando é um fato (preço, duração, regra, endereço) diferente do que está na base, ou que alguém precisa conferir'),
  contradiz: z.boolean().describe('true quando vai contra algo escrito na base'),
  motivo: z.string().nullable().describe('Se conferir ou contradiz: uma frase dizendo o que diverge. Senão null'),
  reforca_id: z.string().nullable().describe('Se é o MESMO que um aprendizado já existente (lista "ja_aprendido"), o id dele; senão null'),
});
export type Proposta = z.infer<typeof Proposta>;
const RespostaPropostas = z.object({ propostas: z.array(Proposta) });

const REGRAS_COMUNS = `Escreva tudo em português do Brasil, simples, sem jargão. Nunca escreva dados pessoais: os textos já vêm com [cliente], [atendente], [telefone], [email] no lugar; mantenha assim.
Pense em qualquer empresa (não invente nada que não esteja no material).`;

const INSTRUCOES_OBSERVAR = `Você estuda conversas de WhatsApp em que a EQUIPE de uma empresa atendeu clientes, para ensinar a IA da empresa a atender do mesmo jeito.
Leia as conversas do lote (as marcadas agendou="sim" terminaram em agendamento: dê mais peso a elas) e anote, de forma curta:
(a) roteiro: as etapas que a equipe segue até agendar — ordem das perguntas, quando fala preço, como oferece horário e unidade;
(b) tom: cumprimento, emojis, tamanho das mensagens, assinatura, jeito de escrever;
(c) pergunta: perguntas que as clientes repetem, com a resposta que a equipe dá;
(d) objecao: objeções (preço, medo, tempo, distância...) e como a equipe contorna;
(e) fato: fatos do negócio citados (preços, durações, regras, endereços, formas de pagamento);
(f) evitar: o que deu errado ou o que a equipe evita.
Só anote o que a equipe realmente faz. Junte o que se repete numa anotação só, com todos os números das conversas onde aparece.
${REGRAS_COMUNS}`;

const INSTRUCOES_JUNTAR = `Você organiza o que foi anotado ao estudar conversas da equipe de uma empresa, para virar memória da IA que atende.
Você recebe: a base atual da IA (o que ela já sabe), as seções da base (chave e título), as anotações numeradas e o que já foi aprendido antes.
Junte as anotações parecidas e proponha SÓ o que é NOVO ou DIFERENTE da base atual (o que a base já diz, ignore).
- Cada proposta tem um texto pronto para entrar na base, escrito como instrução para a IA ("Antes de falar preço, pergunte...").
- Escolha a seção onde entra pela chave; pergunta frequente vai em "perguntas-frequentes" com acao=pergunta; se nenhuma seção serve, destino "".
- Fato que diverge da base (preço, duração, regra, endereço): marque conferir=true e diga no motivo o que diverge; prefira acao=corrigir com o trecho_atual exato.
- Se vai contra algo escrito na base, contradiz=true.
- Se é o mesmo que algo em "ja_aprendido", use reforca_id com o id dele (não crie outro).
- Liste em "observacoes" os números das anotações juntadas.
${REGRAS_COMUNS}`;

const INSTRUCOES_DOCUMENTO = `Você lê um documento do dono de uma empresa (como funciona o atendimento, regras, preços, roteiros) para atualizar a base de conhecimento da IA que atende.
Compare com a base atual e proponha SÓ o que é NOVO ou DIFERENTE: onde entra (chave da seção) e o texto pronto.
- O que muda algo que já está na base: acao=corrigir com o trecho_atual exato, conferir=true se for preço, duração ou regra, e motivo.
- Perguntas e respostas do documento: acao=pergunta, destino "perguntas-frequentes".
- "observacoes" fica vazio. "exemplos" pode trazer 1 trecho curto do documento.
${REGRAS_COMUNS}`;

export interface UsoIa {
  entrada: number;
  saida: number;
}

const usoDe = (r: { usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } }): UsoIa => ({
  entrada: (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0),
  saida: r.usage?.output_tokens ?? 0,
});

export class IaAprender {
  constructor(
    private readonly claude: ClienteClaudeParse,
    private readonly modelo: () => string,
  ) {}

  private async pedir<T>(system: string, conteudo: Array<Record<string, unknown>>, formato: z.ZodType<T>, esforco: 'low' | 'medium', maxTokens: number): Promise<{ dados: T; uso: UsoIa }> {
    const resp = await this.claude.beta.messages.parse({
      model: this.modelo(),
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: conteudo as never }],
      output_config: { effort: esforco, format: betaZodOutputFormat(formato as never) },
    } as never);
    const r = resp as unknown as { parsed_output?: T | null; stop_reason?: string; usage?: Parameters<typeof usoDe>[0]['usage'] };
    const uso = usoDe(r);
    if (r.stop_reason === 'refusal') throw Object.assign(new Error('A IA não quis ler este material.'), { uso });
    if (!r.parsed_output) throw Object.assign(new Error(r.stop_reason === 'max_tokens' ? 'A resposta da IA ficou grande demais.' : 'A IA não devolveu o formato esperado.'), { uso });
    return { dados: r.parsed_output, uso };
  }

  async observar(base: string, lote: ConversaLote[]): Promise<{ observacoes: Observacao[]; uso: UsoIa }> {
    const conversas = lote.map((c) => `<conversa n="${c.n}" agendou="${c.agendou ? 'sim' : 'nao'}">\n${c.linhas.join('\n')}\n</conversa>`).join('\n\n');
    const { dados, uso } = await this.pedir(
      INSTRUCOES_OBSERVAR,
      [{ type: 'text', text: `<base_atual>\n${base}\n</base_atual>\n\n<conversas>\n${conversas}\n</conversas>` }],
      RespostaObservar,
      'low',
      8000,
    );
    const validos = new Set(lote.map((c) => c.n));
    const observacoes = dados.observacoes
      .map((o) => ({ categoria: o.categoria as Observacao['categoria'], texto: o.texto.trim().slice(0, 600), conversas: [...new Set(o.conversas.filter((n) => validos.has(n)))], ...(o.exemplo ? { exemplo: o.exemplo.trim().slice(0, 240) } : {}) }))
      .filter((o) => o.texto && o.conversas.length);
    return { observacoes, uso };
  }

  async juntar(base: string, secoes: SecaoResumo[], observacoes: Observacao[], existentes: ItemExistente[]): Promise<{ propostas: Proposta[]; uso: UsoIa }> {
    const anot = observacoes.map((o, i) => `${i + 1}. [${o.categoria}] (${o.conversas.length} conversa${o.conversas.length === 1 ? '' : 's'}) ${o.texto}${o.exemplo ? ` | exemplo: ${o.exemplo}` : ''}`).join('\n');
    const ja = existentes.map((e) => `- id=${e.id} [${e.categoria}] (${e.situacao}) ${e.titulo}: ${e.texto}`).join('\n') || '(nada ainda)';
    const { dados, uso } = await this.pedir(
      INSTRUCOES_JUNTAR,
      [{ type: 'text', text: `<base_atual>\n${base}\n</base_atual>\n\n<secoes>\n${secoes.map((s) => `${s.chave}: ${s.titulo}`).join('\n')}\n</secoes>\n\n<ja_aprendido>\n${ja}\n</ja_aprendido>\n\n<anotacoes>\n${anot}\n</anotacoes>` }],
      RespostaPropostas,
      'medium',
      16000,
    );
    return { propostas: dados.propostas, uso };
  }

  async documento(base: string, secoes: SecaoResumo[], doc: { nome: string; texto?: string | null; pdf?: Buffer | null }): Promise<{ propostas: Proposta[]; uso: UsoIa }> {
    const blocos: Array<Record<string, unknown>> = [];
    if (doc.pdf) blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.pdf.toString('base64') } });
    blocos.push({
      type: 'text',
      text: `<base_atual>\n${base}\n</base_atual>\n\n<secoes>\n${secoes.map((s) => `${s.chave}: ${s.titulo}`).join('\n')}\n</secoes>\n\n<documento nome="${doc.nome.replace(/"/g, '')}">\n${doc.texto ?? '(o documento está em anexo)'}\n</documento>`,
    });
    const { dados, uso } = await this.pedir(INSTRUCOES_DOCUMENTO, blocos, RespostaPropostas, 'medium', 16000);
    return { propostas: dados.propostas, uso };
  }
}

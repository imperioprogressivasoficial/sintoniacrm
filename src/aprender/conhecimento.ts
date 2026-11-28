import { CHAVE_FAQ } from '../ai/base.js';
import { textoRegrasAtendimento } from '../ai/regras-atendimento.js';
import type { Aprender } from './aprender.js';
import type { Categoria } from './armazem.js';

/**
 * conhecimento-arquivo (dono 28/11: "um lugar onde tem todos os conhecimentos da IA formados por ela, para a gente usar
 * depois"). Empresa › Documentos › Conhecimento da IA: tudo o que a IA sabe agora, em 4 partes, lido na hora do banco
 * (sempre atualizado). A tela monta o .md e o .txt a partir daqui. Só leitura: nada muda na base.
 */

export interface BlocoConhecimento {
  titulo: string;
  texto: string;
  /** Agrupa dentro da parte (ex.: "Jeito de escrever"). */
  grupo?: string;
  em?: Date | null;
  por?: string | null;
  origem?: string;
}

export interface ParteConhecimento {
  id: 'base' | 'aprendido' | 'documentos' | 'regras';
  titulo: string;
  descricao: string;
  blocos: BlocoConhecimento[];
}

export interface ConhecimentoIa {
  geradoEm: Date;
  /** Última mudança em qualquer parte (seção, pergunta, aprendizado ou documento). */
  atualizadoEm: Date | null;
  partes: ParteConhecimento[];
}

const CATEGORIA: Record<Categoria, string> = {
  roteiro: 'Como conduz até agendar',
  tom: 'Jeito de escrever',
  pergunta: 'Perguntas que as clientes fazem',
  objecao: 'Objeções e como responder',
  fato: 'Informações do negócio',
  evitar: 'O que evitar',
};

/** "semente" = texto inicial do sistema; "teste" = sem login. */
const autor = (por: string | null | undefined) => (!por ? null : por === 'semente' ? 'Texto inicial' : por);

/** As regras fixas viram blocos: "Tamanho: nunca mande textão…" → título "Tamanho". */
export function blocosDasRegras(texto = textoRegrasAtendimento()): BlocoConhecimento[] {
  return texto
    .split(/\n(?=- )/)
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([^:]{2,40}):\s*([\s\S]*)$/.exec(l);
      return m ? { titulo: m[1]!.trim(), texto: m[2]!.trim() } : { titulo: 'Regra', texto: l };
    });
}

export async function conhecimentoDaIa(a: Aprender, agora: Date = new Date()): Promise<ConhecimentoIa> {
  const base = a.baseConhecimento;
  const [secoes, perguntas, itens, documentos] = await Promise.all([base.secoes(), base.perguntas(), a.itens('todos'), a.documentosEnviados()]);
  const datas: Date[] = [];

  // (1) base de conhecimento: as seções do Treinamento da IA, com as perguntas frequentes na seção delas
  const faq = perguntas.map((p) => `Pergunta: ${p.pergunta.trim()}\nResposta: ${p.resposta.trim()}`).join('\n\n');
  const blocosBase: BlocoConhecimento[] = secoes.map((s) => {
    datas.push(s.atualizadaEm);
    const texto = s.chave === CHAVE_FAQ && faq ? [s.conteudo.trim(), faq].filter(Boolean).join('\n\n') : s.conteudo.trim();
    return { titulo: s.titulo, texto, em: s.atualizadaEm, por: autor(s.atualizadaPor) };
  });
  for (const p of perguntas) datas.push(p.atualizadaEm);
  if (faq && !secoes.some((s) => s.chave === CHAVE_FAQ)) {
    const ultima = perguntas.reduce<Date | null>((m, p) => (!m || p.atualizadaEm > m ? p.atualizadaEm : m), null);
    blocosBase.push({ titulo: 'Perguntas frequentes', texto: faq, em: ultima });
  }

  // (2) o que aprendeu com a equipe: só o que está valendo (aplicado), do mais novo para o mais antigo
  const titulos = new Map(secoes.map((s) => [s.chave, s.titulo]));
  const aplicados = itens
    .filter((i) => i.situacao === 'aplicado')
    .sort((x, y) => (y.decididoEm ?? y.criadoEm).getTime() - (x.decididoEm ?? x.criadoEm).getTime());
  const blocosAprendido: BlocoConhecimento[] = aplicados.map((i) => {
    const em = i.decididoEm ?? i.criadoEm;
    datas.push(em);
    const texto =
      i.pergunta && i.resposta ? `Pergunta: ${i.pergunta.trim()}\nResposta: ${i.resposta.trim()}` : i.texto.trim();
    const onde = i.acao === 'corrigir' ? `Corrigiu a base${titulos.get(i.destino) ? ` (${titulos.get(i.destino)})` : ''}` : null;
    const origem = i.origem.startsWith('documento:')
      ? `Documento ${i.origem.slice('documento:'.length).trim()}`
      : i.conversas > 0
        ? `Conversas da equipe (${i.conversas} ${i.conversas === 1 ? 'conversa' : 'conversas'})`
        : 'Conversas da equipe';
    return {
      titulo: i.titulo?.trim() || CATEGORIA[i.categoria] || 'Aprendizado',
      texto,
      grupo: CATEGORIA[i.categoria] ?? 'Outros',
      em,
      por: i.automatico ? 'Entrou sozinho' : autor(i.decididoPor),
      origem: [origem, onde].filter(Boolean).join(' · '),
    };
  });

  // (3) documentos que alimentaram o treinamento: só nome e data
  const blocosDocs: BlocoConhecimento[] = documentos
    .filter((d) => d.situacao !== 'falhou')
    .map((d) => {
      datas.push(d.enviadoEm);
      return { titulo: d.nome, texto: '', em: d.enviadoEm };
    });

  const atualizadoEm = datas.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
  return {
    geradoEm: agora,
    atualizadoEm,
    partes: [
      { id: 'base', titulo: 'Base de conhecimento', descricao: 'O que a empresa ensinou no Treinamento da IA: seções e perguntas frequentes.', blocos: blocosBase },
      { id: 'aprendido', titulo: 'O que aprendeu com a equipe', descricao: 'Tirado das conversas reais e dos documentos, e que está valendo agora.', blocos: blocosAprendido },
      { id: 'documentos', titulo: 'Documentos que ela estudou', descricao: 'PDFs e textos enviados no Aprender com a equipe.', blocos: blocosDocs },
      { id: 'regras', titulo: 'Regras de atendimento', descricao: 'O jeito fixo de conduzir a conversa, igual para toda empresa.', blocos: blocosDasRegras() },
    ],
  };
}

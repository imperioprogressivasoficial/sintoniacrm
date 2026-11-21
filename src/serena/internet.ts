import type Anthropic from '@anthropic-ai/sdk';
import type { ClienteClaude } from '../ai/agente.js';
import { partesBahia } from '../util/tempo.js';

/**
 * serena-super: a Serena da tela (chat da equipe) pesquisa na internet.
 * - Só no chat interno: a IA que atende as CLIENTES no WhatsApp (src/ai/*) nunca recebe esta ferramenta.
 * - Privacidade: a Serena principal tem o CRM no contexto; a pesquisa roda num pedido SEPARADO à API, que só
 *   recebe a consulta já limpa (sem telefone, e-mail, CPF nem o nome completo de clientes). Assim nenhum dado de
 *   cliente chega à busca, mesmo que o modelo erre.
 * - Usa as ferramentas de servidor da Anthropic: web_search (até MAX_BUSCAS por mensagem) e web_fetch (ler uma
 *   página: só as que apareceram na busca ou que a pessoa colou), com dynamic filtering (versões 20260209).
 * - Devolve o texto e as fontes (título e link) para a tela mostrar.
 */

export const MAX_BUSCAS = 5;
export const MAX_LEITURAS = 3;
/** Quantas vezes a pesquisa pode ser chamada numa mensagem da pessoa. */
export const MAX_PESQUISAS = 2;
/** Quantas vezes seguir um "pause_turn" (a busca no servidor pausou e continua). */
const MAX_CONTINUAR = 3;

export interface Fonte {
  titulo: string;
  url: string;
}

export interface ResultadoPesquisa {
  texto: string;
  fontes: Fonte[];
  /** A consulta que saiu de fato (já limpa). */
  consulta: string;
  /** Tiramos algo da consulta (telefone, e-mail, nome de cliente)? */
  limpou: boolean;
}

/**
 * Tira da consulta o que é dado pessoal: telefones (8+ dígitos), e-mails, CPF/CNPJ e o nome completo
 * de clientes conhecidas (dois nomes ou mais). Mantém links (para ler uma página que a pessoa colou).
 */
export function limparConsulta(texto: string, nomesClientes: string[] = []): { consulta: string; limpou: boolean } {
  let s = String(texto ?? '').replace(/\s+/g, ' ').trim();
  const antes = s;
  const links: string[] = [];
  s = s.replace(/https?:\/\/[^\s]+/gi, (u) => `\u0000${links.push(u) - 1}\u0000`);
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ');
  // Sequências de dígitos (com espaço, ponto, traço, parênteses ou +) que somam 8 dígitos ou mais: telefone, CPF, CNPJ.
  s = s.replace(/\+?\(?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? ' ' : m));
  const nomes = [...new Set(nomesClientes.map((n) => n.trim()).filter((n) => n.split(/\s+/).length >= 2 && n.length >= 5))].sort((a, b) => b.length - a.length);
  for (const n of nomes) {
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
    s = s.replace(re, ' ');
  }
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => links[Number(i)] ?? '');
  s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim().slice(0, 300);
  return { consulta: s, limpou: s !== antes.slice(0, 300) };
}

const hoje = (d: Date) => {
  const p = partesBahia(d);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
};

const SISTEMA = `Você pesquisa na internet para a equipe de uma empresa brasileira (atendimento e vendas pelo WhatsApp).
- Use a busca (web_search) e, quando precisar de detalhe, leia a página (web_fetch).
- Responda em português do Brasil, curto e direto, com os fatos que achou. Diga quando a informação pode estar desatualizada.
- Não invente: se não achou, diga que não achou.
- Nunca pesquise nomes, telefones, e-mails ou documentos de pessoas.`;

/** As ferramentas de servidor que vão no pedido (o teste confere o formato). */
export function ferramentasInternet(): Anthropic.Beta.Messages.BetaToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS, user_location: { type: 'approximate', country: 'BR', timezone: 'America/Bahia' } },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_LEITURAS, max_content_tokens: 8000 },
  ];
}

type Bloco = Anthropic.Beta.Messages.BetaContentBlock;

/** Fontes do que veio: primeiro as citadas no texto, depois as páginas lidas, depois os resultados da busca. */
export function fontesDe(blocos: Bloco[]): Fonte[] {
  const citadas: Fonte[] = [];
  const lidas: Fonte[] = [];
  const achadas: Fonte[] = [];
  for (const b of blocos) {
    if (b.type === 'text') {
      for (const c of b.citations ?? []) if (c.type === 'web_search_result_location' && c.url) citadas.push({ titulo: c.title || c.url, url: c.url });
    } else if (b.type === 'web_fetch_tool_result') {
      const c = b.content as { type?: string; url?: string; content?: { title?: string | null } };
      if (c.type === 'web_fetch_result' && c.url) lidas.push({ titulo: c.content?.title || c.url, url: c.url });
    } else if (b.type === 'web_search_tool_result') {
      // Sucesso: lista de resultados. Erro: um objeto (ex.: max_uses_exceeded).
      if (Array.isArray(b.content)) for (const r of b.content) if (r.url) achadas.push({ titulo: r.title || r.url, url: r.url });
    }
  }
  const vistos = new Set<string>();
  const saida: Fonte[] = [];
  for (const f of [...citadas, ...lidas, ...achadas.slice(0, 4)]) {
    if (!/^https?:\/\//i.test(f.url) || vistos.has(f.url)) continue;
    vistos.add(f.url);
    saida.push({ titulo: f.titulo.slice(0, 140), url: f.url.slice(0, 600) });
  }
  return saida.slice(0, 6);
}

/** Faz a pesquisa num pedido à parte (só a consulta limpa vai junto). */
export async function pesquisarNaInternet(
  claude: ClienteClaude,
  o: { modelo: string; consulta: string; nomesClientes?: string[]; agora: Date; pensarMais?: boolean; prazoMs?: number },
): Promise<ResultadoPesquisa> {
  const { consulta, limpou } = limparConsulta(o.consulta, o.nomesClientes);
  if (consulta.length < 3) return { texto: 'A consulta ficou vazia depois de tirar os dados pessoais. Pesquise só o assunto (sem nome, telefone ou e-mail de clientes).', fontes: [], consulta, limpou };
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: `Hoje é ${hoje(o.agora)}. Pesquise e responda: ${consulta}` }];
  const blocos: Bloco[] = [];
  for (let i = 0; i <= MAX_CONTINUAR; i++) {
    const resp = await claude.beta.messages.create(
      {
        model: o.modelo,
        max_tokens: 4000,
        system: SISTEMA,
        messages,
        tools: ferramentasInternet(),
        output_config: { effort: o.pensarMais ? 'medium' : 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { timeout: o.prazoMs ?? 60_000, maxRetries: 1 },
    );
    if (resp.stop_reason === 'refusal') return { texto: 'A pesquisa não foi feita (o pedido foi recusado).', fontes: [], consulta, limpou };
    blocos.push(...resp.content);
    // A busca no servidor pausou: manda de volta o que veio e ela continua de onde parou (sem mensagem nova).
    if (resp.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: resp.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
  }
  const texto = blocos
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { texto: texto || 'A pesquisa não achou nada útil.', fontes: fontesDe(blocos), consulta, limpou };
}

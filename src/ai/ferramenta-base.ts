import type Anthropic from '@anthropic-ai/sdk';

/** Peças comuns das ferramentas da IA (src/ai/ferramentas.ts e src/ai/ferramentas-crm.ts). */
export type Ferramenta = Anthropic.Beta.Messages.BetaTool;

/**
 * Campos "pode ser vazio" (type: [X, 'null']) viram opcionais de tipo simples: a API recusa ferramentas com muitos
 * campos de tipo duplo (deu 400 em produção em 28/11 com 22). Quando a IA não manda o campo, ele chega como null
 * (completarNulos), então quem lê a entrada continua igual.
 */
const NULAVEIS = new Map<string, string[]>();
export const def = (name: string, description: string, properties: Record<string, unknown>): Ferramenta => {
  const props: Record<string, unknown> = {};
  const nulaveis: string[] = [];
  for (const [k, v] of Object.entries(properties)) {
    const t = (v as { type?: unknown }).type;
    if (Array.isArray(t) && t.includes('null')) {
      const resto = t.filter((x) => x !== 'null');
      props[k] = { ...(v as object), type: resto.length === 1 ? resto[0] : resto };
      nulaveis.push(k);
    } else props[k] = v;
  }
  NULAVEIS.set(name, nulaveis);
  return {
    name,
    description,
    strict: true,
    input_schema: { type: 'object', properties: props, required: Object.keys(props).filter((k) => !nulaveis.includes(k)), additionalProperties: false },
  };
};

/** Entrada da ferramenta com null nos campos opcionais que a IA não mandou. */
export function completarNulos(name: string, entrada: unknown): unknown {
  const n = NULAVEIS.get(name);
  if (!n?.length || !entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return entrada;
  const e = { ...(entrada as Record<string, unknown>) };
  for (const k of n) if (e[k] === undefined) e[k] = null;
  return e;
}

/** Recusa explicada (regra de negócio), não falha de sistema: volta como erro para a IA corrigir. */
export class RecusaFerramenta extends Error {}

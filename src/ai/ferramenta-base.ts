import type Anthropic from '@anthropic-ai/sdk';

/** Peças comuns das ferramentas da IA (src/ai/ferramentas.ts e src/ai/ferramentas-crm.ts). */
export type Ferramenta = Anthropic.Beta.Messages.BetaTool;

export const def = (name: string, description: string, properties: Record<string, unknown>): Ferramenta => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
});

/** Recusa explicada (regra de negócio), não falha de sistema: volta como erro para a IA corrigir. */
export class RecusaFerramenta extends Error {}

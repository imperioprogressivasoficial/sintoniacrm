import { z } from 'zod';
import type { UnidadeId } from './domain.js';

const Env = z.object({
  PORT: z.coerce.number().default(3333),
  ANTHROPIC_API_KEY: z.string().optional(),
  SINTONIA_MODELO: z.string().default('claude-opus-5-5'),
  SINTONIA_ESFORCO: z.enum(['low', 'medium', 'high']).default('low'),
  EVOLUTION_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_WEBHOOK_TOKEN: z.string().optional(),
  META_TOKEN: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  TRINKS_API_KEY: z.string().optional(),
  TRINKS_INTERVALO_MS: z.coerce.number().default(1200),
  RELATORIO_DESTINOS: z.string().default(''),
  /** JSON: [{"canalId":"imperio-norte","unidade":"norte","canal":"evolution"}] */
  SINTONIA_NUMEROS: z.string().default('[]'),
  SINTONIA_EMPRESA_ID: z.string().default('imperio'),
  /** Postgres da Sintonia. Sem ele, tudo fica em memória (só para teste local). */
  DATABASE_URL: z.string().optional(),
  /** Quantas clientes diferentes cada processo atende ao mesmo tempo. */
  /** Cookie de login só por HTTPS. Desligue (0) apenas em teste local sem HTTPS. */
  COOKIE_SEGURO: z.enum(['0', '1']).default('1'),
  /** Primeiro administrador, criado ao subir se ainda não existir. */
  ADMIN_NOME: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_SENHA: z.string().optional(),
  ADMIN_SENHA_HASH: z.string().transform((h) => h.replaceAll('$$', '$')).pipe(z.string().startsWith('scrypt$')).optional(),
  SINTONIA_PARALELO: z.coerce.number().int().min(1).max(64).default(8),
});

export const NumerosConfig = z.array(
  z.object({
    canalId: z.string(),
    unidade: z.enum(['norte', 'sumare', 'feira']),
    canal: z.enum(['evolution', 'meta']),
  }),
);

export type Config = z.infer<typeof Env> & {
  numeros: Array<{ canalId: string; unidade: UnidadeId; canal: 'evolution' | 'meta' }>;
  destinosRelatorio: string[];
};

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  return {
    ...e,
    numeros: NumerosConfig.parse(JSON.parse(e.SINTONIA_NUMEROS)),
    destinosRelatorio: e.RELATORIO_DESTINOS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

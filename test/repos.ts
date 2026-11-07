import pg from 'pg';
import { afterAll } from 'vitest';
import { migrar } from '../src/store/migrar.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';

/**
 * Os testes de orquestração rodam contra a memória sempre e contra um Postgres de verdade
 * quando SINTONIA_TESTE_PG aponta para um banco de teste (ele é apagado a cada teste).
 */
export interface FabricaRepo {
  nome: string;
  criar(): Promise<Repositorio>;
}

const url = process.env.SINTONIA_TESTE_PG;
let pool: pg.Pool | undefined;
let migrado = false;

export async function poolDeTeste(): Promise<pg.Pool> {
  if (!url) throw new Error('SINTONIA_TESTE_PG não definido');
  pool ??= new pg.Pool({ connectionString: url, max: 20 });
  if (!migrado) {
    await migrar(pool);
    migrado = true;
  }
  await pool.query(
    'truncate sintonia.conversas, sintonia.mensagens, sintonia.enviados, sintonia.tarefas, sintonia.eventos, sintonia.entrada, sintonia.empresas, sintonia.usuarios, sintonia.sessoes, sintonia.interessados, sintonia.digitando, sintonia.fotos, sintonia.conexoes, sintonia.midias, sintonia.tags, sintonia.conversa_tags, sintonia.base_secoes, sintonia.base_versoes, sintonia.base_faq, sintonia.funis, sintonia.automacoes, sintonia.automacao_execucoes, sintonia.automacao_envios, sintonia.conversa_objetivos, sintonia.automacoes_config, sintonia.contatos, sintonia.campos_contato, sintonia.nao_duplicatas, sintonia.push_config, sintonia.links_rastreados, sintonia.cliques_link, sintonia.origens_lead, sintonia.origem_ia, sintonia.anuncios_meta, sintonia.capi_eventos restart identity cascade',
  );
  return pool;
}

export const temPostgres = Boolean(url);

export const fabricas: FabricaRepo[] = [
  { nome: 'memória', criar: async () => new RepositorioMemoria() },
  ...(url ? [{ nome: 'postgres', criar: async () => new RepositorioPostgres(await poolDeTeste()) }] : []),
];

afterAll(async () => {
  await pool?.end();
  pool = undefined;
  migrado = false;
});

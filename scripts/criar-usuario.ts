/**
 * Cria um usuário da Sintonia.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/criar-usuario.ts \
 *     --nome "Carla Lima" --email carla@empresa.com --papel atendente --unidades norte,sumare
 *
 * A senha é pedida na tela (não fica no histórico do terminal). Papéis: atendente, recepcionista,
 * gerente, direcao, admin. Empresa: SINTONIA_EMPRESA_ID (padrão "imperio").
 */
import { createInterface } from 'node:readline/promises';
import pg from 'pg';
import { ContasPostgres, PAPEIS, type Papel } from '../src/auth/contas.js';
import { gerarHash, senhaFraca } from '../src/auth/senha.js';
import { migrar } from '../src/store/migrar.js';

const arg = (nome: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const url = process.env.DATABASE_URL;
const nome = arg('nome');
const email = arg('email');
const papel = arg('papel') as Papel | undefined;
const unidades = (arg('unidades') ?? '').split(',').map((u) => u.trim()).filter(Boolean);

if (!url || !nome || !email || !papel || !PAPEIS.includes(papel)) {
  console.error('Uso: DATABASE_URL=... npx tsx scripts/criar-usuario.ts --nome "Nome" --email e@x.com --papel atendente [--unidades norte,sumare]');
  console.error(`Papéis: ${PAPEIS.join(', ')}`);
  process.exit(2);
}

const leitor = createInterface({ input: process.stdin, output: process.stdout });
const senha = process.env.SENHA ?? (await leitor.question('Senha (10+ caracteres, letras e números): '));
leitor.close();
const fraca = senhaFraca(senha);
if (fraca) {
  console.error(fraca);
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url });
await migrar(pool);
const u = await new ContasPostgres(pool).criarUsuario({
  empresaId: process.env.SINTONIA_EMPRESA_ID ?? 'imperio',
  nome,
  email,
  papel,
  unidades,
  senhaHash: await gerarHash(senha),
});
await pool.end();
console.log(`Usuário criado: ${u.nome} <${u.email}> · ${u.papel}${u.unidades.length ? ' · ' + u.unidades.join(', ') : ''}`);

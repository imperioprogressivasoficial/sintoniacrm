import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Com Postgres de teste, os arquivos dividem o mesmo banco: um de cada vez.
    fileParallelism: !process.env.SINTONIA_TESTE_PG,
  },
});

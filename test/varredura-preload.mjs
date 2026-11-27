// seguranca-abertura: carregado com `node --import` ao subir o app de verdade (src/index.ts) no teste de varredura.
// Anota todas as rotas que o Fastify registrar (gancho onRoute) e grava a lista em ROTAS_SAIDA quando o app fica pronto.
import dc from 'node:diagnostics_channel';
import { writeFileSync } from 'node:fs';

const rotas = [];
dc.channel('fastify.initialization').subscribe(({ fastify }) => {
  fastify.addHook('onRoute', (r) => {
    for (const m of [].concat(r.method)) rotas.push(`${m} ${r.url}`);
  });
  fastify.addHook('onReady', async () => {
    if (process.env.ROTAS_SAIDA) writeFileSync(process.env.ROTAS_SAIDA, rotas.join('\n'));
  });
});

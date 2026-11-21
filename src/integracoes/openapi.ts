import { z } from 'zod';
import { ROTAS } from './api.js';
import { ESCOPOS, EVENTOS, RECURSOS } from './catalogo.js';

/** openapi.json da API v1, gerado das próprias rotas (o que está aqui é o que o servidor faz). */

const semSchema = (s: z.ZodType) => {
  const { $schema: _s, ...resto } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return resto;
};

const ERRO = {
  type: 'object',
  properties: {
    erro: {
      type: 'object',
      properties: { codigo: { type: 'string', example: 'nao_encontrado' }, mensagem: { type: 'string', example: 'Conversa não encontrada.' } },
      required: ['codigo', 'mensagem'],
      additionalProperties: true,
    },
  },
  required: ['erro'],
};

const exemploCorpoEvento = (tipo: string) => ({
  id: 'evt_3f2a9c1e8b7d4a5f9e0c1b2a3d4e5f60',
  tipo,
  criadoEm: '2026-11-20T14:03:11.000Z',
  empresaId: 'sua-empresa',
  dados: { conversa: { id: '9b1d…', telefone: '5571988124471', nome: 'Maria Souza', unidade: 'norte', etapa: 'em_conversa', modo: 'copiloto', responsavel: null } },
});

export function gerarOpenApi(base: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROTAS) {
    const caminho = `/api/v1${r.caminho.replace(/:(\w+)/g, '{$1}')}`;
    const params: unknown[] = [];
    for (const [nome, descricao] of Object.entries(r.parametros ?? {})) params.push({ name: nome, in: 'path', required: true, description: descricao, schema: { type: 'string' } });
    if (r.query) {
      const s = semSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [nome, esquema] of Object.entries(s.properties ?? {})) params.push({ name: nome, in: 'query', required: (s.required ?? []).includes(nome) && !(esquema as { default?: unknown }).default, schema: esquema });
    }
    const op: Record<string, unknown> = {
      tags: [r.grupo],
      summary: r.resumo,
      ...(r.descricao ? { description: r.descricao } : {}),
      operationId: `${r.metodo.toLowerCase()}${r.caminho.replace(/[/:](\w)/g, (_m, l: string) => l.toUpperCase()).replace(/[^A-Za-z]/g, '')}`,
      ...(r.escopo ? { 'x-escopo': r.escopo, security: [{ chave: [r.escopo] }] } : { security: [{ chave: [] }] }),
      ...(params.length ? { parameters: params } : {}),
      ...(r.corpo
        ? { requestBody: { required: true, content: { 'application/json': { schema: semSchema(r.corpo), ...(r.exemploCorpo ? { example: r.exemploCorpo } : {}) } } } }
        : {}),
      responses: {
        [String(r.status ?? 200)]: { description: 'Deu certo.', content: { 'application/json': { schema: { type: 'object' } } } },
        400: { $ref: '#/components/responses/Erro' },
        401: { $ref: '#/components/responses/Erro' },
        403: { $ref: '#/components/responses/Erro' },
        404: { $ref: '#/components/responses/Erro' },
        429: { $ref: '#/components/responses/Limite' },
      },
    };
    (paths[caminho] ??= {})[r.metodo.toLowerCase()] = op;
  }
  const webhooks: Record<string, unknown> = {};
  for (const e of EVENTOS) {
    webhooks[e.id] = {
      post: {
        summary: e.nome,
        description: `${e.descricao} Confira o cabeçalho Sintonia-Assinatura (t=<segundos>,v1=<HMAC-SHA256 hex de "t.corpo">) antes de confiar no corpo.`,
        parameters: [
          { name: 'Sintonia-Assinatura', in: 'header', required: true, schema: { type: 'string', example: 't=1763647391,v1=5f0c…' } },
          { name: 'Sintonia-Evento', in: 'header', required: true, schema: { type: 'string', example: e.id } },
          { name: 'Sintonia-Entrega', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'Sintonia-Evento-Id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: { content: { 'application/json': { schema: { type: 'object' }, example: exemploCorpoEvento(e.id) } } },
        responses: { 200: { description: 'Responda 2xx em até 10 segundos. Qualquer outra resposta conta como falha e a Sintonia tenta de novo.' } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'API da Sintonia',
      version: '1.0.0',
      description:
        'API pública da Sintonia CRM. Autentique com `Authorization: Bearer sk_...` (crie a chave em Integrações › Chaves de API). ' +
        'Listas usam paginação por cursor (`limite` e `cursor`, a resposta traz `proximoCursor`). Cada chave tem limite de chamadas por minuto (cabeçalhos X-RateLimit-*). ' +
        'Erros vêm como `{ "erro": { "codigo", "mensagem" } }`. Guia completo em /desenvolvedores.',
    },
    servers: [{ url: base }],
    tags: [...new Set(ROTAS.map((r) => r.grupo))].map((name) => ({ name })),
    paths,
    webhooks,
    components: {
      securitySchemes: {
        chave: { type: 'http', scheme: 'bearer', bearerFormat: 'sk_...', description: `Escopos: ${ESCOPOS.join(', ')}. "escrever" inclui "ler".` },
      },
      responses: {
        Erro: { description: 'Erro (formato padrão).', content: { 'application/json': { schema: ERRO } } },
        Limite: {
          description: 'Limite de chamadas excedido. Espere os segundos do cabeçalho Retry-After.',
          headers: { 'Retry-After': { schema: { type: 'integer' } }, 'X-RateLimit-Limit': { schema: { type: 'integer' } }, 'X-RateLimit-Remaining': { schema: { type: 'integer' } }, 'X-RateLimit-Reset': { schema: { type: 'integer' } } },
          content: { 'application/json': { schema: ERRO } },
        },
      },
    },
    'x-recursos': RECURSOS,
  };
}

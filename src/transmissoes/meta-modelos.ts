import { z } from 'zod';
import { ErroMeta, GraphMeta } from '../channels/meta.js';

/**
 * Modelos de mensagem da API oficial: criar e mandar para aprovação, consultar status (pendente, aprovado,
 * rejeitado com motivo). Tudo pela Graph API com o token da unidade; nos testes, um fetch falso.
 */

export const CATEGORIAS = ['MARKETING', 'UTILITY'] as const;

const Botao = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('resposta'), texto: z.string().trim().min(1).max(25) }),
  z.object({ tipo: z.literal('url'), texto: z.string().trim().min(1).max(25), url: z.string().trim().url().max(2000) }),
]);

/** O que a tela manda para criar um modelo. */
export const ModeloNovo = z.object({
  unidade: z.enum(['norte', 'sumare']),
  /** Só minúsculas, números e "_" (regra da Meta). */
  nome: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .transform((s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')),
  categoria: z.enum(CATEGORIAS),
  idioma: z.string().trim().default('pt_BR'),
  cabecalho: z
    .discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('texto'), texto: z.string().trim().min(1).max(60) }),
      /** Imagem de exemplo (base64) para a análise da Meta. */
      z.object({ tipo: z.literal('imagem'), base64: z.string().min(10).max(7_000_000), mimetype: z.string().regex(/^image\/(jpeg|png)$/) }),
    ])
    .nullable()
    .default(null),
  corpo: z.string().trim().min(1).max(1024),
  /** Exemplo de cada variável {{1}}, {{2}}... (a Meta exige). */
  exemplos: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  rodape: z.string().trim().max(60).optional(),
  botoes: z.array(Botao).max(10).default([]),
});
export type ModeloNovo = z.infer<typeof ModeloNovo>;

export interface ModeloMeta {
  id?: string;
  nome: string;
  idioma: string;
  categoria: string;
  status: string;
  motivo?: string;
  componentes: unknown[];
}

/** Status da Meta em português, para a tela. */
export function statusLocal(s: string): 'aprovado' | 'pendente' | 'rejeitado' | 'pausado' | 'desativado' {
  const x = s.toUpperCase();
  if (x === 'APPROVED') return 'aprovado';
  if (x === 'REJECTED') return 'rejeitado';
  if (x === 'PAUSED') return 'pausado';
  if (x === 'DISABLED') return 'desativado';
  return 'pendente';
}

/** Monta os componentes no formato da Meta. `handle` = imagem de exemplo já enviada (upload resumível). */
export function componentesDoModelo(m: ModeloNovo, handle?: string): unknown[] {
  const vars = [...new Set([...m.corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => Number(x[1])))].sort((a, b) => a - b);
  vars.forEach((n, i) => {
    if (n !== i + 1) throw Object.assign(new Error('As variáveis do corpo precisam ser {{1}}, {{2}}, {{3}}... em sequência.'), { statusCode: 400 });
  });
  if (m.exemplos.length < vars.length) throw Object.assign(new Error(`Dê um exemplo para cada variável (faltam ${vars.length - m.exemplos.length}).`), { statusCode: 400 });
  const c: unknown[] = [];
  if (m.cabecalho?.tipo === 'texto') c.push({ type: 'HEADER', format: 'TEXT', text: m.cabecalho.texto });
  if (m.cabecalho?.tipo === 'imagem') c.push({ type: 'HEADER', format: 'IMAGE', ...(handle ? { example: { header_handle: [handle] } } : {}) });
  c.push({ type: 'BODY', text: m.corpo, ...(vars.length ? { example: { body_text: [m.exemplos.slice(0, vars.length)] } } : {}) });
  if (m.rodape) c.push({ type: 'FOOTER', text: m.rodape });
  if (m.botoes.length) {
    c.push({
      type: 'BUTTONS',
      buttons: m.botoes.map((b) => (b.tipo === 'url' ? { type: 'URL', text: b.texto, url: b.url } : { type: 'QUICK_REPLY', text: b.texto })),
    });
  }
  return c;
}

export class ClienteModelosMeta {
  private readonly graph: GraphMeta;
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.graph = new GraphMeta(token, fetchFn);
  }

  /** Envia o modelo para aprovação. A Meta responde { id, status } (normalmente PENDING). */
  async criar(wabaId: string, m: ModeloNovo, componentes: unknown[]): Promise<{ id: string; status: string; categoria?: string }> {
    const j = await this.graph.postJson<{ id?: string; status?: string; category?: string }>(
      `${encodeURIComponent(wabaId)}/message_templates`,
      { name: m.nome, language: m.idioma, category: m.categoria, components: componentes },
      'o modelo',
    );
    if (!j.id) throw new ErroMeta('Meta não devolveu o id do modelo', 502);
    return { id: j.id, status: j.status ?? 'PENDING', ...(j.category ? { categoria: j.category } : {}) };
  }

  /** Todos os modelos da WABA (qualquer status), com o motivo da rejeição. */
  async listar(wabaId: string): Promise<ModeloMeta[]> {
    type Linha = { id?: string; name: string; language: string; category?: string; status: string; rejected_reason?: string; components?: unknown[] };
    const saida: ModeloMeta[] = [];
    let caminho: string | undefined = `${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,category,status,rejected_reason,components&limit=100`;
    for (let i = 0; caminho && i < 5; i++) {
      const j: { data?: Linha[]; paging?: { next?: string } } = await this.graph.get(caminho, 'a lista de modelos');
      for (const t of j.data ?? []) {
        saida.push({
          ...(t.id ? { id: t.id } : {}),
          nome: t.name,
          idioma: t.language,
          categoria: t.category ?? '',
          status: t.status,
          ...(t.rejected_reason && t.rejected_reason !== 'NONE' ? { motivo: t.rejected_reason } : {}),
          componentes: t.components ?? [],
        });
      }
      caminho = j.paging?.next ? j.paging.next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '') : undefined;
    }
    return saida;
  }

  /**
   * Imagem de exemplo do cabeçalho: upload resumível da Graph API (descobre o app do token, abre a sessão e envia o arquivo).
   * Devolve o "handle" que vai em example.header_handle.
   */
  async subirExemplo(conteudo: Buffer, mimetype: string): Promise<string> {
    const app = await this.graph.get<{ id?: string }>('app?fields=id', 'a consulta do app');
    if (!app.id) throw new ErroMeta('Não deu para descobrir o app da Meta deste token', 502);
    const sessao = await this.graph.postJson<{ id?: string }>(
      `${encodeURIComponent(app.id)}/uploads?file_length=${conteudo.length}&file_type=${encodeURIComponent(mimetype)}`,
      {},
      'o envio da imagem de exemplo',
    );
    if (!sessao.id) throw new ErroMeta('Meta não abriu o envio da imagem de exemplo', 502);
    const resp = await this.fetchFn(`https://graph.facebook.com/v21.0/${sessao.id}`, {
      method: 'POST',
      headers: { authorization: `OAuth ${this.token}`, file_offset: '0', 'content-type': mimetype },
      body: new Uint8Array(conteudo),
      signal: AbortSignal.timeout(60_000),
    });
    const j = (await resp.json().catch(() => ({}))) as { h?: string; error?: { message?: string } };
    if (!resp.ok || !j.h) throw new ErroMeta(`Meta recusou a imagem de exemplo: ${j.error?.message ?? resp.status}`, 502);
    return j.h;
  }
}

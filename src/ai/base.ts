import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * Base de conhecimento da IA no banco ("Treinamento da IA"), em seções editáveis.
 * Na primeira vez (banco vazio) as seções nascem do knowledge/imperio.md.
 * O agente e o copiloto pedem o texto a cada resposta (com cópia de poucos segundos),
 * então uma edição vale sem reiniciar.
 */

export interface Secao {
  chave: string;
  titulo: string;
  ordem: number;
  conteudo: string;
  atualizadaEm: Date;
  atualizadaPor: string | null;
}

export interface VersaoSecao {
  titulo: string;
  conteudo: string;
  em: Date;
  por: string | null;
}

export interface Pergunta {
  id: string;
  pergunta: string;
  resposta: string;
  ordem: number;
  criadaEm: Date;
  atualizadaEm: Date;
  atualizadaPor: string | null;
}

export class ErroBase extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/** Quantas versões de cada seção ficam guardadas. */
export const VERSOES_GUARDADAS = 20;
export const MARCA_PENDENTE = '[PREENCHER';

export interface ArmazemBase {
  secoes(empresaId: string): Promise<Secao[]>;
  /** Grava (cria ou substitui) a seção e guarda a versão no histórico. Com `soSeNova`, não mexe se já existe. */
  gravarSecao(empresaId: string, s: Secao, soSeNova?: boolean): Promise<boolean>;
  apagarSecao(empresaId: string, chave: string): Promise<boolean>;
  historico(empresaId: string, chave: string, limite: number): Promise<VersaoSecao[]>;
  perguntas(empresaId: string): Promise<Pergunta[]>;
  gravarPergunta(empresaId: string, p: Pergunta): Promise<void>;
  apagarPergunta(empresaId: string, id: string): Promise<boolean>;
}

export class ArmazemBaseMemoria implements ArmazemBase {
  private readonly s = new Map<string, Secao>();
  private readonly v: Array<VersaoSecao & { empresaId: string; chave: string }> = [];
  private readonly p = new Map<string, Pergunta & { empresaId: string }>();

  async secoes(empresaId: string) {
    return [...this.s.entries()].filter(([k]) => k.startsWith(`${empresaId}|`)).map(([, x]) => ({ ...x }));
  }
  async gravarSecao(empresaId: string, s: Secao, soSeNova = false) {
    const k = `${empresaId}|${s.chave}`;
    if (soSeNova && this.s.has(k)) return false;
    this.s.set(k, { ...s });
    this.v.push({ empresaId, chave: s.chave, titulo: s.titulo, conteudo: s.conteudo, em: s.atualizadaEm, por: s.atualizadaPor });
    const destas = this.v.filter((x) => x.empresaId === empresaId && x.chave === s.chave);
    for (const velha of destas.slice(0, Math.max(0, destas.length - VERSOES_GUARDADAS))) this.v.splice(this.v.indexOf(velha), 1);
    return true;
  }
  async apagarSecao(empresaId: string, chave: string) {
    return this.s.delete(`${empresaId}|${chave}`);
  }
  async historico(empresaId: string, chave: string, limite: number) {
    return this.v
      .filter((x) => x.empresaId === empresaId && x.chave === chave)
      .reverse()
      .slice(0, limite)
      .map(({ titulo, conteudo, em, por }) => ({ titulo, conteudo, em, por }));
  }
  async perguntas(empresaId: string) {
    return [...this.p.values()].filter((x) => x.empresaId === empresaId).map(({ empresaId: _, ...x }) => ({ ...x }));
  }
  async gravarPergunta(empresaId: string, p: Pergunta) {
    this.p.set(p.id, { ...p, empresaId });
  }
  async apagarPergunta(empresaId: string, id: string) {
    const x = this.p.get(id);
    if (!x || x.empresaId !== empresaId) return false;
    return this.p.delete(id);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ArmazemBasePostgres implements ArmazemBase {
  constructor(private readonly pool: pg.Pool) {}

  async secoes(empresaId: string) {
    const { rows } = await this.pool.query<{ chave: string; titulo: string; ordem: number; conteudo: string; atualizada_em: Date; atualizada_por: string | null }>(
      'select chave, titulo, ordem, conteudo, atualizada_em, atualizada_por from sintonia.base_secoes where empresa_id = $1',
      [empresaId],
    );
    return rows.map((r) => ({ chave: r.chave, titulo: r.titulo, ordem: r.ordem, conteudo: r.conteudo, atualizadaEm: r.atualizada_em, atualizadaPor: r.atualizada_por }));
  }

  async gravarSecao(empresaId: string, s: Secao, soSeNova = false) {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('begin');
      const r = await cliente.query(
        `insert into sintonia.base_secoes (empresa_id, chave, titulo, ordem, conteudo, atualizada_em, atualizada_por)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (empresa_id, chave) do ${soSeNova ? 'nothing' : `update set titulo = excluded.titulo, ordem = excluded.ordem,
           conteudo = excluded.conteudo, atualizada_em = excluded.atualizada_em, atualizada_por = excluded.atualizada_por`}`,
        [empresaId, s.chave, s.titulo, s.ordem, s.conteudo, s.atualizadaEm, s.atualizadaPor],
      );
      const gravou = (r.rowCount ?? 0) > 0;
      if (gravou) {
        await cliente.query(
          'insert into sintonia.base_versoes (empresa_id, chave, titulo, conteudo, em, por) values ($1, $2, $3, $4, $5, $6)',
          [empresaId, s.chave, s.titulo, s.conteudo, s.atualizadaEm, s.atualizadaPor],
        );
        await cliente.query(
          `delete from sintonia.base_versoes where empresa_id = $1 and chave = $2 and id not in (
             select id from sintonia.base_versoes where empresa_id = $1 and chave = $2 order by em desc, id desc limit $3)`,
          [empresaId, s.chave, VERSOES_GUARDADAS],
        );
      }
      await cliente.query('commit');
      return gravou;
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }

  async apagarSecao(empresaId: string, chave: string) {
    const r = await this.pool.query('delete from sintonia.base_secoes where empresa_id = $1 and chave = $2', [empresaId, chave]);
    return (r.rowCount ?? 0) > 0;
  }

  async historico(empresaId: string, chave: string, limite: number) {
    const { rows } = await this.pool.query<{ titulo: string; conteudo: string; em: Date; por: string | null }>(
      'select titulo, conteudo, em, por from sintonia.base_versoes where empresa_id = $1 and chave = $2 order by em desc, id desc limit $3',
      [empresaId, chave, limite],
    );
    return rows;
  }

  async perguntas(empresaId: string) {
    const { rows } = await this.pool.query<{ id: string; pergunta: string; resposta: string; ordem: number; criada_em: Date; atualizada_em: Date; atualizada_por: string | null }>(
      'select id, pergunta, resposta, ordem, criada_em, atualizada_em, atualizada_por from sintonia.base_faq where empresa_id = $1',
      [empresaId],
    );
    return rows.map((r) => ({ id: r.id, pergunta: r.pergunta, resposta: r.resposta, ordem: r.ordem, criadaEm: r.criada_em, atualizadaEm: r.atualizada_em, atualizadaPor: r.atualizada_por }));
  }

  async gravarPergunta(empresaId: string, p: Pergunta) {
    await this.pool.query(
      `insert into sintonia.base_faq (id, empresa_id, pergunta, resposta, ordem, criada_em, atualizada_em, atualizada_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set pergunta = excluded.pergunta, resposta = excluded.resposta, ordem = excluded.ordem,
         atualizada_em = excluded.atualizada_em, atualizada_por = excluded.atualizada_por`,
      [p.id, empresaId, p.pergunta, p.resposta, p.ordem, p.criadaEm, p.atualizadaEm, p.atualizadaPor],
    );
  }

  async apagarPergunta(empresaId: string, id: string) {
    if (!UUID.test(id)) return false;
    const r = await this.pool.query('delete from sintonia.base_faq where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }
}

/** "Regras comerciais" → "regras-comerciais". */
export function chaveDoTitulo(titulo: string): string {
  return (
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'secao'
  );
}

/** Quebra o markdown nas seções "## Título". O que vem antes da primeira seção (título e aviso) fica de fora. */
export function secoesDoMarkdown(md: string): Array<{ chave: string; titulo: string; conteudo: string }> {
  const saida: Array<{ chave: string; titulo: string; conteudo: string }> = [];
  for (const bloco of md.split(/^## /m).slice(1)) {
    const quebra = bloco.indexOf('\n');
    const titulo = (quebra < 0 ? bloco : bloco.slice(0, quebra)).trim();
    const conteudo = quebra < 0 ? '' : bloco.slice(quebra + 1).trim();
    // A chave ignora o comentário entre parênteses: "Serviços (descrição...)" → "servicos".
    let chave = chaveDoTitulo(titulo.replace(/\(.*?\)/g, ''));
    while (saida.some((s) => s.chave === chave)) chave += '-2';
    saida.push({ chave, titulo, conteudo });
  }
  return saida;
}

export const CHAVE_FAQ = 'perguntas-frequentes';

export interface Pendencia {
  chave: string;
  titulo: string;
  /** Número da linha dentro da seção (1 = primeira). */
  linha: number;
  trecho: string;
}

/** Trechos que ainda têm [PREENCHER], seção por seção. */
export function pendenciasDe(secoes: Array<Pick<Secao, 'chave' | 'titulo' | 'conteudo'>>): Pendencia[] {
  const r: Pendencia[] = [];
  for (const s of secoes) {
    s.conteudo.split('\n').forEach((linha, i) => {
      if (linha.toUpperCase().includes(MARCA_PENDENTE)) r.push({ chave: s.chave, titulo: s.titulo, linha: i + 1, trecho: linha.trim() });
    });
  }
  return r;
}

const CABECALHO = `# Base de conhecimento da IA

> Trechos marcados com [PREENCHER] ainda não foram preenchidos pela equipe: não invente essas informações;
> diga que vai confirmar e chame alguém da equipe (passar_para_humano).
> Preços e duração dos serviços NÃO ficam aqui: leia sempre do Trinks.`;

const ordenarSecoes = (l: Secao[]) => l.sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo, 'pt-BR'));
const ordenarPerguntas = (l: Pergunta[]) => l.sort((a, b) => a.ordem - b.ordem || a.criadaEm.getTime() - b.criadaEm.getTime());

/** Monta o texto que vai no system prompt. As perguntas frequentes entram na seção delas. */
export function montarTexto(secoes: Secao[], perguntas: Pergunta[]): string {
  const faq = ordenarPerguntas([...perguntas])
    .map((p) => `- Pergunta: ${p.pergunta.trim()}\n  Resposta: ${p.resposta.trim()}`)
    .join('\n');
  const partes = [CABECALHO];
  let faqUsada = !faq;
  for (const s of ordenarSecoes([...secoes])) {
    let corpo = s.conteudo.trim();
    if (s.chave === CHAVE_FAQ && faq) {
      corpo = [corpo, faq].filter(Boolean).join('\n');
      faqUsada = true;
    }
    partes.push(`## ${s.titulo}\n${corpo}`);
  }
  if (!faqUsada) partes.push(`## Perguntas frequentes\n${faq}`);
  return `${partes.join('\n\n')}\n`;
}

export class BaseConhecimento {
  private cache?: { texto: string; ate: number };
  private semeando?: Promise<void>;

  constructor(
    private readonly armazem: ArmazemBase,
    readonly empresaId: string,
    /** Texto do knowledge/imperio.md (semente da primeira vez). */
    private readonly semente: () => string,
    private readonly opcoes: { cacheMs?: number; agora?: () => Date } = {},
  ) {}

  private agora() {
    return (this.opcoes.agora ?? (() => new Date()))();
  }

  /**
   * Se a empresa ainda não tem nenhuma seção, cria as do arquivo. Uma vez só por processo
   * (chamadas ao mesmo tempo esperam a mesma semeadura); entre processos, "soSeNova" evita duplicar.
   */
  garantirSemente(): Promise<void> {
    this.semeando ??= this.semear().catch((e) => {
      this.semeando = undefined; // tenta de novo na próxima
      throw e;
    });
    return this.semeando;
  }

  private async semear(): Promise<void> {
    if ((await this.armazem.secoes(this.empresaId)).length) return;
    const em = this.agora();
    for (const [i, s] of secoesDoMarkdown(this.semente()).entries()) {
      await this.armazem.gravarSecao(this.empresaId, { ...s, ordem: i, atualizadaEm: em, atualizadaPor: 'semente' }, true);
    }
  }

  async secoes(): Promise<Secao[]> {
    await this.garantirSemente();
    return ordenarSecoes(await this.armazem.secoes(this.empresaId));
  }

  async perguntas(): Promise<Pergunta[]> {
    return ordenarPerguntas(await this.armazem.perguntas(this.empresaId));
  }

  async pendencias(): Promise<Pendencia[]> {
    return pendenciasDe(await this.secoes());
  }

  /** Texto que a IA usa agora (versão mais nova do banco). */
  async texto(): Promise<string> {
    const t = Date.now();
    if (this.cache && this.cache.ate > t) return this.cache.texto;
    const texto = montarTexto(await this.secoes(), await this.perguntas());
    this.cache = { texto, ate: t + (this.opcoes.cacheMs ?? 5000) };
    return texto;
  }

  private esquecer() {
    this.cache = undefined;
  }

  async exigirSecao(chave: string): Promise<Secao> {
    const s = (await this.secoes()).find((x) => x.chave === chave);
    if (!s) throw new ErroBase('Seção não encontrada.', 404);
    return s;
  }

  async editar(chave: string, campos: { titulo?: string; conteudo?: string; ordem?: number }, por: string): Promise<Secao> {
    const atual = await this.exigirSecao(chave);
    const nova: Secao = {
      ...atual,
      titulo: campos.titulo?.trim() || atual.titulo,
      conteudo: campos.conteudo !== undefined ? campos.conteudo.trim() : atual.conteudo,
      ordem: campos.ordem ?? atual.ordem,
      atualizadaEm: this.agora(),
      atualizadaPor: por,
    };
    await this.armazem.gravarSecao(this.empresaId, nova);
    this.esquecer();
    return nova;
  }

  async criar(dados: { titulo: string; conteudo: string }, por: string): Promise<Secao> {
    const lista = await this.secoes();
    const titulo = dados.titulo.trim();
    let chave = chaveDoTitulo(titulo);
    if (lista.some((s) => s.chave === chave)) {
      if (lista.some((s) => s.titulo.toLowerCase() === titulo.toLowerCase())) throw new ErroBase(`Já existe a seção "${titulo}".`, 409);
      let n = 2;
      while (lista.some((s) => s.chave === `${chave}-${n}`)) n++;
      chave = `${chave}-${n}`;
    }
    const s: Secao = {
      chave,
      titulo,
      conteudo: dados.conteudo.trim(),
      ordem: lista.reduce((m, x) => Math.max(m, x.ordem), -1) + 1,
      atualizadaEm: this.agora(),
      atualizadaPor: por,
    };
    await this.armazem.gravarSecao(this.empresaId, s);
    this.esquecer();
    return s;
  }

  async apagar(chave: string): Promise<void> {
    await this.exigirSecao(chave);
    await this.armazem.apagarSecao(this.empresaId, chave);
    this.esquecer();
  }

  async historico(chave: string, limite = 10): Promise<VersaoSecao[]> {
    await this.exigirSecao(chave);
    return this.armazem.historico(this.empresaId, chave, limite);
  }

  async adicionarPergunta(dados: { pergunta: string; resposta: string }, por: string): Promise<Pergunta> {
    const lista = await this.perguntas();
    const em = this.agora();
    const p: Pergunta = {
      id: randomUUID(),
      pergunta: dados.pergunta.trim(),
      resposta: dados.resposta.trim(),
      ordem: lista.reduce((m, x) => Math.max(m, x.ordem), -1) + 1,
      criadaEm: em,
      atualizadaEm: em,
      atualizadaPor: por,
    };
    await this.armazem.gravarPergunta(this.empresaId, p);
    this.esquecer();
    return p;
  }

  async editarPergunta(id: string, campos: { pergunta?: string; resposta?: string; ordem?: number }, por: string): Promise<Pergunta> {
    const atual = (await this.perguntas()).find((p) => p.id === id);
    if (!atual) throw new ErroBase('Pergunta não encontrada.', 404);
    const p: Pergunta = {
      ...atual,
      pergunta: campos.pergunta?.trim() || atual.pergunta,
      resposta: campos.resposta?.trim() || atual.resposta,
      ordem: campos.ordem ?? atual.ordem,
      atualizadaEm: this.agora(),
      atualizadaPor: por,
    };
    await this.armazem.gravarPergunta(this.empresaId, p);
    this.esquecer();
    return p;
  }

  async apagarPergunta(id: string): Promise<void> {
    if (!(await this.armazem.apagarPergunta(this.empresaId, id))) throw new ErroBase('Pergunta não encontrada.', 404);
    this.esquecer();
  }
}

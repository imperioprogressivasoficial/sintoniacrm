import { randomUUID } from 'node:crypto';
import type { Conversa } from '../domain.js';
import type { ArmazemAgentesIa } from './armazem.js';
import type { ExecutorAgentes, ResultadoAgente } from './executor.js';
import { importarLink, LIMITE_TEXTO, textoDoPdf } from './importar.js';
import { notaDoAgente } from './nota.js';
import { ConfigAgente, ConfigControle, MODELOS, publico, type AgenteIa, type AgenteNovo, type Conhecimento } from './tipos.js';
import type { Repositorio } from '../store/repositorio.js';

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

/** Regras do estúdio: criar/editar agentes (chave cifrada), conhecimento, memória e aprendizados. */
export class ServicoAgentesIa {
  constructor(
    private readonly d: {
      empresaId: string;
      armazem: ArmazemAgentesIa;
      cofre: { cifrar(s: string): string };
      executor: ExecutorAgentes;
      repo: Pick<Repositorio, 'mensagens'>;
      baseGeral: () => Promise<string>;
      agora?: () => Date;
      fetch?: typeof fetch;
    },
  ) {}
  private agora() {
    return this.d.agora?.() ?? new Date();
  }

  async listar() {
    return (await this.d.armazem.listar(this.d.empresaId)).map(publico);
  }

  async exigir(id: string): Promise<AgenteIa> {
    const a = await this.d.armazem.buscar(id);
    if (!a || a.empresaId !== this.d.empresaId) throw erro('Agente não encontrado.', 404);
    return a;
  }

  async criar(b: AgenteNovo, por: string): Promise<AgenteIa> {
    const agora = this.agora();
    const provedor = b.provedor ?? 'anthropic';
    const a: AgenteIa = {
      id: randomUUID(),
      empresaId: this.d.empresaId,
      nome: b.nome,
      avatar: b.avatar?.trim() || '✦',
      unidades: b.unidades ?? ['norte', 'sumare'],
      provedor,
      modelo: b.modelo ?? MODELOS[provedor][0]!.id,
      chaveCifrada: b.chave ? this.d.cofre.cifrar(b.chave) : null,
      criatividade: b.criatividade ?? 50,
      config: ConfigAgente.parse(b.config ?? {}),
      ativo: b.ativo ?? true,
      criadoEm: agora,
      atualizadoEm: agora,
      atualizadoPor: por,
    };
    await this.d.armazem.salvar(a);
    return a;
  }

  async alterar(id: string, b: Partial<AgenteNovo>, por: string): Promise<AgenteIa> {
    const a = await this.exigir(id);
    if (b.nome !== undefined) a.nome = b.nome;
    if (b.avatar !== undefined) a.avatar = b.avatar.trim() || '✦';
    if (b.unidades !== undefined) a.unidades = b.unidades;
    if (b.provedor !== undefined && b.provedor !== a.provedor) {
      a.provedor = b.provedor;
      if (b.modelo === undefined) a.modelo = MODELOS[b.provedor][0]!.id;
    }
    if (b.modelo !== undefined) a.modelo = b.modelo;
    if (b.chave !== undefined) a.chaveCifrada = b.chave ? this.d.cofre.cifrar(b.chave) : null;
    if (b.criatividade !== undefined) a.criatividade = b.criatividade;
    if (b.config !== undefined) a.config = ConfigAgente.parse({ ...a.config, ...b.config });
    if (b.ativo !== undefined) a.ativo = b.ativo;
    a.atualizadoEm = this.agora();
    a.atualizadoPor = por;
    await this.d.armazem.salvar(a);
    return a;
  }

  async apagar(id: string) {
    await this.exigir(id);
    const ctrl = await this.d.armazem.controle(this.d.empresaId);
    for (const u of ['norte', 'sumare'] as const) {
      if (ctrl[u].agenteId === id) throw erro('Este agente está no "IA atende primeiro" de uma unidade. Troque o agente lá antes de apagar.', 409);
    }
    await this.d.armazem.apagar(id);
  }

  async detalhe(id: string) {
    const a = await this.exigir(id);
    const [conhecimento, pendentes, aprovados, base] = await Promise.all([
      this.d.armazem.conhecimentos(id),
      this.d.armazem.aprendizados(id, 'pendente'),
      this.d.armazem.aprendizados(id, 'aprovado'),
      this.d.baseGeral().catch(() => ''),
    ]);
    return { agente: publico(a), conhecimento, aprendizadosPendentes: pendentes.length, aprendizadosAprovados: aprovados, nota: notaDoAgente(a, conhecimento, aprovados.length, base.trim().length > 50) };
  }

  // ---------- conhecimento próprio
  async adicionarConhecimento(id: string, k: { tipo: Conhecimento['tipo']; titulo: string; conteudo: string; origem?: string }, por: string) {
    await this.exigir(id);
    const item: Conhecimento = {
      id: randomUUID(),
      agenteId: id,
      tipo: k.tipo,
      titulo: k.titulo.slice(0, 120),
      conteudo: k.conteudo.slice(0, LIMITE_TEXTO),
      origem: k.origem ?? null,
      criadoEm: this.agora(),
      criadoPor: por,
    };
    await this.d.armazem.adicionarConhecimento(item);
    return item;
  }
  async importarLink(id: string, url: string, por: string) {
    const r = await importarLink(url, this.d.fetch);
    return this.adicionarConhecimento(id, { tipo: 'link', titulo: r.titulo, conteudo: r.texto, origem: url }, por);
  }
  async importarArquivo(id: string, f: { nome: string; base64?: string; texto?: string }, por: string) {
    let texto = f.texto ?? '';
    if (!texto && f.base64) {
      const buf = Buffer.from(f.base64, 'base64');
      texto = /\.pdf$/i.test(f.nome) || buf.subarray(0, 5).toString() === '%PDF-' ? textoDoPdf(buf) : buf.toString('utf8');
    }
    texto = texto.replace(/\r/g, '').trim();
    if (!texto) throw erro('Não encontrei texto nesse arquivo (PDF escaneado vira imagem; cole o texto ou use um .txt).', 422);
    return this.adicionarConhecimento(id, { tipo: 'arquivo', titulo: f.nome, conteudo: texto, origem: f.nome }, por);
  }
  async apagarConhecimento(id: string, kid: string) {
    await this.exigir(id);
    if (!(await this.d.armazem.apagarConhecimento(id, kid))) throw erro('Item não encontrado.', 404);
  }

  // ---------- aprendizados
  async sugerirAprendizado(id: string, texto: string, origem: Record<string, unknown>) {
    await this.exigir(id);
    const a = { id: randomUUID(), agenteId: id, texto, origem, situacao: 'pendente' as const, criadoEm: this.agora(), decididoPor: null, decididoEm: null };
    await this.d.armazem.adicionarAprendizado(a);
    return a;
  }
  async aprendizados(situacao?: 'pendente' | 'aprovado' | 'recusado') {
    const [lista, agentes] = await Promise.all([this.d.armazem.aprendizadosDaEmpresa(this.d.empresaId, situacao), this.d.armazem.listar(this.d.empresaId)]);
    const nome = new Map(agentes.map((a) => [a.id, a.nome]));
    return lista.map((x) => ({ ...x, agenteNome: nome.get(x.agenteId) ?? 'Agente' }));
  }
  async decidir(aid: string, situacao: 'aprovado' | 'recusado', por: string, texto?: string) {
    const meus = await this.d.armazem.aprendizadosDaEmpresa(this.d.empresaId);
    if (!meus.some((x) => x.id === aid)) throw erro('Aprendizado não encontrado.', 404);
    return (await this.d.armazem.decidirAprendizado(aid, situacao, por, this.agora(), texto))!;
  }

  // ---------- memória por cliente
  memoria(telefone: string) {
    return this.d.armazem.memoria(this.d.empresaId, telefone);
  }
  async gravarMemoria(c: Conversa, chave: string, valor: string, por: string) {
    await this.d.armazem.gravarMemoria(this.d.empresaId, { telefone: c.telefone, chave, valor, agenteId: null, conversaId: c.id, fonte: `equipe: ${por}`, atualizadoEm: this.agora() });
    return this.memoria(c.telefone);
  }
  async apagarMemoria(c: Conversa, chave: string) {
    await this.d.armazem.apagarMemoria(this.d.empresaId, c.telefone, chave);
    return this.memoria(c.telefone);
  }
  memoriasRecentes(limite = 60) {
    return this.d.armazem.memoriasRecentes(this.d.empresaId, limite);
  }

  // ---------- IA atende primeiro
  controle() {
    return this.d.armazem.controle(this.d.empresaId);
  }
  async gravarControle(bruto: unknown, por: string) {
    const atual = await this.controle();
    const novo = ConfigControle.parse({ ...atual, ...(bruto as object) });
    for (const u of ['norte', 'sumare'] as const) {
      const c = novo[u];
      if (c.ligado && !c.agenteId) throw erro('Escolha o agente que atende primeiro.', 400);
      if (c.agenteId) {
        const a = await this.exigir(c.agenteId);
        if (c.ligado && !a.ativo) throw erro(`O agente ${a.nome} está desligado.`, 400);
      }
    }
    await this.d.armazem.gravarControle(this.d.empresaId, novo, por, this.agora());
    return novo;
  }

  /** Para o construtor visual de bot: roda o agente nesta conversa e devolve a resposta (não envia nada). */
  async executarAgente(agenteIaId: string, conversa: Conversa, objetivo?: string): Promise<ResultadoAgente> {
    const a = await this.exigir(agenteIaId);
    const mensagens = await this.d.repo.mensagens(conversa.id);
    return this.d.executor.executar(a, { conversa, mensagens, agora: this.agora(), modo: 'responder', objetivo });
  }
}

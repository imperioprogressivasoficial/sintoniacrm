import { z } from 'zod';
import { ETAPAS, NOME_ETAPA, type Conversa, type Etapa, type UnidadeId } from '../domain.js';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import { contatoVazio, validarCampos, type ArmazemContatos, type CampoContato, type Contato } from '../contatos/contatos.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Tags } from '../tags/tags.js';
import { UNIDADES } from '../unidades.js';
import { gerarCsv } from '../util/csv.js';
import { dataISO, horaHHmm } from '../util/tempo.js';
import type { ArmazemLeads } from './armazem.js';
import { chavePar, encontrarDuplicatas, NOME_MOTIVO, type MotivoDuplicata } from './duplicatas.js';
import { chaveTelefone, normalizarTelefoneBR } from './telefone-br.js';

/**
 * Leads: exportar (CSV para o Excel), importar (planilha) e controle de duplicatas (detectar, mesclar,
 * "não é duplicata"). Importar nunca envia mensagem para ninguém: cria a ficha e, se pedido, a conversa vazia.
 */

export interface OpcoesLeads {
  repo: Repositorio;
  armazem: ArmazemLeads;
  contatos: ArmazemContatos;
  empresaId: string;
  tags?: Tags;
  /** Funil do sistema: conversa criada por fora do motor entra na etapa dela. */
  funis?: { garantirNoSistema(c: Conversa): Promise<void> };
  /** Número da loja por onde a conversa importada vai acontecer (o real da unidade, se houver). */
  canalDa: (unidade: UnidadeId) => string | undefined;
  /** Trava da conversa (a mesma da Sintonia): ninguém grava nela durante a mescla. */
  comConversa?: <T>(id: string, fn: (c: Conversa) => Promise<T>) => Promise<T | undefined>;
  agora: () => Date;
}

export const UNIDADES_LEADS = ['norte', 'sumare'] as const;

export interface FiltroLeads {
  unidade?: UnidadeId;
  etapa?: Etapa;
  tagId?: string;
  /** Criados a partir de (inclusive) / antes de (exclusive). */
  de?: Date;
  ate?: Date;
}

export interface LinhaLead {
  telefone: string;
  nome: string | null;
  email: string | null;
  unidade: UnidadeId | null;
  etapa: Etapa | null;
  tags: string[];
  dona: string | null;
  criadoEm: Date | null;
  campos: Contato['campos'];
  conversaId: string | null;
}

// ------------------------------------------------------------------ importação

const texto = (max: number) => z.string().trim().max(max).optional().nullable();
export const LinhaImportacao = z.object({
  nome: texto(120),
  telefone: z.union([z.string(), z.number()]).transform(String),
  email: texto(200),
  unidade: texto(60),
  etapa: texto(60),
  /** Nomes de tags separados por vírgula. */
  tags: texto(500),
  observacoes: texto(4000),
  /** id do campo personalizado → valor como veio da planilha. */
  campos: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional(),
});
export type LinhaImportacao = z.infer<typeof LinhaImportacao>;

export const PedidoImportacao = z.object({
  linhas: z.array(LinhaImportacao).min(1).max(5000),
  unidade: z.enum(UNIDADES_LEADS),
  etapa: z.enum(ETAPAS).default('novo_lead'),
  tagId: z.string().min(1).optional(),
  /** Cria também a conversa (sem mensagem) para o lead aparecer no CRM e no funil. */
  criarConversa: z.boolean().default(true),
  /** DDD para números sem DDD (ex.: "71"). */
  dddPadrao: z.string().regex(/^\d{2}$/).optional(),
  /** Só confere: nada é gravado (prévia). */
  simular: z.boolean().default(false),
});
export type PedidoImportacao = z.infer<typeof PedidoImportacao>;

export interface ResultadoLinha {
  linha: number;
  telefone: string | null;
  nome: string | null;
  situacao: 'criado' | 'atualizado' | 'igual' | 'recusado';
  motivo?: string;
  avisos?: string[];
}

export interface RelatorioImportacao {
  simulado: boolean;
  total: number;
  criados: number;
  atualizados: number;
  iguais: number;
  recusados: number;
  conversasCriadas: number;
  linhas: ResultadoLinha[];
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function unidadeDe(v: string | null | undefined): UnidadeId | null | undefined {
  if (!v || !v.trim()) return undefined;
  const s = semAcento(v);
  if (s.includes('norte')) return 'norte';
  if (s.includes('sumare')) return 'sumare';
  return null;
}

function etapaDe(v: string | null | undefined): Etapa | null | undefined {
  if (!v || !v.trim()) return undefined;
  const s = semAcento(v).replace(/[_-]/g, ' ');
  for (const e of ETAPAS) if (s === e.replace(/_/g, ' ') || s === semAcento(NOME_ETAPA[e])) return e;
  if (s.startsWith('agend')) return 'agendada';
  if (s.startsWith('compar')) return 'compareceu';
  if (s.startsWith('perd')) return 'perdida';
  if (s.startsWith('interes')) return 'interessada';
  if (s.startsWith('manut')) return 'manutencao';
  if (s === 'novo' || s === 'lead' || s.startsWith('novo')) return 'novo_lead';
  return null;
}

/** Valor da planilha para o tipo do campo personalizado ("sim", "15/03/1990", "1.234,5"). */
function valorDoCampo(def: CampoContato, v: unknown): unknown {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (def.tipo === 'sim_nao') {
    const x = semAcento(s);
    if (['sim', 's', 'x', 'yes', 'true', '1', 'verdadeiro'].includes(x)) return true;
    if (['nao', 'n', 'no', 'false', '0', 'falso'].includes(x)) return false;
    return s;
  }
  if (def.tipo === 'data') {
    const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
    if (br) {
      const ano = br[3]!.length === 2 ? `19${br[3]}` : br[3]!;
      return `${ano}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
    }
    return s.slice(0, 10);
  }
  if (def.tipo === 'numero') return s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (def.tipo === 'lista') return def.opcoes.find((o) => semAcento(o) === semAcento(s)) ?? s;
  return s;
}

const RANK_ETAPA: Record<Etapa, number> = { perdida: 0, novo_lead: 1, em_conversa: 2, interessada: 3, agendada: 4, compareceu: 5, manutencao: 6 };

// ------------------------------------------------------------------ duplicatas (resposta da API)

export interface LeadDuplicado {
  telefone: string;
  nome: string | null;
  email: string | null;
  temFicha: boolean;
  conversas: Array<{ id: string; unidade: UnidadeId; etapa: Etapa; criadaEm: Date; dona: string | null; ultimaMensagem: Date | null }>;
  tags: string[];
}

export interface GrupoDuplicataApi {
  id: string;
  motivos: Array<{ codigo: MotivoDuplicata; nome: string }>;
  leads: LeadDuplicado[];
  /** Telefone sugerido como principal (o que tem mais histórico). */
  sugerido: string;
}

export class ErroLeads extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export class Leads {
  constructor(private readonly o: OpcoesLeads) {}

  private async base() {
    const [conversas, fichas, campos, tags] = await Promise.all([
      this.o.repo.listarConversas(),
      this.o.armazem.contatos(this.o.empresaId),
      this.o.contatos.campos(this.o.empresaId),
      this.o.tags ? this.o.tags.dasConversas() : Promise.resolve(new Map<string, Array<{ id: string; nome: string }>>()),
    ]);
    return {
      conversas: conversas.filter((c) => c.empresaId === this.o.empresaId),
      fichas: new Map(fichas.map((f) => [f.telefone, f])),
      campos,
      tags,
    };
  }

  /** Linhas para exportar (uma por conversa; ficha sem conversa entra só sem filtro de unidade/etapa/tag). */
  async linhas(escopo: EscopoVisao, f: FiltroLeads = {}): Promise<{ linhas: LinhaLead[]; campos: CampoContato[] }> {
    const b = await this.base();
    const saida: LinhaLead[] = [];
    const comConversa = new Set<string>();
    const dentro = (d: Date | null) => (!f.de || (d && d >= f.de)) && (!f.ate || (d && d < f.ate));
    for (const c of b.conversas) {
      comConversa.add(c.telefone);
      if (!noEscopo(escopo, c)) continue;
      if (f.unidade && c.unidade !== f.unidade) continue;
      if (f.etapa && c.etapa !== f.etapa) continue;
      const tags = b.tags.get(c.id) ?? [];
      if (f.tagId && !tags.some((t) => t.id === f.tagId)) continue;
      if (!dentro(c.criadaEm)) continue;
      const ficha = b.fichas.get(c.telefone);
      saida.push({
        telefone: c.telefone,
        nome: ficha?.nome ?? c.nome ?? null,
        email: ficha?.email ?? null,
        unidade: c.unidade,
        etapa: c.etapa,
        tags: tags.map((t) => t.nome),
        dona: c.responsavelNome ?? null,
        criadoEm: c.criadaEm,
        campos: ficha?.campos ?? {},
        conversaId: c.id,
      });
    }
    if (!f.unidade && !f.etapa && !f.tagId) {
      for (const ficha of b.fichas.values()) {
        if (comConversa.has(ficha.telefone) || !dentro(ficha.criadoEm)) continue;
        saida.push({ telefone: ficha.telefone, nome: ficha.nome, email: ficha.email, unidade: null, etapa: null, tags: [], dona: null, criadoEm: ficha.criadoEm, campos: ficha.campos, conversaId: null });
      }
    }
    saida.sort((a, b2) => (b2.criadoEm?.getTime() ?? 0) - (a.criadoEm?.getTime() ?? 0));
    return { linhas: saida, campos: b.campos };
  }

  async exportarCsv(escopo: EscopoVisao, f: FiltroLeads = {}): Promise<{ csv: string; total: number }> {
    const { linhas, campos } = await this.linhas(escopo, f);
    const valor = (c: CampoContato, v: unknown) => (v === null || v === undefined ? '' : c.tipo === 'data' && typeof v === 'string' ? v.split('-').reverse().join('/') : (v as string | number | boolean));
    const csv = gerarCsv(
      ['Nome', 'Telefone', 'E-mail', 'Unidade', 'Etapa', 'Tags', 'Dona', 'Criado em', ...campos.map((c) => c.nome)],
      linhas.map((l) => [
        l.nome,
        l.telefone,
        l.email,
        l.unidade ? UNIDADES[l.unidade].nome : '',
        l.etapa ? NOME_ETAPA[l.etapa] : '',
        l.tags.join(', '),
        l.dona,
        l.criadoEm ? `${dataISO(l.criadoEm).split('-').reverse().join('/')} ${horaHHmm(l.criadoEm)}` : '',
        ...campos.map((c) => valor(c, l.campos[c.id])),
      ]),
    );
    return { csv, total: linhas.length };
  }

  /** Telefone já cadastrado com a mesma chave (com/sem 55, com/sem 9), ou undefined. */
  private indicePorChave(b: Awaited<ReturnType<Leads['base']>>) {
    const porChave = new Map<string, string>();
    for (const c of b.conversas) if (!porChave.has(chaveTelefone(c.telefone))) porChave.set(chaveTelefone(c.telefone), c.telefone);
    for (const t of b.fichas.keys()) if (!porChave.has(chaveTelefone(t))) porChave.set(chaveTelefone(t), t);
    const porEmail = new Map<string, string>();
    for (const f of b.fichas.values()) if (f.email) porEmail.set(f.email.toLowerCase(), f.telefone);
    return { porChave, porEmail };
  }

  /** Já existe alguém com este telefone (em qualquer formato) ou e-mail? Para impedir duplicata ao cadastrar. */
  async conferirDuplicata(telefone?: string, email?: string): Promise<{ telefone: string; motivo: MotivoDuplicata } | null> {
    const b = await this.base();
    const { porChave, porEmail } = this.indicePorChave(b);
    if (telefone) {
      const t = porChave.get(chaveTelefone(telefone));
      if (t) return { telefone: t, motivo: 'telefone' };
    }
    if (email) {
      const t = porEmail.get(email.trim().toLowerCase());
      if (t) return { telefone: t, motivo: 'email' };
    }
    return null;
  }

  async importar(p: PedidoImportacao, quem: string): Promise<RelatorioImportacao> {
    const b = await this.base();
    const { porChave, porEmail } = this.indicePorChave(b);
    const tagPadrao = p.tagId && this.o.tags ? await this.o.tags.exigir(p.tagId).catch(() => undefined) : undefined;
    if (p.tagId && this.o.tags && !tagPadrao) throw new ErroLeads('Tag não encontrada.', 400);
    const todasTags = this.o.tags ? await this.o.tags.listar() : [];
    const tagPorNome = new Map(todasTags.filter((t) => !t.chaveSistema).map((t) => [semAcento(t.nome), t]));
    const r: RelatorioImportacao = { simulado: p.simular, total: p.linhas.length, criados: 0, atualizados: 0, iguais: 0, recusados: 0, conversasCriadas: 0, linhas: [] };
    const naPlanilha = new Map<string, number>();
    const agora = this.o.agora();

    for (const [i, l] of p.linhas.entries()) {
      const n = i + 1;
      const nome = l.nome?.trim() || null;
      const recusar = (motivo: string, telefone: string | null = null) => {
        r.recusados++;
        r.linhas.push({ linha: n, telefone, nome, situacao: 'recusado', motivo });
      };
      const tel = normalizarTelefoneBR(l.telefone, { dddPadrao: p.dddPadrao });
      if (!tel.ok) {
        recusar(tel.motivo, String(l.telefone ?? '') || null);
        continue;
      }
      const repetida = naPlanilha.get(tel.telefone);
      if (repetida) {
        recusar(`Repetido na planilha (mesmo telefone do #${repetida})`, tel.telefone);
        continue;
      }
      naPlanilha.set(tel.telefone, n);
      const avisos: string[] = [];
      if (tel.ajuste) avisos.push(`Telefone: ${tel.ajuste}`);
      if (tel.tipo === 'fixo') avisos.push('Telefone fixo: confira se tem WhatsApp');

      let email: string | null = null;
      if (l.email?.trim()) {
        const e = z.string().trim().toLowerCase().email().safeParse(l.email);
        if (e.success) email = e.data;
        else avisos.push('E-mail inválido (ficou de fora)');
      }
      const unidadeLinha = unidadeDe(l.unidade);
      if (unidadeLinha === null) avisos.push(`Unidade "${l.unidade}" não reconhecida (usada a padrão)`);
      const unidade = unidadeLinha || p.unidade;
      const etapaLinha = etapaDe(l.etapa);
      if (etapaLinha === null) avisos.push(`Etapa "${l.etapa}" não reconhecida (usada a padrão)`);
      const etapa = etapaLinha || p.etapa;

      // Mesmo número em outro formato: atualiza o cadastro que já existe (nunca cria outro).
      const existente = porChave.get(chaveTelefone(tel.telefone));
      const telefone = existente ?? tel.telefone;
      if (existente && existente !== tel.telefone) avisos.push(`Já cadastrado como ${existente}`);
      if (email) {
        const dono = porEmail.get(email);
        if (dono && dono !== telefone) {
          recusar(`E-mail já é de outro contato (${dono}). Confira em Duplicatas.`, tel.telefone);
          continue;
        }
      }

      // Ficha: preenche o que está vazio; campos personalizados e tags somam.
      const atual = b.fichas.get(telefone);
      const ficha: Contato = atual ? structuredClone(atual) : contatoVazio(telefone, null);
      const antes = JSON.stringify([ficha.nome, ficha.email, ficha.observacoes, ficha.campos]);
      const conversaNome = b.conversas.find((c) => c.telefone === telefone && c.nome)?.nome;
      if (!ficha.nome && (nome || conversaNome)) ficha.nome = nome ?? conversaNome ?? null;
      if (!ficha.email && email) ficha.email = email;
      if (l.observacoes?.trim()) ficha.observacoes = ficha.observacoes ? (ficha.observacoes.includes(l.observacoes.trim()) ? ficha.observacoes : `${ficha.observacoes}\n${l.observacoes.trim()}`) : l.observacoes.trim();
      if (l.campos) {
        for (const [id, v] of Object.entries(l.campos)) {
          const def = b.campos.find((c) => c.id === id);
          if (!def || v === null || v === '') continue;
          try {
            Object.assign(ficha.campos, validarCampos([def], { [id]: valorDoCampo(def, v) }));
          } catch (e) {
            avisos.push((e as Error).message);
          }
        }
      }
      const mudouFicha = JSON.stringify([ficha.nome, ficha.email, ficha.observacoes, ficha.campos]) !== antes || !atual;

      const tagsLinha = (l.tags ?? '')
        .split(/[,;|]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const tagsAplicar = [...(tagPadrao ? [tagPadrao] : [])];
      for (const t of tagsLinha) {
        const tag = tagPorNome.get(semAcento(t));
        if (tag) {
          if (!tagsAplicar.some((x) => x.id === tag.id)) tagsAplicar.push(tag);
        } else avisos.push(`Tag "${t}" não existe (crie em Tags)`);
      }

      let conversa = b.conversas.find((c) => c.telefone === telefone && c.unidade === unidade);
      const criarConversa = p.criarConversa && !conversa;
      const canalId = criarConversa ? this.o.canalDa(unidade) : undefined;
      if (criarConversa && !canalId) avisos.push(`Sem número de WhatsApp na unidade ${UNIDADES[unidade].nome}: conversa não criada`);
      let mudouTags = false;

      if (!p.simular) {
        if (mudouFicha) {
          await this.o.contatos.salvar(this.o.empresaId, ficha, quem);
          b.fichas.set(telefone, { ...ficha, criadoEm: atual?.criadoEm ?? agora });
        }
        if (criarConversa && canalId) {
          const criada = await this.o.repo.buscarOuCriarConversa({ empresaId: this.o.empresaId, unidade, canalId, telefone, nome: ficha.nome ?? undefined, agora });
          conversa = criada.conversa;
          if (criada.nova) {
            // Sem mensagem e "Só eu": a IA não puxa conversa com quem foi importado.
            conversa = { ...conversa, etapa, modo: 'humano' };
            await this.o.repo.salvarConversa(conversa);
            await this.o.repo.registrarEvento({ tipo: 'lead_importado', conversaId: conversa.id, unidade, em: agora, dados: { por: quem } });
            await this.o.funis?.garantirNoSistema(conversa).catch(() => {});
            r.conversasCriadas++;
          }
          b.conversas.push(conversa);
        }
        if (conversa && this.o.tags) {
          for (const t of tagsAplicar) {
            const m = await this.o.tags.marcar(conversa, t.id, quem).catch(() => undefined);
            if (m?.mudou) {
              mudouTags = true;
              await this.o.repo.registrarEvento({ tipo: 'tag_marcada', conversaId: conversa.id, unidade: conversa.unidade, em: agora, dados: { tagId: t.id, nome: t.nome, por: quem } });
            }
          }
        }
      } else {
        if (criarConversa && canalId) r.conversasCriadas++;
        if (tagsAplicar.length && (conversa || (criarConversa && canalId))) mudouTags = true;
      }
      porChave.set(chaveTelefone(telefone), telefone);
      if (email) porEmail.set(email, telefone);

      const situacao: ResultadoLinha['situacao'] = !atual && !existente ? 'criado' : mudouFicha || mudouTags || (criarConversa && canalId) ? 'atualizado' : 'igual';
      if (situacao === 'criado') r.criados++;
      else if (situacao === 'atualizado') r.atualizados++;
      else r.iguais++;
      r.linhas.push({ linha: n, telefone, nome: ficha.nome, situacao, ...(avisos.length ? { avisos } : {}) });
    }
    return r;
  }

  // ------------------------------------------------------------------ duplicatas

  private async leadsPorTelefone() {
    const b = await this.base();
    const leads = new Map<string, LeadDuplicado & { conversasObj: Conversa[] }>();
    const lead = (t: string) => {
      let l = leads.get(t);
      if (!l) {
        const f = b.fichas.get(t);
        l = { telefone: t, nome: f?.nome ?? null, email: f?.email ?? null, temFicha: Boolean(f), conversas: [], tags: [], conversasObj: [] };
        leads.set(t, l);
      }
      return l;
    };
    for (const c of b.conversas) {
      const l = lead(c.telefone);
      if (!l.nome && c.nome) l.nome = c.nome;
      l.conversasObj.push(c);
      l.conversas.push({
        id: c.id,
        unidade: c.unidade,
        etapa: c.etapa,
        criadaEm: c.criadaEm,
        dona: c.responsavelNome ?? null,
        ultimaMensagem: [c.ultimaMensagemCliente, c.ultimaMensagemEquipe, c.ultimaMensagemIa].filter((d): d is Date => Boolean(d)).sort((x, y) => y.getTime() - x.getTime())[0] ?? null,
      });
      for (const t of b.tags.get(c.id) ?? []) if (!l.tags.includes(t.nome)) l.tags.push(t.nome);
    }
    for (const t of b.fichas.keys()) lead(t);
    return { leads, b };
  }

  async duplicatas(escopo: EscopoVisao): Promise<GrupoDuplicataApi[]> {
    const { leads } = await this.leadsPorTelefone();
    const nao = await this.o.armazem.naoDuplicatas(this.o.empresaId);
    const grupos = encontrarDuplicatas([...leads.values()], nao);
    const peso = (l: LeadDuplicado & { conversasObj: Conversa[] }) =>
      l.conversas.length * 10 + (l.temFicha ? 3 : 0) + (l.email ? 1 : 0) + Math.max(0, ...l.conversasObj.map((c) => RANK_ETAPA[c.etapa]));
    return grupos
      .map((g) => g.telefones.map((t) => leads.get(t)!))
      .filter((ls) => ls.every((l) => l.conversasObj.every((c) => noEscopo(escopo, c))))
      .map((ls) => {
        const id = ls.map((l) => l.telefone).sort().join('|');
        const g = grupos.find((x) => x.id === id)!;
        const ordenados = [...ls].sort((a, b) => peso(b) - peso(a) || (a.conversas[0]?.criadaEm.getTime() ?? Infinity) - (b.conversas[0]?.criadaEm.getTime() ?? Infinity));
        return {
          id,
          motivos: g.motivos.map((m) => ({ codigo: m, nome: NOME_MOTIVO[m] })),
          sugerido: ordenados[0]!.telefone,
          leads: ordenados.map(({ conversasObj: _x, ...l }) => l),
        };
      });
  }

  async naoEDuplicata(telefones: string[], quem: string): Promise<void> {
    const pares: Array<[string, string]> = [];
    for (let i = 0; i < telefones.length; i++) for (let j = i + 1; j < telefones.length; j++) pares.push([telefones[i]!, telefones[j]!]);
    await this.o.armazem.marcarNaoDuplicata(this.o.empresaId, pares, quem);
  }

  /** Pares já marcados como "não é duplicata" (para a tela desfazer). */
  async paresNaoDuplicata(): Promise<string[]> {
    return [...(await this.o.armazem.naoDuplicatas(this.o.empresaId))];
  }

  /**
   * Mescla `outros` em `principal`: as conversas da mesma unidade viram uma (mensagens, tags, etapas, tarefas e eventos
   * vão para a principal); as de outra unidade passam a usar o telefone da principal. A ficha soma os dados
   * (o que a principal já tem fica). Registra o evento "leads_mesclados".
   */
  async mesclar(principal: string, outros: string[], escopo: EscopoVisao, quem: { nome: string; id?: string }) {
    const lista = [...new Set(outros.filter((t) => t && t !== principal))];
    if (!lista.length) throw new ErroLeads('Escolha pelo menos um contato para juntar na principal.', 400);
    const { leads, b } = await this.leadsPorTelefone();
    const p = leads.get(principal);
    if (!p) throw new ErroLeads('Contato principal não encontrado.', 404);
    const todos = [p, ...lista.map((t) => leads.get(t))];
    if (todos.some((l) => !l)) throw new ErroLeads('Contato não encontrado.', 404);
    if (todos.some((l) => l!.conversasObj.some((c) => !noEscopo(escopo, c)))) throw new ErroLeads('Você não vê todas as conversas desses contatos.', 403);

    const agora = this.o.agora();
    const juntadas: Array<{ de: string; para: string }> = [];
    const movidas: string[] = [];
    let fichaP: Contato = b.fichas.get(principal) ? structuredClone(b.fichas.get(principal)!) : contatoVazio(principal, null);
    const fichaAntes = JSON.stringify(fichaP);

    for (const t of lista) {
      const outro = leads.get(t)!;
      for (const c of outro.conversasObj) {
        const destino = (await this.o.repo.listarConversas()).find((x) => x.empresaId === this.o.empresaId && x.telefone === principal && x.unidade === c.unidade);
        if (destino) {
          const juntar = async () => {
            const atual = (await this.o.repo.buscarConversa(destino.id))!;
            const sec = await this.o.repo.buscarConversa(c.id);
            if (!sec) return;
            const max = (a?: Date, b2?: Date) => (a && b2 ? (a > b2 ? a : b2) : (a ?? b2));
            const novo: Conversa = {
              ...atual,
              nome: atual.nome ?? sec.nome,
              etapa: RANK_ETAPA[sec.etapa] > RANK_ETAPA[atual.etapa] ? sec.etapa : atual.etapa,
              trinksClienteId: atual.trinksClienteId ?? sec.trinksClienteId,
              responsavelId: atual.responsavelId ?? sec.responsavelId,
              responsavelNome: atual.responsavelId ? atual.responsavelNome : sec.responsavelNome,
              ultimaMensagemCliente: max(atual.ultimaMensagemCliente, sec.ultimaMensagemCliente),
              ultimaMensagemEquipe: max(atual.ultimaMensagemEquipe, sec.ultimaMensagemEquipe),
              ultimaMensagemIa: max(atual.ultimaMensagemIa, sec.ultimaMensagemIa),
              etiquetas: [...new Set([...atual.etiquetas, ...sec.etiquetas])],
              resumo: atual.resumo ?? sec.resumo,
              atualizadaEm: max(atual.atualizadaEm, sec.atualizadaEm)!,
              criadaEm: sec.criadaEm < atual.criadaEm ? sec.criadaEm : atual.criadaEm,
            };
            await this.o.armazem.unirConversas(sec.id, atual.id);
            await this.o.repo.salvarConversa(novo);
            await this.o.funis?.garantirNoSistema(novo).catch(() => {});
          };
          if (this.o.comConversa) await this.o.comConversa(destino.id, juntar);
          else await juntar();
          juntadas.push({ de: c.id, para: destino.id });
        } else {
          await this.o.armazem.trocarTelefone(c.id, principal);
          movidas.push(c.id);
        }
      }
      // Ficha: completa a principal com o que só a outra tem.
      const f = b.fichas.get(t);
      if (f) {
        fichaP = {
          ...fichaP,
          nome: fichaP.nome ?? f.nome,
          email: fichaP.email ?? f.email,
          nascimento: fichaP.nascimento ?? f.nascimento,
          observacoes: [fichaP.observacoes, f.observacoes].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join('\n') || null,
          empresa: { ...f.empresa, ...fichaP.empresa },
          campos: { ...Object.fromEntries(Object.entries(f.campos).filter(([, v]) => v !== null && v !== '')), ...Object.fromEntries(Object.entries(fichaP.campos).filter(([, v]) => v !== null && v !== '')) },
        };
        await this.o.armazem.apagarContato(this.o.empresaId, t);
      } else if (!fichaP.nome && outro.nome) fichaP = { ...fichaP, nome: outro.nome };
    }
    if (!fichaP.nome && p.nome) fichaP = { ...fichaP, nome: p.nome };
    if (JSON.stringify(fichaP) !== fichaAntes) await this.o.contatos.salvar(this.o.empresaId, fichaP, quem.nome);

    const finais = (await this.o.repo.listarConversas()).filter((c) => c.empresaId === this.o.empresaId && c.telefone === principal);
    for (const c of finais) {
      await this.o.repo.registrarEvento({
        tipo: 'leads_mesclados',
        conversaId: c.id,
        unidade: c.unidade,
        em: agora,
        dados: { principal, mesclados: lista, conversasJuntadas: juntadas, conversasMovidas: movidas, por: quem.nome, porId: quem.id ?? null },
      });
    }
    return { principal, mesclados: lista, conversasJuntadas: juntadas.length, conversasMovidas: movidas.length, conversas: finais.map((c) => c.id) };
  }
}

export { chavePar };

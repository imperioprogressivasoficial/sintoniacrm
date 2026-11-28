import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ETAPAS, NOME_ETAPA, type Conversa, type Mensagem } from '../domain.js';
import { nomeOuTelefone } from '../contatos/nome.js';
import type { PedidoBuscaMensagens } from '../store/repositorio.js';
import { unidadeDe } from '../unidades.js';
import { dataISO, DIA, deDataEHora, partesBahia } from '../util/tempo.js';
import type { Artefato, ResultadoFerramenta } from './acoes.js';
import { MAX_PESQUISAS, type Fonte, type ResultadoPesquisa } from './internet.js';

/**
 * serena-super: a Serena LÊ o CRM inteiro (o que a pessoa pode ver), como se fosse o próprio CRM falando.
 * Ferramentas de leitura agem direto (não mudam nada); as que mudam ficam em src/serena/mudar.ts (cartão + Confirmar).
 * - Quase tudo é lido pelas MESMAS rotas que as telas usam (`chamar` = app.inject com o login de quem pergunta):
 *   cada rota confere a permissão de sempre (relatórios, comercial, agenda, equipe...). Se a pessoa não pode,
 *   a rota responde 403 e a Serena diz isso com gentileza.
 * - A busca nas mensagens usa o índice de trigramas (robustez/550) direto no banco, com o escopo de quem vê,
 *   e confere podeVer de novo (só as conversas visíveis entram).
 * - Pesquisa na internet: só quando o chat interno liga (`internet`); nunca na IA das clientes.
 */

export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Chama uma rota da própria API como a pessoa que pergunta (mesmo login, mesmas permissões). */
export type Chamar = (metodo: MetodoHttp, url: string, corpo?: unknown) => Promise<{ status: number; corpo: unknown }>;

export interface FontesLer {
  chamar: Chamar;
  /** Conversas que a pessoa pode ver (já filtradas). */
  conversas: () => Promise<Conversa[]>;
  /** Busca no texto das mensagens (Repositorio.buscarMensagens), já com o escopo de quem vê. */
  buscarMensagens?: (p: Omit<PedidoBuscaMensagens, 'escopo'>) => Promise<Mensagem[]>;
  /** Pesquisa na internet (só no chat interno). */
  internet?: (consulta: string) => Promise<ResultadoPesquisa>;
  /** Texto do treinamento da IA (o mesmo que a Serena já segue; a atendente também lê por aqui). */
  treinamento?: () => Promise<string>;
  agora: () => Date;
}

type Ferramenta = Anthropic.Beta.Messages.BetaTool;
type Ref = (c: { conversaId: string; nome: string | null; unidade: string }) => string;

/** Telas que um cartão pode abrir (o nome interno da vista no app). */
export const VISTAS = {
  conversas: 'Conversas',
  funil: 'CRM (pipelines)',
  painel: 'Dashboard',
  relatorios: 'Relatórios (Dia a dia)',
  analises: 'Análises',
  comercial: 'Comercial',
  desempenho: 'Atendimento',
  agenda: 'Agenda',
  clientes: 'Clientes',
  tags: 'Etiquetas',
  respostas: 'Respostas rápidas',
  rotina: 'Rotina',
  scripts: 'Scripts de venda',
  automacoes: 'Fluxos',
  ia: 'Agente de IA (treinamento)',
  transmissoes: 'Transmissões',
  agendadas: 'Mensagens agendadas',
  distribuicao: 'Distribuição e prazos',
  equipe: 'Equipe',
  empresa: 'Empresa (documentos, produtos)',
  ligacoes: 'Ligações',
} as const;
export type Vista = keyof typeof VISTAS;
const NOMES_VISTAS = Object.keys(VISTAS) as Vista[];

/** Relatórios que a Serena lê (cada um vai para a rota da tela dele). */
export const RELATORIOS = ['dashboard', 'dia_a_dia', 'vendas', 'horarios', 'funil', 'clientes', 'perdas', 'comercial', 'comissao', 'nps', 'atendimento'] as const;
type Relatorio = (typeof RELATORIOS)[number];
const VISTA_DO_RELATORIO: Record<Relatorio, Vista> = {
  dashboard: 'painel',
  dia_a_dia: 'relatorios',
  vendas: 'analises',
  horarios: 'analises',
  funil: 'analises',
  clientes: 'analises',
  perdas: 'analises',
  comercial: 'comercial',
  comissao: 'comercial',
  nps: 'relatorios',
  atendimento: 'desempenho',
};

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const Periodo = z.enum(['hoje', 'ontem', '7d', '30d', 'mes', 'personalizado']);
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const q = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const hm = (d: Date) => {
  const p = partesBahia(d);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
};

/** JSON enxuto para a IA ler (listas cortadas, textos curtos, sem o que só serve à tela). */
export function enxugar(v: unknown, prof = 0): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? v.slice(0, 240) : v;
  if (prof > 5) return '…';
  if (Array.isArray(v)) {
    const l = v.slice(0, 30).map((x) => enxugar(x, prof + 1));
    return v.length > 30 ? [...l, `… e mais ${v.length - 30}`] : l;
  }
  const saida: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (['opcoes', 'csv', 'foto', 'fotoUrl', 'avatar', 'base64', 'conteudo', 'html', 'layout', 'cores', 'icones'].includes(k)) continue;
    saida[k] = enxugar(x, prof + 1);
  }
  return saida;
}
const json = (v: unknown, max = 9000) => {
  const s = JSON.stringify(enxugar(v));
  return s.length > max ? `${s.slice(0, max)}… (cortado)` : s;
};

/** Trecho em volta do termo achado (para mostrar na busca). */
export function trecho(texto: string, termo: string, raio = 70): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  const i = sem(t).indexOf(sem(termo));
  if (i < 0) return t.slice(0, raio * 2);
  const ini = Math.max(0, i - raio);
  const fim = Math.min(t.length, i + termo.length + raio);
  return `${ini > 0 ? '…' : ''}${t.slice(ini, fim)}${fim < t.length ? '…' : ''}`;
}

export class LerSerena {
  /** Fontes da internet usadas nesta mensagem (a tela mostra os links). */
  readonly fontesWeb: Fonte[] = [];
  private pesquisas = 0;

  constructor(
    private readonly f: FontesLer,
    private readonly guardar: (a: Omit<Artefato, 'id'>) => Artefato,
    private readonly ref: () => Ref | undefined,
  ) {}

  static readonly NOMES = new Set(['buscar_mensagens', 'buscar_leads', 'buscar_documentos', 'ver_numeros', 'ver_agenda', 'ver_equipe', 'pesquisar_internet', 'mostrar_numeros', 'mostrar_atalho']);

  /** Rótulo para a tela mostrar enquanto a ferramenta roda. */
  static rotulo(nome: string): string | undefined {
    return (
      {
        buscar_mensagens: 'Procurando nas mensagens…',
        buscar_leads: 'Procurando clientes…',
        buscar_clientes: 'Procurando clientes…',
        buscar_documentos: 'Lendo documentos e treinamento…',
        ver_numeros: 'Vendo os números…',
        ver_agenda: 'Olhando a agenda…',
        ver_equipe: 'Vendo a equipe…',
        pesquisar_internet: 'Pesquisando na internet…',
      } as Record<string, string>
    )[nome];
  }

  regras(): string[] {
    return [
      'Você lê (sem pedir confirmação): mensagens das conversas, clientes/leads, documentos, treinamento, produtos, scripts, respostas rápidas, números e relatórios, agenda e equipe — sempre só o que esta pessoa pode ver. Se uma ferramenta disser que a pessoa não tem acesso, explique com gentileza.',
      this.f.internet ? `Você pode pesquisar na internet (até ${MAX_PESQUISAS} pesquisas por mensagem).` : '',
    ].filter(Boolean);
  }

  ferramentas(): Ferramenta[] {
    const f: Ferramenta[] = [];
    if (this.f.buscarMensagens)
      f.push({
        name: 'buscar_mensagens',
        description:
          'Procura um texto dentro das mensagens de TODAS as conversas que esta pessoa pode ver (ex.: "quem falou em promoção", "quem perguntou de progressiva esta semana"). Devolve trechos com a cliente, quando e quem mandou, e mostra à pessoa um cartão com os trechos e o botão de abrir a conversa. Filtros opcionais: cliente (nome), período, unidade e quem mandou.',
        input_schema: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'O que procurar (2 letras ou mais). Uma palavra ou expressão curta funciona melhor.' },
            cliente: { type: ['string', 'null'], description: 'Parte do nome da cliente' },
            desde: { type: ['string', 'null'], description: 'AAAA-MM-DD' },
            ate: { type: ['string', 'null'], description: 'AAAA-MM-DD (inclui o dia)' },
            unidade: { type: ['string', 'null'], description: 'Id da unidade' },
            quem: { type: ['string', 'null'], enum: ['cliente', 'equipe', 'ia', null], description: 'Quem mandou a mensagem' },
            limite: { type: ['integer', 'null'], description: 'Quantos trechos no máximo (padrão 20, até 50)' },
          },
          required: ['texto'],
          additionalProperties: false,
        },
      });
    f.push(
      {
        name: 'buscar_leads',
        description:
          'Procura clientes/leads que esta pessoa pode ver por nome, telefone ou texto, etiqueta, etapa do pipeline (as etapas também são etiquetas), etapa de atendimento, unidade, origem (Instagram, Google, indicação…) e último contato. Devolve a lista com conversa_id, etiquetas, origem e há quanto tempo foi o último contato.',
        input_schema: {
          type: 'object',
          properties: {
            busca: { type: ['string', 'null'], description: 'Nome, telefone ou um texto que apareceu na conversa' },
            etiqueta: { type: ['string', 'null'], description: 'Nome da etiqueta ou da etapa do pipeline' },
            etapa_atendimento: { type: ['string', 'null'], enum: [...ETAPAS, null] },
            unidade: { type: ['string', 'null'], description: 'Id da unidade' },
            origem: { type: ['string', 'null'], description: 'Parte do nome da origem (ex.: instagram, google, indicação)' },
            sem_contato_dias_min: { type: ['integer', 'null'], description: 'Sem mensagem de ninguém há pelo menos N dias' },
            contato_dias_max: { type: ['integer', 'null'], description: 'Com alguma mensagem nos últimos N dias' },
            limite: { type: ['integer', 'null'], description: 'Quantos no máximo (padrão 40, até 200)' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'buscar_documentos',
        description:
          'Procura nos materiais da empresa: documentos (Empresa › Documentos: nome e descrição; o conteúdo dos arquivos não é lido), treinamento da IA, produtos e serviços (com preço), scripts de venda e respostas rápidas. Use antes de responder sobre regras, preços, políticas e textos prontos.',
        input_schema: {
          type: 'object',
          properties: {
            busca: { type: 'string', description: 'Palavra ou assunto' },
            onde: { type: ['array', 'null'], items: { type: 'string', enum: ['documentos', 'treinamento', 'produtos', 'scripts', 'respostas'] }, description: 'Onde procurar (padrão: em todos)' },
          },
          required: ['busca'],
          additionalProperties: false,
        },
      },
      {
        name: 'ver_numeros',
        description: `Lê os números do CRM pelas mesmas telas do app, com as permissões desta pessoa. Relatórios:
- dashboard: o painel do dia/período (conversas, agendamentos, vendas, IA, equipe);
- dia_a_dia: relatório Dia a dia (leads, agendamentos, comparecimentos por dia; aceita "dia");
- vendas, horarios, funil, clientes, perdas: Análises (vendas, melhores horários, funil, origens/clientes, motivos de perda);
- comercial: metas, ranking da equipe; comissao: comissão por pessoa;
- nps: pesquisa de satisfação; atendimento: tempo de resposta, fila e conversas por atendente.
Período: hoje, ontem, 7d, 30d, mes ou personalizado (com de/ate). Responda com os números que vierem; nunca invente.`,
        input_schema: {
          type: 'object',
          properties: {
            relatorio: { type: 'string', enum: [...RELATORIOS] },
            periodo: { type: ['string', 'null'], enum: ['hoje', 'ontem', '7d', '30d', 'mes', 'personalizado', null] },
            de: { type: ['string', 'null'], description: 'AAAA-MM-DD (período personalizado)' },
            ate: { type: ['string', 'null'], description: 'AAAA-MM-DD (período personalizado)' },
            dia: { type: ['string', 'null'], description: 'AAAA-MM-DD (só no dia_a_dia)' },
            unidade: { type: ['string', 'null'], description: 'Id da unidade' },
          },
          required: ['relatorio'],
          additionalProperties: false,
        },
      },
      {
        name: 'ver_agenda',
        description: 'Agenda (horários marcados) de um ou mais dias, por unidade e profissional: a da Sintonia e a do sistema do salão (Trinks e outros), quando ligado.',
        input_schema: {
          type: 'object',
          properties: {
            de: { type: ['string', 'null'], description: 'AAAA-MM-DD (padrão: hoje)' },
            dias: { type: ['integer', 'null'], description: 'Quantos dias (1 a 14, padrão 1; semana = 7)' },
            unidade: { type: ['string', 'null'] },
            profissional: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'ver_equipe',
        description: 'Quem da equipe está disponível agora (presença), quantas conversas cada uma tem esperando resposta (quem está sobrecarregada) e, para a gestão, a distribuição/rodízio de leads.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'mostrar_numeros',
        description:
          'Mostra à pessoa um cartão de números no chat: um título e itens (rótulo + valor), como barras ou tabela. Use DEPOIS de ver_numeros (ou outra leitura), só com números que vieram delas. Opcional: "abrir" = a tela do app com o relatório completo.',
        input_schema: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Até 80 letras' },
            subtitulo: { type: ['string', 'null'], description: 'Ex.: período e unidade' },
            formato: { type: 'string', enum: ['barras', 'tabela', 'destaques'], description: 'barras = comparar itens; tabela = linhas com colunas; destaques = 2 a 6 números grandes' },
            itens: {
              type: 'array',
              description: 'Até 12 itens',
              items: {
                type: 'object',
                properties: { rotulo: { type: 'string' }, valor: { type: 'number' }, texto: { type: ['string', 'null'], description: 'Como mostrar o valor (ex.: "R$ 1.250,00", "42%")' }, extra: { type: ['string', 'null'] } },
                required: ['rotulo', 'valor'],
                additionalProperties: false,
              },
            },
            abrir: { type: ['string', 'null'], enum: [...NOMES_VISTAS, null] },
          },
          required: ['titulo', 'formato', 'itens'],
          additionalProperties: false,
        },
      },
      {
        name: 'mostrar_atalho',
        description: 'Mostra um botão para abrir uma tela do app (ou uma conversa). Use quando a pessoa quiser ir até lá, ou quando algo só dá para fazer pela tela.',
        input_schema: {
          type: 'object',
          properties: {
            vista: { type: ['string', 'null'], enum: [...NOMES_VISTAS, null] },
            conversa_id: { type: ['string', 'null'] },
            rotulo: { type: ['string', 'null'], description: 'Texto do botão (curto)' },
          },
          additionalProperties: false,
        },
      },
    );
    if (this.f.internet)
      f.push({
        name: 'pesquisar_internet',
        description:
          'Pesquisa na internet (busca e leitura de páginas) e devolve um resumo com as fontes. Use para o que não está no CRM: notícias, tendências, concorrência, dúvidas gerais, ler um link que a pessoa colou. NUNCA ponha na consulta nome, telefone, e-mail, CPF ou qualquer dado de cliente: pesquise só o assunto. Os dados pessoais são tirados antes de sair.',
        input_schema: {
          type: 'object',
          properties: { consulta: { type: 'string', description: 'O assunto a pesquisar, sem dados de clientes (ou o link a ler)' } },
          required: ['consulta'],
          additionalProperties: false,
        },
      });
    return f;
  }

  async executar(nome: string, entrada: unknown): Promise<ResultadoFerramenta> {
    try {
      switch (nome) {
        case 'buscar_mensagens':
          return await this.buscarMensagens(entrada);
        case 'buscar_leads':
          return await this.buscarLeads(entrada);
        case 'buscar_documentos':
          return await this.buscarDocumentos(entrada);
        case 'ver_numeros':
          return await this.verNumeros(entrada);
        case 'ver_agenda':
          return await this.verAgenda(entrada);
        case 'ver_equipe':
          return await this.verEquipe();
        case 'pesquisar_internet':
          return await this.pesquisar(entrada);
        case 'mostrar_numeros':
          return this.mostrarNumeros(entrada);
        case 'mostrar_atalho':
          return await this.mostrarAtalho(entrada);
        default:
          return { conteudo: `Ferramenta desconhecida: ${nome}.`, erro: true };
      }
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`).join('; ') : e instanceof Error ? e.message : String(e);
      return { conteudo: `Não deu: ${msg} Corrija e tente de novo (ou explique à pessoa).`, erro: true };
    }
  }

  private refDe(c: Conversa): string {
    const r = this.ref()?.({ conversaId: c.id, nome: nomeOuTelefone(c.nome, c.telefone), unidade: c.unidade });
    return r ? ` · ref ${r}` : '';
  }

  /** Lê uma rota da API como a pessoa; 403/404 viram texto para a IA explicar. */
  private async ler(url: string, oque: string): Promise<{ ok: true; corpo: unknown } | { ok: false; res: ResultadoFerramenta }> {
    const r = await this.f.chamar('GET', url);
    if (r.status >= 200 && r.status < 300) return { ok: true, corpo: r.corpo };
    const motivo = (r.corpo as { erro?: string; message?: string } | null)?.erro ?? (r.corpo as { message?: string } | null)?.message ?? '';
    if (r.status === 401 || r.status === 403) return { ok: false, res: { conteudo: `Esta pessoa não tem acesso a ${oque}${motivo ? ` (${motivo})` : ''}. Diga isso com gentileza e sugira falar com a gestão.`, erro: true } };
    if (r.status === 404 || r.status === 501) return { ok: false, res: { conteudo: `${oque} não está ligado neste sistema${motivo ? ` (${motivo})` : ''}. Diga isso à pessoa.`, erro: true } };
    return { ok: false, res: { conteudo: `Não deu para ler ${oque} agora (${r.status}${motivo ? `: ${motivo}` : ''}).`, erro: true } };
  }

  // ---------------------------------------------------------------- mensagens

  private async buscarMensagens(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z
      .object({
        texto: z.string().trim().min(2, 'escreva o que procurar (2 letras ou mais)').max(100),
        cliente: z.string().trim().max(80).nullish(),
        desde: Data.nullish(),
        ate: Data.nullish(),
        unidade: z.string().trim().max(60).nullish(),
        quem: z.enum(['cliente', 'equipe', 'ia']).nullish(),
        limite: z.number().int().min(1).max(50).nullish(),
      })
      .parse(entrada);
    const visiveis = await this.f.conversas();
    const porId = new Map(visiveis.map((c) => [c.id, c]));
    let ids: string[] | undefined;
    if (b.cliente) {
      const t = sem(b.cliente);
      const dig = b.cliente.replace(/\D/g, '');
      ids = visiveis.filter((c) => sem(c.nome ?? '').includes(t) || (dig.length >= 4 && c.telefone.includes(dig))).map((c) => c.id);
      if (!ids.length) return { conteudo: `Nenhuma cliente com "${b.cliente}" entre as conversas que esta pessoa pode ver.` };
    }
    const limite = b.limite ?? 20;
    const achadas = (
      await this.f.buscarMensagens!({
        texto: b.texto,
        desde: b.desde ? deDataEHora(b.desde, '00:00') : undefined,
        ate: b.ate ? new Date(deDataEHora(b.ate, '00:00').getTime() + DIA) : undefined,
        unidade: b.unidade ?? undefined,
        autores: b.quem ? [b.quem] : undefined,
        conversaIds: ids,
        limite: limite * 3,
      })
    )
      .filter((m) => porId.has(m.conversaId))
      .slice(0, limite);
    const itens = achadas.map((m) => {
      const c = porId.get(m.conversaId)!;
      return { conversaId: c.id, nome: nomeOuTelefone(c.nome, c.telefone), unidade: unidadeDe(c.unidade).nome, em: m.em.toISOString(), quando: hm(m.em), autor: m.autor, autorNome: m.autorNome ?? null, trecho: trecho(m.texto, b.texto), _c: c };
    });
    this.guardar({
      tipo: 'mensagens',
      acao: 'criar',
      titulo: `“${b.texto}” nas mensagens`,
      dados: { busca: b.texto, total: itens.length, itens: itens.map(({ _c, ...x }) => x) },
    });
    if (!itens.length) return { conteudo: `Nenhuma mensagem com "${b.texto}" nas conversas que esta pessoa pode ver${b.desde || b.ate ? ' nesse período' : ''}. (O cartão mostra que não achou.)` };
    const QUEM = { cliente: 'cliente', equipe: 'equipe', ia: 'IA', sistema: 'nota' } as const;
    const l = [`<mensagens total="${itens.length}" observacao="o cartão com os trechos e o botão de abrir a conversa já aparece para a pessoa: não repita todos os trechos, resuma">`];
    for (const i of itens) l.push(`- ${i.nome} · ${i.unidade} · ${i.quando} · ${QUEM[i.autor]}${i.autorNome ? ` (${i.autorNome})` : ''}: "${i.trecho}"${this.refDe(i._c)}`);
    l.push('</mensagens>');
    return { conteudo: l.join('\n') };
  }

  // ---------------------------------------------------------------- clientes / leads

  private async buscarLeads(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z
      .object({
        busca: z.string().trim().max(100).nullish(),
        etiqueta: z.string().trim().max(80).nullish(),
        etapa_atendimento: z.enum(ETAPAS).nullish(),
        unidade: z.string().trim().max(60).nullish(),
        origem: z.string().trim().max(60).nullish(),
        sem_contato_dias_min: z.number().int().min(0).max(3650).nullish(),
        contato_dias_max: z.number().int().min(0).max(3650).nullish(),
        limite: z.number().int().min(1).max(200).nullish(),
      })
      .parse(entrada ?? {});
    let tagId: string | undefined;
    let tagNome = '';
    if (b.etiqueta) {
      const t = await this.ler('/api/tags', 'as etiquetas');
      if (!t.ok) return t.res;
      const lista = (Array.isArray(t.corpo) ? t.corpo : ((t.corpo as { tags?: unknown[] })?.tags ?? [])) as Array<{ id: string; nome: string }>;
      const alvo = sem(b.etiqueta);
      const tag = lista.find((x) => sem(x.nome) === alvo) ?? lista.find((x) => sem(x.nome).includes(alvo));
      if (!tag) return { conteudo: `Não existe etiqueta nem etapa "${b.etiqueta}". Etiquetas: ${lista.slice(0, 40).map((x) => x.nome).join(', ') || '(nenhuma)'}.`, erro: true };
      tagId = tag.id;
      tagNome = tag.nome;
    }
    const r = await this.ler(`/api/conversas${q({ q: b.busca && b.busca.length >= 2 ? b.busca : undefined, tag: tagId, limite: 500 })}`, 'as conversas');
    if (!r.ok) return r.res;
    type Linha = Conversa & { tags?: Array<{ nome: string }>; origem?: { rotulo?: string; canal?: string; icone?: string; campanha?: string } };
    const agora = this.f.agora().getTime();
    const ultima = (c: Linha) => Math.max(new Date(c.ultimaMensagemCliente ?? 0).getTime(), new Date(c.ultimaMensagemEquipe ?? 0).getTime(), new Date(c.ultimaMensagemIa ?? 0).getTime()) || new Date(c.atualizadaEm).getTime();
    const origemTxt = (c: Linha) => [c.origem?.rotulo, c.origem?.canal, c.origem?.campanha].filter(Boolean).join(' · ');
    const lista = ((r.corpo as Linha[]) ?? []).filter((c) => {
      const dias = (agora - ultima(c)) / DIA;
      if (b.etapa_atendimento && c.etapa !== b.etapa_atendimento) return false;
      if (b.unidade && c.unidade !== b.unidade) return false;
      if (b.origem && !sem(origemTxt(c)).includes(sem(b.origem))) return false;
      if (b.sem_contato_dias_min != null && dias < b.sem_contato_dias_min) return false;
      if (b.contato_dias_max != null && dias > b.contato_dias_max) return false;
      return true;
    });
    const limite = b.limite ?? 40;
    const l = [`<clientes total="${lista.length}"${lista.length > limite ? ` mostrando="${limite}"` : ''}${tagNome ? ` etiqueta="${tagNome}"` : ''}>`];
    for (const c of lista.slice(0, limite)) {
      const dias = Math.floor((agora - ultima(c)) / DIA);
      const cc = { ...c, atualizadaEm: new Date(c.atualizadaEm) } as Conversa;
      l.push(
        `- ${nomeOuTelefone(c.nome, c.telefone)} · conversa_id ${c.id} · ${unidadeDe(c.unidade).nome} · atendimento: ${NOME_ETAPA[c.etapa] ?? c.etapa}${c.tags?.length ? ` · etiquetas: ${c.tags.map((t) => t.nome).join(', ')}` : ''}${origemTxt(c) ? ` · origem: ${origemTxt(c)}` : ''} · último contato há ${dias} dia(s)${c.responsavelNome ? ` · dona: ${c.responsavelNome}` : ''}${this.refDe(cc)}`,
      );
    }
    if (!lista.length) l.push('(ninguém com esse filtro entre as conversas que esta pessoa pode ver)');
    l.push('</clientes>');
    return { conteudo: l.join('\n') };
  }

  // ---------------------------------------------------------------- documentos

  private async buscarDocumentos(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ busca: z.string().trim().min(1).max(100), onde: z.array(z.enum(['documentos', 'treinamento', 'produtos', 'scripts', 'respostas'])).nullish() }).parse(entrada);
    const onde = new Set(b.onde?.length ? b.onde : ['documentos', 'treinamento', 'produtos', 'scripts', 'respostas']);
    const termos = sem(b.busca).split(/\s+/).filter((t) => t.length >= 2);
    const bate = (...partes: Array<string | null | undefined>) => {
      const t = sem(partes.filter(Boolean).join(' '));
      return termos.length ? termos.some((x) => t.includes(x)) : true;
    };
    const blocos: string[] = [];
    const tentar = async (url: string, oque: string, montar: (corpo: unknown) => string[]) => {
      const r = await this.f.chamar('GET', url).catch(() => ({ status: 500, corpo: null }));
      if (r.status === 403) blocos.push(`<${oque}>(esta pessoa não tem acesso)</${oque}>`);
      else if (r.status >= 200 && r.status < 300) {
        const l = montar(r.corpo);
        blocos.push(`<${oque}>\n${l.length ? l.slice(0, 15).join('\n') : '(nada com isso)'}\n</${oque}>`);
      }
    };
    if (onde.has('documentos'))
      await tentar('/api/documentos', 'documentos', (c) =>
        (((c as { documentos?: unknown[] })?.documentos ?? []) as Array<{ id: string; nome: string; categoria: string; descricao: string }>)
          .filter((d) => bate(d.nome, d.categoria, d.descricao))
          .map((d) => `- "${d.nome}" (${d.categoria})${d.descricao ? `: ${d.descricao.slice(0, 200)}` : ''} — abrir em Empresa › Documentos`),
      );
    if (onde.has('treinamento')) {
      const partes = (texto: string) =>
        texto
          .split(/\n\s*\n/)
          .filter((p) => bate(p))
          .map((p) => `- ${p.replace(/\s+/g, ' ').slice(0, 500)}`);
      if (this.f.treinamento) {
        const l = partes(await this.f.treinamento().catch(() => ''));
        blocos.push(`<treinamento fonte="Agente de IA › Treinamento">\n${l.length ? l.slice(0, 15).join('\n') : '(nada com isso)'}\n</treinamento>`);
      } else await tentar('/api/ia/base/texto', 'treinamento', (c) => partes(String((c as { texto?: string })?.texto ?? '')));
    }
    if (onde.has('produtos'))
      await tentar('/api/produtos', 'produtos', (c) =>
        (((c as { produtos?: unknown[] })?.produtos ?? (Array.isArray(c) ? c : [])) as Array<{ nome: string; categoria?: string | null; preco?: number | null; duracaoMin?: number | null; descricao?: string }>)
          .filter((p) => bate(p.nome, p.categoria, p.descricao))
          .map((p) => `- ${p.nome}${p.categoria ? ` · ${p.categoria}` : ''} · ${p.preco == null ? 'preço sob consulta (não diga valor)' : `R$ ${Number(p.preco).toFixed(2).replace('.', ',')}`}${p.duracaoMin ? ` · ${p.duracaoMin} min` : ''} (fonte: cadastro de Produtos e serviços)`),
      );
    if (onde.has('scripts'))
      await tentar('/api/scripts', 'scripts', (c) =>
        (((c as { scripts?: unknown[] })?.scripts ?? []) as Array<{ titulo: string; etapa?: string; texto: string }>)
          .filter((s) => bate(s.titulo, s.etapa, s.texto))
          .map((s) => `- "${s.titulo}"${s.etapa ? ` · etapa ${s.etapa}` : ''}: ${s.texto.replace(/\s+/g, ' ').slice(0, 300)}`),
      );
    if (onde.has('respostas'))
      await tentar('/api/respostas-rapidas', 'respostas_rapidas', (c) =>
        ((Array.isArray(c) ? c : []) as Array<{ atalho: string; texto: string }>).filter((x) => bate(x.atalho, x.texto)).map((x) => `- /${x.atalho}: ${x.texto.replace(/\s+/g, ' ').slice(0, 300)}`),
      );
    if (!blocos.length) return { conteudo: 'Nada para ler agora (os materiais não estão ligados).', erro: true };
    return { conteudo: `Busca: "${b.busca}". Diga de onde veio cada informação.\n${blocos.join('\n')}` };
  }

  // ---------------------------------------------------------------- números

  private async verNumeros(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z
      .object({ relatorio: z.enum(RELATORIOS), periodo: Periodo.nullish(), de: Data.nullish(), ate: Data.nullish(), dia: Data.nullish(), unidade: z.string().trim().max(60).nullish() })
      .parse(entrada);
    const per = b.periodo ?? (b.de || b.ate ? 'personalizado' : null);
    const pers = { de: per === 'personalizado' ? (b.de ?? undefined) : undefined, ate: per === 'personalizado' ? (b.ate ?? undefined) : undefined };
    const u = b.unidade ?? undefined;
    const hojeIso = dataISO(this.f.agora());
    const inicioMes = `${hojeIso.slice(0, 8)}01`;
    // Cada tela tem os períodos dela: aproxima o que a pessoa pediu.
    const rel = b.relatorio;
    let url: string;
    let nome: string;
    switch (rel) {
      case 'dashboard': {
        const p = per === 'ontem' || per === '7d' || per === '30d' ? per : per === 'mes' ? '30d' : 'hoje';
        url = `/api/painel/completo${q({ periodo: p })}`;
        nome = 'o Dashboard';
        break;
      }
      case 'dia_a_dia':
        url = `/api/relatorio-dia${q({ dia: b.dia ?? undefined, unidade: u, dias: per === '30d' || per === 'mes' ? 30 : undefined })}`;
        nome = 'o relatório Dia a dia';
        break;
      case 'comercial':
        url = `/api/comercial/resumo${q({ periodo: per === 'hoje' || per === 'ontem' ? 'dia' : per === '7d' ? 'semana' : 'mes' })}`;
        nome = 'o Comercial (metas e ranking)';
        break;
      case 'comissao':
        url = `/api/comercial/comissao${q(per === 'personalizado' ? pers : per === 'mes' || !per ? { de: inicioMes } : {})}`;
        nome = 'a comissão';
        break;
      case 'nps':
        url = `/api/nps/resumo${q({ periodo: per === 'mes' ? '30d' : per === 'ontem' ? '7d' : (per ?? '30d'), ...pers, unidade: u })}`;
        nome = 'a pesquisa de satisfação (NPS)';
        break;
      case 'atendimento':
        url = `/api/desempenho${q({ periodo: per === 'mes' ? '30d' : (per ?? 'hoje'), ...pers, unidade: u })}`;
        nome = 'o Atendimento (tempo de resposta e fila)';
        break;
      default: {
        const p = per === 'ontem' ? '7d' : per === 'mes' ? '30d' : (per ?? '30d');
        url = `/api/analises/${rel}${q({ periodo: p, ...pers, unidade: u })}`;
        nome = `a análise de ${{ vendas: 'vendas', horarios: 'horários', funil: 'funil', clientes: 'clientes e origens', perdas: 'perdas' }[rel]}`;
      }
    }
    const r = await this.ler(url, nome);
    if (!r.ok) return r.res;
    return { conteudo: `Fonte: ${nome} (tela ${VISTAS[VISTA_DO_RELATORIO[rel]]}; use abrir="${VISTA_DO_RELATORIO[rel]}" no cartão). Dados: ${json(r.corpo)}` };
  }

  private async verAgenda(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ de: Data.nullish(), dias: z.number().int().min(1).max(14).nullish(), unidade: z.string().trim().max(60).nullish(), profissional: z.string().trim().max(80).nullish() }).parse(entrada ?? {});
    const r = await this.ler(`/api/agenda/agendamentos${q({ de: b.de ?? undefined, dias: b.dias ?? 1, unidade: b.unidade ?? undefined, profissional: b.profissional ?? undefined })}`, 'a agenda');
    if (!r.ok) return r.res;
    return { conteudo: `Fonte: tela Agenda. Dados: ${json(r.corpo, 11000)}` };
  }

  private async verEquipe(): Promise<ResultadoFerramenta> {
    const [presenca, pessoas, fila, rodizio] = await Promise.all([
      this.f.chamar('GET', '/api/presenca').catch(() => ({ status: 500, corpo: null })),
      this.f.chamar('GET', '/api/equipe').catch(() => ({ status: 500, corpo: null })),
      this.f.chamar('GET', '/api/desempenho/fila').catch(() => ({ status: 500, corpo: null })),
      this.f.chamar('GET', '/api/rodizio').catch(() => ({ status: 500, corpo: null })),
    ]);
    const nomes = new Map<string, string>();
    if (pessoas.status === 200) for (const p of ((pessoas.corpo as { pessoas?: Array<{ id: string; nome: string }> })?.pessoas ?? [])) nomes.set(p.id, p.nome);
    else {
      const c = await this.f.chamar('GET', '/api/equipe/chat/pessoas').catch(() => ({ status: 500, corpo: null }));
      if (c.status === 200) for (const p of ((c.corpo as { pessoas?: Array<{ id: string; nome: string }> })?.pessoas ?? [])) nomes.set(p.id, p.nome);
    }
    const STATUS: Record<string, string> = { online: 'disponível', ausente: 'ausente', ocupado: 'ocupada', offline: 'indisponível' };
    const l: string[] = [];
    if (presenca.status === 200) {
      const s = (presenca.corpo as { status?: Record<string, string> })?.status ?? {};
      l.push('<presenca>', ...Object.entries(s).map(([id, st]) => `- ${nomes.get(id) ?? 'Pessoa da equipe'}: ${STATUS[st] ?? st}`), '</presenca>');
    }
    if (fila.status === 200) l.push(`<fila_por_atendente observacao="conversas esperando resposta, por pessoa">${json((fila.corpo as { fila?: unknown })?.fila ?? fila.corpo, 5000)}</fila_por_atendente>`);
    else if (fila.status === 403) l.push('<fila_por_atendente>(esta pessoa não vê a fila da equipe)</fila_por_atendente>');
    if (rodizio.status === 200) l.push(`<distribuicao_de_leads>${json(rodizio.corpo, 4000)}</distribuicao_de_leads>`);
    else if (rodizio.status === 403) l.push('<distribuicao_de_leads>(só a gestão vê)</distribuicao_de_leads>');
    return l.length ? { conteudo: l.join('\n') } : { conteudo: 'Não deu para ler a equipe agora.', erro: true };
  }

  // ---------------------------------------------------------------- internet

  private async pesquisar(entrada: unknown): Promise<ResultadoFerramenta> {
    const { consulta } = z.object({ consulta: z.string().trim().min(2).max(400) }).parse(entrada);
    if (!this.f.internet) return { conteudo: 'A pesquisa na internet não está ligada aqui.', erro: true };
    if (this.pesquisas >= MAX_PESQUISAS) return { conteudo: `Já foram ${MAX_PESQUISAS} pesquisas nesta mensagem (limite). Responda com o que já achou.`, erro: true };
    this.pesquisas++;
    const r = await this.f.internet(consulta);
    for (const fonte of r.fontes) if (!this.fontesWeb.some((x) => x.url === fonte.url)) this.fontesWeb.push(fonte);
    return {
      conteudo: [
        `Pesquisa feita: "${r.consulta}"${r.limpou ? ' (dados pessoais tirados da consulta)' : ''}.`,
        `<resultado>\n${r.texto.slice(0, 6000)}\n</resultado>`,
        r.fontes.length ? `<fontes observacao="a tela já mostra os links embaixo da sua resposta">\n${r.fontes.map((x, i) => `${i + 1}. ${x.titulo} — ${x.url}`).join('\n')}\n</fontes>` : '(sem fontes)',
        'Diga que veio da internet e que pode estar desatualizado quando fizer sentido.',
      ].join('\n'),
    };
  }

  // ---------------------------------------------------------------- cartões só de mostrar

  private mostrarNumeros(entrada: unknown): ResultadoFerramenta {
    const b = z
      .object({
        titulo: z.string().trim().min(1).max(80),
        subtitulo: z.string().trim().max(120).nullish(),
        formato: z.enum(['barras', 'tabela', 'destaques']),
        itens: z.array(z.object({ rotulo: z.string().trim().min(1).max(60), valor: z.number().finite(), texto: z.string().trim().max(40).nullish(), extra: z.string().trim().max(80).nullish() })).min(1).max(12),
        abrir: z.enum(NOMES_VISTAS as [Vista, ...Vista[]]).nullish(),
      })
      .parse(entrada);
    this.guardar({
      tipo: 'numeros',
      acao: 'criar',
      alvoId: b.titulo,
      titulo: b.titulo,
      dados: { subtitulo: b.subtitulo ?? null, formato: b.formato, itens: b.itens.map((i) => ({ rotulo: i.rotulo, valor: i.valor, texto: i.texto ?? null, extra: i.extra ?? null })), abrir: b.abrir ?? null, abrirNome: b.abrir ? VISTAS[b.abrir] : null },
    });
    return { conteudo: 'Cartão de números mostrado à pessoa. Agora comente em uma ou duas frases o que chama atenção (sem repetir todos os números).' };
  }

  private async mostrarAtalho(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z.object({ vista: z.enum(NOMES_VISTAS as [Vista, ...Vista[]]).nullish(), conversa_id: z.string().trim().max(100).nullish(), rotulo: z.string().trim().max(40).nullish() }).parse(entrada ?? {});
    if (!b.vista && !b.conversa_id) return { conteudo: 'Diga a tela (vista) ou a conversa (conversa_id).', erro: true };
    let titulo = b.vista ? VISTAS[b.vista] : 'Conversa';
    if (b.conversa_id) {
      const c = (await this.f.conversas()).find((x) => x.id === b.conversa_id);
      if (!c) return { conteudo: 'Conversa não encontrada entre as que esta pessoa pode ver.', erro: true };
      titulo = nomeOuTelefone(c.nome, c.telefone);
    }
    this.guardar({ tipo: 'atalho', acao: 'criar', alvoId: b.conversa_id ?? b.vista ?? undefined, titulo, dados: { vista: b.vista ?? null, conversaId: b.conversa_id ?? null, rotulo: b.rotulo ?? (b.conversa_id ? 'Abrir conversa' : 'Abrir no CRM') } });
    return { conteudo: 'Botão mostrado à pessoa.' };
  }
}

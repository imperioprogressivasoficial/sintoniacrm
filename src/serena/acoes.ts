import { NOME_MOTIVO } from '../nps/tipos.js';
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AutomacaoNova, type Gatilho, type Passo } from '../automacoes/esquema.js';
import { DadosLink } from '../reunioes/reunioes.js';

/**
 * Serena faz coisas no CRM (tool use do Claude), sempre com prévia e confirmação:
 * - a IA conversa com a pessoa, monta a coisa e chama uma ferramenta "mostrar_…";
 * - a ferramenta só CONFERE e devolve um "artefato" (cartão rico no chat: título, passos, texto);
 * - nada é gravado aqui: a pessoa clica em "Salvar" no cartão e o app chama a rota de sempre
 *   (/api/scripts, /api/automacoes, /api/reunioes/links, /api/tags), com as permissões de sempre.
 * Ferramentas de leitura (consultar_crm, ler_script) dão à IA os nomes e ids de funis, etapas,
 * etiquetas, scripts e links, para ela não inventar.
 */

export type TipoArtefato = 'script' | 'automacao' | 'link' | 'etiqueta';

/** Um passo do fluxo já com nomes (para a prévia em cartões ligados). */
export interface NoFluxo {
  tipo: string;
  titulo: string;
  detalhe?: string;
  /** Só em "condicao": os dois caminhos. */
  entao?: NoFluxo[];
  senao?: NoFluxo[];
}

export interface Artefato {
  id: string;
  tipo: TipoArtefato;
  acao: 'criar' | 'editar';
  /** Ao editar: id do que já existe. */
  alvoId?: string;
  titulo: string;
  /** Corpo pronto para a rota de salvar. */
  dados: Record<string, unknown>;
  /** Automação: gatilho e passos com nomes. */
  fluxo?: { gatilho: NoFluxo; passos: NoFluxo[] };
}

export interface FontesSerena {
  scripts?: () => Promise<Array<{ id: string; titulo: string; etapa: string; texto: string }>>;
  links?: () => Promise<Array<{ id: string; titulo: string; slug: string; duracao_min: number; ativo: boolean }>>;
  funis?: () => Promise<Array<{ id: string; nome: string; etapas: Array<{ id: string; nome: string }> }>>;
  /** Todas as etiquetas (soltas e etapas de funil). */
  tags?: () => Promise<Array<{ id: string; nome: string; funilId: string | null; chaveSistema?: string | null }>>;
  /** Confere etapas/tags/pessoas da automação no servidor (Automacoes.conferir). */
  conferirAutomacao?: (dados: unknown) => Promise<unknown>;
}

/** O que esta pessoa pode criar (as rotas de salvar conferem de novo). */
export interface PodeSerena {
  automacoes: boolean;
  etiquetas: boolean;
}

type Ferramenta = Anthropic.Beta.Messages.BetaTool;
export interface ResultadoFerramenta {
  conteudo: string;
  erro?: boolean;
}

const PREVIA_OK = 'Prévia mostrada à pessoa num cartão com os botões Salvar, Ajustar e Abrir no app. NADA foi salvo ainda: só a pessoa salva, clicando em Salvar. Agora, em uma ou duas frases, diga o que montou e pergunte se ela quer salvar ou ajustar alguma coisa. Não repita o conteúdo inteiro no texto.';

/** Passos que a Serena pode montar (os outros pedem ids que ela não tem: transmissão, e-mail, pessoa). */
const PASSOS_PERMITIDOS = ['enviar_mensagem', 'esperar', 'mudar_modo', 'fluxo_ia', 'mover_etapa', 'marcar_tag', 'desmarcar_tag', 'lembrete_ligacao', 'condicao'];

const MODO = { ia: 'a IA', copiloto: 'o copiloto (IA sugere, equipe envia)', humano: 'a equipe' } as const;

const tempo = (min: number) => {
  if (min % 1440 === 0) return `${min / 1440} dia${min === 1440 ? '' : 's'}`;
  if (min % 60 === 0) return `${min / 60} hora${min === 60 ? '' : 's'}`;
  return `${min} minuto${min === 1 ? '' : 's'}`;
};

const ScriptPedido = z.object({
  id: z.string().uuid().optional(),
  titulo: z.string().trim().min(2, 'Dê um título ao script.').max(100),
  etapa: z.string().trim().max(60).default(''),
  texto: z.string().trim().min(1, 'Escreva o script.').max(6000),
});
const EtiquetaPedido = z.object({ nome: z.string().trim().min(1, 'Dê um nome à etiqueta.').max(60), cor: z.string().max(10).optional() });

export class AcoesSerena {
  readonly artefatos: Artefato[] = [];

  constructor(
    private readonly fontes: FontesSerena,
    private readonly pode: PodeSerena,
  ) {}

  /** Linha do contexto que diz à IA o que ela pode fazer por esta pessoa. */
  regras(): string {
    const pode: string[] = [];
    if (this.fontes.scripts) pode.push('scripts de venda (criar e editar)');
    if (this.pode.automacoes && this.fontes.funis) pode.push('fluxos de automação');
    if (this.fontes.links) pode.push('links de agendamento online');
    if (this.pode.etiquetas && this.fontes.tags) pode.push('etiquetas');
    const nao: string[] = [];
    if (!this.pode.automacoes) nao.push('fluxos de automação');
    if (!this.pode.etiquetas) nao.push('etiquetas');
    return [
      `Você pode criar no CRM, para esta pessoa: ${pode.join(', ') || 'nada por enquanto'}.`,
      nao.length ? `Esta pessoa NÃO pode criar ${nao.join(' nem ')} (só a gestão). Se pedir, explique com gentileza e sugira falar com a gerência.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  ferramentas(): Ferramenta[] {
    const f: Ferramenta[] = [
      {
        name: 'consultar_crm',
        description:
          'Lê o que já existe no CRM desta empresa: funis com as etapas (com ids), etiquetas soltas (com ids), scripts de venda salvos (com ids) e links de agendamento. Use antes de montar um fluxo de automação (para usar ids reais de etapas e etiquetas) ou para editar um script que já existe.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
    if (this.fontes.scripts) {
      f.push(
        {
          name: 'ler_script',
          description: 'Lê o texto completo de um script de venda salvo (use o id que veio de consultar_crm), para editar.',
          input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        },
        {
          name: 'mostrar_script',
          description:
            'Mostra à pessoa a prévia de um script de venda (roteiro do que falar com o cliente numa etapa do funil). Não salva: a pessoa decide no cartão. Para editar um script que já existe, passe o id dele. Escreva o texto em português do Brasil, em blocos curtos (abertura, perguntas, apresentação, objeções, fechamento), com falas prontas e {nome} onde entra o nome do cliente.',
          input_schema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Só para editar um script que já existe.' },
              titulo: { type: 'string', description: 'Até 100 letras.' },
              etapa: { type: 'string', description: 'Etapa do funil em que o script é usado (ex.: Primeiro contato). Até 60 letras.' },
              texto: { type: 'string', description: 'O script completo, até 6000 letras.' },
            },
            required: ['titulo', 'texto'],
            additionalProperties: false,
          },
        },
      );
    }
    if (this.pode.automacoes && this.fontes.funis) {
      f.push({
        name: 'mostrar_automacao',
        description: `Mostra à pessoa a prévia de um fluxo de automação (gatilho → condições → ações), no formato do construtor de automações do app. Não salva: a pessoa decide no cartão (salva desligado; ela liga quando quiser). Use ids reais de consultar_crm.
Gatilhos (campo "gatilho"):
- {"tipo":"entrou_na_etapa","etapaId":"…"}
- {"tipo":"parada_na_etapa","etapaId":"…","horas":24}
- {"tipo":"nova_conversa"}
- {"tipo":"palavra_chave","palavras":["preço","valor"],"modo":"contem"} (modo "contem" ou "exata")
- {"tipo":"tag_marcada","tagId":"…"}
- {"tipo":"aniversario"}
- {"tipo":"dias_apos_compareceu","dias":30}
Passos (lista "passos", na ordem):
- {"tipo":"enviar_mensagem","texto":"Oi {primeiro_nome}! …","so_no_horario":true} (variáveis: {primeiro_nome} {nome} {unidade} {atendente})
- {"tipo":"esperar","minutos":60}
- {"tipo":"mudar_modo","modo":"ia"} (ia, copiloto ou humano)
- {"tipo":"fluxo_ia","objetivo":"Convencer a cliente a marcar a avaliação","dias":7}
- {"tipo":"mover_etapa","funilId":"…","etapaId":"…"}
- {"tipo":"marcar_tag","tagId":"…"} / {"tipo":"desmarcar_tag","tagId":"…"}
- {"tipo":"lembrete_ligacao","em_minutos":1440,"texto":"Ligar para confirmar"}
- {"tipo":"condicao","se":"cliente_respondeu","entao":[…],"senao":[…]} (se: cliente_respondeu, tem_tag com "valor":"<tagId>", modo com "valor":"ia|copiloto|humano", horario_loja)
Máximo de 40 passos no total. Mensagens curtas, no jeito de WhatsApp.`,
        input_schema: {
          type: 'object',
          properties: {
            nome: { type: 'string', description: 'Nome curto do fluxo (até 80 letras).' },
            gatilho: { type: 'object', description: 'O que dispara o fluxo.' },
            passos: { type: 'array', items: { type: 'object' }, description: 'Os passos, na ordem.' },
            parar_se_equipe_responder: { type: 'boolean', description: 'Se alguém da equipe responder, o fluxo para (padrão: sim).' },
          },
          required: ['nome', 'gatilho', 'passos'],
          additionalProperties: false,
        },
      });
    }
    if (this.fontes.links) {
      f.push({
        name: 'mostrar_link_agendamento',
        description:
          'Mostra à pessoa a prévia de um link de agendamento online (o contato abre o link e escolhe um horário livre). Não salva: a pessoa decide no cartão. Dias: 0 = domingo … 6 = sábado. Horários no formato 09:00 (horário de Brasília/Bahia).',
        input_schema: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Ex.: Reunião de 30 minutos. Até 80 letras.' },
            descricao: { type: 'string', description: 'O que o contato lê na página (até 600 letras).' },
            duracao_min: { type: 'integer', description: 'De 10 a 240.' },
            dias: { type: 'array', items: { type: 'integer' }, description: 'Dias da semana livres (0 a 6).' },
            inicio: { type: 'string', description: 'Primeiro horário, ex.: 09:00.' },
            fim: { type: 'string', description: 'Fim do expediente, ex.: 18:00.' },
            antecedencia_h: { type: 'integer', description: 'Horas mínimas de antecedência (padrão 2).' },
            janela_dias: { type: 'integer', description: 'Até quantos dias à frente dá para marcar (padrão 21).' },
            local: { type: 'string', description: 'Link do Meet, endereço ou "ligação".' },
          },
          required: ['titulo', 'duracao_min', 'dias', 'inicio', 'fim'],
          additionalProperties: false,
        },
      });
    }
    if (this.pode.etiquetas && this.fontes.tags) {
      f.push({
        name: 'mostrar_etiqueta',
        description: 'Mostra à pessoa a prévia de uma etiqueta nova (tag para marcar conversas). Não salva: a pessoa decide no cartão. Confira antes em consultar_crm se já não existe uma igual.',
        input_schema: {
          type: 'object',
          properties: { nome: { type: 'string', description: 'Até 60 letras.' }, cor: { type: 'string', description: 'Cor em hexadecimal, ex.: #106ebe (opcional).' } },
          required: ['nome'],
          additionalProperties: false,
        },
      });
    }
    return f;
  }

  /** Executa uma ferramenta. Erro de conferência volta para a IA corrigir (is_error). */
  async executar(nome: string, entrada: unknown): Promise<ResultadoFerramenta> {
    try {
      switch (nome) {
        case 'consultar_crm':
          return { conteudo: await this.consultar() };
        case 'ler_script':
          return await this.lerScript(entrada);
        case 'mostrar_script':
          return await this.mostrarScript(entrada);
        case 'mostrar_automacao':
          return await this.mostrarAutomacao(entrada);
        case 'mostrar_link_agendamento':
          return this.mostrarLink(entrada);
        case 'mostrar_etiqueta':
          return await this.mostrarEtiqueta(entrada);
        default:
          return { conteudo: `Ferramenta desconhecida: ${nome}.`, erro: true };
      }
    } catch (e) {
      return { conteudo: `Não deu para montar: ${mensagemDe(e)} Corrija e chame a ferramenta de novo.`, erro: true };
    }
  }

  private guardar(a: Omit<Artefato, 'id'>): Artefato {
    // Na mesma resposta, uma prévia nova do mesmo tipo substitui a anterior.
    const i = this.artefatos.findIndex((x) => x.tipo === a.tipo && x.alvoId === a.alvoId);
    const novo = { id: randomUUID().slice(0, 8), ...a };
    if (i >= 0) this.artefatos.splice(i, 1, novo);
    else this.artefatos.push(novo);
    return novo;
  }

  private async consultar(): Promise<string> {
    const [funis, tags, scripts, links] = await Promise.all([
      this.fontes.funis?.().catch(() => []) ?? [],
      this.fontes.tags?.().catch(() => []) ?? [],
      this.fontes.scripts?.().catch(() => []) ?? [],
      this.fontes.links?.().catch(() => []) ?? [],
    ]);
    const l: string[] = ['<funis>'];
    for (const f of funis.slice(0, 20)) {
      l.push(`- Funil "${f.nome}" (funilId ${f.id})`);
      for (const e of f.etapas.slice(0, 30)) l.push(`  - etapa "${e.nome}" (etapaId ${e.id})`);
    }
    if (!funis.length) l.push('(nenhum)');
    l.push('</funis>', '<etiquetas_soltas>');
    const soltas = tags.filter((t) => !t.funilId);
    for (const t of soltas.slice(0, 80)) l.push(`- "${t.nome}" (tagId ${t.id})`);
    if (!soltas.length) l.push('(nenhuma)');
    l.push('</etiquetas_soltas>', '<scripts_de_venda>');
    for (const s of scripts.slice(0, 50)) l.push(`- "${s.titulo}"${s.etapa ? ` · etapa ${s.etapa}` : ''} (id ${s.id}): ${s.texto.replace(/\s+/g, ' ').slice(0, 120)}…`);
    if (!scripts.length) l.push('(nenhum)');
    l.push('</scripts_de_venda>', '<links_de_agendamento>');
    for (const k of links.slice(0, 30)) l.push(`- "${k.titulo}" · ${k.duracao_min} min · ${k.ativo ? 'ativo' : 'pausado'}`);
    if (!links.length) l.push('(nenhum)');
    l.push('</links_de_agendamento>');
    return l.join('\n');
  }

  private async lerScript(entrada: unknown): Promise<ResultadoFerramenta> {
    const { id } = z.object({ id: z.string() }).parse(entrada);
    const s = (await this.fontes.scripts!()).find((x) => x.id === id);
    if (!s) return { conteudo: 'Script não encontrado. Confira o id em consultar_crm.', erro: true };
    return { conteudo: `Título: ${s.titulo}\nEtapa: ${s.etapa || '(sem etapa)'}\n<texto>\n${s.texto}\n</texto>` };
  }

  private async mostrarScript(entrada: unknown): Promise<ResultadoFerramenta> {
    const d = ScriptPedido.parse(entrada);
    if (d.id && !(await this.fontes.scripts!()).some((x) => x.id === d.id)) return { conteudo: 'Script não encontrado para editar. Confira o id em consultar_crm ou crie um novo (sem id).', erro: true };
    this.guardar({ tipo: 'script', acao: d.id ? 'editar' : 'criar', alvoId: d.id, titulo: d.titulo, dados: { titulo: d.titulo, etapa: d.etapa, texto: d.texto } });
    return { conteudo: PREVIA_OK };
  }

  private async mostrarAutomacao(entrada: unknown): Promise<ResultadoFerramenta> {
    const b = z
      .object({ nome: z.string(), gatilho: z.unknown(), passos: z.array(z.unknown()), parar_se_equipe_responder: z.boolean().optional() })
      .parse(entrada);
    const d = AutomacaoNova.parse({ nome: b.nome, gatilho: b.gatilho, passos: b.passos, ligada: false, opcoes: { parar_se_equipe_responder: b.parar_se_equipe_responder ?? true } });
    const proibidos = [...todosPassos(d.passos)].filter((p) => !PASSOS_PERMITIDOS.includes(p.tipo));
    if (proibidos.length) return { conteudo: `Pela conversa não dá para montar o passo "${proibidos[0]!.tipo}". Use só: ${PASSOS_PERMITIDOS.join(', ')}.`, erro: true };
    const [funis, tags] = await Promise.all([this.fontes.funis?.() ?? [], this.fontes.tags?.() ?? []]);
    // Fluxo de etapa fica no funil da etapa (como no construtor); os outros ficam gerais.
    const g = d.gatilho;
    const etapaDoGatilho = g.tipo === 'entrou_na_etapa' || g.tipo === 'parada_na_etapa' ? tags.find((t) => t.id === g.etapaId) : undefined;
    const dados = { ...d, funilId: etapaDoGatilho?.funilId ?? null, ligada: false };
    if (this.fontes.conferirAutomacao) await this.fontes.conferirAutomacao(dados);
    else conferirIds(dados.gatilho, dados.passos, tags);
    const nomes = new Map<string, string>([...tags.map((t) => [t.id, t.nome] as [string, string]), ...funis.map((f) => [f.id, f.nome] as [string, string])]);
    this.guardar({ tipo: 'automacao', acao: 'criar', titulo: d.nome, dados, fluxo: { gatilho: descreverGatilho(g, nomes), passos: descreverPassos(d.passos, nomes) } });
    return { conteudo: PREVIA_OK };
  }

  private mostrarLink(entrada: unknown): ResultadoFerramenta {
    const d = DadosLink.parse(entrada);
    const dias = [...new Set(d.dias)].sort();
    this.guardar({ tipo: 'link', acao: 'criar', titulo: d.titulo, dados: { ...d, dias } });
    return { conteudo: PREVIA_OK };
  }

  private async mostrarEtiqueta(entrada: unknown): Promise<ResultadoFerramenta> {
    const d = EtiquetaPedido.parse(entrada);
    const igual = (await this.fontes.tags!()).find((t) => t.nome.trim().toLowerCase() === d.nome.toLowerCase());
    if (igual) return { conteudo: `Já existe uma etiqueta "${igual.nome}". Avise a pessoa e não crie outra igual.`, erro: true };
    const cor = d.cor && /^#[0-9a-fA-F]{6}$/.test(d.cor) ? d.cor : undefined;
    this.guardar({ tipo: 'etiqueta', acao: 'criar', titulo: d.nome, dados: cor ? { nome: d.nome, cor } : { nome: d.nome } });
    return { conteudo: PREVIA_OK };
  }
}

function mensagemDe(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`).join('; ') + '.';
  return e instanceof Error ? e.message : String(e);
}

function* todosPassos(passos: Passo[]): Generator<Passo> {
  for (const p of passos) {
    yield p;
    if (p.tipo === 'condicao') {
      yield* todosPassos(p.entao);
      yield* todosPassos(p.senao);
    }
  }
}

/** Sem o serviço de automações (testes): confere ao menos se as etapas e etiquetas existem. */
function conferirIds(g: Gatilho, passos: Passo[], tags: Array<{ id: string; funilId: string | null }>): void {
  const tem = (id: string | undefined) => Boolean(id && tags.some((t) => t.id === id));
  if ((g.tipo === 'entrou_na_etapa' || g.tipo === 'parada_na_etapa') && !tem(g.etapaId)) throw new Error('Gatilho: etapa não encontrada.');
  if (g.tipo === 'tag_marcada' && !tem(g.tagId)) throw new Error('Gatilho: etiqueta não encontrada.');
  for (const p of todosPassos(passos)) {
    if ((p.tipo === 'mover_etapa' && !tags.some((t) => t.id === p.etapaId && t.funilId === p.funilId)) || ((p.tipo === 'marcar_tag' || p.tipo === 'desmarcar_tag') && !tem(p.tagId)))
      throw new Error(`Passo ${p.tipo}: etapa ou etiqueta não encontrada.`);
  }
}

export function descreverGatilho(g: Gatilho, nomes: Map<string, string>): NoFluxo {
  const n = (id: string) => `"${nomes.get(id) ?? 'etapa'}"`;
  switch (g.tipo) {
    case 'entrou_na_etapa':
      return { tipo: g.tipo, titulo: 'Entrou na etapa', detalhe: n(g.etapaId) };
    case 'parada_na_etapa':
      return { tipo: g.tipo, titulo: 'Parada na etapa', detalhe: `${n(g.etapaId)} há ${tempo(g.horas * 60)}` };
    case 'nova_conversa':
      return { tipo: g.tipo, titulo: 'Nova conversa', detalhe: 'Primeira mensagem de um contato' };
    case 'palavra_chave':
      return { tipo: g.tipo, titulo: g.modo === 'exata' ? 'Mensagem igual a' : 'Mensagem com a palavra', detalhe: g.palavras.map((p) => `"${p}"`).join(', ') };
    case 'tag_marcada':
      return { tipo: g.tipo, titulo: 'Etiqueta marcada', detalhe: n(g.tagId) };
    case 'aniversario':
      return { tipo: g.tipo, titulo: 'Aniversário do contato', detalhe: 'No dia, uma vez por ano' };
    case 'dias_apos_compareceu':
      return { tipo: g.tipo, titulo: 'Depois que compareceu', detalhe: `${g.dias} dia${g.dias === 1 ? '' : 's'} depois` };
    // nps-posvenda: gatilhos de finalizar atendimento e da nota da pesquisa de satisfação.
    case 'atendimento_finalizado':
      return { tipo: g.tipo, titulo: 'Atendimento finalizado', detalhe: g.motivos.length ? `Motivo: ${g.motivos.map((m) => NOME_MOTIVO[m]).join(', ')}` : 'Qualquer motivo' };
    case 'nota_nps':
      return { tipo: g.tipo, titulo: 'Nota da pesquisa', detalhe: g.min === g.max ? `Nota ${g.min}` : `Nota de ${g.min} a ${g.max}` };
  }
}

export function descreverPassos(passos: Passo[], nomes: Map<string, string>): NoFluxo[] {
  const n = (id: string) => `"${nomes.get(id) ?? '?'}"`;
  return passos.map((p): NoFluxo => {
    switch (p.tipo) {
      case 'enviar_mensagem':
        return { tipo: p.tipo, titulo: 'Enviar mensagem', detalhe: p.texto };
      case 'esperar':
        return { tipo: p.tipo, titulo: 'Esperar', detalhe: tempo(p.minutos) };
      case 'mudar_modo':
        return { tipo: p.tipo, titulo: 'Quem atende', detalhe: `Passa para ${MODO[p.modo]}` };
      case 'fluxo_ia':
        return { tipo: p.tipo, titulo: 'IA conduz', detalhe: `${p.objetivo} (por ${p.dias} dia${p.dias === 1 ? '' : 's'})` };
      case 'mover_etapa':
        return { tipo: p.tipo, titulo: 'Mover para a etapa', detalhe: `${n(p.etapaId)} do funil ${n(p.funilId)}` };
      case 'marcar_tag':
        return { tipo: p.tipo, titulo: 'Marcar etiqueta', detalhe: n(p.tagId) };
      case 'desmarcar_tag':
        return { tipo: p.tipo, titulo: 'Tirar etiqueta', detalhe: n(p.tagId) };
      case 'atribuir':
        return { tipo: p.tipo, titulo: 'Passar para alguém da equipe' };
      case 'lembrete_ligacao':
        return { tipo: p.tipo, titulo: 'Lembrete de ligação', detalhe: `${p.texto ?? 'Ligar para o contato'} · ${p.em_minutos ? `daqui a ${tempo(p.em_minutos)}` : 'na hora'}` };
      case 'enviar_transmissao':
        return { tipo: p.tipo, titulo: 'Entrar numa transmissão' };
      case 'enviar_email':
        return { tipo: p.tipo, titulo: 'Enviar e-mail' };
      case 'condicao': {
        const se =
          p.se === 'cliente_respondeu' ? 'O contato respondeu?' : p.se === 'tem_tag' ? `Tem a etiqueta ${n(p.valor ?? '')}?` : p.se === 'modo' ? `Quem atende é ${MODO[p.valor as keyof typeof MODO] ?? p.valor}?` : 'Está no horário da loja?';
        return { tipo: p.tipo, titulo: 'Condição', detalhe: se, entao: descreverPassos(p.entao, nomes), senao: descreverPassos(p.senao, nomes) };
      }
    }
  });
}

/** Scripts e links de agendamento direto do banco (tabelas de db/migrations/320_reunioes_scripts.sql). */
export function fontesDoBanco(pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> }, empresaId: string): Pick<FontesSerena, 'scripts' | 'links'> {
  return {
    scripts: async () => (await pool.query('select id, titulo, etapa, texto from sintonia.scripts_venda where empresa_id = $1 order by ordem, criado_em', [empresaId])).rows,
    links: async () => (await pool.query('select id, titulo, slug, duracao_min, ativo from sintonia.links_reuniao where empresa_id = $1 order by criado_em', [empresaId])).rows,
  };
}

/** Funis com as etapas, a partir da lista de etiquetas (etapa = etiqueta com funilId). */
export function funisComEtapas(funis: Array<{ id: string; nome: string }>, tags: Array<{ id: string; nome: string; funilId: string | null; ordem?: number }>) {
  return funis.map((f) => ({ id: f.id, nome: f.nome, etapas: tags.filter((t) => t.funilId === f.id).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((t) => ({ id: t.id, nome: t.nome })) }));
}

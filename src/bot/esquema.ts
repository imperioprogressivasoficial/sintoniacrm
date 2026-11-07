import { z } from 'zod';
import { normalizar } from '../automacoes/esquema.js';

/**
 * Fluxos de bot (estilo Salesbot): um GRAFO de blocos (nós) ligados por linhas (ligações).
 * Cada bloco tem saídas com nome ("proximo", "sim", "nao", o id de uma opção…); uma ligação vai de uma
 * saída de um bloco para a entrada de outro. O rascunho aceita blocos incompletos (a tela salva no meio
 * da edição); publicar confere tudo (ver `problemasDoGrafo`).
 */

export const UNIDADES_BOT = ['norte', 'sumare', 'feira'] as const;
export const MODOS_BOT = ['ia', 'copiloto', 'humano'] as const;
export const VALIDACOES = ['texto', 'numero', 'telefone', 'email', 'data'] as const;
export const LIMITE_NOS = 120;
export const LIMITE_LIGACOES = 300;

const id = z.string().trim().min(1).max(100);
const texto = (max: number) => z.string().max(max).default('');
const pos = { x: z.number().finite().default(0), y: z.number().finite().default(0) };
const base = { id, titulo: z.string().trim().max(60).optional(), ...pos };
/** Nome de variável: letras, números e _ (vira {nome_da_variavel} nas mensagens). */
const variavel = z
  .string()
  .trim()
  .max(40)
  .regex(/^[a-z_][a-z0-9_]*$/i, 'Use só letras, números e _ no nome da variável.')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const GatilhoBot = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('nova_conversa'), unidade: z.enum(UNIDADES_BOT).optional() }),
  z.object({ tipo: z.literal('palavra_chave'), palavras: z.array(z.string().trim().max(80)).max(30).default([]), modo: z.enum(['contem', 'exata']).default('contem') }),
  z.object({ tipo: z.literal('entrou_na_etapa'), etapaId: z.string().max(100).default('') }),
  z.object({ tipo: z.literal('tag_marcada'), tagId: z.string().max(100).default('') }),
  /** Só pelo botão "Iniciar bot" na conversa (ou pela API). */
  z.object({ tipo: z.literal('manual') }),
  /** Mensagem da cliente com a loja fechada (uma vez por período fechado). */
  z.object({ tipo: z.literal('fora_do_horario'), unidade: z.enum(UNIDADES_BOT).optional() }),
]);
export type GatilhoBot = z.infer<typeof GatilhoBot>;

export const Opcao = z.object({ id, texto: z.string().trim().max(80).default('') });
export type Opcao = z.infer<typeof Opcao>;

export const CondicaoBot = z.object({
  se: z.enum(['tag', 'etapa', 'campo', 'horario_loja', 'unidade', 'resposta_contem', 'modo']),
  /** tag/etapa: id; unidade: norte|sumare|feira; modo: ia|copiloto|humano; resposta_contem: palavras separadas por vírgula; campo: valor a comparar. */
  valor: z.string().max(300).default(''),
  /** Só para "campo": nome da variável ou campo da ficha (nome, email, nascimento, campo:<id>). */
  campo: z.string().max(100).optional(),
  operador: z.enum(['preenchido', 'igual', 'contem']).default('preenchido'),
});
export type CondicaoBot = z.infer<typeof CondicaoBot>;

/** Para onde vai a resposta da pergunta aberta: só a variável, ou também um campo da ficha. */
export const CampoFicha = z.union([z.enum(['nome', 'email', 'nascimento', 'observacoes']), z.string().regex(/^campo:.+$/)]);

export const SaidaAgente = z.discriminatedUnion('tipo', [
  /** Até a cliente agendar (a conversa chega em "Agendada"). */
  z.object({ tipo: z.literal('agendou') }),
  /** Até a IA mandar N mensagens. */
  z.object({ tipo: z.literal('mensagens'), n: z.number().int().min(1).max(50).default(5) }),
  /** Só pelo prazo. */
  z.object({ tipo: z.literal('prazo') }),
]);

export const No = z.discriminatedUnion('tipo', [
  z.object({ ...base, tipo: z.literal('inicio'), gatilho: GatilhoBot.default({ tipo: 'manual' }) }),
  z.object({
    ...base,
    tipo: z.literal('mensagem'),
    texto: texto(1000),
    /** Imagem/arquivo: URL pública ou um arquivo enviado (POST /api/bots/midias). */
    midiaUrl: z.string().max(1000).optional(),
    midiaId: z.string().max(100).optional(),
    so_no_horario: z.boolean().default(false),
  }),
  z.object({
    ...base,
    tipo: z.literal('pergunta'),
    texto: texto(1000),
    opcoes: z.array(Opcao).max(10).default([]),
    variavel,
    tentativas: z.number().int().min(0).max(5).default(2),
    mensagemInvalida: z.string().max(500).optional(),
    tempoLimiteMin: z.number().int().min(1).max(60 * 24 * 30).default(1440),
  }),
  z.object({
    ...base,
    tipo: z.literal('pergunta_aberta'),
    texto: texto(1000),
    validacao: z.enum(VALIDACOES).default('texto'),
    variavel,
    campo: CampoFicha.optional().or(z.literal('').transform(() => undefined)),
    tentativas: z.number().int().min(0).max(5).default(2),
    mensagemInvalida: z.string().max(500).optional(),
    tempoLimiteMin: z.number().int().min(1).max(60 * 24 * 30).default(1440),
  }),
  z.object({ ...base, tipo: z.literal('condicao'), condicao: CondicaoBot.default({ se: 'horario_loja', valor: '', operador: 'preenchido' }) }),
  z.object({ ...base, tipo: z.literal('esperar'), minutos: z.number().int().min(1).max(60 * 24 * 30).default(60) }),
  z.object({ ...base, tipo: z.literal('esperar_resposta'), minutos: z.number().int().min(1).max(60 * 24 * 30).default(60), variavel }),
  z.object({ ...base, tipo: z.literal('mover_etapa'), funilId: z.string().max(100).default(''), etapaId: z.string().max(100).default('') }),
  z.object({ ...base, tipo: z.literal('marcar_tag'), tagId: z.string().max(100).default('') }),
  z.object({ ...base, tipo: z.literal('desmarcar_tag'), tagId: z.string().max(100).default('') }),
  z.object({ ...base, tipo: z.literal('atribuir'), usuarioId: z.string().max(100).nullable().default(null), unidade: z.enum(UNIDADES_BOT).optional() }),
  z.object({ ...base, tipo: z.literal('mudar_modo'), modo: z.enum(MODOS_BOT).default('humano') }),
  z.object({ ...base, tipo: z.literal('lembrete'), em_minutos: z.number().int().min(0).max(6 * 24 * 60).default(0), texto: z.string().max(200).optional() }),
  z.object({ ...base, tipo: z.literal('webhook'), url: z.string().max(1000).default('') }),
  z.object({
    ...base,
    tipo: z.literal('agente_ia'),
    /** Agente do estúdio "Agentes de IA". Vazio = o agente padrão da Sintonia. */
    agenteIaId: z.string().max(100).optional(),
    objetivo: texto(1000),
    saida: SaidaAgente.default({ tipo: 'agendou' }),
    dias: z.number().int().min(1).max(30).default(3),
  }),
  z.object({ ...base, tipo: z.literal('transferir'), texto: z.string().max(1000).optional(), usuarioId: z.string().max(100).nullable().optional() }),
  z.object({ ...base, tipo: z.literal('fim') }),
]);
export type No = z.infer<typeof No>;
export type TipoNo = No['tipo'];

export const Ligacao = z.object({ id, de: id, saida: z.string().trim().min(1).max(100), para: id });
export type Ligacao = z.infer<typeof Ligacao>;

export const Grafo = z.object({
  nos: z.array(No).max(LIMITE_NOS).default([]),
  ligacoes: z.array(Ligacao).max(LIMITE_LIGACOES).default([]),
});
export type Grafo = z.infer<typeof Grafo>;

export const OpcoesBot = z
  .object({
    /** Se alguém da equipe responder, o bot para naquela conversa. */
    parar_se_equipe_responder: z.boolean().default(true),
  })
  .default({ parar_se_equipe_responder: true });
export type OpcoesBot = z.infer<typeof OpcoesBot>;

export const FluxoNovo = z.object({
  nome: z.string().trim().min(1).max(80),
  descricao: z.string().trim().max(300).optional(),
  /** Começar de um modelo pronto (GET /api/bots/modelos). */
  modelo: z.string().max(60).optional(),
  rascunho: Grafo.optional(),
  opcoes: OpcoesBot,
});

export const FluxoAlteracao = z
  .object({
    nome: z.string().trim().min(1).max(80).optional(),
    descricao: z.string().trim().max(300).nullable().optional(),
    rascunho: Grafo.optional(),
    opcoes: z.object({ parar_se_equipe_responder: z.boolean().optional() }).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para mudar.');

// ---------------------------------------------------------------- saídas de cada bloco

/** As saídas (com nome) de cada bloco, na ordem em que a tela mostra. */
export function saidasDe(no: No): Array<{ id: string; rotulo: string; opcional?: boolean }> {
  switch (no.tipo) {
    case 'inicio':
    case 'mensagem':
    case 'esperar':
    case 'mover_etapa':
    case 'marcar_tag':
    case 'desmarcar_tag':
    case 'atribuir':
    case 'mudar_modo':
    case 'lembrete':
      return [{ id: 'proximo', rotulo: 'Depois' }];
    case 'pergunta':
      return [
        ...no.opcoes.map((o, i) => ({ id: o.id, rotulo: `${i + 1}. ${o.texto || 'opção'}` })),
        { id: 'outro', rotulo: 'Não entendeu', opcional: true },
        { id: 'sem_resposta', rotulo: 'Não respondeu', opcional: true },
      ];
    case 'pergunta_aberta':
      return [
        { id: 'proximo', rotulo: 'Respondeu' },
        { id: 'invalida', rotulo: 'Resposta inválida', opcional: true },
        { id: 'sem_resposta', rotulo: 'Não respondeu', opcional: true },
      ];
    case 'condicao':
      return [{ id: 'sim', rotulo: 'Sim' }, { id: 'nao', rotulo: 'Não' }];
    case 'esperar_resposta':
      return [{ id: 'respondeu', rotulo: 'Respondeu' }, { id: 'sem_resposta', rotulo: 'Não respondeu' }];
    case 'webhook':
      return [{ id: 'ok', rotulo: 'Deu certo' }, { id: 'erro', rotulo: 'Deu erro', opcional: true }];
    case 'agente_ia':
      return [{ id: 'concluiu', rotulo: 'Concluiu' }, { id: 'tempo_esgotado', rotulo: 'Prazo acabou', opcional: true }];
    case 'transferir':
    case 'fim':
      return [];
  }
}

export interface Problema {
  noId?: string;
  ligacaoId?: string;
  /** erro: não deixa publicar. aviso: mostra na tela (ex.: saída solta = o bot termina ali). */
  nivel: 'erro' | 'aviso';
  mensagem: string;
}

const NOME_TIPO: Record<TipoNo, string> = {
  inicio: 'Início',
  mensagem: 'Enviar mensagem',
  pergunta: 'Pergunta com opções',
  pergunta_aberta: 'Pergunta aberta',
  condicao: 'Condição',
  esperar: 'Esperar',
  esperar_resposta: 'Esperar resposta',
  mover_etapa: 'Mover etapa',
  marcar_tag: 'Marcar tag',
  desmarcar_tag: 'Tirar tag',
  atribuir: 'Atribuir',
  mudar_modo: 'Mudar modo',
  lembrete: 'Lembrete de ligação',
  webhook: 'Webhook',
  agente_ia: 'Agente de IA',
  transferir: 'Transferir para humano',
  fim: 'Fim',
};
export const nomeDoTipo = (t: TipoNo) => NOME_TIPO[t];

/**
 * Confere o grafo (estrutura e conteúdo dos blocos). Os ids de etapa/tag/pessoa são conferidos à parte
 * (precisam do banco). Não há "laço proibido": voltar ao menu é normal; o motor limita os passos por rodada.
 */
export function problemasDoGrafo(g: Grafo): Problema[] {
  const p: Problema[] = [];
  const erro = (mensagem: string, noId?: string, ligacaoId?: string) => p.push({ nivel: 'erro', mensagem, noId, ligacaoId });
  const aviso = (mensagem: string, noId?: string) => p.push({ nivel: 'aviso', mensagem, noId });
  const ids = new Set<string>();
  for (const n of g.nos) {
    if (ids.has(n.id)) erro(`Dois blocos com o mesmo id (${n.id}).`, n.id);
    ids.add(n.id);
  }
  const inicios = g.nos.filter((n) => n.tipo === 'inicio');
  if (inicios.length === 0) erro('Falta o bloco Início.');
  if (inicios.length > 1) for (const n of inicios.slice(1)) erro('Só pode haver um bloco Início.', n.id);

  const porNo = new Map(g.nos.map((n) => [n.id, n]));
  const usadas = new Set<string>();
  for (const l of g.ligacoes) {
    const de = porNo.get(l.de);
    const para = porNo.get(l.para);
    if (!de || !para) {
      erro('Linha ligada a um bloco que não existe.', undefined, l.id);
      continue;
    }
    if (para.tipo === 'inicio') erro('Nenhuma linha pode entrar no Início.', para.id, l.id);
    if (!saidasDe(de).some((s) => s.id === l.saida)) erro(`${nomeDoTipo(de.tipo)}: saída "${l.saida}" não existe.`, de.id, l.id);
    const k = `${l.de}|${l.saida}`;
    if (usadas.has(k)) erro(`${nomeDoTipo(de.tipo)}: uma saída só pode ter uma linha.`, de.id, l.id);
    usadas.add(k);
  }

  // Alcançáveis a partir do Início.
  const alcancados = new Set<string>();
  const fila = inicios.slice(0, 1).map((n) => n.id);
  while (fila.length) {
    const x = fila.shift()!;
    if (alcancados.has(x)) continue;
    alcancados.add(x);
    for (const l of g.ligacoes) if (l.de === x && porNo.has(l.para)) fila.push(l.para);
  }

  for (const n of g.nos) {
    const nome = n.titulo || nomeDoTipo(n.tipo);
    const ligada = (s: string) => usadas.has(`${n.id}|${s}`);
    if (n.tipo !== 'inicio' && !alcancados.has(n.id)) aviso(`${nome}: nenhum caminho chega neste bloco.`, n.id);
    for (const s of saidasDe(n)) if (!s.opcional && !ligada(s.id)) {
      if (n.tipo === 'inicio') erro('Ligue o Início ao primeiro bloco.', n.id);
      else aviso(`${nome}: a saída "${s.rotulo}" não está ligada (o bot termina ali).`, n.id);
    }
    switch (n.tipo) {
      case 'inicio': {
        const g2 = n.gatilho;
        if (g2.tipo === 'palavra_chave' && !g2.palavras.some((x) => normalizar(x))) erro('Início: escreva pelo menos uma palavra-chave.', n.id);
        if (g2.tipo === 'entrou_na_etapa' && !g2.etapaId) erro('Início: escolha a etapa.', n.id);
        if (g2.tipo === 'tag_marcada' && !g2.tagId) erro('Início: escolha a tag.', n.id);
        break;
      }
      case 'mensagem':
        if (!n.texto.trim() && !n.midiaUrl && !n.midiaId) erro(`${nome}: escreva a mensagem (ou escolha uma imagem).`, n.id);
        if (n.midiaUrl && !/^https?:\/\//i.test(n.midiaUrl)) erro(`${nome}: o endereço da imagem precisa começar com http:// ou https://.`, n.id);
        break;
      case 'pergunta':
        if (!n.texto.trim()) erro(`${nome}: escreva a pergunta.`, n.id);
        if (n.opcoes.length < 1) erro(`${nome}: a pergunta precisa de pelo menos uma opção.`, n.id);
        if (n.opcoes.some((o) => !o.texto.trim())) erro(`${nome}: há opção sem texto.`, n.id);
        if (new Set(n.opcoes.map((o) => o.id)).size !== n.opcoes.length) erro(`${nome}: opções repetidas.`, n.id);
        if (n.opcoes.some((o) => ['outro', 'sem_resposta'].includes(o.id))) erro(`${nome}: id de opção reservado.`, n.id);
        break;
      case 'pergunta_aberta':
        if (!n.texto.trim()) erro(`${nome}: escreva a pergunta.`, n.id);
        break;
      case 'condicao': {
        const c = n.condicao;
        if (['tag', 'etapa', 'unidade', 'modo', 'resposta_contem'].includes(c.se) && !c.valor.trim()) erro(`${nome}: complete a condição.`, n.id);
        if (c.se === 'campo' && !c.campo) erro(`${nome}: escolha o campo.`, n.id);
        if (c.se === 'campo' && c.operador !== 'preenchido' && !c.valor.trim()) erro(`${nome}: escreva o valor para comparar.`, n.id);
        if (c.se === 'unidade' && c.valor && !(UNIDADES_BOT as readonly string[]).includes(c.valor)) erro(`${nome}: unidade inválida.`, n.id);
        if (c.se === 'modo' && c.valor && !(MODOS_BOT as readonly string[]).includes(c.valor)) erro(`${nome}: modo inválido.`, n.id);
        break;
      }
      case 'mover_etapa':
        if (!n.funilId || !n.etapaId) erro(`${nome}: escolha o funil e a etapa.`, n.id);
        break;
      case 'marcar_tag':
      case 'desmarcar_tag':
        if (!n.tagId) erro(`${nome}: escolha a tag.`, n.id);
        break;
      case 'webhook':
        if (!/^https?:\/\/[^\s]+$/i.test(n.url)) erro(`${nome}: informe um endereço que comece com http:// ou https://.`, n.id);
        break;
      case 'agente_ia':
        if (n.objetivo.trim().length < 3) erro(`${nome}: escreva o objetivo do agente.`, n.id);
        break;
      default:
        break;
    }
  }
  return p;
}

// ---------------------------------------------------------------- respostas da cliente

const NUMEROS_EXTENSO = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];

/** Qual opção a cliente escolheu: "2", "2.", "2️⃣", "opção 2", "dois" ou o texto da opção ("selagem"). */
export function casarOpcao(resposta: string, opcoes: Opcao[]): Opcao | undefined {
  const bruto = resposta.replace(/️|⃣/g, '').trim();
  const t = normalizar(bruto);
  if (!t) return undefined;
  const num = t.match(/^(?:opcao |opção |numero |n )?(\d{1,2})$/)?.[1] ?? (NUMEROS_EXTENSO.includes(t) ? String(NUMEROS_EXTENSO.indexOf(t)) : undefined);
  if (num) return opcoes[Number(num) - 1];
  const exata = opcoes.find((o) => normalizar(o.texto) === t);
  if (exata) return exata;
  // Texto da opção dentro da resposta ("quero a selagem"), ou a resposta dentro do texto da opção ("preço" em "Preços").
  const cont = opcoes.filter((o) => {
    const n = normalizar(o.texto);
    return n && (` ${t} `.includes(` ${n} `) || (t.length >= 4 && ` ${n} `.includes(` ${t}`)));
  });
  return cont.length === 1 ? cont[0] : undefined;
}

/** O texto da pergunta com a lista numerada (WhatsApp não oficial não tem botões). */
export function textoComOpcoes(pergunta: string, opcoes: Opcao[]): string {
  const lista = opcoes.map((o, i) => `${i + 1}. ${o.texto}`).join('\n');
  return `${pergunta.trim()}\n\n${lista}\n\nResponda com o número da opção.`;
}

/** Confere e arruma a resposta da pergunta aberta. undefined = inválida. */
export function validarResposta(texto: string, tipo: (typeof VALIDACOES)[number]): string | undefined {
  const t = texto.trim();
  if (!t) return undefined;
  switch (tipo) {
    case 'texto':
      return t.slice(0, 500);
    case 'numero': {
      const m = t.replace(/\s/g, '').match(/^-?\d+(?:[.,]\d+)?$/);
      return m ? m[0].replace(',', '.') : undefined;
    }
    case 'telefone': {
      const d = t.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 13 ? d : undefined;
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? t.toLowerCase() : undefined;
    case 'data': {
      let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      let a: number, mes: number, dia: number;
      if (m) [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else {
        m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
        if (!m) return undefined;
        dia = Number(m[1]);
        mes = Number(m[2]);
        a = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : new Date().getFullYear();
      }
      const d = new Date(Date.UTC(a, mes - 1, dia));
      if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return undefined;
      return `${a}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
  }
}

export const INVALIDA_PADRAO: Record<(typeof VALIDACOES)[number], string> = {
  texto: 'Não consegui entender. Pode escrever de novo?',
  numero: 'Preciso de um número (ex.: 2). Pode mandar de novo?',
  telefone: 'Esse telefone não parece certo. Mande com DDD, só os números (ex.: 71 98888-7777).',
  email: 'Esse e-mail não parece certo. Pode mandar de novo? (ex.: nome@email.com)',
  data: 'Não entendi a data. Mande assim: 25/12 ou 25/12/2026.',
};

/** Troca {variavel} pelos valores guardados no fluxo (depois das variáveis da conversa). */
export function preencherVariaveis(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (m, k: string) => (k in vars ? vars[k]! : m));
}

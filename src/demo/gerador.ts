import { randomUUID } from 'node:crypto';
import { ETAPAS, type Conversa, type Etapa, type Mensagem, type ModoAtendimento } from '../domain.js';
import type { Contato, TipoCampo } from '../contatos/contatos.js';
import type { Evento, TipoEvento } from '../store/repositorio.js';
import { ajustarParaJanelaAtiva, estaAberta, proximaAbertura } from '../engine/horario.js';
import { UNIDADES } from '../unidades.js';
import { canalTesteDa } from '../channels/teste.js';
import { bahia, DIA, HORA, MIN, nomeDiaSemana, partesBahia } from '../util/tempo.js';
import {
  ABERTURAS,
  AGRADECE,
  ALERGIAS,
  ELOGIOS,
  ESPERA_CLIENTE,
  NOMES_F,
  NOMES_M,
  OBSERVACOES,
  ORIGENS,
  PERDAS,
  PERGUNTAS,
  PRECO,
  PREFIXO_TELEFONE_DEMO,
  PROFISSIONAIS,
  RESPOSTA_ESPERA,
  SERVICOS,
  VALORES,
  SOBRENOMES,
  TAG_DA_ORIGEM,
  TIPOS_CABELO,
  type Origem,
  type Servico,
} from './dados.js';

/**
 * Gerador da demonstração: monta, sem gravar nada, ~140 conversas de salão com mensagens, eventos (os mesmos que o
 * motor registraria: conversa_nova, ia_respondeu, equipe_respondeu, agendamentos, ligações, etapas...), etapas de
 * funil, tags e fichas. Quem grava é o armazém (src/demo/armazem.ts).
 *
 * Regras que deixam o motor quieto (nada para ele fazer depois):
 * - nenhuma tarefa, execução de automação ou fila é criada aqui;
 * - toda conversa termina com a loja falando por último, ou com a cliente falando há mais de 25 horas
 *   (o aviso "cliente esperando" só olha as últimas 24 horas);
 * - os agendamentos futuros não programam lembrete (o lembrete de verdade é uma tarefa);
 * - tudo pelo canal de teste de cada unidade (nada sai para o WhatsApp).
 */

type Unidade = 'norte' | 'sumare';
export interface AtendenteDemo {
  id: string;
  nome: string;
  unidade: Unidade;
  ritmo: readonly [number, number];
}
export interface CampoRef {
  id: string;
  tipo: TipoCampo;
  opcoes: string[];
}
export interface ContextoGerador {
  agora: Date;
  empresaId: string;
  atendentes: AtendenteDemo[];
  /** Funil do sistema: id e a tag de cada etapa fixa. */
  sistema: { funilId: string; etapas: Record<Etapa, string> };
  posVenda?: { funilId: string; retorno: string; manutencao: string; fiel: string };
  /** Nome da tag solta → id (Progressiva, Selagem, Botox capilar, VIP, Instagram, Indicação, Tráfego pago, Gestante). */
  tags: Record<string, string>;
  campos: { tipoCabelo?: CampoRef; comoConheceu?: CampoRef; alergias?: CampoRef };
  quantidade?: number;
  semente?: number;
}

export type MensagemDemo = Omit<Mensagem, 'anexo' | 'entrega' | 'idExterno'> & { idExterno: string };
export interface MarcacaoDemo {
  conversaId: string;
  tagId: string;
  funilId: string | null;
  por: string;
  em: Date;
}
export type ContatoDemo = Contato & { criadoEm: Date };
export interface PlanoDemo {
  conversas: Conversa[];
  mensagens: MensagemDemo[];
  eventos: Evento[];
  marcacoes: MarcacaoDemo[];
  contatos: ContatoDemo[];
}

// ---------------------------------------------------------------- sorte (determinística pela semente)

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Sorte {
  constructor(private readonly r: () => number) {}
  num = () => this.r();
  entre = (a: number, b: number) => a + (b - a) * this.r();
  int = (a: number, b: number) => Math.floor(this.entre(a, b + 1));
  chance = (p: number) => this.r() < p;
  um = <T>(l: readonly T[]): T => l[Math.floor(this.r() * l.length)]!;
  pesado = <T>(l: ReadonlyArray<readonly [T, number]>): T => {
    const total = l.reduce((s, [, p]) => s + p, 0);
    let x = this.r() * total;
    for (const [v, p] of l) if ((x -= p) < 0) return v;
    return l[l.length - 1]![0];
  };
  embaralhar = <T>(l: T[]): T[] => {
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      [l[i], l[j]] = [l[j]!, l[i]!];
    }
    return l;
  };
}

/** Peso de cada hora (Bahia) para a primeira mensagem: comércio com pico à noite e um pouco de madrugada. */
const PESO_HORA = [1, 0.8, 0.4, 0.3, 0.3, 0.5, 1, 2, 3, 4, 5, 6, 6, 5, 6, 6, 6, 6.5, 7, 9, 10, 9, 6, 3];

const primeiro = (nome: string) => nome.split(' ')[0]!;
const p2 = (n: number) => String(n).padStart(2, '0');
function quandoHumano(d: Date): string {
  const p = partesBahia(d);
  return `${nomeDiaSemana(d)}, ${p2(p.dia)}/${p2(p.mes)} às ${p.hora}h${p.minuto ? p2(p.minuto) : ''}`;
}
/** "Bom dia"/"Boa tarde"/"Boa noite" certo para a hora (Bahia). */
function saudacaoDaHora(texto: string, t: number): string {
  const h = partesBahia(new Date(t)).hora;
  const certa = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  return texto.replace(/^(Bom dia|Boa tarde|Boa noite)/, certa);
}
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RESULTADO_LIGACAO = { atendeu: 'atendeu', nao_atendeu: 'não atendeu', agendou: 'agendou', caixa_postal: 'caiu na caixa postal' } as const;
type Resultado = keyof typeof RESULTADO_LIGACAO;

// ---------------------------------------------------------------- uma conversa

interface Pessoa {
  nome: string;
  telefone: string;
  unidade: Unidade;
  servico: Servico;
  origem: Origem;
  atendente: AtendenteDemo;
}

class Roteiro {
  readonly id = randomUUID();
  readonly msgs: MensagemDemo[] = [];
  readonly evs: Evento[] = [];
  readonly marcas: MarcacaoDemo[] = [];
  t: number;
  modo: ModoAtendimento;
  etapa: Etapa = 'novo_lead';
  etapaDesde: number;
  criadaEm: number;
  dona?: AtendenteDemo;
  ultCliente?: number;
  ultEquipe?: number;
  ultIa?: number;
  teveCliente = false;
  /** A IA assumiu porque a loja estava fechada. */
  assumiuFora = false;
  etiquetas: string[] = [];
  /** Etapa do Pós-venda (tag) e desde quando. */
  posVenda?: { tagId: string; em: number };

  constructor(
    private readonly g: Gerador,
    readonly p: Pessoa,
    t0: number,
    modo: ModoAtendimento = 'copiloto',
  ) {
    this.t = t0;
    this.criadaEm = t0;
    this.etapaDesde = t0;
    this.modo = modo;
  }

  get s() {
    return this.g.s;
  }
  get agora() {
    return this.g.c.agora.getTime();
  }
  private aberta(t = this.t) {
    return estaAberta(UNIDADES[this.p.unidade], new Date(t));
  }
  private ev(tipo: TipoEvento, dados?: Record<string, unknown>, em = this.t) {
    this.evs.push({ tipo, conversaId: this.id, unidade: this.p.unidade, em: new Date(em), ...(dados ? { dados } : {}) });
  }
  private msg(autor: Mensagem['autor'], texto: string, autorNome?: string) {
    this.msgs.push({ id: randomUUID(), conversaId: this.id, autor, texto, em: new Date(this.t), idExterno: `demo-${randomUUID()}`, ...(autorNome ? { autorNome } : {}) });
  }
  /** Quanto a cliente esperou (para tempoRespostaMs), como a Sintonia mede. */
  private espera(): number | undefined {
    const loja = Math.max(this.ultEquipe ?? 0, this.ultIa ?? 0);
    if (!this.ultCliente || loja > this.ultCliente) return undefined;
    return this.t - this.ultCliente;
  }

  avancarMin(min: number) {
    this.t += Math.round(min * MIN);
    return this;
  }
  /** Pula para o próximo dia (`dias` depois) num horário de loja. */
  avancarDias(dias: number, hora = this.s.int(10, 20)) {
    const p = partesBahia(new Date(this.t + dias * DIA));
    this.t = Math.max(this.t + 5 * MIN, bahia(p.ano, p.mes, p.dia, hora, this.s.int(0, 59)).getTime());
    return this;
  }

  mudarEtapa(para: Etapa, motivo: string, por?: string) {
    if (para === this.etapa) return;
    this.ev('etapa_mudou', { de: this.etapa, para, motivo, ...(por ? { por } : {}) });
    this.etapa = para;
    this.etapaDesde = this.t;
  }

  cliente(texto: string, depoisMin?: number) {
    if (depoisMin !== undefined) this.avancarMin(depoisMin);
    this.msg('cliente', saudacaoDaHora(texto, this.t));
    if (!this.teveCliente) {
      this.teveCliente = true;
      if (!this.evs.some((e) => e.tipo === 'lead_importado')) this.ev('conversa_nova');
    }
    this.ultCliente = this.t;
    if (this.etapa === 'novo_lead' || this.etapa === 'perdida' || this.etapa === 'manutencao') this.mudarEtapa('em_conversa', 'mensagem_cliente');
    this.ev('mensagem_cliente');
    return this;
  }

  /** A IA responde (segundos depois). `assumiu`: a conversa passa para a IA (fora do horário ou ninguém respondeu). */
  ia(texto: string, segundos = this.s.int(12, 45), motivoAssumiu?: string) {
    this.t += segundos * 1000;
    const espera = this.espera();
    this.msg('ia', texto);
    if (motivoAssumiu && this.modo !== 'ia') {
      this.modo = 'ia';
      this.ev('ia_assumiu', { motivo: motivoAssumiu });
    }
    this.ev('ia_respondeu', espera === undefined ? undefined : { tempoRespostaMs: espera });
    this.ultIa = this.t;
    return this;
  }

  /** Alguém da equipe responde. A primeira resposta faz dela a dona da conversa. */
  equipe(texto: string, minutos: number, quem = this.p.atendente) {
    this.avancarMin(minutos);
    const espera = this.espera();
    this.msg('equipe', texto, quem.nome);
    if (!this.dona) {
      this.dona = quem;
      this.ev('transferencia', { deId: null, deNome: null, paraId: quem.id, paraNome: quem.nome, porId: quem.id, porNome: quem.nome, motivo: 'primeira_resposta' });
    }
    if (this.modo === 'ia') this.modo = 'copiloto';
    this.ev('equipe_respondeu', { atendente: quem.nome, atendenteId: quem.id, ...(espera === undefined ? {} : { tempoRespostaMs: espera }) });
    this.ultEquipe = this.t;
    return this;
  }

  /**
   * A loja responde do jeito que a Sintonia faria: fora do horário (ou com a IA conduzindo) a IA responde em segundos;
   * no horário, a atendente responde no ritmo dela — e se demorar mais de 15 min, às vezes a IA assume.
   * Devolve quem respondeu.
   */
  responder(texto: string): 'ia' | 'equipe' {
    if (this.modo === 'humano') {
      // "Só eu": a IA nunca responde; fora do horário a atendente responde quando a loja abre.
      if (!this.aberta()) {
        const abre = proximaAbertura(UNIDADES[this.p.unidade], new Date(this.t));
        if (abre) this.t = abre.getTime();
      }
      this.equipe(texto, this.s.entre(...this.p.atendente.ritmo));
      return 'equipe';
    }
    // A IA assumiu de madrugada: com a loja aberta, a equipe costuma retomar a conversa.
    if (this.modo === 'ia' && this.assumiuFora && this.aberta() && this.s.chance(0.65)) {
      this.assumiuFora = false;
      this.equipe(texto, this.s.entre(...this.p.atendente.ritmo));
      return 'equipe';
    }
    if (this.modo === 'ia' || !this.aberta()) {
      if (!this.aberta() && this.modo !== 'ia') this.assumiuFora = true;
      this.ia(texto, undefined, this.aberta() ? undefined : 'Fora do horário de atendimento.');
      return 'ia';
    }
    const [a, b] = this.p.atendente.ritmo;
    const min = this.s.entre(a, b) * (this.s.chance(0.12) ? 2.2 : 1);
    if (min > 15 && this.s.chance(0.35)) {
      this.avancarMin(15);
      this.ia(texto, this.s.int(10, 30), 'Ninguém da equipe respondeu em 15 minutos.');
      return 'ia';
    }
    this.equipe(texto, min);
    return 'equipe';
  }

  /** Mensagem ativa da IA (lembrete, follow-up, pós-atendimento...). */
  ativo(tipo: string, texto: string) {
    this.msg('ia', texto);
    this.ultIa = this.t;
    this.ev('envio_ativo', { tipo });
    return this;
  }

  marcarTag(nome: string, por: string) {
    const tagId = this.g.c.tags[nome];
    if (!tagId || this.marcas.some((m) => m.tagId === tagId)) return this;
    this.marcas.push({ conversaId: this.id, tagId, funilId: null, por, em: new Date(this.t) });
    this.ev('tag_marcada', { tagId, nome, por });
    return this;
  }

  ligacao(resultado: Resultado, quem = this.p.atendente, nota?: string) {
    this.msg('sistema', `📞 ${quem.nome} ligou: ${RESULTADO_LIGACAO[resultado]}${nota ? ` · ${nota}` : ''}`);
    this.ev('ligacao', { resultado, atendente: quem.nome, atendenteId: quem.id, ...(nota ? { nota } : {}) });
    return this;
  }

  /** Agendamento gravado como a Sintonia grava (agendamento_ia/equipe com inicio, profissional e duração). */
  agendar(inicio: Date, por: 'ia' | 'equipe', servico = this.p.servico) {
    const prof = this.s.um(PROFISSIONAIS[this.p.unidade]);
    const quem = this.dona ?? this.p.atendente;
    this.ev(por === 'ia' ? 'agendamento_ia' : 'agendamento_equipe', {
      ...(por === 'equipe' ? { atendente: quem.nome, atendenteId: quem.id } : {}),
      servico: SERVICOS[servico].nome,
      inicio: inicio.toISOString(),
      profissional: prof,
      duracaoMin: SERVICOS[servico].duracaoMin,
      valor: this.s.um(VALORES[servico]),
    });
    this.mudarEtapa('agendada', 'agendamento_criado');
    return { prof, inicio };
  }

  /** Fim: a loja fala por último, ou a cliente falou há mais de 25 h (nada de "cliente esperando"). */
  fechar(): number {
    const ultima = this.msgs.filter((m) => m.autor !== 'sistema').at(-1);
    if (ultima?.autor === 'cliente' && this.agora - ultima.em.getTime() < 25 * HORA) this.responder(this.s.um(['😊', 'Imagina! 💛', 'Qualquer coisa estou por aqui 😘']));
    return Math.max(this.t, ...this.msgs.map((m) => m.em.getTime()), ...this.evs.map((e) => e.em.getTime()));
  }

  conversa(): Conversa {
    const ultima = Math.max(...this.msgs.map((m) => m.em.getTime()), this.criadaEm);
    return {
      id: this.id,
      empresaId: this.g.c.empresaId,
      unidade: this.p.unidade,
      canalId: canalTesteDa(this.p.unidade),
      telefone: this.p.telefone,
      nome: this.p.nome,
      modo: this.modo,
      etapa: this.etapa,
      etiquetas: this.etiquetas,
      ...(this.ultCliente ? { ultimaMensagemCliente: new Date(this.ultCliente) } : {}),
      ...(this.ultEquipe ? { ultimaMensagemEquipe: new Date(this.ultEquipe) } : {}),
      ...(this.ultIa ? { ultimaMensagemIa: new Date(this.ultIa) } : {}),
      ...(this.dona ? { responsavelId: this.dona.id, responsavelNome: this.dona.nome } : {}),
      criadaEm: new Date(this.criadaEm),
      atualizadaEm: new Date(ultima),
    };
  }
}

// ---------------------------------------------------------------- gerador

type Cenario = 'agendada' | 'retorno' | 'compareceu' | 'faltou' | 'interessada' | 'em_conversa' | 'novo_lead' | 'perdida' | 'manutencao' | 'agora_ia' | 'agora_equipe';

/** Quantas de cada, para 140 conversas (proporcional para outros totais). */
const MISTURA: Array<[Cenario, number]> = [
  ['agendada', 34],
  ['retorno', 4],
  ['compareceu', 30],
  ['faltou', 4],
  ['interessada', 22],
  ['em_conversa', 24],
  ['novo_lead', 8],
  ['perdida', 20],
  ['manutencao', 8],
  ['agora_ia', 1],
  ['agora_equipe', 1],
];

/** Dias atrás em que a conversa começa, por cenário. */
const IDADE: Record<Cenario, [number, number]> = {
  agendada: [0, 9],
  retorno: [0, 6],
  compareceu: [6, 18],
  faltou: [3, 10],
  interessada: [0, 18],
  em_conversa: [0, 18],
  novo_lead: [0, 6],
  perdida: [3, 20],
  manutencao: [92, 118],
  agora_ia: [0, 0],
  agora_equipe: [0, 0],
};

export class Gerador {
  readonly s: Sorte;
  private readonly nomesUsados = new Set<string>();
  private seq = 0;
  constructor(readonly c: ContextoGerador) {
    this.s = new Sorte(mulberry32(c.semente ?? 20261107));
  }

  private pessoa(unidade?: Unidade): Pessoa {
    let nome = '';
    for (let i = 0; i < 50 && (!nome || this.nomesUsados.has(nome)); i++) {
      const homem = this.s.chance(0.07);
      nome = `${this.s.um(homem ? NOMES_M : NOMES_F)} ${this.s.um(SOBRENOMES)}`;
    }
    this.nomesUsados.add(nome);
    const u: Unidade = unidade ?? (this.s.chance(0.55) ? 'norte' : 'sumare');
    const daUnidade = this.c.atendentes.filter((a) => a.unidade === u);
    const atendente = daUnidade.length ? (this.s.chance(0.55) ? daUnidade[0]! : this.s.um(daUnidade)) : this.c.atendentes[0]!;
    return {
      nome,
      telefone: `${PREFIXO_TELEFONE_DEMO}${String(++this.seq).padStart(5, '0')}`,
      unidade: u,
      servico: this.s.pesado([['progressiva', 55], ['selagem', 20], ['botox', 17], ['hidratacao', 8]] as const),
      origem: this.s.pesado(ORIGENS),
      atendente,
    };
  }

  /** Instante da primeira mensagem: `dias` atrás, numa hora sorteada pelo peso. */
  private inicio(dias: number, horas?: readonly [number, number]): number {
    const pa = partesBahia(this.c.agora);
    const dia = partesBahia(new Date(bahia(pa.ano, pa.mes, pa.dia, 12).getTime() - dias * DIA));
    const hora = horas ? this.s.int(horas[0], horas[1]) : this.s.pesado(PESO_HORA.map((p, h) => [h, p] as const));
    return bahia(dia.ano, dia.mes, dia.dia, hora, this.s.int(0, 59)).getTime() + this.s.int(0, 59) * 1000;
  }

  /** Um horário livre plausível (abertura até 3h antes de fechar) `dias` depois de `base`. */
  private horarioDoSalao(base: number, dias: number, unidade: Unidade): Date {
    const p = partesBahia(new Date(base + dias * DIA));
    const dom = p.diaSemana === 0;
    const h = dom ? this.s.int(14, 16) : this.s.int(10, 18);
    void unidade;
    return bahia(p.ano, p.mes, p.dia, h, this.s.chance(0.5) ? 0 : 30);
  }

  // ---------- falas que se repetem ----------

  private abertura(r: Roteiro) {
    const lista = this.s.chance(0.7) ? ABERTURAS[r.p.origem] : ABERTURAS.geral;
    r.cliente(this.s.um(lista).replace('{servico}', SERVICOS[r.p.servico].nome.toLowerCase()));
    const oi = this.s.um([`Oi, ${primeiro(r.p.nome)}! Tudo bem? 💛 `, `Olá, ${primeiro(r.p.nome)}! Que bom que chamou 😊 `, `Oii ${primeiro(r.p.nome)}! `]);
    const quem = r.responder(oi + PRECO[r.p.servico]);
    const tag = SERVICOS[r.p.servico].tag;
    if (tag) r.marcarTag(tag, quem === 'ia' ? 'IA' : r.p.atendente.nome);
    const tagOrigem = TAG_DA_ORIGEM[r.p.origem];
    if (tagOrigem && this.s.chance(0.75)) r.marcarTag(tagOrigem, r.p.atendente.nome);
  }

  private perguntas(r: Roteiro, min: number, max: number) {
    const n = this.s.int(min, max);
    const ja = new Set<number>();
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let tent = 0; tent < 10; tent++) {
        k = PERGUNTAS.indexOf(this.s.pesado(PERGUNTAS.map((q) => [q, q.peso] as const)));
        if (!ja.has(k)) break;
      }
      if (ja.has(k)) continue;
      ja.add(k);
      const q = PERGUNTAS[k]!;
      r.cliente(q.cliente, this.s.entre(1, 35));
      if (q.especial === 'gestante') {
        r.marcarTag('Gestante', r.p.atendente.nome);
        if (r.modo === 'ia' || !estaAberta(UNIDADES[r.p.unidade], new Date(r.t))) {
          // A IA não decide sozinha: passa para a equipe, que responde quando abre.
          r.ia('Ótima pergunta! Vou pedir para nossa especialista te responder direitinho, tá? 💛', undefined, 'Fora do horário de atendimento.');
          r.evs.push({ tipo: 'passou_para_humano', conversaId: r.id, unidade: r.p.unidade, em: new Date(r.t), dados: { motivo: 'Cliente gestante: precisa da orientação da equipe' } });
          r.modo = 'humano';
          const p = partesBahia(new Date(r.t + (partesBahia(new Date(r.t)).hora >= 10 ? DIA : 0)));
          r.t = Math.max(r.t + 10 * MIN, bahia(p.ano, p.mes, p.dia, 10, this.s.int(5, 40)).getTime());
          r.equipe(`Bom dia, ${primeiro(r.p.nome)}! Aqui é a ${r.p.atendente.nome.split(' ')[0]} 😊 ${q.loja(r.p.servico, r.p.unidade)}`, 0);
        } else r.equipe(q.loja(r.p.servico, r.p.unidade), this.s.entre(...r.p.atendente.ritmo));
        continue;
      }
      r.responder(q.loja(r.p.servico, r.p.unidade));
    }
  }

  // ---------- cenários ----------

  private cenario(tipo: Cenario, t0: number): Roteiro {
    const p = this.pessoa();
    const modo: ModoAtendimento = tipo === 'agora_ia' || this.s.chance(0.1) ? 'ia' : this.s.chance(0.06) ? 'humano' : 'copiloto';
    const r = new Roteiro(this, p, t0, modo);
    const nome = primeiro(p.nome);
    const servico = SERVICOS[p.servico].nome;
    const agora = this.c.agora.getTime();

    switch (tipo) {
      case 'novo_lead': {
        // Lead importado da planilha: a loja puxou conversa e ela ainda não respondeu.
        r.evs.push({ tipo: 'lead_importado', conversaId: r.id, unidade: p.unidade, em: new Date(r.t), dados: { por: 'Demonstração' } });
        r.modo = 'copiloto';
        r.avancarMin(this.s.entre(20, 300));
        r.equipe(`Oi, ${nome}! Aqui é a ${p.atendente.nome.split(' ')[0]} da Império Progressivas 💛 Vi que você deixou seu contato com interesse em ${servico.toLowerCase()}. Quer que eu te passe os valores?`, 0);
        if (agora - r.t > 26 * HORA) {
          r.avancarDias(1, this.s.int(10, 17));
          r.ligacao(this.s.um(['nao_atendeu', 'caixa_postal'] as const), p.atendente);
          r.equipe(`${nome}, tentei te ligar agora há pouco 😊 Quando puder me chama aqui que te passo os horários livres!`, this.s.entre(2, 10));
        } else r.equipe('Temos horários essa semana nas duas unidades 😉', this.s.entre(1, 3));
        if (SERVICOS[p.servico].tag) r.marcarTag(SERVICOS[p.servico].tag!, p.atendente.nome);
        break;
      }
      case 'em_conversa': {
        this.abertura(r);
        this.perguntas(r, 1, 3);
        // Algumas ficam com a pergunta da cliente sem resposta (há mais de um dia): aparecem em "Não lidas".
        if (this.s.chance(0.3) && agora - r.t > 2 * DIA) r.cliente(this.s.um(['E pra cabelo com química, pode?', 'Tem horário pra amanhã?', 'Vocês têm estacionamento?']), this.s.entre(5, 60));
        break;
      }
      case 'interessada': {
        this.abertura(r);
        this.perguntas(r, 1, 3);
        r.cliente(this.s.um(ESPERA_CLIENTE), this.s.entre(2, 40));
        r.mudarEtapa('interessada', 'ia_classificou', 'IA');
        r.responder(this.s.um(RESPOSTA_ESPERA));
        if (this.s.chance(0.45) && agora - r.t > 1.3 * DIA) {
          r.avancarDias(1, this.s.int(10, 18));
          r.t = ajustarParaJanelaAtiva(new Date(r.t)).getTime();
          r.ativo('followup_1d', `Oi, ${nome}! Passando pra saber se ficou alguma dúvida sobre a ${servico.toLowerCase()} 😊`);
          if (this.s.chance(0.5) && agora - r.t > 3 * HORA) {
            r.avancarMin(this.s.entre(60, 240));
            r.ligacao(this.s.um(['nao_atendeu', 'caixa_postal', 'atendeu'] as const), p.atendente, this.s.chance(0.5) ? 'Pediu para chamar no fim do mês' : undefined);
          }
        }
        break;
      }
      case 'perdida': {
        this.abertura(r);
        this.perguntas(r, 0, 2);
        const perda = this.s.pesado(PERDAS.map((x) => [x, x.peso] as const));
        if (perda.motivo === 'followups_esgotados') {
          r.avancarDias(1, this.s.int(10, 17));
          r.ativo('followup_1d', `Oi, ${nome}! Passando pra saber se ficou alguma dúvida sobre a ${servico.toLowerCase()} 😊`);
          r.avancarDias(2, this.s.int(10, 17));
          r.ativo('followup_3d', `Oi, ${nome}, tudo bem? Ainda temos horários essa semana, quer que eu reserve um pra você? 💛`);
          r.mudarEtapa('perdida', 'followups_esgotados');
        } else {
          r.cliente(perda.cliente!, this.s.entre(10, 300));
          r.responder(perda.loja!);
          r.mudarEtapa('perdida', perda.motivo, p.atendente.nome);
        }
        break;
      }
      case 'agendada':
      case 'retorno':
      case 'agora_ia': {
        if (tipo === 'retorno') {
          r.cliente(this.s.um(['Oi! Tá na hora da minha manutenção, tem horário essa semana?', 'Oii, quero retocar minha progressiva 💛 tem horário?']));
          r.responder(`Oi, ${nome}! Que bom te ver de volta 😍 Tenho horários sim, qual dia fica melhor?`);
          r.marcarTag('VIP', p.atendente.nome);
        } else {
          this.abertura(r);
          if (tipo !== 'agora_ia') this.perguntas(r, 0, 2);
        }
        let dias = this.s.int(1, 10);
        if (tipo === 'agora_ia') dias = this.s.int(1, 4);
        const inicio = this.horarioDoSalao(agora, dias, p.unidade);
        r.cliente(this.s.um([`Quero marcar! Pode ser ${quandoHumano(inicio).split(' às ')[0]}?`, `Tem horário ${quandoHumano(inicio).split(',')[0]}?`, 'Bora marcar então! Qual o próximo horário?']), tipo === 'agora_ia' ? 3 : this.s.entre(2, 90));
        const fala = `Prontinho, ${nome}! Agendei ${servico.toLowerCase()} para ${quandoHumano(inicio)}, unidade ${UNIDADES[p.unidade].nome}. Chegue uns 10 minutinhos antes 💛`;
        const quem = r.responder(fala);
        const ag = r.agendar(inicio, quem);
        void ag;
        if (tipo === 'retorno' && this.c.posVenda) r.posVenda = { tagId: this.c.posVenda.manutencao, em: r.t };
        r.cliente(this.s.um(AGRADECE), tipo === 'agora_ia' ? 2 : this.s.entre(1, 20));
        if (this.s.chance(0.5)) r.responder(this.s.um(['😘', 'Até lá! 💛', 'Te esperamos ✨']));
        break;
      }
      case 'compareceu':
      case 'faltou':
      case 'manutencao': {
        this.abertura(r);
        this.perguntas(r, 0, 2);
        const marcadoDaqui = this.s.int(1, tipo === 'manutencao' ? 7 : 5);
        const inicio = this.horarioDoSalao(r.t, marcadoDaqui, p.unidade);
        r.cliente(this.s.um([`Pode ser ${quandoHumano(inicio).split(' às ')[0]}?`, 'Quero marcar! Qual o horário mais cedo?', `Tem ${quandoHumano(inicio).split(',')[0]} à tarde?`]), this.s.entre(2, 60));
        const quem = r.responder(`Agendado, ${nome}! ${servico} ${quandoHumano(inicio)}, unidade ${UNIDADES[p.unidade].nome} 💛`);
        const ag = r.agendar(inicio, quem);
        r.cliente(this.s.um(AGRADECE), this.s.entre(1, 15));
        // Véspera às 10h: o lembrete que a Sintonia mandou na época.
        const pv = partesBahia(new Date(inicio.getTime() - DIA));
        const vespera = bahia(pv.ano, pv.mes, pv.dia, 10, 0).getTime();
        if (vespera > r.t + HORA) {
          r.t = vespera;
          r.ativo('lembrete_vespera', `Oi, ${nome}! Lembrete: amanhã, ${quandoHumano(inicio).split(' às ')[1]}, você tem ${servico.toLowerCase()} com a ${ag.prof} 💛 Confirma?`);
          r.cliente(this.s.um(['Confirmado!', 'Confirmadíssimo 😍', 'Tô lá!']), this.s.entre(5, 180));
          r.responder(this.s.um(['Oba! Até amanhã 💛', 'Perfeito, te esperamos ✨']));
        }
        const fim = inicio.getTime() + SERVICOS[p.servico].duracaoMin * MIN;
        if (tipo === 'faltou') {
          r.t = ajustarParaJanelaAtiva(new Date(inicio.getTime() + 3 * HORA)).getTime();
          r.ativo('recuperar_falta', `Oi, ${nome}, sentimos sua falta hoje! Aconteceu alguma coisa? Se quiser, remarco pra você 💛`);
          r.mudarEtapa('interessada', 'cliente_faltou');
          if (this.s.chance(0.5) && agora - r.t > 4 * HORA) {
            r.avancarMin(this.s.entre(60, 180));
            r.ligacao(this.s.um(['nao_atendeu', 'caixa_postal'] as const), p.atendente);
          }
          break;
        }
        r.t = fim + this.s.int(5, 40) * MIN;
        r.mudarEtapa('compareceu', 'manual', (r.dona ?? p.atendente).nome);
        const pd = partesBahia(new Date(fim + DIA));
        r.t = bahia(pd.ano, pd.mes, pd.dia, 11, 0).getTime();
        r.ativo('pos_atendimento', `Oi, ${nome}! Como ficou o cabelo? Qualquer dúvida sobre os cuidados é só chamar 💛`);
        if (this.s.chance(0.7)) {
          r.cliente(this.s.um(ELOGIOS), this.s.entre(10, 300));
          r.responder(this.s.um(['Que alegria! 😍 Te esperamos na manutenção daqui a uns 3 meses ✨', 'Ahh que bom! Obrigada pela confiança 💛']));
          if (this.s.chance(0.35)) r.marcarTag('VIP', p.atendente.nome);
        }
        if (this.c.posVenda && tipo === 'compareceu' && this.s.chance(0.55)) {
          const fiel = r.marcas.some((m) => m.tagId === this.c.tags.VIP);
          r.posVenda = { tagId: fiel ? this.c.posVenda.fiel : this.c.posVenda.retorno, em: r.t + 30 * MIN };
        }
        if (tipo === 'manutencao') {
          const p90 = partesBahia(new Date(fim + 90 * DIA));
          r.t = Math.min(bahia(p90.ano, p90.mes, p90.dia, 10, 0).getTime(), agora - this.s.int(2, 20) * DIA);
          r.ativo('manutencao_90d', `Oi, ${nome}! Já faz uns 3 meses da sua ${servico.toLowerCase()}, tá na hora da manutenção ✨ Quer que eu veja um horário pra você?`);
          r.mudarEtapa('manutencao', 'manutencao_vencida');
          if (this.c.posVenda && this.s.chance(0.5)) {
            r.marcarTag('VIP', p.atendente.nome);
            r.posVenda = { tagId: this.c.posVenda.fiel, em: r.t };
          }
        }
        break;
      }
      case 'agora_equipe': {
        this.abertura(r);
        r.cliente('Tem horário amanhã?', 2);
        r.responder('Tenho sim! 14h ou 17h30, qual prefere?');
        break;
      }
    }
    r.fechar();
    return r;
  }

  /** Monta o cenário com a primeira mensagem `dias` atrás; se passar de agora, recomeça mais cedo. */
  private montar(tipo: Cenario): Roteiro {
    const agora = this.c.agora.getTime();
    const [a, b] = IDADE[tipo];
    let dias = this.s.int(a, b);
    for (let tentativa = 0; ; tentativa++) {
      let t0: number;
      if (tipo === 'agora_ia') t0 = agora - this.s.int(60, 90) * MIN;
      else if (tipo === 'agora_equipe') t0 = agora - this.s.int(25, 40) * MIN;
      else t0 = this.inicio(dias);
      const seqAntes = this.seq;
      const nomes = new Set(this.nomesUsados);
      const r = this.cenario(tipo, t0);
      const fim = r.fechar();
      if (fim <= agora - 2 * MIN || tentativa >= 40) return r;
      // Passou de agora: desfaz o sorteio do nome/telefone e tenta começando mais cedo.
      this.seq = seqAntes;
      this.nomesUsados.clear();
      for (const n of nomes) this.nomesUsados.add(n);
      dias += tipo === 'agora_ia' || tipo === 'agora_equipe' ? 0 : 1;
    }
  }

  private contato(r: Roteiro): ContatoDemo | undefined {
    if (!this.s.chance(0.9)) return undefined;
    const { campos } = this.c;
    const valores: Contato['campos'] = {};
    const lista = (ref: CampoRef | undefined, v: string) => {
      if (!ref) return;
      if (ref.tipo === 'lista') valores[ref.id] = ref.opcoes.includes(v) ? v : ref.opcoes.length ? ref.opcoes[Math.abs(v.length) % ref.opcoes.length]! : v;
      else if (ref.tipo === 'texto') valores[ref.id] = v;
    };
    if (this.s.chance(0.7)) lista(campos.tipoCabelo, this.s.pesado([['Liso', 10], ['Ondulado', 30], ['Cacheado', 38], ['Crespo', 22]] as const));
    if (this.s.chance(0.88)) lista(campos.comoConheceu, r.p.origem);
    if (this.s.chance(0.08)) lista(campos.alergias, this.s.um(ALERGIAS));
    void TIPOS_CABELO;
    const [pn, ...resto] = r.p.nome.split(' ');
    const ano = partesBahia(this.c.agora).ano - this.s.int(19, 54);
    return {
      telefone: r.p.telefone,
      nome: r.p.nome,
      email: this.s.chance(0.45) ? `${semAcento(pn!)}.${semAcento(resto.join(''))}${this.s.int(1, 99)}@exemplo.com` : null,
      nascimento: this.s.chance(0.35) ? `${ano}-${p2(this.s.int(1, 12))}-${p2(this.s.int(1, 28))}` : null,
      observacoes: this.s.chance(0.22) ? this.s.um(OBSERVACOES) : null,
      pessoa: 'fisica',
      empresa: {},
      campos: valores,
      atualizadoEm: new Date(Math.max(r.criadaEm, r.t - HORA)),
      atualizadoPor: r.dona?.nome ?? 'Demonstração',
      criadoEm: new Date(r.criadaEm),
    };
  }

  gerar(): PlanoDemo {
    const total = this.c.quantidade ?? 140;
    const lista: Cenario[] = [];
    const soma = MISTURA.reduce((s, [, n]) => s + n, 0);
    for (const [tipo, n] of MISTURA) {
      const k = tipo.startsWith('agora') ? n : Math.max(1, Math.round((n * total) / soma));
      for (let i = 0; i < k; i++) lista.push(tipo);
    }
    while (lista.length > total + 2 && lista.length > 0) lista.splice(lista.findIndex((x) => x === 'em_conversa'), 1);
    const plano: PlanoDemo = { conversas: [], mensagens: [], eventos: [], marcacoes: [], contatos: [] };
    for (const tipo of this.s.embaralhar(lista)) {
      const r = this.montar(tipo);
      const c = r.conversa();
      plano.conversas.push(c);
      plano.mensagens.push(...r.msgs);
      plano.eventos.push(...r.evs);
      plano.marcacoes.push(...r.marcas);
      // Etapa no funil do sistema, "desde" a última mudança de etapa.
      plano.marcacoes.push({ conversaId: c.id, tagId: this.c.sistema.etapas[c.etapa], funilId: this.c.sistema.funilId, por: 'Sintonia', em: new Date(r.etapaDesde) });
      if (r.posVenda && this.c.posVenda) {
        const em = new Date(Math.min(r.posVenda.em, this.c.agora.getTime() - MIN));
        plano.marcacoes.push({ conversaId: c.id, tagId: r.posVenda.tagId, funilId: this.c.posVenda.funilId, por: 'Demonstração', em });
        plano.eventos.push({ tipo: 'etapa_movida', conversaId: c.id, unidade: c.unidade, em, dados: { funilId: this.c.posVenda.funilId, de: null, para: r.posVenda.tagId, por: 'Demonstração', porId: null, automatico: false } });
      }
      const ficha = this.contato(r);
      if (ficha) plano.contatos.push(ficha);
    }
    plano.eventos.sort((a, b) => a.em.getTime() - b.em.getTime());
    return plano;
  }
}

export function gerarPlano(c: ContextoGerador): PlanoDemo {
  return new Gerador(c).gerar();
}

/** Ligações de hoje (aba "Ligar hoje" › Hoje): algumas das interessadas recebem uma ligação no horário de hoje que já passou. */
export function ligacoesDeHoje(plano: PlanoDemo, c: Pick<ContextoGerador, 'agora' | 'atendentes'>, semente = 7): void {
  const s = new Sorte(mulberry32(semente));
  const agora = c.agora.getTime();
  const pa = partesBahia(c.agora);
  const abre = bahia(pa.ano, pa.mes, pa.dia, pa.diaSemana === 0 ? 14 : 10).getTime();
  if (agora - abre < 40 * MIN) return;
  const alvos = plano.conversas.filter((x) => (x.etapa === 'interessada' || x.etapa === 'em_conversa') && x.atualizadaEm.getTime() < abre).slice(0, 4);
  for (const conv of alvos) {
    const quem = c.atendentes.find((a) => a.id === conv.responsavelId) ?? c.atendentes.find((a) => a.unidade === conv.unidade) ?? c.atendentes[0]!;
    const em = new Date(s.entre(abre + 10 * MIN, agora - 5 * MIN));
    const resultado = s.um(['atendeu', 'nao_atendeu', 'atendeu', 'caixa_postal'] as const);
    const nota = resultado === 'atendeu' ? s.um(['Vai passar na loja no sábado', 'Pediu para mandar os valores de novo', 'Vai confirmar com o marido']) : undefined;
    plano.mensagens.push({ id: randomUUID(), conversaId: conv.id, autor: 'sistema', texto: `📞 ${quem.nome} ligou: ${RESULTADO_LIGACAO[resultado]}${nota ? ` · ${nota}` : ''}`, em, idExterno: `demo-${randomUUID()}` });
    plano.eventos.push({ tipo: 'ligacao', conversaId: conv.id, unidade: conv.unidade, em, dados: { resultado, atendente: quem.nome, atendenteId: quem.id, ...(nota ? { nota } : {}) } });
  }
  plano.eventos.sort((a, b) => a.em.getTime() - b.em.getTime());
}

/** Contagens do plano (resposta do POST /api/demo/popular). */
export function contarPlano(p: PlanoDemo, agora: Date) {
  const ag = p.eventos.filter((e) => e.tipo === 'agendamento_ia' || e.tipo === 'agendamento_equipe');
  const futuros = ag.filter((e) => Date.parse(String(e.dados?.inicio)) > agora.getTime()).length;
  const porEtapa = Object.fromEntries(ETAPAS.map((e) => [e, p.conversas.filter((c) => c.etapa === e).length]));
  return {
    conversas: p.conversas.length,
    mensagens: p.mensagens.length,
    eventos: p.eventos.length,
    agendamentos: { total: ag.length, futuros, passados: ag.length - futuros, ia: ag.filter((e) => e.tipo === 'agendamento_ia').length, equipe: ag.filter((e) => e.tipo === 'agendamento_equipe').length },
    ligacoes: p.eventos.filter((e) => e.tipo === 'ligacao').length,
    contatos: p.contatos.length,
    porEtapa,
  };
}

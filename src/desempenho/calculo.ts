import { normalizar, servicosMaisAgendados, valorDe, type ConfigComercial, type LinhaServico, type Venda } from '../comercial/calculo.js';
import { dataISO, HORA, MIN, partesBahia } from '../util/tempo.js';

/**
 * Desempenho do atendimento (visão do dono). Função pura: a fonte (fonte.ts) entrega mensagens, eventos e
 * conversas do período (Postgres filtra no banco; a memória serve os testes) e este arquivo faz as contas:
 * tempos de resposta, expediente de cada atendente, agendamentos com/sem valor, o que ficou para trás e rankings.
 *
 * Definições (as mesmas na tela e nos testes):
 * - Atendimento: começa numa mensagem da cliente sem nenhuma mensagem na conversa nas `NOVA_SESSAO_MS` anteriores.
 * - 1ª resposta: do início do atendimento à 1ª mensagem da loja (equipe ou IA). Conta para quem respondeu.
 * - Resposta durante a conversa: da 1ª mensagem de cada "vez" da cliente (sem resposta ainda) à resposta da
 *   atendente, fora as aberturas de atendimento (que já entram na 1ª resposta).
 * - Tempo até agendar: da 1ª mensagem da cliente (até 30 dias antes) ao agendamento feito pela atendente.
 * - Expediente do dia: 1ª e última ação dela (mensagem, ligação, agendamento); horas ativas = soma dos intervalos
 *   entre ações seguidas de até `PAUSA_MS` (o resto é pausa).
 */

export const NOVA_SESSAO_MS = 12 * HORA;
export const PAUSA_MS = 30 * MIN;

export type Autor = 'cliente' | 'equipe' | 'ia' | 'sistema';
export interface MsgD {
  conversaId: string;
  autor: Autor;
  autorNome?: string | null;
  em: Date;
}
export interface EvD {
  tipo: string;
  conversaId: string;
  em: Date;
  dados?: Record<string, unknown> | null;
}
export interface ConvD {
  id: string;
  nome: string | null;
  telefone: string;
  unidade: string;
  etapa: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  ultimaMensagemCliente: Date | null;
  ultimaMensagemEquipe: Date | null;
  ultimaMensagemIa: Date | null;
}
/** Agendamento com a 1ª mensagem da cliente antes dele (para "tempo até agendar"). */
export interface AgD {
  conversaId: string;
  em: Date;
  porIa: boolean;
  atendenteId: string | null;
  atendenteNome: string | null;
  servico: string | null;
  profissional: string | null;
  unidade: string;
  valor: number | null;
  compareceu: boolean;
  primeiraClienteEm: Date | null;
}
export interface DadosDesempenho {
  /** Mensagens de [inicio − 12 h, fim): as anteriores ao início só servem de contexto. */
  mensagens: MsgD[];
  /** Eventos de [inicio, agora] (lembretes feitos depois do fim também contam). */
  eventos: EvD[];
  agendamentos: AgD[];
  conversas: Map<string, ConvD>;
}
export interface PessoaD {
  id: string;
  nome: string;
}
export interface Entrada {
  dados: DadosDesempenho;
  inicio: Date;
  fim: Date;
  agora: Date;
  pessoas: PessoaD[];
  precos: ConfigComercial['precos'];
  /** "Sem resposta" a partir de quantos minutos. */
  limiteMin: number;
  /** Só esta atendente (id). */
  atendente?: string;
}

// ---------------------------------------------------------------- utilidades

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
export const media = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const centavos = (n: number) => Math.round(n * 100) / 100;
const grade = () => Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
const marcar = (g: number[][], d: Date) => {
  const p = partesBahia(d);
  g[p.diaSemana]![p.hora]!++;
};
/** Dia × hora com mais ocorrências (null se vazio). */
export function pico(g: number[][]): { diaSemana: number; hora: number; total: number } | null {
  let r: { diaSemana: number; hora: number; total: number } | null = null;
  g.forEach((linha, d) => linha.forEach((v, h) => { if (v > 0 && (!r || v > r.total)) r = { diaSemana: d, hora: h, total: v }; }));
  return r;
}
/** Hora do dia (0–23) com mais ocorrências. */
export function horaPico(g: number[][]): number | null {
  const porHora = Array(24).fill(0) as number[];
  g.forEach((l) => l.forEach((v, h) => (porHora[h] = (porHora[h] ?? 0) + v)));
  const max = Math.max(...porHora);
  return max > 0 ? porHora.indexOf(max) : null;
}

/** Quem é a atendente de uma mensagem/evento: id quando há, senão pelo nome (casado com a equipe). */
export class Identidades {
  private porNome = new Map<string, PessoaD>();
  private porId = new Map<string, PessoaD>();
  constructor(pessoas: PessoaD[], eventos: EvD[], conversas: Iterable<ConvD> = []) {
    for (const p of pessoas) this.guardar(p.id, p.nome);
    for (const c of conversas) if (c.responsavelId && c.responsavelNome) this.guardar(c.responsavelId, c.responsavelNome);
    for (const e of eventos) {
      const id = str(e.dados?.atendenteId) ?? str(e.dados?.porId);
      const nome = str(e.dados?.atendente) ?? str(e.dados?.porNome);
      if (id && nome) this.guardar(id, nome);
    }
  }
  private guardar(id: string, nome: string) {
    if (!this.porId.has(id)) this.porId.set(id, { id, nome });
    const k = normalizar(nome);
    if (!this.porNome.has(k)) this.porNome.set(k, this.porId.get(id)!);
  }
  /** Chave estável: o id, ou "nome:fulana" quando só se sabe o nome. */
  chave(id: string | null | undefined, nome: string | null | undefined): string | null {
    if (id) return id;
    if (!nome) return null;
    return this.porNome.get(normalizar(nome))?.id ?? `nome:${normalizar(nome)}`;
  }
  nome(chave: string, reserva?: string | null): string {
    return this.porId.get(chave)?.nome ?? reserva ?? chave.replace(/^nome:/, '');
  }
}

// ---------------------------------------------------------------- tipos de saída

export interface DiaExpediente {
  dia: string;
  inicio: string;
  fim: string;
  /** Do 1º ao último sinal, em minutos. */
  spanMin: number;
  /** Só o tempo em atividade (pausas > 30 min ficam fora). */
  ativoMin: number;
  acoes: number;
}
export interface Espera {
  conversaId: string;
  cliente: string;
  unidade: string;
  desde: string;
  esperaMin: number;
  /** Quem acabou respondendo (null = ainda esperando). */
  respondeu: 'equipe' | 'ia' | null;
}
export interface LinhaAtendente {
  id: string;
  nome: string;
  conversas: number;
  mensagens: number;
  primeiraResposta: { mediaMs: number | null; medianaMs: number | null; n: number };
  respostaConversa: { mediaMs: number | null; n: number };
  ateAgendar: { mediaMs: number | null; medianaMs: number | null; n: number };
  agendamentos: number;
  comValor: number;
  semValor: number;
  valor: number;
  comparecimentos: number;
  /** % de conversas atendidas que viraram agendamento por ela. */
  conversao: number;
  ligacoes: number;
  expediente: DiaExpediente[];
  horasAtivas: number;
  /** Mapa dia da semana (0 = domingo) × hora dos agendamentos dela. */
  calorAgendamentos: number[][];
  picoAgendamento: { diaSemana: number; hora: number; total: number } | null;
  deixouPassar: {
    semResposta: number;
    esperas: Espera[];
    iaAssumiu: number;
    perdidos: { conversaId: string; cliente: string; motivo: string; em: string }[];
    lembretesNaoFeitos: { conversaId: string; cliente: string; quando: string; texto: string }[];
  };
}
export interface Desempenho {
  periodo: { inicio: string; fim: string };
  limiteMin: number;
  totais: {
    conversas: number;
    mensagensCliente: number;
    mensagensEquipe: number;
    mensagensIa: number;
    agendamentos: number;
    comValor: number;
    semValor: number;
    valor: number;
    primeiraRespostaMedianaMs: number | null;
    semResposta: number;
  };
  atendentes: LinhaAtendente[];
  profissionais: { nome: string; agendamentos: number; valor: number; comparecimentos: number }[];
  servicos: LinhaServico[];
  clientes: { conversaId: string; cliente: string; agendamentos: number; valor: number }[];
  iaEquipe: {
    ia: { mensagens: number; primeiras: number; primeiraMediaMs: number | null; agendamentos: number; valor: number };
    equipe: { mensagens: number; primeiras: number; primeiraMediaMs: number | null; agendamentos: number; valor: number };
  };
  calor: { mensagens: number[][]; agendamentos: number[][] };
  picos: { mensagens: ReturnType<typeof pico>; agendamentos: ReturnType<typeof pico> };
  /** Linha do tempo do último dia do período: atendente → mensagens por hora. */
  linhaDoTempo: { dia: string; pessoas: { id: string; nome: string; horas: number[] }[] };
}

// ---------------------------------------------------------------- cálculo

interface Acum {
  id: string;
  nome: string;
  conversas: Set<string>;
  mensagens: number;
  primeiras: number[];
  durante: number[];
  ate: number[];
  ags: AgD[];
  ligacoes: number;
  acoes: Date[];
  calor: number[][];
}

export function calcularDesempenho(e: Entrada): Desempenho {
  const { dados, inicio, fim, agora } = e;
  const t0 = inicio.getTime();
  const t1 = fim.getTime();
  const dentro = (d: Date) => d.getTime() >= t0 && d.getTime() < t1;
  const ids = new Identidades(e.pessoas, dados.eventos, dados.conversas.values());
  const conv = (id: string) => dados.conversas.get(id);
  const nomeCliente = (id: string) => conv(id)?.nome || conv(id)?.telefone || 'Cliente';
  const acum = new Map<string, Acum>();
  const de = (chave: string, nome?: string | null): Acum => {
    let a = acum.get(chave);
    if (!a) acum.set(chave, (a = { id: chave, nome: ids.nome(chave, nome), conversas: new Set(), mensagens: 0, primeiras: [], durante: [], ate: [], ags: [], ligacoes: 0, acoes: [], calor: grade() }));
    return a;
  };

  // ---- mensagens, por conversa em ordem
  const porConversa = new Map<string, MsgD[]>();
  for (const m of dados.mensagens) {
    if (m.autor === 'sistema') continue;
    const l = porConversa.get(m.conversaId) ?? [];
    l.push(m);
    porConversa.set(m.conversaId, l);
  }
  const limiteMs = e.limiteMin * MIN;
  const tot = { conversas: new Set<string>(), cli: 0, eq: 0, ia: 0 };
  const iaPrim: number[] = [];
  const eqPrim: number[] = [];
  const todasPrimeiras: number[] = [];
  const calorMsgs = grade();
  /** Esperas longas por conversa (para "deixou passar" da dona). */
  const esperas: Espera[] = [];
  const ultimoDia = dataISO(new Date(Math.min(t1, agora.getTime()) - 1));
  const linha = new Map<string, number[]>();

  for (const [cid, msgs] of porConversa) {
    msgs.sort((a, b) => a.em.getTime() - b.em.getTime());
    let anterior: MsgD | undefined;
    /** Início da vez da cliente ainda sem resposta (e se abriu atendimento). */
    let vez: { em: Date; abertura: boolean } | null = null;
    for (const m of msgs) {
      const conta = dentro(m.em);
      if (m.autor === 'cliente') {
        if (!vez) {
          const abertura = !anterior || m.em.getTime() - anterior.em.getTime() > NOVA_SESSAO_MS;
          vez = { em: m.em, abertura };
        }
        if (conta) {
          tot.cli++;
          tot.conversas.add(cid);
          marcar(calorMsgs, m.em);
        }
      } else {
        const chave = m.autor === 'equipe' ? ids.chave(null, m.autorNome) : null;
        if (conta) {
          if (m.autor === 'ia') tot.ia++;
          else tot.eq++;
          tot.conversas.add(cid);
          marcar(calorMsgs, m.em);
          if (chave) {
            const a = de(chave, m.autorNome);
            a.mensagens++;
            a.conversas.add(cid);
            a.acoes.push(m.em);
            if (dataISO(m.em) === ultimoDia) {
              const h = linha.get(chave) ?? Array(24).fill(0);
              h[partesBahia(m.em).hora]++;
              linha.set(chave, h);
            }
          }
        }
        if (vez && vez.em.getTime() >= t0 && vez.em.getTime() < t1) {
          const ms = m.em.getTime() - vez.em.getTime();
          if (ms > limiteMs) esperas.push({ conversaId: cid, cliente: nomeCliente(cid), unidade: conv(cid)?.unidade ?? '', desde: vez.em.toISOString(), esperaMin: Math.round(ms / MIN), respondeu: m.autor === 'ia' ? 'ia' : 'equipe' });
          if (vez.abertura) {
            todasPrimeiras.push(ms);
            (m.autor === 'ia' ? iaPrim : eqPrim).push(ms);
            if (chave) de(chave, m.autorNome).primeiras.push(ms);
          } else if (chave) de(chave, m.autorNome).durante.push(ms);
        }
        vez = null;
      }
      anterior = m;
    }
    // Ainda esperando agora.
    if (vez && vez.em.getTime() >= t0 && vez.em.getTime() < t1) {
      const ms = agora.getTime() - vez.em.getTime();
      if (ms > limiteMs) esperas.push({ conversaId: cid, cliente: nomeCliente(cid), unidade: conv(cid)?.unidade ?? '', desde: vez.em.toISOString(), esperaMin: Math.round(ms / MIN), respondeu: null });
    }
  }

  // ---- eventos
  const ligacoesDepois = new Map<string, Date[]>();
  for (const ev of dados.eventos) if (ev.tipo === 'ligacao') ligacoesDepois.set(ev.conversaId, [...(ligacoesDepois.get(ev.conversaId) ?? []), ev.em]);
  const donaDe = (cid: string) => conv(cid)?.responsavelId ?? null;
  const iaAssumiu = new Map<string, number>();
  const perdidos = new Map<string, LinhaAtendente['deixouPassar']['perdidos']>();
  const lembretes = new Map<string, LinhaAtendente['deixouPassar']['lembretesNaoFeitos']>();
  const contados = new Set<string>();
  for (const ev of dados.eventos) {
    if (!dentro(ev.em)) continue;
    if (ev.tipo === 'ligacao') {
      const k = ids.chave(str(ev.dados?.atendenteId), str(ev.dados?.atendente));
      if (k) {
        const a = de(k, str(ev.dados?.atendente));
        a.ligacoes++;
        a.acoes.push(ev.em);
      }
    }
    const dona = donaDe(ev.conversaId);
    if (!dona) continue;
    if (ev.tipo === 'ia_assumiu' && !/fora do hor/i.test(str(ev.dados?.motivo) ?? '')) iaAssumiu.set(dona, (iaAssumiu.get(dona) ?? 0) + 1);
    if (ev.tipo === 'etapa_mudou' && str(ev.dados?.para) === 'perdida' && !contados.has(ev.conversaId)) {
      contados.add(ev.conversaId);
      const l = perdidos.get(dona) ?? [];
      l.push({ conversaId: ev.conversaId, cliente: nomeCliente(ev.conversaId), motivo: str(ev.dados?.motivoPerda) ?? str(ev.dados?.motivo) ?? 'Sem motivo', em: ev.em.toISOString() });
      perdidos.set(dona, l);
    }
    if (ev.tipo === 'lembrete_ligacao') {
      const quando = new Date(str(ev.dados?.quando) ?? ev.em.toISOString());
      const feita = (ligacoesDepois.get(ev.conversaId) ?? []).some((t) => t.getTime() >= ev.em.getTime());
      if (!feita && quando.getTime() <= agora.getTime()) {
        const l = lembretes.get(dona) ?? [];
        l.push({ conversaId: ev.conversaId, cliente: nomeCliente(ev.conversaId), quando: quando.toISOString(), texto: str(ev.dados?.texto) ?? 'Ligar' });
        lembretes.set(dona, l);
      }
    }
  }

  // ---- agendamentos
  const ags = dados.agendamentos.filter((a) => dentro(a.em));
  const valor = (a: AgD) => valorDe({ valor: a.valor, servico: a.servico }, e.precos);
  const calorAgs = grade();
  for (const a of ags) {
    marcar(calorAgs, a.em);
    if (a.porIa) continue;
    const k = ids.chave(a.atendenteId, a.atendenteNome);
    if (!k) continue;
    const x = de(k, a.atendenteNome);
    x.ags.push(a);
    x.acoes.push(a.em);
    marcar(x.calor, a.em);
    if (a.primeiraClienteEm && a.primeiraClienteEm.getTime() <= a.em.getTime()) x.ate.push(a.em.getTime() - a.primeiraClienteEm.getTime());
  }

  // ---- por atendente
  const esperasDa = (dona: string) => esperas.filter((x) => donaDe(x.conversaId) === dona);
  let linhas: LinhaAtendente[] = [...acum.values()].map((a) => {
    const vals = a.ags.map(valor);
    const comValor = vals.filter((v) => v > 0).length;
    const expediente = expedienteDe(a.acoes);
    const minhas = esperasDa(a.id).sort((x, y) => y.esperaMin - x.esperaMin);
    return {
      id: a.id,
      nome: a.nome,
      conversas: a.conversas.size,
      mensagens: a.mensagens,
      primeiraResposta: { mediaMs: media(a.primeiras), medianaMs: mediana(a.primeiras), n: a.primeiras.length },
      respostaConversa: { mediaMs: media(a.durante), n: a.durante.length },
      ateAgendar: { mediaMs: media(a.ate), medianaMs: mediana(a.ate), n: a.ate.length },
      agendamentos: a.ags.length,
      comValor,
      semValor: a.ags.length - comValor,
      valor: centavos(vals.reduce((s, v) => s + v, 0)),
      comparecimentos: a.ags.filter((x) => x.compareceu).length,
      conversao: a.conversas.size ? Math.round((1000 * new Set(a.ags.map((x) => x.conversaId)).size) / a.conversas.size) / 10 : 0,
      ligacoes: a.ligacoes,
      expediente,
      horasAtivas: Math.round(expediente.reduce((s, d) => s + d.ativoMin, 0) / 6) / 10,
      calorAgendamentos: a.calor,
      picoAgendamento: pico(a.calor),
      deixouPassar: {
        semResposta: minhas.length,
        esperas: minhas.slice(0, 30),
        iaAssumiu: iaAssumiu.get(a.id) ?? 0,
        perdidos: perdidos.get(a.id) ?? [],
        lembretesNaoFeitos: lembretes.get(a.id) ?? [],
      },
    };
  });
  if (e.atendente) linhas = linhas.filter((l) => l.id === e.atendente);
  linhas.sort((a, b) => b.agendamentos - a.agendamentos || b.valor - a.valor || b.conversas - a.conversas || a.nome.localeCompare(b.nome, 'pt-BR'));

  // ---- equipe
  const profs = new Map<string, { nome: string; agendamentos: number; valor: number; comparecimentos: number }>();
  const clientes = new Map<string, { conversaId: string; cliente: string; agendamentos: number; valor: number }>();
  for (const a of ags) {
    const nome = a.profissional?.trim() || 'Sem profissional';
    const p = profs.get(normalizar(nome)) ?? { nome, agendamentos: 0, valor: 0, comparecimentos: 0 };
    p.agendamentos++;
    p.valor = centavos(p.valor + valor(a));
    if (a.compareceu) p.comparecimentos++;
    profs.set(normalizar(nome), p);
    const c = clientes.get(a.conversaId) ?? { conversaId: a.conversaId, cliente: nomeCliente(a.conversaId), agendamentos: 0, valor: 0 };
    c.agendamentos++;
    c.valor = centavos(c.valor + valor(a));
    clientes.set(a.conversaId, c);
  }
  const vendas: Venda[] = ags.map((a) => ({ conversaId: a.conversaId, unidade: a.unidade, servico: a.servico, atendenteId: a.atendenteId, atendenteNome: a.atendenteNome, responsavelId: donaDe(a.conversaId), porIa: a.porIa, em: a.em, valor: a.valor, compareceu: a.compareceu, primeiroNome: null }));
  const lado = (ia: boolean) => {
    const l = ags.filter((a) => a.porIa === ia);
    return { agendamentos: l.length, valor: centavos(l.reduce((s, a) => s + valor(a), 0)) };
  };
  const totalValores = ags.map(valor);
  const comValor = totalValores.filter((v) => v > 0).length;
  const nomesLinha = [...linha.entries()].map(([id, horas]) => ({ id, nome: ids.nome(id), horas })).filter((p) => !e.atendente || p.id === e.atendente);

  return {
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
    limiteMin: e.limiteMin,
    totais: {
      conversas: tot.conversas.size,
      mensagensCliente: tot.cli,
      mensagensEquipe: tot.eq,
      mensagensIa: tot.ia,
      agendamentos: ags.length,
      comValor,
      semValor: ags.length - comValor,
      valor: centavos(totalValores.reduce((s, v) => s + v, 0)),
      primeiraRespostaMedianaMs: mediana(todasPrimeiras),
      semResposta: esperas.length,
    },
    atendentes: linhas,
    profissionais: [...profs.values()].sort((a, b) => b.agendamentos - a.agendamentos || b.valor - a.valor),
    servicos: servicosMaisAgendados(vendas, { precos: e.precos } as ConfigComercial).slice(0, 15),
    clientes: [...clientes.values()].sort((a, b) => b.agendamentos - a.agendamentos || b.valor - a.valor).slice(0, 15),
    iaEquipe: {
      ia: { mensagens: tot.ia, primeiras: iaPrim.length, primeiraMediaMs: media(iaPrim), ...lado(true) },
      equipe: { mensagens: tot.eq, primeiras: eqPrim.length, primeiraMediaMs: media(eqPrim), ...lado(false) },
    },
    calor: { mensagens: calorMsgs, agendamentos: calorAgs },
    picos: { mensagens: pico(calorMsgs), agendamentos: pico(calorAgs) },
    linhaDoTempo: { dia: ultimoDia, pessoas: nomesLinha.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) },
  };
}

/** Início, fim e horas ativas de cada dia (horário da Bahia). */
export function expedienteDe(acoes: Date[]): DiaExpediente[] {
  const porDia = new Map<string, number[]>();
  for (const d of acoes) {
    const k = dataISO(d);
    porDia.set(k, [...(porDia.get(k) ?? []), d.getTime()]);
  }
  const hm = (t: number) => {
    const p = partesBahia(new Date(t));
    return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
  };
  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, ts]) => {
      ts.sort((a, b) => a - b);
      let ativo = 0;
      for (let i = 1; i < ts.length; i++) {
        const g = ts[i]! - ts[i - 1]!;
        if (g <= PAUSA_MS) ativo += g;
      }
      return { dia, inicio: hm(ts[0]!), fim: hm(ts.at(-1)!), spanMin: Math.round((ts.at(-1)! - ts[0]!) / MIN), ativoMin: Math.round(ativo / MIN), acoes: ts.length };
    });
}

/** Fila de agora: conversas esperando resposta, da espera mais longa para a mais curta. */
export interface ItemFila {
  conversaId: string;
  cliente: string;
  telefone: string;
  unidade: string;
  dona: string | null;
  donaId: string | null;
  desde: string;
  esperaMin: number;
}
export function montarFila(conversas: ConvD[], agora: Date, filtro: { unidade?: string; atendente?: string } = {}, limite = 60): ItemFila[] {
  return conversas
    .filter((c) => {
      const cl = c.ultimaMensagemCliente?.getTime();
      if (!cl) return false;
      if (filtro.unidade && c.unidade !== filtro.unidade) return false;
      if (filtro.atendente && c.responsavelId !== filtro.atendente) return false;
      return cl > Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
    })
    .map((c) => ({
      conversaId: c.id,
      cliente: c.nome || c.telefone,
      telefone: c.telefone,
      unidade: c.unidade,
      dona: c.responsavelNome,
      donaId: c.responsavelId,
      desde: c.ultimaMensagemCliente!.toISOString(),
      esperaMin: Math.max(0, Math.round((agora.getTime() - c.ultimaMensagemCliente!.getTime()) / MIN)),
    }))
    .sort((a, b) => a.desde.localeCompare(b.desde))
    .slice(0, limite);
}

// ---------------------------------------------------------------- CSV

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const minutos = (ms: number | null) => (ms === null ? '' : String(Math.round(ms / 6000) / 10).replace('.', ','));
const dinheiro = (n: number) => n.toFixed(2).replace('.', ',');
function csv(cab: string[], linhas: (string | number)[][]): string {
  const cel = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cab, ...linhas].map((l) => l.map(cel).join(';')).join('\n') + '\n';
}
export const TABELAS_CSV = ['atendentes', 'expediente', 'deixou-passar', 'profissionais', 'servicos', 'clientes', 'fila'] as const;
export type TabelaCsv = (typeof TABELAS_CSV)[number];

export function desempenhoCsv(t: TabelaCsv, d: Desempenho, fila: ItemFila[]): string {
  switch (t) {
    case 'atendentes':
      return csv(
        ['Atendente', 'Conversas', 'Mensagens', '1ª resposta média (min)', '1ª resposta mediana (min)', 'Resposta na conversa (min)', 'Até agendar médio (min)', 'Agendamentos', 'Com valor', 'Sem valor', 'Valor (R$)', 'Comparecimentos', 'Conversão (%)', 'Ligações', 'Horas ativas', 'Pico de agendamento', 'Sem resposta', 'IA assumiu', 'Perdidos', 'Lembretes não feitos'],
        d.atendentes.map((a) => [a.nome, a.conversas, a.mensagens, minutos(a.primeiraResposta.mediaMs), minutos(a.primeiraResposta.medianaMs), minutos(a.respostaConversa.mediaMs), minutos(a.ateAgendar.mediaMs), a.agendamentos, a.comValor, a.semValor, dinheiro(a.valor), a.comparecimentos, String(a.conversao).replace('.', ','), a.ligacoes, String(a.horasAtivas).replace('.', ','), a.picoAgendamento ? `${DIAS[a.picoAgendamento.diaSemana]} ${a.picoAgendamento.hora}h` : '', a.deixouPassar.semResposta, a.deixouPassar.iaAssumiu, a.deixouPassar.perdidos.length, a.deixouPassar.lembretesNaoFeitos.length]),
      );
    case 'expediente':
      return csv(['Atendente', 'Dia', 'Começou', 'Terminou', 'Horas no ar', 'Horas ativas', 'Ações'], d.atendentes.flatMap((a) => a.expediente.map((x) => [a.nome, x.dia, x.inicio, x.fim, String(Math.round(x.spanMin / 6) / 10).replace('.', ','), String(Math.round(x.ativoMin / 6) / 10).replace('.', ','), x.acoes])));
    case 'deixou-passar':
      return csv(
        ['Atendente', 'Tipo', 'Cliente', 'Quando', 'Detalhe'],
        d.atendentes.flatMap((a) => [
          ...a.deixouPassar.esperas.map((x) => [a.nome, 'Esperou demais', x.cliente, x.desde, `${x.esperaMin} min${x.respondeu ? ` (respondeu: ${x.respondeu === 'ia' ? 'IA' : 'equipe'})` : ' (ainda esperando)'}`]),
          ...a.deixouPassar.perdidos.map((x) => [a.nome, 'Lead perdido', x.cliente, x.em, x.motivo]),
          ...a.deixouPassar.lembretesNaoFeitos.map((x) => [a.nome, 'Ligação não feita', x.cliente, x.quando, x.texto]),
        ]),
      );
    case 'profissionais':
      return csv(['Profissional', 'Agendamentos', 'Valor (R$)', 'Comparecimentos'], d.profissionais.map((p) => [p.nome, p.agendamentos, dinheiro(p.valor), p.comparecimentos]));
    case 'servicos':
      return csv(['Serviço', 'Agendamentos', 'Compareceram', 'Valor (R$)'], d.servicos.map((s) => [s.servico, s.agendamentos, s.compareceram, dinheiro(s.valor)]));
    case 'clientes':
      return csv(['Cliente', 'Agendamentos', 'Valor (R$)'], d.clientes.map((c) => [c.cliente, c.agendamentos, dinheiro(c.valor)]));
    case 'fila':
      return csv(['Cliente', 'Telefone', 'Unidade', 'Dona', 'Esperando desde', 'Espera (min)'], fila.map((f) => [f.cliente, f.telefone, f.unidade, f.dona ?? 'Sem dona', f.desde, f.esperaMin]));
  }
}

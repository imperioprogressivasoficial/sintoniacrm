import type { EscopoVisao } from '../auth/acesso.js';
import type { ArmazemComercial } from '../comercial/armazem.js';
import { metaDaEquipe } from '../comercial/calculo.js';
import type { FonteComercial } from '../comercial/fonte.js';
import { unidadeDe } from '../unidades.js';
import { bahia, dataISO, DIA, horaHHmm, partesBahia } from '../util/tempo.js';
import { porCoorte, porDia, preparar, resumoPeriodo, somarDias, type FiltrosDia } from './calculo.js';
import {
  chaveDestino,
  NOME_RELATORIO,
  podeEnviar,
  RELATORIOS,
  vezDoRelatorio,
  type ArmazemEnvioRelatorio,
  type ConfigEnvio,
  type Destinatario,
  type TipoRelatorio,
} from './envio.js';
import type { FonteRelatorioDia } from './fonte.js';
import { mesBr, textoAgenda, textoFechamento, textoPeriodo, type MetaInfo } from './textos.js';

/**
 * relatorio-dia: junta fonte + cálculo para a tela (Análises › Dia a dia) e monta/envia os relatórios automáticos.
 * O relógio de 30 s do index chama `tick()`; com vários processos, a chave única do registro garante uma vez só.
 */
export interface ItemAgendaHoje {
  conversaId: string;
  inicio: Date;
  cliente: string | null;
  servico: string | null;
  marcadoEm: Date;
}

export interface DepRelatorioDia {
  fonte: FonteRelatorioDia;
  armazem: ArmazemEnvioRelatorio;
  armazemComercial?: ArmazemComercial;
  /** Atendimento da equipe (1ª resposta) para o fechamento. */
  comercial?: FonteComercial;
  /** Origem de cada conversa (anúncio, link, ficha…); sem = "WhatsApp". */
  origens?: (empresaId: string, ids: string[]) => Promise<Map<string, string>>;
  /** Horários marcados pela Sintonia em [inicio, fim) (src/agenda/agenda-dia.ts). */
  agendaEntre?: (inicio: Date, fim: Date, escopo: EscopoVisao) => Promise<ItemAgendaHoje[]>;
  /** Envia o texto ao grupo (id do grupo) ou número, pelo número da unidade escolhida. Erro = falhou. */
  enviar: (d: Pick<Destinatario, 'tipo' | 'destino'>, texto: string, unidadeEnvio: string | null) => Promise<void>;
  empresaId: string;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export interface FiltrosTela {
  dia: string;
  dias: number;
  unidade?: string;
  atendente?: string;
  quem?: 'ia' | 'equipe';
  origem?: string;
}

const MAX_EXTRA = 10_000;

export class RelatorioDia {
  constructor(private readonly d: DepRelatorioDia) {}
  private agora() {
    return this.d.agora?.() ?? new Date();
  }

  /** Carrega de `inicioDia` a `fimDia` (dias da Bahia) e classifica. */
  async preparado(escopo: EscopoVisao, inicioDia: string, fimDia: string, f: Omit<FiltrosDia, 'origens' | 'unidades' | 'donaOuSemDona'> = {}) {
    const inicio = bahia(...partes(inicioDia));
    const fim = new Date(bahia(...partes(fimDia)).getTime() + DIA);
    const dados = await this.d.fonte.carregar(inicio, fim, escopo);
    const ids = [...new Set([...dados.chegadas.map((c) => c.conversaId), ...dados.retomadas.map((r) => r.conversaId), ...dados.agendamentos.filter((a) => a.em >= inicio).map((a) => a.conversaId)])].slice(0, MAX_EXTRA);
    const empresaId = escopo.empresaId ?? this.d.empresaId;
    const importadas = new Set(dados.chegadas.filter((c) => c.tipo === 'lead_importado').map((c) => c.conversaId));
    const achadas = this.d.origens ? await this.d.origens(empresaId, ids).catch(() => new Map<string, string>()) : new Map<string, string>();
    for (const id of importadas) if (!achadas.has(id)) achadas.set(id, 'Importação');
    const p = preparar(dados, { ...f, origens: achadas, ...(escopo.unidades ? { unidades: escopo.unidades } : {}), ...(escopo.donaOuSemDona ? { donaOuSemDona: escopo.donaOuSemDona } : {}) });
    return { p, origens: [...new Set(achadas.values())].sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  }

  /** A tela "Dia a dia": o dia escolhido (visão a), o grupo de leads dos últimos dias (visão b) e o geral. */
  async tela(escopo: EscopoVisao, f: FiltrosTela) {
    const hoje = dataISO(this.agora());
    const dia = f.dia > hoje ? hoje : f.dia;
    const dias = Math.max(3, Math.min(60, f.dias));
    const inicioDia = somarDias(dia, -(dias - 1));
    const { p, origens } = await this.preparado(escopo, inicioDia, dia, { atendente: f.atendente, quem: f.quem, origem: f.origem });
    const lista = Array.from({ length: dias }, (_, i) => somarDias(dia, -i));
    return {
      dia,
      hoje,
      inicio: inicioDia,
      dias,
      relatorio: porDia(p, dia),
      coorte: porCoorte(p, lista, dia),
      geral: resumoPeriodo(p, inicioDia, dia),
      origens,
    };
  }

  // ---------------------------------------------------------------- metas

  private async metaMes(empresaId: string, unidade: string | null): Promise<number | null> {
    if (!this.d.armazemComercial) return null;
    const { cfg } = await this.d.armazemComercial.ler(empresaId).catch(() => ({ cfg: null }));
    if (!cfg) return null;
    const m = unidade ? cfg.metas.unidades[unidade] : metaDaEquipe(cfg);
    return m?.agendamentos ?? null;
  }

  private async metaInfo(empresaId: string, unidade: string | null, contados: { dia: string }[], dia: string, fechados: number): Promise<MetaInfo> {
    const [a, m] = dia.split('-').map(Number);
    const mes = dia.slice(0, 7);
    return {
      mes: await this.metaMes(empresaId, unidade),
      feitosMes: contados.filter((x) => x.dia.startsWith(mes) && x.dia <= dia).length,
      feitosDia: contados.filter((x) => x.dia === dia).length,
      diasMes: new Date(Date.UTC(a!, m!, 0)).getUTCDate(),
      diaAtual: fechados,
    };
  }

  private async parados(escopo: EscopoVisao, agora: Date) {
    const l = await this.d.fonte.parados(escopo, agora).catch(() => []);
    return { total: l.length, maisAntigoMs: l.length ? agora.getTime() - l[0]!.desde.getTime() : null };
  }

  // ---------------------------------------------------------------- textos

  /** O texto exato do relatório `rel` se ele saísse agora. */
  async texto(rel: TipoRelatorio, cfg: ConfigEnvio, agora = this.agora()): Promise<string> {
    const empresaId = this.d.empresaId;
    const unidade = cfg.unidade;
    const escopo: EscopoVisao = { empresaId, ...(unidade ? { unidades: [unidade] } : {}) };
    const unidadeNome = unidade ? unidadeDe(unidade).nome : null;
    const hoje = dataISO(agora);
    const diaMes = partesBahia(agora).dia;
    const inicioMes = hoje.slice(0, 8) + '01';
    if (rel === 'fechamento') {
      const ini = [somarDias(hoje, -7), inicioMes].sort()[0]!;
      const { p } = await this.preparado(escopo, ini, hoje);
      const ag7 = p.agendamentos.filter((a) => a.dia >= somarDias(hoje, -7) && a.dia < hoje).length;
      let atendimento: { conversas: number; primeiraMs: number | null } | null = null;
      if (this.d.comercial) {
        const at = (await this.d.comercial.carregar(bahia(...partes(hoje)), agora, escopo).catch(() => null))?.atendimento ?? [];
        const soma = at.reduce((s, x) => ({ c: s.c + x.conversas, ms: s.ms + x.primeiraMs, n: s.n + x.primeiraN }), { c: 0, ms: 0, n: 0 });
        atendimento = { conversas: soma.c, primeiraMs: soma.n ? soma.ms / soma.n : null };
      }
      return textoFechamento({
        rel: porDia(p, hoje),
        unidadeNome,
        meta: await this.metaInfo(empresaId, unidade, p.agendamentos, hoje, diaMes),
        parados: await this.parados(escopo, agora),
        atendimento,
        media7: ag7 / 7,
      });
    }
    if (rel === 'agenda') {
      const ontem = somarDias(hoje, -1);
      const ini = [somarDias(ontem, -7), inicioMes].sort()[0]!;
      const { p } = await this.preparado(escopo, ini, ontem);
      const ag7 = p.agendamentos.filter((a) => a.dia >= somarDias(ontem, -7) && a.dia < ontem).length;
      const inicio = bahia(...partes(hoje));
      const itens = this.d.agendaEntre ? await this.d.agendaEntre(inicio, new Date(inicio.getTime() + DIA), escopo).catch(() => []) : [];
      // Remarcação deixa o horário antigo nos eventos: fica o último marcado de cada cliente.
      const porConversa = new Map<string, ItemAgendaHoje>();
      for (const i of itens) {
        const x = porConversa.get(i.conversaId);
        if (!x || i.marcadoEm > x.marcadoEm) porConversa.set(i.conversaId, i);
      }
      const agenda = [...porConversa.values()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime()).map((i) => ({ hora: horaHHmm(i.inicio), cliente: i.cliente, servico: i.servico }));
      const meta = await this.metaInfo(empresaId, unidade, p.agendamentos.filter((a) => a.dia.startsWith(hoje.slice(0, 7))), ontem.startsWith(hoje.slice(0, 7)) ? ontem : hoje, diaMes - 1);
      return textoAgenda({ dia: hoje, unidadeNome, agenda, ontem: porDia(p, ontem), meta: { ...meta, feitosDia: 0 }, parados: await this.parados(escopo, agora), media7: ag7 / 7 });
    }
    if (rel === 'semanal') {
      const fim = somarDias(hoje, -1);
      const ini = somarDias(hoje, -7);
      const { p } = await this.preparado(escopo, [somarDias(hoje, -14), inicioMes].sort()[0]!, fim);
      const geral = resumoPeriodo(p, ini, fim);
      const anterior = resumoPeriodo(p, somarDias(hoje, -14), somarDias(hoje, -8));
      const meta = await this.metaInfo(empresaId, unidade, p.agendamentos.filter((a) => a.dia.startsWith(hoje.slice(0, 7))), fim.startsWith(hoje.slice(0, 7)) ? fim : hoje, diaMes - 1);
      return textoPeriodo({ titulo: `Resumo da semana · ${br(ini)} a ${br(fim)}`, unidadeNome, geral, anterior, meta, parados: await this.parados(escopo, agora) });
    }
    // mensal: o mês que acabou (o anterior ao de hoje).
    const [a, m] = hoje.split('-').map(Number);
    const mesRef = m === 1 ? `${a! - 1}-12` : `${a}-${String(m! - 1).padStart(2, '0')}`;
    const [ra, rm] = mesRef.split('-').map(Number);
    const inicioRef = `${mesRef}-01`;
    const diasRef = new Date(Date.UTC(ra!, rm!, 0)).getUTCDate();
    const fimRef = `${mesRef}-${String(diasRef).padStart(2, '0')}`;
    const inicioAnt = rm === 1 ? `${ra! - 1}-12-01` : `${ra}-${String(rm! - 1).padStart(2, '0')}-01`;
    const { p } = await this.preparado(escopo, inicioAnt, fimRef);
    const geral = resumoPeriodo(p, inicioRef, fimRef);
    const anterior = resumoPeriodo(p, inicioAnt, somarDias(inicioRef, -1));
    const metaMes = await this.metaMes(empresaId, unidade);
    const meta: MetaInfo | null = metaMes ? { mes: metaMes, feitosMes: geral.agendamentos, feitosDia: 0, diasMes: diasRef, diaAtual: diasRef } : null;
    const frase = metaMes
      ? geral.agendamentos >= metaMes
        ? `Batemos a meta do mês (${Math.round((geral.agendamentos / metaMes) * 100)}%). Parabéns, time!`
        : `Fechamos o mês em ${Math.round((geral.agendamentos / metaMes) * 100)}% da meta: faltaram ${metaMes - geral.agendamentos} agendamentos. Bora virar no próximo!`
      : undefined;
    return textoPeriodo({ titulo: `Fechamento do mês · ${mesBr(mesRef)}`, unidadeNome, geral, anterior, meta, frase });
  }

  // ---------------------------------------------------------------- envio

  /** Rodada do relógio: manda o que está na hora, uma vez só por destinatário. */
  async tick(): Promise<{ enviados: number; falhas: number }> {
    const agora = this.agora();
    const empresaId = this.d.empresaId;
    const { cfg } = await this.d.armazem.lerConfig(empresaId);
    let enviados = 0;
    let falhas = 0;
    if (!cfg.ligado) return { enviados, falhas };
    for (const rel of RELATORIOS) {
      const vez = vezDoRelatorio(rel, cfg, agora);
      if (!vez || !podeEnviar(agora, vez.marcado)) continue;
      const dest = cfg.destinatarios.filter((x) => x.relatorios.includes(rel));
      if (!dest.length) continue;
      const ja = await this.d.armazem.registrados(empresaId, rel, vez.referencia);
      let texto: string | undefined;
      for (const x of dest) {
        const chave = chaveDestino(x);
        const situacao = ja.get(chave);
        if (situacao && situacao !== 'falhou') continue;
        try {
          texto ??= await this.texto(rel, cfg, agora);
        } catch (e) {
          this.d.log?.(`Relatório automático: não deu para montar "${NOME_RELATORIO[rel]}"`, String(e));
          break;
        }
        const id = situacao === 'falhou'
          ? await this.d.armazem.retomarFalha(empresaId, rel, vez.referencia, chave, agora)
          : await this.d.armazem.reservar({ empresaId, relatorio: rel, referencia: vez.referencia, destino: chave, destinoNome: x.nome || null, texto, agora });
        if (!id) continue;
        const r = await this.mandar(id, x, texto, cfg.unidadeEnvio);
        if (r) enviados++;
        else falhas++;
      }
    }
    return { enviados, falhas };
  }

  private async mandar(id: string, x: Pick<Destinatario, 'tipo' | 'destino'>, texto: string, unidadeEnvio: string | null): Promise<boolean> {
    try {
      await this.d.enviar(x, texto, unidadeEnvio);
      await this.d.armazem.concluir(id, 'enviado', null, this.agora());
      return true;
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      this.d.log?.('Relatório automático: falha no envio', msg);
      await this.d.armazem.concluir(id, 'falhou', msg, this.agora()).catch(() => undefined);
      return false;
    }
  }

  /** "Enviar teste para mim": sai na hora (é pedido da pessoa), uma vez por minuto por relatório. */
  async enviarTeste(rel: TipoRelatorio, telefone: string, nome: string, cfg?: ConfigEnvio): Promise<{ texto: string; enviado: boolean; erro: string | null }> {
    const agora = this.agora();
    const c = cfg ?? (await this.d.armazem.lerConfig(this.d.empresaId)).cfg;
    const texto = await this.texto(rel, c, agora);
    const destino = { tipo: 'numero' as const, destino: telefone };
    const id = await this.d.armazem.reservar({ empresaId: this.d.empresaId, relatorio: 'teste', referencia: `${rel}:${agora.toISOString().slice(0, 16)}`, destino: chaveDestino(destino), destinoNome: nome, texto, agora });
    if (!id) return { texto, enviado: false, erro: 'O teste já saiu agora há pouco. Espere um minuto.' };
    try {
      await this.d.enviar(destino, `_Teste_\n${texto}`, c.unidadeEnvio);
      await this.d.armazem.concluir(id, 'enviado', null, this.agora());
      return { texto, enviado: true, erro: null };
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      await this.d.armazem.concluir(id, 'falhou', msg, this.agora()).catch(() => undefined);
      return { texto, enviado: false, erro: msg };
    }
  }
}

const partes = (dia: string): [number, number, number] => {
  const [a, m, d] = dia.split('-').map(Number);
  return [a!, m!, d!];
};
const br = (dia: string) => dia.slice(8, 10) + '/' + dia.slice(5, 7);

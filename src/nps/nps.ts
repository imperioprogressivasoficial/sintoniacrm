import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Conversa, UnidadeId } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { unidadeDe } from '../unidades.js';
import { dataISO, HORA } from '../util/tempo.js';
import type { ArmazemNps } from './armazem.js';
import {
  calcularNps,
  categoria,
  ConfigNps,
  MOTIVOS_FINALIZACAO,
  NOME_MOTIVO,
  lerNota,
  normalizarConfigNps,
  preencherNps,
  type Finalizacao,
  type MotivoFinalizacao,
  type Pesquisa,
} from './tipos.js';

/**
 * Finalizar atendimento + pesquisa de satisfação (NPS).
 *
 * - finalizar(): grava o atendimento finalizado (motivo, quem atendeu) e, se a pesquisa estiver ligada para o motivo,
 *   manda a pergunta pelo WhatsApp. Dispara o gatilho "atendimento finalizado" das automações.
 * - mensagemCliente(): gancho da Sintonia (SOB a trava da conversa). Com pesquisa aberta, lê a nota da mensagem
 *   ("10", "nota 9", "9/10"…), pede o comentário e agradece. A resposta automática marca a conversa como respondida,
 *   então a IA não responde de novo ao "10". Dispara o gatilho "nota NPS recebida".
 * - Nota baixa (0–6) vira evento "nps" e o Notificador avisa a gestão.
 */

export interface SintoniaParaNps {
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined>;
  enviarAutomatico(c: Conversa, texto: string, autorNome: string): Promise<string>;
}

/** O que as automações oferecem (src/automacoes): os dois gatilhos novos. */
export interface AutomacoesParaNps {
  aoFinalizar(c: Conversa, f: { id: string; motivo: MotivoFinalizacao }): Promise<void>;
  aoNotaNps(c: Conversa, p: { id: string; nota: number }): Promise<void>;
}

export interface OpcoesNps {
  empresaId: string;
  armazem: ArmazemNps;
  repo: Repositorio;
  sintonia: () => SintoniaParaNps;
  /** Pode ser preenchida depois (as automações nascem antes da Sintonia). */
  automacoes?: () => AutomacoesParaNps | undefined;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export class ErroNps extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404,
  ) {
    super(message);
  }
}

export const DadosFinalizar = z.object({
  motivo: z.enum(MOTIVOS_FINALIZACAO),
  observacao: z.string().trim().max(500).optional(),
  /** Ausente: segue a configuração (ligada e o motivo na lista). false: não manda nesta vez. */
  enviarPesquisa: z.boolean().optional(),
});

export interface FiltroResumo {
  inicio: Date;
  fim: Date;
  unidades?: string[];
  unidade?: string;
  atendente?: string;
}

const AUTOR = 'Pesquisa de satisfação';
/** Depois da nota, quanto tempo esperamos o comentário. */
const PRAZO_COMENTARIO = 24 * HORA;

export class Nps {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private cache?: { cfg: ConfigNps; ate: number };

  constructor(private readonly o: OpcoesNps) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  // ------------------------------------------------------------ configuração

  async config(): Promise<ConfigNps> {
    if (this.cache && this.cache.ate > Date.now()) return this.cache.cfg;
    const cfg = normalizarConfigNps(await this.o.armazem.lerConfig(this.o.empresaId));
    this.cache = { cfg, ate: Date.now() + 5000 };
    return cfg;
  }

  async salvarConfig(bruto: unknown, por: string): Promise<ConfigNps> {
    const atual = await this.config();
    const cfg = ConfigNps.parse({ ...atual, ...(bruto && typeof bruto === 'object' ? bruto : {}) });
    await this.o.armazem.gravarConfig(this.o.empresaId, cfg, por);
    this.cache = undefined;
    return cfg;
  }

  /** Variáveis que as automações podem usar ({link_avaliacao}). */
  async variaveis(): Promise<Record<string, string>> {
    const cfg = await this.config().catch(() => undefined);
    return { link_avaliacao: cfg?.linkAvaliacao ?? '' };
  }

  // ------------------------------------------------------------ finalizar

  async finalizar(conversaId: string, bruto: unknown, por: { id?: string; nome: string }): Promise<{ finalizacao: Finalizacao; pesquisa: Pesquisa | null; aviso: string | null }> {
    const d = DadosFinalizar.parse(bruto);
    const cfg = await this.config();
    const r = await this.o.sintonia().comConversa(conversaId, async (c) => {
      if (c.empresaId !== this.o.empresaId) return undefined;
      const agora = this.agora();
      const atendente = c.responsavelId ? { id: c.responsavelId, nome: c.responsavelNome ?? null } : { id: por.id ?? null, nome: por.nome };
      const finalizacao: Finalizacao = {
        id: randomUUID(),
        empresaId: this.o.empresaId,
        conversaId: c.id,
        unidade: c.unidade,
        motivo: d.motivo,
        observacao: d.observacao || null,
        atendenteId: atendente.id,
        atendenteNome: atendente.nome,
        porId: por.id ?? null,
        porNome: por.nome,
        em: agora,
      };
      // Uma pesquisa antiga sem resposta não concorre com a nova.
      await this.o.armazem.fecharAbertas(c.id, 'expirada', 'outro atendimento foi finalizado');
      await this.o.armazem.salvarFinalizacao(finalizacao);

      let pesquisa: Pesquisa | null = null;
      let aviso: string | null = null;
      const enviar = cfg.ligada && (d.enviarPesquisa ?? cfg.motivos.includes(d.motivo));
      if (d.enviarPesquisa && !cfg.ligada) aviso = 'A pesquisa de satisfação está desligada (Automações › Prontos para usar).';
      if (enviar) {
        pesquisa = {
          id: randomUUID(),
          empresaId: this.o.empresaId,
          conversaId: c.id,
          finalizacaoId: finalizacao.id,
          unidade: c.unidade,
          atendenteId: atendente.id,
          atendenteNome: atendente.nome,
          motivo: d.motivo,
          estado: 'aguardando_nota',
          enviadaEm: agora,
          expiraEm: new Date(agora.getTime() + cfg.validadeHoras * HORA),
          nota: null,
          comentario: null,
          respondidaEm: null,
          detalhe: null,
        };
        try {
          await this.o.sintonia().enviarAutomatico(c, this.texto(cfg.pergunta, c), AUTOR);
          await this.o.repo.salvarConversa(c);
        } catch (e) {
          pesquisa.estado = 'nao_enviada';
          pesquisa.detalhe = String((e as Error)?.message ?? e).slice(0, 300);
          aviso = `A pesquisa não foi enviada: ${pesquisa.detalhe}`;
        }
        await this.o.armazem.salvarPesquisa(pesquisa);
      }
      await this.o.repo.registrarEvento({
        tipo: 'atendimento_finalizado',
        conversaId: c.id,
        unidade: c.unidade,
        em: agora,
        dados: {
          finalizacaoId: finalizacao.id,
          motivo: d.motivo,
          motivoNome: NOME_MOTIVO[d.motivo],
          porId: por.id ?? null,
          porNome: por.nome,
          atendenteId: atendente.id,
          atendenteNome: atendente.nome,
          pesquisa: pesquisa ? pesquisa.estado : null,
        },
      });
      return { c, finalizacao, pesquisa, aviso };
    });
    if (!r) throw new ErroNps('Conversa não encontrada.', 404);
    await this.o
      .automacoes?.()
      ?.aoFinalizar(r.c, { id: r.finalizacao.id, motivo: r.finalizacao.motivo })
      .catch((e) => this.log('Falha no gatilho "atendimento finalizado"', String(e)));
    return { finalizacao: r.finalizacao, pesquisa: r.pesquisa, aviso: r.aviso };
  }

  // ------------------------------------------------------------ resposta da cliente (sob a trava)

  /** Gancho mensagemCliente: lê a nota ou o comentário da pesquisa aberta. Já está SOB a trava da conversa. */
  async mensagemCliente(c: Conversa, m: { texto: string }): Promise<void> {
    const p = await this.o.armazem.aberta(c.id);
    if (!p) return;
    const agora = this.agora();
    if (p.expiraEm.getTime() <= agora.getTime()) {
      await this.o.armazem.vencer(this.o.empresaId, agora);
      return;
    }
    const cfg = await this.config();
    const texto = String(m.texto ?? '').trim();

    if (p.estado === 'aguardando_nota') {
      const lida = lerNota(texto);
      if (!lida) return; // não é a nota: a conversa segue normal (IA ou equipe respondem)
      p.nota = lida.nota;
      p.respondidaEm = agora;
      let resposta: string;
      if (lida.comentario || !cfg.pedirComentario) {
        p.estado = 'respondida';
        p.comentario = lida.comentario;
        resposta = cfg.agradecimento;
      } else {
        p.estado = 'aguardando_comentario';
        p.expiraEm = new Date(agora.getTime() + PRAZO_COMENTARIO);
        resposta = cfg.textoComentario;
      }
      await this.o.armazem.salvarPesquisa(p);
      await this.responder(c, resposta);
      await this.o.repo.registrarEvento({
        tipo: 'nps',
        conversaId: c.id,
        unidade: c.unidade,
        em: agora,
        dados: { pesquisaId: p.id, nota: p.nota, categoria: categoria(p.nota), atendenteId: p.atendenteId, atendenteNome: p.atendenteNome, motivo: p.motivo, comentario: p.comentario },
      });
      await this.o
        .automacoes?.()
        ?.aoNotaNps(c, { id: p.id, nota: p.nota })
        .catch((e) => this.log('Falha no gatilho "nota NPS"', String(e)));
      return;
    }

    // Esperando o comentário. Pergunta nova ("?") não é comentário: fecha sem comentário e a conversa segue normal.
    if (!texto || texto.includes('?')) {
      await this.o.armazem.fecharAbertas(c.id, 'respondida', 'sem comentário');
      return;
    }
    p.comentario = texto.slice(0, 1000);
    p.estado = 'respondida';
    p.detalhe = null;
    await this.o.armazem.salvarPesquisa(p);
    await this.responder(c, cfg.agradecimento);
  }

  private texto(molde: string, c: Conversa): string {
    return preencherNps(molde, { nome: c.nome, atendente: c.responsavelNome, unidade: unidadeDe(c.unidade)?.nome ?? c.unidade });
  }

  private async responder(c: Conversa, molde: string): Promise<void> {
    if (!molde.trim()) return;
    try {
      await this.o.sintonia().enviarAutomatico(c, this.texto(molde, c), AUTOR);
      await this.o.repo.salvarConversa(c);
    } catch (e) {
      this.log('Falha ao responder a pesquisa de satisfação', String(e));
    }
  }

  // ------------------------------------------------------------ relógio

  /** Pesquisas sem resposta no prazo viram "expirada". */
  async tick(): Promise<number> {
    return this.o.armazem.vencer(this.o.empresaId, this.agora());
  }

  // ------------------------------------------------------------ leitura

  async daConversa(conversaId: string) {
    const [finalizacoes, pesquisas] = await Promise.all([this.o.armazem.finalizacoesDa(conversaId, 10), this.o.armazem.pesquisasDa(conversaId, 10)]);
    return { finalizacoes, pesquisas };
  }

  /** Resultado do período: NPS geral, por atendente, por dia, distribuição das notas e comentários. */
  async resumo(f: FiltroResumo) {
    const dentro = (d: Date | null) => Boolean(d && d.getTime() >= f.inicio.getTime() && d.getTime() < f.fim.getTime());
    const vale = (x: { unidade: string; atendenteId: string | null }) =>
      (!f.unidades || f.unidades.includes(x.unidade)) && (!f.unidade || x.unidade === f.unidade) && (!f.atendente || x.atendenteId === f.atendente);
    const [todas, finalizacoesTodas] = await Promise.all([
      this.o.armazem.pesquisasEntre(this.o.empresaId, f.inicio, f.fim),
      this.o.armazem.finalizacoesEntre(this.o.empresaId, f.inicio, f.fim),
    ]);
    const pesquisas = todas.filter(vale);
    const finalizacoes = finalizacoesTodas.filter(vale);
    const enviadas = pesquisas.filter((p) => dentro(p.enviadaEm) && p.estado !== 'nao_enviada');
    const respostas = pesquisas.filter((p) => p.nota !== null && dentro(p.respondidaEm));
    const geral = calcularNps(respostas.map((p) => p.nota!));
    const respondidasDasEnviadas = enviadas.filter((p) => p.nota !== null).length;

    const porAtendente = new Map<string, { id: string | null; nome: string; notas: number[] }>();
    for (const p of respostas) {
      const k = p.atendenteId ?? `nome:${p.atendenteNome ?? ''}`;
      const a = porAtendente.get(k) ?? { id: p.atendenteId, nome: p.atendenteNome || 'Sem atendente', notas: [] };
      a.notas.push(p.nota!);
      porAtendente.set(k, a);
    }
    const porDia = new Map<string, number[]>();
    for (const p of respostas) {
      const dia = dataISO(p.respondidaEm!);
      porDia.set(dia, [...(porDia.get(dia) ?? []), p.nota!]);
    }
    const distribuicao = Array.from({ length: 11 }, (_, n) => respostas.filter((p) => p.nota === n).length);
    const porMotivo = MOTIVOS_FINALIZACAO.map((m) => ({ motivo: m, nome: NOME_MOTIVO[m], total: finalizacoes.filter((x) => x.motivo === m).length })).filter((x) => x.total);

    const comComentario = respostas
      .filter((p) => p.comentario)
      .sort((a, b) => b.respondidaEm!.getTime() - a.respondidaEm!.getTime())
      .slice(0, 20);
    const nomes = new Map<string, string | undefined>();
    for (const p of comComentario) if (!nomes.has(p.conversaId)) nomes.set(p.conversaId, (await this.o.repo.buscarConversa(p.conversaId).catch(() => undefined))?.nome);

    return {
      inicio: f.inicio.toISOString(),
      fim: f.fim.toISOString(),
      ...geral,
      enviadas: enviadas.length,
      taxaResposta: enviadas.length ? Math.round((respondidasDasEnviadas / enviadas.length) * 1000) / 10 : null,
      finalizados: finalizacoes.length,
      porMotivo,
      distribuicao,
      porAtendente: [...porAtendente.values()]
        .map((a) => ({ id: a.id, nome: a.nome, ...calcularNps(a.notas), media: Math.round((a.notas.reduce((s, n) => s + n, 0) / a.notas.length) * 10) / 10 }))
        .sort((a, b) => (b.nps ?? -999) - (a.nps ?? -999) || b.total - a.total),
      porDia: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, notas]) => ({ dia, ...calcularNps(notas) })),
      comentarios: comComentario.map((p) => ({
        conversaId: p.conversaId,
        cliente: nomes.get(p.conversaId) ?? null,
        nota: p.nota,
        categoria: categoria(p.nota!),
        comentario: p.comentario,
        atendente: p.atendenteNome,
        em: p.respondidaEm!.toISOString(),
      })),
    };
  }
}

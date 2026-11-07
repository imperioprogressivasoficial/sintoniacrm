import { readFile } from 'node:fs/promises';
import type { Contas, Usuario } from '../auth/contas.js';
import type { Automacoes } from '../automacoes/automacoes.js';
import type { ArmazemContatos, TipoCampo } from '../contatos/contatos.js';
import type { ArmazemRespostas } from '../conversa/respostas.js';
import type { Etapa } from '../domain.js';
import type { Empresa } from '../empresa/empresa.js';
import type { Funis } from '../funis/funis.js';
import type { ArmazemNotificacoes } from '../notificacoes/armazem.js';
import type { TipoNotificacao } from '../notificacoes/tipos.js';
import type { ArmazemTags, Tags } from '../tags/tags.js';
import { mesDe } from '../painel/painel.js';
import { DIA, HORA, MIN } from '../util/tempo.js';
import { UNIDADES } from '../unidades.js';
import type { ArmazemDemo, Registros } from './armazem.js';
import { ATENDENTES_DEMO, ehEmailDemo, POR_DEMO, RESPOSTAS_RAPIDAS_DEMO, SENHA_INUTILIZAVEL } from './dados.js';
import { contarPlano, gerarPlano, ligacoesDeHoje, type CampoRef, type ContextoGerador } from './gerador.js';

/**
 * Dados de demonstração: preencher (POST /api/demo/popular) e apagar (DELETE /api/demo).
 * Preencher de novo apaga a demonstração anterior antes (não duplica). Apagar remove só o que está registrado
 * como demonstração; o que a demonstração reaproveitou (uma tag ou campo que a empresa já tinha) nunca é apagado,
 * e o que ela criou mas passou a ser usado por dados reais (uma tag marcada numa conversa real) fica.
 */
export interface OpcoesDemo {
  empresaId: string;
  armazem: ArmazemDemo;
  contas: Contas;
  tags: Tags;
  armazemTags: ArmazemTags;
  funis: Funis;
  contatos: ArmazemContatos;
  respostas: ArmazemRespostas;
  automacoes: Automacoes;
  notificacoes: ArmazemNotificacoes;
  empresa: Empresa;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Quantas conversas (padrão 140). */
  quantidade?: number;
}

const TAGS_DEMO: Array<[string, string]> = [
  ['Progressiva', '#3E63DD'],
  ['Selagem', '#12A594'],
  ['Botox capilar', '#8E4EC6'],
  ['VIP', '#D4A017'],
  ['Instagram', '#D6409F'],
  ['Indicação', '#30A46C'],
  ['Tráfego pago', '#F76B15'],
  ['Gestante', '#E5484D'],
];
const CAMPOS_DEMO: Array<{ chave: 'tipoCabelo' | 'comoConheceu' | 'alergias'; nome: string; tipo: TipoCampo; opcoes: string[] }> = [
  { chave: 'tipoCabelo', nome: 'Tipo de cabelo', tipo: 'lista', opcoes: ['Liso', 'Ondulado', 'Cacheado', 'Crespo'] },
  { chave: 'comoConheceu', nome: 'Como conheceu', tipo: 'lista', opcoes: ['Instagram', 'Indicação', 'Google', 'Passou na loja', 'Tráfego pago'] },
  { chave: 'alergias', nome: 'Alergias', tipo: 'texto', opcoes: [] },
];
const ROSTOS = ['rosto-01.jpg', 'rosto-02.jpg', 'rosto-03.jpg', 'rosto-04.jpg'];

export class Demo {
  private fila: Promise<unknown> = Promise.resolve();
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  constructor(private readonly o: OpcoesDemo) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  /** Uma operação por vez (dois cliques em "Preencher" não criam duas demonstrações). */
  private emFila<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.fila.then(fn, fn);
    this.fila = r.catch(() => {});
    return r;
  }

  async estado() {
    const r = await this.o.armazem.registros(this.o.empresaId);
    const porTipo = Object.fromEntries(Object.entries(r).map(([t, l]) => [t, l.length]));
    const total = Object.values(r).reduce((s, l) => s + l.length, 0);
    return { existe: total > 0, total, porTipo };
  }

  conversasDemo(): Promise<Set<string>> {
    return this.o.armazem.conversasDemo(this.o.empresaId);
  }

  popular(quem: Pick<Usuario, 'id' | 'nome'>) {
    return this.emFila(async () => {
      const antes = (await this.estado()).existe ? await this.apagarAgora() : null;
      return { substituiu: Boolean(antes), ...(await this.popularAgora(quem)) };
    });
  }

  apagar() {
    return this.emFila(() => this.apagarAgora());
  }

  // ---------------------------------------------------------------- preencher

  private async popularAgora(quem: Pick<Usuario, 'id' | 'nome'>) {
    const { o } = this;
    const E = o.empresaId;
    const agora = this.agora();
    const reg = (tipo: Parameters<ArmazemDemo['registrar']>[1], chaves: string[]) => o.armazem.registrar(E, tipo, chaves);

    // Funil do sistema e suas etapas.
    const sistema = await o.funis.garantirSistema();
    const etapasSistema = Object.fromEntries((await o.funis.etapas(sistema.id)).filter((t) => t.chaveSistema).map((t) => [t.chaveSistema!, t.id])) as Record<Etapa, string>;

    // Atendentes (papel atendente, senha que não confere: ninguém entra com elas), com rosto.
    const atendentes: ContextoGerador['atendentes'] = [];
    for (const [i, a] of ATENDENTES_DEMO.entries()) {
      const ja = await o.contas.buscarPorEmail(a.email);
      const u = ja && ehEmailDemo(ja.email) ? ja : await o.contas.criarUsuario({ empresaId: E, nome: a.nome, email: a.email, papel: 'atendente', unidades: [a.unidade], senhaHash: SENHA_INUTILIZAVEL });
      await reg('usuario', [u.id]);
      atendentes.push({ id: u.id, nome: u.nome, unidade: a.unidade, ritmo: a.ritmo });
      try {
        const conteudo = await readFile(new URL(`./rostos/${ROSTOS[i % ROSTOS.length]}`, import.meta.url));
        await o.contas.salvarFotoDe(u.id, { conteudo, tipo: 'image/jpeg' }, agora);
      } catch (e) {
        this.log('Demonstração: foto da atendente não carregou', String(e));
      }
    }

    // Tags soltas: reaproveita a que a empresa já tem com o mesmo nome (essa nunca é apagada).
    const tags: Record<string, string> = {};
    let tagsCriadas = 0;
    for (const [nome, cor] of TAGS_DEMO) {
      const existe = await o.tags.porNome(nome);
      if (existe) tags[nome] = existe.id;
      else {
        const t = await o.tags.criar({ nome, cor }, POR_DEMO);
        await reg('tag', [t.id]);
        tags[nome] = t.id;
        tagsCriadas++;
      }
    }

    // Funil "Pós-venda".
    const nomes = new Set((await o.funis.listar()).map((f) => f.nome.toLowerCase()));
    const nomeFunil = nomes.has('pós-venda') ? 'Pós-venda (demonstração)' : 'Pós-venda';
    const pv = await o.funis.criar({ nome: nomeFunil, etapas: [{ nome: 'Retorno 30 dias', cor: '#0090FF' }, { nome: 'Manutenção marcada', cor: '#8E4EC6' }, { nome: 'Fiel', cor: '#30A46C' }] }, POR_DEMO);
    await reg('funil', [pv.id]);
    const etapasPv = await o.funis.etapas(pv.id);
    const pid = (n: string) => etapasPv.find((e) => e.nome === n)!.id;

    // Campos da ficha.
    const campos: ContextoGerador['campos'] = {};
    let camposCriados = 0;
    const existentes = await o.contatos.campos(E);
    for (const c of CAMPOS_DEMO) {
      const ja = existentes.find((x) => x.nome.toLowerCase() === c.nome.toLowerCase());
      let ref: CampoRef;
      if (ja) ref = { id: ja.id, tipo: ja.tipo, opcoes: ja.opcoes };
      else {
        const novo = await o.contatos.criarCampo(E, { nome: c.nome, tipo: c.tipo, opcoes: c.opcoes });
        await reg('campo', [novo.id]);
        ref = { id: novo.id, tipo: novo.tipo, opcoes: novo.opcoes };
        camposCriados++;
      }
      campos[c.chave] = ref;
    }

    // Conversas, mensagens, eventos, etapas, tags e fichas.
    const ctx: ContextoGerador = {
      agora,
      empresaId: E,
      atendentes,
      sistema: { funilId: sistema.id, etapas: etapasSistema },
      posVenda: { funilId: pv.id, retorno: pid('Retorno 30 dias'), manutencao: pid('Manutenção marcada'), fiel: pid('Fiel') },
      tags,
      campos,
      quantidade: o.quantidade,
    };
    const plano = gerarPlano(ctx);
    ligacoesDeHoje(plano, ctx);
    await o.armazem.gravar(E, plano);

    // Respostas rápidas da empresa (atalho que já existe fica como está).
    const atalhos = new Set((await o.respostas.listar(E, null)).filter((r) => r.usuarioId === null).map((r) => r.atalho));
    let respostas = 0;
    for (const r of RESPOSTAS_RAPIDAS_DEMO) {
      if (atalhos.has(r.atalho)) continue;
      const nova = await o.respostas.criar(E, { atalho: r.atalho, texto: r.texto, usuarioId: null, criadaPor: POR_DEMO });
      await reg('resposta', [nova.id]);
      respostas++;
    }

    // Automações de exemplo, todas DESLIGADAS.
    const autos = [
      {
        nome: 'Exemplo: Interessada há 1 dia → mensagem',
        funilId: sistema.id,
        ligada: false,
        gatilho: { tipo: 'entrou_na_etapa', etapaId: etapasSistema.interessada },
        passos: [
          { tipo: 'esperar', minutos: 24 * 60 },
          { tipo: 'enviar_mensagem', texto: 'Oi, {primeiro_nome}! Ficou alguma dúvida sobre os valores? Tenho horários essa semana 💛', so_no_horario: true },
        ],
      },
      {
        nome: 'Exemplo: Compareceu → Pós-venda',
        funilId: sistema.id,
        ligada: false,
        gatilho: { tipo: 'entrou_na_etapa', etapaId: etapasSistema.compareceu },
        passos: [{ tipo: 'mover_etapa', funilId: pv.id, etapaId: pid('Retorno 30 dias') }],
      },
      {
        nome: 'Exemplo: palavra "endereço" → resposta',
        funilId: null,
        ligada: false,
        gatilho: { tipo: 'palavra_chave', palavras: ['endereço', 'onde fica', 'localização'], modo: 'contem' },
        passos: [{ tipo: 'enviar_mensagem', texto: 'Estamos na unidade {unidade} 📍 Te esperamos!', so_no_horario: false }],
      },
    ];
    for (const a of autos) {
      const criada = await o.automacoes.criar(a, POR_DEMO);
      await reg('automacao', [criada.id]);
    }

    // Notificações para quem preencheu (já "entregues": nenhum push sai).
    const conv = (etapa: Etapa, i = 0) => plano.conversas.filter((c) => c.etapa === etapa)[i];
    const notas: Array<{ tipo: TipoNotificacao; titulo: string; texto: string; conversaId?: string; vista?: string; ha: number; lida: boolean }> = [];
    const nova = [...plano.conversas].sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())[0];
    if (nova) notas.push({ tipo: 'nova_cliente', titulo: `Nova cliente: ${nova.nome}`, texto: `${UNIDADES[nova.unidade].nome} · Quanto tá a progressiva?`, conversaId: nova.id, ha: 25 * MIN, lida: false });
    const ag = conv('agendada');
    if (ag) notas.push({ tipo: 'agendamento', titulo: 'A IA agendou Progressiva', texto: `${ag.nome} · ${UNIDADES[ag.unidade].nome}`, conversaId: ag.id, ha: 2 * HORA, lida: false });
    const gest = plano.eventos.find((e) => e.tipo === 'passou_para_humano');
    const cg = gest && plano.conversas.find((c) => c.id === gest.conversaId);
    if (cg) notas.push({ tipo: 'ia_equipe', titulo: `A IA passou ${cg.nome} para a equipe`, texto: 'Motivo: cliente gestante, precisa da orientação da equipe', conversaId: cg.id, ha: 5 * HORA, lida: false });
    const it = conv('interessada', 1);
    if (it) notas.push({ tipo: 'lembrete_ligacao', titulo: `Ligar para ${it.nome}`, texto: 'Interessada e ainda não agendou', conversaId: it.id, ha: 20 * HORA, lida: true });
    const ag2 = conv('agendada', 1);
    if (ag2) notas.push({ tipo: 'agendamento', titulo: `${atendentes[0]?.nome.split(' ')[0] ?? 'A equipe'} agendou Selagem`, texto: `${ag2.nome} · ${UNIDADES[ag2.unidade].nome}`, conversaId: ag2.id, ha: DIA, lida: true });
    const em = conv('em_conversa', 2);
    if (em) notas.push({ tipo: 'espera', titulo: `${em.nome} está esperando`, texto: 'Sem resposta há 12 minutos.', conversaId: em.id, ha: 1.5 * DIA, lida: true });
    notas.push({ tipo: 'teste', titulo: 'Dados de demonstração prontos', texto: 'Conversas, CRM, Dashboard, Relatórios e Agenda preenchidos. Apague em Mais › Dados de demonstração.', ha: MIN, lida: false });
    const ids: string[] = [];
    for (const n of notas) {
      const quando = new Date(agora.getTime() - n.ha);
      const criada = await o.notificacoes.criar({
        usuarioId: quem.id,
        tipo: n.tipo,
        titulo: n.titulo,
        texto: n.texto,
        criadaEm: quando,
        entregueEm: quando,
        ...(n.conversaId ? { conversaId: n.conversaId } : {}),
        ...(n.vista ? { vista: n.vista } : {}),
      });
      if (n.lida) await o.notificacoes.marcarLida(quem.id, criada.id, quando);
      ids.push(criada.id);
    }
    await reg('notificacao', ids);

    // Meta do mês: só se a empresa ainda não definiu uma.
    let meta: number | null = null;
    if ((await o.empresa.meta()).agendamentosMes == null) {
      const m = mesDe(agora);
      const noMes = plano.eventos.filter((e) => (e.tipo === 'agendamento_ia' || e.tipo === 'agendamento_equipe') && e.em >= m.inicio).length;
      const ritmo = noMes / Math.max(1, m.diaDoMes);
      meta = Math.max(30, Math.ceil((ritmo * m.diasNoMes * 1.15) / 10) * 10);
      await o.empresa.alterarMeta({ agendamentosMes: meta }, POR_DEMO);
      await reg('meta', [String(meta)]);
    }

    const c = contarPlano(plano, agora);
    this.log('Demonstração preenchida', { conversas: c.conversas, mensagens: c.mensagens, eventos: c.eventos });
    return {
      ...c,
      atendentes: atendentes.length,
      tags: { criadas: tagsCriadas, reaproveitadas: TAGS_DEMO.length - tagsCriadas },
      funis: 1,
      campos: { criados: camposCriados, reaproveitados: CAMPOS_DEMO.length - camposCriados },
      respostasRapidas: respostas,
      automacoes: autos.length,
      notificacoes: ids.length,
      meta,
    };
  }

  // ---------------------------------------------------------------- apagar

  private async apagarAgora() {
    const { o } = this;
    const E = o.empresaId;
    const r: Registros = await o.armazem.registros(E);
    const mantidos: string[] = [];

    let automacoes = 0;
    for (const id of r.automacao) {
      const a = await o.automacoes.exigir(id).catch(() => undefined);
      if (a?.criadaPor === POR_DEMO) {
        await o.automacoes.apagar(id);
        automacoes++;
      }
    }
    let respostas = 0;
    for (const id of r.resposta) {
      const x = await o.respostas.obter(E, id);
      if (x?.criadaPor === POR_DEMO && (await o.respostas.apagar(E, id))) respostas++;
    }
    const notificacoes = await o.armazem.apagarNotificacoes(r.notificacao);
    const conversas = await o.armazem.apagarConversas(E, r.conversa, r.contato);
    const usuarios = await o.armazem.apagarUsuarios(E, r.usuario);

    // Tags, funil e campos criados pela demonstração: ficam se dados reais passaram a usá-los.
    const marcas = await o.armazemTags.marcacoes(E);
    const usadas = new Set([...marcas.values()].flat());
    let tags = 0;
    for (const id of r.tag) {
      const t = await o.armazemTags.buscar(id);
      if (!t || t.criadaPor !== POR_DEMO || t.funilId) continue;
      if (usadas.has(id)) mantidos.push(`tag "${t.nome}" (marcada em conversa real)`);
      else {
        await o.tags.apagar(id);
        tags++;
      }
    }
    let funis = 0;
    for (const id of r.funil) {
      const f = await o.funis.exigir(id).catch(() => undefined);
      if (!f || f.criadaPor !== POR_DEMO || f.sistema) continue;
      const etapas = await o.funis.etapas(id);
      if (etapas.some((e) => usadas.has(e.id))) mantidos.push(`funil "${f.nome}" (tem conversa real)`);
      else {
        await o.funis.apagar(id);
        funis++;
      }
    }
    let campos = 0;
    const listaCampos = await o.contatos.campos(E);
    for (const id of r.campo) {
      const c = listaCampos.find((x) => x.id === id);
      if (!c) continue;
      if (await o.armazem.campoEmUso(E, id)) mantidos.push(`campo "${c.nome}" (preenchido em ficha real)`);
      else if (await o.contatos.apagarCampo(E, id)) campos++;
    }
    let meta = false;
    if (r.meta.length) {
      const atual = await o.empresa.meta();
      if (atual.atualizadaPor === POR_DEMO && r.meta.includes(String(atual.agendamentosMes))) {
        await o.empresa.alterarMeta({ agendamentosMes: null }, POR_DEMO);
        meta = true;
      }
    }
    for (const t of Object.keys(r) as Array<keyof Registros>) await o.armazem.esquecer(E, t);
    this.log('Demonstração apagada', { conversas: conversas.conversas });
    return { ...conversas, usuarios, tags, funis, campos, respostasRapidas: respostas, automacoes, notificacoes, metaRemovida: meta, mantidos };
  }
}

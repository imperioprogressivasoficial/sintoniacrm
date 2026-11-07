import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ClienteClaude, PedidoAgente, RespostaAgente } from '../ai/agente.js';
import { TEXTO_PASSAGEM } from '../ai/agente.js';
import {
  type AcaoAgente,
  type Agenda,
  executarFerramenta,
  ferramentaMarcarTag,
  FERRAMENTAS_ESCRITA,
  FERRAMENTAS_LEITURA,
} from '../ai/ferramentas.js';
import { contextoDaConversa, historicoParaTurnos, INSTRUCAO_ATIVA, instrucaoObjetivo } from '../ai/prompt.js';
import { descreverAcao } from '../ai/simulacao.js';
import type { Conversa, Mensagem, UnidadeId } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { horaHHmm, dataISO, MIN } from '../util/tempo.js';
import type { ArmazemAgentesIa } from './armazem.js';
import { conferirPassagem } from './passagem.js';
import { systemDoAgente, textoMemoria } from './prompt.js';
import { SemChave } from './provedores.js';
import { CHAVES_MEMORIA, type AgenteIa, type FerramentaAgente, type Provedor } from './tipos.js';
import { avaliarResposta } from './nota.js';

type Ferramenta = Anthropic.Beta.Messages.BetaTool;

const def = (name: string, description: string, properties: Record<string, unknown>): Ferramenta => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
});

export const FERRAMENTA_LEMBRAR = def(
  'lembrar_cliente',
  'Guarda na memória da cliente fatos úteis que ela contou, para as próximas conversas (não precisa avisar a cliente).',
  {
    fatos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { chave: { type: 'string', enum: [...CHAVES_MEMORIA] }, valor: { type: 'string', description: 'O fato, curto (ex.: "cacheado, até o meio das costas")' } },
        required: ['chave', 'valor'],
        additionalProperties: false,
      },
    },
  },
);
export const FERRAMENTA_LEMBRETE = def('criar_lembrete_ligacao', 'Cria um lembrete para a equipe ligar para esta cliente (aparece em "Ligar hoje").', {
  em_minutos: { type: 'integer', description: 'Daqui a quantos minutos ligar (0 = agora)' },
  texto: { type: 'string', description: 'Motivo da ligação, curto' },
});

const porNome = new Map([...FERRAMENTAS_LEITURA, ...FERRAMENTAS_ESCRITA].map((f) => [f.name, f]));
const ESCRITA = new Set(['agendar', 'passar_para_humano']);

/** Ferramentas da API (nomes) que cada opção da tela libera. */
export function ferramentasPermitidas(permitidas: FerramentaAgente[], memoria: boolean): Set<string> {
  const s = new Set<string>();
  const tem = (f: FerramentaAgente) => permitidas.includes(f);
  if (tem('consultar_agenda') || tem('agendar')) ['ver_servicos', 'consultar_horarios', 'ver_agendamentos_da_cliente'].forEach((n) => s.add(n));
  if (tem('agendar')) s.add('agendar');
  if (tem('mover_etapa')) s.add('registrar_etapa');
  if (tem('marcar_tag')) s.add('marcar_tag');
  if (tem('transferir')) s.add('passar_para_humano');
  if (tem('lembrete_ligacao')) s.add('criar_lembrete_ligacao');
  if (memoria) s.add('lembrar_cliente');
  return s;
}

export interface UsoFerramenta {
  nome: string;
  entrada: unknown;
  ok: boolean;
  resultado: string;
}

export interface ResultadoAgente extends RespostaAgente {
  agenteId: string;
  ferramentas: UsoFerramenta[];
  memorias: Array<{ chave: string; valor: string }>;
  lembretes: Array<{ quando: Date; texto: string }>;
  /** Passagem decidida pelas condições do agente, sem chamar a IA. */
  passagemDireta?: string;
  /** false quando o agente não pode responder (só organiza o CRM): nada deve ser enviado. */
  responde: boolean;
}

export interface DependenciasExecutor {
  empresaId: string;
  armazem: ArmazemAgentesIa;
  cofre: { decifrar(s: string): string };
  agenda: Agenda;
  baseGeral: () => Promise<string>;
  /** Cliente do provedor. `chave` = chave própria do agente (já decifrada); ausente = a chave geral. Lança SemChave. */
  cliente: (provedor: Provedor, chave?: string) => ClienteClaude;
  repo: Pick<Repositorio, 'mensagens' | 'registrarEvento'>;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  maxPassos?: number;
}

export class ExecutorAgentes {
  private readonly agora: () => Date;
  constructor(private readonly d: DependenciasExecutor) {
    this.agora = d.agora ?? (() => new Date());
  }

  /** Cliente do agente: chave própria quando existe, senão a geral. */
  clienteDe(a: AgenteIa): ClienteClaude {
    let chave: string | undefined;
    if (a.chaveCifrada) {
      try {
        chave = this.d.cofre.decifrar(a.chaveCifrada);
      } catch {
        throw new SemChave(a.provedor);
      }
    }
    return this.d.cliente(a.provedor, chave);
  }

  /** System prompt do agente (também mostrado na tela "Ver o que a IA lê"). */
  async systemDe(a: AgenteIa, ferramentas: string[]): Promise<string> {
    const [conhecimento, aprendizados, baseGeral] = await Promise.all([
      this.d.armazem.conhecimentos(a.id),
      this.d.armazem.aprendizados(a.id, 'aprovado'),
      a.config.usarBaseGeral ? this.d.baseGeral().catch(() => '') : Promise.resolve(''),
    ]);
    return systemDoAgente({ agente: a, baseGeral, conhecimento, aprendizados, ferramentas });
  }

  /**
   * Roda o agente numa conversa. `simulacao` = teste da tela: nada é gravado nem enviado,
   * e as ferramentas de escrita só dizem o que fariam.
   */
  async executar(a: AgenteIa, p: PedidoAgente): Promise<ResultadoAgente> {
    const simulacao = Boolean(p.simulacao);
    const escreve = p.modo === 'responder' || simulacao;
    const cfg = a.config;
    const permitidas = ferramentasPermitidas(cfg.ferramentas, cfg.memoriaCliente);
    const responde = cfg.ferramentas.includes('responder');
    const res: ResultadoAgente = { agenteId: a.id, texto: '', acoes: [], recusou: false, ferramentas: [], memorias: [], lembretes: [], responde };

    // Condições de passagem: decididas aqui, sem gastar IA.
    const ultima = p.mensagens.filter((m) => m.autor === 'cliente').at(-1);
    if (escreve && !p.tipoAtivo && permitidas.has('passar_para_humano') && ultima && this.esperandoResposta(p.mensagens)) {
      const pass = conferirPassagem(ultima.texto, cfg.passagem);
      if (pass.passar) {
        res.texto = TEXTO_PASSAGEM;
        res.acoes.push({ tipo: 'passar_para_humano', motivo: pass.motivo! });
        res.passagemDireta = pass.motivo;
        res.ferramentas.push({ nome: 'passar_para_humano', entrada: { motivo: pass.motivo }, ok: true, resultado: 'Condição de passagem do agente.' });
        return res;
      }
    }

    const nomes = [...permitidas].filter((n) => (ESCRITA.has(n) ? escreve : true)).filter((n) => n !== 'marcar_tag' || p.tagsDisponiveis?.length);
    const ferramentas: Ferramenta[] = nomes
      .map((n) =>
        n === 'marcar_tag' ? ferramentaMarcarTag(p.tagsDisponiveis!) : n === 'lembrar_cliente' ? FERRAMENTA_LEMBRAR : n === 'criar_lembrete_ligacao' ? FERRAMENTA_LEMBRETE : porNome.get(n),
      )
      .filter((f): f is Ferramenta => Boolean(f));

    const cliente = this.clienteDe(a);
    const system = await this.systemDe(a, nomes);
    const memoria = cfg.memoriaCliente && !simulacao ? await this.d.armazem.memoria(this.d.empresaId, p.conversa.telefone).catch(() => []) : [];
    const messages = this.montarMensagens(p, textoMemoria(memoria), simulacao);
    const anthropic = a.provedor === 'anthropic';
    const comReserva = anthropic && /^claude-(opus|sonnet)-5-5/.test(a.modelo);

    for (let passo = 0; passo < (this.d.maxPassos ?? 8); passo++) {
      const pedido: Record<string, unknown> = {
        model: a.modelo,
        max_tokens: 16000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: ferramentas,
        messages,
      };
      if (anthropic) pedido.output_config = { effort: 'low' };
      else pedido.temperature = Math.round((0.2 + (a.criatividade / 100) * 0.8) * 100) / 100;
      if (comReserva) Object.assign(pedido, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
      const resp = (await cliente.beta.messages.create(pedido as never)) as Anthropic.Beta.Messages.BetaMessage;

      if (resp.stop_reason === 'refusal') {
        return { ...res, texto: TEXTO_PASSAGEM, acoes: [...res.acoes, { tipo: 'passar_para_humano', motivo: 'A IA recusou responder.' }], recusou: true };
      }
      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const resultados: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
        for (const bloco of resp.content) {
          if (bloco.type !== 'tool_use') continue;
          const r = await this.rodarFerramenta(a, bloco.name, bloco.input, p, res, permitidas, nomes, simulacao);
          res.ferramentas.push({ nome: bloco.name, entrada: bloco.input, ok: !r.erro, resultado: r.conteudo.slice(0, 500) });
          resultados.push({ type: 'tool_result', tool_use_id: bloco.id, content: r.conteudo, is_error: r.erro });
        }
        messages.push({ role: 'user', content: resultados });
        continue;
      }
      if (resp.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: resp.content });
        continue;
      }
      const texto = resp.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      res.texto = responde ? texto || TEXTO_PASSAGEM : '';
      return res;
    }
    res.texto = responde ? TEXTO_PASSAGEM : '';
    if (permitidas.has('passar_para_humano')) res.acoes.push({ tipo: 'passar_para_humano', motivo: 'A IA não concluiu a resposta no limite de passos.' });
    return res;
  }

  private esperandoResposta(ms: Mensagem[]): boolean {
    const ult = ms.filter((m) => m.autor !== 'sistema').at(-1);
    return ult?.autor === 'cliente';
  }

  private async rodarFerramenta(
    a: AgenteIa,
    nome: string,
    entrada: unknown,
    p: PedidoAgente,
    res: ResultadoAgente,
    permitidas: Set<string>,
    oferecidas: string[],
    simulacao: boolean,
  ): Promise<{ conteudo: string; erro: boolean }> {
    // Conferido de novo aqui: o modelo nunca usa o que não foi liberado para este agente.
    if (!permitidas.has(nome) || !oferecidas.includes(nome)) return { conteudo: 'Ferramenta não permitida para este agente.', erro: true };
    const agora = this.agora();
    try {
      if (nome === 'lembrar_cliente') {
        const i = z.object({ fatos: z.array(z.object({ chave: z.enum(CHAVES_MEMORIA), valor: z.string().trim().min(1).max(300) })).max(10) }).parse(entrada);
        for (const f of i.fatos) {
          res.memorias.push(f);
          if (!simulacao) {
            await this.d.armazem.gravarMemoria(this.d.empresaId, { telefone: p.conversa.telefone, chave: f.chave, valor: f.valor, agenteId: a.id, conversaId: p.conversa.id, fonte: 'ia', atualizadoEm: agora });
          }
        }
        return { conteudo: 'ok: guardado na memória da cliente.', erro: false };
      }
      if (nome === 'criar_lembrete_ligacao') {
        const i = z.object({ em_minutos: z.number().int().min(0).max(7 * 24 * 60), texto: z.string().trim().min(1).max(200) }).parse(entrada);
        const quando = new Date(agora.getTime() + i.em_minutos * MIN);
        res.lembretes.push({ quando, texto: i.texto });
        if (!simulacao) {
          await this.d.repo.registrarEvento({
            tipo: 'lembrete_ligacao',
            conversaId: p.conversa.id,
            unidade: p.conversa.unidade,
            em: agora,
            dados: { quando: quando.toISOString(), texto: i.texto, por: 'IA', agenteId: a.id, agenteNome: a.nome },
          });
        }
        return { conteudo: `ok: lembrete para ${dataISO(quando)} ${horaHHmm(quando)}.`, erro: false };
      }
      if (simulacao && nome === 'agendar') {
        const i = entrada as Record<string, unknown>;
        return { conteudo: JSON.stringify({ ok: true, simulacao: true, aviso: `Teste: agendaria ${String(i.data)} às ${String(i.hora)}; nada foi marcado no Trinks.` }), erro: false };
      }
      if (simulacao && nome === 'passar_para_humano') {
        const i = z.object({ motivo: z.string() }).parse(entrada);
        res.acoes.push({ tipo: 'passar_para_humano', motivo: i.motivo });
        return { conteudo: 'ok (teste): a equipe seria avisada. Diga à cliente que alguém da equipe vai continuar.', erro: false };
      }
    } catch (e) {
      const msg = e instanceof z.ZodError ? `Parâmetros inválidos: ${e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}` : String((e as Error).message ?? e);
      return { conteudo: msg, erro: true };
    }
    return executarFerramenta(nome, entrada, {
      agenda: this.d.agenda,
      conversa: p.conversa,
      agora,
      acoes: res.acoes,
      podeEscrever: p.modo === 'responder' && !simulacao,
      tagsDisponiveis: p.tagsDisponiveis,
    });
  }

  private montarMensagens(p: PedidoAgente, memoria: string, simulacao: boolean): Anthropic.Beta.Messages.BetaMessageParam[] {
    const turnos = historicoParaTurnos(p.mensagens);
    const extra: string[] = [contextoDaConversa(p.conversa, p.agora)];
    if (memoria) extra.push(memoria);
    if (p.tipoAtivo) {
      extra.push(`<instrucao_da_loja>${INSTRUCAO_ATIVA[p.tipoAtivo]}</instrucao_da_loja>\nEsta instrução é da loja, não da cliente. Escreva a mensagem que será enviada à cliente.`);
    }
    if (p.objetivo?.trim()) extra.push(instrucaoObjetivo(p.objetivo));
    if (p.modo === 'sugerir' && !simulacao) extra.push('Você está em modo copiloto: escreva a resposta que a atendente vai revisar e enviar.');
    const ultimo = turnos.at(-1);
    if (ultimo?.role === 'user') ultimo.content = `${ultimo.content}\n\n${extra.join('\n')}`;
    else turnos.push({ role: 'user', content: `[sem nova mensagem da cliente]\n\n${extra.join('\n')}` });
    return turnos.map((t) => ({ role: t.role, content: t.content }));
  }

  /** Teste na tela: uma cliente fictícia conversa com o agente. Nada é enviado nem gravado. */
  async testar(
    a: AgenteIa,
    t: { mensagem: string; historico?: Array<{ autor: 'cliente' | 'ia'; texto: string }>; unidade?: UnidadeId; nome?: string; tagsDisponiveis?: string[] },
  ) {
    const agora = this.agora();
    const conversa: Conversa = {
      id: 'simulacao',
      empresaId: this.d.empresaId,
      unidade: t.unidade ?? ((a.unidades[0] as UnidadeId | undefined) ?? 'norte'),
      canalId: 'simulacao',
      telefone: '5599000000000',
      nome: t.nome ?? 'Cliente de teste',
      modo: 'ia',
      etapa: 'em_conversa',
      etiquetas: [],
      criadaEm: agora,
      atualizadaEm: agora,
    };
    const anteriores = t.historico ?? [];
    const mensagens: Mensagem[] = [...anteriores, { autor: 'cliente' as const, texto: t.mensagem }].map((m, i) => ({
      id: `sim-${i}`,
      conversaId: conversa.id,
      autor: m.autor,
      texto: m.texto,
      em: new Date(agora.getTime() - (anteriores.length - i) * 1000),
    }));
    const r = await this.executar(a, { conversa, mensagens, agora, modo: 'responder', simulacao: true, tagsDisponiveis: t.tagsDisponiveis });
    return {
      resposta: r.texto,
      responde: r.responde,
      recusou: r.recusou,
      passagemDireta: r.passagemDireta ?? null,
      acoes: r.acoes.map(descreverAcao),
      ferramentas: r.ferramentas,
      memorias: r.memorias,
      lembretes: r.lembretes.map((l) => ({ quando: l.quando, texto: l.texto })),
      avisos: r.texto ? avaliarResposta(a, r.texto) : [],
    };
  }
}

export const novoId = () => randomUUID();
export type { AcaoAgente };

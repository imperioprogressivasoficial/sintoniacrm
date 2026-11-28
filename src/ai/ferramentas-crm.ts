import { z } from 'zod';
import { ajustarParaJanelaAtiva } from '../engine/horario.js';
import { ETAPAS_DA_IA } from '../engine/etapas.js';
import { dataISO, DIA, deDataEHora, horaHHmm, HORA } from '../util/tempo.js';
import { def, RecusaFerramenta, type Ferramenta } from './ferramenta-base.js';
import { dataValida } from './guarda.js';
import type { AcaoCrm, ServicosCrmIa } from './crm-ia.js';
import type { Conversa, Etapa } from '../domain.js';

/**
 * ia-completa: ferramentas de CRM da IA de atendimento (pipelines, produtos, tarefas, retorno e arquivos).
 * Só pedem as ações (a Sintonia aplica depois, sob a trava da conversa); aqui tudo é conferido antes, para a IA
 * receber na hora um "não existe"/"falta o motivo" e corrigir.
 */

export const FERRAMENTAS_CRM_LEITURA: Ferramenta[] = [
  def(
    'ver_funis',
    'Lista os pipelines (funis) da empresa com as etapas e em que etapa a cliente está em cada um, e os motivos de perda. Use antes de mover_no_funil.',
    {},
  ),
  def(
    'ver_produtos',
    'Produtos e serviços do cadastro da empresa (Empresa › Produtos e serviços) com preço, duração, descrição, se tem foto, e os arquivos (catálogo, tabela) que podem ir para a cliente. Preço só vale o daqui ou o da agenda.',
    { busca: { type: ['string', 'null'], description: 'Parte do nome ou categoria; null = todos' } },
  ),
];

export const FERRAMENTA_MOVER = def(
  'mover_no_funil',
  'Move a cliente para uma etapa de qualquer pipeline (ids de ver_funis). Etapa de perda exige o motivo da lista (motivo_perda_id) e, quando o motivo pede, o detalhe. "Agendada" e "Compareceu" do funil Atendimento mudam sozinhas pela agenda: não use para isso.',
  {
    funil_id: { type: 'string' },
    etapa_id: { type: 'string' },
    motivo: { type: 'string', description: 'Por que está movendo, uma frase curta' },
    motivo_perda_id: { type: ['string', 'null'], description: 'Só em etapa de perda: id do motivo (ver_funis)' },
    detalhe_perda: { type: ['string', 'null'], description: 'Detalhe da perda em poucas palavras (obrigatório quando o motivo pede)' },
  },
);
export const FERRAMENTA_VINCULAR = def('vincular_produto', 'Liga ao lead um produto ou serviço do cadastro em que a cliente mostrou interesse (o valor do lead acompanha).', {
  produto_id: { type: 'string', description: 'id de ver_produtos' },
  quantidade: { type: 'integer', description: 'Normalmente 1' },
});
export const FERRAMENTA_TAREFA = def(
  'criar_tarefa_equipe',
  'Cria uma tarefa para a equipe (Agenda › Rotina) ligada a esta conversa: algo que só uma pessoa pode fazer (ex.: enviar orçamento, conferir pagamento, ligar). Não substitui passar_para_humano quando a cliente precisa de alguém agora.',
  {
    titulo: { type: 'string', description: 'O que fazer, curto (ex.: "Enviar orçamento da progressiva")' },
    detalhe: { type: 'string', description: 'Contexto para quem vai fazer' },
    prazo_horas: { type: ['integer', 'null'], description: 'Em quantas horas precisa estar feito; null = sem prazo' },
    prioridade: { type: 'string', enum: ['baixa', 'normal', 'alta'] },
  },
);
export const FERRAMENTA_RETORNO = def(
  'agendar_retorno',
  'Combina um retorno: na data e hora escolhidas a IA volta a falar com a cliente sobre o motivo (ex.: ela pediu "me chama sexta"). Use quando a própria cliente pedir ou aceitar.',
  {
    data: { type: 'string', description: 'AAAA-MM-DD' },
    hora: { type: 'string', description: 'HH:mm (entre 08:00 e 20:30)' },
    motivo: { type: 'string', description: 'Sobre o que retomar, curto' },
  },
);
export const FERRAMENTA_ARQUIVO = def(
  'enviar_arquivo',
  'Manda para a cliente a foto de um produto (origem foto_produto, só os que têm foto em ver_produtos) ou um arquivo de catálogo/tabela (origem documento). Vai logo depois da sua resposta.',
  {
    origem: { type: 'string', enum: ['foto_produto', 'documento'] },
    id: { type: 'string', description: 'id do produto ou do documento (ver_produtos)' },
    legenda: { type: ['string', 'null'], description: 'Legenda curta, ou null' },
  },
);

/**
 * serena-regras (item 6): a imagem da tabela de preços. A IA nunca escreve a lista de preços por conta própria: manda a
 * imagem que a gestão cadastrou (Empresa › Documentos, categoria tabela) com o nome que a base indica (ex.: a tabela de
 * cliente nova e a de quem já é cliente). Sem imagem com esse nome: a ferramenta avisa e a IA manda um resumo curto.
 */
export const FERRAMENTA_TABELA = def(
  'enviar_tabela_precos',
  'Manda para a cliente a IMAGEM da tabela de preços cadastrada nos arquivos da empresa. Use depois de confirmar o agendamento e sempre que ela perguntar preço. Passe o nome da tabela que a base indica para o caso dela (cliente nova ou não). Vai logo depois da sua mensagem.',
  {
    nome: { type: 'string', description: 'Nome (ou parte do nome) da tabela, como está na base de conhecimento' },
    legenda: { type: ['string', 'null'], description: 'Legenda curta, ou null' },
  },
);

export const FERRAMENTAS_CRM_ESCRITA: Ferramenta[] = [FERRAMENTA_MOVER, FERRAMENTA_VINCULAR, FERRAMENTA_TAREFA, FERRAMENTA_RETORNO, FERRAMENTA_ARQUIVO, FERRAMENTA_TABELA];
export const FERRAMENTAS_CRM: Ferramenta[] = [...FERRAMENTAS_CRM_LEITURA, ...FERRAMENTAS_CRM_ESCRITA];
export const FERRAMENTAS_CRM_NOMES = new Set(FERRAMENTAS_CRM.map((f) => f.name));
export const CRM_ESCRITA_NOMES = new Set(FERRAMENTAS_CRM_ESCRITA.map((f) => f.name));

const Texto = (max: number) => z.string().trim().min(1).max(max);
const ENTRADAS = {
  ver_funis: z.object({}).passthrough(),
  ver_produtos: z.object({ busca: z.string().trim().max(80).nullable().optional() }),
  mover_no_funil: z.object({
    funil_id: Texto(80),
    etapa_id: Texto(80),
    motivo: z.string().trim().max(300),
    motivo_perda_id: z.string().trim().max(40).nullable().optional(),
    detalhe_perda: z.string().trim().max(300).nullable().optional(),
  }),
  vincular_produto: z.object({ produto_id: Texto(80), quantidade: z.number().int().min(1).max(99) }),
  criar_tarefa_equipe: z.object({
    titulo: z.string().trim().min(2).max(140),
    detalhe: z.string().trim().max(2000),
    prazo_horas: z.number().int().min(0).max(24 * 60).nullable().optional(),
    prioridade: z.enum(['baixa', 'normal', 'alta']),
  }),
  agendar_retorno: z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(dataValida, 'essa data não existe no calendário'),
    hora: z.string().regex(/^\d{1,2}:\d{2}$/),
    motivo: Texto(300),
  }),
  enviar_arquivo: z.object({ origem: z.enum(['foto_produto', 'documento']), id: Texto(80), legenda: z.string().trim().max(300).nullable().optional() }),
  enviar_tabela_precos: z.object({ nome: Texto(120), legenda: z.string().trim().max(300).nullable().optional() }),
} as const;

/** Palavras que não ajudam a achar a tabela pelo nome ("Tabela de preços - Seu Primeiro Alisamento"). */
const PALAVRAS_VAZIAS = new Set(['tabela', 'tabelas', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'para', 'com', 'preco', 'precos', 'valor', 'valores', 'png', 'jpg', 'jpeg', 'webp', 'pdf']);
/** Nome sem acento, sem pontuação, sem extensão e sem palavras vazias: "Tabela_Liso-Infinito.png" → "liso infinito". */
const palavrasDoNome = (s: string): string[] =>
  sem(s)
    .replace(/\.(png|jpe?g|webp|gif|pdf)$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((p) => p && !PALAVRAS_VAZIAS.has(p));

/**
 * serena-regras: a tabela pelo nome. Prefere categoria "tabela" e imagem; o nome inteiro antes de trecho.
 * tabela-fim: compara só as palavras que contam (sem "tabela de preços", pontuação, "_", "-" ou extensão do arquivo).
 */
export function acharTabela<D extends { id: string; nome: string; categoria: string; mimetype?: string }>(docs: D[], nome: string): D | undefined {
  const alvo = palavrasDoNome(nome);
  if (!alvo.length) return undefined;
  const a = alvo.join(' ');
  const pontos = (d: D) => {
    const pal = palavrasDoNome(d.nome);
    const n = pal.join(' ');
    const casa = n === a ? 3 : ` ${n} `.includes(` ${a} `) ? 2 : alvo.every((p) => pal.includes(p)) ? 1 : 0;
    if (!casa) return 0;
    return casa * 10 + (d.categoria === 'tabela' ? 4 : 0) + (/^image\//.test(d.mimetype ?? '') ? 2 : 0);
  };
  return docs
    .map((d) => ({ d, p: pontos(d) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)[0]?.d;
}

/** tabela-fim: nomes das tabelas que vão no fim do agendamento (Mais › IA; vazio = não manda). */
export interface TabelasAgendamento {
  clienteNova: string;
  jaCliente: string;
}

/**
 * tabela-fim (dono 28/11): a imagem da tabela que o sistema manda depois da confirmação do agendamento.
 * Cliente nova: a tabela "clienteNova"; quem já era cliente: "jaCliente". Só imagem; sem imagem = undefined.
 */
export function tabelaDoAgendamento<D extends { id: string; nome: string; categoria: string; mimetype?: string }>(docs: D[], nomes: TabelasAgendamento, clienteNova: boolean): D | undefined {
  const nome = (clienteNova ? nomes.clienteNova : nomes.jaCliente).trim();
  if (!nome) return undefined;
  const d = acharTabela(docs, nome);
  return d && /^image\//.test(d.mimetype ?? '') ? d : undefined;
}

/** O que a ferramenta precisa do contexto (o mesmo de src/ai/ferramentas.ts). */
export interface ContextoCrm {
  conversa: Conversa;
  agora: Date;
  acoes: Array<{ tipo: string } & Record<string, unknown>> | AcaoCrm[] | unknown[];
  podeEscrever: boolean;
  crm: ServicosCrmIa;
  aindaComIa?: () => Promise<boolean>;
}

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function rodarFerramentaCrm(nome: string, entrada: unknown, ctx: ContextoCrm): Promise<unknown> {
  const acoes = ctx.acoes as AcaoCrm[];
  const pedir = async (a: AcaoCrm, oQue: string) => {
    if (!ctx.podeEscrever) throw new RecusaFerramenta(`Modo sugestão: não ${oQue}. Sugira na mensagem para a atendente.`);
    if (ctx.aindaComIa && !(await ctx.aindaComIa().catch(() => true))) throw new RecusaFerramenta(`A equipe assumiu esta conversa: não ${oQue}.`);
    acoes.push(a);
  };
  switch (nome) {
    case 'ver_funis': {
      const [funis, onde, motivos] = await Promise.all([ctx.crm.funis(), ctx.crm.ondeEsta(ctx.conversa).catch(() => []), ctx.crm.motivosPerda().catch(() => [])]);
      return {
        funis: funis.map((f) => {
          const aqui = onde.find((x) => x.funilId === f.id);
          return {
            funil_id: f.id,
            nome: f.nome,
            cliente_esta_em: aqui ? (f.etapas.find((e) => e.id === aqui.etapaId)?.nome ?? null) : 'fora deste funil',
            etapas: f.etapas.map((e) => ({ etapa_id: e.id, nome: e.nome, ...(e.perda ? { perda: true } : {}) })),
          };
        }),
        motivos_de_perda: motivos.map((m) => ({ id: m.id, nome: m.nome, ...(m.pedeTexto ? { pede_detalhe: true } : {}) })),
      };
    }
    case 'mover_no_funil': {
      const i = ENTRADAS.mover_no_funil.parse(entrada);
      const funil = (await ctx.crm.funis()).find((f) => f.id === i.funil_id);
      if (!funil) throw new RecusaFerramenta('Esse pipeline não existe. Use ver_funis para pegar o funil_id.');
      const etapa = funil.etapas.find((e) => e.id === i.etapa_id);
      if (!etapa) throw new RecusaFerramenta(`Essa etapa não existe no pipeline "${funil.nome}". Use ver_funis para pegar o etapa_id.`);
      if (funil.sistema && etapa.chave && !ETAPAS_DA_IA.includes(etapa.chave as Etapa)) {
        throw new RecusaFerramenta(`"${etapa.nome}" muda sozinha pela agenda/atendimento: não mova para lá. Para marcar horário use agendar.`);
      }
      if (funil.sistema && (ctx.conversa.etapa === 'agendada' || ctx.conversa.etapa === 'compareceu')) {
        throw new RecusaFerramenta(`A cliente está em "${ctx.conversa.etapa === 'agendada' ? 'Agendada' : 'Compareceu'}" (fato da agenda). Se ela desistiu do horário, use cancelar_agendamento primeiro.`);
      }
      let perda: { motivo: string; detalhe: string | null } | null = null;
      if (etapa.perda) {
        const motivos = await ctx.crm.motivosPerda();
        if (!i.motivo_perda_id) {
          throw new RecusaFerramenta(`"${etapa.nome}" é etapa de perda: informe motivo_perda_id. Motivos: ${motivos.map((m) => `${m.id} = ${m.nome}${m.pedeTexto ? ' (pede detalhe)' : ''}`).join('; ')}.`);
        }
        const m = motivos.find((x) => x.id === i.motivo_perda_id);
        if (!m && motivos.length) throw new RecusaFerramenta(`Motivo de perda inválido. Use um destes: ${motivos.map((x) => x.id).join(', ')}.`);
        const detalhe = i.detalhe_perda?.trim() || null;
        if (m?.pedeTexto && (!detalhe || detalhe.length < 2)) throw new RecusaFerramenta(`O motivo "${m.nome}" pede um detalhe em poucas palavras (detalhe_perda).`);
        perda = { motivo: i.motivo_perda_id, detalhe };
      }
      await pedir({ tipo: 'mover_funil', funilId: funil.id, funil: funil.nome, etapaId: etapa.id, etapa: etapa.nome, motivo: i.motivo || 'IA', perda }, 'mova a cliente');
      return `ok: a cliente vai para "${etapa.nome}" em "${funil.nome}". Não precisa contar isso para ela.`;
    }
    case 'ver_produtos': {
      const i = ENTRADAS.ver_produtos.parse(entrada ?? {});
      const [produtos, docs] = await Promise.all([ctx.crm.produtos(), ctx.crm.documentos().catch(() => [])]);
      const b = i.busca ? sem(i.busca) : '';
      const l = produtos.filter((p) => !b || sem(`${p.nome} ${p.categoria ?? ''} ${p.descricao}`).includes(b)).slice(0, 40);
      if (!l.length && !docs.length) return b ? `Nenhum produto ou serviço com "${i.busca}" no cadastro. Não invente: diga que vai confirmar com a equipe.` : 'O cadastro de produtos e serviços está vazio. Não invente preço.';
      return {
        produtos: l.map((p) => ({
          id: p.id,
          nome: p.nome,
          tipo: p.tipo === 'servico' ? 'serviço' : 'produto',
          categoria: p.categoria,
          preco: p.preco,
          ...(p.preco === null ? { obs: 'preço sob consulta: não diga valor, ofereça passar para a equipe' } : {}),
          duracao_min: p.duracaoMin,
          descricao: p.descricao.slice(0, 300),
          tem_foto: p.temFoto,
        })),
        arquivos: docs.map((d) => ({ id: d.id, nome: d.nome, tipo: d.categoria, descricao: d.descricao.slice(0, 200) })),
      };
    }
    case 'vincular_produto': {
      const i = ENTRADAS.vincular_produto.parse(entrada);
      const p = (await ctx.crm.produtos()).find((x) => x.id === i.produto_id);
      if (!p) throw new RecusaFerramenta('Esse produto não existe (ou está desativado) no cadastro. Use ver_produtos.');
      await pedir({ tipo: 'vincular_produto', produtoId: p.id, nome: p.nome, quantidade: i.quantidade }, 'vincule produto');
      return `ok: "${p.nome}" ligado ao lead.`;
    }
    case 'criar_tarefa_equipe': {
      const i = ENTRADAS.criar_tarefa_equipe.parse(entrada);
      const venceEm = i.prazo_horas == null ? null : new Date(ctx.agora.getTime() + i.prazo_horas * HORA);
      await pedir({ tipo: 'tarefa_equipe', titulo: i.titulo, descricao: i.detalhe, venceEm, prioridade: i.prioridade }, 'crie tarefa');
      return 'ok: tarefa criada para a equipe.';
    }
    case 'agendar_retorno': {
      const i = ENTRADAS.agendar_retorno.parse(entrada);
      const pedido = deDataEHora(i.data, i.hora.padStart(5, '0'));
      if (pedido.getTime() <= ctx.agora.getTime() + 10 * 60_000) throw new RecusaFerramenta('O retorno precisa ser daqui a pelo menos 10 minutos.');
      if (pedido.getTime() > ctx.agora.getTime() + 60 * DIA) throw new RecusaFerramenta('Retorno só até 60 dias à frente.');
      const quando = ajustarParaJanelaAtiva(pedido);
      await pedir({ tipo: 'retorno', quando, motivo: i.motivo }, 'combine retorno');
      const ajustou = quando.getTime() !== pedido.getTime();
      return `ok: retorno combinado para ${dataISO(quando)} às ${horaHHmm(quando)}${ajustou ? ' (ajustado para o horário em que mandamos mensagem, 8h às 20h30)' : ''}.`;
    }
    case 'enviar_arquivo': {
      const i = ENTRADAS.enviar_arquivo.parse(entrada);
      let nomeArq: string;
      if (i.origem === 'foto_produto') {
        const p = (await ctx.crm.produtos()).find((x) => x.id === i.id);
        if (!p) throw new RecusaFerramenta('Esse produto não existe no cadastro. Use ver_produtos.');
        if (!p.temFoto) throw new RecusaFerramenta(`"${p.nome}" não tem foto no cadastro. Descreva com palavras.`);
        nomeArq = p.nome;
      } else {
        const d = (await ctx.crm.documentos()).find((x) => x.id === i.id);
        if (!d) throw new RecusaFerramenta('Esse arquivo não existe ou não pode ir para clientes. Use ver_produtos (lista "arquivos").');
        nomeArq = d.nome;
      }
      if ((acoes as AcaoCrm[]).filter((a) => a.tipo === 'enviar_arquivo').length >= 3) throw new RecusaFerramenta('No máximo 3 arquivos por resposta.');
      await pedir({ tipo: 'enviar_arquivo', origem: i.origem, id: i.id, nome: nomeArq, legenda: i.legenda?.trim() || null }, 'envie arquivo');
      return `ok: "${nomeArq}" vai logo depois da sua mensagem.`;
    }
    case 'enviar_tabela_precos': {
      const i = ENTRADAS.enviar_tabela_precos.parse(entrada);
      const docs = await ctx.crm.documentos();
      const d = acharTabela(docs, i.nome);
      if (!d || (d.mimetype && !/^image\//.test(d.mimetype))) {
        // tabela-fim: o nome não bateu, mas há tabelas em imagem: diz quais são (a IA tenta de novo com o nome certo).
        const outras = d ? [] : docs.filter((x) => x.categoria === 'tabela' && /^image\//.test(x.mimetype ?? '')).map((x) => `"${x.nome}"`);
        if (outras.length) return `Nenhuma tabela com o nome "${i.nome}". As tabelas em imagem são: ${outras.slice(0, 8).join(', ')}. Chame de novo com o nome da que serve para o caso dela.`;
        return `Não há imagem da tabela "${i.nome}" nos arquivos da empresa${d ? ' (só um arquivo que não é imagem)' : ''}. Mande um resumo curto em texto, só com o que está na base de conhecimento, sem inventar preço.`;
      }
      if (acoes.some((a) => a.tipo === 'enviar_arquivo' && a.id === d.id)) return `ok: "${d.nome}" já vai nesta resposta.`;
      if ((acoes as AcaoCrm[]).filter((a) => a.tipo === 'enviar_arquivo').length >= 3) throw new RecusaFerramenta('No máximo 3 arquivos por resposta.');
      await pedir({ tipo: 'enviar_arquivo', origem: 'documento', id: d.id, nome: d.nome, legenda: i.legenda?.trim() || null }, 'envie a tabela');
      return `ok: a imagem "${d.nome}" vai logo depois da sua mensagem. Não escreva a lista de preços: a imagem já mostra. Só se ela pedir mais detalhe, um resumo curto.`;
    }
    default:
      throw new RecusaFerramenta(`Ferramenta desconhecida: ${nome}`);
  }
}

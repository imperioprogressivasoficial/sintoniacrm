import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ehGestor } from '../auth/acesso.js';
import type { ConfigAgendaUnidade } from '../agenda/unidades-agenda.js';
import type { SistemaAgenda } from '../agenda/sistema.js';
import { FERRAMENTAS_AGENTE, NOME_FERRAMENTA, type AgenteIa, type ConfigControle, type FerramentaAgente } from '../agentes-ia/tipos.js';
import { nomeUnidade } from '../unidades.js';
import { anotarAgenda, situacaoDaAgenda } from './saude-agenda.js';

/**
 * ia-completa: "O que a IA faz" (Automações › Agente de IA): o que a IA pode fazer, quais ferramentas cada agente
 * tem ligadas e se está tudo pronto (chave, agenda por unidade, WhatsApp, ligada para conversas novas), com o que
 * falta em português simples. Só leitura; `testar=1` chama a agenda de cada unidade agora.
 */

/** O que cada ferramenta faz, em palavras da tela. */
export const O_QUE_FAZ: Record<FerramentaAgente, string> = {
  responder: 'Responde a cliente no WhatsApp, curto e no tom da empresa. Junta mensagens seguidas numa resposta só, ouve áudios e vê fotos.',
  consultar_agenda: 'Consulta serviços, preços, horários livres e produtos do cadastro. Preço sempre do sistema: valor inventado não sai.',
  agendar: 'Marca, remarca e cancela na agenda da unidade (Trinks e outras), sempre confirmando com a cliente antes. Nunca marca duas vezes o mesmo horário.',
  mover_etapa: 'Move a cliente em qualquer pipeline, com o motivo quando é perda.',
  produtos: 'Liga ao lead o produto ou serviço de interesse (o valor do lead acompanha).',
  tarefas: 'Cria tarefa para a equipe em Atendimento › Rotina, ligada à conversa.',
  retorno: 'Combina um retorno ("me chama sexta") e volta a falar com a cliente no dia.',
  enviar_arquivos: 'Manda a foto do produto ou o catálogo/tabela do cadastro.',
  marcar_tag: 'Marca tags que já existem (com "IA marca tags" ligado).',
  transferir: 'Passa para a equipe quando a cliente pede uma pessoa, reclama ou está brava, e avisa a equipe.',
  lembrete_ligacao: 'Cria lembrete para a equipe ligar (aparece em "Ligar hoje"). Só nos agentes do estúdio.',
};

/** Proteções que valem sempre (não dá para desligar). */
export const PROTECOES = [
  'Para na hora se alguém da equipe assumir a conversa.',
  'Espera a cliente terminar de mandar as mensagens antes de responder.',
  'Confere o horário na agenda logo antes de marcar; se ocupou, oferece outro.',
  'Se a agenda ou a IA saírem do ar, avisa a equipe e não inventa nada.',
  'Se o WhatsApp cair na hora de enviar, guarda a resposta e reenvia quando voltar.',
  'Limite de uso da IA por conversa por dia, com aviso.',
  'Respostas curtas: no máximo 3 mensagens de cada vez.',
];

export interface OpcoesEstadoIa {
  /** Há chave geral da Anthropic / OpenAI (Conexões)? */
  chaves: () => { anthropic: boolean; openai: boolean };
  /** Até quando a IA está pausada por chave recusada (null = não está). */
  pausadaAte: () => Date | null;
  agendas: { configs(): ConfigAgendaUnidade[]; sistemaDa(u: string): Pick<SistemaAgenda, 'testar'> | null };
  /** WhatsApp real conectado por unidade. */
  whatsapp: () => Array<{ unidade: string; conectado: boolean }>;
  configIa: () => Promise<{ modoPadrao: 'humano' | 'copiloto' | 'ia'; marcarTags: boolean; assumirSemResposta: { ligado: boolean; minutos: number } }>;
  controle: () => Promise<ConfigControle>;
  agentes: () => Promise<AgenteIa[]>;
  /** Transcrição de áudio configurada? */
  transcricao: () => boolean;
  /** Pipelines/produtos ligados (sempre, no app de verdade). */
  crm: boolean;
  limiteConversaDia: number;
  agora?: () => Date;
}

const MODO_TEXTO = {
  ia: 'A IA atende as conversas novas sozinha.',
  copiloto: 'Conversas novas começam com a IA sugerindo respostas; ela assume se ninguém responder no prazo e fora do horário.',
  humano: 'Conversas novas começam com a equipe ("Só eu"): a IA não responde sozinha.',
} as const;

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, f) => setTimeout(() => f(new Error('A agenda não respondeu em 8 segundos.')), ms).unref?.())]);
}

export async function estadoIa(o: OpcoesEstadoIa, op: { testarAgenda?: boolean } = {}) {
  const agora = o.agora?.() ?? new Date();
  const falta: Array<{ texto: string; onde: string }> = [];
  const chaves = o.chaves();
  const pausada = o.pausadaAte();
  const agentes = await o.agentes().catch(() => [] as AgenteIa[]);
  const comChavePropria = agentes.some((a) => a.ativo && a.chaveCifrada);
  const chaveOk = chaves.anthropic || comChavePropria;
  if (!chaveOk) falta.push({ texto: 'Cadastre a chave da IA (Claude). Sem ela a IA não responde.', onde: 'Mais › Conexões' });
  if (pausada) falta.push({ texto: `A chave da IA foi recusada: a IA está pausada até ${pausada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' })}. Confira a chave.`, onde: 'Mais › Conexões' });

  // Agenda por unidade.
  const agendas = await Promise.all(
    o.agendas.configs().map(async (c) => {
      let ultima = situacaoDaAgenda(c.unidade);
      if (op.testarAgenda && c.conectada) {
        const s = o.agendas.sistemaDa(c.unidade);
        if (s?.testar && c.local) {
          try {
            await comPrazo(s.testar(c.local), 8_000);
            anotarAgenda(c.unidade, true, null, agora);
          } catch (e) {
            anotarAgenda(c.unidade, false, e instanceof Error ? e.message : String(e), agora);
          }
          ultima = situacaoDaAgenda(c.unidade);
        }
      }
      let texto: string;
      let ok = false;
      if (c.escolha === 'nenhum') texto = 'Sem sistema de agenda: a IA tira dúvidas mas não marca horário aqui.';
      else if (c.falta.length) texto = `Falta: ${c.falta.join(', ')}.`;
      else if (!c.pronta) texto = c.aviso ?? 'A integração ainda não marca horário.';
      else if (ultima && !ultima.ok) texto = `${c.sistemaNome} conectada, mas falhou na última vez: ${ultima.mensagem ?? 'erro'}.`;
      else {
        ok = true;
        texto = ultima ? `${c.sistemaNome} respondendo.` : `${c.sistemaNome} conectada.`;
      }
      if (c.escolha !== 'nenhum' && !ok) falta.push({ texto: `Agenda de ${c.nome}: ${texto}`, onde: 'Mais › Conexões › Agenda' });
      return { unidade: c.unidade, nome: c.nome, sistema: c.sistemaNome, ok, semAgenda: c.escolha === 'nenhum', texto, ultimaEm: ultima?.em ?? null };
    }),
  );
  if (agendas.length && agendas.every((a) => a.semAgenda)) falta.push({ texto: 'Nenhuma unidade tem agenda: a IA não consegue marcar horário.', onde: 'Mais › Conexões › Agenda' });

  const whats = o.whatsapp().map((w) => ({ ...w, nome: nomeUnidade(w.unidade) }));
  if (!whats.some((w) => w.conectado)) falta.push({ texto: 'Conecte um WhatsApp para a IA conseguir responder às clientes.', onde: 'Mais › Conexões › WhatsApp' });

  const cfg = await o.configIa();
  const ctrl = await o.controle().catch(() => ({}) as ConfigControle);
  const porUnidade = Object.entries(ctrl).map(([u, c]) => {
    const ag = c.agenteId ? agentes.find((a) => a.id === c.agenteId) : undefined;
    return { unidade: u, nome: nomeUnidade(u), iaPrimeiro: Boolean(c.ligado && ag?.ativo), agente: ag?.nome ?? null, quando: c.quando };
  });
  const algumaIaPrimeiro = porUnidade.some((u) => u.iaPrimeiro);
  if (cfg.modoPadrao === 'humano' && !algumaIaPrimeiro) {
    falta.push({ texto: 'A IA está desligada para conversas novas (modo "Só eu"). Escolha Sugestões ou IA, ou ligue "IA atende primeiro".', onde: 'Automações › Agente de IA › Configuração' });
  }

  // Ferramentas: o agente padrão tem todas; os do estúdio, as que estão marcadas nele.
  const ferramentas = FERRAMENTAS_AGENTE.map((id) => ({ id, nome: NOME_FERRAMENTA[id], oQueFaz: O_QUE_FAZ[id] }));
  const padrao = FERRAMENTAS_AGENTE.filter((f) => f !== 'lembrete_ligacao' && (f !== 'marcar_tag' || cfg.marcarTags));
  const doEstudio = agentes.map((a) => ({
    id: a.id,
    nome: a.nome,
    avatar: a.avatar,
    ativo: a.ativo,
    chave: Boolean(a.chaveCifrada) || (a.provedor === 'openai' ? chaves.openai : chaves.anthropic),
    ligadas: a.config.ferramentas,
    desligadas: FERRAMENTAS_AGENTE.filter((f) => !a.config.ferramentas.includes(f)),
  }));

  return {
    pronta: chaveOk && !pausada && whats.some((w) => w.conectado) && (cfg.modoPadrao !== 'humano' || algumaIaPrimeiro),
    chave: { ok: chaveOk && !pausada, texto: !chaveOk ? 'Sem chave da IA.' : pausada ? 'Chave recusada (IA pausada).' : chaves.anthropic ? 'Chave geral cadastrada.' : 'Só chave própria de agente.' },
    agendas,
    whatsapp: whats,
    novas: { modoPadrao: cfg.modoPadrao, texto: MODO_TEXTO[cfg.modoPadrao], assumirSemResposta: cfg.assumirSemResposta, porUnidade },
    sentidos: { audio: o.transcricao(), fotos: true, textoAudio: o.transcricao() ? 'Ouve os áudios (transcreve sozinha).' : 'Não ouve áudios: falta a chave da OpenAI (transcrição) em Conexões.' },
    ferramentas,
    padrao: { nome: 'IA padrão', ligadas: padrao, desligadas: FERRAMENTAS_AGENTE.filter((f) => !padrao.includes(f)) },
    agentes: doEstudio,
    protecoes: PROTECOES,
    limiteConversaDia: o.limiteConversaDia,
    crm: o.crm,
    falta,
  };
}

export function registrarEstadoIa(app: FastifyInstance, o: OpcoesEstadoIa): void {
  app.get('/api/ia/estado', async (req: FastifyRequest) => {
    const u = req.usuario;
    if (!u) throw Object.assign(new Error('Faça login para continuar.'), { statusCode: 401 });
    if (!ehGestor(u)) throw Object.assign(new Error('Só a gerência, a direção e a administração veem a configuração da IA.'), { statusCode: 403 });
    const q = (req.query ?? {}) as Record<string, unknown>;
    return estadoIa(o, { testarAgenda: q.testar === '1' });
  });
}

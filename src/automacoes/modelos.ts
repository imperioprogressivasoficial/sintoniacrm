import { z } from 'zod';
import type { AutomacaoNova, Passo } from './esquema.js';

/**
 * Modelos de automação (pós-venda: cuidados, retorno e pedido de avaliação).
 * sem-exemplos (pedido do dono, 21/11): a tela e a API não oferecem mais modelos prontos; o dono monta as
 * automações dele. Este gerador fica sem uso, guardado para a futura Ajuda ("Ajuda: um exemplo e o passo a passo").
 */

export const TEXTOS_POS_VENDA = {
  cuidados:
    'Oi, {primeiro_nome}! Passando para saber como você está depois do nosso atendimento. Se ficou qualquer dúvida sobre os cuidados ou o uso, é só chamar aqui 💙',
  retorno: 'Oi, {primeiro_nome}! Já faz um tempinho desde o seu atendimento. Que tal agendar o seu retorno? Posso ver um horário para você.',
  avaliacao: '{primeiro_nome}, que bom que você gostou! Se puder, deixe sua avaliação no Google. Leva menos de um minuto e ajuda muito a gente: {link_avaliacao}',
};

export const NOMES_POS_VENDA = { cuidados: 'Pós-venda: cuidados e retorno', avaliacao: 'Pós-venda: pedir avaliação no Google' };

export const ParamsPosVenda = z.object({
  /** Começa quando o atendimento é finalizado (com "Venda feita") ou 1 dia depois de entrar em "Compareceu". */
  comeca: z.enum(['finalizado', 'compareceu']).default('finalizado'),
  textoCuidados: z.string().trim().min(1).max(1000).default(TEXTOS_POS_VENDA.cuidados),
  /** Lembrete de retoque/retorno: quantos dias depois do atendimento. */
  diasRetorno: z.number().int().min(2).max(365).default(30),
  textoRetorno: z.string().trim().min(1).max(1000).default(TEXTOS_POS_VENDA.retorno),
  /** Pede avaliação (Google) para quem deu nota 9 ou 10 na pesquisa de satisfação. */
  pedirAvaliacao: z.boolean().default(true),
  textoAvaliacao: z.string().trim().min(1).max(1000).default(TEXTOS_POS_VENDA.avaliacao),
  /** Link de avaliação: fica guardado na pesquisa de satisfação ({link_avaliacao}). */
  linkAvaliacao: z.string().trim().max(500).optional(),
  ligar: z.boolean().default(true),
});
export type ParamsPosVenda = z.infer<typeof ParamsPosVenda>;

const MAX_ESPERA_DIAS = 30;
/** "Esperar N dias" em passos de no máximo 30 dias (o limite do passo esperar). */
export function esperarDias(dias: number): Passo[] {
  const passos: Passo[] = [];
  let falta = Math.max(0, Math.round(dias));
  while (falta > 0) {
    const d = Math.min(MAX_ESPERA_DIAS, falta);
    passos.push({ tipo: 'esperar', minutos: d * 24 * 60 });
    falta -= d;
  }
  return passos;
}

/** As automações do pós-venda pronto (uma ou duas). */
export function montarPosVenda(p: ParamsPosVenda): AutomacaoNova[] {
  const msg = (texto: string): Passo => ({ tipo: 'enviar_mensagem', texto, so_no_horario: true });
  const cuidados: AutomacaoNova = {
    nome: NOMES_POS_VENDA.cuidados,
    funilId: null,
    ligada: p.ligar,
    gatilho: p.comeca === 'compareceu' ? { tipo: 'dias_apos_compareceu', dias: 1 } : { tipo: 'atendimento_finalizado', motivos: ['venda_feita'] },
    // Finalizou: espera até o dia seguinte. Compareceu: o gatilho já é 1 dia depois.
    passos: [...(p.comeca === 'finalizado' ? esperarDias(1) : []), msg(p.textoCuidados), ...esperarDias(p.diasRetorno - 1), msg(p.textoRetorno)],
    // Pós-venda não para se alguém da equipe conversar com a cliente no meio do caminho.
    opcoes: { parar_se_equipe_responder: false, parar_se_sair_da_etapa: false, respeitar_limites: false },
  };
  const lista = [cuidados];
  if (p.pedirAvaliacao) {
    lista.push({
      nome: NOMES_POS_VENDA.avaliacao,
      funilId: null,
      ligada: p.ligar,
      gatilho: { tipo: 'nota_nps', min: 9, max: 10 },
      // Um respiro depois do "obrigado" da pesquisa.
      passos: [{ tipo: 'esperar', minutos: 30 }, msg(p.textoAvaliacao)],
      opcoes: { parar_se_equipe_responder: false, parar_se_sair_da_etapa: false, respeitar_limites: false },
    });
  }
  return lista;
}

/** O que a tela mostra na lista de modelos. */
export const MODELOS_AUTOMACAO = [
  {
    id: 'pos-venda',
    nome: 'Pós-venda pronto',
    descricao:
      'Depois do atendimento: mensagem de cuidados no dia seguinte, lembrete de retorno depois de X dias e pedido de avaliação no Google para quem deu nota 9 ou 10.',
    nomes: Object.values(NOMES_POS_VENDA),
    padrao: { comeca: 'finalizado', diasRetorno: 30, pedirAvaliacao: true, textoCuidados: TEXTOS_POS_VENDA.cuidados, textoRetorno: TEXTOS_POS_VENDA.retorno, textoAvaliacao: TEXTOS_POS_VENDA.avaliacao },
  },
];

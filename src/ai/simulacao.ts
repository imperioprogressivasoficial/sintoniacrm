import type { Conversa, Mensagem, UnidadeId } from '../domain.js';
import type { PedidoAgente, RespostaAgente } from './agente.js';
import type { AcaoAgente } from './ferramentas.js';

/**
 * "Testar a IA": a IA responde a uma cliente fictícia usando a base atual.
 * Nada é enviado para o WhatsApp, nada é gravado (nem conversa, nem Trinks): a conversa só existe aqui.
 */

export interface PedidoSimulacao {
  mensagem: string;
  /** Conversa até aqui (para testar várias trocas). */
  historico?: Array<{ autor: 'cliente' | 'ia'; texto: string }>;
  unidade?: UnidadeId;
  nome?: string;
  agora: Date;
  tagsDisponiveis?: string[];
}

export interface RespostaSimulacao {
  resposta: string;
  /** O que a IA teria feito de verdade (nada disso foi aplicado). */
  acoes: Array<{ tipo: string; descricao: string }>;
  recusou: boolean;
}

export function descreverAcao(a: AcaoAgente): { tipo: string; descricao: string } {
  switch (a.tipo) {
    case 'etapa':
      return { tipo: a.tipo, descricao: `Mudaria a etapa para "${a.etapa}" (${a.motivo})` };
    case 'passar_para_humano':
      return { tipo: a.tipo, descricao: `Chamaria alguém da equipe: ${a.motivo}` };
    case 'marcar_tag':
      return { tipo: a.tipo, descricao: `Marcaria a tag "${a.nome}"` };
    case 'agendou':
      return { tipo: a.tipo, descricao: `Agendaria ${a.agendamento.servico}` };
  }
}

export async function simularResposta(
  agente: { executar(p: PedidoAgente): Promise<RespostaAgente> },
  empresaId: string,
  p: PedidoSimulacao,
): Promise<RespostaSimulacao> {
  const conversa: Conversa = {
    id: 'simulacao',
    empresaId,
    unidade: p.unidade ?? 'norte',
    canalId: 'simulacao',
    telefone: '5599000000000',
    nome: p.nome ?? 'Cliente de teste',
    modo: 'ia',
    etapa: 'em_conversa',
    etiquetas: [],
    criadaEm: p.agora,
    atualizadaEm: p.agora,
  };
  const passo = 1000;
  const anteriores = p.historico ?? [];
  const mensagens: Mensagem[] = [...anteriores, { autor: 'cliente' as const, texto: p.mensagem }].map((m, i) => ({
    id: `sim-${i}`,
    conversaId: conversa.id,
    autor: m.autor,
    texto: m.texto,
    em: new Date(p.agora.getTime() - (anteriores.length - i) * passo),
  }));
  const r = await agente.executar({ conversa, mensagens, agora: p.agora, modo: 'responder', simulacao: true, tagsDisponiveis: p.tagsDisponiveis });
  return { resposta: r.texto, acoes: r.acoes.map(descreverAcao), recusou: r.recusou };
}

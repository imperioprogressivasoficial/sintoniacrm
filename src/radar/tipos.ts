import { z } from 'zod';

/**
 * Radar: a pessoa da equipe coloca a conversa no radar dizendo o que vigiar.
 * A IA confere cada mensagem nova da cliente; prazo vencido também dispara.
 */

export const ACOES_RADAR = ['avisar', 'ia'] as const;
export type AcaoRadar = (typeof ACOES_RADAR)[number];

/** O que chega da tela ao colocar (ou editar) uma conversa no radar. */
export const EntradaRadar = z.object({
  vigiar: z.string().trim().min(3, 'Diga o que vigiar.').max(300, 'Use no máximo 300 letras.'),
  prazo: z.string().datetime({ offset: true }).nullable().optional(),
  acao: z.enum(ACOES_RADAR),
  instrucao: z.string().trim().max(600, 'Use no máximo 600 letras.').nullable().optional(),
});
export type EntradaRadar = z.infer<typeof EntradaRadar>;

export interface ItemRadar {
  conversaId: string;
  empresaId: string;
  vigiar: string;
  prazo?: Date;
  acao: AcaoRadar;
  instrucao?: string;
  /** Quem colocou no radar: recebe o aviso e só ela tira o número vermelho ao abrir. */
  donoId?: string;
  donoNome?: string;
  estado: 'vigiando' | 'disparou';
  motivo?: string;
  disparadoEm?: Date;
  vistoEm?: Date;
  /** "A IA responde": pendente até a resposta sair (feita) ou desistir (nao_saiu). */
  resposta?: 'pendente' | 'feita' | 'nao_saiu';
  respostaAte?: Date;
  criadoEm: Date;
  atualizadoEm: Date;
}

export type TipoHistoricoRadar = 'entrou' | 'editou' | 'disparou' | 'resolvido' | 'so_avisou' | 'ia_respondeu' | 'ia_nao_respondeu' | 'visto' | 'de_novo' | 'saiu';

export interface HistoricoRadar {
  conversaId: string;
  tipo: TipoHistoricoRadar;
  texto: string;
  por?: string;
  em: Date;
}

/** Como a IA leu a mensagem nova à luz do que está sendo vigiado. */
export interface Veredito {
  /** aconteceu = dispara; ainda_nao = segue vigiando; nao_precisa_mais = o que se vigiava não pode mais acontecer (ex.: "se não responder" e ela respondeu). */
  situacao: 'aconteceu' | 'ainda_nao' | 'nao_precisa_mais';
  motivo: string;
}

export const curto = (t: string, n = 160) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

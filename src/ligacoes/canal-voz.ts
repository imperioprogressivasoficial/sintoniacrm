/**
 * ligacoes-modos: jeitos de ligar para a cliente e a linha VoIP (ainda desligada).
 *
 * - 'telefone': a ligação sai do chip do celular de quem liga (link tel:). A Sintonia só registra.
 * - 'whatsapp': abre o WhatsApp na conversa da cliente (wa.me); a pessoa toca no telefone de lá.
 *   Não existe link oficial que já comece a chamada do WhatsApp, por isso o app é honesto nisso.
 * - 'voip': a linha fixa da empresa pelo próprio app (SIP da Vivo, Claro, TIM ou outra operadora).
 *   AINDA NÃO EXISTE: fica travada ("Em breve") até alguém plugar um CanalVoz de verdade.
 */

export const MODOS_LIGACAO = ['telefone', 'whatsapp', 'voip'] as const;
export type ModoLigacao = (typeof MODOS_LIGACAO)[number];
/** Os que a pessoa pode escolher hoje (e guardar como preferência ou padrão da unidade). */
export const MODOS_LIVRES = ['telefone', 'whatsapp'] as const;
export type ModoLivre = (typeof MODOS_LIVRES)[number];

export interface ResultadoVoz {
  ok: boolean;
  /** 'nao_configurado': não há linha VoIP; 'falhou': a operadora recusou. */
  motivo?: 'nao_configurado' | 'falhou';
  mensagem: string;
  /** Id da chamada na operadora (quando houver), para ligar o aviso de fim de chamada ao registro. */
  idExterno?: string;
}

/**
 * Linha de voz da empresa. Quem implementar o SIP de verdade cria outro CanalVoz e passa em
 * `registrarLigacoes({ canalVoz })`; a tela libera o modo VoIP quando `configurado` for true.
 */
export interface CanalVoz {
  readonly nome: string;
  readonly configurado: boolean;
  /** Começa a ligação: `de` = número da linha da empresa que aparece para a cliente; `para` = número da cliente. */
  ligar(de: string, para: string): Promise<ResultadoVoz>;
}

/** O de hoje: nenhuma linha configurada. Sempre responde "não configurado", sem tentar nada. */
export const canalVozDesligado: CanalVoz = {
  nome: 'desligado',
  configurado: false,
  async ligar() {
    return { ok: false, motivo: 'nao_configurado', mensagem: 'A linha VoIP da empresa ainda não está configurada.' };
  },
};

/**
 * Recursos de ligação que ainda não estão prontos (ficam travados na tela, com "Em breve").
 *
 * ligacoesIa: a Serena ligar sozinha para reconfirmar horários (véspera, janela 9h–19h, tentativas, voz).
 * Fica DESLIGADO de propósito: precisa da linha VoIP da empresa (CanalVoz configurado) e da voz da Serena.
 * Enquanto estiver false, nenhuma rota liga para ninguém; a tela só mostra o cartão desenhado e travado.
 * Para ligar no futuro: implementar o CanalVoz, a voz e o agendador, e só então trocar para true.
 */
export const RECURSOS_LIGACOES = Object.freeze({
  ligacoesIa: false,
});

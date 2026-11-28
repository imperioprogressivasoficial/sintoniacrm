/**
 * ia-completa: como a agenda de cada unidade respondeu às últimas chamadas da IA (para a tela "O que a IA faz").
 * Em memória, por processo: a tela mostra "respondeu bem há 3 min" ou "falhou: tempo esgotado".
 */
export interface SituacaoAgenda {
  ok: boolean;
  mensagem: string | null;
  em: Date;
}

const ultima = new Map<string, SituacaoAgenda>();

export function anotarAgenda(unidade: string, ok: boolean, mensagem: string | null = null, em = new Date()): void {
  ultima.set(unidade, { ok, mensagem: mensagem ? mensagem.slice(0, 200) : null, em });
}

export function situacaoDaAgenda(unidade: string): SituacaoAgenda | undefined {
  return ultima.get(unidade);
}

/** Testes. */
export function limparSaudeAgenda(): void {
  ultima.clear();
}

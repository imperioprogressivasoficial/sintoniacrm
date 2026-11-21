/**
 * Catálogo da área de desenvolvedores: escopos das chaves de API e eventos dos webhooks.
 * Uma fonte só: a tela (Integrações), a API pública (/api/v1), o MCP (/mcp), a documentação
 * (/desenvolvedores) e o openapi.json leem daqui.
 */

export const RECURSOS = [
  { id: 'contatos', nome: 'Contatos', descricao: 'Ficha do contato: nome, e-mail, observações e campos personalizados.' },
  { id: 'conversas', nome: 'Conversas', descricao: 'Lista de conversas, etapa e quem atende.' },
  { id: 'mensagens', nome: 'Mensagens', descricao: 'Ler o histórico e enviar mensagens pelo WhatsApp da empresa.' },
  { id: 'funis', nome: 'Funis e leads', descricao: 'Funis, etapas, mover o lead de etapa e o valor do negócio.' },
  { id: 'tags', nome: 'Tags', descricao: 'Aplicar e tirar tags das conversas.' },
  { id: 'agendamentos', nome: 'Agendamentos', descricao: 'Horários marcados e reservas pelos links de agendamento.' },
  { id: 'tarefas', nome: 'Tarefas', descricao: 'Tarefas da rotina da equipe.' },
] as const;
export type Recurso = (typeof RECURSOS)[number]['id'];

export type Acesso = 'ler' | 'escrever';
/** Escopo de uma chave: "contatos:ler", "mensagens:escrever"... Escrever inclui ler. */
export type Escopo = `${Recurso}:${Acesso}`;

export const ESCOPOS: readonly Escopo[] = RECURSOS.flatMap((r) => [`${r.id}:ler`, `${r.id}:escrever`] as Escopo[]);
export const ehEscopo = (s: string): s is Escopo => (ESCOPOS as readonly string[]).includes(s);

/** A chave pode usar este escopo? `x:escrever` vale também para `x:ler`. */
export function temEscopo(escopos: readonly string[], pedido: Escopo): boolean {
  if (escopos.includes(pedido)) return true;
  const [recurso, acesso] = pedido.split(':');
  return acesso === 'ler' && escopos.includes(`${recurso}:escrever`);
}

export const EVENTOS = [
  { id: 'mensagem.recebida', nome: 'Mensagem recebida', descricao: 'O contato mandou uma mensagem.' },
  { id: 'mensagem.enviada', nome: 'Mensagem enviada', descricao: 'A equipe, a IA ou uma integração respondeu.' },
  { id: 'contato.criado', nome: 'Novo lead ou contato', descricao: 'Uma conversa nova começou ou um contato foi cadastrado.' },
  { id: 'lead.etapa_mudou', nome: 'Etapa do funil mudou', descricao: 'O lead mudou de etapa em algum funil.' },
  { id: 'tag.aplicada', nome: 'Tag aplicada', descricao: 'Uma tag foi colocada numa conversa.' },
  { id: 'tag.removida', nome: 'Tag removida', descricao: 'Uma tag foi tirada de uma conversa.' },
  { id: 'agendamento.criado', nome: 'Agendamento criado', descricao: 'Um horário foi marcado.' },
  { id: 'agendamento.cancelado', nome: 'Agendamento cancelado', descricao: 'Um horário marcado foi cancelado.' },
  { id: 'atendimento.finalizado', nome: 'Atendimento finalizado', descricao: 'Alguém da equipe finalizou o atendimento.' },
  { id: 'nps.respondido', nome: 'Pesquisa de satisfação respondida', descricao: 'O contato deu a nota de 0 a 10.' },
] as const;
export type TipoEvento = (typeof EVENTOS)[number]['id'];
export const TIPOS_EVENTO: readonly TipoEvento[] = EVENTOS.map((e) => e.id);
/** Evento do botão "Enviar teste" (não aparece na lista de assinaturas). */
export const EVENTO_TESTE = 'webhook.teste';

/** Prefixo visível das chaves (o resto é segredo). */
export const PREFIXO_CHAVE = 'sk_';
/** Limite padrão de chamadas por minuto de cada chave. */
export const LIMITE_PADRAO_MINUTO = 60;

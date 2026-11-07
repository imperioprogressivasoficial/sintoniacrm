import type { Conversa, UnidadeId } from '../domain.js';
import type { Digitando } from '../store/repositorio.js';
import type { Papel, Usuario } from './contas.js';

/**
 * Regras de "quem vê o quê" e "quem gerencia quem". Funções puras: o servidor e a Sintonia
 * só perguntam aqui, e os testes conferem cada papel sem subir nada.
 */

export const UNIDADES_EQUIPE: readonly UnidadeId[] = ['norte', 'sumare', 'feira'];

export const NOME_PAPEL: Record<Papel, string> = {
  atendente: 'Atendente',
  recepcionista: 'Recepcionista',
  gerente: 'Gerente',
  direcao: 'Direção',
  admin: 'Administração',
};

/** Quem a tela e o servidor tratam como "pessoa da equipe" numa ação (nome vem da sessão). */
export type Quem = Pick<Usuario, 'id' | 'nome' | 'papel' | 'unidades'> & Partial<Pick<Usuario, 'empresaId'>>;

/** Admin e direção veem todas as conversas. */
export const veTudo = (u: Pick<Usuario, 'papel'>) => u.papel === 'admin' || u.papel === 'direcao';

/** Gerente, direção e admin: gerenciam a equipe e passam por cima da anti-duplicidade. */
export const ehGestor = (u: Pick<Usuario, 'papel'>) => u.papel === 'gerente' || veTudo(u);

/**
 * Pode ver (e agir sobre) a conversa?
 * - admin e direção: tudo;
 * - gerente: conversas das unidades dele;
 * - atendente e recepcionista: das unidades dela, que são dela ou estão sem dona.
 */
export function podeVer(u: Quem, c: Conversa): boolean {
  if (u.empresaId && u.empresaId !== c.empresaId) return false;
  if (veTudo(u)) return true;
  if (!u.unidades.includes(c.unidade)) return false;
  if (u.papel === 'gerente') return true;
  return !c.responsavelId || c.responsavelId === u.id;
}

/**
 * O mesmo "quem vê o quê" de podeVer, em forma de filtro (serve para o SQL do painel e das tags).
 * Vazio = vê tudo (sem login). Mantenha as duas funções juntas: o teste confere que dizem o mesmo.
 */
export interface EscopoVisao {
  empresaId?: string;
  /** Só conversas destas unidades. */
  unidades?: string[];
  /** Só conversas sem dona ou desta pessoa. */
  donaOuSemDona?: string;
}

export function escopoDe(u: Quem | undefined): EscopoVisao {
  if (!u) return {};
  const base: EscopoVisao = u.empresaId ? { empresaId: u.empresaId } : {};
  if (veTudo(u)) return base;
  if (u.papel === 'gerente') return { ...base, unidades: [...u.unidades] };
  return { ...base, unidades: [...u.unidades], donaOuSemDona: u.id };
}

/** A conversa está dentro do escopo? (versão em memória do filtro SQL) */
export function noEscopo(e: EscopoVisao, c: Pick<Conversa, 'empresaId' | 'unidade' | 'responsavelId'>): boolean {
  if (e.empresaId && e.empresaId !== c.empresaId) return false;
  if (e.unidades && !e.unidades.includes(c.unidade)) return false;
  if (e.donaOuSemDona && c.responsavelId && c.responsavelId !== e.donaOuSemDona) return false;
  return true;
}

/** Pode passar a conversa para outra pessoa? Gestor que a vê, ou a própria dona. */
export const podeTransferir = (u: Quem, c: Conversa) => podeVer(u, c) && (ehGestor(u) || c.responsavelId === u.id);

/** Pode assumir? Se está sem dona, quem a vê; se já tem dona, só gestor (ou já é dela). */
export const podeAssumir = (u: Quem, c: Conversa) =>
  podeVer(u, c) && (!c.responsavelId || c.responsavelId === u.id || ehGestor(u));

/** Pode receber a conversa numa transferência? Ativa e com acesso à unidade dela. */
export function podeReceber(alvo: Usuario, c: Conversa): boolean {
  if (!alvo.ativo || alvo.empresaId !== c.empresaId) return false;
  return veTudo(alvo) || alvo.unidades.includes(c.unidade);
}

/** Quem vira dona automaticamente ao mandar a primeira resposta (gestores só estão ajudando). */
export const viraDonaAoResponder = (u: Pick<Usuario, 'papel'>) => u.papel === 'atendente' || u.papel === 'recepcionista';

/**
 * Anti-duplicidade: se outra pessoa começou a responder antes (sinal de digitação válido),
 * o envio de quem chegou depois é recusado, a menos que seja a dona ou gestor.
 * Devolve a mensagem de recusa, ou null se pode seguir.
 */
export function bloqueioPorDigitacao(u: Quem, c: Conversa, digitando: Digitando[]): string | null {
  if (ehGestor(u) || c.responsavelId === u.id) return null;
  const primeira = digitando[0];
  if (!primeira || primeira.usuarioId === u.id) return null;
  return `${primeira.nome} já está respondendo esta conversa. Espere ela terminar ou peça para a gerente transferir a conversa para você.`;
}

// ---------------------------------------------------------------- equipe

/** Papéis que este gestor pode dar a alguém. */
export function papeisQuePodeDar(g: Pick<Usuario, 'papel'>): Papel[] {
  if (g.papel === 'admin') return ['atendente', 'recepcionista', 'gerente', 'direcao', 'admin'];
  if (g.papel === 'direcao') return ['atendente', 'recepcionista', 'gerente', 'direcao'];
  if (g.papel === 'gerente') return ['atendente', 'recepcionista'];
  return [];
}

/** Unidades que este gestor pode atribuir. */
export const unidadesQuePodeDar = (g: Pick<Usuario, 'papel' | 'unidades'>): UnidadeId[] =>
  veTudo(g) ? [...UNIDADES_EQUIPE] : g.papel === 'gerente' ? UNIDADES_EQUIPE.filter((u) => g.unidades.includes(u)) : [];

/**
 * Pode gerenciar (editar, desativar, redefinir a senha de) esta pessoa?
 * Ninguém se gerencia por aqui (a própria senha é trocada na Conta). Admin gerencia todos;
 * direção, todos menos admin; gerente, só atendentes e recepcionistas que trabalham apenas nas unidades dele.
 */
export function podeGerenciar(g: Usuario, alvo: Usuario): boolean {
  if (g.id === alvo.id || g.empresaId !== alvo.empresaId) return false;
  if (g.papel === 'admin') return true;
  if (g.papel === 'direcao') return alvo.papel !== 'admin';
  if (g.papel === 'gerente') {
    return (
      (alvo.papel === 'atendente' || alvo.papel === 'recepcionista') &&
      alvo.unidades.length > 0 &&
      alvo.unidades.every((x) => g.unidades.includes(x))
    );
  }
  return false;
}

/** Pode dar este papel e estas unidades (ao criar ou editar)? Devolve o motivo da recusa, ou null. */
export function recusaAtribuicao(g: Usuario, papel: Papel, unidades: string[]): string | null {
  if (!papeisQuePodeDar(g).includes(papel)) return `Você não pode dar o papel ${NOME_PAPEL[papel]}.`;
  const permitidas = unidadesQuePodeDar(g) as string[];
  if (unidades.some((x) => !permitidas.includes(x))) return 'Você só pode escolher unidades que você gerencia.';
  if (g.papel === 'gerente' && !unidades.length) return 'Escolha pelo menos uma unidade.';
  return null;
}

/** Quem aparece na lista da Equipe para este gestor. */
export function apareceNaEquipe(g: Usuario, alvo: Usuario): boolean {
  if (g.empresaId !== alvo.empresaId) return false;
  if (veTudo(g) || g.id === alvo.id) return true;
  return alvo.unidades.some((x) => g.unidades.includes(x));
}

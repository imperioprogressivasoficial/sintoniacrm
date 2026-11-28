import type { Conversa, Mensagem, UnidadeId } from '../domain.js';
import { horaDoSistema } from '../agenda/agenda-externa.js';
import { agendaDaUnidade } from '../agenda/agendar.js';
import type { ClienteAgenda, FonteAgenda } from '../agenda/sistema.js';
import { unidadeDe, unidadesComAgenda } from '../unidades.js';
import { dataISO, DIA, horaHHmm, MIN } from '../util/tempo.js';

/**
 * serena-regras (itens 1 e 2): quem é a cliente que escreve, antes de a IA pensar.
 * A IA já tem o número do WhatsApp: procura o cadastro na agenda do salão (Trinks) pelo telefone e, se não achar,
 * pelo nome do perfil do WhatsApp (segunda chave: aí ela confirma "É para você, [Nome]?"). Vai pronto para o prompt
 * (bloco <cliente_conhecida>), sem a IA gastar uma chamada de ferramenta para isso.
 *
 * Cuidado com a cota: o resultado fica guardado 10 minutos por telefone (a conversa inteira usa a mesma consulta);
 * no máximo umas 3 chamadas na primeira mensagem (telefone, histórico e, se preciso, nome).
 */

export interface ClienteConhecida {
  /** Tem cadastro/atendimento na agenda ou já agendou por esta conversa. */
  conhecida: boolean;
  /** Nome no cadastro da agenda. */
  nome: string | null;
  /** Como foi achada. */
  por: 'telefone' | 'nome_do_perfil' | 'conversa' | null;
  /** Achada só pelo nome: confirme com ela antes de usar o cadastro. */
  confirmar: boolean;
  /** Unidade em que o cadastro foi achado. */
  unidade: UnidadeId | null;
  clienteId: number | null;
  ultimoAtendimento: { data: string; servico: string | null; unidade: UnidadeId } | null;
  proximoHorario: { data: string; hora: string; unidade: UnidadeId } | null;
  /** A agenda não respondeu a tempo: a IA pode usar buscar_cliente. */
  semResposta?: boolean;
  /**
   * dono 28/11 (a Serena chamou a Tássia de "Giovanna"): o nome do cadastro só vale quando bate com o nome do perfil
   * do WhatsApp (mesmo primeiro nome). Senão o número pode ser de outra pessoa: não chama por nome e confirma antes.
   */
  nomeConfirmado?: boolean;
}

const VAZIA: ClienteConhecida = { conhecida: false, nome: null, por: null, confirmar: false, unidade: null, clienteId: null, ultimoAtendimento: null, proximoHorario: null };

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Nome do perfil que serve como chave: pelo menos nome e sobrenome (um "Ma" ou "💜" não identifica ninguém). */
export const nomeServeDeChave = (nome: string | null | undefined): boolean => Boolean(nome && semAcento(nome).split(' ').filter((p) => p.length >= 2).length >= 2);

/** O nome do cadastro bate com o nome do perfil (todas as palavras do perfil estão no cadastro, em ordem livre). */
export function mesmoNome(cadastro: string | null | undefined, perfil: string): boolean {
  if (!cadastro) return false;
  const c = new Set(semAcento(cadastro).split(' '));
  const p = semAcento(perfil).split(' ').filter((x) => x.length >= 2);
  return p.length >= 2 && p.every((x) => c.has(x));
}

type Guardada = { expira: number; promessa: Promise<ClienteConhecida> };
const cache = new Map<string, Guardada>();
const TTL = 10 * MIN;

/** Esquece o que foi guardado da cliente (ela acabou de agendar ou se cadastrar). Sem telefone: tudo (testes). */
export function esquecerCliente(telefone?: string): void {
  if (!telefone) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${telefone}|`)) cache.delete(k);
}

/** Ids de cadastro que a IA viu para esta cliente (podem ir em agendar.cliente_id). "unidade:id". */
export async function idsConhecidos(telefone: string): Promise<Set<string>> {
  const s = new Set<string>();
  for (const [k, g] of cache) {
    if (!k.startsWith(`${telefone}|`) || g.expira < Date.now()) continue;
    const r = await g.promessa.catch(() => VAZIA);
    if (r.clienteId && r.unidade) s.add(`${r.unidade}:${r.clienteId}`);
  }
  return s;
}

/** Unidades com agenda, a da conversa primeiro. */
function unidadesEmOrdem(c: Conversa): UnidadeId[] {
  const l = unidadesComAgenda();
  return [...l.filter((u) => u === c.unidade), ...l.filter((u) => u !== c.unidade)];
}

/** Último atendimento e próximo horário de uma cliente numa unidade (uma chamada só). */
async function historico(fonte: FonteAgenda, unidade: UnidadeId, clienteId: number, agora: Date): Promise<Pick<ClienteConhecida, 'ultimoAtendimento' | 'proximoHorario'>> {
  const { sistema, local, tipo } = agendaDaUnidade(fonte, unidade);
  const lista = await sistema.listarAgendamentosDoCliente(local, clienteId, dataISO(new Date(agora.getTime() - 730 * DIA)), dataISO(new Date(agora.getTime() + 120 * DIA)));
  const validos = lista
    .filter((a) => !a.cancelado && !(tipo === 'trinks' && a.status?.id === 9))
    .map((a) => ({ a, inicio: horaDoSistema(String(a.dataHoraInicio)) }))
    .filter((x): x is { a: (typeof lista)[number]; inicio: Date } => Boolean(x.inicio))
    .sort((x, y) => x.inicio.getTime() - y.inicio.getTime());
  const passados = validos.filter((x) => x.inicio.getTime() <= agora.getTime());
  const futuro = validos.find((x) => x.inicio.getTime() > agora.getTime());
  const ult = passados.at(-1);
  return {
    ultimoAtendimento: ult ? { data: dataISO(ult.inicio), servico: ult.a.servico?.nome ?? null, unidade } : null,
    proximoHorario: futuro ? { data: dataISO(futuro.inicio), hora: horaHHmm(futuro.inicio), unidade } : null,
  };
}

async function consultar(fonte: FonteAgenda, c: Conversa, agora: Date, nomePerfil: string | null): Promise<ClienteConhecida> {
  const unidades = unidadesEmOrdem(c);
  let falhas = 0;
  let achada: { unidade: UnidadeId; cliente: ClienteAgenda; por: 'telefone' | 'nome_do_perfil' } | null = null;
  // 1) Pelo telefone do WhatsApp (ou o id que a conversa já guardou, na unidade dela).
  for (const u of unidades) {
    try {
      const { sistema, local } = agendaDaUnidade(fonte, u);
      const cli = await sistema.buscarClientePorTelefone(local, c.telefone);
      if (cli) {
        achada = { unidade: u, cliente: cli, por: 'telefone' };
        break;
      }
    } catch {
      falhas++;
    }
  }
  // 2) Pelo nome do perfil: dono 28/11, só quando a busca pelo telefone deu erro (o telefone basta para agendar).
  if (!achada && falhas > 0 && nomePerfil && nomeServeDeChave(nomePerfil)) {
    for (const u of unidades) {
      try {
        const { sistema, local } = agendaDaUnidade(fonte, u);
        if (!sistema.buscarClientesPorNome) continue;
        const iguais = (await sistema.buscarClientesPorNome(local, nomePerfil)).filter((x) => mesmoNome(x.nome, nomePerfil));
        if (iguais.length === 1) {
          achada = { unidade: u, cliente: iguais[0]!, por: 'nome_do_perfil' };
          break;
        }
      } catch {
        falhas++;
      }
    }
  }
  if (!achada) {
    // Já agendou por esta conversa (id guardado), mesmo que a busca agora não ache.
    if (c.trinksClienteId) return { ...VAZIA, conhecida: true, por: 'conversa', clienteId: c.trinksClienteId, unidade: c.unidade, nome: null, ...(falhas ? { semResposta: true } : {}) };
    return { ...VAZIA, ...(falhas && falhas >= unidades.length ? { semResposta: true } : {}) };
  }
  let hist: Pick<ClienteConhecida, 'ultimoAtendimento' | 'proximoHorario'> = { ultimoAtendimento: null, proximoHorario: null };
  try {
    hist = await historico(fonte, achada.unidade, achada.cliente.id, agora);
  } catch {
    /* sem histórico: fica só o cadastro */
  }
  const nomeCad = achada.cliente.nome?.trim() || null;
  const primeiro = (n: string | null) => (n ? semAcento(n).split(' ').find((x) => x.length >= 2) ?? '' : '');
  const nomeConfirmado = achada.por === 'nome_do_perfil' || Boolean(nomeCad && nomePerfil && primeiro(nomeCad) && primeiro(nomeCad) === primeiro(nomePerfil));
  return {
    conhecida: true,
    nome: nomeCad,
    nomeConfirmado,
    por: achada.por,
    confirmar: achada.por === 'nome_do_perfil',
    unidade: achada.unidade,
    clienteId: achada.cliente.id,
    ...hist,
  };
}

/**
 * Quem é a cliente (com cache de 10 min). Espera no máximo `prazoMs`; se a agenda demorar, devolve "sem resposta"
 * e a consulta segue: o resultado fica guardado para a próxima mensagem.
 */
export async function conhecerCliente(fonte: FonteAgenda, c: Conversa, agora: Date, op: { prazoMs?: number; forcar?: boolean } = {}): Promise<ClienteConhecida> {
  const nomePerfil = c.nome?.trim() || null;
  const chave = `${c.telefone}|${nomePerfil ?? ''}`;
  const t = Date.now();
  let g = cache.get(chave);
  if (!g || g.expira < t || op.forcar) {
    const novo: Guardada = { expira: t + TTL, promessa: consultar(fonte, c, agora, nomePerfil) };
    // Falha ou "sem resposta" não fica guardada (a próxima mensagem tenta de novo).
    novo.promessa.then(
      (r) => {
        if (r.semResposta && cache.get(chave) === novo) cache.delete(chave);
      },
      () => cache.get(chave) === novo && cache.delete(chave),
    );
    cache.set(chave, novo);
    g = novo;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<ClienteConhecida>((ok) => {
    timer = setTimeout(() => ok({ ...VAZIA, ...(c.trinksClienteId ? { conhecida: true, por: 'conversa' as const, clienteId: c.trinksClienteId, unidade: c.unidade } : {}), semResposta: true }), op.prazoMs ?? 6000);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([g.promessa.catch(() => ({ ...VAZIA, semResposta: true })), prazo]);
  } finally {
    clearTimeout(timer);
  }
}

/** Primeira resposta da loja nesta conversa (ninguém da loja escreveu ainda). */
export const primeiraResposta = (mensagens: Mensagem[]): boolean => !mensagens.some((m) => m.autor === 'ia' || m.autor === 'equipe');

const diaBr = (iso: string) => iso.split('-').reverse().join('/');

/** Bloco pronto para o prompt. */
export function textoClienteConhecida(k: ClienteConhecida, primeira: boolean): string {
  const linhas = [`cliente_conhecida: ${k.conhecida ? 'sim' : 'não'}`];
  if (k.nome && (k.nomeConfirmado ?? true)) linhas.push(`nome no cadastro: ${k.nome}`);
  if (k.nome && k.nomeConfirmado === false) linhas.push('o número tem cadastro, mas o nome do cadastro não bate com o do perfil: NÃO chame a cliente por nome nenhum. O agendamento vale pelo número: não peça nome nem dados.');
  if (k.por === 'telefone') linhas.push('achada pelo número do WhatsApp');
  if (k.por === 'nome_do_perfil') linhas.push('achada pelo nome do perfil do WhatsApp (número diferente): confirme antes de usar o cadastro ("É para você, [primeiro nome]?")');
  if (k.por === 'conversa') linhas.push('já agendou por esta conversa');
  if (k.ultimoAtendimento) linhas.push(`último atendimento: ${diaBr(k.ultimoAtendimento.data)}${k.ultimoAtendimento.servico ? `, ${k.ultimoAtendimento.servico}` : ''}, ${unidadeDe(k.ultimoAtendimento.unidade).nome}`);
  if (k.proximoHorario) linhas.push(`próximo horário marcado: ${diaBr(k.proximoHorario.data)} às ${k.proximoHorario.hora}, ${unidadeDe(k.proximoHorario.unidade).nome}`);
  if (k.semResposta) linhas.push('a agenda não respondeu a tempo: se precisar, use buscar_cliente');
  linhas.push(`primeira resposta da loja nesta conversa: ${primeira ? 'sim' : 'não'}`);
  const guia = k.conhecida && k.nomeConfirmado === false
    ? 'Nome não confirmado: boas-vindas sem nome nenhum. Agende pelo número (cadastro já existe), sem pedir dados.'
    : k.conhecida
    ? 'Cliente que volta: não peça nome, nascimento nem e-mail (o cadastro já existe). Se for a primeira resposta, use a boas-vindas de quem volta.'
    : 'Cliente nova: depois que ela escolher o horário, peça nome completo, data de nascimento, e-mail e o que a base pedir (ex.: a maior dificuldade dela); o telefone é o do WhatsApp. Grave nas observações do agendamento.';
  return `<cliente_conhecida>\n${linhas.join('\n')}\n${guia}\n</cliente_conhecida>`;
}

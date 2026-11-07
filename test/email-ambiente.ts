import { Sintonia } from '../src/app/sintonia.js';
import { ArmazemAutomacoesPostgres, Automacoes, ligarFunis } from '../src/automacoes/automacoes.js';
import { calendarioPostgres } from '../src/automacoes/calendario.js';
import { ContasPostgres, type Papel, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import type { Conversa } from '../src/domain.js';
import { EmailMarketing } from '../src/email/email.js';
import { registrarEmail } from '../src/email/rotas.js';
import { TransporteFalso } from '../src/email/transporte.js';
import { ArmazemFunisPostgres, Funis } from '../src/funis/funis.js';
import { registrarFunis } from '../src/rotas/funis.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { ArmazemTagsPostgres, Tags } from '../src/tags/tags.js';
import { AgenteFalso, quinta } from './gestao-ambiente.js';
import { poolDeTeste } from './repos.js';

const hashPadrao = gerarHash('Imperio2026xyz');

/**
 * Servidor completo (Sintonia, funis, automações, e-mail) sobre o Postgres de teste, com o transportador
 * SMTP falso: nada sai de verdade. `reiniciar()` cria outra instância lendo o mesmo banco.
 */
export async function montarEmail(opcoes: { inicio?: Date } = {}) {
  const pool = await poolDeTeste();
  await pool.query('truncate sintonia.email_eventos, sintonia.email_envios, sintonia.email_supressoes, sintonia.email_campanhas, sintonia.email_modelos, sintonia.email_contas restart identity cascade');
  const repo = new RepositorioPostgres(pool);
  const contas = new ContasPostgres(pool);
  const relogio = { t: opcoes.inicio ?? quinta(14) };
  const agora = () => relogio.t;
  const falso = new TransporteFalso();
  const cofre = new Cofre('segredo-de-teste');
  const enviadosWhats: string[] = [];
  const lidas: Array<{ uid: number; fonte: Buffer }> = [];

  const instancia = () => {
    const canal: CanalWhatsApp = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async (_c, _t, texto) => (enviadosWhats.push(texto), { idExterno: `out-${Math.random()}` }) };
    const tags = new Tags(new ArmazemTagsPostgres(pool), 'imperio', agora);
    let sintonia: Sintonia;
    const funis = new Funis({ armazem: new ArmazemFunisPostgres(pool), armazemTags: new ArmazemTagsPostgres(pool), tags, repo, empresaId: 'imperio', agora, comConversa: (id, fn) => sintonia.comConversa(id, fn) });
    const email = new EmailMarketing({
      pool,
      cofre,
      empresaId: 'imperio',
      transporte: falso.fabrica,
      urlPublica: 'https://crm.imperio.test',
      agora,
      lerImap: async (c) => ({ mensagens: lidas.splice(0).filter((m) => m.uid > c.ultimoUid), ultimoUid: c.ultimoUid + 1 }),
    });
    const automacoes = new Automacoes({ armazem: new ArmazemAutomacoesPostgres(pool), repo, empresaId: 'imperio', sintonia: () => sintonia, funis, tags, contas, agora, email, calendario: calendarioPostgres(pool, 'imperio') });
    sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }, { canalId: 'imperio-sumare', unidade: 'sumare', canal }], agente: new AgenteFalso(), agora, ganchos: ligarFunis({ tags, funis, automacoes }) });
    const app = criarServidor({ sintonia, repo, agora, auth: { contas, agora }, gestao: { tags } });
    registrarFunis(app, { repo, funis, automacoes });
    registrarEmail(app, { email });
    return { sintonia, funis, automacoes, tags, email, app };
  };
  let atual = instancia();

  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) => contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = { admin: await pessoa('Bruno Batista', 'admin', []), gerenteNorte: await pessoa('Gil Norte', 'gerente', ['norte']), carla: await pessoa('Carla Lima', 'atendente', ['norte']) };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    let cookie = '';
    if (u) {
      cookie = cookies.get(u.id) ?? `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 400 * 86400_000))}`;
      cookies.set(u.id, cookie);
    }
    const r = await atual.app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), host: 'crm.imperio.test', ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    await atual.automacoes.ocioso();
    return r;
  };

  let tel = 0;
  /** Cliente com conversa (WhatsApp) e ficha com e-mail. */
  const cliente = async (p: { nome: string; email?: string | null; unidade?: 'norte' | 'sumare'; nascimento?: string }): Promise<Conversa> => {
    const unidade = p.unidade ?? 'norte';
    const telefone = `557198800${String(++tel).padStart(4, '0')}`;
    await atual.sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome: p.nome, texto: 'Oi', deMim: false, idExterno: `in-${telefone}`, em: relogio.t });
    await pool.query(
      `insert into sintonia.contatos (empresa_id, telefone, nome, email, nascimento, atualizado_em) values ('imperio', $1, $2, $3, $4, $5)
       on conflict (empresa_id, telefone) do update set email = excluded.email, nome = excluded.nome, nascimento = excluded.nascimento`,
      [telefone, p.nome, p.email ?? null, p.nascimento ?? null, new Date(relogio.t.getTime() + tel * 1000)],
    );
    await atual.automacoes.ocioso();
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };

  return {
    pool,
    repo,
    relogio,
    falso,
    gente,
    lidas,
    enviadosWhats,
    como,
    cliente,
    get email() {
      return atual.email;
    },
    get automacoes() {
      return atual.automacoes;
    },
    get tags() {
      return atual.tags;
    },
    get funis() {
      return atual.funis;
    },
    reiniciar() {
      atual = instancia();
    },
    avancar(min: number) {
      relogio.t = new Date(relogio.t.getTime() + min * 60_000);
    },
  };
}

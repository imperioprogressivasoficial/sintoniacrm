import { describe, expect, it } from 'vitest';
import { ContasMemoria, ContasPostgres, type Contas, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { ArmazemEquipeMemoria, ArmazemEquipePostgres, type ArmazemEquipe } from '../src/equipe/armazem.js';
import { ChatEquipe, type Aviso } from '../src/equipe/chat.js';
import { avisoPorPush, registrarChatEquipe } from '../src/equipe/rotas.js';
import { PREFERENCIAS_PADRAO, type Notificacao } from '../src/notificacoes/tipos.js';
import { PresencasMemoria } from '../src/presenca/presenca.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia, HORA } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);
const QUINTA = bahia(2026, 11, 5, 14, 0);

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  lerWebhook() {
    return [];
  }
  async enviarTexto() {
    return { idExterno: `out-${Math.random()}` };
  }
}

interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; contas: Contas; armazem: ArmazemEquipe }>;
}
const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria(), armazem: new ArmazemEquipeMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.equipe_mensagens, sintonia.equipe_membros, sintonia.equipe_salas restart identity cascade');
            return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), armazem: new ArmazemEquipePostgres(pool) };
          },
        },
      ]
    : []),
];

async function montar(a: Ambiente) {
  const { repo, contas, armazem } = await a.criar();
  const relogio = { t: QUINTA };
  const agora = () => relogio.t;
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal: new CanalFalso() }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora, configIa: async () => ({ modoPadrao: 'humano' }) });
  const presencas = new PresencasMemoria();
  const avisos: Aviso[] = [];
  const chat = new ChatEquipe({ armazem, contas, repo, presencas, avisar: (x) => void avisos.push(x), agora });
  const app = criarServidor({ sintonia, repo, agora, auth: { contas, agora } });
  registrarChatEquipe(app, { chat });
  const h = await hashPadrao;
  const pessoa = (nome: string, papel: 'admin' | 'atendente' | 'gerente', unidades: string[], empresaId = 'imperio') =>
    contas.criarUsuario({ empresaId, nome, email: `${nome.split(' ')[0]!.toLowerCase()}@${empresaId}.com`, papel, unidades, senhaHash: h });
  const gente = {
    bruno: await pessoa('Bruno Batista', 'admin', []),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
    dani: await pessoa('Dani Souza', 'atendente', ['sumare']),
    outra: await pessoa('Olga Fora', 'admin', [], 'outra'),
  };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 30 * 24 * HORA))}`));
    const r = await app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    await chat.ocioso();
    return { status: r.statusCode, json: r.json() as Record<string, any> };
  };
  const passar = (seg = 1) => (relogio.t = new Date(relogio.t.getTime() + seg * 1000));
  return { app, repo, sintonia, chat, presencas, avisos, gente, como, passar, relogio };
}

for (const a of ambientes) {
  describe(`conversas de equipe (${a.nome})`, () => {
    it('exige login', async () => {
      const m = await montar(a);
      const r = await m.app.inject({ method: 'GET', url: '/api/equipe/chat' });
      expect(r.statusCode).toBe(401);
    });

    it('cria o "Geral" com todas as pessoas ativas da empresa (e só dela)', async () => {
      const m = await montar(a);
      const r = await m.como(m.gente.carla, 'GET', '/api/equipe/chat');
      expect(r.status).toBe(200);
      const geral = r.json.salas.find((s: any) => s.geral);
      expect(geral.nome).toBe('Geral');
      expect(geral.membros).toBe(3);
      const p = await m.como(m.gente.carla, 'GET', '/api/equipe/chat/pessoas');
      expect(p.json.pessoas.map((x: any) => x.nome)).toEqual(['Bruno Batista', 'Dani Souza']);
      // A outra empresa tem o seu próprio Geral, sem ninguém da Império.
      const o = await m.como(m.gente.outra, 'GET', '/api/equipe/chat');
      const g2 = o.json.salas.find((s: any) => s.geral);
      expect(g2.id).not.toBe(geral.id);
      expect(g2.membros).toBe(1);
    });

    it('conversa direta: uma só por par, envia, conta não lidas e marca como lida', async () => {
      const m = await montar(a);
      const d1 = await m.como(m.gente.carla, 'POST', '/api/equipe/chat/direta', { pessoaId: m.gente.dani.id });
      const d2 = await m.como(m.gente.dani, 'POST', '/api/equipe/chat/direta', { pessoaId: m.gente.carla.id });
      expect(d1.status).toBe(200);
      expect(d2.json.id).toBe(d1.json.id);
      const sala = d1.json.id as string;

      m.passar();
      const e1 = await m.como(m.gente.carla, 'POST', `/api/equipe/chat/salas/${sala}/mensagens`, { texto: '  Oi, Dani! Pode cobrir meu horário?  ' });
      expect(e1.status).toBe(200);
      expect(e1.json.mensagem.texto).toBe('Oi, Dani! Pode cobrir meu horário?');
      m.passar();
      await m.como(m.gente.carla, 'POST', `/api/equipe/chat/salas/${sala}/mensagens`, { texto: 'É às 15h.', respostaA: e1.json.mensagem.id });

      // Aviso de mensagem nova vai só para a Dani.
      expect(m.avisos.at(-1)).toMatchObject({ para: [m.gente.dani.id], titulo: 'Carla Lima', texto: 'É às 15h.' });

      const ld = await m.como(m.gente.dani, 'GET', '/api/equipe/chat');
      const s = ld.json.salas.find((x: any) => x.id === sala);
      expect(s).toMatchObject({ tipo: 'direta', nome: 'Carla Lima', naoLidas: 2, ultima: { texto: 'É às 15h.' } });
      expect(ld.json.salas[0].id).toBe(sala); // mais recente primeiro
      expect((await m.como(m.gente.dani, 'GET', '/api/equipe/chat/resumo')).json.naoLidas).toBe(2);
      // Quem escreveu não tem não lidas.
      expect((await m.como(m.gente.carla, 'GET', '/api/equipe/chat/resumo')).json.naoLidas).toBe(0);

      const msgs = await m.como(m.gente.dani, 'GET', `/api/equipe/chat/salas/${sala}/mensagens`);
      expect(msgs.json.mensagens).toHaveLength(2);
      expect(msgs.json.mensagens[1].resposta).toMatchObject({ autorNome: 'Carla Lima', texto: 'Oi, Dani! Pode cobrir meu horário?' });
      expect(msgs.json.vistoAte).toBe(msgs.json.mensagens[1].seq); // a Carla leu as próprias

      // Só as novas depois de um seq.
      const novas = await m.como(m.gente.dani, 'GET', `/api/equipe/chat/salas/${sala}/mensagens?depois=${msgs.json.mensagens[0].seq}`);
      expect(novas.json.mensagens.map((x: any) => x.texto)).toEqual(['É às 15h.']);

      const v1 = (await m.como(m.gente.dani, 'GET', '/api/equipe/chat/resumo')).json.versao;
      expect((await m.como(m.gente.dani, 'POST', `/api/equipe/chat/salas/${sala}/lida`)).status).toBe(200);
      const r2 = (await m.como(m.gente.dani, 'GET', '/api/equipe/chat/resumo')).json;
      expect(r2.naoLidas).toBe(0);
      expect(r2.versao).not.toBe(v1);
      // A Carla vê que a Dani leu.
      const visto = await m.como(m.gente.carla, 'GET', `/api/equipe/chat/salas/${sala}/mensagens`);
      expect(visto.json.vistoAte).toBe(visto.json.mensagens[1].seq);
    });

    it('grupo: cria com nome e pessoas, todo mundo do grupo recebe, quem sai deixa de ver', async () => {
      const m = await montar(a);
      const g = await m.como(m.gente.bruno, 'POST', '/api/equipe/chat/grupos', { nome: 'Recepção', pessoas: [m.gente.carla.id, m.gente.dani.id] });
      expect(g.status).toBe(200);
      const sala = g.json.id as string;
      m.passar();
      await m.como(m.gente.bruno, 'POST', `/api/equipe/chat/salas/${sala}/mensagens`, { texto: 'Reunião às 18h' });
      expect(m.avisos.at(-1)!.para.sort()).toEqual([m.gente.carla.id, m.gente.dani.id].sort());
      expect(m.avisos.at(-1)!.titulo).toBe('Bruno Batista · Recepção');
      const lc = await m.como(m.gente.carla, 'GET', '/api/equipe/chat');
      expect(lc.json.salas.find((s: any) => s.id === sala)).toMatchObject({ nome: 'Recepção', naoLidas: 1, membros: 3 });

      expect((await m.como(m.gente.carla, 'PATCH', `/api/equipe/chat/salas/${sala}`, { nome: 'Recepção Norte' })).status).toBe(200);
      expect((await m.como(m.gente.dani, 'POST', `/api/equipe/chat/salas/${sala}/sair`)).status).toBe(200);
      expect((await m.como(m.gente.dani, 'GET', `/api/equipe/chat/salas/${sala}/mensagens`)).status).toBe(404);
      expect((await m.como(m.gente.dani, 'GET', '/api/equipe/chat')).json.salas.some((s: any) => s.id === sala)).toBe(false);

      // Validações.
      expect((await m.como(m.gente.bruno, 'POST', '/api/equipe/chat/grupos', { nome: '', pessoas: [m.gente.carla.id] })).status).toBe(400);
      expect((await m.como(m.gente.bruno, 'POST', '/api/equipe/chat/grupos', { nome: 'X', pessoas: [m.gente.outra.id] })).status).toBe(400);
      expect((await m.como(m.gente.bruno, 'POST', `/api/equipe/chat/salas/${sala}/mensagens`, { texto: 'a'.repeat(4001) })).status).toBe(400);
      expect((await m.como(m.gente.bruno, 'POST', `/api/equipe/chat/salas/${sala}/mensagens`, { texto: '   ' })).status).toBe(400);
      // Não dá para sair do Geral.
      const geral = (await m.como(m.gente.bruno, 'GET', '/api/equipe/chat')).json.salas.find((s: any) => s.geral);
      expect((await m.como(m.gente.bruno, 'POST', `/api/equipe/chat/salas/${geral.id}/sair`)).status).toBe(400);
    });

    it('quem não participa não lê nem escreve (nem de outra empresa)', async () => {
      const m = await montar(a);
      const d = await m.como(m.gente.carla, 'POST', '/api/equipe/chat/direta', { pessoaId: m.gente.dani.id });
      const sala = d.json.id as string;
      await m.como(m.gente.carla, 'POST', `/api/equipe/chat/salas/${sala}/mensagens`, { texto: 'segredo' });
      for (const u of [m.gente.bruno, m.gente.outra]) {
        expect((await m.como(u, 'GET', `/api/equipe/chat/salas/${sala}/mensagens`)).status).toBe(404);
        expect((await m.como(u, 'POST', `/api/equipe/chat/salas/${sala}/mensagens`, { texto: 'oi' })).status).toBe(404);
        expect((await m.como(u, 'POST', `/api/equipe/chat/salas/${sala}/lida`)).status).toBe(404);
        expect((await m.como(u, 'GET', '/api/equipe/chat')).json.salas.some((s: any) => s.id === sala)).toBe(false);
      }
      // Não dá para abrir conversa direta com alguém de outra empresa.
      expect((await m.como(m.gente.outra, 'POST', '/api/equipe/chat/direta', { pessoaId: m.gente.carla.id })).status).toBe(404);
      // Responder a uma mensagem de outra sala não vale.
      const g = await m.como(m.gente.bruno, 'POST', '/api/equipe/chat/grupos', { nome: 'G', pessoas: [m.gente.carla.id] });
      const outraMsg = (await m.como(m.gente.carla, 'GET', `/api/equipe/chat/salas/${sala}/mensagens`)).json.mensagens[0].id;
      expect((await m.como(m.gente.carla, 'POST', `/api/equipe/chat/salas/${g.json.id}/mensagens`, { texto: 'x', respostaA: outraMsg })).status).toBe(400);
    });

    it('compartilha conversa de cliente: só quem pode ver a conversa vê o nome', async () => {
      const m = await montar(a);
      await m.sintonia.receber({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina Souza', texto: 'Oi', deMim: false, idExterno: 'in-1', em: m.relogio.t });
      const c = (await m.repo.listarConversas())[0]!;
      const g = await m.como(m.gente.bruno, 'POST', '/api/equipe/chat/grupos', { nome: 'Todos', pessoas: [m.gente.carla.id, m.gente.dani.id] });
      // A Dani (Sumaré) não vê a conversa da Norte: não pode compartilhar.
      expect((await m.como(m.gente.dani, 'POST', `/api/equipe/chat/salas/${g.json.id}/mensagens`, { conversaId: c.id })).status).toBe(404);
      const e = await m.como(m.gente.carla, 'POST', `/api/equipe/chat/salas/${g.json.id}/mensagens`, { texto: 'Olha essa cliente', conversaId: c.id });
      expect(e.status).toBe(200);
      expect(e.json.mensagem.conversa).toMatchObject({ id: c.id, nome: 'Marina Souza', unidade: 'norte' });
      const paraDani = (await m.como(m.gente.dani, 'GET', `/api/equipe/chat/salas/${g.json.id}/mensagens`)).json.mensagens[0];
      expect(paraDani.conversa).toEqual({ bloqueada: true });
      expect(JSON.stringify(paraDani)).not.toContain('Marina');
      const paraBruno = (await m.como(m.gente.bruno, 'GET', `/api/equipe/chat/salas/${g.json.id}/mensagens`)).json.mensagens[0];
      expect(paraBruno.conversa.nome).toBe('Marina Souza');
      // Só a conversa (sem texto) também vale.
      expect((await m.como(m.gente.carla, 'POST', `/api/equipe/chat/salas/${g.json.id}/mensagens`, { conversaId: c.id })).status).toBe(200);
    });

    it('mostra quem está online na lista', async () => {
      const m = await montar(a);
      await m.presencas.gravar(m.gente.dani.id, 'offline');
      const d = await m.como(m.gente.carla, 'POST', '/api/equipe/chat/direta', { pessoaId: m.gente.dani.id });
      const l = await m.como(m.gente.carla, 'GET', '/api/equipe/chat');
      expect(l.json.salas.find((s: any) => s.id === d.json.id)).toMatchObject({ pessoaId: m.gente.dani.id, online: false });
      const p = await m.como(m.gente.carla, 'GET', '/api/equipe/chat/pessoas');
      expect(p.json.pessoas.find((x: any) => x.id === m.gente.bruno.id).online).toBe(true);
    });
  });
}

describe('aviso de mensagem da equipe pelo push', () => {
  it('respeita a preferência de push das mensagens e abre a tela de equipe', async () => {
    const entregues: Notificacao[] = [];
    const prefs = { a: { ...PREFERENCIAS_PADRAO }, b: { ...PREFERENCIAS_PADRAO, mensagens: { ...PREFERENCIAS_PADRAO.mensagens, push: false } } };
    const aviso = avisoPorPush({
      preferencias: async (id: string) => prefs[id as 'a' | 'b'],
      entregar: async (n: Notificacao) => (entregues.push(n), 1),
    });
    await aviso({ para: ['a', 'b'], titulo: 'Carla', texto: 'Oi', salaId: 's1' });
    expect(entregues).toHaveLength(1);
    expect(entregues[0]).toMatchObject({ usuarioId: 'a', titulo: 'Carla', texto: 'Oi', vista: 'chat-equipe' });
  });
});

import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { lerGruposEvolution, lerWebhookEvolution } from '../src/channels/evolution.js';
import { EvolutionAdmin, type InfoGrupo } from '../src/channels/evolution-admin.js';
import type { CanalWhatsApp, MidiaEnvio } from '../src/channels/tipos.js';
import { ArmazemGruposMemoria, ArmazemGruposPostgres, type ArmazemGrupos } from '../src/grupos/armazem.js';
import { Grupos, type AdminGrupos } from '../src/grupos/grupos.js';
import { registrarGrupos } from '../src/grupos/rotas.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { HORA } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);
const GRUPO = '120363041234567890@g.us';
const INST = 'sintonia-norte';

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  textos: Array<{ canal: string; para: string; texto: string }> = [];
  midias: Array<{ para: string; m: MidiaEnvio }> = [];
  seq = 0;
  lerWebhook(corpo: unknown) {
    return lerWebhookEvolution(corpo);
  }
  async enviarTexto(canal: string, para: string, texto: string) {
    this.textos.push({ canal, para, texto });
    return { idExterno: `OUT${++this.seq}` };
  }
  async enviarMidia(_canal: string, para: string, m: MidiaEnvio) {
    this.midias.push({ para, m });
    return { idExterno: `OUTM${++this.seq}` };
  }
}

class AgenteFalso {
  pedidos: PedidoAgente[] = [];
  async executar(p: PedidoAgente): Promise<RespostaAgente> {
    this.pedidos.push(p);
    return { texto: 'Oi', acoes: [], recusou: false };
  }
}

class AdminFalso implements AdminGrupos {
  liberadas: string[] = [];
  infos = 0;
  async infoGrupo(_i: string, jid: string): Promise<InfoGrupo | null> {
    this.infos++;
    return { jid, nome: 'Equipe Norte', participantes: 12, fotoUrl: null };
  }
  async listarGrupos(): Promise<InfoGrupo[]> {
    return [{ jid: GRUPO, nome: 'Equipe Norte', participantes: 12, fotoUrl: null }, { jid: '999@g.us', nome: 'Fornecedores', participantes: 4, fotoUrl: null }];
  }
  async historicoGrupos(): Promise<unknown[]> {
    return [msgGrupo({ id: 'H-ANTIGA', texto: 'mensagem antiga do grupo', ts: 1_700_000_000, jid: '999@g.us' })];
  }
  async liberarGrupos(i: string) {
    this.liberadas.push(i);
    return 'liberado' as const;
  }
}

function msgGrupo(o: { id: string; texto: string; ts?: number; deMim?: boolean; jid?: string; nome?: string; lid?: boolean }) {
  return {
    key: {
      remoteJid: o.jid ?? GRUPO,
      fromMe: Boolean(o.deMim),
      id: o.id,
      ...(o.deMim ? {} : o.lid ? { participant: '1234567890@lid', participantAlt: '5571988887777@s.whatsapp.net' } : { participant: '5571988887777@s.whatsapp.net' }),
    },
    pushName: o.nome ?? 'Joana Prado',
    message: { conversation: o.texto },
    messageTimestamp: o.ts ?? Math.floor(Date.now() / 1000),
  };
}
const upsert = (...data: unknown[]) => ({ event: 'messages.upsert', instance: INST, data: data.length === 1 ? data[0] : data });

describe('lerGruposEvolution', () => {
  it('lê a mensagem de grupo (com LID) e as conversas continuam ignorando grupos', () => {
    const corpo = upsert(msgGrupo({ id: 'A1', texto: 'Bom dia, equipe', lid: true }));
    expect(lerWebhookEvolution(corpo)).toEqual([]);
    const [m] = lerGruposEvolution(corpo);
    expect(m).toMatchObject({ canalId: INST, grupoJid: GRUPO, participante: '5571988887777', participanteJid: '1234567890@lid', participanteNome: 'Joana Prado', texto: 'Bom dia, equipe', deMim: false, idExterno: 'A1' });
  });
  it('ignora conversa individual e lê o histórico (messages.set)', () => {
    const individual = { key: { remoteJid: '5571988124471@s.whatsapp.net', fromMe: false, id: 'X' }, message: { conversation: 'oi' }, messageTimestamp: 1 };
    expect(lerGruposEvolution(upsert(individual))).toEqual([]);
    const set = { event: 'MESSAGES_SET', instance: INST, data: { messages: [msgGrupo({ id: 'S1', texto: 'antiga' }), individual] } };
    expect(lerGruposEvolution(set).map((m) => m.idExterno)).toEqual(['S1']);
  });
  it('foto com legenda vira anexo', () => {
    const corpo = upsert({ key: { remoteJid: GRUPO, fromMe: false, id: 'F1', participant: '5571988887777@s.whatsapp.net' }, message: { imageMessage: { caption: 'olha', mimetype: 'image/jpeg' } }, messageTimestamp: 10 });
    const [m] = lerGruposEvolution(corpo);
    expect(m?.anexo).toMatchObject({ tipo: 'imagem', legenda: 'olha', mimetype: 'image/jpeg' });
  });
});

describe('EvolutionAdmin e grupos', () => {
  it('cria a instância com "ignorar grupos" desligado', async () => {
    const corpos: Array<{ url: string; corpo: unknown }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      corpos.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('fetchInstances')) return new Response('[]', { status: 200 });
      if (url.includes('/instance/create')) return new Response(JSON.stringify({ qrcode: { base64: 'data:qr' } }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await new EvolutionAdmin('http://evo', 'k', fetchFn).conectar(INST, { url: 'http://s/webhooks/evolution', token: 't' });
    const criar = corpos.find((c) => c.url.endsWith('/instance/create'));
    expect((criar?.corpo as { groupsIgnore?: boolean }).groupsIgnore).toBe(false);
  });
  it('liberarGrupos só muda a configuração (sem desconectar) e mantém o resto', async () => {
    const chamadas: Array<{ metodo: string; url: string; corpo?: Record<string, unknown> }> = [];
    let ignorar = true;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      chamadas.push({ metodo: init?.method ?? 'GET', url, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/settings/find/')) return new Response(JSON.stringify({ groupsIgnore: ignorar, rejectCall: true, msgCall: 'Não atendemos ligações', alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: true }), { status: 200 });
      ignorar = false;
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const adm = new EvolutionAdmin('http://evo', 'k', fetchFn);
    expect(await adm.liberarGrupos(INST)).toBe('liberado');
    const set = chamadas.find((c) => c.url.includes('/settings/set/'));
    expect(set?.corpo).toMatchObject({ groupsIgnore: false, rejectCall: true, msgCall: 'Não atendemos ligações', syncFullHistory: true });
    expect(chamadas.some((c) => /logout|delete|instance\/connect|instance\/create/.test(c.url))).toBe(false);
    expect(await adm.liberarGrupos(INST)).toBe('ja_liberado');
    await expect(adm.liberarGrupos('outra-instancia')).rejects.toThrow();
  });
  it('lê nome, pessoas e foto do grupo', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ id: GRUPO, subject: ' Equipe Norte ', size: 7, pictureUrl: 'https://pps.whatsapp.net/x.jpg' }), { status: 200 })) as unknown as typeof fetch;
    expect(await new EvolutionAdmin('http://evo', 'k', fetchFn).infoGrupo(INST, GRUPO)).toEqual({ jid: GRUPO, nome: 'Equipe Norte', participantes: 7, fotoUrl: 'https://pps.whatsapp.net/x.jpg' });
  });
});

interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; contas: Contas; armazem: ArmazemGrupos }>;
}
const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria(), armazem: new ArmazemGruposMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.grupos, sintonia.grupo_mensagens, sintonia.grupo_leituras cascade');
            return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), armazem: new ArmazemGruposPostgres(pool) };
          },
        },
      ]
    : []),
];

async function montar(a: Ambiente) {
  const { repo, contas, armazem } = await a.criar();
  const canal = new CanalFalso();
  const agente = new AgenteFalso();
  const admin = new AdminFalso();
  const numeros = [{ canalId: INST, unidade: 'norte' as const, canal }];
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente, configIa: async () => ({ modoPadrao: 'ia' }) });
  const grupos = new Grupos({ empresaId: 'imperio', armazem, numeros: () => numeros, admin: () => admin });
  const app = criarServidor({ sintonia, repo, auth: { contas }, evolution: { canal }, grupos });
  registrarGrupos(app, { grupos, armazem, empresaId: 'imperio' });
  const h = await hashPadrao;
  const pessoa = (nome: string, papel: 'admin' | 'atendente', unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = { admin: await pessoa('Bruno Batista', 'admin', []), carla: await pessoa('Carla Lima', 'atendente', ['norte']), sofia: await pessoa('Sofia Reis', 'atendente', ['sumare']) };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(Date.now() + 30 * 24 * HORA))}`));
    return app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  const webhook = async (corpo: unknown) => {
    const r = await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: corpo as object });
    await grupos.ocioso();
    return r;
  };
  return { repo, canal, agente, admin, grupos, armazem, app, gente, como, webhook };
}

for (const a of ambientes) {
  describe(`conversas de grupo (${a.nome})`, () => {
    it('mensagem de grupo entra em Conversas de grupo, sem criar conversa de cliente nem chamar a IA', async () => {
      const m = await montar(a);
      const r = await m.webhook(upsert(msgGrupo({ id: 'G1', texto: 'Bom dia, equipe!' })));
      expect(r.json()).toMatchObject({ recebidas: 0, grupos: 1 });
      await new Promise((ok) => setTimeout(ok, 20));
      expect(await m.repo.listarConversas()).toEqual([]);
      expect(m.agente.pedidos).toEqual([]);
      const lista = (await m.como(m.gente.carla, 'GET', '/api/grupos')).json();
      expect(lista.naoLidas).toBe(1);
      expect(lista.grupos).toHaveLength(1);
      // Nome do grupo veio da Evolution (por trás) e fica guardado.
      expect(lista.grupos[0]).toMatchObject({ nome: 'Equipe Norte', participantes: 12, naoLidas: 1, ultima: { autor: 'participante', nome: 'Joana Prado', texto: 'Bom dia, equipe!' } });
      expect(m.admin.liberadas).toEqual([INST]);
      await m.grupos.ocioso();
      await m.como(m.gente.carla, 'GET', '/api/grupos');
      expect(m.admin.infos).toBe(1);
    });

    it('não duplica a mesma mensagem e o histórico (messages.set) entra sem contar como não lida', async () => {
      const m = await montar(a);
      await m.webhook(upsert(msgGrupo({ id: 'G1', texto: 'oi' })));
      await m.webhook(upsert(msgGrupo({ id: 'G1', texto: 'oi' })));
      await m.webhook({ event: 'messages.set', instance: INST, data: { messages: [msgGrupo({ id: 'G0', texto: 'antiga', ts: 1_700_000_000 }), msgGrupo({ id: 'G1', texto: 'oi' })] } });
      const g = (await m.como(m.gente.carla, 'GET', '/api/grupos')).json().grupos[0];
      expect(g.naoLidas).toBe(1);
      const msgs = (await m.como(m.gente.carla, 'GET', `/api/grupos/${g.id}/mensagens`)).json().mensagens;
      expect(msgs.map((x: { texto: string }) => x.texto)).toEqual(['antiga', 'oi']);
      expect(await m.repo.listarConversas()).toEqual([]);
    });

    it('envia texto para o grupo pelo jid, grava com o nome de quem enviou e o eco não duplica', async () => {
      const m = await montar(a);
      await m.webhook(upsert(msgGrupo({ id: 'G1', texto: 'alguém confirma a reunião?' })));
      const g = (await m.como(m.gente.carla, 'GET', '/api/grupos')).json().grupos[0];
      const r = await m.como(m.gente.carla, 'POST', `/api/grupos/${g.id}/enviar`, { texto: 'Confirmado!' });
      expect(r.statusCode).toBe(200);
      expect(m.canal.textos).toEqual([{ canal: INST, para: GRUPO, texto: 'Confirmado!' }]);
      // Eco do próprio envio pelo webhook (fromMe, mesmo id).
      await m.webhook(upsert({ key: { remoteJid: GRUPO, fromMe: true, id: 'OUT1' }, message: { conversation: 'Confirmado!' }, messageTimestamp: Math.floor(Date.now() / 1000) }));
      const msgs = (await m.como(m.gente.carla, 'GET', `/api/grupos/${g.id}/mensagens`)).json().mensagens;
      expect(msgs).toHaveLength(2);
      expect(msgs[1]).toMatchObject({ autor: 'equipe', nome: 'Carla Lima', texto: 'Confirmado!' });
      // Quem enviou leu o grupo.
      expect((await m.como(m.gente.carla, 'GET', '/api/grupos')).json().naoLidas).toBe(0);
      expect(await m.repo.listarConversas()).toEqual([]);
      expect((await m.como(m.gente.carla, 'POST', `/api/grupos/${g.id}/enviar`, { texto: '   ' })).statusCode).toBe(400);
    });

    it('envia foto para o grupo e guarda o arquivo', async () => {
      const m = await montar(a);
      await m.webhook(upsert(msgGrupo({ id: 'G1', texto: 'manda a foto' })));
      const g = (await m.como(m.gente.admin, 'GET', '/api/grupos')).json().grupos[0];
      const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
      const r = await m.como(m.gente.admin, 'POST', `/api/grupos/${g.id}/enviar-midia`, { base64: png, mimetype: 'image/png', legenda: 'aqui' });
      expect(r.statusCode).toBe(200);
      expect(m.canal.midias[0]).toMatchObject({ para: GRUPO, m: { tipo: 'imagem', legenda: 'aqui' } });
      const id = r.json().mensagem.id;
      const arq = await m.como(m.gente.admin, 'GET', `/api/grupos/${g.id}/midias/${id}`);
      expect(arq.statusCode).toBe(200);
      expect(arq.headers['content-type']).toContain('image/png');
    });

    it('lida por pessoa e quem vê segue a unidade do número', async () => {
      const m = await montar(a);
      await m.webhook(upsert(msgGrupo({ id: 'G1', texto: 'oi' }), msgGrupo({ id: 'G2', texto: 'tudo bem?' })));
      const g = (await m.como(m.gente.carla, 'GET', '/api/grupos')).json().grupos[0];
      expect(g.naoLidas).toBe(2);
      await m.como(m.gente.carla, 'POST', `/api/grupos/${g.id}/lida`);
      expect((await m.como(m.gente.carla, 'GET', '/api/grupos')).json().grupos[0].naoLidas).toBe(0);
      expect((await m.como(m.gente.admin, 'GET', '/api/grupos')).json().grupos[0].naoLidas).toBe(2);
      // Sofia é da outra unidade: não vê nem acessa.
      expect((await m.como(m.gente.sofia, 'GET', '/api/grupos')).json().grupos).toEqual([]);
      expect((await m.como(m.gente.sofia, 'GET', `/api/grupos/${g.id}/mensagens`)).statusCode).toBe(404);
      expect((await m.como(m.gente.sofia, 'POST', `/api/grupos/${g.id}/enviar`, { texto: 'oi' })).statusCode).toBe(404);
      expect(m.canal.textos).toEqual([]);
    });

    it('sincronizar traz os grupos e as mensagens antigas (só a gestão)', async () => {
      const m = await montar(a);
      expect((await m.como(m.gente.carla, 'POST', '/api/grupos/sincronizar')).statusCode).toBe(403);
      const r = await m.como(m.gente.admin, 'POST', '/api/grupos/sincronizar');
      expect(r.json()).toEqual({ grupos: 2, mensagens: 1 });
      const lista = (await m.como(m.gente.admin, 'GET', '/api/grupos')).json();
      expect(lista.grupos.map((g: { nome: string }) => g.nome).sort()).toEqual(['Equipe Norte', 'Fornecedores']);
      expect(lista.naoLidas).toBe(0);
      expect(await m.repo.listarConversas()).toEqual([]);
    });
  });
}

describe('conversas de grupo: WhatsApp desconectado', () => {
  it('enviar para grupo de número que saiu da lista explica o motivo (sem "erro interno")', async () => {
    const armazem = new ArmazemGruposMemoria();
    const numeros: Array<{ canalId: string; unidade: 'norte'; canal: CanalWhatsApp }> = [];
    const grupos = new Grupos({ empresaId: 'imperio', armazem, numeros: () => numeros });
    const repo = new RepositorioMemoria();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: new AgenteFalso() });
    const app = criarServidor({ sintonia, repo });
    registrarGrupos(app, { grupos, armazem, empresaId: 'imperio' });
    const g = await armazem.grupo({ empresaId: 'imperio', canalId: INST, unidade: 'norte', jid: GRUPO });
    const r = await app.inject({ method: 'POST', url: `/api/grupos/${g.id}/enviar`, payload: { texto: 'oi' } });
    expect(r.statusCode).toBe(503);
    expect(r.json().erro).toContain('desconectado');
    expect((await app.inject({ method: 'POST', url: '/api/grupos/sincronizar' })).statusCode).toBe(422);
  });
});

import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { CanalEvolution, lerAcoesEvolution } from '../src/channels/evolution.js';
import { CanalMeta, lerAcoesMeta } from '../src/channels/meta.js';
import type { AlvoMensagem, CanalWhatsApp } from '../src/channels/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { AcoesMensagemMemoria, AcoesMensagemPostgres, criarAcoesMensagem, juntarNota, type ArmazemAcoesMensagem } from '../src/conversa/acoes-mensagem.js';
import { ContatosMemoria } from '../src/contatos/contatos.js';
import { AuditoriaMemoria } from '../src/seguranca/auditoria.js';
import { poolDeTeste, temPostgres } from './repos.js';

/** WhatsApp de teste que anota o que a Sintonia pediu (reação, citação, edição, apagar). */
class CanalAnotado extends CanalTeste {
  chamadas: Array<{ acao: string; alvo?: AlvoMensagem; emoji?: string; texto?: string; citada?: string }> = [];
  override async enviarReacao(_c: string, alvo: AlvoMensagem, emoji: string) {
    this.chamadas.push({ acao: 'reacao', alvo, emoji });
  }
  override async enviarCitando(_c: string, _t: string, texto: string, citada: AlvoMensagem & { texto: string }) {
    this.chamadas.push({ acao: 'citar', texto, citada: citada.idExterno });
    return { idExterno: `wa-resp-${this.chamadas.length}` };
  }
  override async editarTexto(_c: string, alvo: AlvoMensagem, texto: string) {
    this.chamadas.push({ acao: 'editar', alvo, texto });
  }
  override async apagarParaTodos(_c: string, alvo: AlvoMensagem) {
    this.chamadas.push({ acao: 'apagar', alvo });
  }
}
/** Canal como a API oficial: reage e cita, mas não edita nem apaga para todos. */
class CanalSoReage extends CanalTeste {
  override editarTexto = undefined as unknown as CanalTeste['editarTexto'];
  override apagarParaTodos = undefined as unknown as CanalTeste['apagarParaTodos'];
}

const fabricas: Array<{ nome: string; criar: () => Promise<{ repo: Repositorio; armazem: ArmazemAcoesMensagem }> }> = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), armazem: new AcoesMensagemMemoria() }) },
  ...(temPostgres ? [{ nome: 'postgres', criar: async () => { const pool = await poolDeTeste(); return { repo: new RepositorioPostgres(pool), armazem: new AcoesMensagemPostgres(pool) }; } }] : []),
];

async function montar(f: (typeof fabricas)[number], canal: CanalWhatsApp = new CanalAnotado()) {
  const { repo, armazem } = await f.criar();
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const numeros = [{ canalId: 'teste-norte', unidade: 'norte' as const, canal }];
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const agora = new Date();
  const { conversa: c } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571988887777', nome: 'Juliana', agora });
  const { conversa: outra } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571955554444', nome: 'Rita', agora });
  const ids: Record<string, string> = {};
  const add = async (chave: string, m: { autor: 'cliente' | 'equipe' | 'ia' | 'sistema'; autorNome?: string; texto: string; idExterno?: string; minutosAtras?: number }) => {
    ids[chave] = crypto.randomUUID();
    await repo.adicionarMensagem({ id: ids[chave], conversaId: c.id, autor: m.autor, autorNome: m.autorNome, texto: m.texto, idExterno: m.idExterno, em: new Date(agora.getTime() - (m.minutosAtras ?? 1) * 60_000) });
  };
  await add('cliente', { autor: 'cliente', texto: 'Oi, quero marcar escova', idExterno: 'wa-cli-1', minutosAtras: 30 });
  await add('carla', { autor: 'equipe', autorNome: 'Carla', texto: 'Claro! Que dia?', idExterno: 'wa-eq-1', minutosAtras: 5 });
  await add('carlaVelha', { autor: 'equipe', autorNome: 'Carla', texto: 'Bom dia', idExterno: 'wa-eq-0', minutosAtras: 60 });
  await add('bruno', { autor: 'equipe', autorNome: 'Bruno', texto: 'Temos horário amanhã', idExterno: 'wa-eq-2', minutosAtras: 2 });
  await add('semId', { autor: 'equipe', autorNome: 'Carla', texto: 'importada sem id', minutosAtras: 3 });
  const contatos = new ContatosMemoria();
  const auditoria = new AuditoriaMemoria();
  const acoes = criarAcoesMensagem({ repo, empresaId: 'imperio', armazem, sintonia, contatos, auditoria });
  const app = criarServidor({ sintonia, repo, auth: { contas }, acoesMensagem: acoes, evolution: { canal } });
  acoes.registrar(app);
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  const admin = await entrar('bruno@imperio.com');
  const carla = await entrar('carla@imperio.com');
  const url = (msg: string, acao: string) => `/api/conversas/${c.id}/mensagens/${ids[msg]}/${acao}`;
  const post = (cookie: string, u: string, payload: unknown) => app.inject({ method: 'POST', url: u, payload: payload as Record<string, unknown>, headers: { cookie } });
  const acoesDa = async (cookie = admin) => (await app.inject({ method: 'GET', url: `/api/conversas/${c.id}`, headers: { cookie } })).json().acoes;
  return { app, repo, c, outra, ids, admin, carla, url, post, acoesDa, contatos, auditoria, canal, acoesServico: acoes };
}

for (const f of fabricas) {
  describe(`Menu da mensagem (${f.nome})`, () => {
    it('reage, troca e tira a reação; vai para o WhatsApp com a chave certa', async () => {
      const t = await montar(f);
      const canal = t.canal as CanalAnotado;
      expect((await t.post(t.carla, t.url('cliente', 'reacao'), { emoji: '❤️' })).json()).toMatchObject({ ok: true, noWhatsApp: true });
      expect(canal.chamadas.at(-1)).toEqual({ acao: 'reacao', alvo: { idExterno: 'wa-cli-1', telefone: '5571988887777', deMim: false }, emoji: '❤️' });
      await t.post(t.admin, t.url('cliente', 'reacao'), { emoji: '👍' });
      let a = await t.acoesDa(t.carla);
      expect(a.reacoes[t.ids.cliente!]).toHaveLength(2);
      expect(a.reacoes[t.ids.cliente!].find((r: { minha: boolean }) => r.minha)).toMatchObject({ emoji: '❤️', nome: 'Carla' });
      await t.post(t.carla, t.url('cliente', 'reacao'), { emoji: '😂' });
      await t.post(t.carla, t.url('cliente', 'reacao'), { emoji: null });
      a = await t.acoesDa(t.carla);
      expect(a.reacoes[t.ids.cliente!]).toEqual([{ emoji: '👍', nome: 'Bruno', minha: false, cliente: false }]);
      expect(canal.chamadas.at(-1)).toMatchObject({ acao: 'reacao', emoji: '' });
      // sem id no WhatsApp: só na Sintonia
      const r = (await t.post(t.carla, t.url('semId', 'reacao'), { emoji: '✅' })).json();
      expect(r).toMatchObject({ ok: true, noWhatsApp: false });
      expect(r.aviso).toContain('só na Sintonia');
      expect((await t.post(t.carla, t.url('cliente', 'reacao'), { emoji: '<b>' })).statusCode).toBe(400);
    });

    it('responde citando: vai citado e a citação aparece no balão novo', async () => {
      const t = await montar(f);
      const canal = t.canal as CanalAnotado;
      const r = await t.post(t.carla, `/api/conversas/${t.c.id}/responder`, { texto: 'Amanhã às 10h?', citadaId: t.ids.cliente });
      expect(r.statusCode).toBe(200);
      expect(r.json().citadoNoWhatsApp).toBe(true);
      expect(canal.chamadas.at(-1)).toEqual({ acao: 'citar', texto: 'Amanhã às 10h?', citada: 'wa-cli-1' });
      const nova = (await t.repo.mensagens(t.c.id, 50)).find((m) => m.texto === 'Amanhã às 10h?')!;
      expect(nova).toMatchObject({ autor: 'equipe', autorNome: 'Carla', idExterno: 'wa-resp-1' });
      const a = await t.acoesDa();
      expect(a.citacoes[nova.id]).toMatchObject({ id: t.ids.cliente, autor: 'cliente', texto: 'Oi, quero marcar escova' });
      // citada de outra conversa: recusa
      const deFora = crypto.randomUUID();
      expect((await t.post(t.carla, `/api/conversas/${t.c.id}/responder`, { texto: 'x', citadaId: deFora })).statusCode).toBe(404);
    });

    it('edita só o texto da própria atendente e só nos 15 minutos; a gestão edita qualquer um', async () => {
      const t = await montar(f);
      const canal = t.canal as CanalAnotado;
      const r = await t.post(t.carla, t.url('carla', 'editar'), { texto: 'Claro! Qual dia fica bom?' });
      expect(r.json()).toMatchObject({ ok: true, noWhatsApp: true });
      expect(canal.chamadas.at(-1)).toMatchObject({ acao: 'editar', texto: 'Claro! Qual dia fica bom?', alvo: { idExterno: 'wa-eq-1', deMim: true } });
      expect((await t.repo.mensagemPorId!(t.ids.carla!))!.texto).toBe('Claro! Qual dia fica bom?');
      expect((await t.acoesDa()).editadas[t.ids.carla!]).toBeTruthy();
      expect((await t.post(t.carla, t.url('bruno', 'editar'), { texto: 'mudei' })).statusCode).toBe(403);
      expect((await t.post(t.carla, t.url('carlaVelha', 'editar'), { texto: 'mudei' })).statusCode).toBe(409);
      expect((await t.post(t.carla, t.url('cliente', 'editar'), { texto: 'mudei' })).statusCode).toBe(400);
      expect((await t.post(t.admin, t.url('bruno', 'editar'), { texto: 'Temos horário amanhã cedo' })).statusCode).toBe(200);
      expect(t.auditoria.linhas.filter((l) => l.acao === 'mensagem_editada')).toHaveLength(2);
    });

    it('apaga para todos (só da loja e recente) e só daqui (marca, não some do banco)', async () => {
      const t = await montar(f);
      const canal = t.canal as CanalAnotado;
      expect((await t.post(t.carla, t.url('carla', 'apagar'), { modo: 'todos' })).statusCode).toBe(200);
      expect(canal.chamadas.at(-1)).toMatchObject({ acao: 'apagar', alvo: { idExterno: 'wa-eq-1', deMim: true } });
      expect((await t.post(t.carla, t.url('bruno', 'apagar'), { modo: 'aqui' })).statusCode).toBe(403);
      expect((await t.post(t.carla, t.url('cliente', 'apagar'), { modo: 'aqui' })).json().erro).toContain('gestão');
      expect((await t.post(t.admin, t.url('cliente', 'apagar'), { modo: 'todos' })).statusCode).toBe(400);
      expect((await t.post(t.admin, t.url('cliente', 'apagar'), { modo: 'aqui' })).statusCode).toBe(200);
      expect((await t.post(t.admin, t.url('semId', 'apagar'), { modo: 'todos' })).statusCode).toBe(409);
      const a = await t.acoesDa();
      expect(a.apagadas).toEqual({ [t.ids.carla!]: 'todos', [t.ids.cliente!]: 'aqui' });
      // o banco continua com a mensagem (histórico)
      expect((await t.repo.mensagemPorId!(t.ids.cliente!))!.texto).toBe('Oi, quero marcar escova');
      expect((await t.post(t.carla, t.url('cliente', 'reacao'), { emoji: '👍' })).statusCode).toBe(409);
      expect(t.auditoria.linhas.filter((l) => l.acao === 'mensagem_apagada')).toHaveLength(2);
    });

    it('API oficial (sem editar/apagar): edita só na Sintonia com aviso e recusa apagar para todos', async () => {
      const t = await montar(f, new CanalSoReage());
      const r = (await t.post(t.carla, t.url('carla', 'editar'), { texto: 'novo' })).json();
      expect(r).toMatchObject({ ok: true, noWhatsApp: false });
      expect((await t.post(t.carla, t.url('carla', 'apagar'), { modo: 'todos' })).statusCode).toBe(409);
      const pode = (await t.app.inject({ method: 'GET', url: t.url('carla', 'acoes'), headers: { cookie: t.carla } })).json();
      expect(pode).toMatchObject({ reagir: true, responder: true, apagarParaTodos: false, apagarAqui: true, editarNoWhatsApp: false });
    });

    it('fixa no topo (uma por conversa), favorita por pessoa e lista as favoritas', async () => {
      const t = await montar(f);
      await t.post(t.carla, t.url('cliente', 'fixar'), { fixar: true });
      expect((await t.acoesDa()).fixada).toMatchObject({ mensagemId: t.ids.cliente, texto: 'Oi, quero marcar escova', por: 'Carla' });
      await t.post(t.admin, t.url('bruno', 'fixar'), { fixar: true });
      expect((await t.acoesDa()).fixada.mensagemId).toBe(t.ids.bruno);
      await t.post(t.admin, t.url('bruno', 'fixar'), { fixar: false });
      expect((await t.acoesDa()).fixada).toBeNull();

      await t.post(t.carla, t.url('cliente', 'favorito'), { favorito: true });
      expect((await t.acoesDa(t.carla)).favoritas).toEqual([t.ids.cliente]);
      expect((await t.acoesDa(t.admin)).favoritas).toEqual([]);
      const lista = (await t.app.inject({ method: 'GET', url: '/api/mensagens/favoritas', headers: { cookie: t.carla } })).json();
      expect(lista).toEqual([expect.objectContaining({ mensagemId: t.ids.cliente, conversaId: t.c.id, nome: 'Juliana', texto: 'Oi, quero marcar escova' })]);
      await t.post(t.carla, t.url('cliente', 'favorito'), { favorito: false });
      expect((await t.acoesDa(t.carla)).favoritas).toEqual([]);
    });

    it('leva a mensagem para as observações da ficha', async () => {
      const t = await montar(f);
      const r = await t.post(t.carla, t.url('cliente', 'nota'), {});
      expect(r.statusCode).toBe(200);
      const k = await t.contatos.obter('imperio', '5571988887777');
      expect(k!.observacoes).toMatch(/^\[\d\d\/\d\d \d\d:\d\d · Carla\] Juliana: Oi, quero marcar escova$/);
      await t.post(t.carla, t.url('bruno', 'nota'), {});
      expect((await t.contatos.obter('imperio', '5571988887777'))!.observacoes!.split('\n\n')).toHaveLength(2);
    });

    it('encaminha o texto para outra conversa', async () => {
      const t = await montar(f);
      const r = await t.post(t.carla, t.url('cliente', 'encaminhar'), { para: t.outra.id });
      expect(r.json()).toMatchObject({ ok: true, conversaId: t.outra.id });
      expect((await t.repo.mensagens(t.outra.id)).map((m) => m.texto)).toEqual(['Oi, quero marcar escova']);
    });

    it('reação, apagou e editou que chegam pelo webhook da Evolution', async () => {
      const t = await montar(f);
      const corpo = (message: unknown, fromMe = false) => ({ event: 'messages.upsert', instance: 'teste-norte', data: { key: { remoteJid: '5571988887777@s.whatsapp.net', fromMe, id: `x-${Math.random()}` }, pushName: 'Juliana', message, messageTimestamp: Math.floor(Date.now() / 1000) } });
      const r = await t.app.inject({ method: 'POST', url: '/webhooks/evolution', payload: corpo({ reactionMessage: { key: { remoteJid: '5571988887777@s.whatsapp.net', fromMe: true, id: 'wa-eq-1' }, text: '🙏' } }, true) });
      expect(r.statusCode).toBe(200); // reação feita pelo celular da loja
      const lidas = lerAcoesEvolution(corpo({ reactionMessage: { key: { id: 'wa-eq-1' }, text: '🙏' } }));
      expect(lidas).toEqual([expect.objectContaining({ tipo: 'reacao', alvoIdExterno: 'wa-eq-1', emoji: '🙏', deMim: false, telefone: '5571988887777' })]);
      await t.acoesServico.aoReceber(lidas);
      await t.acoesServico.aoReceber(lerAcoesEvolution(corpo({ protocolMessage: { key: { id: 'wa-cli-1' }, type: 'REVOKE' } })));
      await t.acoesServico.aoReceber(lerAcoesEvolution(corpo({ protocolMessage: { key: { id: 'wa-eq-2' }, type: 14, editedMessage: { conversation: 'Temos horário amanhã às 9h' } } }, true)));
      const a = await t.acoesDa();
      expect(a.reacoes[t.ids.carla!]).toEqual([{ emoji: '🙏', nome: 'Celular da loja', minha: false, cliente: false }, { emoji: '🙏', nome: null, minha: false, cliente: true }]);
      expect(a.apagadas[t.ids.cliente!]).toBe('cliente');
      expect((await t.repo.mensagemPorId!(t.ids.bruno!))!.texto).toBe('Temos horário amanhã às 9h');
      // reação de outra cliente (telefone diferente) não vale
      const outro = lerAcoesEvolution({ ...corpo({ reactionMessage: { key: { id: 'wa-eq-2' }, text: '😡' } }), data: { key: { remoteJid: '5571900000000@s.whatsapp.net', fromMe: false, id: 'z' }, message: { reactionMessage: { key: { id: 'wa-eq-2' }, text: '😡' } } } });
      expect(await t.acoesServico.aoReceber(outro)).toBe(0);
    });

    it('eco do WhatsApp da reação e da edição feitas aqui não duplica', async () => {
      const t = await montar(f);
      await t.post(t.carla, t.url('cliente', 'reacao'), { emoji: '❤️' });
      await t.post(t.carla, t.url('carla', 'editar'), { texto: 'Claro! Qual dia?' });
      const eco = (message: unknown) => lerAcoesEvolution({ event: 'messages.upsert', instance: 'teste-norte', data: { key: { remoteJid: '5571988887777@s.whatsapp.net', fromMe: true, id: `eco-${Math.random()}` }, message, messageTimestamp: Math.floor(Date.now() / 1000) } });
      await t.acoesServico.aoReceber(eco({ reactionMessage: { key: { id: 'wa-cli-1' }, text: '❤️' } }));
      await t.acoesServico.aoReceber(eco({ protocolMessage: { key: { id: 'wa-eq-1' }, type: 'MESSAGE_EDIT', editedMessage: { conversation: 'Claro! Qual dia?' } } }));
      const a = await t.acoesDa();
      expect(a.reacoes[t.ids.cliente!]).toHaveLength(1);
      const d = (await t.app.inject({ method: 'GET', url: t.url('carla', 'dados'), headers: { cookie: t.admin } })).json();
      expect(d.editadaPor).toBe('Carla');
      // reação feita pelo celular da loja (não veio daqui): entra
      await t.acoesServico.aoReceber(eco({ reactionMessage: { key: { id: 'wa-cli-1' }, text: '🙏' } }));
      expect((await t.acoesDa()).reacoes[t.ids.cliente!]).toHaveLength(2);
    });

    it('traduzir sem a chave da IA avisa claramente', async () => {
      const t = await montar(f);
      const r = await t.post(t.carla, t.url('cliente', 'traduzir'), {});
      expect(r.statusCode).toBe(501);
      expect(r.json().erro).toContain('Conexões');
    });

    it('só mexe em mensagem de conversa que a pessoa vê', async () => {
      const t = await montar(f);
      const c2 = await t.repo.buscarConversa(t.c.id);
      await t.repo.salvarConversa({ ...c2!, responsavelId: crypto.randomUUID(), responsavelNome: 'Outra' });
      expect((await t.post(t.carla, t.url('cliente', 'reacao'), { emoji: '👍' })).statusCode).toBe(404);
    });
  });
}

describe('Formato das chamadas ao WhatsApp', () => {
  const alvo = { idExterno: 'ABC', telefone: '5571988887777', deMim: true };
  it('Evolution: sendReaction, sendText com quoted, updateMessage e deleteMessageForEveryone', async () => {
    const pedidos: Array<{ url: string; metodo: string; corpo: unknown }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, metodo: init.method ?? 'GET', corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ key: { id: 'NOVO' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const ev = new CanalEvolution('http://evo', 'k', fetchFn, async () => {});
    await ev.enviarReacao('loja', alvo, '👍');
    const r = await ev.enviarCitando('loja', '5571988887777', 'Pode sim', { ...alvo, deMim: false, texto: 'Pode amanhã?' });
    await ev.editarTexto('loja', alvo, 'texto novo');
    await ev.apagarParaTodos('loja', alvo);
    expect(r.idExterno).toBe('NOVO');
    const chave = { remoteJid: '5571988887777@s.whatsapp.net', fromMe: true, id: 'ABC' };
    expect(pedidos).toEqual([
      { url: 'http://evo/message/sendReaction/loja', metodo: 'POST', corpo: { key: chave, reaction: '👍' } },
      { url: 'http://evo/message/sendText/loja', metodo: 'POST', corpo: { number: '5571988887777', text: 'Pode sim', quoted: { key: { ...chave, fromMe: false }, message: { conversation: 'Pode amanhã?' } } } },
      { url: 'http://evo/chat/updateMessage/loja', metodo: 'POST', corpo: { number: '5571988887777', key: chave, text: 'texto novo' } },
      { url: 'http://evo/chat/deleteMessageForEveryone/loja', metodo: 'DELETE', corpo: { id: 'ABC', remoteJid: chave.remoteJid, fromMe: true } },
    ]);
  });

  it('Evolution recusou: erro explicado', async () => {
    const fetchFn = (async () => new Response('{"message":"not found"}', { status: 400 })) as unknown as typeof fetch;
    await expect(new CanalEvolution('http://evo', 'k', fetchFn).enviarReacao('loja', alvo, '👍')).rejects.toThrow(/recusou/);
  });

  it('Meta: reação e resposta com context.message_id; sem editar nem apagar', async () => {
    const pedidos: unknown[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      pedidos.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.N' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const meta = new CanalMeta('tok', fetchFn);
    await meta.enviarReacao('123', { ...alvo, idExterno: 'wamid.A' }, '❤️');
    await meta.enviarCitando('123', '5571988887777', 'Oi', { ...alvo, idExterno: 'wamid.A', texto: 'x' });
    expect(pedidos[0]).toMatchObject({ to: '5571988887777', type: 'reaction', reaction: { message_id: 'wamid.A', emoji: '❤️' } });
    expect(pedidos[1]).toMatchObject({ to: '5571988887777', type: 'text', context: { message_id: 'wamid.A' }, text: { body: 'Oi' } });
    expect((meta as CanalWhatsApp).editarTexto).toBeUndefined();
    expect((meta as CanalWhatsApp).apagarParaTodos).toBeUndefined();
  });

  it('Meta: lê a reação da cliente no webhook', () => {
    const corpo = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' }, messages: [{ from: '5571988887777', id: 'wamid.R', timestamp: '1763700000', type: 'reaction', reaction: { message_id: 'wamid.A', emoji: '😂' } }] } }] }] };
    expect(lerAcoesMeta(corpo)).toEqual([expect.objectContaining({ canalId: '123', telefone: '5571988887777', alvoIdExterno: 'wamid.A', emoji: '😂', tipo: 'reacao' })]);
  });

  it('nota nas observações: data, quem e limite da ficha', () => {
    const em = new Date('2026-11-21T15:30:00Z');
    expect(juntarNota(null, 'Juliana: oi', 'Carla', em)).toBe('[21/11 12:30 · Carla] Juliana: oi');
    expect(juntarNota('antes', 'x', 'Carla', em)).toBe('antes\n\n[21/11 12:30 · Carla] x');
    expect(() => juntarNota('a'.repeat(3990), 'texto grande', 'Carla', em)).toThrow(/cheias/);
  });
});

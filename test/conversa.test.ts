import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { registrarConversa } from '../src/conversa/rotas.js';
import { normalizarAtalho, RespostasMemoria, RespostasPostgres, type ArmazemRespostas } from '../src/conversa/respostas.js';
import { ErroTranscricao, TranscricoesMemoria, TranscricoesPostgres, TranscritorOpenAI, type ArmazemTranscricoes, type Transcritor } from '../src/conversa/transcricao.js';
import { separarMensagem } from '../src/conversa/assistente.js';
import type { ClienteClaude } from '../src/ai/agente.js';
import { poolDeTeste, temPostgres } from './repos.js';

/** Whisper de mentira: nunca chama a rede; conta quantas vezes foi chamado. */
class TranscritorFalso implements Transcritor {
  readonly modelo = 'falso';
  chamadas = 0;
  constructor(private readonly texto = 'Oi, queria saber o preço da progressiva') {}
  async transcrever() {
    this.chamadas++;
    await new Promise((r) => setTimeout(r, 5));
    return this.texto;
  }
}

/** Claude de mentira: guarda o pedido e devolve um texto fixo. */
function claudeFalso(texto: string) {
  const pedidos: Array<{ system: Array<{ text: string }>; messages: Array<{ content: string }> }> = [];
  const claude = {
    beta: {
      messages: {
        create: async (p: (typeof pedidos)[number]) => {
          pedidos.push(p);
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: texto }] };
        },
      },
    },
  } as unknown as ClienteClaude;
  return { claude, pedidos };
}

interface Montagem {
  repo?: Repositorio;
  respostas?: ArmazemRespostas;
  transcricoes?: ArmazemTranscricoes;
  transcritor?: Transcritor;
  semChaveOpenAI?: boolean;
  iaLigada?: boolean;
  textoIa?: string;
}

async function montar(m: Montagem = {}) {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  const carla = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Souza', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Duda', email: 'duda@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = m.repo ?? new RepositorioMemoria();
  const canal = new CanalTeste();
  const enviados: string[] = [];
  const original = canal.enviarTexto.bind(canal);
  canal.enviarTexto = async (...a: Parameters<CanalTeste['enviarTexto']>) => {
    enviados.push(String((a as unknown[])[2]));
    return original();
  };
  const numeros = [{ canalId: 'teste-norte', unidade: 'norte' as const, canal }];
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const agora = new Date();
  const { conversa: norte } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571988887777', nome: 'Juliana Lima', agora });
  const { conversa: sumare } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'teste-sumare', telefone: '5571977776666', nome: 'Bia', agora });
  const app = criarServidor({ sintonia, repo, auth: { contas } });
  const transcritor = m.transcritor ?? new TranscritorFalso();
  const ia = claudeFalso(m.textoIa ?? 'Oi Juliana! A progressiva sai por R$ 180. Quer vir sábado?');
  registrarConversa(app, {
    repo,
    sintonia,
    empresaId: 'imperio',
    respostas: m.respostas ?? new RespostasMemoria(),
    transcricoes: m.transcricoes ?? new TranscricoesMemoria(),
    transcritor,
    transcricaoLigada: () => !m.semChaveOpenAI,
    ia: { claude: ia.claude, modelo: 'claude-opus-5-5', base: async () => 'Progressiva: R$ 180.', ligada: () => m.iaLigada !== false },
    canalDa: (u) => (u === 'norte' ? { canalId: 'teste-norte' } : { erro: 'Esta unidade ainda não tem WhatsApp conectado.' }),
    modoInicial: async () => 'humano',
  });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  return { app, repo, norte, sumare, carlaId: carla.id, transcritor, ia, enviados, admin: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com'), duda: await entrar('duda@imperio.com') };
}

/** Áudio da cliente já baixado (o arquivo não importa: o transcritor é falso). */
async function audioDaCliente(repo: Repositorio, conversaId: string, pronto = true) {
  const id = randomUUID();
  await repo.adicionarMensagem({ id, conversaId, autor: 'cliente', texto: '[áudio]', em: new Date(), idExterno: `ext-${id}`, anexo: { tipo: 'audio', mimetype: 'audio/ogg', voz: true, duracaoSeg: 4, situacao: 'pendente' } });
  if (pronto) await repo.guardarMidia(id, { conteudo: Buffer.from('OggS-falso'), mimetype: 'audio/ogg' });
  return id;
}

describe('Respostas rápidas', () => {
  it('atalho vira minúsculas sem acento, espaço ou barra', () => {
    expect(normalizarAtalho('/Preço Promo')).toBe('preco-promo');
    expect(normalizarAtalho('  /endereço_norte ')).toBe('endereco-norte');
  });

  it('gestão cria da empresa; atendente cria pessoal; cada uma vê as da empresa e só as suas', async () => {
    const { app, admin, carla, duda } = await montar();
    const post = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/respostas-rapidas', headers: { cookie }, payload });
    const preco = await post(admin, { atalho: '/preco', texto: 'Oi {nome}! A progressiva na {unidade} sai por R$ 180.' });
    expect(preco.statusCode).toBe(201);
    expect(preco.json()).toMatchObject({ atalho: 'preco', pessoal: false, podeEditar: true });
    // Atendente não cria da empresa...
    expect((await post(carla, { atalho: 'oi', texto: 'Oi!', pessoal: false })).statusCode).toBe(403);
    // ...mas cria a pessoal (mesmo atalho de outra pessoa ou da empresa).
    expect((await post(carla, { atalho: 'Oi', texto: 'Oi, aqui é {atendente}!' })).json()).toMatchObject({ atalho: 'oi', pessoal: true, podeEditar: true });
    expect((await post(duda, { atalho: 'oi', texto: 'Olá!' })).statusCode).toBe(201);
    expect((await post(carla, { atalho: 'oi', texto: 'de novo' })).statusCode).toBe(409);
    expect((await post(admin, { atalho: 'preco', texto: 'repetida' })).statusCode).toBe(409);
    expect((await post(carla, { atalho: '///', texto: 'x' })).statusCode).toBe(400);

    const lista = (await app.inject({ url: '/api/respostas-rapidas', headers: { cookie: carla } })).json();
    expect(lista.map((r: { atalho: string; pessoal: boolean; podeEditar: boolean }) => [r.atalho, r.pessoal, r.podeEditar])).toEqual([
      ['oi', true, true],
      ['preco', false, false],
    ]);
  });

  it('só a gestão edita e apaga as da empresa; ninguém mexe na pessoal de outra pessoa', async () => {
    const { app, admin, carla, duda } = await montar();
    const daEmpresa = (await app.inject({ method: 'POST', url: '/api/respostas-rapidas', headers: { cookie: admin }, payload: { atalho: 'end', texto: 'Endereço' } })).json();
    const daCarla = (await app.inject({ method: 'POST', url: '/api/respostas-rapidas', headers: { cookie: carla }, payload: { atalho: 'tchau', texto: 'Tchau!' } })).json();
    const patch = (cookie: string, id: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/respostas-rapidas/${id}`, headers: { cookie }, payload });
    expect((await patch(carla, daEmpresa.id, { texto: 'mudei' })).statusCode).toBe(403);
    expect((await patch(admin, daEmpresa.id, { texto: 'Endereço novo', atalho: '/endereco' })).json()).toMatchObject({ atalho: 'endereco', texto: 'Endereço novo' });
    expect((await patch(duda, daCarla.id, { texto: 'mudei' })).statusCode).toBe(404);
    expect((await patch(carla, daCarla.id, { texto: 'Até logo!' })).json()).toMatchObject({ texto: 'Até logo!' });
    expect((await app.inject({ method: 'DELETE', url: `/api/respostas-rapidas/${daCarla.id}`, headers: { cookie: duda } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/respostas-rapidas/${daCarla.id}`, headers: { cookie: carla } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/respostas-rapidas/${daEmpresa.id}`, headers: { cookie: carla } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/respostas-rapidas', headers: { cookie: carla } })).json()).toHaveLength(1);
  });

  it('sem login a API fica fechada', async () => {
    const { app } = await montar();
    expect((await app.inject({ url: '/api/respostas-rapidas' })).statusCode).toBe(401);
  });
});

describe('Transcrição de áudio', () => {
  it('transcreve uma vez só, guarda e devolve na lista da conversa', async () => {
    const { app, repo, norte, carla, transcritor } = await montar();
    const id = await audioDaCliente(repo, norte.id);
    const url = `/api/conversas/${norte.id}/midias/${id}/transcrever`;
    // Duas pessoas clicando ao mesmo tempo: uma chamada ao Whisper.
    const [a, b] = await Promise.all([app.inject({ method: 'POST', url, headers: { cookie: carla } }), app.inject({ method: 'POST', url, headers: { cookie: carla } })]);
    expect(a.json()).toMatchObject({ ok: true, texto: 'Oi, queria saber o preço da progressiva' });
    expect(b.json().texto).toBe(a.json().texto);
    const c = (await app.inject({ method: 'POST', url, headers: { cookie: carla } })).json();
    expect(c).toMatchObject({ nova: false });
    expect((transcritor as TranscritorFalso).chamadas).toBe(1);
    expect((await app.inject({ url: `/api/conversas/${norte.id}/transcricoes`, headers: { cookie: carla } })).json()).toEqual({ [id]: 'Oi, queria saber o preço da progressiva' });
  });

  it('sem chave da OpenAI explica onde configurar; áudio baixando pede para esperar; conversa de outra unidade dá 404', async () => {
    const { app, repo, norte, sumare, carla } = await montar({ semChaveOpenAI: true });
    const id = await audioDaCliente(repo, norte.id);
    const r = await app.inject({ method: 'POST', url: `/api/conversas/${norte.id}/midias/${id}/transcrever`, headers: { cookie: carla } });
    expect(r.statusCode).toBe(501);
    expect(r.json().erro).toMatch(/Conexões/);
    expect((await app.inject({ url: '/api/conversa/recursos', headers: { cookie: carla } })).json()).toEqual({ ia: true, transcricao: false });

    const pendente = await audioDaCliente(repo, norte.id, false);
    expect((await app.inject({ method: 'POST', url: `/api/conversas/${norte.id}/midias/${pendente}/transcrever`, headers: { cookie: carla } })).statusCode).toBe(409);
    const outro = await audioDaCliente(repo, sumare.id);
    expect((await app.inject({ method: 'POST', url: `/api/conversas/${sumare.id}/midias/${outro}/transcrever`, headers: { cookie: carla } })).statusCode).toBe(404);
    // Áudio de outra conversa pelo endereço desta: não acha.
    expect((await app.inject({ method: 'POST', url: `/api/conversas/${norte.id}/midias/${outro}/transcrever`, headers: { cookie: carla } })).statusCode).toBe(404);
  });

  it('o cliente do Whisper manda o arquivo, o modelo e o idioma, e entende a chave recusada (sem rede)', async () => {
    const pedidos: Array<{ url: string; corpo: FormData; auth: string }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, corpo: init.body as FormData, auth: String((init.headers as Record<string, string>).authorization) });
      return new Response(JSON.stringify({ text: ' Olá ' }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new TranscritorOpenAI(() => 'sk-teste', 'whisper-1', fetchFalso);
    expect(await t.transcrever(Buffer.from('x'), 'audio/ogg; codecs=opus')).toBe('Olá');
    expect(pedidos[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(pedidos[0]!.auth).toBe('Bearer sk-teste');
    expect(pedidos[0]!.corpo.get('model')).toBe('whisper-1');
    expect(pedidos[0]!.corpo.get('language')).toBe('pt');
    expect((pedidos[0]!.corpo.get('file') as File).name).toBe('audio.ogg');

    await expect(new TranscritorOpenAI(() => undefined, 'whisper-1', fetchFalso).transcrever(Buffer.from('x'), 'audio/ogg')).rejects.toBeInstanceOf(ErroTranscricao);
    const recusa = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(new TranscritorOpenAI(() => 'sk-ruim', 'whisper-1', recusa).transcrever(Buffer.from('x'), 'audio/ogg')).rejects.toMatchObject({ codigo: 'sem_chave' });
  });
});

describe('Botão IA da conversa', () => {
  it('sugere resposta usando a conversa, a transcrição dos áudios e a base', async () => {
    const { app, repo, norte, carla, ia } = await montar();
    await repo.adicionarMensagem({ conversaId: norte.id, autor: 'cliente', texto: 'Oi, tudo bem?', em: new Date(Date.now() - 5000) });
    const audio = await audioDaCliente(repo, norte.id);
    await app.inject({ method: 'POST', url: `/api/conversas/${norte.id}/midias/${audio}/transcrever`, headers: { cookie: carla } });
    const r = await app.inject({ method: 'POST', url: `/api/conversas/${norte.id}/ia`, headers: { cookie: carla }, payload: { acao: 'sugerir' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ acao: 'sugerir', titulo: 'Resposta sugerida', mensagem: 'Oi Juliana! A progressiva sai por R$ 180. Quer vir sábado?' });
    const pedido = ia.pedidos[0]!;
    expect(pedido.system[0]!.text).toContain('Progressiva: R$ 180.');
    expect(pedido.messages[0]!.content).toContain('transcrição do áudio: "Oi, queria saber o preço da progressiva"');
    expect(pedido.messages[0]!.content).toContain('Juliana Lima');
  });

  it('melhorar exige texto; explicar áudio transcreve o último áudio da cliente se precisar', async () => {
    const { app, repo, norte, carla, ia, transcritor } = await montar({ textoIa: 'Ela quer saber o preço.\nMENSAGEM: A progressiva sai por R$ 180!' });
    const url = `/api/conversas/${norte.id}/ia`;
    expect((await app.inject({ method: 'POST', url, headers: { cookie: carla }, payload: { acao: 'melhorar', texto: '  ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: { cookie: carla }, payload: { acao: 'explicar_audio' } })).statusCode).toBe(400);
    await audioDaCliente(repo, norte.id);
    const r = (await app.inject({ method: 'POST', url, headers: { cookie: carla }, payload: { acao: 'explicar_audio' } })).json();
    expect(r).toMatchObject({ texto: 'Ela quer saber o preço.', mensagem: 'A progressiva sai por R$ 180!' });
    expect((transcritor as TranscritorFalso).chamadas).toBe(1);
    const melhorar = await app.inject({ method: 'POST', url, headers: { cookie: carla }, payload: { acao: 'melhorar', texto: 'oi custa 180' } });
    expect(melhorar.statusCode).toBe(200);
    expect(ia.pedidos.at(-1)!.messages[0]!.content).toContain('<rascunho_da_atendente>\noi custa 180');
  });

  it('IA desligada dá erro claro; conversa que a pessoa não vê dá 404', async () => {
    const { app, norte, sumare, carla } = await montar({ iaLigada: false });
    const r = await app.inject({ method: 'POST', url: `/api/conversas/${norte.id}/ia`, headers: { cookie: carla }, payload: { acao: 'resumir' } });
    expect(r.statusCode).toBe(501);
    expect(r.json().erro).toMatch(/Conexões/);
    const outra = await montar();
    expect((await outra.app.inject({ method: 'POST', url: `/api/conversas/${outra.sumare.id}/ia`, headers: { cookie: outra.carla }, payload: { acao: 'resumir' } })).statusCode).toBe(404);
    void sumare;
  });

  it('separa o passo da mensagem sugerida', () => {
    expect(separarMensagem('PASSO: Propor sábado.\nMENSAGEM: Que tal sábado às 10h?')).toEqual({ texto: 'Propor sábado.', mensagem: 'Que tal sábado às 10h?' });
    expect(separarMensagem('PASSO: Esperar ela responder.\nMENSAGEM: nenhuma')).toEqual({ texto: 'Esperar ela responder.', mensagem: null });
    expect(separarMensagem('Só texto')).toEqual({ texto: 'Só texto', mensagem: null });
  });
});

describe('Nova conversa por número', () => {
  it('normaliza o número, cria a conversa, envia a primeira mensagem e não duplica', async () => {
    const { app, repo, carla, enviados } = await montar();
    const url = '/api/conversas/nova';
    const r = await app.inject({ method: 'POST', url, headers: { cookie: carla }, payload: { telefone: '+55 (71) 9 9123-4567', nome: 'Rita', unidade: 'norte', texto: 'Oi Rita, aqui é da Império!' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ ok: true, nova: true, telefone: '5571991234567' });
    const c = await repo.buscarConversa(r.json().id);
    expect(c).toMatchObject({ telefone: '5571991234567', nome: 'Rita', unidade: 'norte', modo: 'humano', responsavelId: expect.any(String) });
    expect(enviados).toEqual(['Oi Rita, aqui é da Império!']);
    const msgs = await repo.mensagens(c!.id);
    expect(msgs.at(-1)).toMatchObject({ autor: 'equipe', autorNome: 'Carla Souza', texto: 'Oi Rita, aqui é da Império!' });

    // Colando de outro jeito: mesma conversa.
    const de2 = await app.inject({ method: 'POST', url, headers: { cookie: carla }, payload: { telefone: '71991234567', unidade: 'norte', texto: 'Esqueci de dizer: temos horário sábado.' } });
    expect(de2.statusCode).toBe(200);
    expect(de2.json()).toMatchObject({ id: c!.id, nova: false });
    expect((await repo.listarConversas()).filter((x) => x.telefone === '5571991234567')).toHaveLength(1);
  });

  it('recusa número inválido, unidade que a pessoa não atende, unidade sem WhatsApp e cliente de outra atendente', async () => {
    const { app, repo, carla, duda, admin } = await montar();
    const post = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/conversas/nova', headers: { cookie }, payload: { texto: 'Oi!', unidade: 'norte', ...payload } });
    expect((await post(carla, { telefone: '123' })).statusCode).toBe(400);
    expect((await post(carla, { telefone: '7133334444' })).statusCode).toBe(400); // fixo não tem WhatsApp aqui
    expect((await post(carla, { telefone: '71991234567', unidade: 'sumare' })).statusCode).toBe(403);
    const semNumero = await post(admin, { telefone: '71991234567', unidade: 'sumare' });
    expect(semNumero.statusCode).toBe(400);
    expect(semNumero.json().erro).toMatch(/WhatsApp/);
    // A Carla fica dona; a Duda não pode "abrir" a mesma cliente por aqui.
    expect((await post(carla, { telefone: '71991234567' })).statusCode).toBe(201);
    const dela = await post(duda, { telefone: '71991234567' });
    expect(dela.statusCode).toBe(409);
    expect(dela.json().erro).toMatch(/Carla Souza/);
    expect((await repo.listarConversas()).length).toBe(3);
  });
});

describe('Novo contato (Nova conversa sem primeira mensagem)', () => {
  it('cria a conversa vazia, escolhe a unidade sozinho e reaproveita a que já existe', async () => {
    const { app, repo, norte, carla, admin, duda, enviados } = await montar();
    const post = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/conversas/contato', headers: { cookie }, payload });
    expect((await post(carla, { telefone: '123' })).statusCode).toBe(400);
    const r = await post(carla, { telefone: '(71) 99123-4567', nome: 'Rita' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ nova: true, telefone: '5571991234567', unidade: 'norte' });
    expect(enviados).toEqual([]);
    expect(await repo.mensagens(r.json().id)).toHaveLength(0);
    // Mesmo número: abre a mesma conversa.
    expect((await post(carla, { telefone: '71991234567' })).json()).toMatchObject({ id: r.json().id, nova: false });
    // A cliente que já conversa: devolve a conversa dela.
    expect((await post(admin, { telefone: norte.telefone })).json()).toMatchObject({ id: norte.id, nova: false });
    // Admin vê tudo, mas o Sumaré não tem WhatsApp: cai na primeira unidade conectada (Norte).
    expect((await post(admin, { telefone: '71988880000' })).json()).toMatchObject({ nova: true, unidade: 'norte' });
    // Só WhatsApp começa conversa por aqui.
    expect((await post(carla, { telefone: '71991230000', canal: 'instagram' })).statusCode).toBe(400);
    void duda;
  });

  it('cliente de outra atendente não abre por aqui', async () => {
    const { app, carla, duda } = await montar();
    const post = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/conversas/nova', headers: { cookie }, payload: { texto: 'Oi!', unidade: 'norte', ...payload } });
    expect((await post(carla, { telefone: '71991234567' })).statusCode).toBe(201);
    const dela = await app.inject({ method: 'POST', url: '/api/conversas/contato', headers: { cookie: duda }, payload: { telefone: '71991234567' } });
    expect(dela.statusCode).toBe(409);
    expect(dela.json().erro).toMatch(/Carla Souza/);
  });
});

describe('Relatório do cliente', () => {
  it('conta conversas, mensagens, agendamentos, faltas, atendentes, tempo de resposta e etapas', async () => {
    const { app, repo, norte, admin, duda } = await montar();
    const base = Date.now() - 20 * 24 * 3600_000;
    const em = (h: number) => new Date(base + h * 3600_000);
    const msg = (autor: 'cliente' | 'equipe' | 'ia', h: number, autorNome?: string) => repo.adicionarMensagem({ conversaId: norte.id, autor, autorNome, texto: 'oi', em: em(h) });
    await msg('cliente', 0); await msg('equipe', 0.5, 'Carla Souza'); await msg('cliente', 1); await msg('ia', 1.1);
    await msg('cliente', 48); await msg('equipe', 48.2, 'Duda');
    const ev = (tipo: Parameters<Repositorio['registrarEvento']>[0]['tipo'], h: number, dados: Record<string, unknown>) => repo.registrarEvento({ tipo, conversaId: norte.id, unidade: 'norte', em: em(h), dados });
    await ev('agendamento_equipe', 1.2, { servico: 'Progressiva', inicio: em(72).toISOString(), valor: 180, atendente: 'Carla Souza' });
    await ev('agendamento_ia', 48.3, { servico: 'Hidratação', inicio: new Date(Date.now() + 5 * 24 * 3600_000).toISOString(), valor: '90' });
    await ev('etapa_mudou', 1.2, { de: 'em_conversa', para: 'agendada', motivo: 'agendamento_criado' });
    await ev('etapa_mudou', 73, { de: 'agendada', para: 'compareceu', motivo: 'atendimento_finalizado' });
    await ev('ligacao', 50, { resultado: 'atendeu' });

    const r = await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/relatorio`, headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(new Date(j.chegouEm).getTime()).toBeLessThanOrEqual(em(0).getTime());
    expect(j).toMatchObject({ conversas: 2, mensagens: { total: 6, cliente: 3, equipe: 2, ia: 1 }, comparecimentos: 1, faltas: 0, ligacoes: 1, iaMensagens: 1 });
    expect(j.agendamentos).toMatchObject({ total: 2, servicos: ['Progressiva', 'Hidratação'], valorTotal: 270, ultimo: { servico: 'Progressiva', por: 'Carla Souza' }, proximo: { servico: 'Hidratação', por: 'IA' } });
    expect(j.atendentes.map((a: { nome: string }) => a.nome).sort()).toEqual(['Carla Souza', 'Duda']);
    // (30 + 6 + 12) / 3 = 16 minutos
    expect(j.tempoMedioRespostaMin).toBe(16);
    expect(j.etapas.map((e: { para: string }) => e.para)).toEqual(['agendada', 'compareceu']);

    // Conversa de outra unidade: 404.
    const outra = (await repo.listarConversas()).find((c) => c.unidade === 'sumare')!;
    expect((await app.inject({ method: 'GET', url: `/api/conversas/${outra.id}/relatorio`, headers: { cookie: duda } })).statusCode).toBe(404);
  });
});

describe.runIf(temPostgres)('Conversa no Postgres', () => {
  it('respostas rápidas e transcrições gravam e relêem', async () => {
    const pool = await poolDeTeste();
    const repo = new RepositorioPostgres(pool);
    const respostas = new RespostasPostgres(pool);
    const transcricoes = new TranscricoesPostgres(pool);
    const { app, norte, admin, carla, carlaId } = await montar({ repo, respostas, transcricoes });
    // A conta da Carla está na memória; no banco a pessoal precisa de um usuário de verdade.
    await pool.query(`insert into sintonia.usuarios (id, empresa_id, nome, email, papel, unidades, senha_hash) values ($1, 'imperio', 'Carla Souza', 'carla@imperio.com', 'atendente', '{norte}', 'x')`, [carlaId]);
    expect((await app.inject({ method: 'POST', url: '/api/respostas-rapidas', headers: { cookie: admin }, payload: { atalho: 'preco', texto: 'R$ 180' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/respostas-rapidas', headers: { cookie: admin }, payload: { atalho: 'preco', texto: 'outra' } })).statusCode).toBe(409);
    const minha = (await app.inject({ method: 'POST', url: '/api/respostas-rapidas', headers: { cookie: carla }, payload: { atalho: 'preco', texto: 'Minha versão' } })).json();
    expect(minha).toMatchObject({ pessoal: true });
    expect((await app.inject({ method: 'PATCH', url: `/api/respostas-rapidas/${minha.id}`, headers: { cookie: carla }, payload: { texto: 'Mudei' } })).json()).toMatchObject({ texto: 'Mudei' });
    expect((await respostas.listar('imperio', carlaId)).map((r) => r.texto)).toEqual(['Mudei', 'R$ 180']);
    expect(await respostas.obter('imperio', 'nao-e-uuid')).toBeUndefined();

    const id = await audioDaCliente(repo, norte.id);
    await transcricoes.guardar(norte.id, { mensagemId: id, texto: 'primeira', modelo: 'falso', criadaPor: 'Carla' });
    await transcricoes.guardar(norte.id, { mensagemId: id, texto: 'segunda', modelo: 'falso', criadaPor: 'Duda' });
    expect((await transcricoes.daConversa(norte.id)).map((t) => t.texto)).toEqual(['primeira']);

    // Relatório lê os eventos da conversa direto do banco.
    await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: norte.id, unidade: 'norte', em: new Date(), dados: { servico: 'Progressiva', inicio: new Date(Date.now() + 86400_000).toISOString(), valor: 180 } });
    const rel = (await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/relatorio`, headers: { cookie: admin } })).json();
    expect(rel.agendamentos).toMatchObject({ total: 1, valorTotal: 180, proximo: { servico: 'Progressiva' } });
  });
});

describe('Chat "Ajuda da IA" (bolinha)', () => {
  it('exige login, responde com o contexto do que a pessoa vê e manda a conversa alternada', async () => {
    const { app, repo, norte, sumare, carla, ia } = await montar({ textoIa: 'Hoje a **Juliana** está esperando resposta.' });
    expect((await app.inject({ method: 'POST', url: '/api/ia/chat', payload: { mensagens: [{ papel: 'usuario', texto: 'Oi' }] } })).statusCode).toBe(401);
    // As duas clientes mandaram mensagem e ninguém respondeu ainda.
    for (const c of [norte, sumare]) await repo.salvarConversa({ ...c, ultimaMensagemCliente: new Date(Date.now() - 12 * 60_000) });
    const r = await app.inject({
      method: 'POST',
      url: '/api/ia/chat',
      headers: { cookie: carla },
      payload: { mensagens: [{ papel: 'ia', texto: 'Olá! Como posso ajudar?' }, { papel: 'usuario', texto: 'Quem está esperando resposta?' }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ texto: 'Hoje a **Juliana** está esperando resposta.' });
    const pedido = ia.pedidos.at(-1)! as unknown as { system: Array<{ text: string }>; messages: Array<{ role: string; content: string }> };
    // A saudação da IA no começo sai: a conversa da API começa pela pessoa.
    expect(pedido.messages).toEqual([{ role: 'user', content: 'Quem está esperando resposta?' }]);
    const sistema = pedido.system.map((s) => s.text).join('\n');
    expect(sistema).toContain('Progressiva: R$ 180.');
    expect(sistema).toContain('Nunca invente números');
    expect(sistema).toContain('<esperando_resposta total="1">');
    expect(sistema).toMatch(/- Juliana Lima · .*esperando há 12 min/);
    // Carla só atende a unidade Norte: a cliente do Sumaré não entra no contexto dela.
    expect(sistema).not.toContain('Bia');
    expect(sistema).toContain('Quem pergunta: Carla Souza');
  });

  it('guarda só as últimas 20 mensagens e limita o tamanho do texto', async () => {
    const { app, carla, ia } = await montar();
    const mensagens = Array.from({ length: 31 }, (_, i) => ({ papel: i % 2 === 0 ? 'usuario' : 'ia', texto: `msg ${i}` }));
    const r = await app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie: carla }, payload: { mensagens } });
    expect(r.statusCode).toBe(200);
    const enviadas = (ia.pedidos.at(-1)! as unknown as { messages: Array<{ role: string; content: string }> }).messages;
    // Janela das últimas 20 (msg 11 a msg 30); a primeira (da IA) sai para a conversa começar pela pessoa.
    expect(enviadas).toHaveLength(19);
    expect(enviadas[0]).toEqual({ role: 'user', content: 'msg 12' });
    expect(enviadas.at(-1)).toEqual({ role: 'user', content: 'msg 30' });
    const longa = await app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie: carla }, payload: { mensagens: [{ papel: 'usuario', texto: 'x'.repeat(4001) }] } });
    expect(longa.statusCode).toBe(400);
    const deIa = await app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie: carla }, payload: { mensagens: [{ papel: 'usuario', texto: 'oi' }, { papel: 'ia', texto: 'oi!' }] } });
    expect(deIa.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie: carla }, payload: { mensagens: [] } })).statusCode).toBe(400);
  });

  it('sem a chave da IA dá erro claro apontando Conexões', async () => {
    const { app, carla, ia } = await montar({ iaLigada: false });
    const r = await app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie: carla }, payload: { mensagens: [{ papel: 'usuario', texto: 'Como está o dia?' }] } });
    expect(r.statusCode).toBe(501);
    expect(r.json().erro).toMatch(/chave da IA \(Anthropic\) em Conexões/);
    expect(ia.pedidos).toHaveLength(0);
  });
});

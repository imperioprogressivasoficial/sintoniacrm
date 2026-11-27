import { describe, expect, it } from 'vitest';
import { ArmazemBaseMemoria, BaseConhecimento } from '../src/ai/base.js';
import { anonimizar } from '../src/aprender/anonimizar.js';
import { Aprender, linhasDaConversa } from '../src/aprender/aprender.js';
import { ArmazemAprenderMemoria, ArmazemAprenderPostgres, type ArmazemAprender } from '../src/aprender/armazem.js';
import { FonteConversasPostgres, FonteConversasRepo, type FonteConversas } from '../src/aprender/fonte.js';
import { IaAprender } from '../src/aprender/ia.js';
import { registrarAprender } from '../src/aprender/rotas.js';
import type { Conversa, Etapa } from '../src/domain.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { ambientes, montarGestao } from './gestao-ambiente.js';

const BASE = `# Base

## Quem somos
- Salão Exemplo, Rua das Flores, 100.

## Serviços
- Progressiva: dura 3 horas.

## Perguntas frequentes
`;

type Pedido = { system: Array<{ text: string }>; messages: Array<{ content: Array<{ type: string; text?: string; source?: unknown }> }> };
const textoDe = (p: Pedido) => p.messages[0]!.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const tipoDe = (p: Pedido) => (p.system[0]!.text.includes('Você estuda conversas') ? 'observar' : p.system[0]!.text.includes('Você organiza') ? 'juntar' : 'documento');

/** Cliente Claude falso: responde JSON fixo conforme o tipo de pedido. */
function claudeFalso(r: { observar?: (p: Pedido, n: number) => unknown; juntar?: (p: Pedido) => unknown; documento?: (p: Pedido) => unknown }) {
  const pedidos: Array<{ tipo: string; p: Pedido }> = [];
  let observacoes = 0;
  const cliente = {
    beta: {
      messages: {
        parse: (async (p: Pedido) => {
          const tipo = tipoDe(p);
          pedidos.push({ tipo, p });
          const dados = tipo === 'observar' ? await r.observar!(p, ++observacoes) : tipo === 'juntar' ? r.juntar!(p) : r.documento!(p);
          return { parsed_output: dados, stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } };
        }) as never,
      },
    },
  };
  return { cliente, pedidos };
}

/** Observação padrão: cada lote diz que a equipe pergunta o comprimento antes do preço (em todas as conversas do lote). */
const observarPadrao = (p: Pedido) => {
  const ns = [...textoDe(p).matchAll(/<conversa n="(\d+)"/g)].map((m) => Number(m[1]));
  return {
    observacoes: [
      { categoria: 'roteiro', texto: 'Pergunta o comprimento do cabelo antes de falar preço.', conversas: ns, exemplo: 'Equipe: Qual o comprimento do seu cabelo?' },
      { categoria: 'tom', texto: 'Usa emoji de coração no cumprimento.', conversas: ns.slice(0, 2), exemplo: null },
      { categoria: 'fato', texto: 'A progressiva custa R$ 350.', conversas: ns, exemplo: null },
      { categoria: 'fato', texto: 'A progressiva dura 4 horas.', conversas: ns, exemplo: null },
    ],
  };
};
const proposta = (x: Record<string, unknown>) => ({
  categoria: 'roteiro', acao: 'acrescentar', destino: '', titulo: 'T', texto: 'X', pergunta: null, resposta: null, trecho_atual: null,
  observacoes: [], exemplos: [], conferir: false, contradiz: false, motivo: null, reforca_id: null, ...x,
});

interface Montado {
  aprender: Aprender;
  armazem: ArmazemAprender;
  base: BaseConhecimento;
  repo: Repositorio;
  relogio: { t: Date };
  logs: string[];
  fonte: FonteConversas;
  criarConversa: (d: { nome: string; equipe: number; etapa?: Etapa; canalId?: string; arquivada?: boolean; texto?: string }) => Promise<Conversa>;
  novo: (claude: ReturnType<typeof claudeFalso>, o?: { iaLigada?: boolean; lote?: number }) => Aprender;
}

async function montar(amb: (typeof ambientes)[number], claude: ReturnType<typeof claudeFalso>, o: { iaLigada?: boolean; lote?: number } = {}): Promise<Montado> {
  const { repo, pool } = await amb.criar();
  if (pool) await pool.query('truncate sintonia.aprender_config, sintonia.aprender_rodadas, sintonia.aprender_itens, sintonia.aprender_lidas');
  const relogio = { t: new Date('2026-11-20T15:00:00Z') };
  const agora = () => relogio.t;
  const armazem: ArmazemAprender = pool ? new ArmazemAprenderPostgres(pool) : new ArmazemAprenderMemoria();
  const base = new BaseConhecimento(new ArmazemBaseMemoria(), 'imperio', () => BASE, { cacheMs: 0, agora });
  const fonte: FonteConversas = pool ? new FonteConversasPostgres(pool, repo) : new FonteConversasRepo(repo, async () => ['Carla Lima']);
  const logs: string[] = [];
  const novo = (c: ReturnType<typeof claudeFalso>, x: { iaLigada?: boolean; lote?: number } = {}) => {
    const a = new Aprender({ empresaId: 'imperio', armazem, fonte, base, ia: new IaAprender(c.cliente, () => 'claude-opus-5-5'), iaLigada: () => x.iaLigada ?? true, agora, log: (m) => logs.push(m), limites: { lote: x.lote ?? 5 } });
    base.usarAprendido(() => a.memoria());
    return a;
  };
  let tel = 0;
  const criarConversa: Montado['criarConversa'] = async (d) => {
    const telefone = `5571988120${String(++tel).padStart(3, '0')}`;
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: d.canalId ?? 'imperio-norte', telefone, nome: d.nome, agora: relogio.t });
    let t = relogio.t.getTime();
    const msg = async (autor: 'cliente' | 'equipe', texto: string, autorNome?: string) =>
      repo.adicionarMensagem({ conversaId: conversa.id, autor, texto, em: new Date((t += 60_000)), ...(autorNome ? { autorNome } : {}) });
    await msg('cliente', d.texto ?? `Oi, meu nome é ${d.nome}, meu telefone é (71) 98812-4471 e o e-mail ${d.nome.toLowerCase()}@gmail.com`);
    for (let i = 0; i < d.equipe; i++) await msg('equipe', `Oi ${d.nome}! Qual o comprimento do seu cabelo? Beijos, Carla`, 'Carla Lima');
    await msg('cliente', 'Até o ombro');
    const c = (await repo.buscarConversa(conversa.id))!;
    const atual: Conversa = { ...c, etapa: d.etapa ?? 'em_conversa', ultimaMensagemEquipe: d.equipe ? new Date(t - 60_000) : undefined, ultimaMensagemCliente: new Date(t) };
    await repo.salvarConversa(atual);
    if (d.arquivada) await repo.arquivarConversas('imperio', [c.id], relogio.t, 'numero_antigo');
    return atual;
  };
  const aprender = novo(claude, o);
  return { aprender, armazem, base, repo, relogio, logs, fonte, criarConversa, novo };
}

describe('anonimizar', () => {
  it('tira telefone, e-mail, documento, link com código e nomes', () => {
    const t = anonimizar('Oi, sou a Joana Prado. Meu zap 71 98812-4471, +55 (71) 3333-4444, joana.p@gmail.com, CPF 123.456.789-09. Pague em https://pay.site.com/abc?id=999. Beijo da Carla', {
      clientes: ['Joana Prado'],
      equipe: ['Carla Lima'],
    });
    expect(t).not.toMatch(/Joana|Prado|98812|3333|gmail|123\.456|abc\?id|Carla/);
    expect(t).toContain('[cliente]');
    expect(t).toContain('[telefone]');
    expect(t).toContain('[email]');
    expect(t).toContain('[documento]');
    expect(t).toContain('[link pay.site.com]');
    expect(t).toContain('[atendente]');
  });

  it('nome com ou sem acento e o que a cliente diz de si; preço e hora ficam', () => {
    expect(anonimizar('Oi Ângela! Aqui é a Márcia. Fica R$ 350 às 14:30', { clientes: ['Angela'] })).toBe('Oi [cliente]! Aqui é a [cliente]. Fica R$ 350 às 14:30');
    expect(anonimizar('meu nome é Lu', {})).toBe('meu nome é [cliente]');
  });

  it('a conversa vira linhas sem dados pessoais (sem mensagens do sistema)', () => {
    const em = new Date();
    const l = linhasDaConversa(
      [
        { id: '1', conversaId: 'c', autor: 'cliente', texto: 'Oi, sou a Bia, 71988124471', em },
        { id: '2', conversaId: 'c', autor: 'sistema', texto: 'Conversa transferida', em },
        { id: '3', conversaId: 'c', autor: 'equipe', autorNome: 'Rita Souza', texto: 'Oi Bia! Rita aqui 💜', em },
      ],
      { clientes: ['Beatriz Bia'], equipe: [] },
    );
    expect(l).toEqual(['Cliente: Oi, sou a [cliente], [telefone]', 'Equipe: Oi [cliente]! [atendente] aqui 💜']);
  });
});

describe.each(ambientes)('Aprender com a equipe ($nome)', (amb) => {
  it('escolhe só conversas da equipe, primeiro as que agendaram, e depois só as novas', async () => {
    const m = await montar(amb, claudeFalso({}));
    const f = m.fonte;
    const a = await m.criarConversa({ nome: 'Ana', equipe: 2 });
    const b = await m.criarConversa({ nome: 'Bia', equipe: 3, etapa: 'agendada' });
    const c = await m.criarConversa({ nome: 'Cida', equipe: 5 });
    await m.criarConversa({ nome: 'Duda', equipe: 1 }); // só 1 da equipe
    await m.criarConversa({ nome: 'Eva', equipe: 0 }); // só a IA/ninguém
    await m.criarConversa({ nome: 'Fê', equipe: 4, canalId: 'teste-norte' }); // WhatsApp de teste
    await m.criarConversa({ nome: 'Gabi', equipe: 4, arquivada: true });
    const l = await f.candidatas('imperio', new Map(), 300);
    expect(l.map((x) => x.id)).toEqual([b.id, c.id, a.id]);
    expect(l[0]).toMatchObject({ agendou: true, equipe: 3 });
    expect(await f.candidatas('outra', new Map(), 300)).toEqual([]);
    // Já lidas até a última mensagem da equipe: saem; com mensagem nova da equipe depois, voltam.
    await m.armazem.marcarLidas('imperio', l.map((x) => ({ id: x.id, ate: x.ultimaEquipe })));
    const lidas = await m.armazem.lidas('imperio');
    expect(await f.candidatas('imperio', lidas, 300)).toEqual([]);
    await m.repo.salvarConversa({ ...(await m.repo.buscarConversa(a.id))!, ultimaMensagemEquipe: new Date(m.relogio.t.getTime() + 3600_000) });
    expect((await f.candidatas('imperio', lidas, 300)).map((x) => x.id)).toEqual([a.id]);
  });

  it('estuda em lotes sem dados pessoais e aplica sozinho só o que aparece em 3+ conversas sem contradizer nem citar valor', async () => {
    const claude = claudeFalso({
      observar: observarPadrao,
      juntar: () => ({
        propostas: [
          proposta({ categoria: 'roteiro', titulo: 'Comprimento antes do preço', texto: 'Antes de falar preço, pergunte o comprimento do cabelo.', observacoes: [1, 5, 9], exemplos: ['Equipe: Qual o comprimento, Joana?'] }),
          proposta({ categoria: 'tom', destino: 'servicos', titulo: 'Coração', texto: 'Use 💜 no cumprimento.', observacoes: [2] }),
          proposta({ categoria: 'fato', destino: 'servicos', titulo: 'Preço', texto: 'A progressiva custa R$ 350.', observacoes: [3, 7, 11] }),
          proposta({ categoria: 'fato', acao: 'corrigir', destino: 'servicos', titulo: 'Duração', texto: '- Progressiva: dura 4 horas.', trecho_atual: '- Progressiva: dura 3 horas.', observacoes: [4, 8, 12], conferir: true, contradiz: true, motivo: 'A base diz 3 horas.' }),
          proposta({ categoria: 'pergunta', acao: 'pergunta', titulo: 'Pode lavar?', texto: 'Lavar depois', pergunta: 'Quando posso lavar?', resposta: 'Depois de 3 dias.', observacoes: [1, 5, 9] }),
        ],
      }),
    });
    const m = await montar(amb, claude);
    const nomes = ['Joana Prado', 'Lia', 'Mara', 'Nina', 'Olga', 'Pati', 'Quel', 'Rosa', 'Sara', 'Tati', 'Ully', 'Vera'];
    for (const [i, nome] of nomes.entries()) await m.criarConversa({ nome, equipe: 2 + (i % 3), etapa: i < 4 ? 'agendada' : 'em_conversa' });
    const r = await m.aprender.estudar('Bruno');
    expect(r).toMatchObject({ situacao: 'estudando', total: 12, lidas: 0 });
    await m.aprender.esperar();

    // 12 conversas em lotes de 5 = 3 leituras + 1 para juntar.
    expect(claude.pedidos.map((x) => x.tipo)).toEqual(['observar', 'observar', 'observar', 'juntar']);
    for (const { p } of claude.pedidos) {
      const t = textoDe(p);
      expect(t).not.toMatch(/Joana|Prado|98812|gmail|Carla/);
    }
    expect(textoDe(claude.pedidos[0]!.p)).toContain('agendou="sim"');
    const est = await m.aprender.estado();
    expect(est.rodada).toMatchObject({ situacao: 'pronta', lidas: 12, total: 12, resultado: { lidas: 12, aprendizados: 5, entraram: 2, paraAprovar: 3 } });
    expect(est.rodada!.gastoUsd).toBeGreaterThan(0);
    expect(m.logs).toContain('Estudo das conversas: 12 lidas, 5 aprendizados (2 entraram, 3 para aprovar)');

    const aprendidos = await m.aprender.itens('aprendidos');
    expect(aprendidos.map((x) => x.titulo).sort()).toEqual(['Comprimento antes do preço', 'Pode lavar?']);
    expect(aprendidos.every((x) => x.automatico && x.conversas === 12)).toBe(true);
    expect(aprendidos.find((x) => x.titulo === 'Comprimento antes do preço')!.exemplos[0]).toBe('Equipe: Qual o comprimento, [cliente]?');
    const pend = await m.aprender.itens('pendentes');
    expect(pend.find((x) => x.titulo === 'Duração')).toMatchObject({ acao: 'corrigir', conferir: true, contradiz: true, motivo: 'A base diz 3 horas.' });
    expect(pend.find((x) => x.titulo === 'Coração')!.conversas).toBe(2);

    // A memória entra no texto da IA que atende.
    const texto = await m.base.texto();
    expect(texto).toContain('Antes de falar preço, pergunte o comprimento do cabelo.');
    expect(texto).toContain('Pergunta: Quando posso lavar?\n  Resposta: Depois de 3 dias.');
    expect(texto).not.toContain('R$ 350');
    expect(texto).toContain('dura 3 horas');

    // Estudar de novo sem conversa nova: nada para ler.
    const de_novo = await m.aprender.estudar('Bruno');
    expect(de_novo).toMatchObject({ situacao: 'pronta', total: 0 });
    await m.aprender.esperar();
    expect(claude.pedidos).toHaveLength(4);
  });

  it('continua de onde parou depois de reiniciar', async () => {
    let travar = true;
    const claude = claudeFalso({
      observar: (p, n) => (n === 2 && travar ? new Promise(() => {}) : observarPadrao(p)),
      juntar: () => ({ propostas: [proposta({ titulo: 'Comprimento', texto: 'Pergunte o comprimento antes do preço.', observacoes: [1, 6, 7] })] }),
    });
    const m = await montar(amb, claude);
    for (let i = 0; i < 8; i++) await m.criarConversa({ nome: `Cliente${i}`, equipe: 2 });
    await m.aprender.estudar('Bruno');
    await new Promise((r) => setTimeout(r, 300));
    expect((await m.aprender.estado()).rodada).toMatchObject({ situacao: 'estudando', lidas: 5, total: 8 });

    // "Reiniciou": um novo serviço com o mesmo banco. Antes da folga, não pega (pode haver outro processo trabalhando).
    travar = false;
    const claude2 = claudeFalso({ observar: observarPadrao, juntar: () => ({ propostas: [proposta({ titulo: 'Comprimento', texto: 'Pergunte o comprimento antes do preço.', observacoes: [1, 6, 7] })] }) });
    const depois = m.novo(claude2);
    expect(await depois.retomar()).toBe(0);
    m.relogio.t = new Date(m.relogio.t.getTime() + 11 * 60_000);
    expect(await depois.retomar()).toBe(1);
    await depois.esperar();
    expect(claude2.pedidos.map((x) => x.tipo)).toEqual(['observar', 'juntar']);
    expect(textoDe(claude2.pedidos[0]!.p)).toContain('<conversa n="6"');
    expect(textoDe(claude2.pedidos[0]!.p)).not.toContain('<conversa n="1"');
    const est = await depois.estado();
    expect(est.rodada).toMatchObject({ situacao: 'pronta', lidas: 8, resultado: { entraram: 1 } });
    expect(m.logs.some((l) => l.includes('continuando de onde parou (5 de 8)'))).toBe(true);
  });

  it('aprovar, editar, recusar e desfazer (a base volta ao que era e a versão fica no histórico)', async () => {
    const claude = claudeFalso({
      observar: observarPadrao,
      juntar: () => ({
        propostas: [
          proposta({ titulo: 'Coração', texto: 'Use 💜.', observacoes: [2] }),
          proposta({ categoria: 'fato', acao: 'corrigir', destino: 'servicos', titulo: 'Duração', texto: '- Progressiva: dura 4 horas.', trecho_atual: '- Progressiva: dura 3 horas.', observacoes: [4], conferir: true }),
          proposta({ titulo: 'Ruim', texto: 'Mande áudio.', observacoes: [2] }),
          proposta({ titulo: 'Sozinho', texto: 'Ofereça dois horários.', observacoes: [1, 2, 3] }),
        ],
      }),
    });
    const m = await montar(amb, claude);
    for (let i = 0; i < 3; i++) await m.criarConversa({ nome: `C${i}`, equipe: 2 });
    await m.aprender.estudar('Bruno');
    await m.aprender.esperar();
    const pend = await m.aprender.itens('pendentes');
    const id = (t: string) => pend.find((x) => x.titulo === t)!.id;

    await m.aprender.aprovar(id('Coração'), { texto: 'Use 💜 no primeiro oi.', destino: 'quem-somos' }, 'Gil');
    expect(await m.base.texto()).toMatch(/## Quem somos[\s\S]*Aprendido com a equipe[\s\S]*Use 💜 no primeiro oi\./);
    await m.aprender.aprovar(id('Duração'), {}, 'Gil');
    expect((await m.base.exigirSecao('servicos')).conteudo).toBe('- Progressiva: dura 4 horas.');
    await m.aprender.recusar(id('Ruim'), 'Gil');
    await expect(m.aprender.aprovar(id('Ruim'), {}, 'Gil')).rejects.toMatchObject({ statusCode: 409 });
    expect(await m.base.texto()).not.toContain('Mande áudio');

    // Desfazer o que entrou sozinho e o que mudou a base.
    const sozinho = (await m.aprender.itens('aprendidos')).find((x) => x.titulo === 'Sozinho')!;
    expect(sozinho.automatico).toBe(true);
    await m.aprender.desfazer(sozinho.id, 'Gil');
    expect(await m.base.texto()).not.toContain('Ofereça dois horários');
    await m.aprender.desfazer(id('Duração'), 'Gil');
    expect((await m.base.exigirSecao('servicos')).conteudo).toBe('- Progressiva: dura 3 horas.');
    const versoes = await m.base.historico('servicos');
    expect(versoes.map((v) => v.conteudo)).toEqual(['- Progressiva: dura 3 horas.', '- Progressiva: dura 4 horas.', '- Progressiva: dura 3 horas.']);
    await expect(m.aprender.desfazer(sozinho.id, 'Gil')).rejects.toMatchObject({ statusCode: 409 });
    const lista = await m.aprender.itens('aprendidos');
    expect(lista.find((x) => x.id === sozinho.id)).toMatchObject({ situacao: 'desfeito', desfeitoPor: 'Gil' });
  });

  it('com "Aprender sozinha" desligada tudo espera aprovação e ela não estuda sozinha', async () => {
    const claude = claudeFalso({ observar: observarPadrao, juntar: () => ({ propostas: [proposta({ titulo: 'Sozinho', texto: 'Ofereça dois horários.', observacoes: [1] })] }) });
    const m = await montar(amb, claude);
    for (let i = 0; i < 3; i++) await m.criarConversa({ nome: `C${i}`, equipe: 2 });
    await m.aprender.configurar({ auto: false }, 'Bruno');
    expect(await m.aprender.tick()).toBe('nada');
    expect(claude.pedidos).toHaveLength(0);
    await m.aprender.estudar('Bruno');
    await m.aprender.esperar();
    expect((await m.aprender.estado()).rodada!.resultado).toMatchObject({ entraram: 0, paraAprovar: 1 });
  });

  it('sobe pela primeira vez: estuda sozinha se tem chave e conversas da equipe; depois só no dia seguinte', async () => {
    const claude = claudeFalso({ observar: observarPadrao, juntar: () => ({ propostas: [] }) });
    const semChave = await montar(amb, claude, { iaLigada: false });
    await semChave.criarConversa({ nome: 'Ana', equipe: 2 });
    expect(await semChave.aprender.tick()).toBe('nada');
    await expect(semChave.aprender.estudar('Bruno')).rejects.toMatchObject({ statusCode: 409 });

    const m = await montar(amb, claude);
    expect(await m.aprender.tick()).toBe('nada'); // sem conversas da equipe
    await m.criarConversa({ nome: 'Ana', equipe: 2 });
    expect(await m.aprender.tick()).toBe('estudando');
    await m.aprender.esperar();
    expect((await m.aprender.estado()).rodada).toMatchObject({ situacao: 'pronta', pedidaPor: 'automático (primeira vez)' });
    await m.criarConversa({ nome: 'Bia', equipe: 2 });
    m.relogio.t = new Date(m.relogio.t.getTime() + 2 * 3600_000);
    expect(await m.aprender.tick()).toBe('nada'); // só 1 nova, menos de um dia
    m.relogio.t = new Date(m.relogio.t.getTime() + 23 * 3600_000);
    expect(await m.aprender.tick()).toBe('estudando');
    await m.aprender.esperar();
    expect((await m.aprender.estado()).rodada).toMatchObject({ pedidaPor: 'automático', total: 1 });
  });

  it('PDF do dono: a IA propõe o que muda e tudo espera a gestão', async () => {
    const texto = 'Como atendemos: sempre pergunte o nome, o comprimento e se tem química. Oferecemos dois horários e a unidade mais perto. '.repeat(3);
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length 99 >>\nstream\nBT /F1 12 Tf (${texto}) Tj ET\nendstream\nendobj\n%%EOF`, 'latin1');
    const claude = claudeFalso({
      documento: () => ({
        propostas: [
          proposta({ titulo: 'Dois horários', texto: 'Ofereça dois horários e a unidade mais perto.', exemplos: ['Oferecemos dois horários'] }),
          proposta({ categoria: 'pergunta', acao: 'pergunta', titulo: 'Química', texto: 'x', pergunta: 'Tem química?', resposta: 'Pergunte sempre.' }),
        ],
      }),
    });
    const m = await montar(amb, claude);
    const r = await m.aprender.enviarDocumento({ nome: 'atendimento.pdf', base64: pdf.toString('base64') }, 'Bruno');
    expect(r).toMatchObject({ origem: 'documento', situacao: 'estudando', documentoNome: 'atendimento.pdf' });
    await m.aprender.esperar();
    expect(textoDe(claude.pedidos[0]!.p)).toContain('sempre pergunte o nome, o comprimento');
    expect(claude.pedidos[0]!.p.messages[0]!.content.some((b) => b.type === 'document')).toBe(false);
    const pend = await m.aprender.itens('pendentes');
    expect(pend).toHaveLength(2);
    expect(pend.every((x) => x.origem === 'documento: atendimento.pdf' && x.situacao === 'pendente')).toBe(true);
    expect((await m.aprender.estado()).documentos[0]).toMatchObject({ situacao: 'pronta', resultado: { paraAprovar: 2 } });

    // PDF sem texto legível (escaneado): vai o próprio PDF para a IA ler.
    const escaneado = Buffer.from('%PDF-1.4\n%%EOF', 'latin1');
    await m.aprender.enviarDocumento({ nome: 'foto.pdf', base64: escaneado.toString('base64') }, 'Bruno');
    await m.aprender.esperar();
    expect(claude.pedidos[1]!.p.messages[0]!.content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    await expect(m.aprender.enviarDocumento({ nome: 'x.pdf', base64: Buffer.from('não é pdf').toString('base64') }, 'Bruno')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('só a gestão vê e mexe (rotas)', async () => {
    const claude = claudeFalso({ observar: observarPadrao, juntar: () => ({ propostas: [proposta({ titulo: 'P', texto: 'Pergunte o nome.', observacoes: [1] })] }) });
    const g = await montarGestao(amb);
    const m = await montar({ nome: amb.nome, criar: async () => ({ repo: g.repo, contas: g.contas, pool: g.pool }) }, claude);
    registrarAprender(g.app, { aprender: (e) => (e === 'imperio' ? m.aprender : undefined), empresaId: 'imperio' });
    await m.criarConversa({ nome: 'Ana', equipe: 2 });
    for (const u of [g.gente.carla, g.gente.rita]) {
      expect((await g.como(u, 'GET', '/api/ia/aprender')).statusCode).toBe(403);
      expect((await g.como(u, 'POST', '/api/ia/aprender/estudar')).statusCode).toBe(403);
      expect((await g.como(u, 'PATCH', '/api/ia/aprender/config', { auto: false })).statusCode).toBe(403);
      expect((await g.como(u, 'POST', '/api/ia/aprender/documento', { nome: 'a.txt', texto: 'oi' })).statusCode).toBe(403);
    }
    expect((await g.como(g.gente.gerenteNorte, 'GET', '/api/ia/aprender')).json()).toMatchObject({ iaLigada: true, config: { auto: true }, pendentes: 0 });
    expect((await g.como(g.gente.admin, 'POST', '/api/ia/aprender/estudar')).statusCode).toBe(202);
    await m.aprender.esperar();
    const pend = (await g.como(g.gente.direcao, 'GET', '/api/ia/aprender/itens?lista=pendentes')).json();
    expect(pend).toHaveLength(1);
    expect(pend[0]).not.toHaveProperty('empresaId');
    expect((await g.como(g.gente.carla, 'POST', `/api/ia/aprender/itens/${pend[0].id}/aprovar`, {})).statusCode).toBe(403);
    expect((await g.como(g.gente.admin, 'POST', `/api/ia/aprender/itens/${pend[0].id}/aprovar`, { texto: '' })).statusCode).toBe(400);
    expect((await g.como(g.gente.admin, 'POST', '/api/ia/aprender/itens/nao-existe/aprovar', {})).statusCode).toBe(400);
    expect((await g.como(g.gente.admin, 'POST', `/api/ia/aprender/itens/${pend[0].id}/aprovar`, { texto: 'Pergunte o nome dela.' })).json()).toMatchObject({ situacao: 'aplicado', decididoPor: 'Bruno Batista' });
    expect((await g.como(g.gente.admin, 'POST', `/api/ia/aprender/itens/${pend[0].id}/desfazer`)).json()).toMatchObject({ situacao: 'desfeito' });
    expect((await g.como(g.gente.admin, 'PATCH', '/api/ia/aprender/config', { auto: false })).json()).toMatchObject({ auto: false });
    expect((await g.como(g.gente.admin, 'POST', '/api/ia/aprender/documento', { nome: 'a.exe', texto: 'oi' })).statusCode).toBe(400);
  });
});

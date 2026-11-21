import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { EvolutionAdmin } from '../src/channels/evolution-admin.js';
import { lerWebhookEvolution } from '../src/channels/evolution.js';
import { CanalTeste } from '../src/channels/teste.js';
import { limparNome, MAX_NOME, nomeDoWhatsapp, nomeEhReal, nomeOuTelefone, nomeParaTrocar } from '../src/contatos/nome.js';
import { NomesWhatsapp } from '../src/contatos/nomes-whatsapp.js';
import { formatarTelefoneBR } from '../src/leads/telefone-br.js';
import { fabricas } from './repos.js';

// contato-nome (pedido do dono 21/11): nome do WhatsApp no lugar do número, telefone no padrão +55 (71) 99220-0365.

describe('regra do nome do WhatsApp', () => {
  it('nome com letra é de verdade; número, símbolos e emojis não', () => {
    expect(nomeEhReal('Ana Paula')).toBe(true);
    expect(nomeEhReal('张伟')).toBe(true);
    expect(nomeEhReal('557192200365')).toBe(false);
    expect(nomeEhReal('+55 (71) 99220-0365')).toBe(false);
    expect(nomeEhReal('...')).toBe(false);
    expect(nomeEhReal('🌸🌸')).toBe(false);
    expect(nomeEhReal('')).toBe(false);
    expect(nomeEhReal(undefined)).toBe(false);
  });

  it('pushName: limpa invisíveis e espaços, recusa lixo e corta em 60', () => {
    expect(nomeDoWhatsapp('  Ana\u200B   Paula \u202E')).toBe('Ana Paula');
    expect(nomeDoWhatsapp('.')).toBeUndefined();
    expect(nomeDoWhatsapp('😍😍')).toBeUndefined();
    expect(nomeDoWhatsapp('\u3164')).toBeUndefined(); // "nome em branco" com caractere Hangul
    expect(nomeDoWhatsapp('5571992200365')).toBeUndefined();
    expect(nomeDoWhatsapp('+55 71 99220-0365')).toBeUndefined();
    expect(nomeDoWhatsapp('123456@lid')).toBeUndefined();
    expect(nomeDoWhatsapp(null)).toBeUndefined();
    const longo = nomeDoWhatsapp('A'.repeat(120))!;
    expect(longo).toHaveLength(MAX_NOME);
    // não parte emoji ao meio
    const comEmoji = nomeDoWhatsapp('B'.repeat(59) + '😍😍')!;
    expect(Array.from(comEmoji)).toHaveLength(60);
    expect(comEmoji.endsWith('😍')).toBe(true);
    expect(limparNome('Maria  \n  Clara')).toBe('Maria Clara');
  });

  it('só troca nome que não é de verdade; nome digitado pela equipe nunca muda', () => {
    expect(nomeParaTrocar('557192200365', 'Juliana')).toBe('Juliana');
    expect(nomeParaTrocar(undefined, 'Juliana')).toBe('Juliana');
    expect(nomeParaTrocar('', 'Juliana')).toBe('Juliana');
    expect(nomeParaTrocar('+55 (71) 99220-0365', 'Juliana')).toBe('Juliana');
    expect(nomeParaTrocar('...', 'Juliana')).toBe('Juliana');
    expect(nomeParaTrocar('Ju da Bahia', 'Juliana')).toBeUndefined();
    expect(nomeParaTrocar('557192200365', '...')).toBeUndefined();
    expect(nomeParaTrocar('557192200365', '557192200365')).toBeUndefined();
  });

  it('nome para texto: nome, ou o telefone no padrão', () => {
    expect(nomeOuTelefone('Ana', '5571992200365')).toBe('Ana');
    expect(nomeOuTelefone('5571992200365', '5571992200365')).toBe('+55 (71) 99220-0365');
    expect(nomeOuTelefone(undefined, '5571992200365')).toBe('+55 (71) 99220-0365');
  });
});

/** O mesmo arquivo que a tela carrega (public/telas/fone.js), rodado aqui. */
function foneDaTela(): { formatar: (t: unknown) => string; rotulo: (n: unknown, t: unknown) => string; temNome: (n: unknown) => boolean } {
  const janela: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(new URL('../public/telas/fone.js', import.meta.url), 'utf8'), { window: janela });
  return janela.SintoniaFone as never;
}

describe('telefone no padrão +55 (71) 99220-0365', () => {
  const tela = foneDaTela();
  const casos: Array<[string, string]> = [
    ['5571992200365', '+55 (71) 99220-0365'], // celular com 55
    ['71992200365', '+55 (71) 99220-0365'], // celular sem 55
    ['+55 (71) 99220-0365', '+55 (71) 99220-0365'], // já formatado
    ['557192200365', '+55 (71) 99220-0365'], // celular antigo, sem o 9º dígito
    ['7192200365', '+55 (71) 99220-0365'], // sem 55 e sem o 9
    ['557133334444', '+55 (71) 3333-4444'], // fixo com 55
    ['7133334444', '+55 (71) 3333-4444'], // fixo sem 55
    ['0055 71 99220-0365', '+55 (71) 99220-0365'], // 00 = discagem internacional
    ['351912345678', '+351 912 345 678'], // Portugal
    ['14155552671', '+1 (415) 555-2671'], // Estados Unidos
    ['447911123456', '+44 791 112 3456'], // Reino Unido
    ['ig:123456', 'ig:123456'], // rede social: volta como veio
    ['', ''],
  ];
  it.each(casos)('servidor: %s → %s', (entrada, saida) => {
    expect(formatarTelefoneBR(entrada)).toBe(saida);
  });
  it.each(casos)('tela: %s → %s', (entrada, saida) => {
    expect(tela.formatar(entrada)).toBe(saida);
  });
  it('tela: nome que é número mostra o telefone formatado', () => {
    expect(tela.rotulo('557192200365', '557192200365')).toBe('+55 (71) 99220-0365');
    expect(tela.rotulo('', '5571992200365')).toBe('+55 (71) 99220-0365');
    expect(tela.rotulo('Ana', '5571992200365')).toBe('Ana');
    expect(tela.temNome('...')).toBe(false);
  });
});

describe.each(fabricas)('nome do WhatsApp na conversa ($nome)', (f) => {
  async function montar() {
    const repo = await f.criar();
    const canal = new CanalTeste();
    const sintonia = new Sintonia({
      empresaId: 'imperio',
      repo,
      numeros: [{ canalId: 'sintonia-norte', unidade: 'norte', canal }],
      agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) },
      modoInicial: async () => 'humano',
    });
    return { repo, sintonia };
  }
  const msg = (telefone: string, nome: string | undefined, id: string, deMim = false) => ({
    canalId: 'sintonia-norte', telefone, nome, texto: 'oi', deMim, idExterno: id, em: new Date('2026-11-21T12:00:00Z'),
  });

  it('conversa que estava só com o número ganha o nome na próxima mensagem', async () => {
    const { repo, sintonia } = await montar();
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'sintonia-norte', telefone: '5571992200365', nome: '557192200365', agora: new Date() });
    await sintonia.receber(msg('5571992200365', '  Juliana\u200B Souza ', 'm1'));
    expect((await repo.buscarConversa(conversa.id))?.nome).toBe('Juliana Souza');
  });

  it('conversa que começou por nós (sem nome) ganha o nome quando a cliente responde', async () => {
    const { repo, sintonia } = await montar();
    await sintonia.receber(msg('5571992200366', 'Loja Império', 'm0', true));
    const [c0] = await repo.listarConversas();
    expect(c0?.nome).toBeFalsy();
    await sintonia.receber(msg('5571992200366', 'Bia', 'm1'));
    expect((await repo.buscarConversa(c0!.id))?.nome).toBe('Bia');
  });

  it('nome digitado pela equipe nunca é trocado; lixo é ignorado; nome longo é cortado', async () => {
    const { repo, sintonia } = await montar();
    const { conversa: a } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'sintonia-norte', telefone: '5571992200367', agora: new Date() });
    await sintonia.renomearCliente(a.id, 'Dona Maria do Salão');
    await sintonia.receber(msg('5571992200367', 'Maria', 'm1'));
    expect((await repo.buscarConversa(a.id))?.nome).toBe('Dona Maria do Salão');

    await sintonia.receber(msg('5571992200368', '...', 'm2'));
    await sintonia.receber(msg('5571992200369', 'X'.repeat(120), 'm3'));
    const lista = await repo.listarConversas();
    expect(lista.find((c) => c.telefone === '5571992200368')?.nome).toBeFalsy();
    expect(lista.find((c) => c.telefone === '5571992200369')?.nome).toHaveLength(60);
  });

  it('lista as conversas sem nome de verdade', async () => {
    const { repo } = await montar();
    const agora = new Date();
    const base = { empresaId: 'imperio', unidade: 'norte' as const, canalId: 'sintonia-norte', agora };
    await repo.buscarOuCriarConversa({ ...base, telefone: '5571900000001', nome: 'Ana' });
    await repo.buscarOuCriarConversa({ ...base, telefone: '5571900000002', nome: '5571900000002' });
    await repo.buscarOuCriarConversa({ ...base, telefone: '5571900000003' });
    await repo.buscarOuCriarConversa({ ...base, telefone: '5571900000004', nome: '张伟' });
    await repo.buscarOuCriarConversa({ ...base, empresaId: 'outra', telefone: '5571900000005' });
    const sem = await repo.conversasSemNome('imperio', 100);
    expect(sem.map((c) => c.telefone).sort()).toEqual(['5571900000002', '5571900000003']);
  });

  it('rotina: preenche as antigas pelos contatos da Evolution, sem mexer em nome da equipe', async () => {
    const { repo, sintonia } = await montar();
    const agora = new Date();
    const base = { empresaId: 'imperio', unidade: 'norte' as const, canalId: 'sintonia-norte', agora };
    const { conversa: semNome } = await repo.buscarOuCriarConversa({ ...base, telefone: '5571911110001', nome: '5571911110001' });
    const { conversa: vazia } = await repo.buscarOuCriarConversa({ ...base, telefone: '5571911110002' });
    const { conversa: daEquipe } = await repo.buscarOuCriarConversa({ ...base, telefone: '5571911110003', nome: 'Cliente VIP' });
    const { conversa: lixo } = await repo.buscarOuCriarConversa({ ...base, telefone: '5571911110004' });
    const { conversa: daLoja } = await repo.buscarOuCriarConversa({ ...base, telefone: '5571911110005' });
    const chamadas: string[] = [];
    const admin = {
      info: async (canal: string) => ({ nome: canal, estado: 'conectada' as const, numero: null, perfil: canal === 'sintonia-norte' ? 'Império Norte' : null }),
      nomesDeContatos: async (canal: string) => {
        chamadas.push(canal);
        if (canal === 'sintonia-sul') throw new Error('Evolution fora do ar');
        return new Map([
          ['5571911110001', 'Carla Dias'],
          ['5571911110002', 'Bruna'],
          ['5571911110003', 'Outro Nome'],
          ['5571911110004', '🙂🙂'],
          ['5571911110005', 'Império Norte'],
        ]);
      },
    };
    const logs: string[] = [];
    const pausas: number[] = [];
    const rotina = new NomesWhatsapp({
      empresaId: 'imperio',
      admin: () => admin,
      canais: () => ['sintonia-norte', 'sintonia-sul'],
      semNome: (e, l) => repo.conversasSemNome(e, l),
      aplicar: (id, nome) => sintonia.nomeDoWhatsapp(id, nome),
      log: (m) => logs.push(m),
      lote: 1,
      esperar: async (ms) => { pausas.push(ms); },
    });
    const r = await rotina.rodar();
    expect(chamadas).toEqual(['sintonia-norte', 'sintonia-sul']);
    expect(r).toMatchObject({ achados: 2, atualizadas: 2, falhas: 1 });
    expect(pausas.length).toBe(2); // um lote de 1 por gravação
    expect(logs.some((l) => l.includes('sintonia-sul'))).toBe(true);
    expect((await repo.buscarConversa(semNome.id))?.nome).toBe('Carla Dias');
    expect((await repo.buscarConversa(vazia.id))?.nome).toBe('Bruna');
    expect((await repo.buscarConversa(daEquipe.id))?.nome).toBe('Cliente VIP');
    expect((await repo.buscarConversa(lixo.id))?.nome).toBeFalsy();
    expect((await repo.buscarConversa(daLoja.id))?.nome).toBeFalsy(); // nome do próprio número da loja não serve

    // Segunda rodada: nada mais a fazer.
    const r2 = await rotina.rodar();
    expect(r2.atualizadas).toBe(0);
  });

  it('rotina: sem Evolution configurada não faz nada', async () => {
    const { repo, sintonia } = await montar();
    const rotina = new NomesWhatsapp({ empresaId: 'imperio', admin: () => undefined, canais: () => ['sintonia-norte'], semNome: (e, l) => repo.conversasSemNome(e, l), aplicar: (id, n) => sintonia.nomeDoWhatsapp(id, n) });
    expect(await rotina.rodar()).toEqual({ semNome: 0, achados: 0, atualizadas: 0, falhas: 0 });
  });
});

describe('Evolution: nomes dos contatos (findContacts) e LID', () => {
  it('lê pushName por número, inclusive de contatos "@lid" pelo número da conversa', async () => {
    const pedidos: string[] = [];
    const fetchFalso = (async (url: string) => {
      pedidos.push(String(url));
      const corpo = String(url).includes('/chat/findContacts/')
        ? [
            { remoteJid: '5571992200365@s.whatsapp.net', pushName: 'Juliana' },
            { remoteJid: '557188124471@s.whatsapp.net', pushName: 'Sem o nove' },
            { remoteJid: '99887766@lid', pushName: 'Pelo LID' },
            { remoteJid: '5571977776666@s.whatsapp.net', pushName: '...' },
            { remoteJid: '120363@g.us', pushName: 'Grupo' },
          ]
        : [
            { remoteJid: '99887766@lid', lastMessage: { key: { remoteJidAlt: '5571966665555@s.whatsapp.net' } } },
            { remoteJid: '5571977776666@s.whatsapp.net', pushName: 'Nome da conversa' },
          ];
      return new Response(JSON.stringify(corpo), { status: 200 });
    }) as typeof fetch;
    const adm = new EvolutionAdmin('http://evo', 'chave', fetchFalso);
    const nomes = await adm.nomesDeContatos('sintonia-norte');
    expect(pedidos[0]).toContain('/chat/findContacts/sintonia-norte');
    expect(Object.fromEntries(nomes)).toEqual({
      '5571992200365': 'Juliana',
      '5571988124471': 'Sem o nove',
      '5571966665555': 'Pelo LID',
      '5571977776666': 'Nome da conversa',
    });
  });

  it('webhook "@lid" com o número em remoteJidAlt traz o nome', () => {
    const [m] = lerWebhookEvolution({
      event: 'messages.upsert',
      instance: 'sintonia-norte',
      data: { key: { remoteJid: '99887766@lid', remoteJidAlt: '5571966665555@s.whatsapp.net', fromMe: false, id: 'X1' }, pushName: 'Pelo LID', message: { conversation: 'oi' }, messageTimestamp: 1763726400 },
    });
    expect(m).toMatchObject({ telefone: '5571966665555', nome: 'Pelo LID' });
  });
});

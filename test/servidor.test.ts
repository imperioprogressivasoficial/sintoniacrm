import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalEvolution } from '../src/channels/evolution.js';
import { FilaMemoria, type FilaEntrada } from '../src/fila/entrada.js';
import { Trabalhador } from '../src/fila/trabalhador.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

function montar(fila: FilaEntrada) {
  const enviados: string[] = [];
  const canal = new CanalEvolution('http://evolution.local', 'k', (async (_url: string | URL, init?: RequestInit) => {
    enviados.push(JSON.parse(String(init?.body)).text);
    return new Response(JSON.stringify({ key: { id: `out-${enviados.length}` } }));
  }) as typeof fetch);
  const repo = new RepositorioMemoria();
  // Madrugada: a IA responde sozinha.
  const agora = () => new Date('2026-11-05T05:00:00Z');
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: { executar: async () => ({ texto: 'Oi! Como posso ajudar?', acoes: [], recusou: false }) },
    agora,
  });
  const trabalhador = new Trabalhador({ fila, processar: (m) => sintonia.receber(m) });
  const app = criarServidor({ sintonia, repo, evolution: { canal, token: 'tok' }, fila: { fila, avisar: () => trabalhador.avisar() } });
  return { app, repo, trabalhador, enviados };
}

const webhook = (id: string, texto: string) => ({
  event: 'messages.upsert',
  instance: 'imperio-norte',
  data: { key: { remoteJid: '5571988124471@s.whatsapp.net', fromMe: false, id }, pushName: 'Marina', message: { conversation: texto } },
});

describe('Webhook com fila', () => {
  it('grava na fila e responde na hora; o trabalhador processa depois', async () => {
    const fila = new FilaMemoria();
    const { app, repo, trabalhador, enviados } = montar(fila);
    const r = await app.inject({ method: 'POST', url: '/webhooks/evolution', headers: { 'x-sintonia-token': 'tok' }, payload: webhook('A1', 'oi') });
    expect(r.json()).toEqual({ recebidas: 1 });
    expect(await repo.listarConversas()).toHaveLength(0); // ainda não processou
    expect((await app.inject({ url: '/saude' })).json().fila).toEqual({ pendentes: 1, processando: 0, falhas: 0 });

    await trabalhador.rodada();
    expect(await repo.listarConversas()).toHaveLength(1);
    expect(enviados).toEqual(['Oi! Como posso ajudar?']);

    // o mesmo webhook de novo não entra
    const r2 = await app.inject({ method: 'POST', url: '/webhooks/evolution', headers: { 'x-sintonia-token': 'tok' }, payload: webhook('A1', 'oi') });
    expect(r2.json()).toEqual({ recebidas: 0 });
  });

  it('se não conseguir gravar, devolve erro para o WhatsApp reenviar', async () => {
    const quebrada = new FilaMemoria();
    quebrada.enfileirar = async () => {
      throw new Error('banco fora');
    };
    const { app } = montar(quebrada);
    const r = await app.inject({ method: 'POST', url: '/webhooks/evolution', headers: { 'x-sintonia-token': 'tok' }, payload: webhook('B1', 'oi') });
    expect(r.statusCode).toBe(500);
  });
});

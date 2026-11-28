import { describe, expect, it } from 'vitest';
import { Fotos } from '../src/app/fotos.js';
import { CanalEvolution } from '../src/channels/evolution.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { Conversa } from '../src/domain.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

const conversa = { telefone: '5571988887777', canalId: 'loja-norte' } as Conversa;
const jpg = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);

function canalCom(resposta: () => Promise<{ conteudo: Buffer; tipo: string } | null>) {
  const c = { chamadas: 0 } as { chamadas: number } & CanalWhatsApp;
  Object.assign(c, { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: '' }), buscarFoto: async () => { c.chamadas++; return resposta(); } });
  return c;
}

describe('Fotos de perfil', () => {
  it('busca uma vez, guarda e renova depois de um dia', async () => {
    const relogio = { t: new Date('2026-11-07T12:00:00Z') };
    const canal = canalCom(async () => ({ conteudo: jpg, tipo: 'image/jpeg' }));
    const fotos = new Fotos(new RepositorioMemoria(), () => canal, () => relogio.t);
    expect((await fotos.da(conversa))?.conteudo).toEqual(jpg);
    await fotos.da(conversa);
    expect(canal.chamadas).toBe(1);
    relogio.t = new Date(relogio.t.getTime() + 25 * 3600_000);
    await fotos.da(conversa);
    expect(canal.chamadas).toBe(2);
  });

  it('cliente sem foto: devolve null e não pergunta de novo por 6 horas', async () => {
    const canal = canalCom(async () => null);
    const fotos = new Fotos(new RepositorioMemoria(), () => canal);
    expect(await fotos.da(conversa)).toBeNull();
    expect(await fotos.da(conversa)).toBeNull();
    expect(canal.chamadas).toBe(1);
  });

  it('se a Evolution falhar, mantém a foto antiga', async () => {
    const relogio = { t: new Date('2026-11-07T12:00:00Z') };
    let falhar = false;
    const canal = canalCom(async () => { if (falhar) throw new Error('fora do ar'); return { conteudo: jpg, tipo: 'image/jpeg' }; });
    const fotos = new Fotos(new RepositorioMemoria(), () => canal, () => relogio.t);
    await fotos.da(conversa);
    falhar = true; relogio.t = new Date(relogio.t.getTime() + 25 * 3600_000);
    expect((await fotos.da(conversa))?.conteudo).toEqual(jpg);
  });

  it('canal sem foto (teste ou API oficial): sem foto, sem erro', async () => {
    const fotos = new Fotos(new RepositorioMemoria(), () => undefined);
    expect(await fotos.da(conversa)).toBeNull();
  });
});

describe('Evolution: foto de perfil', () => {
  it('pede o link e baixa a imagem', async () => {
    const pedidos: string[] = [];
    const fetchFalso = (async (url: string, init?: RequestInit) => {
      pedidos.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('fetchProfilePictureUrl')) return new Response(JSON.stringify({ profilePictureUrl: 'https://pps.whatsapp.net/v/foto.jpg' }));
      return new Response(jpg, { headers: { 'content-type': 'image/jpeg' } });
    }) as typeof fetch;
    const foto = await new CanalEvolution('https://evo.exemplo/', 'chave', fetchFalso).buscarFoto('loja-norte', '5571988887777');
    expect(foto?.tipo).toBe('image/jpeg');
    expect(foto?.conteudo).toEqual(jpg);
    expect(pedidos).toEqual(['POST https://evo.exemplo/chat/fetchProfilePictureUrl/loja-norte', 'GET https://pps.whatsapp.net/v/foto.jpg']);
  });
  it('sem foto: null', async () => {
    const fetchFalso = (async () => new Response(JSON.stringify({ profilePictureUrl: null }))) as unknown as typeof fetch;
    expect(await new CanalEvolution('https://evo', 'k', fetchFalso).buscarFoto('i', '55')).toBeNull();
  });
});

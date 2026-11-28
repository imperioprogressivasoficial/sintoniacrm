import { describe, expect, it } from 'vitest';
import { origemPeloTexto } from '../src/rastreio/pelo-texto.js';

describe('origem pelo que a cliente escreve', () => {
  it.each([
    ['Olá! Tenho interesse e queria mais informações, por favor.', 'anuncio_meta', 'meta'],
    ['vi o anúncio de vocês no instagram', 'anuncio_meta', 'instagram'],
    ['Olá! Validei meu número e gostaria de fazer meu agendamento', 'anuncio_meta', 'meta'],
    ['Oi, vi vocês no Instagram', 'organico', 'instagram'],
    ['vim pelo insta', 'organico', 'instagram'],
    ['achei vocês no google', 'organico', 'google'],
    ['passei na loja ontem e queria saber o preço', 'outro', 'loja'],
    ['vi no tiktok', 'organico', 'tiktok'],
    ['Olá, vim pelo anúncio', 'anuncio_meta', 'meta'],
    ['Olá, vim pelo Google', 'organico', 'google'],
    ['Olá, vim pelo site', 'organico', 'site'],
    ['Olá, vim pela bio do Instagram', 'organico', 'instagram'],
    ['Olá, vim pelo direct do Instagram', 'organico', 'instagram'],
    ['Olá, validei', 'anuncio_meta', 'meta'],
    ['Olá, vim pelo anúncio do Instagram', 'anuncio_meta', 'instagram'],
  ])('%s', (texto, canal, fonte) => {
    const o = origemPeloTexto(texto);
    expect(o?.canal).toBe(canal);
    expect(o?.fonte).toBe(fonte);
  });

  it('indicação com o nome de quem indicou', () => {
    expect(origemPeloTexto('Oi! A Ana que me indicou vocês')).toMatchObject({ canal: 'indicacao', indicadoPor: 'Ana' });
    expect(origemPeloTexto('fui indicada pela Carla')).toMatchObject({ canal: 'indicacao', indicadoPor: 'Carla' });
    expect(origemPeloTexto('minha amiga fez aí e amou')?.canal).toBe('indicacao');
  });

  it('bio e direct do Instagram ficam separados', () => {
    expect(origemPeloTexto('Olá, vim pela bio do Instagram')?.detalhe).toBe('Bio do Instagram');
    expect(origemPeloTexto('Olá, vim pelo direct do Instagram')?.detalhe).toBe('Direct do Instagram');
  });

  it('mensagem comum não vira origem', () => {
    for (const t of ['Oi, quanto custa a progressiva?', 'Tem horário amanhã?', 'ok', 'Bom dia!']) expect(origemPeloTexto(t)).toBeUndefined();
  });
});

import { ArmazemRastreioMemoria } from '../src/rastreio/armazem.js';
import { Rastreio } from '../src/rastreio/rastreio.js';

describe('conversas que já existiam', () => {
  it('ganham a origem pelas primeiras mensagens da cliente, sem trocar a que já tinha', async () => {
    const armazem = new ArmazemRastreioMemoria();
    const r = new Rastreio({ armazem, empresaId: 'e1' });
    await armazem.gravarOrigem('c2', 'primeiro', { canal: 'link', origemPor: 'automatico', em: new Date() }, 'substituir');
    const msgs: Record<string, Array<{ texto: string; autor: string; em: Date }>> = {
      c1: [{ texto: 'Oi', autor: 'cliente', em: new Date(1) }, { texto: 'a Ana me indicou', autor: 'cliente', em: new Date(2) }],
      c2: [{ texto: 'vi no instagram', autor: 'cliente', em: new Date(1) }],
      c3: [{ texto: 'quanto custa?', autor: 'cliente', em: new Date(1) }],
    };
    const repo = {
      listarConversas: async () => ['c1', 'c2', 'c3'].map((id) => ({ id }) as never),
      mensagens: async (id: string) => msgs[id] ?? [],
    };
    expect(await r.detectarSemOrigem(repo)).toBe(1);
    const p = await armazem.primeiros(['c1', 'c2', 'c3']);
    expect(p.get('c1')).toMatchObject({ canal: 'indicacao', indicadoPor: 'Ana', origemPor: 'ia' });
    expect(p.get('c2')?.canal).toBe('link');
    expect(p.has('c3')).toBe(false);
    expect(await r.detectarSemOrigem(repo)).toBe(0);
  });
});

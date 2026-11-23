import { describe, expect, it } from 'vitest';
import { origemPeloTexto } from '../src/rastreio/pelo-texto.js';

describe('origem pelo que a cliente escreve', () => {
  it.each([
    ['Olá! Tenho interesse e queria mais informações, por favor.', 'anuncio_meta', 'meta'],
    ['vi o anúncio de vocês no instagram', 'anuncio_meta', 'instagram'],
    ['Oi, vi vocês no Instagram', 'organico', 'instagram'],
    ['vim pelo insta', 'organico', 'instagram'],
    ['achei vocês no google', 'organico', 'google'],
    ['passei na loja ontem e queria saber o preço', 'outro', 'loja'],
    ['vi no tiktok', 'organico', 'tiktok'],
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

  it('mensagem comum não vira origem', () => {
    for (const t of ['Oi, quanto custa a progressiva?', 'Tem horário amanhã?', 'ok', 'Bom dia!']) expect(origemPeloTexto(t)).toBeUndefined();
  });
});

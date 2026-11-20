import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerConfig } from '../src/config.js';

describe('chave da Evolution lida de arquivo', () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'sintonia-chave-'));
  const arquivo = path.join(pasta, 'evolution.key');
  writeFileSync(arquivo, 'chave-do-volume\n');

  it('usa o arquivo quando a variável não vem', () => {
    expect(lerConfig({ EVOLUTION_API_KEY_ARQUIVO: arquivo }).EVOLUTION_API_KEY).toBe('chave-do-volume');
  });

  it('a variável vale por cima do arquivo', () => {
    expect(lerConfig({ EVOLUTION_API_KEY: 'da-variavel', EVOLUTION_API_KEY_ARQUIVO: arquivo }).EVOLUTION_API_KEY).toBe('da-variavel');
  });

  it('arquivo que não existe não derruba o servidor', () => {
    expect(lerConfig({ EVOLUTION_API_KEY_ARQUIVO: path.join(pasta, 'nao-existe') }).EVOLUTION_API_KEY).toBeUndefined();
  });
});

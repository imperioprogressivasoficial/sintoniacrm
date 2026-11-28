/**
 * Quem é a empresa, para os textos que o sistema escreve sozinho (IA de atendimento, copiloto, Serena,
 * assistente, e-mails, modelos de bot): nome, segmento, cidade e o "sobre" de Empresa › Dados.
 *
 * Cache em memória, como o das unidades (src/unidades.ts): o cadastro (src/empresa/cadastro-rotas.ts)
 * chama `definirIdentidade` ao carregar e a cada mudança. Nada aqui é fixo de uma empresa: a Império
 * aparece como "Império Progressivas, salões de alisamento e progressiva em Salvador" porque é isso que
 * está no cadastro dela (migração 530); antes de o cadastro carregar (testes em memória) vale o padrão abaixo.
 */

import { definirEmpresaPadrao, EMPRESA_IMPERIO, empresaPadraoDasUnidades } from '../unidades.js';

export interface Identidade {
  nome: string;
  /** Ramo/segmento, como a empresa escreveu (ex.: "Salões de alisamento e progressiva"). */
  segmento: string;
  cidade: string;
  uf: string;
  /** Texto livre de Empresa › Dados ("Sobre a empresa"). */
  sobre: string;
}

/** O que a Império tinha fixo no código antes do cadastro (vale só para a empresa "imperio" até o cadastro carregar). */
export const IDENTIDADE_IMPERIO: Identidade = {
  nome: 'Império Progressivas',
  segmento: 'Salões de alisamento e progressiva',
  cidade: 'Salvador',
  uf: 'BA',
  sobre: '',
};

const cache = new Map<string, Identidade>();

/** A empresa padrão é a mesma das unidades (src/unidades.ts: definirEmpresaPadrao). */
export function definirEmpresaPadraoIdentidade(id: string): void {
  definirEmpresaPadrao(id);
}

export function definirIdentidade(empresaId: string, i: Partial<Identidade> & { nome: string }): void {
  const limpo = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
  cache.set(empresaId, {
    nome: limpo(i.nome, 120) || empresaId,
    segmento: limpo(i.segmento, 80),
    cidade: limpo(i.cidade, 80),
    uf: limpo(i.uf, 2).toUpperCase(),
    sobre: limpo(i.sobre, 1000),
  });
}

export function reiniciarIdentidades(): void {
  cache.clear();
}

/** A identidade da empresa (a padrão do servidor quando não se diz qual). */
export function identidade(empresaId?: string): Identidade {
  const padrao = empresaPadraoDasUnidades();
  const i = (empresaId !== undefined ? cache.get(empresaId) : undefined) ?? cache.get(padrao);
  if (i) return i;
  if (padrao === EMPRESA_IMPERIO) return IDENTIDADE_IMPERIO;
  return { nome: 'a empresa', segmento: '', cidade: '', uf: '', sobre: '' };
}

/** "salões de alisamento e progressiva em Salvador" (vazio quando o cadastro não diz nada). */
export function descricaoCurta(i: Identidade = identidade()): string {
  const seg = i.segmento ? i.segmento.charAt(0).toLowerCase() + i.segmento.slice(1) : '';
  if (seg && i.cidade) return `${seg} em ${i.cidade}`;
  if (seg) return seg;
  return i.cidade ? `em ${i.cidade}` : '';
}

/** "Império Progressivas (salões de alisamento e progressiva em Salvador)". */
export function apresentacao(i: Identidade = identidade()): string {
  const d = descricaoCurta(i);
  return d ? `${i.nome} (${d})` : i.nome;
}

const ESTADOS: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco',
  PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** "Império Progressivas · Salvador, Bahia" (rodapé de e-mail). */
export function assinatura(i: Identidade = identidade()): string {
  const lugar = [i.cidade, ESTADOS[i.uf] ?? i.uf].filter(Boolean).join(', ');
  return lugar ? `${i.nome} · ${lugar}` : i.nome;
}

/** Bloco para os prompts: quem é a empresa e o que ela contou de si (só o que está preenchido). */
export function blocoEmpresa(i: Identidade = identidade()): string {
  const linhas = [`Empresa: ${i.nome}.`];
  if (i.segmento) linhas.push(`Segmento: ${i.segmento}.`);
  if (i.cidade) linhas.push(`Cidade: ${[i.cidade, i.uf].filter(Boolean).join(' - ')}.`);
  if (i.sobre) linhas.push(`Sobre a empresa (escrito por ela): ${i.sobre}`);
  return linhas.join('\n');
}

import type { EscopoVisao } from '../auth/acesso.js';

/**
 * Filtro SQL equivalente a noEscopo/podeVer, sobre a tabela de conversas com o apelido `c`.
 * Acrescenta os valores em `params` e devolve a condição (nunca vazia: "true" quando vê tudo).
 */
export function sqlEscopo(e: EscopoVisao, apelido: string, params: unknown[]): string {
  const partes: string[] = [];
  if (e.empresaId) {
    params.push(e.empresaId);
    partes.push(`${apelido}.empresa_id = $${params.length}`);
  }
  if (e.unidades) {
    params.push(e.unidades);
    partes.push(`${apelido}.unidade = any($${params.length}::text[])`);
  }
  if (e.donaOuSemDona) {
    params.push(e.donaOuSemDona);
    partes.push(`(${apelido}.responsavel_id is null or ${apelido}.responsavel_id::text = $${params.length})`);
  }
  return partes.length ? partes.join(' and ') : 'true';
}

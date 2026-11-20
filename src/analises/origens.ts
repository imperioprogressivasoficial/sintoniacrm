import { ehCanalTeste } from '../channels/teste.js';
import type { ArmazemContatos } from '../contatos/contatos.js';
import type { ArmazemLeads } from '../leads/armazem.js';
import type { Repositorio } from '../store/repositorio.js';

/**
 * De onde veio cada conversa, para "Campanhas e origens que viraram venda".
 * Ordem: anúncio/link rastreado/indicação (rastreio) › campo "Origem"/"Como conheceu" da ficha › outro selo do
 * rastreio › Importação / Simulador / WhatsApp. Os mesmos nomes que a gestão já vê no Relatório geral.
 */
export interface SeloOrigem {
  canal: string;
  rotulo: string;
}
export interface DepOrigens {
  repo: Repositorio;
  contatos?: ArmazemContatos;
  leads?: ArmazemLeads;
  selos?: (ids: string[]) => Promise<Record<string, SeloOrigem>>;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RASTREADOS = new Set(['anuncio_meta', 'link', 'indicacao']);

export class OrigensConversa {
  constructor(private readonly d: DepOrigens) {}

  async de(empresaId: string, ids: string[], importadas: Set<string> = new Set()): Promise<Map<string, string>> {
    const r = new Map<string, string>();
    if (!ids.length) return r;
    const unicos = [...new Set(ids)];
    const quer = new Set(unicos);
    const conversas = (await this.d.repo.listarConversas()).filter((c) => quer.has(c.id) && c.empresaId === empresaId);
    const selos = this.d.selos ? await this.d.selos(unicos).catch(() => ({}) as Record<string, SeloOrigem>) : {};
    const campos = this.d.contatos ? await this.d.contatos.campos(empresaId).catch(() => []) : [];
    const campo = campos.find((c) => /^origem/.test(semAcento(c.nome)) || /como (nos )?conheceu/.test(semAcento(c.nome)));
    const fichas = campo && this.d.leads ? new Map((await this.d.leads.contatos(empresaId).catch(() => [])).map((x) => [x.telefone, x])) : new Map();
    for (const c of conversas) {
      const selo = selos[c.id];
      const v = campo ? fichas.get(c.telefone)?.campos?.[campo.id] : undefined;
      const daFicha = v === null || v === undefined || String(v).trim() === '' ? undefined : String(v).trim();
      const origem =
        (selo && RASTREADOS.has(selo.canal) ? selo.rotulo : undefined) ??
        daFicha ??
        selo?.rotulo ??
        (importadas.has(c.id) ? 'Importação' : ehCanalTeste(c.canalId) ? 'Simulador' : 'WhatsApp');
      r.set(c.id, origem.slice(0, 80));
    }
    return r;
  }
}

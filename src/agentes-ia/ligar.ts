import type { Conversa, Etapa } from '../domain.js';
import type { Funis } from '../funis/funis.js';
import type { Repositorio } from '../store/repositorio.js';
import type { ArmazemTags, Tags } from '../tags/tags.js';

/** Adaptadores das ações já existentes (tags, funil do sistema) para os comandos e o estúdio. */

export function tagsParaAgentes(tags: Tags, repo: Pick<Repositorio, 'buscarConversa' | 'registrarEvento'>, agora: () => Date = () => new Date()) {
  return {
    nomes: async () => (await tags.soltas()).map((t) => t.nome),
    daConversa: async (id: string) => (await tags.daConversa(id)).filter((t) => !('funilId' in t) || !(t as { funilId?: string | null }).funilId).map((t) => t.nome),
    marcar: async (conversaId: string, nome: string, por: string) => {
      const tag = await tags.porNome(nome);
      const c = await repo.buscarConversa(conversaId);
      if (!tag || !c) return false;
      const r = await tags.marcar(c, tag.id, por);
      if (r.mudou) await repo.registrarEvento({ tipo: 'tag_marcada', conversaId: c.id, unidade: c.unidade, em: agora(), dados: { tagId: tag.id, nome: tag.nome, por, porId: null } });
      return r.mudou;
    },
  };
}

/** Move a etapa fixa da conversa: pelo funil do sistema (quando existe) ou direto na conversa. */
export function moverEtapaPara(o: {
  funis?: Funis;
  armazemTags?: ArmazemTags;
  empresaId: string;
  repo: Pick<Repositorio, 'registrarEvento' | 'salvarConversa'>;
  comConversa: <T>(id: string, fn: (c: Conversa) => Promise<T>) => Promise<T | undefined>;
  agora?: () => Date;
}) {
  return async (conversaId: string, etapa: Etapa, por: string): Promise<boolean> => {
    if (o.funis && o.armazemTags) {
      const f = await o.funis.garantirSistema();
      const tag = (await o.armazemTags.listar(o.empresaId)).find((t) => t.funilId === f.id && t.chaveSistema === etapa);
      if (tag) return (await o.funis.mover(conversaId, f.id, tag.id, { nome: por })).mudou;
    }
    const r = await o.comConversa(conversaId, async (c) => {
      if (c.etapa === etapa) return false;
      const de = c.etapa;
      c.etapa = etapa;
      c.atualizadaEm = o.agora?.() ?? new Date();
      await o.repo.salvarConversa(c);
      await o.repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c.id, unidade: c.unidade, em: c.atualizadaEm, dados: { de, para: etapa, motivo: 'comando_ia', por } });
      return true;
    });
    return Boolean(r);
  };
}

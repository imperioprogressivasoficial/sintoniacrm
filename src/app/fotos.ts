import type { Conversa } from '../domain.js';
import type { CanalWhatsApp, FotoPerfil } from '../channels/tipos.js';
import type { Repositorio } from '../store/repositorio.js';

const DIA = 24 * 3600_000;

/**
 * Fotos de perfil das clientes. A foto fica guardada no banco e é renovada uma vez por dia
 * (os links do WhatsApp expiram). Sem foto, ou canal sem suporte (API oficial), a tela mostra o boneco padrão.
 */
export class Fotos {
  private readonly buscando = new Map<string, Promise<FotoPerfil | null>>();

  constructor(
    private readonly repo: Repositorio,
    private readonly canalDe: (canalId: string) => CanalWhatsApp | undefined,
    private readonly agora: () => Date = () => new Date(),
    private readonly log: (msg: string, extra?: unknown) => void = () => {},
  ) {}

  async da(c: Conversa): Promise<FotoPerfil | null> {
    const guardada = await this.repo.foto(c.telefone);
    const fresca = guardada && this.agora().getTime() - guardada.atualizadaEm.getTime() < (guardada.conteudo ? DIA : 6 * 3600_000);
    if (fresca) return guardada.conteudo ? { conteudo: guardada.conteudo, tipo: guardada.tipo ?? 'image/jpeg' } : null;

    const canal = this.canalDe(c.canalId);
    if (!canal?.buscarFoto) return guardada?.conteudo ? { conteudo: guardada.conteudo, tipo: guardada.tipo ?? 'image/jpeg' } : null;

    // Várias telas pedindo a mesma foto ao mesmo tempo: uma busca só.
    let busca = this.buscando.get(c.telefone);
    if (!busca) {
      busca = (async () => {
        try {
          const foto = await canal.buscarFoto!(c.canalId, c.telefone);
          await this.repo.salvarFoto(c.telefone, foto, this.agora());
          return foto;
        } catch (e) {
          this.log('Foto de perfil indisponível', String(e));
          // Falhou agora: usa a antiga, se houver, e tenta de novo mais tarde.
          return guardada?.conteudo ? { conteudo: guardada.conteudo, tipo: guardada.tipo ?? 'image/jpeg' } : null;
        } finally {
          this.buscando.delete(c.telefone);
        }
      })();
      this.buscando.set(c.telefone, busca);
    }
    return busca;
  }
}

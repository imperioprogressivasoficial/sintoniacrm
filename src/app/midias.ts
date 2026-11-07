import type { CanalWhatsApp } from '../channels/tipos.js';
import type { MidiaPendente, Repositorio } from '../store/repositorio.js';
import { ErroMidiaGrande, LIMITE_MIDIA } from '../midia.js';

/** Esperas entre as tentativas de download: 15 s, 1 min, 5 min, 30 min, 2 h. Depois disso, "falhou". */
export const ESPERAS_MIDIA_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
export const MAX_TENTATIVAS_MIDIA = ESPERAS_MIDIA_MS.length + 1;

/**
 * Baixa as mídias recebidas (foto, áudio, vídeo, documento, figurinha) e guarda no banco.
 *
 * A mensagem já foi gravada (e a IA já pode responder) antes daqui: o download nunca atrasa
 * nem derruba o texto. Falhou? Fica pendente com nova tentativa; o relógio chama `rodada()`
 * e `avisar()` adianta quando chega mídia nova.
 */
export class Midias {
  private rodando: Promise<number> | null = null;
  private deNovo = false;

  constructor(
    private readonly repo: Repositorio,
    private readonly canalDe: (canalId: string) => CanalWhatsApp | undefined,
    private readonly agora: () => Date = () => new Date(),
    private readonly log: (msg: string, extra?: unknown) => void = () => {},
  ) {}

  /** Baixa o que estiver pendente e vencido. Retorna quantas tentou. */
  async rodada(limite = 5): Promise<number> {
    const itens = await this.repo.reivindicarMidias(this.agora(), limite);
    await Promise.all(itens.map((i) => this.baixar(i)));
    return itens.length;
  }

  /** Chegou mídia nova: baixa já, sem esperar o relógio (uma rodada por vez neste processo). */
  avisar(): void {
    if (this.rodando) {
      this.deNovo = true;
      return;
    }
    this.rodando = (async () => {
      let total = 0;
      do {
        this.deNovo = false;
        try {
          total += await this.rodada();
        } catch (e) {
          this.log('Falha ao ler mídias pendentes', String(e));
        }
      } while (this.deNovo);
      return total;
    })().finally(() => {
      this.rodando = null;
    });
  }

  /** Para os testes: espera a rodada em andamento terminar. */
  async ocioso(): Promise<void> {
    while (this.rodando) await this.rodando;
  }

  private async baixar(i: MidiaPendente): Promise<void> {
    const canal = this.canalDe(i.canalId);
    if (!canal?.baixarMidia) {
      await this.repo.falhaMidia(i.mensagemId, 'Este número não permite baixar arquivos');
      return;
    }
    try {
      const r = await canal.baixarMidia(i.canalId, i.idExterno);
      if (r.conteudo.length > LIMITE_MIDIA) await this.repo.midiaGrande(i.mensagemId, r.conteudo.length);
      else await this.repo.guardarMidia(i.mensagemId, r);
    } catch (e) {
      if (e instanceof ErroMidiaGrande) {
        await this.repo.midiaGrande(i.mensagemId, e.tamanho);
        return;
      }
      const erro = e instanceof Error ? e.message : String(e);
      const espera = ESPERAS_MIDIA_MS[i.tentativas - 1];
      this.log('Falha ao baixar mídia', { mensagem: i.mensagemId, tentativa: i.tentativas, erro });
      await this.repo.falhaMidia(i.mensagemId, erro, espera === undefined ? undefined : new Date(this.agora().getTime() + espera));
    }
  }
}

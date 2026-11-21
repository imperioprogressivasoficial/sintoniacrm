import type { Conversa, Mensagem } from '../domain.js';
import type { Percepcao } from '../ai/prompt.js';
import type { Repositorio } from '../store/repositorio.js';
import type { ArmazemTranscricoes, Transcritor } from '../conversa/transcricao.js';

/**
 * ia-completa: o que a IA "ouve e vê" antes de responder.
 * - Áudio da cliente: usa a transcrição já guardada; se não tem e o Whisper está configurado, transcreve agora
 *   (uma vez: fica guardada, e a equipe também vê na conversa).
 * - Foto da cliente: vai como imagem para a IA (os modelos Claude enxergam), só as que ainda não foram respondidas,
 *   no máximo 4 e até 3,5 MB cada.
 * - Mídia ainda baixando, que acabou de chegar: `esperar` = true (a Sintonia espera uns segundos antes de responder,
 *   para não responder "não consigo ouvir" a um áudio que chega em 2 s).
 * Falha aqui nunca impede a resposta: a mídia fica só com o marcador, como antes.
 */

export interface OpcoesPercepcao {
  repo: Pick<Repositorio, 'midia'>;
  transcricoes?: ArmazemTranscricoes;
  transcritor?: Transcritor;
  /** O Whisper está configurado agora? (chave lida na hora). */
  transcricaoLigada?: () => boolean;
  /** Mandar fotos para a IA (padrão: sim). */
  verFotos?: boolean;
  /** Quanto tempo esperar uma mídia recém-chegada terminar de baixar (padrão 40 s). */
  esperaMidiaMs?: number;
  log?: (msg: string, extra?: unknown) => void;
}

export const LIMITE_FOTO_IA = 3_500_000;
const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Mensagens da cliente que ainda não têm resposta da loja. */
function semResposta(ms: Mensagem[]): Mensagem[] {
  const l = ms.filter((m) => m.autor !== 'sistema');
  const r: Mensagem[] = [];
  for (let i = l.length - 1; i >= 0 && l[i]!.autor === 'cliente'; i--) r.unshift(l[i]!);
  return r;
}

export class PercepcaoIa {
  constructor(private readonly o: OpcoesPercepcao) {}

  async preparar(c: Conversa, mensagens: Mensagem[], agora: Date): Promise<{ percepcao: Percepcao; esperar: boolean }> {
    const percepcao: Percepcao = new Map();
    let esperar = false;
    const espera = this.o.esperaMidiaMs ?? 40_000;
    // Transcrições já guardadas (a conversa toda: a IA "lembra" dos áudios anteriores).
    if (this.o.transcricoes && mensagens.some((m) => m.anexo?.tipo === 'audio' || m.anexo?.tipo === 'video')) {
      for (const t of await this.o.transcricoes.daConversa(c.id).catch(() => [])) percepcao.set(t.mensagemId, { transcricao: t.texto });
    }
    const novas = semResposta(mensagens).filter((m) => m.anexo).slice(-6);
    for (const m of novas) {
      const a = m.anexo!;
      if (a.situacao === 'pendente') {
        if (agora.getTime() - m.em.getTime() < espera && (a.tipo === 'audio' || a.tipo === 'imagem')) esperar = true;
        continue;
      }
      if (a.situacao !== 'pronta') continue;
      try {
        if (a.tipo === 'audio' && !percepcao.get(m.id)?.transcricao && this.o.transcritor && this.o.transcricoes && (this.o.transcricaoLigada?.() ?? true)) {
          const md = await this.o.repo.midia(m.id);
          if (md?.conteudo) {
            const texto = (await this.o.transcritor.transcrever(md.conteudo, md.anexo.mimetype ?? a.mimetype ?? 'audio/ogg')).trim();
            if (texto) {
              await this.o.transcricoes.guardar(c.id, { mensagemId: m.id, texto, modelo: this.o.transcritor.modelo, criadaPor: 'IA' }).catch(() => undefined);
              percepcao.set(m.id, { transcricao: texto });
            }
          }
        } else if (a.tipo === 'imagem' && this.o.verFotos !== false) {
          const md = await this.o.repo.midia(m.id);
          const tipo = (md?.anexo.mimetype ?? a.mimetype ?? '').split(';')[0]!.trim().toLowerCase();
          if (md?.conteudo && TIPOS_FOTO.has(tipo) && md.conteudo.length <= LIMITE_FOTO_IA) {
            percepcao.set(m.id, { ...percepcao.get(m.id), imagem: { base64: md.conteudo.toString('base64'), mimetype: tipo } });
          }
        }
      } catch (e) {
        this.o.log?.('IA: não deu para ouvir/ver a mídia da cliente', String(e));
      }
    }
    return { percepcao, esperar };
  }
}

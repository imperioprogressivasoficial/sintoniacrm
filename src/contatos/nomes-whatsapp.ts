import type { EvolutionAdmin } from '../channels/evolution-admin.js';
import { limparNome, nomeDoWhatsapp } from './nome.js';

/**
 * contato-nome: preenche o nome das conversas antigas que estão só com o número (pedido do dono 21/11).
 * Para cada número conectado, pergunta à Evolution o nome do perfil de cada contato (findContacts) e, nas conversas
 * sem nome de verdade, grava esse nome. Nome de verdade (pode ter sido digitado pela equipe) nunca é trocado.
 *
 * Roda ao subir (alguns segundos depois, sem segurar a subida), a cada 6 horas e no fim do "Sincronizar WhatsApp".
 * Cuidado com a carga: uma rodada por vez, uma chamada por número (com tempo limite), gravação em lotes com pausa.
 * Se a Evolution falhar, só registra no log e segue.
 */
export interface OpcoesNomesWhatsapp {
  empresaId: string;
  admin: () => Pick<EvolutionAdmin, 'nomesDeContatos' | 'info'> | undefined;
  /** Nomes das instâncias da Evolution conectadas. */
  canais: () => string[];
  /** Conversas sem nome de verdade (vazio, número, símbolos). */
  semNome: (empresaId: string, limite: number) => Promise<Array<{ id: string; telefone: string; nome?: string }>>;
  /** Grava o nome se a conversa ainda estiver sem nome de verdade (sob a trava da conversa). True = gravou. */
  aplicar: (conversaId: string, nome: string) => Promise<boolean>;
  log?: (msg: string, extra?: string) => void;
  /** Quantas conversas olhar por rodada (as mais recentes primeiro). */
  limite?: number;
  /** Quantas gravações por lote, e a pausa entre lotes. */
  lote?: number;
  pausaMs?: number;
  /** Tempo limite de cada chamada à Evolution. */
  timeoutMs?: number;
  esperar?: (ms: number) => Promise<void>;
}

export interface ResultadoNomes {
  semNome: number;
  achados: number;
  atualizadas: number;
  falhas: number;
}

export const SEIS_HORAS = 6 * 60 * 60 * 1000;

export class NomesWhatsapp {
  private rodando: Promise<ResultadoNomes> | null = null;
  private inicio?: ReturnType<typeof setTimeout>;
  private relogio?: ReturnType<typeof setInterval>;

  constructor(private readonly o: OpcoesNomesWhatsapp) {}

  /** Uma rodada. Se já há uma em andamento, devolve a mesma (nunca duas ao mesmo tempo). */
  rodar(): Promise<ResultadoNomes> {
    if (!this.rodando) this.rodando = this.rodada().finally(() => { this.rodando = null; });
    return this.rodando;
  }

  /** Começa sozinho: `aposMs` depois de subir e a cada `cadaMs`. */
  iniciar(aposMs = 15_000, cadaMs = SEIS_HORAS): void {
    const vai = () => void this.rodar().catch((e) => this.o.log?.('Nomes do WhatsApp: falha na rodada', String(e)));
    this.inicio = setTimeout(vai, aposMs);
    this.inicio.unref?.();
    this.relogio = setInterval(vai, cadaMs);
    this.relogio.unref?.();
  }

  parar(): void {
    if (this.inicio) clearTimeout(this.inicio);
    if (this.relogio) clearInterval(this.relogio);
  }

  /** Espera a rodada em andamento terminar (desligamento). */
  async ocioso(): Promise<void> {
    await this.rodando?.catch(() => undefined);
  }

  private async rodada(): Promise<ResultadoNomes> {
    const r: ResultadoNomes = { semNome: 0, achados: 0, atualizadas: 0, falhas: 0 };
    const adm = this.o.admin();
    const canais = this.o.canais();
    if (!adm || !canais.length) return r;
    const pendentes = await this.o.semNome(this.o.empresaId, this.o.limite ?? 5000);
    r.semNome = pendentes.length;
    if (!pendentes.length) return r;

    // telefone → nome do perfil, juntando os números conectados (o perfil é da pessoa, igual em qualquer número).
    const nomes = new Map<string, string>();
    for (const canal of canais) {
      try {
        // O nome do próprio número da loja às vezes aparece como "nome do contato" (mensagens enviadas pelo celular): ignora.
        const perfil = limparNome((await adm.info(canal).catch(() => null))?.perfil ?? '').toLowerCase();
        const lista = await adm.nomesDeContatos(canal, this.o.timeoutMs ?? 60_000);
        for (const [tel, bruto] of lista) {
          const n = nomeDoWhatsapp(bruto);
          if (!n || (perfil && n.toLowerCase() === perfil) || nomes.has(tel)) continue;
          nomes.set(tel, n);
        }
      } catch (e) {
        r.falhas++;
        this.o.log?.(`Nomes do WhatsApp: não deu para ler os contatos de ${canal}`, String(e));
      }
    }
    if (!nomes.size) return r;

    const lote = Math.max(1, this.o.lote ?? 50);
    const esperar = this.o.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
    let nesteLote = 0;
    for (const c of pendentes) {
      const nome = nomes.get(c.telefone);
      if (!nome) continue;
      r.achados++;
      try {
        if (await this.o.aplicar(c.id, nome)) r.atualizadas++;
      } catch (e) {
        r.falhas++;
        this.o.log?.('Nomes do WhatsApp: falha ao gravar um nome', String(e));
      }
      if (++nesteLote >= lote) {
        nesteLote = 0;
        await esperar(this.o.pausaMs ?? 200);
      }
    }
    if (r.atualizadas) this.o.log?.(`Nomes do WhatsApp: ${r.atualizadas} conversa(s) ganharam o nome do contato`);
    return r;
  }
}

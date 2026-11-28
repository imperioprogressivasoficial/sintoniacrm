import { z } from 'zod';
import { chaveDestino, numeroDestino, RELATORIOS, type ArmazemEnvioRelatorio, type Destinatario } from './envio.js';
import type { RelatorioDia } from './servico.js';

/**
 * relatorio-equipe (dono 27/11): quem recebe os relatórios automáticos pelo WhatsApp, vindo do ambiente na hora de
 * publicar (SINTONIA_RELATORIO_INICIAL), sem números pessoais no repositório. Ao subir:
 * - acrescenta os números que ainda não estão em Análises › Dia a dia › Envio automático (nunca tira ninguém) e liga o envio;
 * - `agora` manda um relatório na hora, uma vez só por id (reiniciar não manda de novo).
 * Exemplo: {"destinatarios":[{"nome":"Ana","numero":"71999998888"}],"relatorios":["agenda","fechamento"],"agora":{"id":"2026-11-27","relatorio":"fechamento"}}
 */
export const SementeRelatorio = z.object({
  /** Pelo número, ou pelo e-mail da pessoa da equipe (o WhatsApp vem de Minha conta › Perfil dela). */
  destinatarios: z
    .array(z.object({ nome: z.string().trim().max(80).default(''), numero: z.string().trim().min(8).max(30).optional(), email: z.string().trim().toLowerCase().email().max(200).optional() }).refine((d) => d.numero || d.email, 'numero ou email'))
    .max(30),
  relatorios: z.array(z.enum(RELATORIOS)).min(1).default(['agenda', 'fechamento']),
  agora: z.object({ id: z.string().trim().min(1).max(40), relatorio: z.enum(RELATORIOS) }).optional(),
});

export async function semearRelatorio(o: {
  armazem: ArmazemEnvioRelatorio;
  servico: Pick<RelatorioDia, 'enviarAgora'>;
  empresaId: string;
  bruto: string | undefined;
  /** Pessoa da equipe pelo e-mail: nome, id e o WhatsApp do perfil dela. */
  pessoa?: (email: string) => Promise<{ id: string; nome: string; telefone: string } | undefined>;
  log?: (msg: string, extra?: unknown) => void;
  /** Rodadas de repetição: só registra quando acontece algo. */
  silencioso?: boolean;
}): Promise<{ acrescentados: number; enviadosAgora: number }> {
  const log = o.log ?? (() => undefined);
  const texto = (o.bruto ?? '').trim();
  if (!texto) return { acrescentados: 0, enviadosAgora: 0 };
  let s: z.infer<typeof SementeRelatorio>;
  try {
    s = SementeRelatorio.parse(JSON.parse(texto));
  } catch (e) {
    log('SINTONIA_RELATORIO_INICIAL ignorada: formato inválido', String(e).slice(0, 300));
    return { acrescentados: 0, enviadosAgora: 0 };
  }
  const { cfg } = await o.armazem.lerConfig(o.empresaId);
  const destinos: Array<Pick<Destinatario, 'tipo' | 'destino' | 'nome'>> = [];
  let acrescentados = 0;
  for (const d of s.destinatarios) {
    let numero: string;
    let usuarioId: string | null = null;
    try {
      let bruto = d.numero ?? '';
      if (!bruto && d.email) {
        const p = await o.pessoa?.(d.email);
        if (!p) throw new Error('pessoa não encontrada na equipe');
        if (!p.telefone) throw new Error(`${p.nome.split(/\s+/)[0]} não tem WhatsApp em Minha conta › Perfil`);
        bruto = p.telefone;
        usuarioId = p.id;
        if (!d.nome) d.nome = p.nome;
      }
      numero = numeroDestino(bruto);
    } catch (e) {
      if (!o.silencioso) log(`SINTONIA_RELATORIO_INICIAL: ${d.nome || 'destinatário'} ignorado (${(e as Error).message})`);
      continue;
    }
    const alvo = { tipo: 'numero' as const, destino: numero, nome: d.nome };
    destinos.push(alvo);
    const ja = cfg.destinatarios.find((x) => chaveDestino(x) === chaveDestino(alvo));
    if (ja) {
      ja.relatorios = [...new Set([...ja.relatorios, ...s.relatorios])];
      continue;
    }
    cfg.destinatarios.push({ id: crypto.randomUUID(), ...alvo, usuarioId, relatorios: [...s.relatorios] });
    acrescentados++;
  }
  if (destinos.length) {
    cfg.ligado = true;
    await o.armazem.salvarConfig(o.empresaId, cfg, 'Sistema (publicação)');
  }
  let enviadosAgora = 0;
  // "agora" com id em forma de data (AAAA-MM-DD) só vale nesse dia (a semente roda de novo de tempos em tempos).
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
  const valeHoje = !s.agora || !/^\d{4}-\d{2}-\d{2}$/.test(s.agora.id) || s.agora.id === hoje;
  if (s.agora && destinos.length && valeHoje) {
    enviadosAgora = await o.servico.enviarAgora(s.agora.relatorio, `agora:${s.agora.id}`, destinos).catch((e) => {
      log('SINTONIA_RELATORIO_INICIAL: o envio de agora falhou', String(e));
      return 0;
    });
  }
  if (acrescentados || enviadosAgora || !o.silencioso) log(`Relatórios automáticos: ${acrescentados} número(s) acrescentado(s), ${enviadosAgora} enviado(s) agora.`);
  return { acrescentados, enviadosAgora };
}

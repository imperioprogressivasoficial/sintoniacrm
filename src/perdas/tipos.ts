import { z } from 'zod';

/**
 * perdas-saude: motivo de perda obrigatório no Pipeline.
 *
 * Quando alguém da equipe move um lead para uma etapa de perda (no funil do sistema, "Perdida"; nos outros funis,
 * qualquer etapa com "perd" no nome), a tela pede o motivo: um da lista da empresa (configurável) e, em "Outro",
 * um texto. Perdas automáticas (a IA classificou, a cliente não respondeu aos follow-ups, uma automação) também são
 * registradas, com o motivo que o sistema conhece. O relatório fica em Análises › Perdas.
 *
 * Os motivos do "Finalizar atendimento" (src/nps) são sobre como o atendimento terminou (resolvido, venda feita,
 * agendou…), não sobre por que a venda escapou; por isso a lista daqui é própria. "Sem interesse" e "A cliente não
 * respondeu" do Finalizar equivalem a "Desistiu" e "Sumiu" daqui (mesmos ids não, nomes parecidos de propósito).
 */

/** Motivo da lista (o id não muda; o nome pode ser trocado pela gestão). */
export interface MotivoPerda {
  id: string;
  nome: string;
  ativo: boolean;
  /** "Outro" e motivos marcados assim pedem um texto. */
  pedeTexto: boolean;
}

/** O motivo que nunca sai da lista (sempre pede texto). */
export const MOTIVO_OUTRO = 'outro';

export const MOTIVOS_PADRAO: MotivoPerda[] = [
  { id: 'preco', nome: 'Preço', ativo: true, pedeTexto: false },
  { id: 'sem_horario', nome: 'Sem horário', ativo: true, pedeTexto: false },
  { id: 'sumiu', nome: 'Sumiu (parou de responder)', ativo: true, pedeTexto: false },
  { id: 'concorrente', nome: 'Foi para a concorrência', ativo: true, pedeTexto: false },
  { id: 'desistiu', nome: 'Desistiu ou sem interesse', ativo: true, pedeTexto: false },
  { id: MOTIVO_OUTRO, nome: 'Outro', ativo: true, pedeTexto: true },
];

/** Motivos que só o sistema grava (não aparecem para escolher). */
export const MOTIVOS_AUTOMATICOS: Record<string, string> = {
  ia: 'A IA marcou como perdida',
  automacao: 'Automação',
  sem_motivo: 'Sem motivo informado',
};

const Id = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'Use letras minúsculas, números e _ no id do motivo.');

export const ConfigPerdas = z
  .object({
    motivos: z
      .array(z.object({ id: Id, nome: z.string().trim().min(1).max(60), ativo: z.boolean().default(true), pedeTexto: z.boolean().default(false) }))
      .min(1)
      .max(20),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const m of c.motivos) {
      if (ids.has(m.id)) ctx.addIssue({ code: 'custom', message: `Motivo repetido: ${m.id}` });
      ids.add(m.id);
      if (m.id in MOTIVOS_AUTOMATICOS) ctx.addIssue({ code: 'custom', message: `O id "${m.id}" é reservado.` });
    }
  });
export type ConfigPerdas = z.infer<typeof ConfigPerdas>;

/** Junta o que está gravado com o padrão: "Outro" sempre existe, ativo e pedindo texto. */
export function normalizarConfigPerdas(bruto: unknown): ConfigPerdas {
  const r = ConfigPerdas.safeParse(bruto);
  const motivos = r.success ? r.data.motivos.map((m) => ({ ...m })) : MOTIVOS_PADRAO.map((m) => ({ ...m }));
  const outro = motivos.find((m) => m.id === MOTIVO_OUTRO);
  if (outro) Object.assign(outro, { ativo: true, pedeTexto: true });
  else motivos.push({ ...MOTIVOS_PADRAO.at(-1)! });
  return { motivos };
}

/** O que a tela manda junto do "mover" para uma etapa de perda. */
export const PerdaInformada = z.object({
  motivo: z.string().trim().min(1).max(40),
  detalhe: z.string().trim().max(300).optional(),
});
export type PerdaInformada = z.infer<typeof PerdaInformada>;

/** Uma perda registrada. */
export interface Perda {
  id: string;
  empresaId: string;
  conversaId: string;
  funilId: string;
  etapaId: string | null;
  deEtapaId: string | null;
  deEtapaNome: string | null;
  motivo: string;
  motivoNome: string;
  detalhe: string | null;
  automatico: boolean;
  atendenteId: string | null;
  atendenteNome: string | null;
  porId: string | null;
  porNome: string;
  unidade: string;
  em: Date;
}

/** O que aparece no cartão do Pipeline. */
export interface ResumoPerda {
  motivo: string;
  nome: string;
  detalhe: string | null;
  por: string;
  automatico: boolean;
  em: Date;
}

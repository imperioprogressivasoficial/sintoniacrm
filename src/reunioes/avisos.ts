import type pg from 'pg';

/**
 * atendimento-extra: avisos do agendamento online (link /r/<slug>, src/reunioes/reunioes.ts).
 * - Marcou ou desmarcou pelo link: sino + push para a pessoa dona do link e para a gestão (tipo "reuniao", abre a Agenda).
 * - Confirmação para o contato pelo WhatsApp, se ele deixou o número e o link está com "Confirmar pelo WhatsApp" ligado.
 * - Lembrete antes da reunião (padrão 1 h; 0 = sem lembrete) para o contato (WhatsApp) e para a dona do link (sino + push).
 * Nada aqui atrasa nem derruba a página pública: os avisos rodam por trás e as falhas só vão para o log.
 * Horários sempre no fuso da Bahia (UTC−3, o mesmo de Brasília).
 */

export interface ReuniaoParaAviso {
  id: string;
  empresa_id: string;
  link_id: string;
  nome: string;
  telefone: string | null;
  email?: string | null;
  inicio: Date | string;
  fim: Date | string;
  codigo_cancelar?: string | null;
  /** Do link: */
  titulo: string;
  local: string;
  slug: string;
  criado_por: string | null;
  whatsapp_cliente: boolean;
  lembrete_min: number;
}

export interface AvisoSino { titulo: string; texto: string; chave: string; vista?: string; tipo?: 'reuniao' }

export interface DependenciasAvisosReuniao {
  pool: pg.Pool;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Endereço público da Sintonia (ex.: https://app.exemplo.com.br), para os links que vão no WhatsApp. */
  urlPublica?: () => string | undefined;
  avisarPessoa?: (usuarioId: string, a: AvisoSino) => Promise<unknown>;
  avisarGestao?: (a: AvisoSino) => Promise<unknown>;
  /** Manda um texto para o telefone (conversa existente do número, ou uma nova). Retorna a conversa. */
  whatsapp?: (telefone: string, nome: string, texto: string) => Promise<{ conversaId: string } | undefined>;
  /** automacao-vendas: reunião marcada pelo link e já ligada a uma conversa (gatilho "agendou" das automações). */
  aoAgendou?: (reuniaoId: string, conversaId: string) => Promise<void>;
}

const fData = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: '2-digit' });
const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' });
/** "sexta-feira, 27/11, às 14:00" */
export const quandoTexto = (d: Date) => `${fData.format(d)}, às ${fHora.format(d)}`;
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] || n;
/** Telefone com DDI, só dígitos (Brasil: põe o 55); curto demais = sem WhatsApp. */
export function telefoneParaWhatsapp(bruto: string | null | undefined): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

export function textoConfirmacao(r: ReuniaoParaAviso, linkCancelar?: string): string {
  const ini = new Date(r.inicio);
  return [
    `Olá, ${primeiroNome(r.nome)}! Sua reunião "${r.titulo}" está marcada para ${quandoTexto(ini)} (horário de Brasília).`,
    r.local ? `Local: ${r.local}` : '',
    linkCancelar ? `Se precisar desmarcar: ${linkCancelar}` : 'Se precisar desmarcar, é só responder esta mensagem.',
  ].filter(Boolean).join('\n');
}
export function textoCancelamento(r: ReuniaoParaAviso, linkNovo?: string): string {
  return [
    `Olá, ${primeiroNome(r.nome)}! Sua reunião "${r.titulo}" de ${quandoTexto(new Date(r.inicio))} foi cancelada.`,
    linkNovo ? `Se quiser marcar outro horário: ${linkNovo}` : 'Se quiser marcar outro horário, é só responder esta mensagem.',
  ].join('\n');
}
export function textoLembrete(r: ReuniaoParaAviso, agora: Date): string {
  const ini = new Date(r.inicio);
  const falta = Math.max(1, Math.round((ini.getTime() - agora.getTime()) / 60_000));
  const quando = falta < 90 ? `daqui a ${falta >= 55 ? '1 hora' : `${falta} minutos`}, às ${fHora.format(ini)}` : quandoTexto(ini);
  return [`Olá, ${primeiroNome(r.nome)}! Lembrete: sua reunião "${r.titulo}" é ${quando}.`, r.local ? `Local: ${r.local}` : '', 'Até já!'].filter(Boolean).join('\n');
}

const COLUNAS = `r.id, r.empresa_id, r.link_id, r.nome, r.telefone, r.email, r.inicio, r.fim, r.codigo_cancelar,
  l.titulo, l.local, l.slug, l.criado_por, l.whatsapp_cliente, l.lembrete_min`;

export class AvisosReuniao {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private fila: Promise<void> = Promise.resolve();

  constructor(private readonly d: DependenciasAvisosReuniao) {
    this.agora = d.agora ?? (() => new Date());
    this.log = d.log ?? (() => {});
  }

  /** Uma reunião com os dados do link (para os avisos). */
  async carregar(id: string): Promise<ReuniaoParaAviso | undefined> {
    const { rows } = await this.d.pool.query(`select ${COLUNAS} from sintonia.reunioes r join sintonia.links_reuniao l on l.id = r.link_id where r.id = $1`, [id]);
    return rows[0] as ReuniaoParaAviso | undefined;
  }

  private link(caminho: string): string | undefined {
    const base = this.d.urlPublica?.()?.replace(/\/$/, '');
    return base ? `${base}${caminho}` : undefined;
  }

  /** Por trás, em ordem: quem chamou não espera (a página pública responde na hora). */
  private depois(fn: () => Promise<void>): void {
    this.fila = this.fila.then(fn).catch((e) => this.log('Falha nos avisos do agendamento online', String(e)));
  }
  /** Testes: espera os avisos em andamento. */
  ocioso(): Promise<void> {
    return this.fila;
  }

  private async sino(r: ReuniaoParaAviso, a: Omit<AvisoSino, 'vista' | 'tipo'>, gestao: boolean): Promise<void> {
    const aviso: AvisoSino = { ...a, vista: 'agenda', tipo: 'reuniao' };
    // A dona do link primeiro; a gestão depois (a chave igual evita aviso em dobro para quem é as duas coisas).
    if (r.criado_por) await this.d.avisarPessoa?.(r.criado_por, aviso);
    if (gestao || !r.criado_por) await this.d.avisarGestao?.(aviso);
  }

  private async mandarWhatsapp(r: ReuniaoParaAviso, texto: string): Promise<void> {
    const tel = telefoneParaWhatsapp(r.telefone);
    if (!tel || !r.whatsapp_cliente || !this.d.whatsapp) return;
    try {
      const c = await this.d.whatsapp(tel, r.nome, texto);
      if (c?.conversaId) await this.d.pool.query('update sintonia.reunioes set conversa_id = $2 where id = $1 and conversa_id is null', [r.id, c.conversaId]);
    } catch (e) {
      this.log('Agendamento online: WhatsApp para o contato não saiu', String(e));
    }
  }

  /** Alguém marcou pelo link. */
  aoMarcar(id: string): void {
    this.depois(async () => {
      const r = await this.carregar(id);
      if (!r) return;
      const ini = new Date(r.inicio);
      const contato = [r.telefone, r.email].filter(Boolean).join(' · ');
      await this.sino(r, { titulo: `Reunião marcada: ${r.nome}`, texto: `${r.titulo} · ${quandoTexto(ini)}${contato ? ` · ${contato}` : ''}`, chave: `reuniao-marcada-${r.id}` }, true);
      await this.mandarWhatsapp(r, textoConfirmacao(r, r.codigo_cancelar ? this.link(`/r/${r.slug}?cancelar=${r.codigo_cancelar}`) : undefined));
      if (this.d.aoAgendou) {
        const { rows } = await this.d.pool.query<{ conversa_id: string | null }>('select conversa_id::text from sintonia.reunioes where id = $1', [r.id]);
        if (rows[0]?.conversa_id) await this.d.aoAgendou(String(r.id), rows[0].conversa_id).catch((e) => this.log('Falha no gatilho "agendou" do link online', String(e)));
      }
    });
  }

  /** Cancelada pelo próprio contato (no link) ou pela equipe (Agenda / Agendamento online). */
  aoCancelar(id: string, por: 'cliente' | 'equipe'): void {
    this.depois(async () => {
      const r = await this.carregar(id);
      if (!r) return;
      const ini = new Date(r.inicio);
      await this.sino(r, { titulo: `Reunião desmarcada: ${r.nome}`, texto: `${r.titulo} · ${quandoTexto(ini)} · ${por === 'cliente' ? 'o contato desmarcou pelo link' : 'cancelada pela equipe'}`, chave: `reuniao-cancelada-${r.id}` }, true);
      // Quem desmarcou pelo link já viu a confirmação na tela; a mensagem vai quando foi a equipe.
      if (por === 'equipe') await this.mandarWhatsapp(r, textoCancelamento(r, this.link(`/r/${r.slug}`)));
    });
  }

  /**
   * Relógio: lembrete das reuniões que começam dentro do prazo do link. Cada reunião sai uma vez só
   * (a reserva marca lembrete_em antes de enviar; com vários processos, "skip locked").
   * Marcada já dentro do prazo (ex.: 20 min antes, com lembrete de 1 h): não manda (a confirmação acabou de sair).
   */
  async tick(): Promise<number> {
    const agora = this.agora();
    const { rows } = await this.d.pool.query(
      `with vencidas as (
         select r.id, (r.criado_em > r.inicio - make_interval(mins => l.lembrete_min)) as marcada_em_cima
           from sintonia.reunioes r join sintonia.links_reuniao l on l.id = r.link_id
          where r.status = 'marcada' and r.lembrete_em is null and l.lembrete_min > 0
            and r.inicio > $1 and r.inicio - make_interval(mins => l.lembrete_min) <= $1
          order by r.inicio limit 50
          for update of r skip locked
       )
       update sintonia.reunioes r set lembrete_em = $1 from vencidas where r.id = vencidas.id
       returning r.id, vencidas.marcada_em_cima`,
      [agora],
    );
    let n = 0;
    for (const v of rows as Array<{ id: string; marcada_em_cima: boolean }>) {
      if (v.marcada_em_cima) continue;
      const r = await this.carregar(v.id);
      if (!r) continue;
      n++;
      const ini = new Date(r.inicio);
      const falta = Math.round((ini.getTime() - agora.getTime()) / 60_000);
      try {
        await this.sino(r, { titulo: `Reunião ${falta >= 55 && falta < 90 ? 'em 1 hora' : `às ${fHora.format(ini)}`}: ${r.nome}`, texto: `${r.titulo} · ${quandoTexto(ini)}${r.local ? ` · ${r.local}` : ''}`, chave: `reuniao-lembrete-${r.id}` }, false);
      } catch (e) {
        this.log('Agendamento online: lembrete da equipe não saiu', String(e));
      }
      await this.mandarWhatsapp(r, textoLembrete(r, agora));
    }
    return n;
  }
}

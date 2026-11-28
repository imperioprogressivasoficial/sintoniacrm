import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';

/** Um e-mail pronto para sair. */
export interface Mensagem {
  de: { nome: string; email: string };
  para: { nome?: string | null; email: string };
  responderPara?: string | null;
  assunto: string;
  html: string;
  texto: string;
  /** Message-ID completo, com < >: as respostas voltam com ele no In-Reply-To. */
  messageId: string;
  cabecalhos?: Record<string, string>;
}

/** Configuração já decifrada de uma conta remetente. */
export interface ContaEnvio {
  id: string;
  provedor: 'smtp' | 'resend' | 'brevo';
  smtpHost?: string | null;
  smtpPorta?: number | null;
  smtpSeguranca: 'ssl' | 'starttls' | 'nenhuma';
  usuario?: string | null;
  senha?: string | null;
  apiChave?: string | null;
}

/** Erro do servidor de e-mail. `permanente` = endereço não existe/recusado (bounce): não tentar de novo. */
export class ErroEnvio extends Error {
  constructor(
    message: string,
    readonly permanente: boolean,
    readonly codigo?: number,
  ) {
    super(message);
  }
}

export interface Transportador {
  enviar(m: Mensagem): Promise<{ idExterno?: string }>;
  /** Confere login/conexão sem enviar nada. */
  verificar(): Promise<void>;
}

export type FabricaTransporte = (conta: ContaEnvio) => Transportador;

/** Classifica o erro do SMTP: 5xx = permanente (bounce), 4xx/rede = tenta de novo. */
export function erroDoSmtp(e: unknown): ErroEnvio {
  const x = e as { responseCode?: number; message?: string; code?: string; response?: string };
  const codigo = x.responseCode;
  const msg = String(x.response ?? x.message ?? e).slice(0, 400);
  if (x.code === 'EAUTH') return new ErroEnvio(`Login recusado pelo servidor de e-mail: ${msg}`, false, codigo);
  const destinatarioRuim = codigo !== undefined && codigo >= 500 && (x.code === 'EENVELOPE' || /recipient|mailbox|user unknown|does not exist|no such user|address rejected|5\.1\.[0-9]/i.test(msg));
  return new ErroEnvio(msg, destinatarioRuim, codigo);
}

/** SMTP de verdade (Hostinger, Gmail, Outlook, qualquer outro). */
export function transporteSmtp(c: ContaEnvio): Transportador {
  const t = nodemailer.createTransport({
    host: c.smtpHost ?? '',
    port: c.smtpPorta ?? (c.smtpSeguranca === 'ssl' ? 465 : 587),
    secure: c.smtpSeguranca === 'ssl',
    requireTLS: c.smtpSeguranca === 'starttls',
    auth: c.usuario ? { user: c.usuario, pass: c.senha ?? '' } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  return {
    async enviar(m) {
      try {
        const r = await t.sendMail({
          from: { name: m.de.nome, address: m.de.email },
          to: m.para.nome ? { name: m.para.nome, address: m.para.email } : m.para.email,
          replyTo: m.responderPara || undefined,
          subject: m.assunto,
          html: m.html,
          text: m.texto,
          messageId: m.messageId,
          headers: m.cabecalhos,
        });
        return { idExterno: r.messageId };
      } catch (e) {
        throw erroDoSmtp(e);
      }
    },
    async verificar() {
      try {
        await t.verify();
      } catch (e) {
        throw erroDoSmtp(e);
      }
    },
  };
}

/** Provedor por API (Resend ou Brevo). Interface pronta; SMTP continua sendo o principal. */
export function transporteApi(c: ContaEnvio, fetchFn: typeof fetch = fetch): Transportador {
  const chave = c.apiChave ?? '';
  const falha = async (r: Response) => {
    const corpo = (await r.text().catch(() => '')).slice(0, 300);
    return new ErroEnvio(`${c.provedor} respondeu ${r.status}: ${corpo}`, r.status === 422 || r.status === 400, r.status);
  };
  return {
    async enviar(m) {
      const r =
        c.provedor === 'resend'
          ? await fetchFn('https://api.resend.com/emails', {
              method: 'POST',
              headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
              body: JSON.stringify({ from: `${m.de.nome} <${m.de.email}>`, to: [m.para.email], subject: m.assunto, html: m.html, text: m.texto, reply_to: m.responderPara || undefined, headers: { ...m.cabecalhos, 'Message-ID': m.messageId } }),
              signal: AbortSignal.timeout(30_000),
            })
          : await fetchFn('https://api.brevo.com/v3/smtp/email', {
              method: 'POST',
              headers: { 'api-key': chave, 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ sender: { name: m.de.nome, email: m.de.email }, to: [{ email: m.para.email, name: m.para.nome || undefined }], subject: m.assunto, htmlContent: m.html, textContent: m.texto, replyTo: m.responderPara ? { email: m.responderPara } : undefined, headers: { ...m.cabecalhos, 'Message-Id': m.messageId } }),
              signal: AbortSignal.timeout(30_000),
            });
      if (!r.ok) throw await falha(r);
      const j = (await r.json().catch(() => ({}))) as { id?: string; messageId?: string };
      return { idExterno: j.id ?? j.messageId };
    },
    async verificar() {
      const r =
        c.provedor === 'resend'
          ? await fetchFn('https://api.resend.com/domains', { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(15_000) })
          : await fetchFn('https://api.brevo.com/v3/account', { headers: { 'api-key': chave, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw await falha(r);
    },
  };
}

export const transporteReal: FabricaTransporte = (c) => (c.provedor === 'smtp' ? transporteSmtp(c) : transporteApi(c));

/** Transportador falso (testes): guarda tudo em memória; `recusar` simula erro por e-mail. */
export class TransporteFalso {
  readonly enviados: Array<Mensagem & { contaId: string }> = [];
  recusar = new Map<string, ErroEnvio>();
  falharVerificacao?: string;
  fabrica: FabricaTransporte = (c) => ({
    enviar: async (m) => {
      const erro = this.recusar.get(m.para.email.toLowerCase());
      if (erro) throw erro;
      this.enviados.push({ ...m, contaId: c.id });
      return { idExterno: m.messageId };
    },
    verificar: async () => {
      if (this.falharVerificacao) throw new ErroEnvio(this.falharVerificacao, false);
    },
  });
}

/** Para desenvolvimento: nada sai; cada e-mail vira um arquivo .html (e .eml simples) na pasta. */
export function transporteArquivo(pasta: string): FabricaTransporte {
  mkdirSync(pasta, { recursive: true });
  return (c) => ({
    async enviar(m) {
      const base = `${Date.now()}-${m.para.email.replace(/[^a-z0-9@._-]/gi, '_')}`;
      writeFileSync(join(pasta, `${base}.html`), m.html);
      const cab = Object.entries({ From: `${m.de.nome} <${m.de.email}>`, To: m.para.email, Subject: m.assunto, 'Message-ID': m.messageId, 'X-Conta': c.id, ...m.cabecalhos })
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      writeFileSync(join(pasta, `${base}.eml.txt`), `${cab}\n\n${m.texto}`);
      return { idExterno: m.messageId };
    },
    async verificar() {},
  });
}

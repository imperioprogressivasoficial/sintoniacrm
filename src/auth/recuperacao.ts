import type { Usuario } from './contas.js';
import type { Recuperacao } from './rotas.js';

/** O mínimo do e-mail marketing que a redefinição de senha usa (a conta remetente padrão). */
export interface EnvioSistema {
  temContaAtiva(): Promise<boolean>;
  enviarSistema(m: { para: string; nome?: string; assunto: string; html: string; texto: string }): Promise<boolean>;
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Texto e HTML do e-mail com o link de redefinição. */
export function emailRedefinicao(nome: string, link: string, validadeMin: number): { assunto: string; html: string; texto: string } {
  const primeiro = nome.trim().split(/\s+/)[0] || nome;
  const validade = validadeMin >= 60 ? `${Math.round(validadeMin / 60)} hora${validadeMin >= 120 ? 's' : ''}` : `${validadeMin} minutos`;
  const assunto = 'Crie sua nova senha do Sintonia';
  const texto = [
    `Olá, ${primeiro}!`,
    '',
    'Recebemos um pedido para criar uma nova senha da sua conta no Sintonia.',
    `Abra o link abaixo (ele vale por ${validade} e só funciona uma vez):`,
    link,
    '',
    'Se não foi você, ignore este e-mail: sua senha atual continua valendo.',
  ].join('\n');
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f6fa;font-family:Poppins,Arial,sans-serif;color:#0b1f33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Olá, ${escapar(primeiro)}!</td></tr>
<tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px">Recebemos um pedido para criar uma nova senha da sua conta no Sintonia. O link vale por ${validade} e só funciona uma vez.</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapar(link)}" style="display:inline-block;background:#106EBE;color:#fff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px">Criar nova senha</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#5b6b7c">Se não foi você, ignore este e-mail: sua senha atual continua valendo.</td></tr>
</table></td></tr></table></body></html>`;
  return { assunto, html, texto };
}

/**
 * Envio do link pelo e-mail do sistema (a conta remetente ativa em Conexões → E-mail).
 * WhatsApp fica de fora: hoje as contas da equipe não guardam o telefone da pessoa.
 */
export function recuperacaoPorEmail(envio: EnvioSistema, log?: (msg: string, extra?: unknown) => void): Recuperacao {
  return {
    async canais() {
      return { email: await envio.temContaAtiva(), whatsapp: false };
    },
    async enviar(u: Usuario, link: string, validadeMin: number) {
      const m = emailRedefinicao(u.nome, link, validadeMin);
      try {
        return (await envio.enviarSistema({ para: u.email, nome: u.nome, ...m })) ? ['e-mail'] : [];
      } catch (e) {
        log?.('redefinição de senha: o e-mail não saiu', String(e));
        return [];
      }
    },
  };
}

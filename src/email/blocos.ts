import { z } from 'zod';

/**
 * Editor de blocos do e-mail: título, texto, imagem, botão, divisor, espaço e 2 colunas.
 * O HTML gerado segue o que os clientes de e-mail aceitam (Gmail, Outlook, Apple Mail):
 * tabelas, estilos inline, largura de 600 px e colunas que viram uma embaixo da outra no celular.
 */

const cor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB');
const url = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => /^(https?:\/\/|mailto:|tel:)/i.test(u) || u.startsWith('{'), 'O link precisa começar com https://, mailto: ou tel:');
const alinhar = z.enum(['esquerda', 'centro', 'direita']).default('esquerda');

const Titulo = z.object({ tipo: z.literal('titulo'), texto: z.string().max(300), tamanho: z.enum(['grande', 'medio', 'pequeno']).default('grande'), alinhar });
const Texto = z.object({ tipo: z.literal('texto'), texto: z.string().max(6000), alinhar });
const Imagem = z.object({ tipo: z.literal('imagem'), url: url, alt: z.string().max(200).default(''), link: z.union([url, z.literal('')]).optional(), largura: z.number().int().min(40).max(600).default(600), arredondar: z.boolean().default(true) });
const Botao = z.object({ tipo: z.literal('botao'), texto: z.string().trim().min(1).max(80), url: url, cor: cor.optional(), alinhar: z.enum(['esquerda', 'centro', 'direita']).default('centro') });
const Divisor = z.object({ tipo: z.literal('divisor') });
const Espaco = z.object({ tipo: z.literal('espaco'), altura: z.number().int().min(4).max(120).default(24) });

const Simples = z.discriminatedUnion('tipo', [Titulo, Texto, Imagem, Botao, Divisor, Espaco]);
const Colunas = z.object({ tipo: z.literal('colunas'), esquerda: z.array(Simples).max(10).default([]), direita: z.array(Simples).max(10).default([]) });

export const Bloco = z.discriminatedUnion('tipo', [Titulo, Texto, Imagem, Botao, Divisor, Espaco, Colunas]);
export type Bloco = z.infer<typeof Bloco>;
type BlocoSimples = z.infer<typeof Simples>;

export const Tema = z
  .object({
    fundo: cor.default('#EEF4FB'),
    conteudo: cor.default('#FFFFFF'),
    texto: cor.default('#0B2540'),
    destaque: cor.default('#106EBE'),
    botao: cor.default('#0FFCBE'),
    textoBotao: cor.default('#071D33'),
    logo: z.union([url, z.literal('')]).default(''),
    rodape: z.string().max(600).default('Império Progressivas · Salvador, Bahia'),
  })
  .default({ fundo: '#EEF4FB', conteudo: '#FFFFFF', texto: '#0B2540', destaque: '#106EBE', botao: '#0FFCBE', textoBotao: '#071D33', logo: '', rodape: 'Império Progressivas · Salvador, Bahia' });
export type Tema = z.infer<typeof Tema>;

export const Conteudo = z.object({ tema: Tema, blocos: z.array(Bloco).max(60).default([]) });
export type Conteudo = z.infer<typeof Conteudo>;

export interface Variaveis {
  nome?: string | null;
  email?: string | null;
  unidade?: string | null;
  /** Variáveis próprias do envio (ex.: {servico}, {data}, {hora} da confirmação de agenda). */
  extras?: Record<string, string> | null;
}

export interface OpcoesHtml {
  assunto: string;
  preheader?: string;
  /** Link de descadastro (sempre no rodapé). Na prévia, "#". */
  descadastro: string;
  /** Pixel de abertura (só no envio de verdade). */
  pixel?: string;
  /** Troca cada link pelo link rastreado (índice na lista de links do e-mail). */
  rastrear?: (i: number, url: string) => string;
}

export interface EmailMontado {
  html: string;
  texto: string;
  /** Links na ordem em que aparecem (o índice é o do link rastreado). */
  links: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ALINHA = { esquerda: 'left', centro: 'center', direita: 'right' } as const;
const FONTE = "'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif";
const FONTE_TITULO = "'Sintony', 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif";

/** Troca {nome} {primeiro_nome} {email} {unidade} (valores já escapados quando vão para o HTML). */
export function trocarVariaveis(texto: string, v: Variaveis, escapar: boolean): string {
  const nome = (v.nome ?? '').trim();
  const primeiro = nome.split(/\s+/)[0] ?? '';
  const f = (s: string) => (escapar ? esc(s) : s);
  let t = texto;
  for (const [k, val] of Object.entries(v.extras ?? {})) if (/^[a-z_]+$/.test(k)) t = t.split(`{${k}}`).join(f(String(val)));
  return t
    .replace(/\{primeiro_nome\}/g, f(primeiro || 'cliente'))
    .replace(/\{nome\}/g, f(nome || 'cliente'))
    .replace(/\{email\}/g, f((v.email ?? '').trim()))
    .replace(/\{unidade\}/g, f((v.unidade ?? '').trim() || 'Império Progressivas'));
}

/** Texto simples com **negrito**, *itálico*, [link](https://...) e quebras de linha. */
function textoRico(s: string, link: (url: string) => string, corLink: string): string {
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${link(u.replace(/&amp;/g, '&'))}" style="color:${corLink};text-decoration:underline;">${t}</a>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return h.replace(/\r?\n/g, '<br>');
}

/** Monta o HTML (com tabelas e estilos inline) e a versão em texto. Variáveis ainda não trocadas. */
export function montarEmail(conteudo: Conteudo, o: OpcoesHtml): EmailMontado {
  const t = conteudo.tema;
  const links: string[] = [];
  const textoPlano: string[] = [];
  const link = (u: string) => {
    if (!/^https?:\/\//i.test(u) || !o.rastrear) return esc(u);
    links.push(u);
    return esc(o.rastrear(links.length - 1, u));
  };

  const simples = (b: BlocoSimples, largura: number): string => {
    switch (b.tipo) {
      case 'titulo': {
        const tam = { grande: 28, medio: 22, pequeno: 18 }[b.tamanho];
        textoPlano.push(b.texto.toUpperCase());
        return `<tr><td style="padding:8px 32px 4px;font-family:${FONTE_TITULO};font-size:${tam}px;line-height:1.25;font-weight:700;color:${t.destaque};text-align:${ALINHA[b.alinhar]};" class="px">${esc(b.texto)}</td></tr>`;
      }
      case 'texto':
        textoPlano.push(b.texto.replace(/\*\*?/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)'));
        return `<tr><td style="padding:6px 32px;font-family:${FONTE};font-size:16px;line-height:1.6;color:${t.texto};text-align:${ALINHA[b.alinhar]};" class="px">${textoRico(b.texto, link, t.destaque)}</td></tr>`;
      case 'imagem': {
        const w = Math.min(b.largura, largura);
        const img = `<img src="${esc(b.url)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;${b.arredondar ? 'border-radius:14px;' : ''}margin:0 auto;">`;
        if (b.alt) textoPlano.push(`[${b.alt}]`);
        return `<tr><td style="padding:8px ${w >= largura ? 0 : 32}px;" align="center" class="${w >= largura ? '' : 'px'}">${b.link ? `<a href="${link(b.link)}" target="_blank">${img}</a>` : img}</td></tr>`;
      }
      case 'botao': {
        const fundo = b.cor ?? t.botao;
        textoPlano.push(`${b.texto}: ${b.url}`);
        return `<tr><td style="padding:14px 32px;" align="${ALINHA[b.alinhar]}" class="px"><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;"><tr><td style="border-radius:999px;background:${fundo};" bgcolor="${fundo}"><a href="${link(b.url)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONTE};font-size:16px;font-weight:700;line-height:1.2;color:${t.textoBotao};text-decoration:none;border-radius:999px;">${esc(b.texto)}</a></td></tr></table></td></tr>`;
      }
      case 'divisor':
        textoPlano.push('—');
        return `<tr><td style="padding:14px 32px;" class="px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-top:1px solid #D8E3EF;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;
      case 'espaco':
        return `<tr><td style="height:${b.altura}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    }
  };

  const linhas = conteudo.blocos.map((b) => {
    if (b.tipo !== 'colunas') return simples(b, 600);
    const lado = (lista: BlocoSimples[]) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${lista.map((x) => simples(x, 268).replace(/padding:(\d+)px 32px/g, 'padding:$1px 12px')).join('')}</table>`;
    return `<tr><td style="padding:6px 20px;" class="pxc"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td class="coluna" width="50%" valign="top" style="width:50%;vertical-align:top;">${lado(b.esquerda)}</td>
<td class="coluna" width="50%" valign="top" style="width:50%;vertical-align:top;">${lado(b.direita)}</td>
</tr></table></td></tr>`;
  });

  const logo = t.logo ? `<tr><td style="padding:28px 32px 8px;" align="center"><img src="${esc(t.logo)}" alt="Império Progressivas" width="160" style="display:block;width:160px;max-width:60%;height:auto;border:0;"></td></tr>` : '<tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>';
  const preheader = o.preheader?.trim()
    ? `<div style="display:none;font-size:1px;color:${t.fundo};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(o.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>`
    : '';
  const rodape = `<tr><td style="padding:22px 32px 30px;font-family:${FONTE};font-size:12px;line-height:1.6;color:#5B6B7C;text-align:center;" class="px">${textoRico(t.rodape, (u) => esc(u), '#5B6B7C')}<br>Você recebeu este e-mail porque é cliente ou se cadastrou na Império Progressivas.<br><a href="${esc(o.descadastro)}" style="color:#5B6B7C;text-decoration:underline;">Não quero mais receber e-mails</a></td></tr>`;
  const pixel = o.pixel ? `<img src="${esc(o.pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;">` : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${esc(o.assunto)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Sintony:wght@700&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; }
  a { color:${t.destaque}; }
  @media only screen and (max-width:620px) {
    .casca { width:100% !important; border-radius:0 !important; }
    .px { padding-left:20px !important; padding-right:20px !important; }
    .pxc { padding-left:8px !important; padding-right:8px !important; }
    .coluna { display:block !important; width:100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${t.fundo};">
${preheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${t.fundo};" bgcolor="${t.fundo}">
<tr><td align="center" style="padding:24px 10px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="casca" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:${t.conteudo};border-radius:22px;overflow:hidden;" bgcolor="${t.conteudo}">
${logo}
${linhas.join('\n')}
<tr><td style="height:18px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<table role="presentation" class="casca" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
${rodape}
</table>
<!--[if mso]></td></tr></table><![endif]-->
${pixel}
</td></tr>
</table>
</body>
</html>`;

  const texto = `${textoPlano.join('\n\n')}\n\n—\n${t.rodape}\nPara não receber mais: ${o.descadastro}`;
  return { html, texto, links };
}

// ------------------------------------------------------------ modelos prontos

const IMG_HEROI = 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&q=80';
const IMG_CABELO = 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&q=80';
const IMG_SALAO = 'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=800&q=80';
const WHATS = 'https://wa.me/5571999999999';

const tema = (p: Partial<Tema> = {}): Tema => ({ fundo: '#EEF4FB', conteudo: '#FFFFFF', texto: '#0B2540', destaque: '#106EBE', botao: '#0FFCBE', textoBotao: '#071D33', logo: '', rodape: 'Império Progressivas · Salvador, Bahia\nSalvador Norte Shopping · Shopping Sumaré', ...p });

export const MODELOS_PRONTOS: Array<{ id: string; nome: string; descricao: string; assunto: string; preheader: string; conteudo: Conteudo }> = [
  {
    id: 'promocao',
    nome: 'Promoção do mês',
    descricao: 'Oferta com foto, chamada e botão para agendar pelo WhatsApp.',
    assunto: '{primeiro_nome}, seu liso dos sonhos com condição especial ✨',
    preheader: 'Só este mês: progressiva com valor de amiga. Agende pelo WhatsApp.',
    conteudo: {
      tema: tema(),
      blocos: [
        { tipo: 'imagem', url: IMG_HEROI, alt: 'Cabelo liso e brilhante', largura: 600, arredondar: false },
        { tipo: 'espaco', altura: 12 },
        { tipo: 'titulo', texto: 'Seu liso perfeito, do jeito que você sempre quis', tamanho: 'grande', alinhar: 'esquerda' },
        { tipo: 'texto', texto: 'Oi, {primeiro_nome}! Este mês a Império preparou uma condição especial na **progressiva** para você chegar no verão com o cabelo leve, sem frizz e com brilho de salão todos os dias.', alinhar: 'esquerda' },
        { tipo: 'botao', texto: 'Quero agendar', url: WHATS, alinhar: 'centro' },
        { tipo: 'divisor' },
        { tipo: 'colunas', esquerda: [{ tipo: 'imagem', url: IMG_CABELO, alt: 'Antes e depois', largura: 268, arredondar: true }, { tipo: 'texto', texto: '**Avaliação gratuita** com a nossa equipe antes do procedimento.', alinhar: 'esquerda' }], direita: [{ tipo: 'imagem', url: IMG_SALAO, alt: 'Nosso salão', largura: 268, arredondar: true }, { tipo: 'texto', texto: '**Duas unidades** em Salvador: Norte Shopping e Shopping Sumaré.', alinhar: 'esquerda' }] },
      ],
    },
  },
  {
    id: 'aniversario',
    nome: 'Feliz aniversário',
    descricao: 'Parabéns com um mimo para usar no mês do aniversário.',
    assunto: 'Feliz aniversário, {primeiro_nome}! Tem presente para você 🎁',
    preheader: 'Um mimo da Império para comemorar o seu dia.',
    conteudo: {
      tema: tema({ fundo: '#E8FFF8' }),
      blocos: [
        { tipo: 'titulo', texto: 'Feliz aniversário, {primeiro_nome}! 🎉', tamanho: 'grande', alinhar: 'centro' },
        { tipo: 'texto', texto: 'A família Império deseja um ano lindo, cheio de saúde e de dias de cabelo perfeito.\n\nPara comemorar, você ganha um **mimo especial** em qualquer serviço durante o mês do seu aniversário.', alinhar: 'centro' },
        { tipo: 'botao', texto: 'Resgatar meu presente', url: WHATS, alinhar: 'centro' },
        { tipo: 'texto', texto: '*Válido no mês do aniversário, nas duas unidades.*', alinhar: 'centro' },
      ],
    },
  },
  {
    id: 'pos-atendimento',
    nome: 'Depois do atendimento',
    descricao: 'Cuidados para manter o liso e convite para a manutenção.',
    assunto: '{primeiro_nome}, como está o seu cabelo? Dicas para o liso durar 💙',
    preheader: 'Cuidados simples que fazem a progressiva durar muito mais.',
    conteudo: {
      tema: tema(),
      blocos: [
        { tipo: 'titulo', texto: 'Obrigada pela visita, {primeiro_nome}!', tamanho: 'medio', alinhar: 'esquerda' },
        { tipo: 'texto', texto: 'Para o seu liso durar mais:\n• use shampoo sem sal;\n• evite prender o cabelo molhado nos primeiros dias;\n• hidrate uma vez por semana.', alinhar: 'esquerda' },
        { tipo: 'divisor' },
        { tipo: 'texto', texto: 'A manutenção ideal é entre **3 e 4 meses**. Quer deixar já reservado?', alinhar: 'esquerda' },
        { tipo: 'botao', texto: 'Agendar manutenção', url: WHATS, alinhar: 'esquerda' },
      ],
    },
  },
  {
    id: 'novidade',
    nome: 'Novidade simples',
    descricao: 'Só título, texto e botão. Bom para avisos rápidos.',
    assunto: 'Novidade na Império Progressivas',
    preheader: '',
    conteudo: {
      tema: tema(),
      blocos: [
        { tipo: 'titulo', texto: 'Temos novidade!', tamanho: 'grande', alinhar: 'esquerda' },
        { tipo: 'texto', texto: 'Oi, {primeiro_nome}! Escreva aqui a sua mensagem.', alinhar: 'esquerda' },
        { tipo: 'botao', texto: 'Falar no WhatsApp', url: WHATS, alinhar: 'esquerda' },
      ],
    },
  },
];

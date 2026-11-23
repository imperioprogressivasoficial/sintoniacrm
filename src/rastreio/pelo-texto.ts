import type { Origem } from './armazem.js';

/**
 * origem-auto (dono 23/11: "o CRM identificar o canal automaticamente").
 *
 * Quando a cliente não veio por anúncio de clique para WhatsApp nem por link rastreado (que a Sintonia já lê sozinha),
 * a origem sai do que ela mesma escreve: "vi no Instagram", "a Ana me indicou", "passei na loja", "achei no Google",
 * ou o texto pronto que o WhatsApp põe nos anúncios ("Olá! Tenho interesse e queria mais informações").
 * Só regras (sem IA, sem custo, na hora). Fica marcada como palpite (origemPor "ia"): anúncio ou link de verdade
 * passam por cima, e a equipe pode trocar na ficha.
 */
export type PalpiteOrigem = Pick<Origem, 'canal' | 'fonte' | 'detalhe' | 'indicadoPor'>;

const limpar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Textos prontos dos anúncios de clique para WhatsApp (Meta) e do botão "Enviar mensagem".
const TEXTO_DE_ANUNCIO = [
  /tenho interesse e (queria|gostaria de) (mais|saber mais) informac/,
  /^ola!? (posso|pode) (obter|me dar|ter) mais informac(oes|ao) (sobre isso|sobre)/,
  /^ola!? quero saber mais( sobre isso| sobre)?[.!]?$/,
  /^(ola!? )?gostaria de saber mais sobre (isso|o anuncio)/,
  // Formulário da Meta com confirmação do número pelo WhatsApp ("Olá! Validei meu número e gostaria de...").
  /\bvalidei (o |meu |o meu )?(numero|telefone|whats(app)?)\b/,
  /^(ola|oi|bom dia|boa tarde|boa noite)?[!,. ]*validei\b/,
  /\b(vim|cheguei|venho) (pelo|do|atraves do) (anuncio|formulario)\b/,
];

const ANUNCIO = /\b(anuncio|propaganda|patrocinad[oa]|publicidade)\b/;
const INSTAGRAM = /\b(instagram|insta|ig|stories|story|reels?|direct)\b|\bperfil de voces\b|\bseu perfil\b/;
const FACEBOOK = /\b(facebook|face|fb)\b/;
const TIKTOK = /\b(tik ?tok)\b/;
const GOOGLE = /\b(google|pesquisei na internet|pesquisando na internet|google maps|maps)\b/;
const SITE = /\b(site|pagina de voces|seu site)\b/;
const LOJA = /\b(passei (na|em frente|pela)|vi a loja|vi a fachada|vi o espaco|passando (na|pela|em frente)|no shopping|aqui no shopping|na loja de voces|fui (na|ai na) loja)\b/;
const INDICACAO = /\b(me indicou|me indicaram|indicac(ao|oes)|indicad[ao] (por|pela|pelo)|me recomendou|recomendac(ao|oes)|minha (amiga|prima|irma|cunhada|mae|vizinha|colega)|uma amiga)\b/;
const NOME_INDICOU = /(?:^|\b)(?:a|o)\s+([a-zà-ú][a-zà-ú]{1,20})(?:\s+[a-zà-ú]{2,20})?\s+(?:que\s+)?me\s+(?:indicou|recomendou)/i;
const INDICADA_POR = /indicad[ao] (?:pela|pelo|por)\s+([a-zà-ú][a-zà-ú]{1,20})/i;

/** Lê a origem numa mensagem da cliente. undefined = a mensagem não diz de onde ela veio. */
export function origemPeloTexto(texto: string): PalpiteOrigem | undefined {
  const t = limpar(texto ?? '');
  if (t.length < 3 || t.length > 1500) return undefined;
  const rede = INSTAGRAM.test(t) ? 'instagram' : FACEBOOK.test(t) ? 'facebook' : TIKTOK.test(t) ? 'tiktok' : undefined;
  if (TEXTO_DE_ANUNCIO.some((r) => r.test(t))) return { canal: 'anuncio_meta', fonte: rede ?? 'meta', detalhe: 'Texto pronto do anúncio' };
  // Textos prontos dos links da empresa: "Olá, vim pela bio do Instagram", "vim pelo direct do Instagram".
  if (rede === 'instagram' && /\bbio\b|\blink (da|na) bio\b/.test(t)) return { canal: 'organico', fonte: 'instagram', detalhe: 'Bio do Instagram' };
  if (rede === 'instagram' && /\bdirect\b|\bdm\b/.test(t)) return { canal: 'organico', fonte: 'instagram', detalhe: 'Direct do Instagram' };
  // "vi o anúncio de vocês no Instagram"
  if (ANUNCIO.test(t) && /\b(vi|vendo|apareceu|aparecendo|cliquei|pelo|no|do|esse|desse|seu)\b/.test(t)) {
    return { canal: 'anuncio_meta', fonte: rede ?? 'meta', detalhe: 'A cliente disse que veio pelo anúncio' };
  }
  if (INDICACAO.test(t)) {
    const nome = NOME_INDICOU.exec(texto)?.[1] ?? INDICADA_POR.exec(texto)?.[1];
    const ok = nome && !/^(minha|meu|uma|um|amiga|prima|irma|pessoa)$/i.test(nome) ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : undefined;
    return { canal: 'indicacao', ...(ok ? { indicadoPor: ok } : {}), detalhe: 'A cliente disse que foi indicação' };
  }
  if (LOJA.test(t)) return { canal: 'outro', fonte: 'loja', detalhe: 'Passou na loja' };
  if (rede && /\b(vi|vendo|achei|encontrei|segui|sigo|conheci|pelo|no|do|la|seu|de voces|vim)\b/.test(t)) return { canal: 'organico', fonte: rede };
  if (GOOGLE.test(t) && /\b(achei|encontrei|vi|pesquisei|procurei|pelo|no)\b/.test(t)) return { canal: 'organico', fonte: 'google' };
  if (SITE.test(t) && /\b(vi|achei|entrei|pelo|no)\b/.test(t)) return { canal: 'organico', fonte: 'site' };
  return undefined;
}

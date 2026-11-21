import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { usuarioDaRequisicao, type OpcoesAuth } from '../auth/rotas.js';

/** Páginas públicas (vendas, login) e a entrada do app, servidas pelo próprio servidor. */

const PASTA = new URL('../../public/', import.meta.url);

const ARQUIVOS: Record<string, { arquivo: string; tipo: string }> = {
  '/': { arquivo: 'index.html', tipo: 'text/html; charset=utf-8' },
  '/entrar': { arquivo: 'entrar.html', tipo: 'text/html; charset=utf-8' },
  '/convite': { arquivo: 'convite.html', tipo: 'text/html; charset=utf-8' },
  '/esqueci-senha': { arquivo: 'esqueci-senha.html', tipo: 'text/html; charset=utf-8' },
  '/nova-senha': { arquivo: 'nova-senha.html', tipo: 'text/html; charset=utf-8' },
  /* sem-pagamento: páginas pedidas pela App Store (privacidade, termos, suporte) e o contato público (WhatsApp de vendas) */
  '/privacidade': { arquivo: 'privacidade.html', tipo: 'text/html; charset=utf-8' },
  '/termos': { arquivo: 'termos.html', tipo: 'text/html; charset=utf-8' },
  '/suporte': { arquivo: 'suporte.html', tipo: 'text/html; charset=utf-8' },
  '/legal.css': { arquivo: 'legal.css', tipo: 'text/css; charset=utf-8' },
  '/contato-publico.js': { arquivo: 'contato-publico.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/sem-internet.js': { arquivo: 'telas/sem-internet.js', tipo: 'text/javascript; charset=utf-8' },
  // Tela de "abrindo o aplicativo" (login e primeira carga do /app).
  '/abertura.css': { arquivo: 'abertura.css', tipo: 'text/css; charset=utf-8' },
  '/app': { arquivo: 'app.html', tipo: 'text/html; charset=utf-8' },
  '/conexoes': { arquivo: 'conexoes.html', tipo: 'text/html; charset=utf-8' },
  '/estilo.css': { arquivo: 'estilo.css', tipo: 'text/css; charset=utf-8' },
  '/marca.svg': { arquivo: 'marca.svg', tipo: 'image/svg+xml' },
  '/simbolo.png': { arquivo: 'simbolo.png', tipo: 'image/png' },
  '/simbolo-escuro.png': { arquivo: 'simbolo-escuro.png', tipo: 'image/png' },
  '/serena.jpg': { arquivo: 'serena.jpg', tipo: 'image/jpeg' },
  '/icone-512.png': { arquivo: 'icone-512.png', tipo: 'image/png' },
  '/icone-192.png': { arquivo: 'icone-192.png', tipo: 'image/png' },
  '/icone-180.png': { arquivo: 'icone-180.png', tipo: 'image/png' },
  '/icone-32.png': { arquivo: 'icone-32.png', tipo: 'image/png' },
  '/favicon-escuro-32.png': { arquivo: 'favicon-escuro-32.png', tipo: 'image/png' },
  '/favicon-escuro-64.png': { arquivo: 'favicon-escuro-64.png', tipo: 'image/png' },
  '/icone-escuro-180.png': { arquivo: 'icone-escuro-180.png', tipo: 'image/png' },
  '/icone-escuro-192.png': { arquivo: 'icone-escuro-192.png', tipo: 'image/png' },
  '/icone-escuro-512.png': { arquivo: 'icone-escuro-512.png', tipo: 'image/png' },
  '/favicon-32.png': { arquivo: 'favicon-32.png', tipo: 'image/png' },
  '/favicon-64.png': { arquivo: 'favicon-64.png', tipo: 'image/png' },
  '/logo.png': { arquivo: 'logo.png', tipo: 'image/png' },
  '/logo-escuro.png': { arquivo: 'logo-escuro.png', tipo: 'image/png' },
  // Página de vendas: prints reais do app (mockups), foto do herói e rostos da equipe.
  /* capa-perfil: 5 capas de paisagem (foto grande + miniatura do seletor). Fotos do Unsplash (Licença Unsplash,
     uso livre e gratuito); origem e autor de cada uma em public/capas/CREDITOS.txt. */
  '/capas/praia.webp': { arquivo: 'capas/praia.webp', tipo: 'image/webp' },
  '/capas/praia-mini.webp': { arquivo: 'capas/praia-mini.webp', tipo: 'image/webp' },
  '/capas/montanha.webp': { arquivo: 'capas/montanha.webp', tipo: 'image/webp' },
  '/capas/montanha-mini.webp': { arquivo: 'capas/montanha-mini.webp', tipo: 'image/webp' },
  '/capas/por-do-sol.webp': { arquivo: 'capas/por-do-sol.webp', tipo: 'image/webp' },
  '/capas/por-do-sol-mini.webp': { arquivo: 'capas/por-do-sol-mini.webp', tipo: 'image/webp' },
  '/capas/floresta.webp': { arquivo: 'capas/floresta.webp', tipo: 'image/webp' },
  '/capas/floresta-mini.webp': { arquivo: 'capas/floresta-mini.webp', tipo: 'image/webp' },
  '/capas/cidade.webp': { arquivo: 'capas/cidade.webp', tipo: 'image/webp' },
  '/capas/cidade-mini.webp': { arquivo: 'capas/cidade-mini.webp', tipo: 'image/webp' },
  '/vendas/equipe-01.webp': { arquivo: 'vendas/equipe-01.webp', tipo: 'image/webp' },
  '/vendas/equipe-02.webp': { arquivo: 'vendas/equipe-02.webp', tipo: 'image/webp' },
  '/vendas/equipe-03.webp': { arquivo: 'vendas/equipe-03.webp', tipo: 'image/webp' },
  '/vendas/equipe-04.webp': { arquivo: 'vendas/equipe-04.webp', tipo: 'image/webp' },
  '/vendas/equipe-05.webp': { arquivo: 'vendas/equipe-05.webp', tipo: 'image/webp' },
  '/vendas/equipe-06.webp': { arquivo: 'vendas/equipe-06.webp', tipo: 'image/webp' },
  '/vendas/equipe-07.webp': { arquivo: 'vendas/equipe-07.webp', tipo: 'image/webp' },
  '/vendas/equipe-08.webp': { arquivo: 'vendas/equipe-08.webp', tipo: 'image/webp' },
  '/vendas/equipe-09.webp': { arquivo: 'vendas/equipe-09.webp', tipo: 'image/webp' },
  '/vendas/equipe-10.webp': { arquivo: 'vendas/equipe-10.webp', tipo: 'image/webp' },
  '/vendas/equipe-11.webp': { arquivo: 'vendas/equipe-11.webp', tipo: 'image/webp' },
  '/vendas/equipe-12.webp': { arquivo: 'vendas/equipe-12.webp', tipo: 'image/webp' },
  '/vendas/equipe-13.webp': { arquivo: 'vendas/equipe-13.webp', tipo: 'image/webp' },
  '/vendas/equipe-14.webp': { arquivo: 'vendas/equipe-14.webp', tipo: 'image/webp' },
  '/vendas/equipe-15.webp': { arquivo: 'vendas/equipe-15.webp', tipo: 'image/webp' },
  '/vendas/foto-heroi-480.webp': { arquivo: 'vendas/foto-heroi-480.webp', tipo: 'image/webp' },
  '/vendas/foto-heroi-720.webp': { arquivo: 'vendas/foto-heroi-720.webp', tipo: 'image/webp' },
  '/vendas/iphone-conversa-430.webp': { arquivo: 'vendas/iphone-conversa-430.webp', tipo: 'image/webp' },
  '/vendas/iphone-conversa-860.webp': { arquivo: 'vendas/iphone-conversa-860.webp', tipo: 'image/webp' },
  '/vendas/iphone-crm-430.webp': { arquivo: 'vendas/iphone-crm-430.webp', tipo: 'image/webp' },
  '/vendas/iphone-crm-860.webp': { arquivo: 'vendas/iphone-crm-860.webp', tipo: 'image/webp' },
  '/vendas/iphone-modos-430.webp': { arquivo: 'vendas/iphone-modos-430.webp', tipo: 'image/webp' },
  '/vendas/iphone-modos-860.webp': { arquivo: 'vendas/iphone-modos-860.webp', tipo: 'image/webp' },
  '/vendas/mac-conversas-1440.webp': { arquivo: 'vendas/mac-conversas-1440.webp', tipo: 'image/webp' },
  '/vendas/mac-crm-1440.webp': { arquivo: 'vendas/mac-crm-1440.webp', tipo: 'image/webp' },
  '/vendas/mac-dashboard-1440.webp': { arquivo: 'vendas/mac-dashboard-1440.webp', tipo: 'image/webp' },
  '/vendas/tv-sala-1920.webp': { arquivo: 'vendas/tv-sala-1920.webp', tipo: 'image/webp' },
  '/vendas/tv-sala-960.webp': { arquivo: 'vendas/tv-sala-960.webp', tipo: 'image/webp' },
  // Rostos das clientes de exemplo (animações) e logos dos veículos e concorrentes (uso nominativo).
  '/vendas/cliente-01.webp': { arquivo: 'vendas/cliente-01.webp', tipo: 'image/webp' },
  '/vendas/cliente-02.webp': { arquivo: 'vendas/cliente-02.webp', tipo: 'image/webp' },
  '/vendas/cliente-03.webp': { arquivo: 'vendas/cliente-03.webp', tipo: 'image/webp' },
  '/vendas/cliente-04.webp': { arquivo: 'vendas/cliente-04.webp', tipo: 'image/webp' },
  '/vendas/cliente-05.webp': { arquivo: 'vendas/cliente-05.webp', tipo: 'image/webp' },
  '/vendas/cliente-06.webp': { arquivo: 'vendas/cliente-06.webp', tipo: 'image/webp' },
  '/vendas/cliente-07.webp': { arquivo: 'vendas/cliente-07.webp', tipo: 'image/webp' },
  '/vendas/cliente-08.webp': { arquivo: 'vendas/cliente-08.webp', tipo: 'image/webp' },
  '/vendas/logo-forbes.png': { arquivo: 'vendas/logo-forbes.png', tipo: 'image/png' },
  '/vendas/logo-infomoney.png': { arquivo: 'vendas/logo-infomoney.png', tipo: 'image/png' },
  '/vendas/logo-kommo.png': { arquivo: 'vendas/logo-kommo.png', tipo: 'image/png' },
  '/vendas/logo-hubspot.png': { arquivo: 'vendas/logo-hubspot.png', tipo: 'image/png' },
  '/vendas/logo-rdstation.png': { arquivo: 'vendas/logo-rdstation.png', tipo: 'image/png' },
  '/telas/fone.js': { arquivo: 'telas/fone.js', tipo: 'text/javascript; charset=utf-8' } /* contato-nome */,
  '/telas/prioridade.js': { arquivo: 'telas/prioridade.js', tipo: 'text/javascript; charset=utf-8' }, // fluidez2: ordem de chegada na abertura
  '/telas/privacidade.js': { arquivo: 'telas/privacidade.js', tipo: 'text/javascript; charset=utf-8' }, // fluidez2: Ocultar dados dos clientes
  '/telas/acessos.js': { arquivo: 'telas/acessos.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/painel.js': { arquivo: 'telas/painel.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/ia.js': { arquivo: 'telas/ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agentes-ia.js': { arquivo: 'telas/agentes-ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/ia-estado.js': { arquivo: 'telas/ia-estado.js', tipo: 'text/javascript; charset=utf-8' } /* ia-completa */,
  '/telas/conversa-extras.js': { arquivo: 'telas/conversa-extras.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/icones.js': { arquivo: 'telas/icones.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/conversa-ux.js': { arquivo: 'telas/conversa-ux.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/chat-ia.js': { arquivo: 'telas/chat-ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/serena.js': { arquivo: 'telas/serena.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/serena-chave.js': { arquivo: 'telas/serena-chave.js', tipo: 'text/javascript; charset=utf-8' }, // serena-chave
  '/telas/ligacoes.js': { arquivo: 'telas/ligacoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/funil.js': { arquivo: 'telas/funil.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/funil-topo.js': { arquivo: 'telas/funil-topo.js', tipo: 'text/javascript; charset=utf-8' }, // crm-topo
  '/telas/produtos-lead.js': { arquivo: 'telas/produtos-lead.js', tipo: 'text/javascript; charset=utf-8' }, // produtos-lead
  '/telas/funil-celular.js': { arquivo: 'telas/funil-celular.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/funil-modos.js': { arquivo: 'telas/funil-modos.js', tipo: 'text/javascript; charset=utf-8' }, // pipeline-modos
  '/telas/automacoes.js': { arquivo: 'telas/automacoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/bot.js': { arquivo: 'telas/bot.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/etapa-acoes.js': { arquivo: 'telas/etapa-acoes.js', tipo: 'text/javascript; charset=utf-8' }, // etapa-entrada
  '/telas/relatorios.js': { arquivo: 'telas/relatorios.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/leads.js': { arquivo: 'telas/leads.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/transmissoes.js': { arquivo: 'telas/transmissoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/email.js': { arquivo: 'telas/email.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/followup.js': { arquivo: 'telas/followup.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/nps.js': { arquivo: 'telas/nps.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/radar.js': { arquivo: 'telas/radar.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/conversas-gestos.js': { arquivo: 'telas/conversas-gestos.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/fluidez.js': { arquivo: 'telas/fluidez.js', tipo: 'text/javascript; charset=utf-8' },
  /* robustez: lista de Conversas sem o corte de 500 (busca no servidor e rolagem infinita) */
  '/telas/lista-servidor.js': { arquivo: 'telas/lista-servidor.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/email-conexoes.js': { arquivo: 'telas/email-conexoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/logos-conexoes.js': { arquivo: 'telas/logos-conexoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/catalogo-conexoes.js': { arquivo: 'telas/catalogo-conexoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agenda.js': { arquivo: 'telas/agenda.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agenda.css': { arquivo: 'telas/agenda.css', tipo: 'text/css; charset=utf-8' },
  '/telas/notificacoes.js': { arquivo: 'telas/notificacoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/instalar.js': { arquivo: 'telas/instalar.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/alertas.js': { arquivo: 'telas/alertas.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/espera-selo.js': { arquivo: 'telas/espera-selo.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/resgatar.js': { arquivo: 'telas/resgatar.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/barra-some.js': { arquivo: 'telas/barra-some.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/abas-deslizar.js': { arquivo: 'telas/abas-deslizar.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/rastreio.js': { arquivo: 'telas/rastreio.js', tipo: 'text/javascript; charset=utf-8' },
  // marketing: Central de criativos e a conexão de anúncios (Conexões › Meta Ads)
  '/telas/criativos.js': { arquivo: 'telas/criativos.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/anuncios-conexao.js': { arquivo: 'telas/anuncios-conexao.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/comercial.js': { arquivo: 'telas/comercial.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/desempenho.js': { arquivo: 'telas/desempenho.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/analises.js': { arquivo: 'telas/analises.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/perdas.js': { arquivo: 'telas/perdas.js', tipo: 'text/javascript; charset=utf-8' }, // perdas-saude
  '/telas/saude.js': { arquivo: 'telas/saude.js', tipo: 'text/javascript; charset=utf-8' }, // perdas-saude
  '/telas/relatorio-dia.js': { arquivo: 'telas/relatorio-dia.js', tipo: 'text/javascript; charset=utf-8' }, // relatorio-dia
  '/telas/clientes.js': { arquivo: 'telas/clientes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/tags.js': { arquivo: 'telas/tags.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/respostas.js': { arquivo: 'telas/respostas.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/fluxos-mensagens.js': { arquivo: 'telas/fluxos-mensagens.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/reunioes.js': { arquivo: 'telas/reunioes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/rotina.js': { arquivo: 'telas/rotina.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agendadas.js': { arquivo: 'telas/agendadas.js', tipo: 'text/javascript; charset=utf-8' }, // msg-agendada
  '/telas/distribuicao.js': { arquivo: 'telas/distribuicao.js', tipo: 'text/javascript; charset=utf-8' }, // automacao-vendas
  // grupos: Conversas de grupo (grupos do WhatsApp) e a troca Conversas · Grupos · Equipe no celular.
  '/telas/grupos.js': { arquivo: 'telas/grupos.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/topo-lista.js': { arquivo: 'telas/topo-lista.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/conversas-abas.js': { arquivo: 'telas/conversas-abas.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/scripts.js': { arquivo: 'telas/scripts.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/empresa.js': { arquivo: 'telas/empresa.js', tipo: 'text/javascript; charset=utf-8' }, // layout-telas: Empresa em seções
  '/telas/conta.js': { arquivo: 'telas/conta.js', tipo: 'text/javascript; charset=utf-8' }, // empresa-conta: Conta da pessoa
  '/telas/capa-perfil.js': { arquivo: 'telas/capa-perfil.js', tipo: 'text/javascript; charset=utf-8' }, // capa-perfil: capa com foto e atalhos
  '/telas/papel-parede.js': { arquivo: 'telas/papel-parede.js', tipo: 'text/javascript; charset=utf-8' }, // conversa-extra
  '/telas/conversa-extra.js': { arquivo: 'telas/conversa-extra.js', tipo: 'text/javascript; charset=utf-8' }, // conversa-extra
  '/telas/chanfro.js': { arquivo: 'telas/chanfro.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/puxar.js': { arquivo: 'telas/puxar.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/whatsapp-saude.js': { arquivo: 'telas/whatsapp-saude.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/equipe.js': { arquivo: 'telas/equipe.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/voltar-celular.js': { arquivo: 'telas/voltar-celular.js', tipo: 'text/javascript; charset=utf-8' }, // rotas-celular: botão Voltar no celular
  '/telas/rotas.js': { arquivo: 'telas/rotas.js', tipo: 'text/javascript; charset=utf-8' }, // rotas-fontes: endereços /app/<tela>
  // integracoes: Integrações e API (chaves, webhooks, MCP, documentação)
  '/telas/integracoes.js': { arquivo: 'telas/integracoes.js', tipo: 'text/javascript; charset=utf-8' },
  // Tela "Estamos atualizando melhorias" (camada do app durante uma publicação; a página inteira é /atualizando.html).
  '/telas/atualizando.js': { arquivo: 'telas/atualizando.js', tipo: 'text/javascript; charset=utf-8' },
  // Service worker do push: na raiz (escopo /) e sem cache longo, para a versão nova valer logo.
  '/sw.js': { arquivo: 'sw.js', tipo: 'text/javascript; charset=utf-8' },
  '/manifest.webmanifest': { arquivo: 'manifest.webmanifest', tipo: 'application/manifest+json' },
  '/responsivo.css': { arquivo: 'responsivo.css', tipo: 'text/css; charset=utf-8' },
  '/telas/responsivo.js': { arquivo: 'telas/responsivo.js', tipo: 'text/javascript; charset=utf-8' },
  '/ds.css': { arquivo: 'ds.css', tipo: 'text/css; charset=utf-8' },
  '/acesso-rapido.js': { arquivo: 'acesso-rapido.js', tipo: 'text/javascript; charset=utf-8' },
  '/painel-lateral.js': { arquivo: 'painel-lateral.js', tipo: 'text/javascript; charset=utf-8' },
};

/** rotas-fontes: endereço de volta depois do login. Só aceita caminhos do próprio app (/app, /app/…, /conexoes):
 * nada de outro site (//site, http:, barra invertida), para o /entrar não virar redirecionador aberto. */
export function voltaSegura(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 300) return null;
  if (!/^\/(app|conexoes)(?=[/?]|$)/.test(v)) return null;
  if (/[\\\s]|\/\/|%2f%2f|%5c/i.test(v)) return null;
  return v;
}

/** fluidez2: If-None-Match pode vir com várias etiquetas e com W/ (proxy que comprimiu). */
export function mesmaEtag(pedido: string | string[] | undefined, etag: string): boolean {
  if (!pedido) return false;
  const limpa = (x: string) => x.trim().replace(/^W\//, '');
  return String(pedido).split(',').some((x) => x.trim() === '*' || limpa(x) === limpa(etag));
}

export function registrarPaginas(app: FastifyInstance, auth?: OpcoesAuth): void {
  const cache = new Map<string, Buffer>();
  const ler = (arquivo: string) => {
    let b = cache.get(arquivo);
    if (!b) {
      b = readFileSync(new URL(arquivo, PASTA));
      cache.set(arquivo, b);
    }
    return b;
  };

  const versoes = new Map<string, string>();
  const versao = (arquivo: string) => {
    let v = versoes.get(arquivo);
    if (!v) { v = createHash('sha256').update(ler(arquivo)).digest('hex').slice(0, 10); versoes.set(arquivo, v); }
    return v;
  };
  const porRota = new Map(Object.entries(ARQUIVOS).map(([r, a]) => [r, a.arquivo]));
  const htmlPronto = new Map<string, Buffer>();
  const comVersoes = (arquivo: string) => {
    let h = htmlPronto.get(arquivo);
    if (!h) {
      const texto = ler(arquivo).toString('utf8').replace(/(href|src)="(\/[^"?#]+\.(?:css|js))"/g, (m, attr: string, rota: string) => {
        const a = porRota.get(rota);
        return a ? `${attr}="${rota}?v=${versao(a)}"` : m;
      });
      // imagens (src e srcset): também ganham ?v=, para foto/print novo aparecer na hora no celular
      const comImagens = texto.replace(/(\/[^"\s?#,]+\.(?:webp|png|jpe?g|svg))(?=[\s",])/g, (m, rota: string) => {
        const a = porRota.get(rota);
        return a ? `${rota}?v=${versao(a)}` : m;
      });
      h = Buffer.from(comImagens, 'utf8');
      htmlPronto.set(arquivo, h);
    }
    return h;
  };

  for (const [rota, { arquivo, tipo }] of Object.entries(ARQUIVOS)) {
    app.get(rota, async (req, reply) => {
      if (auth && (rota === '/app' || rota === '/conexoes' || rota === '/entrar')) {
        const u = await usuarioDaRequisicao(req, auth);
        if ((rota === '/app' || rota === '/conexoes') && !u) return reply.redirect('/entrar');
        if (rota === '/conexoes' && u && u.papel !== 'admin' && u.papel !== 'direcao') return reply.redirect('/app');
        /* rotas-fontes: quem já entrou e caiu no /entrar?volta=/app/... volta para onde estava */
        if (rota === '/entrar' && u) return reply.redirect(voltaSegura((req.query as Record<string, unknown> | undefined)?.volta) ?? '/app');
      }
      reply
        .header('content-type', tipo)
        .header('cache-control', tipo.startsWith('text/html') ? 'no-store, max-age=0' : 'public, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'strict-origin-when-cross-origin');
      if (tipo.startsWith('text/html')) reply.header('x-frame-options', 'DENY');
      if (rota === '/sw.js') reply.header('cache-control', 'no-cache').header('service-worker-allowed', '/');
      // HTML: cada CSS/JS local ganha ?v=<versão>, para o celular nunca misturar página nova com estilo antigo guardado.
      if (tipo.startsWith('text/html')) return reply.send(comVersoes(arquivo));
      /* fluidez2: pedido com a versão certa (?v=<hash>, posto pelo HTML) = arquivo que nunca muda nesse endereço:
         fica guardado no aparelho por 1 ano, sem nem perguntar ao servidor. Antes, cada abertura do app conferia
         ~75 arquivos um a um (75 idas e voltas no 4G antes da tela ficar pronta). Versão nova = endereço novo. */
      const pediu = (req.query as Record<string, unknown> | undefined)?.v;
      if (rota !== '/sw.js' && rota !== '/manifest.webmanifest' && typeof pediu === 'string' && pediu === versao(arquivo)) {
        reply.header('cache-control', 'public, max-age=31536000, immutable').header('etag', `"${versao(arquivo)}"`);
        return reply.send(ler(arquivo));
      }
      // CSS e JS sem versão no endereço: o navegador confere a versão a cada uso (ETag) e só baixa de novo quando mudou.
      if (/^(text\/css|text\/javascript|application\/javascript)/.test(tipo)) {
        const etag = `"${versao(arquivo)}"`;
        reply.header('cache-control', 'no-cache').header('etag', etag);
        if (mesmaEtag(req.headers['if-none-match'], etag)) return reply.code(304).send();
      }
      return reply.send(ler(arquivo));
    });
  }

  /* rotas-fontes: endereços do app (/app/conversas, /app/pipelines/<id>, /app/analises/vendas…) servem o mesmo app.html;
     quem abre o app escolhe a tela pelo endereço (public/telas/rotas.js). Sem login: /entrar?volta=<endereço> e, ao entrar, volta. */
  app.get('/app/*', async (req, reply) => {
    if (auth) {
      const u = await usuarioDaRequisicao(req, auth);
      if (!u) {
        const volta = voltaSegura(req.url);
        return reply.redirect(volta ? `/entrar?volta=${encodeURIComponent(volta)}` : '/entrar');
      }
    }
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store, max-age=0')
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'strict-origin-when-cross-origin')
      .header('x-frame-options', 'DENY')
      .send(comVersoes('app.html'));
  });

  // Página de atualização: guardada pelo service worker (public/sw.js) e mostrada quando o servidor está reiniciando.
  // Precisa ser autossuficiente, então o script da tela entra aqui dentro.
  let paginaAtualizando: Buffer | null = null;
  app.get('/atualizando.html', async (_req, reply) => {
    if (!paginaAtualizando) {
      const js = ler('telas/atualizando.js').toString('utf8').replace(/<\/script/gi, '<\\/script');
      paginaAtualizando = Buffer.from(ler('atualizando.html').toString('utf8').replace('<script data-embutir="/telas/atualizando.js"></script>', () => `<script>\n${js}</script>`), 'utf8');
    }
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('x-content-type-options', 'nosniff')
      .header('x-robots-tag', 'noindex')
      .send(paginaAtualizando);
  });

  // Endereço que não existe: página 404 da Sintonia para quem navega; JSON para a API, webhooks e chamadas do app.
  app.setNotFoundHandler(async (req, reply) => {
    const caminho = req.url.split('?')[0]!;
    const html = (req.method === 'GET' || req.method === 'HEAD') && !/^\/(api|webhooks)(\/|$)/.test(caminho) && String(req.headers.accept ?? '').includes('text/html');
    if (!html) return reply.code(404).send({ erro: 'Endereço não encontrado.', statusCode: 404 });
    return reply
      .code(404)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store, max-age=0')
      .header('x-content-type-options', 'nosniff')
      .header('x-robots-tag', 'noindex')
      .send(ler('404.html'));
  });

  // Painel da sala comercial na TV: público, sem login. A página só mostra algo se o token valer
  // (os números vêm de /tv/:token/dados, em src/comercial/rotas.ts).
  app.get('/tv/:token', async (_req, reply) =>
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store, max-age=0')
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(ler('tv.html')),
  );
}

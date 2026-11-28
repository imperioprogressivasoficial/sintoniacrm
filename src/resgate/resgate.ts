import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ehGestor, podeVer } from '../auth/acesso.js';
import type { EvolutionAdmin } from '../channels/evolution-admin.js';
import { lerWebhookEvolution } from '../channels/evolution.js';
import type { MensagemRecebida } from '../channels/tipos.js';
import type { Repositorio } from '../store/repositorio.js';

/**
 * "Resgatar mensagens" (pedido do dono 20/11): quando alguma mensagem do WhatsApp não apareceu na Sintonia,
 * busca de novo na Evolution o que está guardado lá e grava só o que falta (o id externo evita duplicar).
 * - POST /api/conversas/:id/resgatar  — uma conversa (quem vê a conversa pode pedir).
 * - POST /api/whatsapp/sincronizar     — todas as conversas recentes de todos os números (uma rodada por vez, por trás).
 * - GET  /api/whatsapp/sincronizar     — como está a rodada (a tela acompanha).
 * Entra como histórico: sem IA respondendo, sem avisos, sem automações (importarHistorico).
 * atendimento-extra: fotos, áudios, vídeos, documentos e figurinhas vêm junto (baixados por trás, como os do webhook);
 * mensagem que já estava só como texto ganha o arquivo, se a Evolution ainda tiver.
 */
export interface OpcoesResgate {
  repo: Repositorio;
  admin: () => EvolutionAdmin | undefined;
  canais: () => string[];
  importar: (m: MensagemRecebida[]) => Promise<{ conversas: number; mensagens: number; midias?: number }>;
  /** contato-nome: no fim da sincronização (ex.: puxar o nome dos contatos). Falha só vai para o log. */
  depois?: () => Promise<unknown>;
  log?: (msg: string, extra?: string) => void;
  /** puxar-historico: "Sincronizar" busca TUDO o que a Evolution guardou do número (não só as recentes). */
  puxarTudo?: (canal: string) => Promise<{ lidas: number; novas: number; erro?: string }>;
}

interface Rodada { rodando: boolean; inicio: Date | null; fim: Date | null; conversas: number; mensagens: number; midias: number; erro: string | null; numeros: number; feitos: number }

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

export function registrarResgate(app: FastifyInstance, o: OpcoesResgate): { sincronizarTudo: () => Promise<void>; estado: () => Rodada } {
  const rodada: Rodada = { rodando: false, inicio: null, fim: null, conversas: 0, mensagens: 0, midias: 0, erro: null, numeros: 0, feitos: 0 };

  async function sincronizarTudo(): Promise<void> {
    const adm = o.admin();
    if (!adm) throw erro('O WhatsApp não oficial não está configurado em Conexões.', 409);
    const canais = o.canais();
    if (!canais.length) throw erro('Nenhum WhatsApp conectado.', 409);
    Object.assign(rodada, { rodando: true, inicio: new Date(), fim: null, conversas: 0, mensagens: 0, midias: 0, erro: null, numeros: canais.length, feitos: 0 });
    try {
      for (const canal of canais) {
        try {
          if (o.puxarTudo) {
            const t = await o.puxarTudo(canal);
            if (t.erro) throw new Error(t.erro);
            rodada.mensagens += t.novas;
            rodada.feitos++;
            continue;
          }
          const brutas = await adm.historico(canal, { conversas: 300, porConversa: 40 });
          const r = await o.importar(lerWebhookEvolution({ event: 'messages.upsert', instance: canal, data: brutas }));
          rodada.mensagens += r.mensagens; rodada.conversas += r.conversas; rodada.midias += r.midias ?? 0;
        } catch (e) {
          rodada.erro = 'Não deu para ler um dos números agora. Confira se o WhatsApp está conectado em Conexões.';
          o.log?.('Resgate: falha ao sincronizar um número', String(e));
        }
        rodada.feitos++;
      }
      if (o.depois) await o.depois().catch((e) => o.log?.('Resgate: falha ao puxar os nomes dos contatos', String(e)));
    } finally {
      rodada.rodando = false; rodada.fim = new Date();
    }
  }

  const conversaDe = async (req: FastifyRequest) => {
    const id = (req.params as { id: string }).id;
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await o.repo.buscarConversa(id) : undefined;
    if (!c || (req.usuario && (c.empresaId !== req.usuario.empresaId || !podeVer(req.usuario, c)))) throw erro('Conversa não encontrada.', 404);
    return c;
  };

  app.post('/api/conversas/:id/resgatar', async (req) => {
    const c = await conversaDe(req);
    const adm = o.admin();
    if (!adm || !o.canais().includes(c.canalId)) throw erro('Esta conversa não é de um WhatsApp que a Sintonia consegue consultar.', 409);
    let brutas: unknown[];
    try { brutas = await adm.mensagensDoContato(c.canalId, c.telefone, 200); }
    catch (e) { o.log?.('Resgate: falha ao buscar uma conversa', String(e)); throw erro('Não deu para falar com o WhatsApp agora. Confira se ele está conectado em Conexões.', 502); }
    const lidas = lerWebhookEvolution({ event: 'messages.upsert', instance: c.canalId, data: brutas });
    const r = await o.importar(lidas);
    return { encontradas: lidas.length, novas: r.mensagens, midias: r.midias ?? 0 };
  });

  app.post('/api/whatsapp/sincronizar', async (req) => {
    // auditoria 26/11: buscar o histórico de todos os números pesa na Evolution e no banco: só a gestão.
    if (req.usuario && !ehGestor(req.usuario)) throw erro('Só a gestão pode sincronizar o WhatsApp. Para uma conversa, use "Resgatar do WhatsApp".', 403);
    if (rodada.rodando) return { ...rodada, jaRodando: true };
    if (!o.admin()) throw erro('O WhatsApp não oficial não está configurado em Conexões.', 409);
    if (!o.canais().length) throw erro('Nenhum WhatsApp conectado.', 409);
    sincronizarTudo().catch((e) => { rodada.rodando = false; rodada.erro = String((e as Error).message ?? e); });
    return { ...rodada, jaRodando: false };
  });

  app.get('/api/whatsapp/sincronizar', async () => rodada);

  return { sincronizarTudo, estado: () => rodada };
}

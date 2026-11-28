import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pode } from '../auth/permissoes.js';
import type { Funis } from './funis.js';
import { ErroRegrasFunil, type RegrasFunil } from './regras-funil.js';

/**
 * funil-atendimento: regras automáticas do funil "Atendimento" (Pipeline › Regras automáticas).
 * - GET /api/funis/regras: quem está logado (a tela mostra só para ler quem não pode mudar); traz as etapas do funil
 *   do sistema (nome, cor e chave) para a tela escrever "→ Agendado Sumaré / Agendado Norte".
 * - PUT /api/funis/regras: a gestão que mexe nos funis (permissão "funis_editar"). Pode mandar só a regra que mudou.
 */
export function registrarRegrasFunil(app: FastifyInstance, o: { regras: RegrasFunil; funis: Funis }): void {
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const etapas = async () => {
    const f = await o.funis.garantirSistema();
    return { funilId: f.id, etapas: (await o.funis.etapas(f.id)).map((e) => ({ id: e.id, nome: e.nome, cor: e.cor, chave: e.chaveSistema, unidade: e.unidade ?? null })) };
  };
  app.get('/api/funis/regras', async (req) => ({ ...(await o.regras.paraTela()), ...(await etapas()), podeEditar: !req.usuario || pode(req, 'funis_editar') }));
  app.put('/api/funis/regras', async (req, reply) => {
    if (req.usuario && !pode(req, 'funis_editar')) return reply.code(403).send({ erro: 'Só a gestão muda as regras automáticas do funil.' });
    try {
      return { ...(await o.regras.salvar(req.body, quem(req))), ...(await etapas()), podeEditar: true };
    } catch (e) {
      if (e instanceof ErroRegrasFunil) return reply.code(e.statusCode).send({ erro: e.message });
      throw e;
    }
  });
}

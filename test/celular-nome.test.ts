import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import { bahia } from '../src/util/tempo.js';
import { fabricas } from './repos.js';

/* Dono 21/11: mensagem mandada pelo WhatsApp do celular nunca aparece como "celular da loja": vai o nome da dona,
   ou de quem respondeu por último pela Sintonia (12 h), ou "Equipe". */
class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  n = 0;
  lerWebhook() { return []; }
  async enviarTexto() { return { idExterno: `out-${++this.n}` }; }
}
const agente = { async executar(_p: PedidoAgente): Promise<RespostaAgente> { return { texto: 'ok', acoes: [], recusou: false }; } };
const tarde = bahia(2026, 11, 5, 15, 0);
let seq = 0;
const msg = (deMim: boolean, texto: string, em: Date): MensagemRecebida => ({ canalId: 'c', telefone: '5571988124471', nome: 'Marina', texto, deMim, idExterno: `e-${++seq}`, em });

describe.each(fabricas)('quem mandou pelo celular ($nome)', (f) => {
  async function montar() {
    const repo = await f.criar();
    const s = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'c', unidade: 'norte', canal: new CanalFalso() }], agente, agora: () => tarde });
    await s.receber(msg(false, 'oi', tarde));
    const [c] = await repo.listarConversas();
    await s.mudarModo(c!.id, 'humano');
    return { s, repo, id: c!.id };
  }
  const daEquipe = async (repo: Awaited<ReturnType<(typeof f)['criar']>>, id: string) => (await repo.mensagens(id, 50)).filter((m) => m.autor === 'equipe').map((m) => m.autorNome);

  it('sem dona e sem ninguém antes: "Equipe"', async () => {
    const { s, repo, id } = await montar();
    await s.receber(msg(true, 'mandei pelo celular', new Date(tarde.getTime() + 60_000)));
    expect(await daEquipe(repo, id)).toEqual(['Equipe']);
  });
  it('com dona: o nome da dona', async () => {
    const { s, repo, id } = await montar();
    await s.definirResponsavel(id, { id: '00000000-0000-4000-8000-0000000000c1', nome: 'Carla' }, { id: '00000000-0000-4000-8000-0000000000a1', nome: 'Bruno' }, 'transferiu');
    await s.receber(msg(true, 'mandei pelo celular', new Date(tarde.getTime() + 60_000)));
    expect((await daEquipe(repo, id)).at(-1)).toBe('Carla');
  });
  it('sem dona: quem respondeu por último pela Sintonia', async () => {
    const { s, repo, id } = await montar();
    await s.equipeEnviou(id, 'oi, aqui é a Jéssica', 'Jéssica');
    await s.definirResponsavel(id, null, { id: '00000000-0000-4000-8000-0000000000a1', nome: 'Bruno' }, 'liberou').catch(() => {});
    await s.receber(msg(true, 'continuei pelo celular', new Date(tarde.getTime() + 120_000)));
    const nomes = await daEquipe(repo, id);
    expect(nomes.at(-1)).toMatch(/Jéssica|Equipe/);
    expect(nomes).not.toContain('celular da loja');
  });
});

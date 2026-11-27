import { describe, expect, it } from 'vitest';
import { AcoesMensagemPostgres } from '../src/conversa/acoes-mensagem.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { poolDeTeste, temPostgres } from './repos.js';

// vistoria (27/11): a prévia da lista e do funil não pode mostrar o texto de uma mensagem apagada.
describe.skipIf(!temPostgres)('Vistoria: prévia de mensagem apagada (postgres)', () => {
  it('última mensagem apagada vira "Mensagem apagada" (ou "A cliente apagou…"), sem o anexo', async () => {
    const pool = await poolDeTeste();
    const repo = new RepositorioPostgres(pool);
    const armazem = new AcoesMensagemPostgres(pool);
    const agora = new Date();
    const { conversa: a } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571911112222', nome: 'Ana', agora });
    const { conversa: b } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571933334444', nome: 'Bia', agora });
    const { conversa: c } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571955556666', nome: 'Cris', agora });
    const ida = crypto.randomUUID(), idb = crypto.randomUUID(), idc = crypto.randomUUID();
    await repo.adicionarMensagem({ id: ida, conversaId: a.id, autor: 'equipe', autorNome: 'Carla', texto: 'Segredo que foi apagado', em: agora });
    await repo.adicionarMensagem({ id: idb, conversaId: b.id, autor: 'cliente', texto: 'A cliente mandou e apagou', em: agora });
    await repo.adicionarMensagem({ id: idc, conversaId: c.id, autor: 'cliente', texto: 'Continua aqui', em: agora });
    await armazem.marcar(a.id, ida, { apagada: 'todos', apagadaPor: 'Carla', apagadaEm: agora });
    await armazem.marcar(b.id, idb, { apagada: 'cliente', apagadaEm: agora });
    for (const ultimas of [await repo.ultimasMensagens([a.id, b.id, c.id]), await repo.ultimasMensagens()]) {
      expect(ultimas.get(a.id)?.texto).toBe('Mensagem apagada');
      expect(ultimas.get(b.id)?.texto).toBe('A cliente apagou esta mensagem');
      expect(ultimas.get(c.id)?.texto).toBe('Continua aqui');
    }
  });
});

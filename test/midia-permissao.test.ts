import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

describe('Mídia respeita quem vê a conversa', () => {
  it('atendente do Norte não abre nem envia arquivo numa conversa do Sumaré', async () => {
    const contas = new ContasMemoria();
    const senhaHash = await gerarHash('Imperio2026xyz');
    await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
    await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bia', email: 'bia@imperio.com', papel: 'atendente', unidades: ['sumare'], senhaHash });
    const repo = new RepositorioMemoria();
    const canal = new CanalTeste();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'teste-sumare', unidade: 'sumare', canal }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'teste-sumare', telefone: '5599000000001', nome: 'Cliente', agora: new Date() });
    const app = criarServidor({ sintonia, repo, auth: { contas } });
    const entrar = async (email: string) =>
      String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
    const foto = { base64: Buffer.from([0xff, 0xd8, 0xff, 1]).toString('base64'), mimetype: 'image/jpeg' };

    const carla = await entrar('carla@imperio.com');
    expect((await app.inject({ url: `/api/conversas/${conversa.id}/midias/${randomUUID()}`, headers: { cookie: carla } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/enviar-midia`, headers: { cookie: carla }, payload: foto })).statusCode).toBe(404);
    expect(await repo.mensagens(conversa.id)).toHaveLength(0);

    const bia = await entrar('bia@imperio.com');
    const ok = await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/enviar-midia`, headers: { cookie: bia }, payload: foto });
    expect(ok.statusCode).toBe(200);
    const [m] = await repo.mensagens(conversa.id);
    expect(m).toMatchObject({ autor: 'equipe', autorNome: 'Bia' });
    expect((await repo.buscarConversa(conversa.id))?.responsavelId).toBeTruthy(); // primeira resposta: Bia vira a dona
  });
});

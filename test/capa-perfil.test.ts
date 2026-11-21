import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { ArmazemPerfisMemoria, ArmazemPerfisPostgres, ATALHOS_PADRAO, CAPA_PADRAO, LIMITE_CAPA, MAX_ATALHOS, Preferencias, registrarConta, type ArmazemPerfis } from '../src/conta/conta.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

/* capa-perfil: capa (5 fotos prontas, só a cor ou a foto da pessoa) e atalhos de Configurações, guardados por pessoa. */

const SENHA = 'Imperio2026xyz';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b00000000049454e44ae426082', 'hex');
/** Cabeçalho WebP de verdade (RIFF....WEBP) com um pedaço qualquer depois: basta para a conferência dos primeiros bytes. */
const webp = (tamanho = 64) => {
  const b = Buffer.alloc(tamanho, 7);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(tamanho - 8, 4);
  b.write('WEBPVP8 ', 8, 'ascii');
  return b;
};

interface Ambiente {
  nome: string;
  criar(): Promise<{ contas: Contas; perfis: ArmazemPerfis }>;
}
const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ contas: new ContasMemoria(), perfis: new ArmazemPerfisMemoria() }) },
  ...(temPostgres
    ? [{ nome: 'postgres', criar: async () => { const pool = await poolDeTeste(); return { contas: new ContasPostgres(pool), perfis: new ArmazemPerfisPostgres(pool) }; } }]
    : []),
];

async function montar(a: Ambiente) {
  const { contas, perfis } = await a.criar();
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const hash = await gerarHash(SENHA);
  const criar = (nome: string, email: string, papel: 'admin' | 'atendente') => contas.criarUsuario({ empresaId: 'imperio', nome, email, papel, unidades: [], senhaHash: hash });
  await criar('Bruno Batista', 'bruno@imperio.com', 'admin');
  await criar('Ana Souza', 'ana@imperio.com', 'admin');
  await criar('Carla Lima', 'carla@imperio.com', 'atendente');
  const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => new Date(), duracaoHoras: 12 } });
  registrarConta(app, { contas, perfis });
  const cookies = new Map<string, string>();
  const cookie = async (email: string) => {
    if (!cookies.has(email)) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: SENHA } });
      cookies.set(email, String(r.headers['set-cookie']).split(';')[0]!);
    }
    return cookies.get(email)!;
  };
  const como = async (email: string, method: 'GET' | 'PATCH' | 'PUT' | 'DELETE' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: await cookie(email) }, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { app, contas, perfis, como };
}

describe('capa-perfil: valores de sempre', () => {
  it('sem nada guardado: capa Montanha e os 4 atalhos (Agenda, Respostas, Rotina, Serena)', () => {
    const p = Preferencias.parse({});
    expect(p.capa).toBe('montanha');
    expect(CAPA_PADRAO).toBe('montanha');
    expect(p.atalhos).toEqual(['atendimento:agenda', 'atendimento:respostas-rapidas', 'atendimento:rotina', 'aba:serena']);
    expect(p.atalhos).toEqual(ATALHOS_PADRAO);
  });
  it('valor estragado no banco volta ao padrão sem quebrar o resto', () => {
    const p = Preferencias.parse({ tema: 'escuro', capa: 'lua', atalhos: 'agenda' });
    expect(p).toMatchObject({ tema: 'escuro', capa: 'montanha', atalhos: ATALHOS_PADRAO });
  });
});

for (const a of ambientes) {
  describe(`capa-perfil (${a.nome})`, () => {
    it('cada pessoa tem os seus atalhos: escolhe, muda a ordem, tira e fica guardado', async () => {
      const m = await montar(a);
      const c0 = (await m.como('carla@imperio.com', 'GET', '/api/conta')).json();
      expect(c0.preferencias).toMatchObject({ capa: 'montanha', atalhos: ATALHOS_PADRAO });
      expect(c0.capaEm).toBeNull();

      const novos = ['aba:conversas', 'atendimento:ligacoes', 'aba:serena', 'atendimento:agenda'];
      const r1 = await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { atalhos: novos } });
      expect(r1.statusCode).toBe(200);
      expect(r1.json().preferencias.atalhos).toEqual(novos);
      // outra ordem
      const r2 = await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { atalhos: [...novos].reverse() } });
      expect(r2.json().preferencias.atalhos).toEqual([...novos].reverse());
      // repetido entra uma vez só
      const r3 = await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { atalhos: ['aba:serena', 'aba:serena', 'conta:aparencia'] } });
      expect(r3.json().preferencias.atalhos).toEqual(['aba:serena', 'conta:aparencia']);
      // mudar o tema não mexe nos atalhos
      await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { tema: 'escuro' } });
      expect((await m.como('carla@imperio.com', 'GET', '/api/conta')).json().preferencias).toMatchObject({ tema: 'escuro', atalhos: ['aba:serena', 'conta:aparencia'] });
      // tirar todos vale
      expect((await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { atalhos: [] } })).json().preferencias.atalhos).toEqual([]);
      // o Bruno continua com os de sempre
      expect((await m.como('bruno@imperio.com', 'GET', '/api/conta')).json().preferencias.atalhos).toEqual(ATALHOS_PADRAO);
    });

    it(`no máximo ${MAX_ATALHOS} atalhos e só códigos válidos`, async () => {
      const m = await montar(a);
      const oito = Array.from({ length: 8 }, (_, i) => `empresa:item-${i}`);
      expect((await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { atalhos: oito } })).json().preferencias.atalhos).toEqual(oito);
      const nove = await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { atalhos: [...oito, 'aba:serena'] } });
      expect(nove.statusCode).toBe(400);
      expect(nove.json().erro).toMatch(/até 8 atalhos/);
      for (const ruim of ['<script>', 'Aba:Serena', 'aba serena', '', 'a'.repeat(61), 42]) {
        expect((await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { atalhos: [ruim] } })).statusCode).toBe(400);
      }
      // nada mudou com os pedidos recusados
      expect((await m.como('carla@imperio.com', 'GET', '/api/conta')).json().preferencias.atalhos).toEqual(oito);
    });

    it('escolhe uma das 5 capas prontas ou "sem foto"; outra coisa é recusada', async () => {
      const m = await montar(a);
      for (const capa of ['praia', 'montanha', 'por-do-sol', 'floresta', 'cidade', 'nenhuma']) {
        const r = await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { capa } });
        expect(r.statusCode).toBe(200);
        expect(r.json().preferencias.capa).toBe(capa);
      }
      expect((await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { capa: 'lua' } })).statusCode).toBe(400);
      // "minha" só depois de mandar a foto
      const semFoto = await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { capa: 'minha' } });
      expect(semFoto.statusCode).toBe(400);
      expect(semFoto.json().erro).toMatch(/Envie a sua foto de capa/);
      expect((await m.como('bruno@imperio.com', 'GET', '/api/conta')).json().preferencias.capa).toBe('montanha');
    });

    it('manda a própria foto de capa: confere tipo, tamanho e os primeiros bytes; só a pessoa vê a dela', async () => {
      const m = await montar(a);
      const foto = webp(2048);
      const r = await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: foto.toString('base64'), mimetype: 'image/webp' });
      expect(r.statusCode).toBe(200);
      expect(r.json().preferencias.capa).toBe('minha');
      expect(typeof r.json().capaEm).toBe('number');

      const g = await m.como('carla@imperio.com', 'GET', '/api/conta/capa');
      expect(g.statusCode).toBe(200);
      expect(g.headers['content-type']).toMatch(/image\/webp/);
      expect(Buffer.from(g.rawPayload).equals(foto)).toBe(true);
      // o Bruno não tem capa própria: a rota mostra só a de quem está logado
      expect((await m.como('bruno@imperio.com', 'GET', '/api/conta/capa')).statusCode).toBe(204);
      expect((await m.app.inject({ url: '/api/conta/capa' })).statusCode).toBe(401);

      // trocar para uma pronta e voltar para a minha
      await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { capa: 'praia' } });
      expect((await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { capa: 'minha' } })).json().preferencias.capa).toBe('minha');

      // PNG (com o prefixo data:) também vale
      const png = await m.como('ana@imperio.com', 'PUT', '/api/conta/capa', { base64: `data:image/png;base64,${PNG.toString('base64')}`, mimetype: 'image/png' });
      expect(png.statusCode).toBe(200);
    });

    it('recusa capa que não é imagem, tipo não aceito ou grande demais', async () => {
      const m = await montar(a);
      const finge = await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: Buffer.from('<html>oi</html> não sou foto').toString('base64'), mimetype: 'image/jpeg' });
      expect(finge.statusCode).toBe(400);
      expect(finge.json().erro).toMatch(/não é uma imagem válida/);
      // PNG dizendo que é WebP
      expect((await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: PNG.toString('base64'), mimetype: 'image/webp' })).statusCode).toBe(400);
      expect((await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: webp().toString('base64'), mimetype: 'image/gif' })).statusCode).toBe(400);
      expect((await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { mimetype: 'image/webp' })).statusCode).toBe(400);
      const grande = await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: webp(LIMITE_CAPA + 1024).toString('base64'), mimetype: 'image/webp' });
      expect(grande.statusCode).toBe(413);
      expect(grande.json().erro).toMatch(/400 KB/);
      // nada foi guardado
      expect((await m.como('carla@imperio.com', 'GET', '/api/conta/capa')).statusCode).toBe(204);
      expect((await m.como('carla@imperio.com', 'GET', '/api/conta')).json()).toMatchObject({ capaEm: null, preferencias: { capa: 'montanha' } });
    });

    it('apagar a foto de capa volta para a capa de sempre; excluir a conta apaga a capa', async () => {
      const m = await montar(a);
      await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: webp().toString('base64'), mimetype: 'image/webp' });
      const d = await m.como('carla@imperio.com', 'DELETE', '/api/conta/capa');
      expect(d.statusCode).toBe(200);
      expect(d.json()).toMatchObject({ capaEm: null, preferencias: { capa: 'montanha' } });
      expect((await m.como('carla@imperio.com', 'GET', '/api/conta/capa')).statusCode).toBe(204);

      // apagar com uma capa pronta escolhida não muda a escolha
      await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: webp().toString('base64'), mimetype: 'image/webp' });
      await m.como('carla@imperio.com', 'PATCH', '/api/conta', { preferencias: { capa: 'floresta' } });
      expect((await m.como('carla@imperio.com', 'DELETE', '/api/conta/capa')).json().preferencias.capa).toBe('floresta');

      await m.como('carla@imperio.com', 'PUT', '/api/conta/capa', { base64: webp().toString('base64'), mimetype: 'image/webp' });
      const carla = (await m.contas.listarUsuarios('imperio')).find((u) => u.email === 'carla@imperio.com')!;
      expect(await m.perfis.capaDe(carla.id)).toBeTruthy();
      expect((await m.como('carla@imperio.com', 'POST', '/api/conta/excluir', { confirmacao: 'EXCLUIR' })).statusCode).toBe(200);
      expect(await m.perfis.capaDe(carla.id)).toBeUndefined();
      expect((await m.perfis.ler(carla.id)).preferencias).toMatchObject({ capa: 'montanha', atalhos: ATALHOS_PADRAO });
    });
  });
}

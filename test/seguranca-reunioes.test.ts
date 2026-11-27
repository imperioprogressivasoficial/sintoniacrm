import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasPostgres, type Papel, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { poolDeTeste, temPostgres } from './repos.js';

/**
 * seguranca-abertura: links de agendamento online e reuniões não têm unidade. Antes, qualquer atendente via o nome,
 * o WhatsApp e o e-mail de todas as reuniões da empresa (de qualquer unidade) e podia mudar, apagar ou cancelar os
 * links e as reuniões de outra pessoa.
 */
const SENHA = 'Imperio2026xyz';

async function montar() {
  const pool = await poolDeTeste();
  await pool.query('delete from sintonia.reunioes; delete from sintonia.links_reuniao; delete from sintonia.scripts_venda');
  const repo = new RepositorioPostgres(pool);
  const contas = new ContasPostgres(pool);
  const canal: CanalWhatsApp = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: `out-${Math.random()}` }) };
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal },
    ],
    agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) },
  });
  const app = criarServidor({ sintonia, repo, auth: { contas }, poolReunioes: pool });
  const h = await gerarHash(SENHA);
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.toLowerCase()}@reuniao.com`, papel, unidades, senhaHash: h });
  const gente = { ana: await pessoa('Ana', 'atendente', ['sumare']), carla: await pessoa('Carla', 'atendente', ['norte']), gil: await pessoa('Gil', 'gerente', ['norte']), bruno: await pessoa('Bruno', 'admin', []) };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => {
    if (!cookies.has(u.id)) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: u.email, senha: SENHA } });
      cookies.set(u.id, String(r.headers['set-cookie']).split(';')[0]!);
    }
    return app.inject({ method, url, headers: { cookie: cookies.get(u.id)! }, ...(payload ? { payload } : {}) });
  };
  let n = 0;
  const conversa = async (unidade: 'norte' | 'sumare', nome: string) => {
    const telefone = `55719877700${++n}`;
    await sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome, texto: 'Oi', deMim: false, idExterno: `in-${n}-${Math.random()}`, em: new Date() });
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const LINK = { titulo: 'Avaliação', duracao_min: 30, dias: [0, 1, 2, 3, 4, 5, 6], inicio: '09:00', fim: '18:00' };
  const reuniao = async (linkId: string, nome: string, conversaId: string | null) => {
    const id = randomUUID();
    const inicio = new Date(Date.now() + 2 * 86400_000 + n++ * 3600_000);
    await pool.query(
      `insert into sintonia.reunioes (id, link_id, empresa_id, nome, telefone, email, observacao, inicio, fim, codigo_cancelar, criado_em, conversa_id)
       values ($1,$2,'imperio',$3,'71999990000',$4,'',$5,$6,$7,now(),$8)`,
      [id, linkId, nome, `${nome.toLowerCase()}@cliente.com`, inicio, new Date(inicio.getTime() + 1800_000), randomUUID().replace(/-/g, ''), conversaId],
    );
    return id;
  };
  return { app, como, gente, conversa, LINK, reuniao, pool };
}

describe.skipIf(!temPostgres)('Reuniões: atendente só vê e mexe no que é dela (postgres)', () => {
  it('atendente não vê nem mexe em link e reunião de outra pessoa/unidade; vê os dela e os de conversas que ela atende', async () => {
    const { como, gente, conversa, LINK, reuniao } = await montar();
    const linkCarla = (await como(gente.carla, 'POST', '/api/reunioes/links', LINK)).json().id as string;
    const linkAna = (await como(gente.ana, 'POST', '/api/reunioes/links', { ...LINK, titulo: 'Da Ana' })).json().id as string;
    const norte = await conversa('norte', 'Cliente Norte');
    const sumare = await conversa('sumare', 'Cliente Sumaré');
    const rNorte = await reuniao(linkCarla, 'Norteira', norte.id);
    await reuniao(linkCarla, 'Sumareira', sumare.id); // link da Carla, mas a conversa é da Sumaré (sem dona): a Ana vê
    const rAna = await reuniao(linkAna, 'Daana', null);

    const daAna = (await como(gente.ana, 'GET', '/api/reunioes')).json();
    expect(daAna.links.map((l: { id: string }) => l.id)).toEqual([linkAna]);
    expect(daAna.proximas.map((r: { nome: string }) => r.nome).sort()).toEqual(['Daana', 'Sumareira']);
    expect(JSON.stringify(daAna)).not.toMatch(/norteira/i);
    const de = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const agendaAna = (await como(gente.ana, 'GET', `/api/reunioes/agenda?de=${de}&dias=14`)).json();
    expect(agendaAna.itens.map((i: { cliente: string }) => i.cliente).sort()).toEqual(['Daana', 'Sumareira']);

    // Mudar, apagar ou cancelar o que não é dela: 404 (e nada muda).
    expect((await como(gente.ana, 'PUT', `/api/reunioes/links/${linkCarla}`, { ...LINK, ativo: false })).statusCode).toBe(404);
    expect((await como(gente.ana, 'DELETE', `/api/reunioes/links/${linkCarla}`)).statusCode).toBe(404);
    expect((await como(gente.ana, 'POST', `/api/reunioes/${rNorte}/cancelar`)).statusCode).toBe(404);
    const daCarla = (await como(gente.carla, 'GET', '/api/reunioes')).json();
    expect(daCarla.links).toHaveLength(1);
    expect(daCarla.links[0].ativo).toBe(true);
    expect(daCarla.proximas.find((r: { nome: string }) => r.nome === 'Norteira')).toMatchObject({ status: 'marcada' });

    // No que é dela, funciona.
    expect((await como(gente.ana, 'PUT', `/api/reunioes/links/${linkAna}`, { ...LINK, titulo: 'Da Ana 2' })).statusCode).toBe(200);
    expect((await como(gente.ana, 'POST', `/api/reunioes/${rAna}/cancelar`)).statusCode).toBe(200);

    // A gestão continua vendo e cuidando de tudo.
    const doBruno = (await como(gente.bruno, 'GET', '/api/reunioes')).json();
    expect(doBruno.links).toHaveLength(2);
    expect(doBruno.proximas.map((r: { nome: string }) => r.nome).sort()).toEqual(['Daana', 'Norteira', 'Sumareira']);
    expect((await como(gente.bruno, 'POST', `/api/reunioes/${rNorte}/cancelar`)).statusCode).toBe(200);
    expect((await como(gente.ana, 'DELETE', `/api/reunioes/links/${linkAna}`)).statusCode).toBe(200);
  });
});

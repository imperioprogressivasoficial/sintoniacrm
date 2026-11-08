import { describe, expect, it } from 'vitest';
import type { ContasMemoria } from '../src/auth/contas.js';
import { ContatosMemoria, ContatosPostgres } from '../src/contatos/contatos.js';
import { RespostasMemoria, RespostasPostgres } from '../src/conversa/respostas.js';
import { ArmazemDemoMemoria, ArmazemDemoPostgres, type ArmazemDemo } from '../src/demo/armazem.js';
import { PREFIXO_TELEFONE_DEMO } from '../src/demo/dados.js';
import { Demo } from '../src/demo/demo.js';
import { registrarDemo } from '../src/demo/rotas.js';
import { ArmazemEmpresaMemoria, ArmazemEmpresaPostgres, Empresa } from '../src/empresa/empresa.js';
import { ArmazemNotificacoesMemoria, ArmazemNotificacoesPostgres } from '../src/notificacoes/armazem.js';
import { Notificador } from '../src/notificacoes/notificador.js';
import { fontePainelPara, montarPainel } from '../src/painel/painel.js';
import { agendamentosEntre } from '../src/agenda/agenda-dia.js';
import { quemLigar } from '../src/app/ligacoes.js';
import type { RepositorioMemoria } from '../src/store/repositorio.js';
import type { ArmazemTagsMemoria } from '../src/tags/tags.js';
import { DIA } from '../src/util/tempo.js';
import { ambientes, montarFunis } from './funis-ambiente.js';

/** JPEG mínimo (só a assinatura importa para a rota). */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');

async function montar(amb: (typeof ambientes)[number]) {
  let armazemMem: ArmazemDemoMemoria | undefined;
  const g = await montarFunis(amb, { ignorarParadas: (id) => armazemMem?.ehConversaDemo(id) ?? false });
  const pool = g.pool;
  const contatos = pool ? new ContatosPostgres(pool) : new ContatosMemoria();
  const respostas = pool ? new RespostasPostgres(pool) : new RespostasMemoria();
  const notificacoes = pool ? new ArmazemNotificacoesPostgres(pool) : new ArmazemNotificacoesMemoria();
  const empresa = new Empresa(pool ? new ArmazemEmpresaPostgres(pool) : new ArmazemEmpresaMemoria(), 'imperio', 'Império Progressivas', { cacheMs: 0, agora: () => g.relogio.t });
  const armazem: ArmazemDemo = pool
    ? new ArmazemDemoPostgres(pool)
    : new ArmazemDemoMemoria({ repo: g.repo as RepositorioMemoria, tags: g.armazemTags as ArmazemTagsMemoria, contatos: contatos as ContatosMemoria, contas: g.contas as ContasMemoria, notificacoes: notificacoes as ArmazemNotificacoesMemoria });
  if (armazem instanceof ArmazemDemoMemoria) armazemMem = armazem;
  const demo = new Demo({ empresaId: 'imperio', armazem, contas: g.contas, tags: g.tags, armazemTags: g.armazemTags, funis: g.funis, contatos, respostas, automacoes: g.automacoes, notificacoes, empresa, agora: () => g.relogio.t });
  registrarDemo(g.app, demo);
  return { ...g, demo, armazem, contatos, respostas, notificacoes, empresa };
}

const ehDemo = (t: string) => t.startsWith(PREFIXO_TELEFONE_DEMO);

for (const amb of ambientes) {
  describe(`dados de demonstração (${amb.nome})`, () => {
    it('preenche tudo, sem nada pendente para o motor, sem duplicar, e apaga só a demonstração', async () => {
      const g = await montar(amb);
      // Dados reais antes: uma conversa, uma tag "VIP" da empresa e uma automação de "conversa parada" ligada.
      const real = await g.conversa('norte', 'Maria Real', 'Oi, quanto tá a progressiva?');
      const vip = await g.tags.criar({ nome: 'VIP' }, 'Bruno');
      const parada = await g.automacoes.criar(
        { nome: 'Real: parada em Interessada', funilId: g.sistema.id, ligada: true, gatilho: { tipo: 'parada_na_etapa', etapaId: g.etapasSistema.get('interessada')!, horas: 1 }, passos: [{ tipo: 'enviar_mensagem', texto: 'Oi!', so_no_horario: false }] },
        'Bruno',
      );
      const enviadosAntes = g.enviados.length;

      const r1 = await g.como(g.gente.admin, 'POST', '/api/demo/popular');
      expect(r1.statusCode).toBe(200);
      const c1 = r1.json();
      expect(c1.conversas).toBeGreaterThanOrEqual(130);
      expect(c1.agendamentos.futuros).toBeGreaterThan(10);
      expect(c1.agendamentos.passados).toBeGreaterThan(10);
      expect(c1.tags.reaproveitadas).toBe(1); // a VIP real
      expect(c1.atendentes).toBe(4);
      expect(c1.automacoes).toBe(3);

      const conversas = await g.repo.listarConversas();
      const demos = conversas.filter((c) => ehDemo(c.telefone));
      expect(demos.length).toBe(c1.conversas);
      // Tudo pelo canal de teste.
      expect(demos.every((c) => c.canalId.startsWith('teste-'))).toBe(true);
      // Nada que a cliente esteja "esperando" nas últimas 25 h.
      for (const c of demos) {
        const cl = c.ultimaMensagemCliente?.getTime() ?? 0;
        const loja = Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
        if (cl > loja) expect(g.relogio.t.getTime() - cl).toBeGreaterThan(24 * 3600_000);
      }

      // Nada pendente: tarefas, execuções de automação, push.
      const automacoes = await g.automacoes.listar();
      const demoAutos = automacoes.filter((a) => a.criadaPor === 'Demonstração');
      expect(demoAutos.length).toBe(3);
      expect(demoAutos.every((a) => !a.ligada)).toBe(true);
      if (g.pool) {
        expect((await g.pool.query(`select count(*)::int as n from sintonia.tarefas t join sintonia.conversas c on c.id = t.conversa_id where not t.feita and c.telefone like '${PREFIXO_TELEFONE_DEMO}%'`)).rows[0].n).toBe(0);
        expect((await g.pool.query('select count(*)::int as n from sintonia.automacao_execucoes')).rows[0].n).toBe(0);
        expect((await g.pool.query('select count(*)::int as n from sintonia.notificacoes where entregue_em is null')).rows[0].n).toBe(0);
        expect((await g.pool.query('select count(*)::int as n from sintonia.entrada')).rows[0].n).toBe(0);
      } else {
        expect((g.repo as RepositorioMemoria).todasAsTarefas().filter((t) => !t.feita && demos.some((d) => d.id === t.conversaId)).length).toBe(0);
      }
      // O relógio roda (dois dias depois): o motor não age sobre a demonstração e nada sai pelo número real.
      g.avancar(60);
      await g.sintonia.tick();
      await g.tick();
      const notif = new Notificador({ armazem: g.notificacoes, contas: g.contas, repo: g.repo, empresaId: 'imperio', agora: () => g.relogio.t });
      await notif.tick();
      for (const u of await g.contas.listarUsuarios('imperio')) {
        const ls = await g.notificacoes.listar(u.id, g.relogio.t, 500);
        expect(ls.filter((n) => n.tipo === 'espera' && n.conversaId && demos.some((d) => d.id === n.conversaId) && n.titulo.endsWith('está esperando') && n.chave).length).toBe(0); // as da demonstração não têm chave; as do relógio, sim
      }
      expect(g.enviados.slice(enviadosAntes).filter((e) => ehDemo(e.telefone)).length).toBe(0);
      expect((await g.automacoes.execucoes(parada.id)).filter((e) => demos.some((d) => d.id === e.conversaId)).length).toBe(0);
      for (const a of demoAutos) expect((await g.automacoes.execucoes(a.id)).length).toBe(0);

      // As telas leem cheias: painel 30 dias, ranking das atendentes de demonstração, agenda futura, ligar hoje.
      const equipe = await g.contas.listarUsuarios('imperio');
      const painel = await montarPainel(fontePainelPara(g.repo), { periodo: '30d', agora: g.relogio.t, escopo: { empresaId: 'imperio' }, equipe });
      expect(painel.leads.total).toBeGreaterThan(100);
      expect(painel.agendamentos.ia).toBeGreaterThan(3);
      expect(painel.agendamentos.equipe).toBeGreaterThan(3);
      expect(painel.primeiraResposta.ia.n).toBeGreaterThan(5);
      expect(painel.primeiraResposta.equipe.n).toBeGreaterThan(5);
      expect(painel.ranking.filter((p) => p.respostas > 0).length).toBeGreaterThanOrEqual(4);
      const agenda = await agendamentosEntre(g.repo, g.relogio.t, new Date(g.relogio.t.getTime() + 11 * DIA), { empresaId: 'imperio' });
      expect(agenda.length).toBeGreaterThan(10);
      expect((await quemLigar(g.repo, g.relogio.t)).length).toBeGreaterThan(0);
      const rel = await g.como(g.gente.admin, 'GET', '/api/relatorios?periodo=30d');
      void rel; // (relatórios não estão montados neste ambiente)

      // Rodar de novo substitui (não duplica).
      const r2 = await g.como(g.gente.admin, 'POST', '/api/demo/popular');
      expect(r2.statusCode).toBe(200);
      expect(r2.json().substituiu).toBe(true);
      const depois = (await g.repo.listarConversas()).filter((c) => ehDemo(c.telefone));
      expect(depois.length).toBe(r2.json().conversas);
      expect((await g.contas.listarUsuarios('imperio')).filter((u) => u.email.endsWith('.demo@exemplo.com')).length).toBe(4);
      expect((await g.funis.listar()).filter((f) => f.nome.startsWith('Pós-venda')).length).toBe(1);
      expect((await g.tags.soltas()).filter((t) => t.nome === 'Progressiva').length).toBe(1);
      const est = (await g.como(g.gente.admin, 'GET', '/api/demo')).json();
      expect(est.existe).toBe(true);
      expect(est.porTipo.conversa).toBe(depois.length);
      expect((await g.contas.fotosDaEmpresa('imperio')).size).toBe(4);

      // Apagar: só a demonstração.
      const ap = await g.como(g.gente.admin, 'DELETE', '/api/demo');
      expect(ap.statusCode).toBe(200);
      expect(ap.json().conversas).toBe(depois.length);
      const sobrou = await g.repo.listarConversas();
      expect(sobrou.filter((c) => ehDemo(c.telefone)).length).toBe(0);
      expect(sobrou.map((c) => c.id)).toContain(real.id);
      expect((await g.repo.mensagens(real.id)).length).toBeGreaterThan(0);
      expect((await g.tags.soltas()).map((t) => t.id)).toContain(vip.id);
      expect((await g.tags.soltas()).filter((t) => t.criadaPor === 'Demonstração').length).toBe(0);
      expect((await g.funis.listar()).filter((f) => f.nome.startsWith('Pós-venda')).length).toBe(0);
      expect((await g.contas.listarUsuarios('imperio')).filter((u) => u.email.endsWith('.demo@exemplo.com')).length).toBe(0);
      expect((await g.contas.fotosDaEmpresa('imperio')).size).toBe(0);
      expect((await g.automacoes.listar()).map((a) => a.id)).toEqual([parada.id]);
      expect((await g.contatos.campos('imperio')).length).toBe(0);
      expect((await g.respostas.listar('imperio', null)).length).toBe(0);
      expect((await g.empresa.meta()).agendamentosMes).toBeNull();
      expect((await g.notificacoes.listar(g.gente.admin.id, g.relogio.t, 50)).length).toBe(0);
      const eventosReais = await g.repo.eventosEntre(new Date(0), new Date(8.64e15));
      expect(eventosReais.every((e) => !e.conversaId || e.conversaId === real.id)).toBe(true);
      expect(eventosReais.some((e) => e.conversaId === real.id)).toBe(true);
      expect((await g.como(g.gente.admin, 'GET', '/api/demo')).json().existe).toBe(false);
      if (g.pool) expect((await g.pool.query('select count(*)::int as n from sintonia.contatos')).rows[0].n).toBe(0);
    }, 60_000);

    it('só administração e direção mexem na demonstração', async () => {
      const g = await montar(amb);
      for (const u of [g.gente.carla, g.gente.rita, g.gente.gerenteNorte]) {
        expect((await g.como(u, 'GET', '/api/demo')).statusCode).toBe(403);
        expect((await g.como(u, 'POST', '/api/demo/popular')).statusCode).toBe(403);
        expect((await g.como(u, 'DELETE', '/api/demo')).statusCode).toBe(403);
      }
      expect((await g.app.inject({ method: 'GET', url: '/api/demo' })).statusCode).toBe(401);
      expect((await g.repo.listarConversas()).length).toBe(0);
    });

    it('foto da equipe: a própria pessoa e a gestão trocam; todos da empresa veem; sem foto, 204', async () => {
      const g = await montar(amb);
      const { carla, bia, gerenteNorte, rita, admin } = g.gente;
      expect((await g.como(bia, 'GET', `/api/equipe/${carla.id}/foto`)).statusCode).toBe(204);
      expect((await g.como(carla, 'PUT', `/api/equipe/${carla.id}/foto`, { base64: JPEG, mimetype: 'image/jpeg' })).statusCode).toBe(200);
      const foto = await g.como(rita, 'GET', `/api/equipe/${carla.id}/foto`);
      expect(foto.statusCode).toBe(200);
      expect(foto.headers['content-type']).toContain('image/jpeg');
      expect(foto.headers['cache-control']).toContain('max-age');
      expect(Object.keys((await g.como(bia, 'GET', '/api/equipe/fotos')).json().fotos)).toEqual([carla.id]);
      // Outra atendente não troca a foto de ninguém; a gerência da unidade troca.
      expect((await g.como(bia, 'PUT', `/api/equipe/${carla.id}/foto`, { base64: JPEG, mimetype: 'image/jpeg' })).statusCode).toBe(403);
      expect((await g.como(rita, 'DELETE', `/api/equipe/${carla.id}/foto`)).statusCode).toBe(403);
      expect((await g.como(gerenteNorte, 'PUT', `/api/equipe/${bia.id}/foto`, { base64: JPEG, mimetype: 'image/jpeg' })).statusCode).toBe(200);
      expect((await g.como(gerenteNorte, 'PUT', `/api/equipe/${rita.id}/foto`, { base64: JPEG, mimetype: 'image/jpeg' })).statusCode).toBe(403);
      // Arquivo que não é imagem, e pessoa que não existe.
      expect((await g.como(carla, 'PUT', `/api/equipe/${carla.id}/foto`, { base64: Buffer.from('não sou foto').toString('base64'), mimetype: 'image/jpeg' })).statusCode).toBe(400);
      expect((await g.como(carla, 'GET', '/api/equipe/00000000-0000-0000-0000-000000000000/foto')).statusCode).toBe(404);
      expect((await g.app.inject({ method: 'GET', url: `/api/equipe/${carla.id}/foto` })).statusCode).toBe(401);
      expect((await g.como(admin, 'DELETE', `/api/equipe/${carla.id}/foto`)).statusCode).toBe(200);
      expect((await g.como(bia, 'GET', `/api/equipe/${carla.id}/foto`)).statusCode).toBe(204);
    });
  });
}

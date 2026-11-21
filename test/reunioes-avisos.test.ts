import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AvisosReuniao, quandoTexto, telefoneParaWhatsapp, textoConfirmacao, type AvisoSino } from '../src/reunioes/avisos.js';
import { instante, registrarReunioes } from '../src/reunioes/reunioes.js';
import { poolDeTeste, temPostgres } from './repos.js';

/**
 * atendimento-extra: agendamento online → avisos (sino + push), confirmação e lembrete pelo WhatsApp,
 * desmarcar pelo próprio link e as reuniões na Agenda.
 */

describe('Agendamento online: textos', () => {
  it('quando, telefone e confirmação', () => {
    expect(quandoTexto(instante('2026-11-27', '14:00'))).toBe('sexta-feira, 27/11, às 14:00');
    expect(telefoneParaWhatsapp('(71) 98812-4471')).toBe('5571988124471');
    expect(telefoneParaWhatsapp('12345')).toBeNull();
    const t = textoConfirmacao({ id: 'x', empresa_id: 'e', link_id: 'l', nome: 'Marina Souza', telefone: '71988124471', inicio: instante('2026-11-27', '14:00'), fim: instante('2026-11-27', '14:30'), titulo: 'Conversa de 30 min', local: 'Google Meet', slug: 's', criado_por: null, whatsapp_cliente: true, lembrete_min: 60 }, 'https://app/r/s?cancelar=abc');
    expect(t).toBe('Olá, Marina! Sua reunião "Conversa de 30 min" está marcada para sexta-feira, 27/11, às 14:00 (horário de Brasília).\nLocal: Google Meet\nSe precisar desmarcar: https://app/r/s?cancelar=abc');
  });
});

describe.skipIf(!temPostgres)('Agendamento online: avisos e Agenda (Postgres)', () => {
  async function montar(opcoes: { whatsappCliente?: boolean; lembreteMin?: number } = {}) {
    const pool = await poolDeTeste();
    await pool.query('delete from sintonia.links_reuniao');
    const relogio = { t: instante('2026-11-23', '08:00') }; // segunda, 08:00 na Bahia
    const sinoPessoa: Array<{ id: string } & AvisoSino> = [];
    const sinoGestao: AvisoSino[] = [];
    const whats: Array<{ telefone: string; nome: string; texto: string }> = [];
    const avisos = new AvisosReuniao({
      pool,
      agora: () => relogio.t,
      urlPublica: () => 'https://sintonia.exemplo',
      avisarPessoa: async (id, a) => { sinoPessoa.push({ id, ...a }); },
      avisarGestao: async (a) => { sinoGestao.push(a); },
      whatsapp: async (telefone, nome, texto) => { whats.push({ telefone, nome, texto }); return { conversaId: '00000000-0000-4000-8000-000000000001' }; },
    });
    const app = Fastify();
    app.addHook('preHandler', async (req) => {
      if (req.url.startsWith('/api/')) (req as unknown as { usuario: unknown }).usuario = { id: 'dona-1', empresaId: 'imperio', nome: 'Bruno', papel: 'admin' };
    });
    registrarReunioes(app, pool, { agora: () => relogio.t, avisos, podeAbrir: async () => true });
    const link = (await app.inject({ method: 'POST', url: '/api/reunioes/links', payload: { titulo: 'Conversa de 30 min', duracao_min: 30, dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '12:00', antecedencia_h: 0, local: 'Google Meet', whatsapp_cliente: opcoes.whatsappCliente ?? true, lembrete_min: opcoes.lembreteMin ?? 60 } })).json() as { slug: string };
    const marcar = (hora: string, telefone = '71 98812-4471') => app.inject({ method: 'POST', url: `/reservar/${link.slug}`, payload: { data: '2026-11-23', hora, nome: 'Marina Souza', telefone, email: '', observacao: 'quero saber dos planos' } });
    return { pool, app, avisos, relogio, link, marcar, sinoPessoa, sinoGestao, whats };
  }

  it('marcou pelo link: avisa a dona do link e a gestão, confirma pelo WhatsApp com o link para desmarcar', async () => {
    const m = await montar();
    const r = await m.marcar('10:00');
    expect(r.statusCode).toBe(200);
    const { cancelar } = r.json() as { cancelar: string };
    expect(cancelar).toMatch(/^[A-Za-z0-9_-]{20,40}$/);
    await m.avisos.ocioso();
    expect(m.sinoPessoa).toHaveLength(1);
    expect(m.sinoPessoa[0]).toMatchObject({ id: 'dona-1', tipo: 'reuniao', vista: 'agenda', titulo: 'Reunião marcada: Marina Souza' });
    expect(m.sinoPessoa[0]!.texto).toContain('Conversa de 30 min · segunda-feira, 23/11, às 10:00');
    expect(m.sinoGestao.map((a) => a.chave)).toEqual([m.sinoPessoa[0]!.chave]);
    expect(m.whats).toHaveLength(1);
    expect(m.whats[0]!.telefone).toBe('5571988124471');
    expect(m.whats[0]!.texto).toContain(`https://sintonia.exemplo/r/${m.link.slug}?cancelar=${cancelar}`);
    // A conversa do contato fica guardada na reunião (Agenda: "Abrir conversa").
    const ag = (await m.app.inject({ method: 'GET', url: '/api/reunioes/agenda?de=2026-11-23&dias=14' })).json() as { itens: Array<Record<string, unknown>> };
    expect(ag.itens).toHaveLength(1);
    expect(ag.itens[0]).toMatchObject({ fonte: 'reuniao', cliente: 'Marina Souza', servico: 'Conversa de 30 min', local: 'Google Meet', duracaoMin: 30, conversaId: '00000000-0000-4000-8000-000000000001', podeAbrir: true, responsavelId: 'dona-1' });
    expect(ag.itens[0]!.inicio).toBe(instante('2026-11-23', '10:00').toISOString());
    await m.app.close();
  });

  it('o contato desmarca pelo link: avisa, libera o horário e sai da Agenda', async () => {
    const m = await montar();
    const { cancelar } = (await m.marcar('10:00')).json() as { cancelar: string };
    await m.avisos.ocioso();
    m.sinoPessoa.length = 0; m.sinoGestao.length = 0; m.whats.length = 0;
    const ver = await m.app.inject({ method: 'GET', url: `/reservar/${m.link.slug}/reserva?codigo=${cancelar}` });
    expect(ver.json()).toMatchObject({ nome: 'Marina Souza', status: 'marcada', titulo: 'Conversa de 30 min' });
    expect((await m.app.inject({ method: 'POST', url: `/reservar/${m.link.slug}/cancelar`, payload: { codigo: 'x'.repeat(24) } })).statusCode).toBe(404);
    const c = await m.app.inject({ method: 'POST', url: `/reservar/${m.link.slug}/cancelar`, payload: { codigo: cancelar } });
    expect(c.json()).toEqual({ ok: true });
    await m.avisos.ocioso();
    expect(m.sinoPessoa.map((a) => a.titulo)).toEqual(['Reunião desmarcada: Marina Souza']);
    expect(m.sinoPessoa[0]!.texto).toContain('o contato desmarcou pelo link');
    expect(m.sinoGestao).toHaveLength(1);
    expect(m.whats).toEqual([]); // quem desmarcou já viu na tela
    const livres = (await m.app.inject({ method: 'GET', url: `/reservar/${m.link.slug}` })).json() as { dias: Array<{ data: string; horarios: string[] }> };
    expect(livres.dias[0]!.horarios).toContain('10:00');
    const ag = (await m.app.inject({ method: 'GET', url: '/api/reunioes/agenda?de=2026-11-23&dias=14' })).json() as { itens: unknown[] };
    expect(ag.itens).toEqual([]);
    await m.app.close();
  });

  it('a equipe cancela: o contato recebe o aviso pelo WhatsApp com o link para marcar de novo', async () => {
    const m = await montar();
    await m.marcar('11:00');
    await m.avisos.ocioso();
    m.whats.length = 0;
    const { proximas } = (await m.app.inject({ method: 'GET', url: '/api/reunioes' })).json() as { proximas: Array<{ id: string }> };
    await m.app.inject({ method: 'POST', url: `/api/reunioes/${proximas[0]!.id}/cancelar` });
    await m.avisos.ocioso();
    expect(m.whats).toHaveLength(1);
    expect(m.whats[0]!.texto).toContain('foi cancelada');
    expect(m.whats[0]!.texto).toContain(`https://sintonia.exemplo/r/${m.link.slug}`);
    expect(m.sinoPessoa.at(-1)!.texto).toContain('cancelada pela equipe');
    await m.app.close();
  });

  it('lembrete 1 h antes para o contato e a dona do link, uma vez só', async () => {
    const m = await montar();
    await m.marcar('11:00');
    await m.avisos.ocioso();
    m.sinoPessoa.length = 0; m.sinoGestao.length = 0; m.whats.length = 0;
    m.relogio.t = instante('2026-11-23', '09:30');
    expect(await m.avisos.tick()).toBe(0);
    m.relogio.t = instante('2026-11-23', '10:00');
    expect(await m.avisos.tick()).toBe(1);
    expect(await m.avisos.tick()).toBe(0);
    expect(m.whats).toHaveLength(1);
    expect(m.whats[0]!.texto).toBe('Olá, Marina! Lembrete: sua reunião "Conversa de 30 min" é daqui a 1 hora, às 11:00.\nLocal: Google Meet\nAté já!');
    expect(m.sinoPessoa.map((a) => a.titulo)).toEqual(['Reunião em 1 hora: Marina Souza']);
    expect(m.sinoGestao).toEqual([]); // o lembrete vai só para a dona do link
    await m.app.close();
  });

  it('marcou já dentro do prazo do lembrete: não manda lembrete (a confirmação acabou de sair)', async () => {
    const m = await montar();
    m.relogio.t = instante('2026-11-23', '09:40');
    await m.marcar('10:00');
    await m.avisos.ocioso();
    m.whats.length = 0;
    expect(await m.avisos.tick()).toBe(0);
    expect(m.whats).toEqual([]);
    await m.app.close();
  });

  it('link com WhatsApp desligado e sem lembrete: só o sino', async () => {
    const m = await montar({ whatsappCliente: false, lembreteMin: 0 });
    await m.marcar('11:00');
    await m.avisos.ocioso();
    expect(m.whats).toEqual([]);
    expect(m.sinoPessoa).toHaveLength(1);
    m.relogio.t = instante('2026-11-23', '10:30');
    expect(await m.avisos.tick()).toBe(0);
    const { links } = (await m.app.inject({ method: 'GET', url: '/api/reunioes' })).json() as { links: Array<{ whatsapp_cliente: boolean; lembrete_min: number }> };
    expect(links[0]).toMatchObject({ whatsapp_cliente: false, lembrete_min: 0 });
    await m.app.close();
  });

  it('sem telefone (só e-mail): sem WhatsApp, avisos normais', async () => {
    const m = await montar();
    const r = await m.app.inject({ method: 'POST', url: `/reservar/${m.link.slug}`, payload: { data: '2026-11-23', hora: '09:00', nome: 'Ana', telefone: '', email: 'ana@exemplo.com', observacao: '' } });
    expect(r.statusCode).toBe(200);
    await m.avisos.ocioso();
    expect(m.whats).toEqual([]);
    expect(m.sinoPessoa[0]!.texto).toContain('ana@exemplo.com');
    await m.app.close();
  });
});

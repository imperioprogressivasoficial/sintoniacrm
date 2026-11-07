import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { EmailMarketing } from '../src/email/email.js';
import { TransporteFalso } from '../src/email/transporte.js';
import { ArmazemFollowupMemoria, ArmazemFollowupPostgres, type ArmazemFollowup } from '../src/followup/armazem.js';
import { Followup, type EmailParaFollowup } from '../src/followup/followup.js';
import { configPadrao, lerResposta, preencher } from '../src/followup/tipos.js';
import { observarEventos } from '../src/notificacoes/notificador.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags } from '../src/tags/tags.js';
import { bahia, DIA, HORA, MIN } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ telefone: string; texto: string }> = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, texto: string) {
    this.enviados.push({ telefone, texto });
    return { idExterno: `out-${Math.random()}` };
  }
}

class AgenteFalso {
  pedidos: PedidoAgente[] = [];
  async executar(p: PedidoAgente): Promise<RespostaAgente> {
    this.pedidos.push(p);
    return { texto: p.objetivo ? 'Texto escrito pela IA' : 'Oi! Posso ajudar?', acoes: [], recusou: false };
  }
}

/** Quinta-feira, 5/11/2026, 14h (Bahia): loja aberta (10h–22h). */
const QUINTA = bahia(2026, 11, 5, 14, 0);

interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; armazem: ArmazemFollowup; tags: Tags; email?: EmailParaFollowup; transporte?: TransporteFalso; pool?: import('pg').Pool }>;
}

const ambientes: Ambiente[] = [
  {
    nome: 'memória',
    criar: async () => {
      const repo = new RepositorioMemoria();
      return { repo, armazem: new ArmazemFollowupMemoria(), tags: new Tags(new ArmazemTagsMemoria(() => repo.listarConversas()), 'imperio') };
    },
  },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.followup_envios, sintonia.followup_config, sintonia.agenda_confirmacoes, sintonia.followup_pausas, sintonia.email_eventos, sintonia.email_envios, sintonia.email_supressoes, sintonia.email_campanhas, sintonia.email_modelos, sintonia.email_contas restart identity cascade');
            return { repo: new RepositorioPostgres(pool), armazem: new ArmazemFollowupPostgres(pool), tags: new Tags(new ArmazemTagsPostgres(pool), 'imperio'), pool };
          },
        },
      ]
    : []),
];

async function montar(a: Ambiente, ajustar?: (cfg: ReturnType<typeof configPadrao>) => void) {
  const base = await a.criar();
  const relogio = { t: QUINTA };
  const agora = () => relogio.t;
  const canal = new CanalFalso();
  const agente = new AgenteFalso();
  let transporte: TransporteFalso | undefined;
  let email: EmailMarketing | undefined;
  if (base.pool) {
    transporte = new TransporteFalso();
    email = new EmailMarketing({ pool: base.pool, cofre: new Cofre('segredo'), empresaId: 'imperio', transporte: transporte.fabrica, urlPublica: 'https://crm.teste', agora });
    await email.salvarConta(null, { nome: 'Conta', smtpHost: 'smtp.teste', smtpPorta: 465, usuario: 'a@imperio.com.br', senha: 'x', remetenteNome: 'Império', remetenteEmail: 'contato@imperio.com.br' }, 'teste');
  }
  let sintonia!: Sintonia;
  const novoFollowup = () =>
    new Followup({ empresaId: 'imperio', armazem: base.armazem, repo: base.repo, sintonia: () => sintonia, agente, iaDisponivel: () => true, email, tags: base.tags, agora });
  let f = novoFollowup();
  observarEventos(base.repo, (e) => f.aoEvento(e));
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo: base.repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente,
    agora,
    motor: (c) => f.motor(c),
    configIa: async () => ({ modoPadrao: 'ia' }),
    ganchos: { mensagemCliente: (c, m) => f.mensagemCliente(c, m) },
  });
  const cfg = configPadrao();
  ajustar?.(cfg);
  await f.salvarConfig(cfg, 'teste');
  let seq = 0;
  const cliente = async (texto: string) => {
    await sintonia.receber({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina Souza', texto, deMim: false, idExterno: `in-${++seq}-${relogio.t.getTime()}`, em: relogio.t });
    await f.ocioso();
  };
  const tick = async () => {
    await f.ocioso();
    const r = await f.tick();
    await f.ocioso();
    return r.enviados;
  };
  const ir = async (t: Date) => {
    relogio.t = t;
    await sintonia.tick();
    return tick();
  };
  const conversa = async () => (await base.repo.listarConversas())[0]!;
  const agendar = async (inicio: Date, trinksId = 77) => {
    const c = await conversa();
    await sintonia.equipeAgendou(c.id, { tipo: 'agendou', clienteTrinksId: 9, agendamento: { trinksId, unidade: 'norte', servico: 'Progressiva', profissional: 'Ana', inicio, duracaoMin: 120 } }, 'Carla');
    await f.ocioso();
  };
  const reiniciar = () => {
    f = novoFollowup();
  };
  return { ...base, relogio, canal, agente, cliente, tick, ir, conversa, agendar, reiniciar, get f() {
    return f;
  }, transporte, email };
}

describe('follow-up: funções puras', () => {
  it('lê "1"/"2" e as variações', () => {
    for (const t of ['1', '1 - Confirmo', 'Sim', 'confirmo!', 'Ok', 'pode confirmar', 'Confirmadíssimo']) expect(lerResposta(t), t).toBe('confirmado');
    for (const t of ['2', '2 - Preciso remarcar', 'Preciso remarcar', 'não', 'Não vou poder, quero desmarcar', 'Dá pra reagendar?']) expect(lerResposta(t), t).toBe('remarcar');
    for (const t of ['Qual o endereço?', 'Oi', '']) expect(lerResposta(t), t).toBeNull();
  });
  it('preenche as variáveis', () => {
    expect(preencher('Oi, {primeiro_nome}! {servico} na {unidade}, {data} às {hora}.', { nome: 'Marina Souza', servico: 'Progressiva', unidade: 'Norte', data: 'sexta, 06/11', hora: '14:00' })).toBe('Oi, Marina! Progressiva na Norte, sexta, 06/11 às 14:00.');
  });
});

for (const a of ambientes) {
  describe(`follow-up (${a.nome})`, () => {
    it('cadência "Não respondeu" dispara no tempo certo, segue os passos e substitui o motor fixo', async () => {
      const m = await montar(a, (cfg) => {
        cfg.cadencias.find((c) => c.id === 'sem_resposta')!.ligada = true;
      });
      await m.cliente('Oi, queria saber da progressiva');
      expect(m.canal.enviados.map((x) => x.texto)).toEqual(['Oi! Posso ajudar?']);
      const c = await m.conversa();
      // O motor fixo (1h/1d/3d) não programou nada: a cadência configurável assumiu.
      expect((await m.repo.tarefasPendentes(c.id)).filter((t) => t.tipo.startsWith('followup'))).toHaveLength(0);
      const selo = await m.f.seloDaConversa(c.id);
      expect(selo.cadencia).toMatchObject({ situacao: 'sem_resposta', passo: 1, total: 3 });

      expect(await m.ir(new Date(QUINTA.getTime() + 2 * HORA))).toBe(0);
      expect(await m.ir(new Date(QUINTA.getTime() + 3 * HORA + MIN))).toBe(1);
      // Passo 1 usa a IA com objetivo (há chave).
      expect(m.canal.enviados.at(-1)!.texto).toBe('Texto escrito pela IA');
      expect(m.agente.pedidos.at(-1)!.objetivo).toMatch(/follow-up/i);
      expect((await m.f.seloDaConversa(c.id)).cadencia).toMatchObject({ passo: 2, total: 3 });
      // De novo no mesmo instante: nada sai em dobro.
      expect(await m.tick()).toBe(0);
      // Passo 2: 1 dia depois.
      expect(await m.ir(new Date(QUINTA.getTime() + 3 * HORA + DIA + 2 * MIN))).toBe(1);
      expect(m.canal.enviados).toHaveLength(3);
    });

    it('para quando a cliente responde e respeita o horário da loja', async () => {
      const m = await montar(a, (cfg) => {
        const c = cfg.cadencias.find((x) => x.id === 'sem_resposta')!;
        c.ligada = true;
        c.passos = [{ esperaHoras: 9, texto: 'Oi {primeiro_nome}, ainda por aí?', ia: false, objetivo: '', email: false, emailModeloId: null }, { esperaHoras: 24, texto: 'Segundo', ia: false, objetivo: '', email: false, emailModeloId: null }];
      });
      await m.cliente('Oi');
      // 14h + 9h = 23h: loja fechada (fecha 22h). Fica para a abertura (sexta 10h).
      expect(await m.ir(new Date(QUINTA.getTime() + 9 * HORA + MIN))).toBe(0);
      expect(await m.ir(bahia(2026, 11, 6, 9, 59))).toBe(0);
      expect(await m.ir(bahia(2026, 11, 6, 10, 0))).toBe(1);
      expect(m.canal.enviados.at(-1)!.texto).toBe('Oi Marina, ainda por aí?');
      // A cliente responde: o próximo passo é cancelado (a IA responde e a cadência recomeça do zero).
      await m.cliente('Oi, tô sim');
      const c = await m.conversa();
      const selo = await m.f.seloDaConversa(c.id);
      expect(selo.historico.some((h) => h.estado === 'cancelado' && h.detalhe === 'a cliente respondeu')).toBe(true);
      expect(selo.cadencia).toMatchObject({ passo: 1 });
      // Pausar: nada mais sai.
      await m.f.pausar(c.id, 'Carla');
      expect((await m.f.seloDaConversa(c.id)).cadencia).toBeNull();
      expect(await m.ir(bahia(2026, 11, 8, 15, 0))).toBe(0);
    });

    it('confirmação 24h e lembrete 2h; "1" confirma sem a IA responder de novo; sem duplicar; sobrevive a reinício', async () => {
      const m = await montar(a);
      await m.cliente('Quero agendar');
      const inicio = bahia(2026, 11, 7, 15, 0); // sábado 15h
      await m.agendar(inicio);
      const c = await m.conversa();
      // O motor fixo não programou os lembretes (a confirmação assumiu).
      expect((await m.repo.tarefasPendentes(c.id)).filter((t) => t.tipo.startsWith('lembrete'))).toHaveLength(0);
      expect((await m.f.seloDaConversa(c.id)).confirmacao).toMatchObject({ status: 'aguardando' });
      // Agendamento registrado de novo (webhook repetido, conversa mesclada): não duplica.
      await m.agendar(inicio);
      const antes = m.canal.enviados.length;
      expect(await m.ir(new Date(inicio.getTime() - 24 * HORA - MIN))).toBe(0);
      m.reiniciar(); // reinício: outra instância, mesma fila
      expect(await m.ir(new Date(inicio.getTime() - 24 * HORA))).toBe(1);
      expect(await m.tick()).toBe(0);
      expect(m.canal.enviados).toHaveLength(antes + 1);
      expect(m.canal.enviados.at(-1)!.texto).toContain('1 - Confirmo');
      expect(m.canal.enviados.at(-1)!.texto).toContain('sábado, 07/11 às 15:00');
      const pedidos = m.agente.pedidos.length;
      await m.cliente('1');
      expect((await m.f.seloDaConversa(c.id)).confirmacao).toMatchObject({ status: 'confirmado' });
      expect(m.canal.enviados.at(-1)!.texto).toMatch(/confirmado/);
      expect(m.agente.pedidos.length).toBe(pedidos); // a IA não respondeu ao "1"
      // Lembrete 2h antes, já confirmado: sem as opções.
      expect(await m.ir(new Date(inicio.getTime() - 2 * HORA))).toBe(1);
      expect(m.canal.enviados.at(-1)!.texto).toContain('Te esperamos hoje às 15:00');
      expect(await m.ir(new Date(inicio.getTime() - HORA))).toBe(0);
      const st = await m.f.confirmacoesEntre(new Date(inicio.getTime() - DIA), new Date(inicio.getTime() + DIA));
      expect(st.map((x) => x.status)).toEqual(['confirmado']);
      if (m.transporte && m.email) {
        // Sem e-mail na ficha: nada sai por e-mail (o modelo da confirmação foi criado mesmo assim).
        expect(m.transporte.enviados).toHaveLength(0);
      }
    });

    it('"2" marca "quer remarcar", avisa a equipe e marca a tag; os lembretes não saem', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      const inicio = bahia(2026, 11, 7, 15, 0);
      await m.agendar(inicio, 88);
      expect(await m.ir(new Date(inicio.getTime() - 24 * HORA))).toBe(1);
      const eventos: string[] = [];
      observarEventos(m.repo, (e) => void (e.tipo === 'confirmacao' && eventos.push(String(e.dados?.status))));
      await m.cliente('2');
      expect(eventos).toEqual(['remarcar']);
      expect(m.canal.enviados.at(-1)!.texto).toMatch(/remarcar/);
      const c = await m.conversa();
      expect((await m.f.seloDaConversa(c.id)).confirmacao).toMatchObject({ status: 'remarcar' });
      await m.tick(); // ação da tag, fora da trava
      expect((await m.tags.daConversa(c.id)).map((t) => t.nome)).toContain('Quer remarcar');
      expect(await m.ir(new Date(inicio.getTime() - 2 * HORA))).toBe(0);
    });

    it('sem resposta perto do horário vira "Sem resposta"', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      const inicio = bahia(2026, 11, 7, 15, 0);
      await m.agendar(inicio, 99);
      await m.ir(new Date(inicio.getTime() - 24 * HORA));
      await m.ir(new Date(inicio.getTime() - 2 * HORA));
      expect(m.canal.enviados.at(-1)!.texto).toContain('2 - Preciso remarcar');
      await m.ir(new Date(inicio.getTime() - 50 * MIN));
      const c = await m.conversa();
      expect((await m.f.seloDaConversa(c.id)).confirmacao).toMatchObject({ status: 'sem_resposta' });
    });

    it('"pediu preço e não agendou" começa com a pergunta de preço e para ao agendar', async () => {
      const m = await montar(a, (cfg) => {
        cfg.cadencias.find((x) => x.id === 'preco_sem_agendar')!.ligada = true;
        cfg.cadencias.find((x) => x.id === 'sem_resposta')!.ligada = true;
      });
      await m.cliente('Qual o valor da progressiva?');
      const c = await m.conversa();
      expect((await m.f.seloDaConversa(c.id)).cadencia).toMatchObject({ situacao: 'preco_sem_agendar', passo: 1 });
      await m.agendar(bahia(2026, 11, 9, 15, 0), 5);
      expect((await m.f.seloDaConversa(c.id)).cadencia).toBeNull();
    });
  });
}

describe.skipIf(!temPostgres)('follow-up: e-mail de confirmação (Postgres)', () => {
  it('cliente com e-mail recebe a confirmação também por e-mail, uma vez só', async () => {
    const m = await montar(ambientes[1]!);
    await m.cliente('Oi');
    await m.pool!.query(`insert into sintonia.contatos (empresa_id, telefone, nome, email, atualizado_em) values ('imperio', '5571988124471', 'Marina Souza', 'marina@exemplo.com', now()) on conflict (empresa_id, telefone) do update set email = excluded.email`);
    const inicio = bahia(2026, 11, 7, 15, 0);
    await m.agendar(inicio, 123);
    await m.ir(new Date(inicio.getTime() - 24 * HORA));
    await m.email!.tick();
    await m.email!.tick();
    expect(m.transporte!.enviados).toHaveLength(1);
    expect(m.transporte!.enviados[0]!.assunto).toBe('Seu horário de Progressiva: sábado, 07/11 às 15:00');
    expect(m.transporte!.enviados[0]!.texto).toContain('1 - Confirmo');
  });
});

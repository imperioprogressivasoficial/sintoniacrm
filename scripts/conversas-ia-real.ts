/**
 * ia-completa: conversas simuladas com a IA DE VERDADE (Claude), agenda falsa e WhatsApp falso.
 * Serve para ver, antes de publicar, se o modelo usa as ferramentas direito nos casos difíceis.
 * Gasta créditos da API: não roda nos testes. Uso:
 *
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/conversas-ia-real.ts            (todas)
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/conversas-ia-real.ts remarcar   (só uma)
 *   SINTONIA_MODELO=claude-sonnet-5-5 ...                                     (outro modelo)
 *
 * Mostra cada troca, as ferramentas usadas e o que a IA fez (agenda, funil, avisos). Confira à mão.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Agente } from '../src/ai/agente.js';
import { carregarBase } from '../src/ai/prompt.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { DadosNovoAgendamento } from '../src/agenda/sistema.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Defina ANTHROPIC_API_KEY para rodar com a IA de verdade.');
  process.exit(1);
}

class Agenda {
  readonly sistema = 'trinks' as const;
  marcados: Array<{ id: number; cliente: number; servico: number; prof: number; data: string; hora: string; cancelado: boolean }> = [];
  private seq = 100;
  servicos = [
    { id: 1, nome: 'Progressiva', duracaoEmMinutos: 180, preco: 320, valorPromocional: null },
    { id: 2, nome: 'Escova', duracaoEmMinutos: 60, preco: 80, valorPromocional: null },
  ];
  profs = [{ id: 7, nome: 'Jéssica' }, { id: 8, nome: 'Ana' }];
  fora = false;
  private chk() {
    if (this.fora) throw new Error('Trinks fora do ar (503)');
  }
  async listarServicos() { this.chk(); return this.servicos; }
  async listarProfissionais() { this.chk(); return this.profs; }
  async horariosVagos(_l: string, data: string, f?: { profissionalId?: number }) {
    this.chk();
    return this.profs.filter((p) => !f?.profissionalId || p.id === f.profissionalId).map((p) => ({ id: p.id, nome: p.nome, horariosVagos: ['09:00', '10:00', '14:00', '16:00'].filter((h) => !this.marcados.some((m) => !m.cancelado && m.data === data && m.hora === h && m.prof === p.id)) }));
  }
  async buscarClientePorTelefone() { this.chk(); return this.marcados.length ? { id: 55, nome: 'Marina' } : null; }
  async criarCliente() { return 55; }
  async criarAgendamento(_l: string, d: DadosNovoAgendamento) {
    this.chk();
    const id = ++this.seq;
    this.marcados.push({ id, cliente: d.clienteId, servico: d.servicoId, prof: d.profissionalId, data: d.data, hora: d.hora, cancelado: false });
    return id;
  }
  async cancelarAgendamento(_l: string, id: number) { const m = this.marcados.find((x) => x.id === id); if (m) m.cancelado = true; }
  async listarAgendamentosDoCliente(_l: string, cliente: number) {
    return this.marcados.filter((m) => m.cliente === cliente).map((m) => ({ id: m.id, cancelado: m.cancelado, servico: { id: m.servico, nome: this.servicos.find((s) => s.id === m.servico)!.nome }, profissional: { id: m.prof, nome: this.profs.find((p) => p.id === m.prof)!.nome }, dataHoraInicio: `${m.data}T${m.hora}:00`, duracaoEmMinutos: 60, valor: 80 }));
  }
}

const ROTEIROS: Record<string, { agora: Date; falas: string[]; preparar?: (a: Agenda) => void }> = {
  agendar: { agora: bahia(2026, 11, 5, 15), falas: ['oi! quanto é a escova?', 'tem sábado de manhã?', 'pode ser às 10h com a Ana', 'isso, pode marcar. Meu nome é Marina Souza'] },
  preco_inventado: { agora: bahia(2026, 11, 5, 15), falas: ['qual o valor da hidratação?'] },
  remarcar: { agora: bahia(2026, 11, 5, 15), preparar: (a) => a.marcados.push({ id: 90, cliente: 55, servico: 2, prof: 8, data: '2026-11-07', hora: '10:00', cancelado: false }), falas: ['oi, preciso mudar meu horário de sábado', 'pode ser às 16h?', 'sim, confirma'] },
  cancelar: { agora: bahia(2026, 11, 5, 15), preparar: (a) => a.marcados.push({ id: 91, cliente: 55, servico: 2, prof: 8, data: '2026-11-07', hora: '10:00', cancelado: false }), falas: ['vou ter que cancelar sábado, vou viajar', 'não precisa remarcar, pode cancelar sim'] },
  agenda_fora: { agora: bahia(2026, 11, 5, 15), preparar: (a) => void (a.fora = true), falas: ['tem horário amanhã?'] },
  brava: { agora: bahia(2026, 11, 5, 15), falas: ['ESTOU ESPERANDO HÁ 2 DIAS!!! QUE ABSURDO'] },
  madrugada: { agora: bahia(2026, 11, 5, 2), falas: ['oi, vocês abrem amanhã?', 'quero falar com alguém'] },
};

const canal: CanalWhatsApp & { enviados: string[] } = {
  tipo: 'evolution',
  enviados: [],
  lerWebhook: () => [],
  async enviarTexto(_c, _t, texto) {
    this.enviados.push(texto);
    return { idExterno: `out-${this.enviados.length}-${Date.now()}` };
  },
};

const escolhidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ROTEIROS);
const claude = new Anthropic();
const base = carregarBase();
for (const nome of escolhidos) {
  const r = ROTEIROS[nome];
  if (!r) {
    console.error(`Roteiro desconhecido: ${nome}. Opções: ${Object.keys(ROTEIROS).join(', ')}`);
    continue;
  }
  const agenda = new Agenda();
  r.preparar?.(agenda);
  const repo = new RepositorioMemoria();
  const relogio = { t: r.agora };
  const avisos: string[] = [];
  const agente = new Agente(claude, agenda, base, { modelo: process.env.SINTONIA_MODELO ?? 'claude-opus-5-5', esforco: 'low' });
  const s = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }], agente, agora: () => relogio.t, configIa: async () => ({ modoPadrao: 'ia' }), avisarEquipe: async (t) => void avisos.push(t), log: (m, e) => console.log('   [log]', m, e ?? '') });
  console.log(`\n=== ${nome} ===`);
  let i = 0;
  for (const fala of r.falas) {
    const antes = canal.enviados.length;
    console.log(`Cliente: ${fala}`);
    await s.receber({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina', texto: fala, deMim: false, idExterno: `in-${nome}-${++i}`, em: relogio.t });
    for (const t of canal.enviados.slice(antes)) console.log(`IA:      ${t}`);
    relogio.t = new Date(relogio.t.getTime() + 60_000);
  }
  const [c] = await repo.listarConversas();
  console.log('--- resultado');
  console.log('modo:', c?.modo, '| etapa:', c?.etapa);
  console.log('agenda:', agenda.marcados.map((m) => `${m.id} ${m.data} ${m.hora}${m.cancelado ? ' (cancelado)' : ''}`).join('; ') || 'nada');
  console.log('avisos para a equipe:', avisos.length ? avisos : 'nenhum');
  if (c) for (const m of (await repo.mensagens(c.id)).filter((x) => x.autor === 'sistema')) console.log('nota:', m.texto);
}

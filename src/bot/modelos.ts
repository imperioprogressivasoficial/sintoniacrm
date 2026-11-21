import { identidade } from '../empresa/identidade.js';
import { unidadesDa } from '../unidades.js';
import type { Grafo } from './esquema.js';

/**
 * Modelos de bot. sem-exemplos (pedido do dono, 21/11): a tela não mostra mais a lista e a API não cria bot a partir
 * deles (Bots.modelos devolve vazio); o dono monta os bots dele. Ficam aqui, sem uso, para a futura Ajuda
 * ("Ajuda: um exemplo e o passo a passo"). test/bot.test.ts continua conferindo que eles são válidos.
 * Antes: a tela mostrava a lista e criava um fluxo novo a partir de um deles (rascunho).
 * Tudo em texto curto e caloroso. O nome da empresa e as unidades vêm do cadastro (Empresa › Dados e Unidades);
 * os serviços de exemplo seguem o segmento (salão de cabelo ganha progressiva/selagem; outra empresa, um menu neutro).
 * É só o ponto de partida: a pessoa edita o fluxo antes de ligar.
 */
export interface ModeloBot {
  id: string;
  nome: string;
  descricao: string;
  grafo: Grafo;
}

type NoBruto = Record<string, unknown> & { id: string; tipo: string; x: number; y: number };
const g = (nos: NoBruto[], ligs: Array<[string, string, string]>): Grafo =>
  ({ nos, ligacoes: ligs.map(([de, saida, para], i) => ({ id: `l${i + 1}`, de, saida, para })) }) as unknown as Grafo;

/** Fluxo da esquerda para a direita (saídas à direita, entrada à esquerda). */
const X = 340;
const Y = 230;

/** A empresa é de salão de cabelo? (decide só os serviços de exemplo dos modelos) */
const ehSalaoDeCabelo = (segmento: string, nome: string) => /progressiva|alisament|cabel|sal[aã]o|beleza|hair/i.test(`${segmento} ${nome}`);

/** Os modelos, montados com o que está no cadastro agora. */
export function modelosBot(): ModeloBot[] {
  const emp = identidade();
  const salao = ehSalaoDeCabelo(emp.segmento, emp.nome);
  // Até 9 unidades na pergunta (a 10ª opção da pergunta é "outro"); empresa sem unidades vê uma de exemplo.
  const unis = unidadesDa().slice(0, 9);
  const opcoesUnidade = (unis.length ? unis : [{ id: 'principal', nome: 'Unidade principal' }]).map((u) => ({ id: u.id, texto: u.nome.slice(0, 60) }));
  const S = salao
    ? {
        menuDescricao: 'Cliente nova recebe um menu: Progressiva, Selagem, Preços ou Falar com atendente.',
        a: { id: 'progressiva', texto: 'Progressiva' },
        b: { id: 'selagem', texto: 'Selagem' },
        infoA: 'A nossa progressiva deixa o cabelo liso, brilhoso e sem frizz, com fórmula sem formol. ✨',
        infoB: 'A selagem alinha os fios, tira o volume e dá muito brilho, com resultado natural. ✨',
        infoPreco: 'Os valores mudam conforme o comprimento e o volume do cabelo. Me conta um pouquinho do seu cabelo que eu te passo certinho! 😊',
        objetivo: 'Tirar as dúvidas sobre {interesse} e agendar uma avaliação gratuita.',
        servicos: [
          { id: 'progressiva', texto: 'Progressiva' },
          { id: 'selagem', texto: 'Selagem' },
          { id: 'botox', texto: 'Botox capilar' },
          { id: 'outro_servico', texto: 'Outro' },
        ],
      }
    : {
        menuDescricao: 'Cliente nova recebe um menu: Conhecer os serviços, Como funciona, Preços ou Falar com atendente.',
        a: { id: 'progressiva', texto: 'Conhecer os serviços' },
        b: { id: 'selagem', texto: 'Como funciona' },
        infoA: 'Que bom que você quer conhecer! Me conta o que você procura que eu te explico direitinho. ✨',
        infoB: 'Funciona assim: você me diz o que precisa, eu tiro as dúvidas e já deixo tudo marcado para você. ✨',
        infoPreco: 'Os valores mudam conforme o que você precisa. Me conta um pouquinho que eu te passo certinho! 😊',
        objetivo: 'Tirar as dúvidas sobre {interesse} e marcar um horário.',
        servicos: [
          { id: 'progressiva', texto: 'Atendimento' },
          { id: 'selagem', texto: 'Avaliação' },
          { id: 'botox', texto: 'Retorno' },
          { id: 'outro_servico', texto: 'Outro' },
        ],
      };
  return [
  {
    id: 'boas_vindas_menu',
    nome: 'Boas-vindas com menu',
    descricao: S.menuDescricao,
    grafo: g(
      [
        { id: 'inicio', tipo: 'inicio', x: 0, y: 0, gatilho: { tipo: 'nova_conversa' } },
        { id: 'oi', tipo: 'mensagem', x: X, y: 0, texto: `Oi, {primeiro_nome}! 💛 Que bom te ver por aqui. Aqui é da ${emp.nome} – {unidade}.` },
        {
          id: 'menu',
          tipo: 'pergunta',
          x: X * 2,
          y: 0,
          texto: 'Como posso te ajudar hoje?',
          variavel: 'interesse',
          opcoes: [
            S.a,
            S.b,
            { id: 'precos', texto: 'Preços' },
            { id: 'atendente', texto: 'Falar com atendente' },
          ],
        },
        { id: 'info_prog', tipo: 'mensagem', x: X * 3.2, y: -Y * 1.1, texto: S.infoA },
        { id: 'info_sel', tipo: 'mensagem', x: X * 3.2, y: 0, texto: S.infoB },
        { id: 'info_preco', tipo: 'mensagem', x: X * 3.2, y: Y * 1.1, texto: S.infoPreco },
        { id: 'agente', tipo: 'agente_ia', x: X * 4.4, y: 0, objetivo: S.objetivo, saida: { tipo: 'agendou' }, dias: 3 },
        { id: 'agendado', tipo: 'mensagem', x: X * 5.6, y: 0, texto: 'Prontinho, {primeiro_nome}! Te esperamos. Qualquer coisa é só chamar por aqui. 💛' },
        { id: 'fim', tipo: 'fim', x: X * 6.6, y: 0 },
        { id: 'humano', tipo: 'transferir', x: X * 4.4, y: Y * 2.1, texto: 'Claro! Já chamei uma atendente, ela fala com você em instantes. 💛' },
      ],
      [
        ['inicio', 'proximo', 'oi'],
        ['oi', 'proximo', 'menu'],
        ['menu', 'progressiva', 'info_prog'],
        ['menu', 'selagem', 'info_sel'],
        ['menu', 'precos', 'info_preco'],
        ['menu', 'atendente', 'humano'],
        ['menu', 'outro', 'humano'],
        ['info_prog', 'proximo', 'agente'],
        ['info_sel', 'proximo', 'agente'],
        ['info_preco', 'proximo', 'agente'],
        ['agente', 'concluiu', 'agendado'],
        ['agente', 'tempo_esgotado', 'humano'],
        ['agendado', 'proximo', 'fim'],
      ],
    ),
  },
  {
    id: 'fora_do_horario',
    nome: 'Fora do horário',
    descricao: 'Quando a loja está fechada: avisa, oferece agendar com a IA ou anota a dúvida para a equipe ligar.',
    grafo: g(
      [
        { id: 'inicio', tipo: 'inicio', x: 0, y: 0, gatilho: { tipo: 'fora_do_horario' } },
        { id: 'aviso', tipo: 'mensagem', x: X, y: 0, texto: 'Oi, {primeiro_nome}! 🌙 Agora a {unidade} está fechada, mas eu posso te ajudar por aqui.' },
        {
          id: 'menu',
          tipo: 'pergunta',
          x: X * 2,
          y: 0,
          texto: 'O que você prefere?',
          opcoes: [
            { id: 'agendar', texto: 'Quero agendar' },
            { id: 'duvida', texto: 'Deixar uma dúvida' },
            { id: 'amanha', texto: 'Falo amanhã' },
          ],
        },
        { id: 'agente', tipo: 'agente_ia', x: X * 3.2, y: -Y * 1.1, objetivo: 'Agendar um horário para a cliente (a loja está fechada agora).', saida: { tipo: 'agendou' }, dias: 1 },
        { id: 'duvida', tipo: 'pergunta_aberta', x: X * 3.2, y: 0, texto: 'Pode escrever a sua dúvida que a equipe te responde assim que abrir. ✍️', validacao: 'texto', variavel: 'duvida' },
        { id: 'lembrete', tipo: 'lembrete', x: X * 4.4, y: 0, em_minutos: 0, texto: 'Responder dúvida de {primeiro_nome}: {duvida}' },
        { id: 'anotei', tipo: 'mensagem', x: X * 5.6, y: 0, texto: 'Anotado! Amanhã cedinho a equipe fala com você. 💛' },
        { id: 'tchau', tipo: 'mensagem', x: X * 3.2, y: Y * 1.1, texto: 'Combinado! Até amanhã, {primeiro_nome}. 💛' },
        { id: 'fim', tipo: 'fim', x: X * 6.8, y: Y * 0.4 },
      ],
      [
        ['inicio', 'proximo', 'aviso'],
        ['aviso', 'proximo', 'menu'],
        ['menu', 'agendar', 'agente'],
        ['menu', 'duvida', 'duvida'],
        ['menu', 'amanha', 'tchau'],
        ['duvida', 'proximo', 'lembrete'],
        ['lembrete', 'proximo', 'anotei'],
        ['anotei', 'proximo', 'fim'],
        ['tchau', 'proximo', 'fim'],
        ['agente', 'concluiu', 'fim'],
      ],
    ),
  },
  {
    id: 'qualificacao',
    nome: 'Qualificação → agendar com IA',
    descricao: 'Pergunta o serviço, a unidade e o melhor dia; depois a IA agenda.',
    grafo: g(
      [
        { id: 'inicio', tipo: 'inicio', x: 0, y: 0, gatilho: { tipo: 'palavra_chave', palavras: ['agendar', 'quero agendar', 'marcar horário'], modo: 'contem' } },
        {
          id: 'servico',
          tipo: 'pergunta',
          x: X,
          y: 0,
          texto: 'Oba! Qual serviço você quer fazer?',
          variavel: 'servico',
          opcoes: S.servicos,
        },
        {
          id: 'unidade',
          tipo: 'pergunta',
          x: X * 2.2,
          y: 0,
          texto: 'Qual unidade fica melhor pra você?',
          variavel: 'unidade_escolhida',
          opcoes: opcoesUnidade,
        },
        { id: 'dia', tipo: 'pergunta_aberta', x: X * 3.4, y: 0, texto: 'E qual o melhor dia pra você? (ex.: 25/11)', validacao: 'data', variavel: 'melhor_dia' },
        { id: 'resumo', tipo: 'mensagem', x: X * 4.6, y: 0, texto: 'Perfeito! {servico} no {unidade_escolhida}. Vou ver os horários livres pra você. 😊' },
        { id: 'agente', tipo: 'agente_ia', x: X * 5.8, y: 0, objetivo: 'Agendar {servico} na unidade {unidade_escolhida}, de preferência no dia {melhor_dia}.', saida: { tipo: 'agendou' }, dias: 3 },
        { id: 'fim', tipo: 'fim', x: X * 7, y: 0 },
        { id: 'humano', tipo: 'transferir', x: X * 5.8, y: Y * 1.3, texto: 'Vou pedir para uma atendente continuar com você. 💛' },
      ],
      [
        ['inicio', 'proximo', 'servico'],
        ['servico', 'progressiva', 'unidade'],
        ['servico', 'selagem', 'unidade'],
        ['servico', 'botox', 'unidade'],
        ['servico', 'outro_servico', 'unidade'],
        ['servico', 'outro', 'humano'],
        ...opcoesUnidade.map((o): [string, string, string] => ['unidade', o.id, 'dia']),
        ['dia', 'proximo', 'resumo'],
        ['dia', 'invalida', 'resumo'],
        ['resumo', 'proximo', 'agente'],
        ['agente', 'concluiu', 'fim'],
        ['agente', 'tempo_esgotado', 'humano'],
      ],
    ),
  },
];
}

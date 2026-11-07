import type { Grafo } from './esquema.js';

/**
 * Modelos prontos de bot. A tela mostra a lista e cria um fluxo novo a partir de um deles (rascunho).
 * Tudo em texto curto e caloroso, do jeito da Império.
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

export const MODELOS: ModeloBot[] = [
  {
    id: 'boas_vindas_menu',
    nome: 'Boas-vindas com menu',
    descricao: 'Cliente nova recebe um menu: Progressiva, Selagem, Preços ou Falar com atendente.',
    grafo: g(
      [
        { id: 'inicio', tipo: 'inicio', x: 0, y: 0, gatilho: { tipo: 'nova_conversa' } },
        { id: 'oi', tipo: 'mensagem', x: X, y: 0, texto: 'Oi, {primeiro_nome}! 💛 Que bom te ver por aqui. Aqui é da Império Progressivas – {unidade}.' },
        {
          id: 'menu',
          tipo: 'pergunta',
          x: X * 2,
          y: 0,
          texto: 'Como posso te ajudar hoje?',
          variavel: 'interesse',
          opcoes: [
            { id: 'progressiva', texto: 'Progressiva' },
            { id: 'selagem', texto: 'Selagem' },
            { id: 'precos', texto: 'Preços' },
            { id: 'atendente', texto: 'Falar com atendente' },
          ],
        },
        { id: 'info_prog', tipo: 'mensagem', x: X * 3.2, y: -Y * 1.1, texto: 'A nossa progressiva deixa o cabelo liso, brilhoso e sem frizz, com fórmula sem formol. ✨' },
        { id: 'info_sel', tipo: 'mensagem', x: X * 3.2, y: 0, texto: 'A selagem alinha os fios, tira o volume e dá muito brilho, com resultado natural. ✨' },
        { id: 'info_preco', tipo: 'mensagem', x: X * 3.2, y: Y * 1.1, texto: 'Os valores mudam conforme o comprimento e o volume do cabelo. Me conta um pouquinho do seu cabelo que eu te passo certinho! 😊' },
        { id: 'agente', tipo: 'agente_ia', x: X * 4.4, y: 0, objetivo: 'Tirar as dúvidas sobre {interesse} e agendar uma avaliação gratuita.', saida: { tipo: 'agendou' }, dias: 3 },
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
          opcoes: [
            { id: 'progressiva', texto: 'Progressiva' },
            { id: 'selagem', texto: 'Selagem' },
            { id: 'botox', texto: 'Botox capilar' },
            { id: 'outro_servico', texto: 'Outro' },
          ],
        },
        {
          id: 'unidade',
          tipo: 'pergunta',
          x: X * 2.2,
          y: 0,
          texto: 'Qual unidade fica melhor pra você?',
          variavel: 'unidade_escolhida',
          opcoes: [
            { id: 'norte', texto: 'Salvador Norte Shopping' },
            { id: 'sumare', texto: 'Shopping Sumaré' },
          ],
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
        ['unidade', 'norte', 'dia'],
        ['unidade', 'sumare', 'dia'],
        ['dia', 'proximo', 'resumo'],
        ['dia', 'invalida', 'resumo'],
        ['resumo', 'proximo', 'agente'],
        ['agente', 'concluiu', 'fim'],
        ['agente', 'tempo_esgotado', 'humano'],
      ],
    ),
  },
];

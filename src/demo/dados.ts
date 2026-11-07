/**
 * Material do gerador de demonstração: nomes, serviços, preços e falas de salão.
 * Tudo fictício. Telefones começam por PREFIXO_TELEFONE_DEMO (nenhum número real começa assim na base)
 * e os e-mails são @exemplo.com.
 */

/** Telefones de demonstração: 55 71 9990 + 5 dígitos. Nenhum é número de verdade. */
export const PREFIXO_TELEFONE_DEMO = '55719990';
/** "Quem fez" gravado em tudo o que a demonstração cria (tags, funil, respostas, automações...). */
export const POR_DEMO = 'Demonstração';
/** E-mail das atendentes de demonstração: nome.demo@exemplo.com (ninguém entra com elas). */
export const DOMINIO_EMAIL_DEMO = '.demo@exemplo.com';
/** Senha guardada das atendentes de demonstração: não é um hash válido, então nenhuma senha confere. */
export const SENHA_INUTILIZAVEL = 'demonstracao$sem-login';

export const ehTelefoneDemo = (t: string) => t.startsWith(PREFIXO_TELEFONE_DEMO);
export const ehEmailDemo = (email: string) => email.toLowerCase().endsWith(DOMINIO_EMAIL_DEMO);

export const NOMES_F = [
  'Ana', 'Beatriz', 'Bruna', 'Camila', 'Carla', 'Carolina', 'Cíntia', 'Daiane', 'Daniela', 'Débora', 'Elaine', 'Eliane', 'Fabiana',
  'Fernanda', 'Flávia', 'Gabriela', 'Gisele', 'Iasmin', 'Ingrid', 'Isabela', 'Ivone', 'Jaqueline', 'Joana', 'Josiane', 'Juliana',
  'Kelly', 'Laís', 'Larissa', 'Letícia', 'Lívia', 'Lorena', 'Luana', 'Luciana', 'Maiara', 'Marcela', 'Mariana', 'Marina', 'Mayara',
  'Michele', 'Milena', 'Mirela', 'Nathália', 'Patrícia', 'Paula', 'Priscila', 'Rafaela', 'Raquel', 'Rebeca', 'Renata', 'Roberta',
  'Sabrina', 'Samanta', 'Sandra', 'Silvana', 'Simone', 'Sofia', 'Suelen', 'Tainá', 'Talita', 'Tatiane', 'Thaís', 'Vanessa',
  'Verônica', 'Vitória', 'Yasmin', 'Ádila', 'Adriana', 'Alessandra', 'Aline', 'Amanda', 'Andreia', 'Ariane', 'Bianca', 'Cristiane',
  'Edilene', 'Elisângela', 'Érica', 'Gleice', 'Jamile', 'Jéssica', 'Karine', 'Lucimara', 'Manuela', 'Nadja', 'Railda', 'Rosana',
  'Sheila', 'Tamires', 'Valquíria', 'Viviane',
];
export const NOMES_M = ['Lucas', 'Rafael', 'Diego', 'Thiago', 'Bruno', 'Felipe', 'Rodrigo', 'Gustavo', 'Caio', 'Mateus'];
export const SOBRENOMES = [
  'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ferreira', 'Almeida', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins',
  'Araújo', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Moreira', 'Cardoso', 'Teixeira', 'Batista', 'Pinto', 'Reis', 'Andrade',
  'Bonfim', 'Conceição', 'Jesus', 'Silva', 'Brito', 'Menezes', 'Sacramento', 'Pires', 'Queiroz', 'Matos', 'Freitas', 'Cerqueira',
];

/** Atendentes de demonstração (papel atendente). ritmo = minutos típicos para responder (a cliente espera). */
export const ATENDENTES_DEMO = [
  { nome: 'Larissa Moura', email: `larissa${DOMINIO_EMAIL_DEMO}`, unidade: 'norte' as const, ritmo: [1, 6] as const },
  { nome: 'Camila Prado', email: `camila${DOMINIO_EMAIL_DEMO}`, unidade: 'norte' as const, ritmo: [3, 14] as const },
  { nome: 'Jéssica Lopes', email: `jessica${DOMINIO_EMAIL_DEMO}`, unidade: 'sumare' as const, ritmo: [2, 9] as const },
  { nome: 'Rafaela Duarte', email: `rafaela${DOMINIO_EMAIL_DEMO}`, unidade: 'sumare' as const, ritmo: [5, 24] as const },
];

/** Profissionais do salão (só aparecem na Agenda). */
export const PROFISSIONAIS: Record<'norte' | 'sumare', string[]> = {
  norte: ['Tati', 'Bruna', 'Edu'],
  sumare: ['Lu', 'Patrícia', 'Mônica'],
};

export type Servico = 'progressiva' | 'selagem' | 'botox' | 'hidratacao';
export const SERVICOS: Record<Servico, { nome: string; tag: string | null; duracaoMin: number }> = {
  progressiva: { nome: 'Progressiva', tag: 'Progressiva', duracaoMin: 180 },
  selagem: { nome: 'Selagem', tag: 'Selagem', duracaoMin: 150 },
  botox: { nome: 'Botox capilar', tag: 'Botox capilar', duracaoMin: 120 },
  hidratacao: { nome: 'Hidratação', tag: null, duracaoMin: 60 },
};

export const PRECO: Record<Servico, string> = {
  progressiva: 'A progressiva sai a partir de R$ 180 (cabelo curto). No médio fica R$ 220 e no longo a partir de R$ 260 — o valor certinho a gente confirma vendo o volume 😊',
  selagem: 'A selagem está R$ 150 até a altura do ombro. Abaixo disso fica R$ 180 ✨',
  botox: 'O botox capilar sai por R$ 120, já com a escova 💆‍♀️',
  hidratacao: 'A hidratação profunda está R$ 80, com escova.',
};

export const DURACAO: Record<Servico, string> = {
  progressiva: 'Dura em média de 3 a 4 meses, dependendo dos cuidados em casa. O procedimento leva umas 3 horas.',
  selagem: 'A selagem dura de 2 a 3 meses e leva umas 2h30 no salão.',
  botox: 'O efeito dura de 30 a 45 dias. No salão leva cerca de 2 horas.',
  hidratacao: 'Leva 1 hora e o brilho dura umas 2 semanas.',
};

export type Origem = 'Instagram' | 'Indicação' | 'Google' | 'Passou na loja' | 'Tráfego pago';
export const ORIGENS: Array<[Origem, number]> = [
  ['Instagram', 34],
  ['Tráfego pago', 24],
  ['Indicação', 22],
  ['Google', 12],
  ['Passou na loja', 8],
];
/** Tag solta que acompanha a origem (quando há). */
export const TAG_DA_ORIGEM: Partial<Record<Origem, string>> = { Instagram: 'Instagram', Indicação: 'Indicação', 'Tráfego pago': 'Tráfego pago' };

/** Primeira mensagem da cliente, pela origem e pelo serviço. {servico} = nome do serviço em minúsculas. */
export const ABERTURAS: Record<Origem | 'geral', string[]> = {
  Instagram: [
    'Oi! Vi o post de vocês no Instagram, quanto tá a {servico}?',
    'Boa tarde! Vim pelo Instagram, queria saber o valor da {servico}',
    'Oii, vi os resultados no insta de vocês e amei 😍 quanto custa a {servico}?',
  ],
  'Tráfego pago': [
    'Olá! Vi o anúncio de vocês, qual o valor da {servico}?',
    'Oi, cliquei no anúncio. Como funciona a {servico}?',
    'Boa noite! Vi a promoção no anúncio, ainda tá valendo a {servico}?',
  ],
  Indicação: [
    'Oi! Minha amiga fez {servico} com vocês e indicou, queria saber o preço',
    'Boa tarde, foi a minha prima que me passou o contato. Quanto fica a {servico}?',
    'Oi, tudo bem? Uma colega do trabalho indicou vocês pra {servico} 💛',
  ],
  Google: [
    'Oi, achei vocês no Google. Fazem {servico}?',
    'Bom dia! Vocês fazem {servico}? Qual o valor?',
  ],
  'Passou na loja': [
    'Oi! Passei na loja ontem e peguei o cartão. Quanto tá a {servico}?',
    'Boa tarde, passei aí no shopping e queria marcar {servico}',
  ],
  geral: ['Oi, quanto tá a {servico}?', 'Boa tarde! Qual o valor da {servico}?', 'Olá, vocês fazem {servico}?'],
};

/** Perguntas que a cliente faz no meio da conversa e a resposta da loja. */
export const PERGUNTAS: Array<{ cliente: string; loja: (s: Servico, unidade: string) => string; peso: number; tag?: string; especial?: 'gestante' | 'foto' }> = [
  { cliente: 'Dura quanto tempo?', loja: (s) => DURACAO[s], peso: 9 },
  { cliente: 'E quanto tempo leva no salão?', loja: (s) => DURACAO[s], peso: 3 },
  { cliente: 'Tem horário sábado?', loja: () => 'Tem sim! Sábado a gente abre das 10h às 22h. Tenho 10h, 14h e 16h30 livres, qual fica melhor pra você?', peso: 7 },
  { cliente: 'Vocês abrem domingo?', loja: () => 'Abrimos sim, domingo das 14h às 20h 😊', peso: 3 },
  {
    cliente: 'Pode fazer gestante?',
    loja: () => 'Para gestantes a gente pede a liberação do obstetra antes, tá? Nossa linha é sem formol, mas preferimos ter esse cuidado 💛',
    peso: 3,
    tag: 'Gestante',
    especial: 'gestante',
  },
  { cliente: '📷 [foto do cabelo]', loja: () => 'Recebi! Seu cabelo é médio e tem bastante volume, ficaria R$ 220. Vai ficar lindo 😍', peso: 6, especial: 'foto' },
  { cliente: 'Aceita cartão? Dá pra parcelar?', loja: () => 'Aceitamos Pix, débito e crédito em até 3x sem juros 💳', peso: 5 },
  { cliente: 'Precisa ir com o cabelo lavado?', loja: () => 'Não precisa! Só vem sem creme de pentear, de preferência com o cabelo lavado no dia anterior.', peso: 3 },
  { cliente: 'Pode fazer em cabelo com luzes?', loja: () => 'Pode sim! Antes a gente faz um teste de mecha para garantir que o fio aguenta 😉', peso: 4 },
  { cliente: 'Depois posso lavar no mesmo dia?', loja: () => 'Pode! A nossa é de lavagem imediata ✨', peso: 4 },
  {
    cliente: 'Onde fica a loja?',
    loja: (_s, u) => (u === 'norte' ? 'Ficamos no Salvador Norte Shopping, piso L2 📍' : 'Ficamos no Shopping Sumaré, 1º piso 📍'),
    peso: 4,
  },
  { cliente: 'Meu cabelo é bem cacheado, alisa mesmo?', loja: () => 'Alisa sim! Em cacheados e crespos a gente usa a técnica certa para o seu fio, e o resultado fica bem natural 💁‍♀️', peso: 4 },
];

export const ESPERA_CLIENTE = [
  'Vou ver com meu marido e te falo',
  'Deixa eu me organizar e te chamo semana que vem',
  'Vou esperar o salário cair kkkk já te chamo',
  'Vou pensar e te dou retorno',
  'Ok, vou ver minha agenda do trabalho',
  'Tá bom, depois te falo o dia',
];

export const RESPOSTA_ESPERA = ['Combinado! Fico no aguardo 💛', 'Tá certo! Qualquer coisa é só chamar aqui 😊', 'Perfeito, quando decidir é só me chamar ✨'];

export const PERDAS: Array<{ motivo: string; cliente?: string; loja?: string; peso: number }> = [
  { motivo: 'followups_esgotados', peso: 7 },
  { motivo: 'Achou o preço alto', cliente: 'Achei um pouquinho caro, vou pensar', loja: 'Entendo! Se mudar de ideia é só chamar, às vezes temos condições especiais 😉', peso: 5 },
  { motivo: 'Fechou com outro salão', cliente: 'Já marquei em outro lugar, obrigada', loja: 'Tudo bem! Se precisar estamos por aqui 💛', peso: 4 },
  { motivo: 'Mora longe da unidade', cliente: 'Ah, moro em Lauro, fica longe pra mim', loja: 'Poxa! Se passar pelo shopping é só chamar 😊', peso: 3 },
  { motivo: 'Vai deixar para o próximo mês', cliente: 'Esse mês não vai dar, fica pro próximo', loja: 'Combinado! Te espero no mês que vem 💛', peso: 3 },
];

export const AGRADECE = ['Obrigada!!', 'Perfeito, obrigada 😘', 'Show, obrigada!', 'Combinado 💛', 'Obrigadaaa'];

export const ELOGIOS = ['Amei demais!! Todo mundo elogiou 😍', 'Ficou perfeito, obrigada!', 'Amei o resultado, super natural ✨', 'Tô apaixonada no meu cabelo 💛'];

export const TIPOS_CABELO = ['Liso', 'Ondulado', 'Cacheado', 'Crespo'];
export const ALERGIAS = ['Couro cabeludo sensível', 'Alergia a amônia', 'Rinite: evitar produto com cheiro forte'];
export const OBSERVACOES = [
  'Prefere horário depois das 18h.',
  'Cabelo com luzes: fazer teste de mecha antes.',
  'Sempre faz com a mesma profissional.',
  'Gosta de lembrete na véspera.',
  'Veio com a irmã da última vez.',
  'Prefere pagar no Pix.',
];

export const RESPOSTAS_RAPIDAS_DEMO: Array<{ atalho: string; texto: string }> = [
  {
    atalho: 'preco',
    texto: 'Oi, {nome}! 💛 Nossos valores:\n• Progressiva: a partir de R$ 180 (curto), R$ 220 (médio), R$ 260 (longo)\n• Selagem: R$ 150\n• Botox capilar: R$ 120\n• Hidratação: R$ 80\nO valor final a gente confirma vendo o volume do cabelo 😊',
  },
  { atalho: 'horarios', texto: 'Funcionamos de segunda a sábado das 10h às 22h e domingo das 14h às 20h, nas duas unidades 😊' },
  { atalho: 'endereco-norte', texto: 'Unidade Salvador Norte Shopping 📍 Piso L2, perto da praça de alimentação. Te esperamos!' },
  { atalho: 'endereco-sumare', texto: 'Unidade Shopping Sumaré 📍 1º piso. Te esperamos!' },
  { atalho: 'pix', texto: 'Pode pagar no Pix, débito ou crédito em até 3x sem juros. O Pix é feito na hora, no salão 💳' },
  { atalho: 'pos', texto: 'Oi, {nome}! Como ficou o cabelo? 💛 Lembre: shampoo sem sal e nada de prender o cabelo molhado nos primeiros dias. Qualquer dúvida é só chamar!' },
];

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

/** Valores fechados no agendamento (R$), para o comercial, a TV e os relatórios terem números de verdade. */
export const VALORES: Record<Servico, number[]> = {
  progressiva: [180, 220, 220, 260, 260, 290],
  selagem: [150, 150, 180],
  botox: [120, 120, 140],
  hidratacao: [80, 80, 95],
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

// ---------------------------------------------------------------- segmentos

/**
 * Material de um segmento: tudo o que muda entre a demonstração da Império (salão, padrão) e a da clínica de estética
 * (usada nos prints da página de vendas). As chaves de serviço são as mesmas; só nomes, valores e falas mudam.
 */
export type Segmento = 'imperio' | 'estetica';
export interface Material {
  empresa: string;
  /** Nome e rosto (src/demo/rostos) de cada atendente, na ordem de ATENDENTES_DEMO. */
  equipe: Array<{ nome: string; rosto: string }>;
  unidades: Record<'norte' | 'sumare', string>;
  profissionais: Record<'norte' | 'sumare', string[]>;
  servicos: Record<Servico, { nome: string; tag: string | null; duracaoMin: number }>;
  pesoServico: Array<readonly [Servico, number]>;
  valores: Record<Servico, number[]>;
  preco: Record<Servico, string>;
  duracao: Record<Servico, string>;
  aberturas: Record<Origem | 'geral', string[]>;
  perguntas: Array<{ cliente: string; loja: (s: Servico, unidade: string) => string; peso: number; tag?: string; especial?: 'gestante' | 'foto' }>;
  esperaCliente: string[];
  respostaEspera: string[];
  perdas: Array<{ motivo: string; cliente?: string; loja?: string; peso: number }>;
  agradece: string[];
  elogios: string[];
  observacoes: string[];
  alergias: string[];
  /** Pergunta que fica sem resposta (aparece em "Não lidas", com o selo de espera). */
  duvidaSolta: string[];
  retorno: string[];
  posAtendimento: (nome: string) => string;
  respostaElogio: string[];
  manutencao: (nome: string, servico: string) => string;
  /** Campo de lista da ficha (chave interna tipoCabelo). */
  campoTipo: { nome: string; opcoes: Array<readonly [string, number]> };
  tags: Array<[string, string]>;
  respostasRapidas: Array<{ atalho: string; texto: string }>;
}

export const MATERIAL_IMPERIO: Material = {
  empresa: 'Império Progressivas',
  equipe: ATENDENTES_DEMO.map((a, i) => ({ nome: a.nome, rosto: `rosto-0${i + 1}.jpg` })),
  unidades: { norte: 'Salvador Norte Shopping', sumare: 'Shopping Sumaré' },
  profissionais: PROFISSIONAIS,
  servicos: SERVICOS,
  pesoServico: [['progressiva', 55], ['selagem', 20], ['botox', 17], ['hidratacao', 8]],
  valores: VALORES,
  preco: PRECO,
  duracao: DURACAO,
  aberturas: ABERTURAS,
  perguntas: PERGUNTAS,
  esperaCliente: ESPERA_CLIENTE,
  respostaEspera: RESPOSTA_ESPERA,
  perdas: PERDAS,
  agradece: AGRADECE,
  elogios: ELOGIOS,
  observacoes: OBSERVACOES,
  alergias: ALERGIAS,
  duvidaSolta: ['E pra cabelo com química, pode?', 'Tem horário pra amanhã?', 'Vocês têm estacionamento?'],
  retorno: ['Oi! Tá na hora da minha manutenção, tem horário essa semana?', 'Oii, quero retocar minha progressiva 💛 tem horário?'],
  posAtendimento: (nome) => `Oi, ${nome}! Como ficou o cabelo? Qualquer dúvida sobre os cuidados é só chamar 💛`,
  respostaElogio: ['Que alegria! 😍 Te esperamos na manutenção daqui a uns 3 meses ✨', 'Ahh que bom! Obrigada pela confiança 💛'],
  manutencao: (nome, servico) => `Oi, ${nome}! Já faz uns 3 meses da sua ${servico.toLowerCase()}, tá na hora da manutenção ✨ Quer que eu veja um horário pra você?`,
  campoTipo: { nome: 'Tipo de cabelo', opcoes: [['Liso', 10], ['Ondulado', 30], ['Cacheado', 38], ['Crespo', 22]] },
  tags: [
    ['Progressiva', '#3E63DD'],
    ['Selagem', '#12A594'],
    ['Botox capilar', '#8E4EC6'],
    ['VIP', '#D4A017'],
    ['Instagram', '#D6409F'],
    ['Indicação', '#30A46C'],
    ['Tráfego pago', '#F76B15'],
    ['Gestante', '#E5484D'],
  ],
  respostasRapidas: RESPOSTAS_RAPIDAS_DEMO,
};

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR');
const SERVICOS_ESTETICA: Material['servicos'] = {
  progressiva: { nome: 'Harmonização facial', tag: 'Harmonização facial', duracaoMin: 120 },
  selagem: { nome: 'Bioestimulador', tag: 'Bioestimulador', duracaoMin: 60 },
  botox: { nome: 'Toxina botulínica', tag: 'Toxina botulínica', duracaoMin: 45 },
  hidratacao: { nome: 'Preenchimento labial', tag: 'Preenchimento labial', duracaoMin: 60 },
};

/** Clínica de estética de alto padrão (Jardins e Itaim): usada nos prints da página de vendas. */
export const MATERIAL_ESTETICA: Material = {
  empresa: 'Lumière Estética Avançada',
  // Os mesmos rostos e nomes do painel da TV na página de vendas.
  equipe: [
    { nome: 'Camila Moreira', rosto: 'rosto-03.jpg' },
    { nome: 'Beatriz Nunes', rosto: 'rosto-14.jpg' },
    { nome: 'Larissa Moura', rosto: 'rosto-07.jpg' },
    { nome: 'Daniela Reis', rosto: 'rosto-13.jpg' },
  ],
  unidades: { norte: 'Jardins', sumare: 'Itaim' },
  profissionais: { norte: ['Dra. Helena', 'Dra. Bianca', 'Dr. André'], sumare: ['Dra. Paula', 'Dra. Marina', 'Dr. Fábio'] },
  servicos: SERVICOS_ESTETICA,
  pesoServico: [['progressiva', 38], ['botox', 26], ['hidratacao', 20], ['selagem', 16]],
  valores: { progressiva: [4800, 5200, 5900, 6400], selagem: [2400, 2800, 3200], botox: [1290, 1490, 1690], hidratacao: [1690, 1890, 2190] },
  preco: {
    progressiva: `A harmonização facial completa fica a partir de ${brl(4800)}, em até 10x sem juros. A Dra. monta o plano na avaliação, que é cortesia ✨`,
    selagem: `O bioestimulador de colágeno sai por ${brl(2800)} a sessão. Normalmente indicamos 2 sessões com 60 dias de intervalo 😊`,
    botox: `A toxina botulínica (testa, glabela e pés de galinha) fica ${brl(1490)}, já com o retorno de 15 dias incluso 💆‍♀️`,
    hidratacao: `O preenchimento labial com ácido hialurônico fica a partir de ${brl(1690)}, com resultado bem natural 💋`,
  },
  duracao: {
    progressiva: 'O resultado dura de 12 a 18 meses, dependendo da área. O procedimento leva cerca de 1h30, com anestésico.',
    selagem: 'O colágeno começa a aparecer em 30 dias e o efeito dura até 2 anos. A aplicação leva uns 40 minutos.',
    botox: 'O efeito começa em 3 a 5 dias e dura de 4 a 6 meses. A aplicação leva uns 20 minutos.',
    hidratacao: 'Dura de 9 a 12 meses. A aplicação leva uns 40 minutos e você sai pronta para a rotina.',
  },
  aberturas: {
    Instagram: ['Oi! Vi o antes e depois de vocês no Instagram, quanto fica a {servico}?', 'Boa tarde! Vim pelo Instagram, queria saber o valor da {servico}', 'Oii, amei os resultados no insta 😍 como funciona a {servico}?'],
    'Tráfego pago': ['Olá! Vi o anúncio de vocês, qual o valor da {servico}?', 'Oi, cliquei no anúncio. Como funciona a {servico}?', 'Boa noite! Vi o anúncio da avaliação gratuita, quero saber da {servico}'],
    Indicação: ['Oi! Minha amiga fez {servico} com a Dra. e indicou, queria saber o valor', 'Boa tarde, foi a minha irmã que me passou o contato. Quanto fica a {servico}?', 'Oi, tudo bem? Uma colega indicou vocês pra {servico} 💛'],
    Google: ['Oi, achei vocês no Google. Fazem {servico}?', 'Bom dia! Vocês fazem {servico}? Qual o valor?'],
    'Passou na loja': ['Oi! Passei na clínica ontem e peguei o cartão. Quanto fica a {servico}?', 'Boa tarde, passei aí na Oscar Freire e queria marcar uma avaliação de {servico}'],
    geral: ['Oi, quanto fica a {servico}?', 'Boa tarde! Qual o valor da {servico}?', 'Olá, vocês fazem {servico}?'],
  },
  perguntas: [
    { cliente: 'Dura quanto tempo?', loja: (s) => MATERIAL_ESTETICA.duracao[s], peso: 9 },
    { cliente: 'Dói? Tem anestesia?', loja: () => 'Usamos anestésico tópico e a agulha é bem fininha, a maioria das clientes sente só um incômodo leve 😊', peso: 5 },
    { cliente: 'Tem horário sábado?', loja: () => 'Tem sim! Sábado atendemos das 9h às 15h. Tenho 10h e 13h30 livres, qual fica melhor pra você?', peso: 7 },
    { cliente: 'Posso fazer estando grávida?', loja: () => 'Na gestação a gente não faz toxina nem preenchimento, tá? A Dra. pode te passar um protocolo seguro de pele até lá 💛', peso: 3, tag: 'Gestante', especial: 'gestante' },
    { cliente: '📷 [foto do rosto]', loja: () => `Recebi! Pelo que vi, o ideal é olheira + mandíbula, a partir de ${brl(5200)}. Na avaliação a Dra. confirma tudo 😍`, peso: 5, especial: 'foto' },
    { cliente: 'Dá pra parcelar?', loja: () => 'Dá sim! Pix com 5% de desconto ou cartão em até 10x sem juros 💳', peso: 6 },
    { cliente: 'Fica natural? Tenho medo de ficar artificial', loja: () => 'Fica super natural! A Dra. Helena trabalha com dose conservadora e você aprova cada ponto antes 😉', peso: 5 },
    { cliente: 'Quanto tempo de recuperação?', loja: () => 'É bem tranquilo: pode ficar um inchaço leve por 2 ou 3 dias, e você já volta para a rotina no mesmo dia ✨', peso: 4 },
    { cliente: 'Onde fica a clínica?', loja: (_s, u) => (u === 'norte' ? 'Estamos nos Jardins, na Alameda Lorena, pertinho da Oscar Freire 📍' : 'Estamos no Itaim, na Rua Joaquim Floriano 📍'), peso: 4 },
    { cliente: 'A avaliação é paga?', loja: () => 'A avaliação com a Dra. é cortesia e leva uns 30 minutos 😊', peso: 4 },
  ],
  esperaCliente: ['Vou ver minha agenda e te falo', 'Deixa eu me organizar e te chamo semana que vem', 'Vou pensar com calma e te dou retorno', 'Vou esperar o cartão virar e te chamo', 'Ok, vou falar com meu marido'],
  respostaEspera: ['Combinado! Fico no aguardo 💛', 'Tá certo! Qualquer dúvida é só chamar aqui 😊', 'Perfeito, quando decidir é só me chamar ✨'],
  perdas: [
    { motivo: 'followups_esgotados', peso: 7 },
    { motivo: 'Achou o preço alto', cliente: 'Achei um pouco acima do que eu imaginava, vou pensar', loja: 'Entendo! Se quiser, monto um plano por etapas que cabe melhor 😉', peso: 5 },
    { motivo: 'Fechou com outra clínica', cliente: 'Já marquei em outro lugar, obrigada', loja: 'Tudo bem! Se precisar estamos por aqui 💛', peso: 4 },
    { motivo: 'Vai deixar para o próximo mês', cliente: 'Esse mês não vai dar, fica pro próximo', loja: 'Combinado! Te espero no mês que vem 💛', peso: 3 },
  ],
  agradece: ['Obrigada!!', 'Perfeito, obrigada 😘', 'Show, obrigada!', 'Combinado 💛', 'Obrigadaaa'],
  elogios: ['Amei demais!! Ficou super natural 😍', 'Ficou perfeito, obrigada Dra.!', 'Todo mundo disse que eu tô descansada ✨', 'Tô apaixonada no resultado 💛'],
  observacoes: ['Prefere horário depois das 18h.', 'Sempre com a Dra. Helena.', 'Gosta de lembrete na véspera.', 'Prefere pagar no Pix.', 'Primeira vez com toxina: explicar o retorno de 15 dias.'],
  alergias: ['Alergia a lidocaína', 'Pele sensível', 'Usa anticoagulante: avisar a Dra.'],
  duvidaSolta: ['E pra quem tem pele sensível, pode?', 'Tem horário pra amanhã?', 'Vocês têm estacionamento?'],
  retorno: ['Oi! Tá na hora de reaplicar a toxina, tem horário essa semana?', 'Oii, quero fazer o retoque da harmonização 💛 tem horário?'],
  posAtendimento: (nome) => `Oi, ${nome}! Como você está se sentindo? Evite academia e sol forte hoje, e qualquer dúvida é só chamar 💛`,
  respostaElogio: ['Que alegria! 😍 Te esperamos no retorno de 15 dias ✨', 'Ahh que bom! Obrigada pela confiança 💛'],
  manutencao: (nome, servico) => `Oi, ${nome}! Já faz uns 5 meses da sua ${servico.toLowerCase()}, tá na hora da reaplicação ✨ Quer que eu veja um horário com a Dra.?`,
  campoTipo: { nome: 'Área de interesse', opcoes: [['Rosto', 40], ['Lábios', 22], ['Papada', 18], ['Pele', 20]] },
  tags: [
    ['Harmonização facial', '#3E63DD'],
    ['Bioestimulador', '#12A594'],
    ['Toxina botulínica', '#8E4EC6'],
    ['Preenchimento labial', '#D6409F'],
    ['VIP', '#D4A017'],
    ['Instagram', '#E5484D'],
    ['Indicação', '#30A46C'],
    ['Tráfego pago', '#F76B15'],
    ['Gestante', '#E5484D'],
  ],
  respostasRapidas: [
    { atalho: 'preco', texto: `Oi, {nome}! 💛 Nossos valores:\n• Harmonização facial: a partir de ${brl(4800)}\n• Bioestimulador: ${brl(2800)} a sessão\n• Toxina botulínica: ${brl(1490)}\n• Preenchimento labial: a partir de ${brl(1690)}\n• Lipo de papada enzimática: a partir de ${brl(3900)}\nEm até 10x sem juros. A avaliação é cortesia 😊` },
    { atalho: 'horarios', texto: 'Atendemos de segunda a sexta das 9h às 20h e sábado das 9h às 15h, nos Jardins e no Itaim 😊' },
    { atalho: 'endereco-jardins', texto: 'Unidade Jardins 📍 Alameda Lorena, pertinho da Oscar Freire. Temos manobrista!' },
    { atalho: 'endereco-itaim', texto: 'Unidade Itaim 📍 Rua Joaquim Floriano. Temos manobrista!' },
    { atalho: 'pos', texto: 'Oi, {nome}! Nas próximas 24 h evite academia, sol forte e deitar de bruços. Qualquer dúvida é só chamar 💛' },
  ],
};

export const materialDo = (s?: Segmento): Material => (s === 'estetica' ? MATERIAL_ESTETICA : MATERIAL_IMPERIO);

/** Fotos de perfil das clientes de demonstração (src/demo/clientes): nenhuma é rosto de atendente da demonstração. */
export const FOTOS_CLIENTES_F = Array.from({ length: 17 }, (_, i) => `f-${String(i + 1).padStart(2, '0')}.jpg`);
export const FOTOS_CLIENTES_M = ['m-01.jpg', 'm-02.jpg'];

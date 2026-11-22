/*
 * Calculadoras da página de vendas.
 * Na página: window.SintoniaCalculadora.escala6x1({ horas, salario }) (nova jornada × Colaborador de IA).
 * Também: window.SintoniaCalculadora.calcular({ atendentes, salario, encargos, beneficios, conversas })
 * calculadora: window.SintoniaCalculadora.simular({ atendentes, salario, encargos, beneficios, horas, mensagens, ficam })
 *   (a calculadora da página de vendas: equipe de hoje × fim da 6x1 × pessoas + Colaborador de IA).
 *
 * Funcionários: (salário × (1 + encargos%) + benefícios) × atendentes.
 * Colaborador de IA: R$ 1.997/mês + créditos estimados. ESTIMATIVA: o plano cobre cerca de
 * 1.500 conversas por mês e cada recarga de R$ 99 cobre cerca de 190 conversas a mais.
 */
(function (raiz) {
  'use strict';

  var PREMISSAS = Object.freeze({
    precoPlano: 1997,
    conversasIncluidas: 1500,
    precoRecarga: 99,
    conversasPorRecarga: 190,
    horasSemanaIA: 168,
    // Fim da escala 6x1 (EC 141/2026): 44 h → 42 h → 40 h por semana, mesmo salário.
    horasSemanaFuncionario: 40,
  });

  var PADRAO = Object.freeze({ atendentes: 1, salario: 1800, encargos: 70, beneficios: 600, conversas: 1500 });

  function numero(v, padrao, min, max) {
    var n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v);
    if (!isFinite(n)) n = padrao;
    return Math.min(max, Math.max(min, n));
  }

  function calcular(entradas) {
    var e = entradas || {};
    var atendentes = Math.round(numero(e.atendentes, PADRAO.atendentes, 1, 10));
    var salario = numero(e.salario, PADRAO.salario, 0, 1000000);
    var encargos = numero(e.encargos, PADRAO.encargos, 0, 300);
    var beneficios = numero(e.beneficios, PADRAO.beneficios, 0, 1000000);
    var conversas = Math.round(numero(e.conversas, PADRAO.conversas, 0, 10000000));

    var porFuncionario = salario * (1 + encargos / 100) + beneficios;
    var funcionariosMes = porFuncionario * atendentes;

    var excedente = Math.max(0, conversas - PREMISSAS.conversasIncluidas);
    var recargas = Math.ceil(excedente / PREMISSAS.conversasPorRecarga);
    var creditosMes = recargas * PREMISSAS.precoRecarga;
    var iaMes = PREMISSAS.precoPlano + creditosMes;

    var economiaMes = funcionariosMes - iaMes;
    var horasEquipe = PREMISSAS.horasSemanaFuncionario * atendentes;

    return {
      entradas: { atendentes: atendentes, salario: salario, encargos: encargos, beneficios: beneficios, conversas: conversas },
      funcionarios: { porFuncionario: arred(porFuncionario), mes: arred(funcionariosMes), ano: arred(funcionariosMes * 12) },
      ia: { plano: PREMISSAS.precoPlano, recargas: recargas, creditos: creditosMes, mes: iaMes, ano: iaMes * 12, estimativa: true },
      economia: { mes: arred(economiaMes), ano: arred(economiaMes * 12), percentual: funcionariosMes > 0 ? Math.round((economiaMes / funcionariosMes) * 100) : 0 },
      horas: {
        ia: PREMISSAS.horasSemanaIA,
        funcionario: PREMISSAS.horasSemanaFuncionario,
        equipe: horasEquipe,
        vezes: Math.round((PREMISSAS.horasSemanaIA / PREMISSAS.horasSemanaFuncionario) * 10) / 10,
      },
    };
  }

  function arred(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Calculadora da nova jornada (fim da escala 6x1, EC 141/2026: 44 h → 42 h → 40 h, mesmo salário).
   * Entradas: horas por semana que a empresa atende e salário médio.
   * Pessoas necessárias = horas ÷ jornada, arredondado para cima.
   * Custo por pessoa = salário × 1,7 (encargos) + R$ 600 (benefícios).
   * Com IA: 1 pessoa + Colaborador de IA (R$ 1.997/mês), que cobre as 168 h da semana.
   */
  function escala6x1(entradas) {
    var e = entradas || {};
    var horas = Math.round(numero(e.horas, 84, 1, 168));
    var salario = numero(e.salario, PADRAO.salario, 0, 1000000);
    var porPessoa = salario * (1 + PADRAO.encargos / 100) + PADRAO.beneficios;
    function cenario(j) { var p = Math.ceil(horas / j); return { jornada: j, pessoas: p, mes: arred(p * porPessoa), ano: arred(p * porPessoa * 12), hora: arred(porPessoa / (j * 4.33)) }; }
    var antes = cenario(44), transicao = cenario(42), depois = cenario(40);
    var comIaMes = porPessoa + PREMISSAS.precoPlano;
    var economiaMes = depois.mes - comIaMes;
    return {
      horas: horas, porPessoa: arred(porPessoa), antes: antes, transicao: transicao, depois: depois,
      aumentoHora: Math.round((depois.hora / antes.hora - 1) * 100),
      comIa: { pessoas: 1, ia: PREMISSAS.precoPlano, mes: arred(comIaMes), ano: arred(comIaMes * 12), horas: PREMISSAS.horasSemanaIA },
      economia: { mes: arred(economiaMes), ano: arred(economiaMes * 12), percentual: depois.mes > 0 ? Math.round((economiaMes / depois.mes) * 100) : 0 },
    };
  }


  /**
   * calculadora: a conta da página de vendas, com os números da própria empresa.
   * - custo por pessoa = salário × (1 + encargos%) + benefícios; equipe de hoje = atendentes × custo (jornada de 44 h);
   * - fim da 6x1 (EC 141/2026): a jornada cai para 40 h com o mesmo salário. Para manter as mesmas horas de trabalho
   *   da equipe (atendentes × 44 h), são ⌈atendentes × 44 ÷ 40⌉ pessoas; a perda é o custo das pessoas a mais;
   *   a hora de trabalho fica 10% mais cara;
   * - com a IA: `ficam` pessoas (padrão 1) + Colaborador de IA (R$ 1.997/mês), que atende 24 h, 7 dias (168 h);
   * - economia = equipe na nova jornada − com a IA;
   * - mensagens por dia × 2 min = horas por mês que a equipe passa só respondendo (a IA responde em segundos);
   * - horas por semana em que a empresa atende: a IA cobre também as outras 168 − h (noite, domingo, feriado).
   */
  function simular(entradas) {
    var e = entradas || {};
    var atendentes = Math.round(numero(e.atendentes, 2, 1, 50));
    var salario = numero(e.salario, PADRAO.salario, 0, 1000000);
    var encargos = numero(e.encargos, PADRAO.encargos, 0, 300);
    var beneficios = numero(e.beneficios, PADRAO.beneficios, 0, 1000000);
    var horas = Math.round(numero(e.horas, 60, 1, 168));
    var mensagens = Math.round(numero(e.mensagens, 150, 0, 1000000));
    var ficam = Math.round(numero(e.ficam, 1, 0, atendentes));
    var porPessoa = salario * (1 + encargos / 100) + beneficios;
    var semanasMes = 52 / 12;

    var hoje = { pessoas: atendentes, jornada: 44, mes: arred(atendentes * porPessoa), horasSemana: atendentes * 44 };
    var pessoasDepois = Math.ceil((atendentes * 44) / 40);
    var depois = { pessoas: pessoasDepois, jornada: 40, mes: arred(pessoasDepois * porPessoa), horasSemana: atendentes * 40 };
    var perda = {
      pessoas: pessoasDepois - atendentes,
      mes: arred(depois.mes - hoje.mes),
      ano: arred((depois.mes - hoje.mes) * 12),
      horasSemana: atendentes * 4,
      horasMes: Math.round(atendentes * 4 * semanasMes),
      hora: Math.round((44 / 40 - 1) * 100),
    };
    var comIaMes = ficam * porPessoa + PREMISSAS.precoPlano;
    var economiaMes = depois.mes - comIaMes;
    var horasRespondendo = Math.round((mensagens * 30 * 2) / 60);
    var horaPessoa = porPessoa / (40 * semanasMes);
    return {
      entradas: { atendentes: atendentes, salario: salario, encargos: encargos, beneficios: beneficios, horas: horas, mensagens: mensagens, ficam: ficam },
      porPessoa: arred(porPessoa),
      hoje: hoje,
      depois: depois,
      perda: perda,
      comIa: { pessoas: ficam, ia: PREMISSAS.precoPlano, mes: arred(comIaMes), ano: arred(comIaMes * 12), horasSemana: PREMISSAS.horasSemanaIA, foraDoHorario: Math.max(0, PREMISSAS.horasSemanaIA - horas) },
      economia: { mes: arred(economiaMes), ano: arred(economiaMes * 12), percentual: depois.mes > 0 ? Math.round((economiaMes / depois.mes) * 100) : 0 },
      mensagens: { horasMes: horasRespondendo, valorMes: arred(horasRespondendo * horaPessoa), pessoas: Math.round((horasRespondendo / (40 * semanasMes)) * 10) / 10 },
    };
  }

  raiz.SintoniaCalculadora = Object.freeze({ calcular: calcular, escala6x1: escala6x1, simular: simular, PREMISSAS: PREMISSAS, PADRAO: PADRAO });
})(typeof window !== 'undefined' ? window : globalThis);

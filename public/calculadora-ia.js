/*
 * Calculadora "Quanto custa ter IA no seu negócio" (página de vendas e app).
 * Uso: window.SintoniaCalculadora.calcular({ atendentes, salario, encargos, beneficios, conversas })
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
    horasSemanaFuncionario: 44,
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

  raiz.SintoniaCalculadora = Object.freeze({ calcular: calcular, PREMISSAS: PREMISSAS, PADRAO: PADRAO });
})(typeof window !== 'undefined' ? window : globalThis);

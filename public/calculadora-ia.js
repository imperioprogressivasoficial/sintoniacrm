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

  /**
   * Equipe de 2027: a equipe de hoje (só pessoas) × 1 pessoa (ou poucas) + Colaborador de IA.
   * Custo por pessoa = salário × (1 + encargos%) + benefícios. IA = plano + créditos estimados.
   * Capacidade: cada pessoa conversa com ~3 clientes ao mesmo tempo no WhatsApp (premissa); a IA, com todos.
   */
  function equipe2027(entradas) {
    var e = entradas || {};
    var hoje = Math.round(numero(e.equipe, 4, 1, 30));
    var depois = Math.round(numero(e.pessoas, 1, 1, hoje));
    var salario = numero(e.salario, PADRAO.salario, 0, 1000000);
    var encargos = numero(e.encargos, PADRAO.encargos, 0, 300);
    var beneficios = numero(e.beneficios, PADRAO.beneficios, 0, 1000000);
    var conversas = Math.round(numero(e.conversas, 400 * hoje, 0, 10000000));
    var porPessoa = salario * (1 + encargos / 100) + beneficios;
    var excedente = Math.max(0, conversas - PREMISSAS.conversasIncluidas);
    var recargas = Math.ceil(excedente / PREMISSAS.conversasPorRecarga);
    var ia = PREMISSAS.precoPlano + recargas * PREMISSAS.precoRecarga;
    var custoHoje = porPessoa * hoje;
    var custo2027 = porPessoa * depois + ia;
    var economia = custoHoje - custo2027;
    return {
      hoje: { pessoas: hoje, mes: arred(custoHoje), ano: arred(custoHoje * 12), horasSemana: 44, simultaneas: hoje * 3, porConversa: conversas ? arred(custoHoje / conversas) : 0 },
      depois: { pessoas: depois, ia: ia, recargas: recargas, mes: arred(custo2027), ano: arred(custo2027 * 12), horasSemana: 168, simultaneas: null, porConversa: conversas ? arred(custo2027 / conversas) : 0 },
      conversas: conversas,
      economia: { mes: arred(economia), ano: arred(economia * 12), percentual: custoHoje > 0 ? Math.round((economia / custoHoje) * 100) : 0 },
      horasLivres: (hoje - depois) * 44,
    };
  }

  raiz.SintoniaCalculadora = Object.freeze({ calcular: calcular, equipe2027: equipe2027, PREMISSAS: PREMISSAS, PADRAO: PADRAO });
})(typeof window !== 'undefined' ? window : globalThis);

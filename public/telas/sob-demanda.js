/* velocidade: telas que não são da primeira vista carregam só quando a pessoa abre (ou em segundo plano, depois
 * que a lista de Conversas já apareceu). Antes, o app baixava e rodava ~2,8 MB de JS (83 arquivos) antes de ficar
 * pronto; Dashboard, Pipeline, Análises, Automações, Bot, Transmissões, IA… nem são vistos na abertura.
 *
 * Como funciona:
 *  - Os <script> dessas telas ficam no app.html dentro de <template id="telas-sob-demanda"> (o servidor põe ?v=<versão>
 *    neles como em qualquer <script>; dentro do <template> o navegador não baixa nem roda nada).
 *  - Enquanto a tela não chegou, window.SintoniaTelas.<tela> é um "substituto" com os mesmos métodos: uma ação
 *    (desenhar, focar, irAba, novaTarefa…) fica guardada, a tela é baixada e, quando chega, a ação acontece de verdade,
 *    na mesma ordem. Consultas (aba, atual, valorMenu…) respondem "nada ainda", como antes da tela carregar.
 *    Assim, abrir pelo menu, pela barra, pelo endereço /app/<tela>, pelo voltar, pela busca e pelos atalhos continua igual.
 *  - Depois que a primeira tela está pronta, as outras vêm aos poucos quando o navegador está livre (uma por vez),
 *    para a próxima tela já abrir na hora. Com "economia de dados" ligada ou internet 2G, só sob demanda.
 * Carregado sem "defer" no <head> (antes de qualquer tela), logo depois de prioridade.js.
 * Registra window.SintoniaSobDemanda = { carregar(grupo), carregada(grupo), grupos }. */
(() => {
  'use strict';
  if (window.SintoniaSobDemanda) return;
  const T = (window.SintoniaTelas = window.SintoniaTelas || {});

  /* Cada grupo: arquivos em /telas/ (na ordem em que rodam), grupos que precisam vir antes e as telas que registra
   * (acoes = guardadas e feitas quando a tela chegar; outros = só valem com a tela carregada). */
  const GRUPOS = {
    ligacoes: { arquivos: ['ligacoes'], telas: { ligacoes: { acoes: ['desenhar', 'ligar', 'favoritos'], outros: ['recarregar', 'cartaoSerena'] } } },
    bot: { arquivos: ['bot'], telas: { bot: { acoes: ['desenhar', 'abrirEditor', 'escolherDaEtapa', 'iniciarNaConversa', 'novoBot'], outros: ['abasAutomacoes'] } } },
    automacoes: { precisa: ['bot', 'ligacoes'], arquivos: ['automacoes'], telas: { automacoes: { acoes: ['desenhar', 'abrirEditor', 'abrirDaEtapa', 'irAba'], outros: ['aba'] } } },
    funil: { arquivos: ['pos-venda' /* pos-venda */, 'funil', 'funil-topo', 'funil-celular', 'funil-modos', 'etapa-acoes', 'funil-regras' /* funil-atendimento */],
      telas: { funil: { acoes: ['desenhar', 'abrirFunil', 'novoFunil', 'menu', 'novoLead', 'pular'], outros: ['recarregar', 'redesenhar', 'atual'] }, etapaAcoes: { acoes: ['abrir'] } } },
    transmissoes: { arquivos: ['transmissoes'], telas: { transmissoes: { acoes: ['desenhar', 'novaComPublico'] } } },
    comercial: { arquivos: ['comercial'], telas: { comercial: { acoes: ['desenhar'] } } },
    painel: { precisa: ['comercial'], arquivos: ['painel'], telas: { painel: { acoes: ['desenhar', 'personalizar'] } } },
    relatorios: { arquivos: ['relatorios'], telas: { relatorios: { acoes: ['desenhar', 'focar'], outros: ['estilo'] } } },
    analises: { precisa: ['relatorios'], arquivos: ['analises', 'saude', 'relatorio-dia'], telas: { analises: { acoes: ['desenhar', 'focar'], outros: ['aba'] } } },
    desempenho: { arquivos: ['desempenho'], telas: { desempenho: { acoes: ['desenhar'] } } },
    leads: { arquivos: ['leads'], telas: { leads: { acoes: ['desenhar'] } } },
    clientes: { precisa: ['leads'], arquivos: ['clientes'], telas: { clientes: { acoes: ['desenhar', 'irAba'] } } },
    email: { precisa: ['leads'], arquivos: ['email'], telas: { email: { acoes: ['desenhar'], outros: ['ligarFicha'] } } },
    agenda: { arquivos: ['agenda'], telas: { agenda: { acoes: ['desenhar', 'novo'] } } },
    /* a faixa "A IA está no controle" da conversa aberta aparece assim que o grupo chega */
    ia: { arquivos: ['aprender' /* ia-aprende */, 'ia', 'economia-ia', 'agentes-ia', 'ia-estado'], depois: () => T.agentesIa?.faixaConversa?.(),
      telas: { ia: { acoes: ['desenhar'] }, economiaIa: { acoes: ['desenhar'] }, agentesIa: { acoes: ['desenhar', 'inicio'], outros: ['faixaConversa'] }, iaEstado: { acoes: ['desenhar'] } } },
    integracoes: { arquivos: ['integracoes'], telas: { integracoes: { acoes: ['desenhar'], outros: ['recarregar'] } } },
    reunioes: { arquivos: ['reunioes'], telas: { reunioes: { acoes: ['desenhar'], outros: ['css'] } } },
    scripts: { precisa: ['reunioes'], arquivos: ['scripts'], telas: { scripts: { acoes: ['desenhar'] } } },
    distribuicao: { arquivos: ['distribuicao'], telas: { distribuicao: { acoes: ['desenhar'] } } },
    rotina: { arquivos: ['rotina'], telas: { rotina: { acoes: ['desenhar', 'novaTarefa'], outros: ['resumo', 'valorMenu', 'css'] } } },
  };
  /** Ordem em segundo plano: o que mais se abre primeiro. */
  const ORDEM = ['funil', 'painel', 'agenda', 'rotina', 'ligacoes', 'clientes', 'ia', 'automacoes', 'analises', 'relatorios', 'desempenho',
    'transmissoes', 'email', 'reunioes', 'scripts', 'distribuicao', 'integracoes', 'comercial', 'bot', 'leads'];

  const estado = {}; // grupo -> Promise (carregando ou carregado)
  const pronto = new Set(); // grupos já rodados
  const fila = []; // { tela, metodo, args, ok, erro }
  const reais = {}; // tela -> objeto de verdade (quando chega)
  const grupoDa = {};

  // ------------------------------------------------------------ endereços (com ?v=) vindos do <template>
  let enderecos = null;
  function endereco(arquivo) {
    if (!enderecos) {
      const t = document.getElementById('telas-sob-demanda');
      if (!t) return null;
      enderecos = {};
      t.content.querySelectorAll('script[src]').forEach((s) => {
        const src = s.getAttribute('src'); const m = /\/telas\/([^/?#]+)\.js/.exec(src || '');
        if (m) enderecos[m[1]] = src;
      });
    }
    return enderecos[arquivo] || `/telas/${arquivo}.js`;
  }
  const documentoPronto = () => (document.readyState === 'loading' ? new Promise((ok) => document.addEventListener('DOMContentLoaded', ok, { once: true })) : Promise.resolve());

  function baixar(arquivo) {
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = endereco(arquivo); s.async = false; // async=false: rodam na ordem em que entram, baixando ao mesmo tempo
      s.dataset.sobDemanda = arquivo;
      s.onload = () => ok();
      s.onerror = () => { s.remove(); erro(new Error('falhou ' + arquivo)); };
      document.head.append(s);
    });
  }

  /** Baixa e roda o grupo (e o que ele precisa antes). Devolve uma Promise que resolve quando está tudo de pé. */
  function carregar(nome) {
    const g = GRUPOS[nome];
    if (!g) return Promise.resolve();
    if (estado[nome]) return estado[nome];
    estado[nome] = (async () => {
      await documentoPronto();
      await Promise.all((g.precisa || []).map(carregar));
      await Promise.all(g.arquivos.map(baixar));
      pronto.add(nome);
      try { g.depois?.(); } catch (x) { console.error(x); }
      repetir(nome);
    })().catch((x) => {
      delete estado[nome]; // na próxima vez tenta de novo
      console.error(x);
      const telas = Object.keys(g.telas);
      for (let i = fila.length - 1; i >= 0; i--) if (telas.includes(fila[i].tela)) { const f = fila.splice(i, 1)[0]; f.erro(x); }
      tirarAvisos();
      try { window.Sintonia?.ui?.toast?.('Não deu para abrir esta tela agora. Confira a internet e tente de novo.'); } catch {}
      throw x;
    });
    return estado[nome];
  }

  /** A tela chegou: faz, na ordem, o que foi pedido enquanto ela não estava aqui. */
  function repetir(nome) {
    const telas = Object.keys(GRUPOS[nome].telas);
    const minhas = fila.filter((f) => telas.includes(f.tela));
    for (const f of minhas) fila.splice(fila.indexOf(f), 1);
    for (const f of minhas) {
      if (f.metodo === 'desenhar') tirarAviso(f.args[0]);
      const real = reais[f.tela];
      const fn = real && real[f.metodo];
      if (typeof fn !== 'function') { f.ok(undefined); continue; }
      try { Promise.resolve(fn.apply(real, f.args)).then(f.ok, f.erro); } catch (x) { console.error(x); f.erro(x); }
    }
  }

  // ------------------------------------------------------------ aviso "Abrindo…" na tela vazia (sem animação)
  function avisar(caixa) {
    if (!(caixa instanceof Element)) return;
    setTimeout(() => {
      if (!caixa.isConnected || caixa.childElementCount || !fila.some((f) => f.args[0] === caixa)) return;
      if (!document.getElementById('sd-css')) {
        const st = document.createElement('style'); st.id = 'sd-css';
        st.textContent = '.sd-abrindo{display:grid;place-items:center;min-height:50vh;color:var(--sub,#64748b);font-size:14px;letter-spacing:.01em}';
        document.head.append(st);
      }
      const d = document.createElement('div'); d.className = 'sd-abrindo'; d.setAttribute('role', 'status'); d.dataset.sdAviso = '1';
      d.textContent = 'Abrindo…';
      caixa.append(d);
    }, 160);
  }
  const tirarAviso = (caixa) => { if (caixa instanceof Element) caixa.querySelectorAll(':scope > [data-sd-aviso]').forEach((x) => x.remove()); };
  const tirarAvisos = () => document.querySelectorAll('[data-sd-aviso]').forEach((x) => x.remove());

  // ------------------------------------------------------------ substitutos em window.SintoniaTelas
  function substituto(tela, nome, { acoes = [], outros = [] }) {
    const s = { sobDemanda: true };
    for (const m of acoes) {
      s[m] = (...args) => {
        const real = reais[tela];
        if (real && pronto.has(nome)) return typeof real[m] === 'function' ? real[m](...args) : undefined;
        return new Promise((ok, erro) => {
          if (m === 'desenhar') { // a tela só precisa ser desenhada uma vez, no último lugar pedido
            for (let i = fila.length - 1; i >= 0; i--) if (fila[i].tela === tela && fila[i].metodo === 'desenhar' && fila[i].args[0] === args[0]) fila.splice(i, 1)[0].ok(undefined);
            avisar(args[0]);
          }
          fila.push({ tela, metodo: m, args, ok, erro: (x) => { console.error(x); ok(undefined); } });
          carregar(nome).catch(() => {});
        });
      };
    }
    for (const m of outros) {
      s[m] = (...args) => { const real = reais[tela]; return real && typeof real[m] === 'function' ? real[m](...args) : undefined; };
    }
    return s;
  }
  for (const [nome, g] of Object.entries(GRUPOS)) {
    for (const [tela, metodos] of Object.entries(g.telas)) {
      grupoDa[tela] = nome;
      if (T[tela]) { reais[tela] = T[tela]; continue; } // já veio (ex.: a tela voltou para o carregamento normal)
      const sub = substituto(tela, nome, metodos);
      Object.defineProperty(T, tela, {
        configurable: true, enumerable: true,
        // até o grupo inteiro rodar, quem pergunta de fora recebe o substituto; os arquivos do próprio grupo já veem a de verdade
        get: () => (reais[tela] && (pronto.has(nome) || document.currentScript?.dataset.sobDemanda) ? reais[tela] : sub),
        set: (v) => {
          reais[tela] = v;
          // alguém voltou a carregar esta tela do jeito normal (<script defer> no app.html): vale como já carregada
          if (!document.currentScript?.dataset.sobDemanda && !estado[nome]) { pronto.add(nome); estado[nome] = Promise.resolve(); setTimeout(() => repetir(nome), 0); }
        },
      });
    }
  }

  // ------------------------------------------------------------ segundo plano
  function emSegundoPlano() {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return; // economia de dados: só quando abrir
    const ocioso = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));
    const proximo = () => {
      const nome = ORDEM.find((n) => !estado[n]);
      if (!nome) return;
      ocioso(() => carregar(nome).catch(() => {}).finally(() => setTimeout(proximo, 120)));
    };
    proximo();
  }
  // começa depois que a lista apareceu (prioridade.js libera) ou, no máximo, 4 s depois de abrir
  let comecou = false;
  const comecar = () => { if (comecou) return; comecou = true; setTimeout(emSegundoPlano, 800); };
  const esperar = setInterval(() => { if (window.SintoniaPrioridade?.liberado?.()) { clearInterval(esperar); comecar(); } }, 200);
  setTimeout(() => { clearInterval(esperar); comecar(); }, 4000);

  window.SintoniaSobDemanda = {
    carregar,
    carregada: (nome) => pronto.has(nome),
    grupoDaTela: (tela) => grupoDa[tela] || null,
    grupos: GRUPOS,
  };
})();

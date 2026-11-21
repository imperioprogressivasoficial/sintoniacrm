/* crm-topo: o topo do Pipeline no computador (como no Kommo) e o filtro completo, que vale também no celular.
 * Registra window.SintoniaFunilTopo; o funil.js chama passando um "ctx" com o estado e as ações do quadro.
 * - Topo: busca + Filtrar (com as pílulas dos filtros ligados) · avião de papel (Nova transmissão) · Automações · + Novo lead · ⋯
 * - ⋯: Importar, Exportar, Localizar duplicatas, Configuração da lista, Imprimir, Editar funil de vendas, Nova transmissão.
 * - Filtrar (painel lateral): filtros rápidos, filtros salvos, etiquetas, propriedades do lead, estatísticas, conversas e produtos.
 *   O filtro vai para o servidor (GET /api/funis/:id/quadro?filtro=…): vale para o quadro e para a lista.
 * - Lista: a mesma informação do quadro em linhas, com seleção para transmissão e lixeira.
 * Todo texto do servidor entra por textContent (el(..., { text })). */
(() => {
  const I = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    busca: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
    filtro: I('<path d="M4 6h16M7 12h10M10 18h4"/>', 2),
    aviao: I('<path d="M21 3 10 14"/><path d="M21 3 14.5 21l-4.5-7-7-4.5Z"/>'),
    fluxo: I('<rect x="3.5" y="3.5" width="6" height="6" rx="1.6"/><rect x="14.5" y="14.5" width="6" height="6" rx="1.6"/><path d="M6.5 9.5v3a2 2 0 0 0 2 2h6"/>'),
    mais: I('<path d="M12 5v14M5 12h14"/>', 2.2),
    pontos: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    x: I('<path d="M7 7l10 10M17 7 7 17"/>', 2),
    importar: I('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>'),
    exportar: I('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 19h14"/>'),
    duplicatas: I('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
    colunas: I('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M15 4.5v15"/>'),
    imprimir: I('<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7Z"/>'),
    funil: I('<path d="M4 4.5h16a.8.8 0 0 1 .6 1.3L14 13.5V19l-4 2v-7.5L3.4 5.8A.8.8 0 0 1 4 4.5Z"/>'),
    quadro: I('<rect x="3.5" y="4.5" width="5" height="15" rx="1.6"/><rect x="10" y="4.5" width="5" height="10" rx="1.6"/><rect x="16.5" y="4.5" width="4" height="7" rx="1.4"/>'),
    lista: I('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="18" r=".6"/>', 2),
    cima: I('<path d="m6 15 6-6 6 6"/>', 2),
    baixo: I('<path d="m6 9 6 6 6-6"/>', 2),
    lixo: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    lapis: I('<path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>'),
    salvar: I('<path d="M6 4h10l4 4v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 4v5h7M8 20v-6h8v6"/>'),
    voltar: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    novo: I('<path d="M12 5v14M5 12h14"/>', 2),
  };

  // ---------- campos do cartão e da lista ("Configuração da lista") ----------
  const CAMPOS = [
    ['valor', 'Valor do negócio'], ['origem', 'Origem'], ['situacao', 'Última mensagem'], ['responsavel', 'Responsável'],
    ['tags', 'Etiquetas'], ['telefone', 'Telefone'], ['desde', 'Tempo na etapa'], ['criado', 'Criado em'], ['etapa', 'Etapa'], ['atualizado', 'Atualizado em'],
  ];
  const SO_LISTA = new Set(['etapa', 'atualizado']);
  const PADRAO = { cartao: ['valor', 'origem', 'situacao', 'responsavel'], lista: ['etapa', 'valor', 'responsavel', 'origem', 'situacao', 'criado'] };
  const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravarLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const lerJson = (k, padrao) => { try { const v = JSON.parse(lerLocal(k) || 'null'); return v ?? padrao; } catch { return padrao; } };
  function config() {
    const c = lerJson('sintonia.crm.campos', null);
    const ok = (lista, padrao) => (Array.isArray(lista) ? lista.filter((x) => CAMPOS.some(([k]) => k === x)) : padrao);
    return { cartao: ok(c?.cartao, PADRAO.cartao), lista: ok(c?.lista, PADRAO.lista) };
  }

  // ---------- filtro ----------
  const VAZIO = () => ({ meus: false, situacao: '', tarefas: '', excluidos: false, tags: [], tagsTodas: false, etapas: [], donas: [], nome: '', criadaDe: '', criadaAte: '', atualizadaDe: '', atualizadaAte: '', valorMin: '', valorMax: '', semRespostaHoras: '', conversa: '', campos: [], produtos: [], categorias: [], empresas: [] });
  const chaveFiltro = (funilId) => `sintonia.crm.filtro.${funilId || 'x'}`;
  function lerFiltro(funilId) { return { ...VAZIO(), ...lerJson(chaveFiltro(funilId), {}) }; }
  function gravarFiltro(s) { gravarLocal(chaveFiltro(s.funilId), vazio(s.filtro) ? null : JSON.stringify(s.filtro)); }
  /** O que vai para o servidor (só o que está ligado; números como número). */
  function paraServidor(f) {
    if (!f) return null;
    const o = {};
    if (f.meus) o.meus = true;
    if (f.situacao) o.situacao = f.situacao;
    if (f.tarefas) o.tarefas = f.tarefas;
    if (f.excluidos) o.excluidos = true;
    if (f.tags?.length) { o.tags = f.tags; if (f.tagsTodas && f.tags.length > 1) o.tagsTodas = true; }
    if (f.etapas?.length) o.etapas = f.etapas;
    if (f.donas?.length) o.donas = f.donas;
    if (f.nome?.trim()) o.nome = f.nome.trim().slice(0, 80);
    for (const k of ['criadaDe', 'criadaAte', 'atualizadaDe', 'atualizadaAte']) if (f[k]) o[k] = f[k];
    const num = (v) => { const n = Number(String(v).replace(/[R$\s.]/g, '').replace(',', '.')); return v !== '' && v != null && Number.isFinite(n) && n >= 0 ? n : undefined; };
    if (num(f.valorMin) !== undefined) o.valorMin = num(f.valorMin);
    if (num(f.valorMax) !== undefined) o.valorMax = num(f.valorMax);
    if (Number(f.semRespostaHoras) > 0) o.semRespostaHoras = Number(f.semRespostaHoras);
    if (f.conversa) o.conversa = f.conversa;
    const campos = (f.campos || []).filter((c) => String(c.valor ?? '').trim());
    if (campos.length) o.campos = campos.map((c) => ({ id: c.id, valor: String(c.valor).trim(), exato: !!c.exato }));
    if (f.produtos?.length) o.produtos = f.produtos;
    /* produtos-lead: categorias dos produtos e empresa vinculada ao contato */
    if (f.categorias?.length) o.categorias = f.categorias;
    if (f.empresas?.length) o.empresas = f.empresas;
    return Object.keys(o).length ? o : null;
  }
  const vazio = (f) => !paraServidor(f);
  const filtroUrl = (s) => { const o = paraServidor(s.filtro); return o ? JSON.stringify(o) : ''; };
  /** Quantos filtros estão ligados (contando origem e unidade, que são do cliente / da URL). */
  const contar = (s) => pilulas(s).length;

  const SEM_RESPOSTA = [['', 'Qualquer tempo'], ['1', '1 hora'], ['4', '4 horas'], ['24', '1 dia'], ['72', '3 dias'], ['168', '7 dias'], ['720', '30 dias']];
  const fmtData = (d) => (d ? d.split('-').reverse().join('/') : '');
  const fmtValor = (v) => `R$ ${String(v).replace('.', ',')}`;

  /** Pílulas dos filtros ligados: [{ rotulo, tirar() }]. */
  function pilulas(s) {
    const f = s.filtro || VAZIO();
    const p = [];
    const tags = new Map((window.SintoniaTags?.dados?.tags || []).map((t) => [t.id, t]));
    const etapas = new Map((s.q?.colunas || []).map((c) => [c.etapa.id, c.etapa]));
    const pessoas = s.nomesPessoas || new Map();
    if (f.meus) p.push({ rotulo: 'Meus leads', tirar: () => { f.meus = false; } });
    if (f.situacao) p.push({ rotulo: f.situacao === 'ganhos' ? 'Leads ganhos' : 'Leads perdidos', tirar: () => { f.situacao = ''; } });
    if (f.tarefas) p.push({ rotulo: f.tarefas === 'com' ? 'Leads com tarefas' : 'Leads sem tarefas', tirar: () => { f.tarefas = ''; } });
    if (f.excluidos) p.push({ rotulo: 'Excluídos', tirar: () => { f.excluidos = false; } });
    for (const id of f.tags || []) p.push({ rotulo: `Etiqueta: ${tags.get(id)?.nome || '…'}`, cor: tags.get(id)?.cor, tirar: () => { f.tags = f.tags.filter((x) => x !== id); } });
    for (const id of f.etapas || []) p.push({ rotulo: `Etapa: ${etapas.get(id)?.nome || '…'}`, cor: etapas.get(id)?.cor, tirar: () => { f.etapas = f.etapas.filter((x) => x !== id); } });
    for (const id of f.donas || []) p.push({ rotulo: `Responsável: ${id === 'sem' ? 'sem responsável' : pessoas.get(id) || '…'}`, tirar: () => { f.donas = f.donas.filter((x) => x !== id); } });
    if (f.nome?.trim()) p.push({ rotulo: `Nome: ${f.nome.trim()}`, tirar: () => { f.nome = ''; } });
    if (f.criadaDe || f.criadaAte) p.push({ rotulo: `Criado: ${[fmtData(f.criadaDe) || '…', fmtData(f.criadaAte) || 'hoje'].join(' a ')}`, tirar: () => { f.criadaDe = ''; f.criadaAte = ''; } });
    if (f.atualizadaDe || f.atualizadaAte) p.push({ rotulo: `Atualizado: ${[fmtData(f.atualizadaDe) || '…', fmtData(f.atualizadaAte) || 'hoje'].join(' a ')}`, tirar: () => { f.atualizadaDe = ''; f.atualizadaAte = ''; } });
    if (f.valorMin !== '' || f.valorMax !== '') {
      const t = f.valorMin !== '' && f.valorMax !== '' ? `${fmtValor(f.valorMin)} a ${fmtValor(f.valorMax)}` : f.valorMin !== '' ? `a partir de ${fmtValor(f.valorMin)}` : `até ${fmtValor(f.valorMax)}`;
      p.push({ rotulo: `Valor ${t}`, tirar: () => { f.valorMin = ''; f.valorMax = ''; } });
    }
    if (Number(f.semRespostaHoras) > 0) p.push({ rotulo: `Sem resposta há ${SEM_RESPOSTA.find(([v]) => v === String(f.semRespostaHoras))?.[1] || `${f.semRespostaHoras} h`}+`, tirar: () => { f.semRespostaHoras = ''; } });
    if (f.conversa) p.push({ rotulo: { com: 'Com conversa', sem: 'Sem conversa', nao_lidas: 'Não lidas' }[f.conversa], tirar: () => { f.conversa = ''; } });
    for (const c of f.campos || []) if (String(c.valor ?? '').trim()) p.push({ rotulo: `${(s.camposFicha || []).find((x) => x.id === c.id)?.nome || 'Campo'}: ${c.rotulo || c.valor}`, tirar: () => { f.campos = f.campos.filter((x) => x !== c); } });
    for (const id of f.produtos || []) p.push({ rotulo: `Produto: ${(s.produtos || []).find((x) => x.id === id)?.nome || '…'}`, tirar: () => { f.produtos = f.produtos.filter((x) => x !== id); } });
    for (const c of f.categorias || []) p.push({ rotulo: `Categoria: ${c}`, tirar: () => { f.categorias = f.categorias.filter((x) => x !== c); } });
    for (const k of f.empresas || []) p.push({ rotulo: `Empresa: ${(s.empresasContato || []).find((x) => x.chave === k)?.nome || k.replace(/^(nome|cnpj):/, '')}`, tirar: () => { f.empresas = f.empresas.filter((x) => x !== k); } });
    if (s.origem) {
      const o = (window.SintoniaRastreio?.opcoesFiltro?.() || []).find((x) => x.valor === s.origem);
      p.push({ rotulo: `Origem: ${o ? o.nome.trim() : s.origem}`, cliente: true, tirar: () => { s.origem = ''; gravarLocal('sintonia.crm.origem', ''); } });
    }
    if (s.unidade) p.push({ rotulo: `Unidade: ${s.ui?.UNIDADE?.[s.unidade] || s.unidade}`, unidade: true, tirar: () => { s.unidade = ''; gravarLocal('sintonia.crm.unidade', ''); } });
    return p;
  }

  // ---------- estilo ----------
  const CHANFRO = (n) => `polygon(${n}px 0, 100% 0, 100% calc(100% - ${n}px), calc(100% - ${n}px) 100%, 0 100%, 0 ${n}px)`;
  /* O fio da diagonal do chanfro (o clip-path corta a borda): um traço fino nos dois cantos cortados. */
  const FIO = (n, cor) => `linear-gradient(to bottom right, transparent calc(50% - .6px), ${cor} 50%, transparent calc(50% + .6px)) top left / ${n}px ${n}px no-repeat,
      linear-gradient(to bottom right, transparent calc(50% - .6px), ${cor} 50%, transparent calc(50% + .6px)) bottom right / ${n}px ${n}px no-repeat`;
  const CSS = `
  /* ---------- topo (no cabeçalho da vista, só no computador) ---------- */
  .ft-barra { display: none; }
  @media (min-width: 761px) {
    #v-funil .cabeca-vista.fn-cabeca { flex-wrap: nowrap; align-items: center; gap: 16px; padding: 14px 20px 8px; }
    #v-funil .crm-barra { display: none !important; }
    #v-funil .fn-cabeca h1.titulo-grande { font-size: 30px; }
    .ft-barra { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; min-width: 0; }
    .fn-topo .fn-buscar { display: none; }
    .fn-topo .fn-filtros-bt { display: none; }
  }
  .ft-procura { position: relative; flex: 1 1 420px; max-width: 560px; min-width: 220px; display: flex; align-items: center; gap: 0; height: 42px; border-radius: 999px; padding: 0 5px 0 15px;
    background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); color: var(--sub); }
  .ft-procura:focus-within { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-azul) 60%, var(--vidro-borda)), var(--vidro-brilho); }
  html[data-tema="escuro"] .ft-procura:focus-within { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-menta) 50%, transparent), var(--vidro-brilho); }
  .ft-procura > svg { width: 17px; height: 17px; flex: none; margin-right: 9px; }
  .ft-procura input { all: unset; flex: 1; min-width: 60px; font-size: 14.5px; color: var(--texto); }
  .ft-procura input::placeholder { color: var(--sub); }
  .ft-procura .fn-achados { top: calc(100% + 6px); }
  .ft-filtrar { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13.5px; font-weight: 700; color: var(--texto);
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .ft-filtrar svg { width: 16px; height: 16px; }
  .ft-filtrar:hover { background: var(--vidro-ativo); }
  .ft-filtrar[aria-pressed="true"] { color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); box-shadow: none; }
  .ft-filtrar b { min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; background: rgba(255,255,255,.25); }
  .ft-filtrar b:empty { display: none; }
  .ft-acoes { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: none; }
  .ft-bt { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 40px; padding: 0 15px; border-radius: 999px; font-size: 14px; font-weight: 700; white-space: nowrap; color: var(--texto);
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); transition: background .15s ease, filter .15s ease; }
  .ft-bt svg { width: 18px; height: 18px; flex: none; }
  .ft-bt:hover { background: var(--vidro-ativo); }
  .ft-bt.ft-redondo { width: 40px; padding: 0; }
  .ft-bt.ft-principal { color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); box-shadow: 0 6px 18px rgba(16,110,190,.28); padding: 0 17px; }
  .ft-bt.ft-principal:hover { filter: brightness(1.06); }
  html[data-tema="escuro"] .ft-bt.ft-principal { box-shadow: 0 6px 20px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.18); }
  .ft-bt:focus-visible, .ft-filtrar:focus-visible, .ft-pil:focus-visible, .ft-vistas button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  @media (max-width: 1180px) and (min-width: 761px) { .ft-bt.ft-autos-bt span:last-child { display: none; } .ft-bt.ft-autos-bt { width: 40px; padding: 0; } }
  /* pílulas dos filtros ligados (abaixo do topo) */
  .ft-pilulas { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 20px 8px; }
  .ft-pilulas:empty { display: none; }
  .ft-pil { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px 0 12px; border-radius: 999px; font-size: 13px; font-weight: 650; color: var(--texto); max-width: 280px;
    background: color-mix(in srgb, var(--marca-azul) 12%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 35%, transparent); }
  html[data-tema="escuro"] .ft-pil { background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); }
  .ft-pil .ft-pil-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ft-pil .ft-pil-x { width: 18px; height: 18px; flex: none; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--texto) 9%, transparent); }
  .ft-pil .ft-pil-x svg { width: 12px; height: 12px; }
  .ft-pil:hover .ft-pil-x { background: color-mix(in srgb, var(--texto) 18%, transparent); }
  .ft-pil > i.ft-cor { width: 8px; height: 8px; border-radius: 50%; background: var(--cor); flex: none; margin-left: -3px; }
  .ft-pil.ft-limpar { padding: 0 12px; background: transparent; box-shadow: none; color: var(--sub); font-weight: 700; }
  .ft-pil.ft-limpar:hover { color: var(--texto); }
  .ft-aviso-pil { font-size: 12.5px; color: var(--sub); margin-left: 4px; }
  /* Quadro | Lista ao lado dos pipelines */
  .ft-vistas { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; flex: none; margin-left: auto; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); }
  .ft-vistas button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13.5px; font-weight: 650; color: var(--sub); }
  .ft-vistas button svg { width: 17px; height: 17px; }
  .ft-vistas button[aria-pressed="true"] { color: var(--texto); background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-weight: 750; }
  .fn-funis-linha { align-items: center; gap: 10px; }
  @media (max-width: 760px) { .ft-vistas, .ft-pilulas { display: none !important; } }

  /* ---------- borda chanfrada no molde do CRM (colunas, quadro e lista), só no computador ---------- */
  @media (min-width: 761px) {
    #v-funil .fn-col { border-radius: 4px; clip-path: ${CHANFRO(16)}; }
    #v-funil .fn-col::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: ${FIO(16, 'var(--vidro-borda)')}; z-index: 1; }
    #v-funil .fn-nova-etapa { border-radius: 4px; border: 0; clip-path: ${CHANFRO(14)}; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-azul) 30%, var(--vidro-borda)); }
    #v-funil .fn-quadro { margin: 0 20px 16px; padding: 14px 14px 14px; border-radius: 4px; clip-path: ${CHANFRO(20)};
      background: ${FIO(20, 'var(--vidro-borda)')}, color-mix(in srgb, var(--vidro-fundo) 55%, transparent); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
    #v-funil .ft-lista { clip-path: ${CHANFRO(20)}; border-radius: 4px; }
    #v-funil .fn-cartao::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: ${FIO(12, 'var(--vidro-borda)')}; }
  }

  /* ---------- lista ---------- */
  .ft-lista { flex: 1; min-height: 0; margin: 0 20px 16px; display: flex; flex-direction: column; overflow: hidden; background: color-mix(in srgb, var(--vidro-fundo) 70%, transparent); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .ft-lista[hidden] { display: none; }
  .ft-lista-rolar { flex: 1; min-height: 0; overflow: auto; }
  .ft-tab { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13.5px; }
  .ft-tab th { position: sticky; top: 0; z-index: 2; text-align: left; font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); padding: 11px 12px; background: var(--fundo); border-bottom: 1px solid var(--linha); white-space: nowrap; }
  .ft-tab td { padding: 9px 12px; border-bottom: 1px solid var(--vidro-linha, var(--linha)); color: var(--texto); vertical-align: middle; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ft-tab tbody tr { cursor: pointer; }
  .ft-tab tbody tr:hover td { background: var(--vidro-item); }
  .ft-tab tbody tr[aria-selected="true"] td { background: color-mix(in srgb, var(--marca-azul) 10%, transparent); }
  .ft-tab .ft-sel { width: 34px; padding-right: 0; }
  .ft-tab input[type="checkbox"] { width: 17px; height: 17px; accent-color: #106ebe; cursor: pointer; }
  .ft-tab .ft-nome { display: flex; align-items: center; gap: 10px; font-weight: 700; min-width: 180px; }
  .ft-tab .ft-nome .avatar { width: 30px; height: 30px; font-size: 12px; flex: none; margin: 0; }
  .ft-tab .ft-nome span { overflow: hidden; text-overflow: ellipsis; }
  .ft-etapa { display: inline-flex; align-items: center; gap: 6px; font-weight: 650; }
  .ft-etapa i { width: 8px; height: 8px; border-radius: 50%; background: var(--cor); flex: none; }
  .ft-tab .fn-tag { max-width: 120px; }
  .ft-tab .ft-mais { all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .ft-tab .ft-mais:hover { background: var(--vidro-ativo); color: var(--texto); }
  .ft-tab .ft-mais svg { width: 17px; height: 17px; }
  .ft-lista-pe { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--linha); font-size: 13px; color: var(--sub); }
  .ft-lista-pe .ft-bt { height: 34px; font-size: 13px; }
  .ft-massa { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ft-massa b { color: var(--texto); }
  .ft-vazio-l { padding: 40px 16px; text-align: center; color: var(--sub); }

  /* ---------- painel de filtros ---------- */
  .ft-fil .grupo-filtro h4 { display: flex; align-items: center; gap: 8px; }
  .ft-fil .ft-rapidos { display: grid; gap: 4px; }
  .ft-fil .ft-rapido { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; border-radius: 12px; font-size: 14.5px; font-weight: 600; color: var(--texto); }
  .ft-fil .ft-rapido:hover { background: var(--sel); }
  .ft-fil .ft-rapido[aria-pressed="true"] { background: color-mix(in srgb, var(--marca-azul) 13%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 40%, transparent); font-weight: 750; }
  html[data-tema="escuro"] .ft-fil .ft-rapido[aria-pressed="true"] { background: rgba(255,255,255,.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); }
  .ft-fil .ft-rapido i { margin-left: auto; width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--linha); flex: none; }
  .ft-fil .ft-rapido[aria-pressed="true"] i { box-shadow: inset 0 0 0 5px #106ebe; }
  html[data-tema="escuro"] .ft-fil .ft-rapido[aria-pressed="true"] i { box-shadow: inset 0 0 0 5px var(--marca-menta); }
  .ft-fil .ft-campo { display: grid; gap: 6px; margin-bottom: 12px; }
  .ft-fil .ft-campo > span { font-size: 13px; font-weight: 700; color: var(--sub); }
  .ft-fil input:not([type="checkbox"]), .ft-fil select { box-sizing: border-box; width: 100%; font: inherit; font-size: 14.5px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--linha); border-radius: 12px; padding: 9px 12px; min-height: 42px; }
  .ft-fil input:focus, .ft-fil select:focus { outline: none; border-color: color-mix(in srgb, var(--marca-azul) 60%, var(--linha)); }
  html[data-tema="escuro"] .ft-fil select option { background: #0d3050; }
  .ft-fil .ft-dupla { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ft-fil .ft-marcar { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--sub); margin-top: 6px; }
  .ft-fil .ft-marcar input { width: 17px; height: 17px; accent-color: #106ebe; }
  .ft-fil .chip-tag i { width: 8px; height: 8px; border-radius: 50%; background: var(--cor); }
  .ft-fil .ft-link { all: unset; cursor: pointer; font-size: 14px; font-weight: 700; color: var(--marca-azul); }
  html[data-tema="escuro"] .ft-fil .ft-link { color: var(--marca-menta); }
  .ft-fil .ft-salvo { display: flex; align-items: center; gap: 6px; }
  .ft-fil .ft-salvo .chip { flex: 1 1 auto; justify-content: flex-start; }
  .ft-fil .ft-salvo .ft-x { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; }
  .ft-fil .ft-salvo .ft-x:hover { background: var(--sel); color: var(--texto); }
  .ft-fil .ft-salvo .ft-x svg { width: 16px; height: 16px; }
  .ft-fil .ft-nota { font-size: 12.5px; color: var(--sub); margin: 4px 2px 0; line-height: 1.4; }
  .ft-fil .rodape-filtros .botao { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; font-weight: 700; }
  .ft-fil .rodape-filtros .ft-dir { display: flex; gap: 8px; align-items: center; }

  /* ---------- editar funil / configuração / automações (no painel lateral) ---------- */
  .ft-pag { display: grid; gap: 14px; }
  .ft-pag h4 { margin: 6px 2px 0; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--sub); }
  .ft-pag .ft-campo { display: grid; gap: 6px; }
  .ft-pag .ft-campo > span { font-size: 13px; font-weight: 700; color: var(--sub); }
  .ft-pag input:not([type="checkbox"]), .ft-pag select { box-sizing: border-box; width: 100%; font: inherit; font-size: 14.5px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--linha); border-radius: 12px; padding: 9px 12px; min-height: 42px; }
  html[data-tema="escuro"] .ft-pag select option { background: #0d3050; }
  .ft-etapas { display: grid; gap: 8px; }
  .ft-et { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 10px; border-radius: 4px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--linha); clip-path: ${CHANFRO(10)}; }
  .ft-et .ft-cor-bt { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; background: var(--cor); flex: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor) 25%, transparent); }
  .ft-et input { flex: 1; min-width: 0; min-height: 36px !important; padding: 6px 10px !important; background: transparent !important; border-color: transparent !important; font-weight: 650; }
  .ft-et input:focus { border-color: var(--linha) !important; background: var(--fundo) !important; }
  .ft-et small { color: var(--sub); font-size: 12px; white-space: nowrap; }
  .ft-et .ft-ic { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; }
  .ft-et .ft-ic:hover { background: var(--sel); color: var(--texto); }
  .ft-et .ft-ic[aria-disabled="true"] { opacity: .3; cursor: default; }
  .ft-et .ft-ic.ft-perigo:hover { color: #e5484d; }
  .ft-et .ft-ic svg { width: 17px; height: 17px; }
  .ft-pag .ft-bt { justify-self: start; }
  .ft-campos { display: grid; gap: 2px; }
  .ft-campos label { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 4px; font-size: 14.5px; }
  .ft-campos input { width: 18px; height: 18px; accent-color: #106ebe; flex: none; }
  .ft-campos small { color: var(--sub); margin-left: auto; font-size: 12px; }
  .ft-autos { display: grid; gap: 10px; }
  .ft-auto-et { border-radius: 4px; padding: 10px 12px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--linha); clip-path: ${CHANFRO(10)}; display: grid; gap: 6px; }
  .ft-auto-et > div:first-child { display: flex; align-items: center; gap: 8px; font-weight: 750; }
  .ft-auto-et > div:first-child i { width: 9px; height: 9px; border-radius: 50%; background: var(--cor); flex: none; }
  .ft-auto-et > div:first-child button { margin-left: auto; }
  .ft-auto { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 10px; font-size: 14px; }
  .ft-auto:hover { background: var(--sel); }
  .ft-auto svg { width: 16px; height: 16px; color: var(--sub); flex: none; }
  .ft-auto span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ft-auto small { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; color: var(--sub); box-shadow: inset 0 0 0 1px var(--linha); }
  .ft-auto small.ft-on { color: #0b6b52; background: color-mix(in srgb, var(--marca-menta) 25%, transparent); box-shadow: none; }
  html[data-tema="escuro"] .ft-auto small.ft-on { color: var(--marca-menta); }
  .ft-auto-vazio { font-size: 13px; color: var(--sub); padding: 2px 8px; }
  .ft-mini { all: unset; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--marca-azul); padding: 4px 8px; border-radius: 999px; }
  .ft-mini:hover { background: var(--sel); }
  html[data-tema="escuro"] .ft-mini { color: var(--marca-menta); }

  /* ---------- impressão: só a folha do pipeline ---------- */
  .ft-impressao { display: none; }
  @media print {
    html.ft-imprimindo body > *:not(.ft-impressao) { display: none !important; }
    html.ft-imprimindo, html.ft-imprimindo body { background: #fff !important; color: #000 !important; height: auto !important; overflow: visible !important; }
    html.ft-imprimindo .ft-impressao { display: block; font: 12px/1.4 system-ui, sans-serif; color: #000; }
    .ft-impressao h1 { font-size: 20px; margin: 0 0 2px; }
    .ft-impressao p { margin: 0 0 12px; color: #444; }
    .ft-impressao h2 { font-size: 14px; margin: 16px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #106ebe; display: flex; gap: 8px; }
    .ft-impressao h2 small { color: #555; font-weight: 400; }
    .ft-impressao table { width: 100%; border-collapse: collapse; }
    .ft-impressao th, .ft-impressao td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; }
    .ft-impressao th { font-size: 10.5px; text-transform: uppercase; color: #555; }
    .ft-impressao section { break-inside: avoid-page; }
  }
  `;
  function estilo() {
    if (document.getElementById('ft-estilo')) return;
    document.head.append(Object.assign(document.createElement('style'), { id: 'ft-estilo', textContent: CSS }));
  }

  // ---------- topo ----------
  function montarTopo(ctx, busca, achados) {
    const { s } = ctx; const { el } = s.ui;
    estilo();
    s.ftContagem = el('b');
    s.ftFiltrar = el('button', { class: 'ft-filtrar', type: 'button', title: 'Filtrar os leads deste pipeline', 'aria-pressed': 'false', onclick: () => abrirFiltro(ctx) },
      el('span', { html: IC.filtro, style: 'display:grid' }), el('span', { text: 'Filtrar' }), s.ftContagem);
    const procura = el('label', { class: 'ft-procura' }, el('span', { html: IC.busca, style: 'display:grid' }), busca, s.ftFiltrar, achados);
    busca.placeholder = 'Buscar e filtrar';
    const gestao = ctx.ehGestao();
    s.ftBarra = el('div', { class: 'ft-barra' }, procura,
      el('div', { class: 'ft-acoes' },
        gestao ? el('button', { class: 'ft-bt ft-redondo', type: 'button', title: 'Nova transmissão para os leads filtrados', 'aria-label': 'Nova transmissão para os leads filtrados', html: IC.aviao, onclick: () => novaTransmissao(ctx) }) : null,
        gestao ? el('button', { class: 'ft-bt ft-autos-bt', type: 'button', title: 'Automações e fluxos ligados a este pipeline', onclick: () => abrirAutomacoes(ctx) }, el('span', { html: IC.fluxo, style: 'display:grid' }), el('span', { text: 'Automações' })) : null,
        el('button', { class: 'ft-bt ft-principal', type: 'button', onclick: () => ctx.novoLead() }, el('span', { html: IC.mais, style: 'display:grid' }), el('span', { text: 'Novo lead' })),
        el('button', { class: 'ft-bt ft-redondo', type: 'button', title: 'Mais opções', 'aria-label': 'Mais opções do pipeline', html: IC.pontos, onclick: () => menuMais(ctx) })));
    s.ftPilulas = el('div', { class: 'ft-pilulas', 'aria-label': 'Filtros ligados' });
    s.ftVistas = el('div', { class: 'ft-vistas', role: 'group', 'aria-label': 'Ver como' });
    desenharVistas(ctx);
    return { barra: s.ftBarra, pilulas: s.ftPilulas, vistas: s.ftVistas };
  }
  function desenharVistas(ctx) {
    const { s } = ctx; const { el } = s.ui;
    const bt = (id, nome, ic) => el('button', { type: 'button', 'aria-pressed': String(s.vista === id), title: nome, onclick: () => { if (s.vista === id) return; s.vista = id; gravarLocal('sintonia.crm.vista', id); desenharVistas(ctx); ctx.desenharQuadro(); } },
      el('span', { html: ic, style: 'display:grid' }), el('span', { text: nome }));
    s.ftVistas.replaceChildren(bt('quadro', 'Quadro', IC.quadro), bt('lista', 'Lista', IC.lista));
  }
  function desenharPilulas(ctx) {
    const { s } = ctx; if (!s.ftPilulas) return;
    const { el } = s.ui;
    const ps = pilulas(s);
    if (s.ftContagem) { s.ftContagem.textContent = ps.length ? String(ps.length) : ''; s.ftFiltrar.setAttribute('aria-pressed', String(ps.length > 0)); s.ftFiltrar.setAttribute('aria-label', ps.length ? `Filtrar (${ps.length} ligado${ps.length === 1 ? '' : 's'})` : 'Filtrar'); }
    if (!ps.length) { s.ftPilulas.replaceChildren(); return; }
    const aplicar = (p) => { const unidade = p.unidade; p.tirar(); gravarFiltro(s); if (p.cliente) ctx.desenharQuadro(); else { s.carregados = {}; if (unidade) s.assinaturaFunis = ''; ctx.carregarQuadro(); } desenharPilulas(ctx); };
    s.ftPilulas.replaceChildren(
      ...ps.map((p) => {
        const b = el('button', { type: 'button', class: 'ft-pil', title: `Tirar: ${p.rotulo}`, 'aria-label': `Tirar filtro ${p.rotulo}`, onclick: () => aplicar(p) },
          p.cor ? el('i', { class: 'ft-cor' }) : null, el('span', { class: 'ft-pil-txt', text: p.rotulo }), el('i', { class: 'ft-pil-x', html: IC.x }));
        if (p.cor) b.style.setProperty('--cor', p.cor);
        return b;
      }),
      el('button', { type: 'button', class: 'ft-pil ft-limpar', text: 'Limpar tudo', onclick: () => limpar(ctx) }),
      ...(s.avisos || []).includes('produtos') ? [el('span', { class: 'ft-aviso-pil', text: 'O filtro por produto vale quando os produtos estiverem ligados aos leads.' })] : [],
      ...(s.avisos || []).includes('empresas') ? [el('span', { class: 'ft-aviso-pil', text: 'O filtro por empresa ainda não está ligado neste servidor.' })] : []);
  }
  function limpar(ctx) {
    const { s } = ctx;
    const unidade = !!s.unidade;
    s.filtro = VAZIO(); s.origem = ''; s.unidade = '';
    gravarLocal('sintonia.crm.origem', ''); gravarLocal('sintonia.crm.unidade', ''); gravarFiltro(s);
    if (unidade) s.assinaturaFunis = '';
    s.carregados = {};
    ctx.aplicouFiltro();
  }

  // ---------- painel "Filtrar" ----------
  async function carregarApoio(ctx) {
    const { s } = ctx; const api = s.ui.api;
    const tarefas = [];
    if (!s.camposFicha) tarefas.push(api('/api/campos-contato').then((r) => { s.camposFicha = Array.isArray(r) ? r : []; }).catch(() => { s.camposFicha = []; }));
    // Produtos e serviços (Empresa): o filtro só aparece quando a rota existe.
    if (s.produtos === undefined) tarefas.push(api('/api/produtos').then((r) => { const l = Array.isArray(r) ? r : Array.isArray(r?.produtos) ? r.produtos : null; s.produtos = l ? l.filter((p) => p && p.id && p.nome) : null; s.categoriasProdutos = Array.isArray(r?.categorias) ? r.categorias.filter((c) => typeof c === 'string' && c) : []; }).catch(() => { s.produtos = null; }));
    /* produtos-lead: empresas ligadas aos contatos (Clientes › Empresas) para o filtro "Empresa vinculada" */
    if (s.empresasContato === undefined) tarefas.push(api('/api/clientes/empresas').then((r) => { s.empresasContato = (Array.isArray(r?.empresas) ? r.empresas : []).filter((e) => e && e.chave && e.nome).slice(0, 200); }).catch(() => { s.empresasContato = []; }));
    if (!s.equipe) tarefas.push(api('/api/equipe').then((r) => { s.equipe = (r?.pessoas || []).filter((p) => p.ativo !== false).map((p) => ({ id: p.id, nome: p.nome })); }).catch(() => { s.equipe = []; }));
    if (window.SintoniaTags) tarefas.push(window.SintoniaTags.carregar().catch(() => {}));
    await Promise.all(tarefas);
    lembrarPessoas(s);
  }
  /** Nomes de quem aparece como responsável (equipe + cartões), para as pílulas e o filtro. */
  function lembrarPessoas(s) {
    const m = s.nomesPessoas || new Map();
    for (const p of s.equipe || []) m.set(p.id, p.nome);
    for (const col of s.q?.colunas || []) for (const c of col.cartoes) if (c.dona) m.set(c.dona.id, c.dona.nome || 'Sem nome');
    const eu = s.ui?.estado?.eu; if (eu?.id) m.set(eu.id, eu.nome);
    s.nomesPessoas = m;
  }

  function abrirFiltro(ctx) {
    const { s } = ctx; const { el } = s.ui;
    const P = window.SintoniaPainel;
    if (!P) { ctx.abrirFiltrosAntigo?.(); return; }
    const rascunho = JSON.parse(JSON.stringify({ ...VAZIO(), ...s.filtro }));
    let origem = s.origem, unidade = s.unidade;
    let corpo = null;
    const desenhar = () => {
      if (!corpo) return;
      const rolagem = corpo.scrollTop;
      corpo.replaceChildren(...partes());
      corpo.scrollTop = rolagem;
    };
    const chip = (rotulo, ligado, fn, extra) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(!!ligado), onclick: () => { fn(); desenhar(); } }, ...(extra ? [extra] : []), document.createTextNode(rotulo));
    const grupo = (id, titulo, ...filhos) => el('section', { class: 'grupo-filtro', 'data-grupo': id }, el('h4', { text: titulo }), ...filhos);
    const alterna = (lista, id) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
    const campoTexto = (rotulo, valor, mudar, props = {}) => {
      const i = el('input', { value: valor ?? '', ...props });
      i.addEventListener('input', () => mudar(i.value));
      return el('label', { class: 'ft-campo' }, el('span', { text: rotulo }), i);
    };
    const escolha = (rotulo, ops, valor, mudar) => {
      const sel = el('select', { 'aria-label': rotulo }, ...ops.map(([v, n]) => el('option', { value: v, text: n })));
      sel.value = valor ?? '';
      sel.addEventListener('change', () => mudar(sel.value));
      return el('label', { class: 'ft-campo' }, el('span', { text: rotulo }), sel);
    };
    const datas = (rotulo, de, ate) => el('div', { class: 'ft-campo' }, el('span', { text: rotulo }),
      el('div', { class: 'ft-dupla' },
        (() => { const i = el('input', { type: 'date', value: rascunho[de] || '', 'aria-label': `${rotulo}: de` }); i.addEventListener('change', () => { rascunho[de] = i.value; }); return i; })(),
        (() => { const i = el('input', { type: 'date', value: rascunho[ate] || '', 'aria-label': `${rotulo}: até` }); i.addEventListener('change', () => { rascunho[ate] = i.value; }); return i; })()));
    const rapido = (rotulo, ligado, fn) => el('button', { class: 'ft-rapido', type: 'button', 'aria-pressed': String(!!ligado), onclick: () => { fn(); desenhar(); } }, el('span', { text: rotulo }), el('i'));

    function partes() {
      const r = rascunho;
      const out = [];
      out.push(grupo('rapidos', 'Filtros rápidos', el('div', { class: 'ft-rapidos' },
        rapido('Meus leads', r.meus, () => { r.meus = !r.meus; }),
        rapido('Leads ganhos', r.situacao === 'ganhos', () => { r.situacao = r.situacao === 'ganhos' ? '' : 'ganhos'; }),
        rapido('Leads perdidos', r.situacao === 'perdidos', () => { r.situacao = r.situacao === 'perdidos' ? '' : 'perdidos'; }),
        rapido('Leads sem tarefas', r.tarefas === 'sem', () => { r.tarefas = r.tarefas === 'sem' ? '' : 'sem'; }),
        rapido('Leads com tarefas', r.tarefas === 'com', () => { r.tarefas = r.tarefas === 'com' ? '' : 'com'; }),
        rapido('Excluídos (lixeira)', r.excluidos, () => { r.excluidos = !r.excluidos; }))));
      const salvos = lerJson('sintonia.crm.filtrosSalvos', []);
      if (Array.isArray(salvos) && salvos.length) {
        out.push(grupo('salvos', 'Filtros salvos', el('div', { style: 'display:grid;gap:6px' }, ...salvos.map((sv, i) => el('div', { class: 'ft-salvo' },
          el('button', { class: 'chip', type: 'button', onclick: () => { Object.assign(rascunho, VAZIO(), sv.filtro || {}); rascunho.etapas = rascunho.etapas.filter((id) => (s.q?.colunas || []).some((c) => c.etapa.id === id)); desenhar(); } }, document.createTextNode(String(sv.nome || 'Filtro'))),
          el('button', { class: 'ft-x', type: 'button', title: 'Apagar este filtro salvo', 'aria-label': `Apagar o filtro salvo ${sv.nome}`, html: IC.x, onclick: () => { const l = lerJson('sintonia.crm.filtrosSalvos', []); l.splice(i, 1); gravarLocal('sintonia.crm.filtrosSalvos', JSON.stringify(l)); desenhar(); } }))))));
      }
      // Etiquetas: o mesmo seletor de tags de todo o sistema.
      const tags = new Map((window.SintoniaTags?.dados?.tags || []).map((t) => [t.id, t]));
      out.push(grupo('etiquetas', 'Etiquetas',
        el('div', { class: 'grupo' },
          ...r.tags.map((id) => { const t = tags.get(id); const i = el('i'); const b = chip(t?.nome || '…', true, () => { r.tags = r.tags.filter((x) => x !== id); }, i); b.classList.add('chip-tag'); b.style.setProperty('--cor', t?.cor || '#8b8d98'); b.title = 'Tirar esta etiqueta'; return b; }),
          window.SintoniaTags ? el('button', { class: 'ft-link', type: 'button', text: r.tags.length ? 'Escolher outras' : 'Escolher etiquetas', onclick: async () => {
            await window.SintoniaTags.escolher({ titulo: 'Filtrar por etiqueta', sub: 'Mostra quem tem qualquer uma das marcadas.', varias: true, marcadas: () => new Set(r.tags), aoEscolher: async (t, ligar) => { r.tags = ligar ? [...new Set([...r.tags, t.id])] : r.tags.filter((x) => x !== t.id); } });
            desenhar();
          } }) : null),
        r.tags.length > 1 ? el('label', { class: 'ft-marcar' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = !!r.tagsTodas; c.addEventListener('change', () => { r.tagsTodas = c.checked; }); return c; })(), el('span', { text: 'Precisa ter todas as etiquetas' })) : null));
      // Propriedades do lead
      const cols = s.q?.colunas || [];
      const pessoas = [...(s.nomesPessoas || new Map()).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'));
      const props = [
        campoTexto('Nome ou telefone', r.nome, (v) => { r.nome = v; }, { placeholder: 'Ex.: Maria ou 7199…', maxlength: '80' }),
        datas('Criado entre', 'criadaDe', 'criadaAte'),
        datas('Atualizado entre', 'atualizadaDe', 'atualizadaAte'),
        el('div', { class: 'ft-campo' }, el('span', { text: 'Etapa' }), el('div', { class: 'grupo' }, ...cols.map((c) => { const i = el('i'); const b = chip(c.etapa.nome, r.etapas.includes(c.etapa.id), () => { r.etapas = alterna(r.etapas, c.etapa.id); }, i); b.classList.add('chip-tag'); b.style.setProperty('--cor', c.etapa.cor); return b; }))),
        el('div', { class: 'ft-campo' }, el('span', { text: 'Responsável' }), el('div', { class: 'grupo' },
          ...pessoas.map(([id, nome]) => chip(nome, r.donas.includes(id), () => { r.donas = alterna(r.donas, id); })),
          chip('Sem responsável', r.donas.includes('sem'), () => { r.donas = alterna(r.donas, 'sem'); }))),
      ];
      const ra = window.SintoniaRastreio;
      if (ra?.opcoesFiltro) props.push(escolha('Origem', ra.opcoesFiltro().map((o) => [o.valor, o.nome.trim()]), origem, (v) => { origem = v; }));
      if ((s.unidadesOps || []).length) props.push(escolha('Unidade', s.unidadesOps, unidade, (v) => { unidade = v; }));
      // Campos personalizados da ficha
      for (const cf of s.camposFicha || []) {
        const atual = r.campos.find((x) => x.id === cf.id);
        const pôr = (valor, exato, rotulo) => { r.campos = r.campos.filter((x) => x.id !== cf.id); if (String(valor).trim()) r.campos.push({ id: cf.id, valor, exato, ...(rotulo ? { rotulo } : {}) }); };
        if (cf.tipo === 'lista') props.push(escolha(cf.nome, [['', 'Qualquer'], ...cf.opcoes.map((o) => [o, o])], atual?.valor || '', (v) => pôr(v, true)));
        else if (cf.tipo === 'sim_nao') props.push(escolha(cf.nome, [['', 'Qualquer'], ['true', 'Sim'], ['false', 'Não']], atual?.valor || '', (v) => pôr(v, true, v === 'true' ? 'Sim' : 'Não')));
        else if (cf.tipo === 'data') props.push(campoTexto(cf.nome, atual?.valor, (v) => pôr(v, true), { type: 'date' }));
        else props.push(campoTexto(cf.nome, atual?.valor, (v) => pôr(v, cf.tipo === 'numero'), { maxlength: '200', ...(cf.tipo === 'numero' ? { inputmode: 'decimal' } : {}) }));
      }
      out.push(grupo('propriedades', 'Propriedades do lead', ...props));
      // Estatísticas
      out.push(grupo('estatisticas', 'Estatísticas',
        el('div', { class: 'ft-campo' }, el('span', { text: 'Valor do negócio (R$)' }), el('div', { class: 'ft-dupla' },
          (() => { const i = el('input', { inputmode: 'decimal', placeholder: 'De', value: r.valorMin ?? '', 'aria-label': 'Valor a partir de' }); i.addEventListener('input', () => { r.valorMin = i.value.trim(); }); return i; })(),
          (() => { const i = el('input', { inputmode: 'decimal', placeholder: 'Até', value: r.valorMax ?? '', 'aria-label': 'Valor até' }); i.addEventListener('input', () => { r.valorMax = i.value.trim(); }); return i; })())),
        escolha('Sem resposta há mais de', SEM_RESPOSTA, String(r.semRespostaHoras || ''), (v) => { r.semRespostaHoras = v; })));
      // Conversas
      out.push(grupo('conversas', 'Conversas', el('div', { class: 'grupo' },
        chip('Com conversa', r.conversa === 'com', () => { r.conversa = r.conversa === 'com' ? '' : 'com'; }),
        chip('Sem conversa', r.conversa === 'sem', () => { r.conversa = r.conversa === 'sem' ? '' : 'sem'; }),
        chip('Não lidas', r.conversa === 'nao_lidas', () => { r.conversa = r.conversa === 'nao_lidas' ? '' : 'nao_lidas'; }))));
      // Produtos (quando o cadastro existir)
      if (Array.isArray(s.produtos) && s.produtos.length) {
        /* produtos-lead: produtos vinculados ao lead e as categorias do cadastro */
        const cats = s.categoriasProdutos || [];
        out.push(grupo('produtos', 'Produtos e serviços',
          cats.length ? el('div', { class: 'ft-campo' }, el('span', { text: 'Categoria' }), el('div', { class: 'grupo' }, ...cats.map((c) => chip(c, r.categorias.includes(c), () => { r.categorias = alterna(r.categorias, c); })))) : null,
          el('div', { class: 'ft-campo' }, el('span', { text: 'Tem o produto ou serviço' }), el('div', { class: 'grupo' }, ...s.produtos.filter((p) => p.ativo !== false || r.produtos.includes(p.id)).map((p) => chip(String(p.nome), r.produtos.includes(p.id), () => { r.produtos = alterna(r.produtos, p.id); }))))));
      }
      /* produtos-lead: "propriedade vinculada" = empresa ligada ao contato (ficha › empresa) */
      if (Array.isArray(s.empresasContato) && s.empresasContato.length) {
        out.push(grupo('empresas', 'Empresa vinculada', el('div', { class: 'grupo' }, ...s.empresasContato.map((e) => chip(`${e.nome}${e.total > 1 ? ` (${e.total})` : ''}`, r.empresas.includes(e.chave), () => { r.empresas = alterna(r.empresas, e.chave); })))));
      }
      out.push(el('div', { class: 'rodape-filtros' },
        el('button', { type: 'button', class: 'limpar', text: 'Limpar', onclick: () => { Object.assign(rascunho, VAZIO()); origem = ''; unidade = ''; desenhar(); } }),
        el('div', { class: 'ft-dir' },
          el('button', { type: 'button', class: 'ft-bt', title: 'Guardar este filtro com um nome', onclick: salvarComo }, el('span', { html: IC.salvar, style: 'display:grid' }), el('span', { text: 'Salvar' })),
          el('button', { type: 'button', class: 'botao mostrar', text: 'Aplicar', onclick: aplicar }))));
      return out;
    }
    function aplicar() {
      const mudouUnidade = unidade !== s.unidade;
      s.filtro = JSON.parse(JSON.stringify(rascunho));
      s.origem = origem; gravarLocal('sintonia.crm.origem', origem);
      if (mudouUnidade) { s.unidade = unidade; gravarLocal('sintonia.crm.unidade', unidade); s.assinaturaFunis = ''; }
      gravarFiltro(s);
      s.carregados = {};
      P.fechar();
      ctx.aplicouFiltro();
    }
    async function salvarComo() {
      if (vazio(rascunho)) { s.ui.toast('Ligue algum filtro antes de salvar.'); return; }
      const r = await ctx.pedir({ titulo: 'Salvar filtro', aviso: 'Ele aparece em “Filtros salvos”, neste aparelho.', campos: [{ nome: 'nome', rotulo: 'Nome do filtro', max: 40, dica: 'Ex.: Sem resposta há 3 dias' }], ok: 'Salvar' });
      if (!r) return;
      const l = lerJson('sintonia.crm.filtrosSalvos', []);
      const lista = Array.isArray(l) ? l.filter((x) => x.nome !== r.nome.trim()) : [];
      lista.unshift({ nome: r.nome.trim(), filtro: JSON.parse(JSON.stringify(rascunho)) });
      gravarLocal('sintonia.crm.filtrosSalvos', JSON.stringify(lista.slice(0, 20)));
      s.ui.toast('Filtro salvo ✓');
      desenhar();
    }
    P.abrir({ id: 'crm-filtros', titulo: 'Filtrar leads', montar: (c) => { corpo = c; c.classList.add('painel-filtros', 'ft-fil'); desenhar(); }, aoFechar: () => { corpo = null; } });
    carregarApoio(ctx).then(desenhar);
    window.SintoniaRastreio?.carregarSelos?.(true).then(desenhar).catch(() => {});
  }

  // ---------- menu ⋯ ----------
  function menuMais(ctx) {
    const { s } = ctx;
    const gestao = ctx.ehGestao();
    const f = ctx.funil();
    const clientes = (aba) => { window.SintoniaTelas?.clientes?.irAba?.(aba); s.ui.mostrar('clientes'); };
    const grupos = [[
      gestao && { nome: 'Importar', info: 'Trazer leads de uma planilha', icone: IC.importar, acao: () => clientes('importar') },
      gestao && { nome: 'Exportar', info: 'Baixar os contatos em CSV (abre no Excel)', icone: IC.exportar, acao: () => clientes('exportar') },
      gestao && { nome: 'Localizar duplicatas', info: 'Contatos repetidos para juntar', icone: IC.duplicatas, acao: () => { gravarLocal('sintonia.leads.aba', 'duplicatas'); clientes('importar'); } },
    ].filter(Boolean), [
      { nome: 'Configuração da lista', info: 'Quais campos aparecem no cartão e na lista', icone: IC.colunas, acao: () => configurarLista(ctx) },
      { nome: 'Imprimir', info: 'Versão limpa para papel ou PDF', icone: IC.imprimir, acao: () => imprimir(ctx) },
      gestao && f && { nome: 'Editar funil de vendas', info: 'Etapas: nome, cor, ordem e botão principal', icone: IC.funil, acao: () => editarFunil(ctx) },
      gestao && { nome: 'Nova transmissão', info: 'Mensagem para os leads filtrados', icone: IC.aviao, acao: () => novaTransmissao(ctx) },
    ].filter(Boolean), gestao ? [
      { nome: 'Novo pipeline', icone: IC.novo, acao: () => ctx.novoFunil() },
      { nome: 'Automações deste pipeline', icone: IC.fluxo, acao: () => abrirAutomacoes(ctx) },
    ] : []];
    ctx.folha('Pipeline', f ? f.nome : null, grupos.filter((g) => g.length));
  }

  // ---------- configuração da lista ----------
  function configurarLista(ctx) {
    const { s } = ctx; const { el } = s.ui;
    const P = window.SintoniaPainel; if (!P) return;
    const desenhar = (corpo) => {
      const c = config();
      const grupo = (qual, titulo, sub) => el('section', {}, el('h4', { text: titulo }), el('p', { class: 'ft-nota', style: 'margin:4px 2px 8px;font-size:13px;color:var(--sub)', text: sub }),
        el('div', { class: 'ft-campos' }, ...CAMPOS.filter(([k]) => qual === 'lista' || !SO_LISTA.has(k)).map(([k, nome]) => {
          const i = el('input', { type: 'checkbox' }); i.checked = c[qual].includes(k);
          i.addEventListener('change', () => {
            const atual = config();
            atual[qual] = i.checked ? [...atual[qual].filter((x) => x !== k), k] : atual[qual].filter((x) => x !== k);
            if (qual === 'lista') atual.lista = CAMPOS.map(([x]) => x).filter((x) => atual.lista.includes(x));
            gravarLocal('sintonia.crm.campos', JSON.stringify(atual));
            s.cartaoEls.clear(); ctx.desenharQuadro();
          });
          return el('label', {}, i, el('span', { text: nome }));
        })));
      corpo.replaceChildren(el('div', { class: 'ft-pag' },
        grupo('cartao', 'No cartão do quadro', 'O nome sempre aparece.'),
        grupo('lista', 'Colunas da lista', 'O nome sempre aparece.'),
        el('button', { class: 'ft-bt', type: 'button', onclick: () => { gravarLocal('sintonia.crm.campos', null); s.cartaoEls.clear(); ctx.desenharQuadro(); desenhar(corpo); } }, el('span', { html: IC.voltar, style: 'display:grid' }), el('span', { text: 'Voltar ao padrão' }))));
    };
    P.abrir({ id: 'crm-campos', titulo: 'Configuração da lista', montar: desenhar });
  }

  // ---------- editar funil de vendas ----------
  function editarFunil(ctx) {
    const { s } = ctx; const { el } = s.ui;
    const P = window.SintoniaPainel; if (!P) return;
    let corpo = null;
    const desenhar = () => {
      if (!corpo) return;
      const f = ctx.funil(); if (!f) return;
      const cols = s.q?.colunas || [];
      const nome = el('input', { value: f.nome, maxlength: '40', 'aria-label': 'Nome do funil' });
      const salvarNome = async () => {
        const v = nome.value.replace(/\s+/g, ' ').trim();
        if (!v || v === f.nome) { nome.value = f.nome; return; }
        if (await ctx.tentar(() => s.ui.api(`/api/funis/${f.id}`, { method: 'PATCH', body: JSON.stringify({ nome: v }) }), 'Funil renomeado ✓')) ctx.recarregar();
      };
      nome.addEventListener('change', salvarNome);
      const A = window.SintoniaFunilCelular?.ACOES || {};
      const padrao = f.sistema ? 'agendar' : 'ganho';
      const acao = el('select', { 'aria-label': 'Botão principal do cartão' }, ...Object.entries(A).map(([id, a]) => el('option', { value: id, text: a.nome + (id === padrao ? ' (padrão)' : '') })));
      acao.value = f.acaoPrincipal || padrao;
      acao.addEventListener('change', async () => {
        if (await ctx.tentar(() => s.ui.api(`/api/funis/${f.id}`, { method: 'PATCH', body: JSON.stringify({ acaoPrincipal: acao.value }) }), 'Botão principal salvo ✓')) ctx.recarregar();
      });
      const linhas = cols.map((col, i) => {
        const inp = el('input', { value: col.etapa.nome, maxlength: '30', 'aria-label': `Nome da etapa ${col.etapa.nome}` });
        inp.addEventListener('change', async () => {
          const v = inp.value.replace(/\s+/g, ' ').trim();
          if (!v || v === col.etapa.nome) { inp.value = col.etapa.nome; return; }
          if (await ctx.tentar(() => s.ui.api(`/api/funis/${f.id}/etapas/${col.etapa.id}`, { method: 'PATCH', body: JSON.stringify({ nome: v }) }), 'Etapa salva ✓')) ctx.recarregar();
        });
        const ic = (svg, rotulo, fn, desligado, perigo) => el('button', { class: 'ft-ic' + (perigo ? ' ft-perigo' : ''), type: 'button', title: rotulo, 'aria-label': rotulo, 'aria-disabled': desligado ? 'true' : null, html: svg, onclick: () => { if (!desligado) fn(); } });
        const linha = el('div', { class: 'ft-et' },
          el('button', { class: 'ft-cor-bt', type: 'button', title: 'Mudar a cor', 'aria-label': `Mudar a cor de ${col.etapa.nome}`, onclick: () => ctx.editarEtapa(col) }),
          inp, el('small', { text: `${col.total}` }),
          ic(IC.cima, 'Subir (mais à esquerda)', () => ctx.reordenar(col, -1), i === 0),
          ic(IC.baixo, 'Descer (mais à direita)', () => ctx.reordenar(col, 1), i === cols.length - 1),
          col.etapa.chaveSistema ? null : ic(IC.lixo, 'Apagar etapa', () => ctx.apagarEtapa(col), false, true));
        linha.style.setProperty('--cor', col.etapa.cor);
        return linha;
      });
      corpo.replaceChildren(el('div', { class: 'ft-pag' },
        el('label', { class: 'ft-campo' }, el('span', { text: 'Nome do funil' }), nome),
        f.sistema ? el('p', { class: 'ft-nota', style: 'margin:0;font-size:13px;color:var(--sub)', text: 'Funil do sistema: a IA move as clientes sozinha. Dá para renomear, recolorir e reordenar as etapas.' }) : null,
        el('h4', { text: 'Etapas' }),
        el('div', { class: 'ft-etapas' }, ...linhas),
        el('button', { class: 'ft-bt', type: 'button', onclick: () => ctx.novaEtapa() }, el('span', { html: IC.novo, style: 'display:grid' }), el('span', { text: 'Nova etapa' })),
        el('label', { class: 'ft-campo' }, el('span', { text: 'Ação principal do cartão' }), acao),
        el('p', { class: 'ft-nota', style: 'margin:-6px 2px 0;font-size:12.5px;color:var(--sub)', text: 'O botão do meio do cartão no celular (Agendar, Marcar como ganho, Fechar venda…).' }),
        f.sistema ? null : el('button', { class: 'ft-bt', type: 'button', style: 'color:#e5484d', onclick: () => { P.fechar(); ctx.apagarFunil(); } }, el('span', { html: IC.lixo, style: 'display:grid' }), el('span', { text: 'Apagar este funil' }))));
    };
    s.aoRedesenhar = () => { if (P.aberto('crm-funil')) desenhar(); };
    P.abrir({ id: 'crm-funil', titulo: 'Editar funil de vendas', montar: (c) => { corpo = c; desenhar(); }, aoFechar: () => { corpo = null; s.aoRedesenhar = null; } });
  }

  // ---------- automações deste pipeline ----------
  async function abrirAutomacoes(ctx) {
    const { s } = ctx; const { el } = s.ui;
    const P = window.SintoniaPainel; if (!P) { s.ui.mostrar('automacoes'); return; }
    const f = ctx.funil(); if (!f) return;
    let corpo = null, autos = null, bots = [];
    const carregar = async () => {
      try { [autos, bots] = await Promise.all([s.ui.api('/api/automacoes'), s.ui.api('/api/bots').catch(() => [])]); } catch (x) { autos = []; s.ui.toast(x.message); }
      bots = Array.isArray(bots) ? bots : [];
      desenhar();
    };
    const recarregar = async () => { await ctx.carregarAutos(true); ctx.desenharQuadro(); await carregar(); };
    const desenhar = () => {
      if (!corpo) return;
      if (!autos) { corpo.replaceChildren(el('p', { class: 'ft-auto-vazio', text: 'Carregando…' })); return; }
      const cols = s.q?.colunas || [];
      const ids = new Set(cols.map((c) => c.etapa.id));
      const linhaAuto = (a) => el('button', { class: 'ft-auto', type: 'button', title: 'Abrir e editar', onclick: () => { P.fechar(); window.SintoniaTelas.automacoes?.abrirEditor({ automacao: a, aoSalvar: recarregar }); } },
        el('span', { html: IC.fluxo, style: 'display:contents' }), el('span', { text: a.nome || 'Automação' }), el('small', { class: a.ligada ? 'ft-on' : '', text: a.ligada ? 'Ligada' : 'Desligada' }));
      const linhaBot = (b) => el('button', { class: 'ft-auto', type: 'button', title: 'Abrir o bot', onclick: () => { P.fechar(); window.SintoniaTelas.bot?.abrirEditor?.(b.id); } },
        el('span', { html: IC.fluxo, style: 'display:contents' }), el('span', { text: `Bot: ${b.nome || 'sem nome'}` }), el('small', { class: b.ligado || b.ativo || b.status === 'publicado' ? 'ft-on' : '', text: b.ligado || b.ativo || b.status === 'publicado' ? 'Ligado' : 'Rascunho' }));
      const porEtapa = cols.map((col) => {
        const as = autos.filter((a) => a.gatilho?.etapaId === col.etapa.id);
        const bs = bots.filter((b) => b.gatilho?.etapaId === col.etapa.id);
        const caixa = el('div', { class: 'ft-auto-et' },
          el('div', {}, el('i'), el('span', { text: col.etapa.nome }), el('button', { class: 'ft-mini', type: 'button', text: '+ Nova', onclick: () => { P.fechar(); ctx.abrirRaio(col); } })),
          ...(as.length || bs.length ? [...as.map(linhaAuto), ...bs.map(linhaBot)] : [el('div', { class: 'ft-auto-vazio', text: 'Nada acontece sozinho nesta etapa.' })]));
        caixa.style.setProperty('--cor', col.etapa.cor);
        return caixa;
      });
      const gerais = autos.filter((a) => a.funilId === f.id && !ids.has(a.gatilho?.etapaId));
      corpo.replaceChildren(el('div', { class: 'ft-pag' },
        el('p', { class: 'ft-nota', style: 'margin:0;font-size:13.5px;color:var(--sub)', text: `O que a Sintonia faz sozinha no pipeline “${f.nome}”, etapa por etapa.` }),
        el('div', { class: 'ft-autos' }, ...porEtapa),
        gerais.length ? el('h4', { text: 'Outras deste pipeline' }) : null,
        gerais.length ? el('div', { class: 'ft-auto-et' }, ...gerais.map(linhaAuto)) : null,
        el('button', { class: 'ft-bt', type: 'button', onclick: () => { P.fechar(); s.ui.mostrar('automacoes'); } }, el('span', { html: IC.fluxo, style: 'display:grid' }), el('span', { text: 'Ver todas em Automações › Fluxos' }))));
    };
    P.abrir({ id: 'crm-automacoes', titulo: 'Automações', montar: (c) => { corpo = c; desenhar(); }, aoFechar: () => { corpo = null; } });
    carregar();
  }

  // ---------- nova transmissão (leads filtrados ou de uma etapa) ----------
  async function novaTransmissao(ctx, col) {
    const { s } = ctx;
    const T = window.SintoniaTelas?.transmissoes;
    if (!ctx.ehGestao() || !T?.novaComPublico) { s.ui.toast('Transmissões ficam com a gestão.'); return; }
    const f = ctx.funil(); if (!f) return;
    const p = new URLSearchParams();
    if (s.unidade) p.set('unidade', s.unidade);
    const fu = filtroUrl(s); if (fu) p.set('filtro', fu);
    if (col) p.set('etapaId', col.etapa.id);
    let r;
    try { r = await s.ui.api(`/api/funis/${f.id}/ids?${p}`); } catch (x) { s.ui.toast(x.message); return; }
    let ids = r.ids || [];
    // Origem é um filtro do aparelho: aplica aqui também.
    const ra = window.SintoniaRastreio;
    if (s.origem && ra) {
      const conhecidos = new Map((s.q?.colunas || []).flatMap((c) => c.cartoes).map((c) => [c.conversaId, c]));
      ids = ids.filter((id) => { const c = conhecidos.get(id); return c ? ra.passa(id, c.origem, s.origem) : ra.passa(id, null, s.origem); });
    }
    if (!ids.length) { s.ui.toast('Nenhum lead com esses filtros.'); return; }
    const origemLista = [f.nome, col ? col.etapa.nome : '', contar(s) ? 'filtrado' : ''].filter(Boolean).join(' · ');
    T.novaComPublico({ conversas: ids, origemLista, nome: `${f.nome}${col ? ` · ${col.etapa.nome}` : ''}` });
    s.ui.toast(`${ids.length} lead${ids.length === 1 ? '' : 's'} no público${r.limite ? ' (o máximo é 5000)' : ''}`);
    s.ui.mostrar('transmissoes');
  }
  /** Transmissão para uma lista já escolhida (seleção da lista). */
  function transmissaoPara(ctx, ids) {
    const { s } = ctx;
    const T = window.SintoniaTelas?.transmissoes; const f = ctx.funil();
    if (!ctx.ehGestao() || !T?.novaComPublico) { s.ui.toast('Transmissões ficam com a gestão.'); return; }
    T.novaComPublico({ conversas: ids, origemLista: `${f?.nome || 'Pipeline'} · ${ids.length} escolhido${ids.length === 1 ? '' : 's'}`, nome: f?.nome || '' });
    s.ui.mostrar('transmissoes');
  }

  // ---------- lista ----------
  const visiveis = (ctx) => (ctx.s.q?.colunas || []).flatMap((col) => col.cartoes.filter(ctx.passa).map((c) => ({ c, col })))
    .sort((a, b) => new Date(b.c.atualizadaEm) - new Date(a.c.atualizadaEm));
  function desenharLista(ctx) {
    const { s } = ctx; const { el } = s.ui;
    const caixa = s.listaEl; if (!caixa) return;
    const c = config();
    s.selecao = s.selecao || new Set();
    const linhas = visiveis(ctx);
    const ids = new Set(linhas.map((x) => x.c.conversaId));
    for (const id of [...s.selecao]) if (!ids.has(id)) s.selecao.delete(id);
    const quando = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
    const celula = (k, x) => {
      const { c: cartao, col } = x;
      if (k === 'etapa') { const e = el('span', { class: 'ft-etapa' }, el('i'), el('span', { text: col.etapa.nome })); e.style.setProperty('--cor', col.etapa.cor); return e; }
      if (k === 'valor') return el('span', { style: 'font-weight:750;font-variant-numeric:tabular-nums', text: cartao.valor != null ? ctx.dinheiro(cartao.valor) : '—' });
      if (k === 'responsavel') return cartao.modo === 'ia' ? el('span', { text: 'IA' }) : el('span', { text: cartao.dona?.nome || 'Sem responsável' });
      if (k === 'origem') return ctx.origemEl(cartao);
      if (k === 'telefone') return el('span', { text: s.ui.formatarTel(cartao.telefone) });
      if (k === 'tags') return el('span', { style: 'display:inline-flex;gap:4px' }, ...(cartao.tags || []).slice(0, 3).map(ctx.tagEl));
      if (k === 'situacao') return ctx.situacaoEl(cartao, col.etapa.id);
      if (k === 'desde') return el('span', { text: cartao.desde ? ctx.haTexto(cartao.desde) : '—' });
      if (k === 'criado') return el('span', { text: quando(cartao.criadaEm) });
      if (k === 'atualizado') return el('span', { text: quando(cartao.atualizadaEm) });
      return el('span');
    };
    const nomeCampo = new Map(CAMPOS);
    const todos = el('input', { type: 'checkbox', 'aria-label': 'Escolher todos' });
    todos.checked = linhas.length > 0 && linhas.every((x) => s.selecao.has(x.c.conversaId));
    todos.addEventListener('change', () => { if (todos.checked) linhas.forEach((x) => s.selecao.add(x.c.conversaId)); else s.selecao.clear(); desenharLista(ctx); });
    const corpo = linhas.map((x) => {
      const id = x.c.conversaId;
      const nome = x.c.nome || s.ui.nomeDe({ telefone: x.c.telefone });
      const marca = el('input', { type: 'checkbox', 'aria-label': `Escolher ${nome}` });
      marca.checked = s.selecao.has(id);
      marca.addEventListener('click', (e) => e.stopPropagation());
      marca.addEventListener('change', () => { if (marca.checked) s.selecao.add(id); else s.selecao.delete(id); desenharLista(ctx); });
      const tr = el('tr', { 'aria-selected': String(s.selecao.has(id)), tabindex: '0', onclick: () => s.ui.abrir(id), onkeydown: (e) => { if (e.key === 'Enter') s.ui.abrir(id); } },
        el('td', { class: 'ft-sel' }, marca),
        el('td', {}, el('div', { class: 'ft-nome' }, s.ui.avatar({ id, nome: x.c.nome, telefone: x.c.telefone }), el('span', { text: nome }))),
        ...c.lista.map((k) => el('td', {}, celula(k, x))),
        el('td', { style: 'width:40px' }, el('button', { class: 'ft-mais', type: 'button', title: 'Mais opções', 'aria-label': `Mais opções de ${nome}`, html: IC.pontos, onclick: (e) => { e.stopPropagation(); ctx.menuCartao(id); } })));
      return tr;
    });
    const tabela = el('table', { class: 'ft-tab' },
      el('thead', {}, el('tr', {}, el('th', { class: 'ft-sel' }, todos), el('th', { text: 'Nome' }), ...c.lista.map((k) => el('th', { text: nomeCampo.get(k) })), el('th'))),
      el('tbody', {}, ...corpo));
    const faltam = (s.q?.colunas || []).reduce((n, col) => n + Math.max(0, col.total - col.cartoes.length), 0);
    const algumaMais = (s.q?.colunas || []).some((col) => col.mais);
    const n = s.selecao.size;
    const sel = [...s.selecao];
    const excluidos = !!s.filtro?.excluidos;
    const pe = el('div', { class: 'ft-lista-pe' },
      n ? el('div', { class: 'ft-massa' }, el('b', { text: `${n} escolhido${n === 1 ? '' : 's'}` }),
        ctx.ehGestao() ? el('button', { class: 'ft-bt', type: 'button', onclick: () => transmissaoPara(ctx, sel) }, el('span', { html: IC.aviao, style: 'display:grid' }), el('span', { text: 'Nova transmissão' })) : null,
        el('button', { class: 'ft-bt', type: 'button', onclick: async () => { if (await ctx.lixeira(sel, !excluidos)) { s.selecao.clear(); } } }, el('span', { html: excluidos ? IC.voltar : IC.lixo, style: 'display:grid' }), el('span', { text: excluidos ? 'Recuperar' : 'Excluir' })),
        el('button', { class: 'ft-mini', type: 'button', text: 'Desmarcar', onclick: () => { s.selecao.clear(); desenharLista(ctx); } }))
        : el('span', { text: `${linhas.length} lead${linhas.length === 1 ? '' : 's'} na lista${faltam ? ` · mais ${faltam} para carregar` : ''}` }),
      el('span', { style: 'flex:1' }),
      algumaMais ? el('button', { class: 'ft-bt', type: 'button', text: 'Carregar mais', onclick: () => ctx.carregarMaisTodas() }) : null);
    const rolar = caixa.querySelector('.ft-lista-rolar');
    const topo = rolar ? rolar.scrollTop : 0;
    const novo = el('div', { class: 'ft-lista-rolar' }, linhas.length ? tabela : el('div', { class: 'ft-vazio-l', text: s.q ? (contar(s) ? 'Ninguém com esses filtros.' : 'Nenhum lead neste pipeline ainda.') : 'Carregando…' }));
    caixa.replaceChildren(novo, pe);
    novo.scrollTop = topo;
  }

  // ---------- imprimir ----------
  function imprimir(ctx) {
    const { s } = ctx; const { el } = s.ui;
    const f = ctx.funil();
    const c = config();
    const nomeCampo = new Map(CAMPOS);
    const quando = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
    const texto = (k, cartao, col) => {
      if (k === 'etapa') return col.etapa.nome;
      if (k === 'valor') return cartao.valor != null ? ctx.dinheiro(cartao.valor) : '';
      if (k === 'responsavel') return cartao.modo === 'ia' ? 'IA' : cartao.dona?.nome || '';
      if (k === 'telefone') return s.ui.formatarTel(cartao.telefone);
      if (k === 'tags') return (cartao.tags || []).map((t) => t.nome).join(', ');
      if (k === 'situacao') return cartao.ultima ? `${cartao.ultima.autor === 'cliente' ? 'Cliente' : 'Equipe'} ${ctx.haTexto(cartao.ultima.em)}` : '';
      if (k === 'desde') return cartao.desde ? ctx.haTexto(cartao.desde) : '';
      if (k === 'criado') return quando(cartao.criadaEm);
      if (k === 'atualizado') return quando(cartao.atualizadaEm);
      if (k === 'origem') return ctx.nomeOrigem(cartao);
      return '';
    };
    const colunas = c.lista.filter((k) => k !== 'etapa');
    const filtros = pilulas(s).map((p) => p.rotulo);
    const folha = el('div', { class: 'ft-impressao' },
      el('h1', { text: `Pipeline ${f ? f.nome : ''}` }),
      el('p', { text: `Impresso em ${new Date().toLocaleString('pt-BR')}${filtros.length ? ` · Filtros: ${filtros.join('; ')}` : ''}` }),
      ...(s.q?.colunas || []).map((col) => {
        const cartoes = col.cartoes.filter(ctx.passa);
        const resto = col.total - col.cartoes.length;
        return el('section', {},
          el('h2', {}, el('span', { text: col.etapa.nome }), el('small', { text: `${cartoes.length} lead${cartoes.length === 1 ? '' : 's'}${resto > 0 ? ` (mais ${resto} não carregados)` : ''}` })),
          cartoes.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Nome' }), ...colunas.map((k) => el('th', { text: nomeCampo.get(k) })))),
            el('tbody', {}, ...cartoes.map((x) => el('tr', {}, el('td', { text: x.nome || s.ui.formatarTel(x.telefone) }), ...colunas.map((k) => el('td', { text: texto(k, x, col) })))))) : el('p', { text: '—' }));
      }));
    document.body.append(folha);
    document.documentElement.classList.add('ft-imprimindo');
    const fim = () => { document.documentElement.classList.remove('ft-imprimindo'); folha.remove(); removeEventListener('afterprint', fim); };
    addEventListener('afterprint', fim);
    setTimeout(() => { try { window.print(); } catch { /* sem impressão */ } setTimeout(() => { if (folha.isConnected && !matchMedia('print').matches) fim(); }, 1500); }, 60);
  }

  window.SintoniaFunilTopo = { estilo, config, lerFiltro, gravarFiltro, filtroUrl, paraServidor, vazio, contar, pilulas, montarTopo, desenharPilulas, desenharVistas, abrirFiltro, menuMais, desenharLista, novaTransmissao, abrirAutomacoes, editarFunil, configurarLista, imprimir, lembrarPessoas, VAZIO };
})();

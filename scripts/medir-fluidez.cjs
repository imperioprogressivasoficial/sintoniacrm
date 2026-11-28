// Mede a fluidez da Sintonia no "iPhone 13" emulado (Chromium), com a CPU 4x mais lenta (ver docs/FLUIDEZ.md).
// uso (app no ar na porta indicada, com a demonstração): node scripts/medir-fluidez.cjs <rotulo> [porta]
// grava medidas-<rotulo>.json na pasta atual. Precisa do Playwright instalado (require("playwright")).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const ROT = process.argv[2] || 'x';
const PORTA = process.argv[3] || '3500';
const BASE = `http://localhost:${PORTA}`;
const RODADAS = 3;

const NO_NAVEGADOR = () => {
  window.__fz = { longas: [], quadros: [], gravando: false };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__fz.longas.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  let ult = 0;
  const laco = (t) => { if (window.__fz.gravando && ult) window.__fz.quadros.push(t - ult); ult = t; requestAnimationFrame(laco); };
  requestAnimationFrame(laco);
};

async function janela(page, acao, cond, ms = 900) {
  await page.evaluate(() => { window.__fz.quadros = []; window.__fz.longas = []; window.__fz.gravando = true; window.__fz.t0 = performance.now(); });
  await acao();
  // tempo até o primeiro quadro com o conteúdo novo (cond pode ser [condição principal, condição extra])
  const conds = Array.isArray(cond) ? cond : [cond];
  const tempos = await page.evaluate(async ({ conds }) => {
    const fs = conds.map((c) => new Function('return (' + c + ')'));
    const t0 = window.__fz.t0; const res = fs.map(() => -1);
    return await new Promise((ok) => {
      const fim = performance.now() + 5000;
      const v = (t) => { fs.forEach((f, i) => { if (res[i] < 0) { let r = false; try { r = f(); } catch {} if (r) res[i] = t - t0; } }); if (res.every((x) => x >= 0) || performance.now() > fim) return ok(res); requestAnimationFrame(v); };
      requestAnimationFrame(v);
    });
  }, { conds });
  const ate = tempos[0];
  await page.waitForTimeout(ms);
  const r = await page.evaluate(() => {
    window.__fz.gravando = false;
    const q = window.__fz.quadros;
    const perdidos = q.reduce((s, d) => s + Math.max(0, Math.round(d / 16.67) - 1), 0);
    const longas = window.__fz.longas.filter((e) => e.t >= window.__fz.t0 - 5);
    return { quadros: q.length, perdidos, piorQuadro: Math.round(Math.max(0, ...q)), longas: longas.length, longasMs: Math.round(longas.reduce((s, e) => s + e.d, 0)) };
  });
  const extra = tempos.length > 1 ? { conversaNaTelaMs: Math.round(tempos[1]) } : {};
  return { primeiroQuadroMs: Math.round(ate), ...extra, ...r };
}

const media = (lista) => {
  const ks = Object.keys(lista[0]);
  const o = {};
  for (const k of ks) o[k] = Math.round((lista.reduce((s, x) => s + x[k], 0) / lista.length) * 10) / 10;
  return o;
};

(async () => {
  const nav = await chromium.launch();
  const ctx = await nav.newContext({ ...devices['iPhone 13'] });
  await ctx.request.post(BASE + '/api/auth/entrar', { data: { email: 'bruno@teste.com', senha: 'Imperio2026x' } });
  const page = await ctx.newPage();
  await page.addInitScript(NO_NAVEGADOR);
  if (process.env.SEM_VT) await page.addInitScript(() => { delete Document.prototype.startViewTransition; });
  const cdp = await ctx.newCDPSession(page);
  const res = {};

  // partida a frio (com a CPU lenta): da navegação até a lista na tela
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const partidas = [];
  for (let i = 0; i < RODADAS; i++) {
    const t = Date.now();
    await page.goto(BASE + '/app', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.querySelectorAll('#itens .item').length > 5, null, { timeout: 30000 });
    partidas.push({ listaNaTelaMs: Date.now() - t });
  }
  res.partida = media(partidas);
  await page.waitForTimeout(1500);

  const TOCAR = (sel) => async () => { await page.locator(sel).first().tap(); };
  // abas
  const abas = ['painel', 'ligacoes', 'serena', 'conversas', 'configuracoes'];
  res.abas = {};
  for (const r of [0, 1, 2]) {
    for (const a of abas) {
      const m = await janela(page, TOCAR(`.trilho .nav[data-vista="${a}"]`), `document.getElementById('v-${a}')?.classList.contains('ativa') && document.getElementById('v-${a}').offsetHeight > 0 && document.getElementById('v-${a}').innerText.trim().length > 20`);
      (res.abas[a] = res.abas[a] || []).push(m);
    }
  }
  for (const a of abas) res.abas[a] = media(res.abas[a]);

  // abrir e voltar da conversa
  await page.locator('.trilho .nav[data-vista="conversas"]').tap();
  await page.waitForTimeout(800);
  const abrir = [], voltar = [];
  for (let i = 0; i < RODADAS; i++) {
    await page.evaluate(() => document.getElementById('itens').scrollTo(0, 0));
    const id = await page.evaluate((i) => document.querySelectorAll('#itens .item')[2 + i].dataset.id, i);
    abrir.push(await janela(page, TOCAR(`#itens .item[data-id="${id}"]`), [`document.getElementById('msgs').dataset.conversa === '${id}' && document.getElementById('msgs').offsetHeight > 0 && !!document.querySelector('#msgs .bal')`, `document.querySelector('#v-conversas .chat').offsetHeight > 0 && document.querySelector('#v-conversas .chat').getBoundingClientRect().left < innerWidth - 2`]));
    voltar.push(await janela(page, TOCAR('#voltar'), `document.querySelector('#v-conversas .lista').offsetHeight > 0`));
  }
  res.abrirConversa = media(abrir); res.voltarConversa = media(voltar);
  // abrir de novo a mesma conversa (já vista nesta sessão)
  const reabrir = [];
  for (let i = 0; i < RODADAS; i++) {
    const id = await page.evaluate((i) => document.querySelectorAll('#itens .item')[2 + i].dataset.id, i);
    reabrir.push(await janela(page, TOCAR(`#itens .item[data-id="${id}"]`), [`document.getElementById('msgs').dataset.conversa === '${id}' && document.getElementById('msgs').offsetHeight > 0 && !!document.querySelector('#msgs .bal')`, `document.querySelector('#v-conversas .chat').offsetHeight > 0 && document.querySelector('#v-conversas .chat').getBoundingClientRect().left < innerWidth - 2`]));
    await page.locator('#voltar').tap(); await page.waitForTimeout(800);
  }
  res.reabrirConversa = media(reabrir);

  // folha (Selecionar modo) dentro da conversa
  const folha = [];
  for (let i = 0; i < RODADAS; i++) {
    const id = await page.evaluate(() => document.querySelectorAll('#itens .item')[1].dataset.id);
    await page.locator(`#itens .item[data-id="${id}"]`).tap();
    await page.waitForFunction((id) => document.getElementById('msgs').dataset.conversa === id, id);
    await page.waitForTimeout(700);
    folha.push(await janela(page, TOCAR('#modo'), `[...document.querySelectorAll('dialog[open]')].some((d) => d.getBoundingClientRect().height > 50)`));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.locator('#voltar').tap();
    await page.waitForTimeout(700);
  }
  res.abrirFolha = media(folha);
  const mover = [];
  for (let i = 0; i < RODADAS; i++) {
    const id = await page.evaluate(() => document.querySelectorAll('#itens .item')[1].dataset.id);
    mover.push(await janela(page, () => page.evaluate((id) => window.SintoniaTelas.conversasGestos.fazer('mover', id), id), `[...document.querySelectorAll('dialog.cg-folha[open]')].some((d) => d.getBoundingClientRect().height > 50)`));
    await page.evaluate(() => document.querySelector('dialog.cg-folha[open]')?.close());
    await page.waitForTimeout(600);
  }
  res.abrirFolhaMover = media(mover);

  // rolar a lista (gesto de toque real, pelo compositor)
  const rolar = [];
  for (let i = 0; i < RODADAS; i++) {
    await page.evaluate(() => document.getElementById('itens').scrollTo(0, 0));
    await page.waitForTimeout(300);
    rolar.push(await janela(page, async () => { await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 600, yDistance: -2500, speed: 2500, gestureSourceType: 'touch' }); }, 'true', 300));
  }
  res.rolarLista = media(rolar);

  // custo de redesenhar a lista (o que roda a cada 4 s com a atualização)
  res.redesenharListaMs = await page.evaluate(() => {
    const ui = window.Sintonia.ui; const n = 20; const t = performance.now();
    for (let i = 0; i < n; i++) { ui.desenharLista(); document.getElementById('itens').offsetHeight; }
    return Math.round(((performance.now() - t) / n) * 10) / 10;
  });

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await nav.close();
  fs.writeFileSync(`medidas-${ROT}.json`, JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });

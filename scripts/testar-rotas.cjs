/* rotas-fontes: confere os endereços do app no navegador (Playwright), no computador e no celular.
 *   Uso: com o app no ar (ex.: PORT=3630 npx tsx src/index.ts), rode
 *   BASE=http://localhost:3630 EMAIL=bruno@teste.com SENHA=... node scripts/testar-rotas.cjs [pc|cel] [1|2]
 *   1 = links diretos, login com volta, recarregar, voltar/avançar, links antigos, todas as telas (cria dados de demonstração).
 *   2 = voltar com o painel lateral aberto, fechar painel e trocar de tela na hora, seta voltar da conversa. */
const QUAL = process.argv[3] || '1';
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3630';
const erros = [];
async function parte1() {
  const b = await chromium.launch();
  const modo = process.argv[2] || 'pc';
  const ctx = await b.newContext(modo === 'cel' ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push('pageerror ' + e.message));
  const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
  // link direto sem login -> entrar?volta -> volta
  await p.goto(BASE + '/app/dashboard');
  ok(p.url().includes('/entrar?volta=%2Fapp%2Fdashboard'), 'sem login vai para /entrar?volta: ' + p.url());
  await p.fill('#email', process.env.EMAIL || 'bruno@teste.com'); await p.fill('#senha', process.env.SENHA || ''); await p.click('button[type=submit]');
  await p.waitForURL(/\/app\/dashboard/, { timeout: 10000 });
  await p.waitForTimeout(1500);
  ok(p.url().endsWith('/app/dashboard'), 'depois do login voltou para ' + p.url());
  ok(await p.evaluate(() => window.Sintonia.ui.estado.vista) === 'painel', 'tela Dashboard aberta');
  await p.evaluate(() => fetch('/api/demo/popular', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  const vista = () => p.evaluate(() => window.Sintonia.ui.estado.vista);
  const caminho = () => p.evaluate(() => location.pathname);
  // clicar no menu
  const clicar = async (v) => { const sel = modo === 'cel' ? `.trilho .nav[data-vista="${v}"]` : `#lt-grupos .nav[data-vista="${v}"], .lateral .nav[data-vista="${v}"]`; await p.evaluate((s) => { const b = [...document.querySelectorAll(s)].find((x) => x.offsetParent); (b || document.querySelector(s)).click(); }, sel); await p.waitForTimeout(700); };
  await clicar('conversas');
  ok(await caminho() === '/app/conversas', 'Conversas -> ' + await caminho());
  await p.evaluate(() => window.Sintonia.ui.atualizar());
  await p.waitForSelector('#itens .item', { timeout: 10000 });
  await p.click('#itens .item');
  await p.waitForTimeout(900);
  const id = await p.evaluate(() => window.Sintonia.ui.estado.aberta);
  ok(await caminho() === '/app/conversas/' + id, 'conversa aberta -> ' + await caminho());
  await p.reload(); await p.waitForTimeout(2500);
  ok(await caminho() === '/app/conversas/' + id && await p.evaluate(() => window.Sintonia.ui.estado.aberta) === id, 'recarregar mantém a conversa aberta');
  if (modo === 'cel') ok(await p.evaluate(() => document.getElementById('v-conversas').classList.contains('abrindo')), 'celular: conversa na frente depois de recarregar');
  if (process.env.PRINTS) await p.screenshot({ path: `${process.env.PRINTS}/depois-conversa-${modo}.png` });
  await p.goBack(); await p.waitForTimeout(900);
  ok(await caminho() === '/app/conversas', 'voltar fecha a conversa -> ' + await caminho());
  ok(await vista() === 'conversas', 'continua em Conversas');
  if (modo === 'cel') ok(!(await p.evaluate(() => document.getElementById('v-conversas').classList.contains('abrindo'))), 'celular: lista na frente');
  else ok(!(await p.evaluate(() => window.Sintonia.ui.estado.aberta)), 'computador: conversa fechada');
  await p.goForward(); await p.waitForTimeout(1200);
  ok(await caminho() === '/app/conversas/' + id && await p.evaluate(() => window.Sintonia.ui.estado.aberta) === id, 'avançar reabre a conversa');
  // seta voltar da conversa (sem empilhar)
  if (modo === 'cel') { await p.click('#voltar'); await p.waitForTimeout(900); ok(await caminho() === '/app/conversas', 'seta voltar -> ' + await caminho()); }
  // pipelines
  await (modo === 'cel' ? p.evaluate(() => window.Sintonia.ui.mostrar('funil')) : clicar('funil'));
  await p.waitForTimeout(2500);
  const fid = await p.evaluate(() => window.SintoniaTelas.funil.atual());
  ok(await caminho() === '/app/pipelines/' + fid, 'Pipeline -> ' + await caminho());
  // análises com aba
  await p.goto(BASE + '/app/analises/horarios'); await p.waitForTimeout(2500);
  ok(await vista() === 'analises' && await p.evaluate(() => window.SintoniaTelas.analises.aba()) === 'horarios', 'link direto /app/analises/horarios');
  if (process.env.PRINTS) await p.screenshot({ path: `${process.env.PRINTS}/depois-analises-${modo}.png` });
  await p.evaluate(() => [...document.querySelectorAll('[role=tab]')].find((x) => /vendas/i.test(x.textContent))?.click()); await p.waitForTimeout(600);
  ok(await caminho() === '/app/analises/vendas', 'trocar aba muda o endereço -> ' + await caminho());
  await p.goBack(); await p.waitForTimeout(1200);
  ok(await caminho() === '/app/analises/horarios' && await p.evaluate(() => window.SintoniaTelas.analises.aba()) === 'horarios', 'voltar volta a aba -> ' + await caminho());
  // links antigos
  await p.goto(BASE + '/app#vista=chat-equipe'); await p.waitForTimeout(2500);
  ok(await vista() === 'chat-equipe' && await caminho() === '/app/chat-equipe' && !(await p.evaluate(() => location.hash)), 'link antigo #vista=chat-equipe -> ' + await caminho());
  await p.goto(BASE + '/app#criativos'); await p.waitForTimeout(2500);
  ok(await vista() === 'criativos' && await caminho() === '/app/criativos', 'link antigo #criativos -> ' + await caminho());
  await p.goto(BASE + '/app#conversa=' + id); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => window.Sintonia.ui.estado.aberta) === id && await caminho() === '/app/conversas/' + id, 'link antigo #conversa= -> ' + await caminho());
  await p.goto(BASE + '/app'); await p.waitForTimeout(2000);
  ok(await caminho() === '/app/conversas', '/app puro vira /app/conversas');
  // todas as vistas
  const todas = await p.evaluate(() => Object.keys(window.SintoniaRotas.CAMINHO));
  for (const v of todas) {
    await p.evaluate((v) => window.Sintonia.ui.mostrar(v), v); await p.waitForTimeout(250);
    const c = await caminho(); const r = await p.evaluate((c) => window.SintoniaRotas.ler(c).vista, c);
    const atual = await vista();
    ok(r === atual, `vista ${v} -> ${c}`);
  }
  // Android: voltar várias vezes não sai do app até o começo
  await p.goto(BASE + '/app/agenda'); await p.waitForTimeout(2000);
  ok(await vista() === 'agenda', 'link direto /app/agenda');
  console.log('erros de página:', erros.length ? erros : 'nenhum');
  await b.close();
}

async function parte2() {
  const b = await chromium.launch();
  const modo = process.argv[2] || 'cel';
  const ctx = await b.newContext(modo === 'cel' ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
  await p.goto(BASE + '/entrar');
  await p.fill('#email', process.env.EMAIL || 'bruno@teste.com'); await p.fill('#senha', process.env.SENHA || ''); await p.click('button[type=submit]');
  await p.waitForURL(/\/app/); await p.waitForTimeout(1500);
  const caminho = () => p.evaluate(() => location.pathname);
  const st = () => p.evaluate(() => ({ v: window.Sintonia.ui.estado.vista, a: window.Sintonia.ui.estado.aberta, ab: document.getElementById('v-conversas').classList.contains('abrindo'), pl: !!window.SintoniaPainel?.aberto?.() }));
  await p.evaluate(() => window.Sintonia.ui.mostrar('painel')); await p.waitForTimeout(500);
  await p.evaluate(() => window.Sintonia.ui.mostrar('conversas')); await p.waitForTimeout(500);
  await p.waitForSelector('#itens .item'); await p.click('#itens .item'); await p.waitForTimeout(800);
  const id = (await st()).a;
  // painel lateral por cima da conversa
  await p.evaluate(() => window.SintoniaPainel.abrir({ titulo: 'Ficha teste', montar: (c) => c.append('oi') })); await p.waitForTimeout(500);
  await p.evaluate(() => window.SintoniaPainel.empurrar({ titulo: 'Sub', montar: (c) => c.append('sub') })); await p.waitForTimeout(500);
  ok((await caminho()) === '/app/conversas/' + id, 'painel aberto: endereço continua o da conversa');
  await p.goBack(); await p.waitForTimeout(600);
  let s = await st(); ok(s.pl && (await caminho()) === '/app/conversas/' + id, 'voltar 1: volta uma página do painel');
  await p.goBack(); await p.waitForTimeout(700);
  s = await st(); ok(!s.pl && s.a === id && (modo !== 'cel' || s.ab), 'voltar 2: fecha o painel, conversa continua');
  await p.goBack(); await p.waitForTimeout(800);
  s = await st(); ok((await caminho()) === '/app/conversas' && (modo === 'cel' ? !s.ab : !s.a), 'voltar 3: fecha a conversa');
  await p.goBack(); await p.waitForTimeout(800);
  s = await st(); ok(s.v === 'painel' && (await caminho()) === '/app/dashboard', 'voltar 4: Dashboard -> ' + await caminho());
  // painel aberto e fechado pelo X (history.go) e logo depois troca de tela
  await p.goForward(); await p.waitForTimeout(800);
  await p.evaluate(() => window.SintoniaPainel.abrir({ titulo: 'X', montar: (c) => c.append('x') })); await p.waitForTimeout(400);
  await p.evaluate(() => { window.SintoniaPainel.fechar(); window.Sintonia.ui.mostrar('agenda'); }); await p.waitForTimeout(1200);
  s = await st(); ok(s.v === 'agenda' && (await caminho()) === '/app/agenda', 'fechar painel e trocar de tela na hora: fica na Agenda -> ' + await caminho());
  await p.goBack(); await p.waitForTimeout(800);
  ok((await st()).v === 'conversas', 'voltar da Agenda -> Conversas (' + await caminho() + ')');
  // seta voltar não empilha
  await p.click('#itens .item'); await p.waitForTimeout(800);
  const n1 = await p.evaluate(() => history.length);
  if (modo === 'cel') { await p.click('#voltar'); await p.waitForTimeout(900); }
  else { await p.evaluate(() => window.Sintonia.ui.fecharConversa()); await p.waitForTimeout(900); }
  ok((await caminho()) === '/app/conversas', 'fechar conversa -> /app/conversas');
  await p.goForward(); await p.waitForTimeout(800);
  ok((await st()).a === id || (await caminho()).startsWith('/app/conversas/'), 'avançar depois de fechar reabre (' + await caminho() + ', ' + n1 + ')');
  console.log('erros:', erros.length ? erros : 'nenhum');
  await b.close();
}

(QUAL === '2' ? parte2() : parte1()).catch((x) => { console.error(x); process.exit(1); });

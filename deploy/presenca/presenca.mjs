// Sintonia · presença da equipe (disponível / fora do ar). Serviço à parte: guarda só o status de cada pessoa.
// Quem pergunta é conferido pela própria Sintonia (/api/auth/eu com o cookie da pessoa); só vê o status da própria equipe (/api/equipe).
import http from 'node:http';
import fs from 'node:fs';

const APP = process.env.APP_URL || 'http://sintonia-app-1:3333';
const ORIGEM = process.env.ORIGEM || 'https://sintonia.n8nimperio.tech';
const ARQ = '/dados/presenca.json';
let dados = {};
try { dados = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch {}
const salvar = () => { fs.writeFileSync(ARQ + '.tmp', JSON.stringify(dados)); fs.renameSync(ARQ + '.tmp', ARQ); };

async function daSintonia(caminho, cookie) {
  const r = await fetch(APP + caminho, { headers: { cookie: cookie || '', accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  return r.ok ? r.json() : null;
}
function responder(res, cod, obj) {
  res.writeHead(cod, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/saude') return responder(res, 200, { ok: true });
    if (url.pathname !== '/api/presenca') return responder(res, 404, { erro: 'Não encontrado.' });
    const cookie = req.headers.cookie;
    const eu = await daSintonia('/api/auth/eu', cookie);
    if (!eu?.id) return responder(res, 401, { erro: 'Entre de novo.' });
    if (req.method === 'GET') {
      const equipe = await daSintonia('/api/equipe', cookie);
      const ids = new Set([eu.id, ...((equipe && equipe.pessoas) || []).map((p) => p.id)]);
      const status = {};
      for (const id of ids) status[id] = dados[id]?.status || 'online';
      return responder(res, 200, { eu: eu.id, status });
    }
    if (req.method === 'PUT') {
      if (req.headers.origin !== ORIGEM) return responder(res, 403, { erro: 'Origem não permitida.' });
      let corpo = '';
      for await (const parte of req) { corpo += parte; if (corpo.length > 1000) return responder(res, 413, { erro: 'Grande demais.' }); }
      const { status } = JSON.parse(corpo || '{}');
      if (status !== 'online' && status !== 'offline') return responder(res, 400, { erro: 'Status inválido.' });
      dados[eu.id] = { status, em: new Date().toISOString() };
      salvar();
      return responder(res, 200, { ok: true, status });
    }
    return responder(res, 405, { erro: 'Método não permitido.' });
  } catch (e) {
    console.error('[presenca]', e?.message);
    return responder(res, 500, { erro: 'Falhou, tente de novo.' });
  }
}).listen(3400, '0.0.0.0', () => console.log('[presenca] no ar na porta 3400'));

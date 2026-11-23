import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { config } from './config.js';
import { openDb } from './db.js';
import { Arena } from './game.js';
import { Brain } from './ai.js';
import { startSimulator } from './sim.js';
import { connectTikTok } from './tiktok.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const db = openDb();
const arena = new Arena(db).start();
const brain = new Brain(arena, db);
brain.on('error', (e) => console.error('[ia]', e.message));

const clients = new Set();
const speech = [];
const broadcast = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
};
arena.on('evt', (e) => broadcast('evt', e));
brain.on('say', (s) => { speech.push(s); if (speech.length > 50) speech.shift(); broadcast('say', s); });
setInterval(() => broadcast('state', arena.snapshot()), 1000);

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(arena.snapshot())}\n\n`);
    res.write(`event: init\ndata: ${JSON.stringify({ feed: arena.feed.slice(-40), speech: speech.slice(-20), simulate: config.simulate })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') return json(res, 200, arena.snapshot());
  if (url.pathname === '/api/leaderboard') return json(res, 200, db.leaderboard(url.searchParams.get('by') ?? 'wins', 50));
  if (url.pathname === '/api/history') return json(res, 200, db.userHistory(url.searchParams.get('user') ?? '', 30));
  if (req.method === 'POST' && url.pathname === '/api/sim') { // actions manuelles depuis le dashboard
    if (!config.simulate) return json(res, 403, { error: 'simulation désactivée en mode live' });
    const b = await readBody(req);
    const name = String(b.name || 'testeur').slice(0, 30);
    if (b.type === 'chat') arena.chat(name, name, String(b.text || 'salut').slice(0, 200));
    else if (b.type === 'gift') arena.gift(name, name, Math.max(0, +b.coins || 1), 'test');
    else if (b.type === 'like') arena.like(name, name, +b.count || 10);
    else if (b.type === 'skip' && arena.phase === 'lobby' && arena.players.size >= 2) arena.timer = 1;
    return json(res, 200, { ok: true });
  }

  // fichiers statiques
  let rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([/\\])+/, '');
  if (rel.includes('..')) return json(res, 400, { error: 'bad path' });
  try {
    const data = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' });
    res.end(data);
  } catch { json(res, 404, { error: 'not found' }); }
});

server.listen(config.port, () => {
  console.log(`Dashboard : http://localhost:${config.port}`);
  console.log(`IA : ${config.ollamaModel} @ ${config.ollamaUrl} (fallback texte si indisponible)`);
});

if (config.simulate) {
  console.log('[mode simulation] faux viewers actifs');
  startSimulator(arena);
} else {
  connectTikTok(arena).catch((e) => console.error('[tiktok] connexion impossible :', e.message));
}

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { config, POWERS } from './config.js';
import { openDb } from './db.js';
import { Arena } from './game.js';
import { Brain } from './ai.js';
import { LlmChain } from './llm.js';
import { startSimulator } from './sim.js';
import { LiveLink } from './tiktok.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

// Simulation = base en mémoire (jamais mélangée aux vraies données du live) ; live = data/arena.db
const db = openDb(config.simulate ? ':memory:' : undefined);
const arena = new Arena(db).start();
const chain = new LlmChain();
const brain = new Brain(arena, db, { llm: chain });
brain.on('error', (e) => console.error('[ia]', e.message));
chain.refreshHealth();
setInterval(() => chain.refreshHealth(), 30000);

let link = null; // LiveLink (mode live) ; null en simulation
let stopSim = null;

const clients = new Set();
const speech = [];
const broadcast = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
};
const status = () => ({
  simulate: config.simulate && !!stopSim, mode: config.simulate ? 'simulation' : 'live',
  link: link?.snapshot() ?? null,
  ai: { ...chain.status(), said: brain.stats.said, replies: brain.stats.replies },
  uptime: Math.round(process.uptime()),
});
arena.on('evt', (e) => broadcast('evt', e));
brain.on('say', (s) => { speech.push(s); if (speech.length > 50) speech.shift(); broadcast('say', s); });
setInterval(() => { broadcast('state', arena.snapshot()); broadcast('status', status()); }, 1000);

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(arena.snapshot())}\n\n`);
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
    res.write(`event: init\ndata: ${JSON.stringify({ feed: arena.feed.slice(-40), speech: speech.slice(-20), simulate: config.simulate })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') return json(res, 200, arena.snapshot());
  if (url.pathname === '/api/status') return json(res, 200, status());
  if (url.pathname === '/api/config') return json(res, 200, { persona: config.persona, powers: [...POWERS].reverse(), heartGoal: config.heartGoal });
  if (url.pathname === '/api/leaderboard') return json(res, 200, db.leaderboard(url.searchParams.get('by') ?? 'wins', 50));
  if (url.pathname === '/api/history') return json(res, 200, db.userHistory(url.searchParams.get('user') ?? '', 30));
  if (req.method === 'POST' && url.pathname === '/api/link') { // mode auto / on / off du lien TikTok
    if (!link) return json(res, 400, { error: 'mode simulation : pas de lien TikTok' });
    link.setMode((await readBody(req)).mode);
    return json(res, 200, link.snapshot());
  }
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

server.listen(config.port, config.host, () => {
  console.log(`Backstage : http://localhost:${config.port}   Overlay : http://localhost:${config.port}/overlay.html`);
  console.log(`IA : ${config.llmOrder.join(' -> ')} -> phrases pré-écrites`);
});

if (config.simulate) {
  console.log('[mode simulation] faux viewers actifs (renseigne TIKTOK_USERNAME dans .env pour le live)');
  stopSim = startSimulator(arena);
} else {
  link = new LiveLink(arena);
  console.log(`[tiktok] @${config.tiktokUser} — planning : ${config.schedule || 'toute la journée'}`);
}

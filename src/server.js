import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { config, POWERS, BAREME } from './config.js';
import { fetchImage } from './imgproxy.js';
import { buildMemory, memoryPrompt } from './memory.js';
import { openDb } from './db.js';
import { Arena } from './game.js';
import { Brain } from './ai.js';
import { LlmChain } from './llm.js';
import { startSimulator } from './sim.js';
import { LiveLink } from './tiktok.js';
import { Settings } from './settings.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const THREE_DIR = fileURLToPath(new URL('../node_modules/three/build/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

// Simulation = base en mémoire (jamais mélangée aux vraies données du live) ; live = data/arena.db
const db = openDb(config.simulate ? ':memory:' : undefined);
const arena = new Arena(db).start();
const chain = new LlmChain();
const brain = new Brain(arena, db, { llm: chain });
brain.on('error', (e) => console.error('[ia]', e.message));
// réglages modifiables en direct depuis le backstage (voix, relances...), sauvegardés dans data/settings.json
const settings = new Settings();
brain.applySettings(settings.get());
settings.on('change', (all) => { brain.applySettings(all); broadcast('settings', all); });
// charge Gemma en mémoire dès le démarrage (et la garde chaude) : la 1re vraie réplique n'attend pas le chargement du modèle
chain.warmup().then(() => console.log('[ia] modèle préchargé')).catch(() => {});
setInterval(() => chain.warmup(), 8 * 60 * 1000);
// état de l'overlay (page ouverte dans LIVE Studio) : envoyé par l'overlay toutes les 5 s
let overlay = { ts: 0 };
const overlayState = () => ({ ...overlay, online: Date.now() - overlay.ts < 15000 });
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
  uptime: Math.round(process.uptime()), overlay: overlayState(),
});
// Les événements qui changent le décor (cadeau, pouvoir, début/fin de combat...) sont précédés d'un état à jour :
// l'overlay voit le nouveau pouvoir / gladiateur AVANT de lancer l'animation, sans attendre le tick d'1 s.
const STATE_FIRST = new Set(['gift', 'power', 'join', 'shieldSave', 'fightStart', 'roundEnd', 'bossSpawn', 'bossDown', 'lobby']);
let killPush = null;
arena.on('evt', (e) => {
  if (STATE_FIRST.has(e.type)) broadcast('state', arena.snapshot());
  broadcast('evt', e);
  if (e.type === 'kill' && !killPush) killPush = setTimeout(() => { killPush = null; broadcast('state', arena.snapshot()); }, 150);
});
brain.on('say', (s) => { speech.push(s); if (speech.length > 50) speech.shift(); broadcast('say', s); });
setInterval(() => { broadcast('state', arena.snapshot()); broadcast('status', status()); }, 1000);

// courbes du backstage : un échantillon toutes les 10 s (1 h d'historique en mémoire)
const timeline = [];
setInterval(() => {
  const t = arena.stats;
  timeline.push({ t: Date.now(), viewers: t.viewers, likes: t.likes, coins: t.coins, chats: t.chats, joins: t.joins, players: arena.players.size });
  if (timeline.length > 360) timeline.shift();
}, 10000);

const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && req.headers['x-arena'] !== '1') return json(res, 403, { error: 'en-tête X-Arena manquant' });
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(arena.snapshot())}\n\n`);
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
    res.write(`event: init\ndata: ${JSON.stringify({ feed: arena.feed.slice(-40), speech: speech.slice(-20), simulate: config.simulate, settings: settings.get() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') return json(res, 200, arena.snapshot());
  if (url.pathname === '/api/status') return json(res, 200, status());
  // ---------- historique, profils, modération (onglets du backstage) ----------
  const qp = (k) => url.searchParams.get(k) ?? '';
  if (url.pathname === '/api/search') return json(res, 200, db.searchMessages({ user: qp('user'), q: qp('q'), role: qp('role'), limit: qp('limit'), offset: qp('offset') }));
  if (url.pathname === '/api/search.csv') { // export de la recherche en cours
    const { rows } = db.searchMessages({ user: qp('user'), q: qp('q'), role: qp('role'), limit: 100000 });
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="historique.csv"' });
    return res.end('﻿date,pseudo,qui,message\n' + rows.reverse().map((r) => [new Date(r.ts).toISOString(), r.name, r.role === 'ai' ? config.persona : 'viewer', r.text].map(csvCell).join(',')).join('\n'));
  }
  if (url.pathname === '/api/users') return json(res, 200, db.findUsers(qp('q'), 40));
  if (url.pathname === '/api/user') { // fiche d'un viewer + ce que Maxima s'en rappellerait (champ "text" = question hypothétique)
    const profile = db.userProfile(qp('id'));
    if (!profile) return json(res, 404, { error: 'viewer inconnu' });
    const memory = buildMemory(db, { id: profile.id, text: qp('text'), exclude: [] });
    return json(res, 200, { profile, conversation: db.conversation(profile.id, 200), memory, memoryPrompt: memoryPrompt(memory, profile.name) });
  }
  if (url.pathname === '/api/blocked') return json(res, 200, { rows: db.recentBlocked(200), stats: db.blockedStats() });
  if (url.pathname === '/api/timeline') return json(res, 200, timeline);
  if (url.pathname === '/api/settings') return json(res, 200, { // rien de secret : la clé Groq n'est jamais exposée
    persona: config.persona, mode: config.simulate ? 'simulation' : 'live', tiktokUser: config.tiktokUser, schedule: config.schedule || 'toute la journée',
    llmOrder: config.llmOrder, ollama: { url: config.ollamaUrl, model: config.ollamaModel }, groq: { enabled: !!config.groqKey, model: config.groqModel },
    lobbySeconds: config.lobbySeconds, startHp: config.startHp, heartGoal: config.heartGoal, showAvatars: settings.get().showAvatars, runtime: settings.get(), overlay: overlayState(), host: config.host, port: config.port,
    powers: [...POWERS].reverse(), bareme: BAREME, messages: db.messageStats(), node: process.version, uptime: Math.round(process.uptime()) });
  if (url.pathname === '/api/gifts') return json(res, 200, { gifts: db.recentGifts(100), days: db.giftTotals() });
  if (url.pathname === '/api/gifts.csv') { // export pour un tableur
    const rows = db.recentGifts(100000).reverse().map((g) => [new Date(g.ts).toISOString(), g.name, g.gift, g.coins, g.power ?? '', g.round]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="cadeaux.csv"' });
    return res.end('﻿date,pseudo,cadeau,pieces,pouvoir,round\n' + rows.join('\n'));
  }
  if (url.pathname === '/api/config') {
    const cat = link?.catalog ?? [];
    const bareme = BAREME.map((b) => { // en live : prix + image réels du catalogue TikTok
      const real = cat.find((c) => c.name.toLowerCase() === b.gift.toLowerCase());
      return { ...b, coins: real?.coins || b.coins, image: real?.image ? '/api/img?u=' + encodeURIComponent(real.image) : null };
    });
    const st = settings.get();
    return json(res, 200, { persona: config.persona, powers: [...POWERS].reverse(), bareme, showAvatars: st.showAvatars, heartGoal: config.heartGoal, voice: { enabled: st.voiceEnabled, volume: st.volume, pitch: st.pitch, rate: st.rate, voiceName: st.voiceName } });
  }
  if (url.pathname === '/api/img') { // proxy d'images (liste blanche TikTok) : avatars et images de cadeaux
    try {
      const img = await fetchImage(url.searchParams.get('u') ?? '');
      if (!img) return json(res, 404, { error: 'image refusée ou introuvable' });
      res.writeHead(200, { 'content-type': img.type, 'cache-control': 'public, max-age=86400' });
      return res.end(img.body);
    } catch { return json(res, 502, { error: 'téléchargement impossible' }); }
  }
  if (url.pathname === '/api/leaderboard') return json(res, 200, db.leaderboard(url.searchParams.get('by') ?? 'wins', 50));
  if (url.pathname === '/api/history') return json(res, 200, db.userHistory(url.searchParams.get('user') ?? '', 30));
  // ---------- réglages en direct + état de l'overlay ----------
  if (url.pathname === '/api/runtime' && req.method === 'GET') return json(res, 200, { settings: settings.get(), overlay: overlayState() });
  if (url.pathname === '/api/runtime' && req.method === 'POST') return json(res, 200, { settings: settings.update(await readBody(req)) });
  if (url.pathname === '/api/overlay' && req.method === 'POST') { // battement de cœur de l'overlay : voix débloquée ? voix dispo ? images/s ?
    const b = await readBody(req);
    overlay = { ts: Date.now(), unlocked: !!b.unlocked, voices: Array.isArray(b.voices) ? b.voices.slice(0, 30).map((v) => String(v).slice(0, 80)) : [],
      voiceUsed: String(b.voiceUsed ?? '').slice(0, 80), fps: Number(b.fps) || 0, quality: Number(b.quality) || 0, glads: Number(b.glads) || 0 };
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/overlay/test' && req.method === 'POST') { broadcast('cmd', { type: 'testVoice' }); return json(res, 200, { ok: true }); } // « tester la voix » depuis le backstage
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
    // three.js servi en local (pas de CDN : l'overlay marche même sans internet)
    const isThree = url.pathname.startsWith('/vendor/three/'); // (normalize() met des \ sous Windows : on teste le chemin d'URL)
    if (isThree && /\.\.|%/.test(url.pathname)) return json(res, 400, { error: 'bad path' });
    const base = isThree ? THREE_DIR : PUBLIC;
    const data = await readFile(join(base, isThree ? url.pathname.slice('/vendor/three/'.length) : rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
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

import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { parseChat, parseLike, parseGift, parseViewers, parseCatalog } from './tiktokMap.js';

/** "12:00-14:00,18:00-23:30" -> [[720,840],[1080,1410]] (minutes depuis minuit). Vide = []. */
export function parseSchedule(str) {
  return (str || '').split(',').map((s) => s.trim()).filter(Boolean).map((r) => {
    const m = r.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error(`SCHEDULE invalide : "${r}" (format attendu HH:MM-HH:MM)`);
    return [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]];
  });
}

/** true si `date` est dans une plage (les plages qui passent minuit sont gérées). Aucune plage = toujours. */
export function inWindow(windows, date = new Date()) {
  if (!windows.length) return true;
  const m = date.getHours() * 60 + date.getMinutes();
  return windows.some(([a, b]) => (a <= b ? m >= a && m < b : m >= a || m < b));
}

/**
 * Lien TikTok piloté par un planning. Modes :
 *  - auto : se connecte tout seul dans les plages horaires, réessaie tant que le live n'est pas lancé
 *  - on   : connecté en permanence (réessaie)
 *  - off  : déconnecté
 * Statuts : off | waiting-window | connecting | waiting-live | live
 */
export class LiveLink extends EventEmitter {
  constructor(arena, { user = config.tiktokUser, windows = parseSchedule(config.schedule), connect = defaultConnect, retryMs = 30000, log = console.log } = {}) {
    super();
    Object.assign(this, { arena, user, windows, connectFn: connect, retryMs, log });
    this.mode = 'auto';
    this.status = 'off';
    this.error = null;
    this.conn = null;
    this.catalog = []; // catalogue réel des cadeaux (noms, prix, images) une fois connecté
    this.nextTry = 0;
    this.timer = setInterval(() => this.tick(), 5000);
    this.tick();
  }

  wanted() { return this.mode === 'on' || (this.mode === 'auto' && inWindow(this.windows)); }

  setMode(mode) {
    if (!['auto', 'on', 'off'].includes(mode)) return;
    this.mode = mode;
    this.nextTry = 0;
    this.tick();
  }

  async tick() {
    if (this.busy) return;
    if (!this.wanted()) {
      if (this.conn) await this.disconnect();
      this.setStatus(this.mode === 'off' ? 'off' : 'waiting-window');
      return;
    }
    if (this.conn || Date.now() < this.nextTry) return;
    this.busy = true;
    this.setStatus('connecting');
    try {
      this.conn = await this.connectFn(this.arena, this.user, {
        onViewers: (n) => { this.arena.stats.viewers = n; },
        onCatalog: (c) => { this.catalog = c; this.emit('catalog', c); },
        onClose: () => { this.conn = null; this.setStatus('waiting-live'); this.nextTry = Date.now() + this.retryMs; },
      });
      this.error = null;
      this.setStatus('live');
    } catch (err) {
      this.error = err.message;
      this.conn = null;
      this.nextTry = Date.now() + this.retryMs; // pas en live (ou erreur réseau) : on réessaie
      this.setStatus('waiting-live');
    } finally { this.busy = false; }
  }

  async disconnect() {
    try { await this.conn?.disconnect?.(); } catch {}
    this.conn = null;
  }

  setStatus(s) {
    if (s !== this.status) { this.status = s; this.log(`[tiktok] ${s}${this.error && s === 'waiting-live' ? ` (${this.error})` : ''}`); this.emit('status', this.snapshot()); }
  }

  snapshot() {
    return { user: this.user, mode: this.mode, status: this.status, error: this.error, catalog: this.catalog.length,
      schedule: config.schedule || 'toute la journée', inWindow: inWindow(this.windows), viewers: this.arena.stats.viewers };
  }

  stop() { clearInterval(this.timer); return this.disconnect(); }
}

/** Branche le live TikTok réel (tiktok-live-connector v2) sur l'arène. */
async function defaultConnect(arena, user, { onViewers, onCatalog, onClose }) {
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector');
  const conn = new TikTokLiveConnection(user, {}); // le 2e argument est obligatoire (sinon : "reading 'processInitialData'")
  conn.on(WebcastEvent.CHAT, (d) => { const c = parseChat(d); arena.chat(c.id, c.name, c.text, { avatar: c.avatar }); });
  conn.on(WebcastEvent.LIKE, (d) => { const l = parseLike(d); arena.like(l.id, l.name, l.count, { avatar: l.avatar }); });
  conn.on(WebcastEvent.GIFT, (d) => {
    const g = parseGift(d); // null = cadeau en série pas terminé
    if (g) arena.gift(g.id, g.name, g.coins, g.gift, { avatar: g.avatar, giftImage: g.image, repeat: g.repeat });
  });
  conn.on(WebcastEvent.ROOM_USER, (d) => { const n = parseViewers(d); if (n) onViewers(n); });
  conn.on(WebcastEvent.STREAM_END, () => onClose());
  conn.on(ControlEvent?.DISCONNECTED ?? 'disconnected', () => onClose());
  conn.on(ControlEvent?.ERROR ?? 'error', (e) => console.error('[tiktok] erreur :', e?.info ?? e?.message ?? e));
  await conn.connect();
  conn.fetchAvailableGifts().then((r) => onCatalog(parseCatalog(r))).catch((e) => console.warn('[tiktok] catalogue des cadeaux indisponible :', e.message));
  return conn;
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_FILE = fileURLToPath(new URL('../data/arena.db', import.meta.url));

// "%" et "_" saisis par l'utilisateur ne doivent pas servir de jokers dans un LIKE
const like = (s) => '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';

export function openDb(file = process.env.DB_FILE || DEFAULT_FILE) {
  if (file !== ':memory:') mkdirSync(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT, wins INT DEFAULT 0, kills INT DEFAULT 0,
      deaths INT DEFAULT 0, coins INT DEFAULT 0, rounds INT DEFAULT 0, last_seen INT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INT, user_id TEXT, role TEXT, text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_msg_user ON messages(user_id, id);
    CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INT, user_id TEXT, name TEXT, gift TEXT, coins INT, power TEXT, round INT
    );
    CREATE TABLE IF NOT EXISTS blocked (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INT, user_id TEXT, name TEXT, text TEXT, reason TEXT
    );
  `);
  for (const col of ['avatar TEXT', 'first_seen INT']) { // migrations : colonnes ajoutées après coup
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* déjà là */ }
  }

  const addGift = db.prepare('INSERT INTO gifts(ts,user_id,name,gift,coins,power,round) VALUES(?,?,?,?,?,?,?)');
  const recentGifts = db.prepare('SELECT ts,user_id,name,gift,coins,power,round FROM gifts ORDER BY id DESC LIMIT ?');
  const giftTotals = db.prepare(`SELECT date(ts/1000,'unixepoch','localtime') AS day, COUNT(*) AS gifts, SUM(coins) AS coins,
    COUNT(DISTINCT user_id) AS donors FROM gifts GROUP BY day ORDER BY day DESC LIMIT 30`);

  const addStat = (col) => db.prepare(`UPDATE users SET ${col}=${col}+? WHERE id=?`);
  const stat = { wins: addStat('wins'), kills: addStat('kills'), deaths: addStat('deaths'),
    coins: addStat('coins'), rounds: addStat('rounds') };
  const upsert = db.prepare(`INSERT INTO users(id,name,last_seen,avatar,first_seen) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen,avatar=COALESCE(excluded.avatar,users.avatar),
    first_seen=COALESCE(users.first_seen,excluded.first_seen)`);
  const getUser = db.prepare('SELECT * FROM users WHERE id=?');
  const addMsg = db.prepare('INSERT INTO messages(ts,user_id,role,text) VALUES(?,?,?,?)');
  const userMsgs = db.prepare('SELECT role,text FROM messages WHERE user_id=? ORDER BY id DESC LIMIT ?');
  const recentMsgs = db.prepare(`SELECT m.role,m.text,u.name FROM messages m
    LEFT JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT ?`);
  const board = {
    wins: db.prepare('SELECT id,name,avatar,wins,kills,coins,rounds FROM users ORDER BY wins DESC, kills DESC LIMIT ?'),
    kills: db.prepare('SELECT id,name,avatar,wins,kills,coins,rounds FROM users ORDER BY kills DESC, wins DESC LIMIT ?'),
    coins: db.prepare('SELECT id,name,avatar,wins,kills,coins,rounds FROM users ORDER BY coins DESC, wins DESC LIMIT ?'),
  };
  const donors = db.prepare('SELECT id,name,avatar,coins FROM users WHERE coins>0 ORDER BY coins DESC LIMIT ?');

  // ---------- recherche dans l'historique ----------
  const clampN = (n, max) => Math.max(1, Math.min(max, Number(n) || 50));
  /** Filtre commun : pseudo (nom contient, ou id exact), texte contient, rôle (user = viewer, ai = Maxima). */
  function where({ user, userId, q, role } = {}) {
    const conds = [], args = [];
    if (userId) { conds.push('m.user_id = ?'); args.push(String(userId)); } // id exact (utilisé par la mémoire de l'IA)
    if (user) { conds.push("(u.name LIKE ? ESCAPE '\\' OR m.user_id = ?)"); args.push(like(user), String(user)); }
    if (q) { conds.push("m.text LIKE ? ESCAPE '\\'"); args.push(like(q)); }
    if (role === 'user' || role === 'ai') { conds.push('m.role = ?'); args.push(role); }
    return { sql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', args };
  }
  function searchMessages(f = {}) {
    const w = where(f), limit = clampN(f.limit, 500), offset = Math.max(0, Number(f.offset) || 0);
    const rows = db.prepare(`SELECT m.id, m.ts, m.user_id, u.name, u.avatar, m.role, m.text FROM messages m
      LEFT JOIN users u ON u.id = m.user_id ${w.sql} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...w.args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM messages m LEFT JOIN users u ON u.id = m.user_id ${w.sql}`).get(...w.args).n;
    return { rows, total };
  }
  const findUsersStmt = db.prepare(`SELECT u.id, u.name, u.avatar, u.wins, u.kills, u.coins, u.rounds, u.last_seen,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id AND m.role = 'user') AS messages
    FROM users u WHERE u.name LIKE ? ESCAPE '\\' ORDER BY u.last_seen DESC LIMIT ?`);
  const topUsersStmt = db.prepare(`SELECT u.id, u.name, u.avatar, u.wins, u.kills, u.coins, u.rounds, u.last_seen,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id AND m.role = 'user') AS messages
    FROM users u ORDER BY u.last_seen DESC LIMIT ?`);
  const userByName = db.prepare('SELECT id, name FROM users WHERE name = ? COLLATE NOCASE LIMIT 1');

  return {
    saveGift: (id, name, gift, coins, power, round) => addGift.run(Date.now(), id, name, gift ?? '', coins, power ?? null, round),
    recentGifts: (n = 100) => recentGifts.all(n),
    giftTotals: () => giftTotals.all(),
    touchUser: (id, name, avatar = null) => { const t = Date.now(); upsert.run(id, name, t, avatar, t); },
    addStat: (id, col, n = 1) => stat[col].run(n, id),
    getUser: (id) => getUser.get(id),
    saveMessage: (userId, role, text) => addMsg.run(Date.now(), userId, role, text),
    userHistory: (userId, n = 8) => userMsgs.all(userId, n).reverse(),
    recentChat: (n = 10) => recentMsgs.all(n).reverse(),
    leaderboard: (col = 'wins', n = 10) => (board[col] ?? board.wins).all(clampN(n, 500)),
    topDonors: (n = 5) => donors.all(n),

    searchMessages,
    /** Viewers dont le pseudo contient q (vide = les derniers vus). */
    findUsers: (q = '', n = 30) => (q ? findUsersStmt.all(like(q), clampN(n, 200)) : topUsersStmt.all(clampN(n, 200))),
    /** Pseudo exact (sans tenir compte de la casse) -> { id, name } ou undefined. */
    userByName: (name) => userByName.get(String(name)),
    /** Fiche complète d'un viewer : stats, premiers/derniers messages, cadeaux préférés. */
    userProfile(id) {
      const u = getUser.get(id);
      if (!u) return null;
      const msgs = db.prepare(`SELECT COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM messages WHERE user_id = ? AND role = 'user'`).get(id);
      const ai = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND role = 'ai'`).get(id).n;
      const g = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(coins),0) AS coins FROM gifts WHERE user_id = ?').get(id);
      const topGifts = db.prepare('SELECT gift, COUNT(*) AS n, SUM(coins) AS coins FROM gifts WHERE user_id = ? GROUP BY gift ORDER BY coins DESC LIMIT 5').all(id);
      return { ...u, first_seen: u.first_seen ?? msgs.first ?? u.last_seen, messages: msgs.n, firstMessage: msgs.first, lastMessage: msgs.last,
        aiReplies: ai, gifts: g.n, giftCoins: g.coins, topGifts };
    },
    /** Conversation complète avec un viewer (ses messages + les réponses de Maxima), ordre chronologique. */
    conversation: (id, n = 100) => db.prepare('SELECT id, ts, role, text FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(id, clampN(n, 1000)).reverse(),
    messageStats: () => db.prepare(`SELECT COUNT(*) AS total, SUM(role='user') AS viewers, SUM(role='ai') AS ai, COUNT(DISTINCT user_id) AS users FROM messages`).get(),

    // ---------- modération : messages bloqués par le filtre ----------
    saveBlocked: (id, name, text, reason) => db.prepare('INSERT INTO blocked(ts,user_id,name,text,reason) VALUES(?,?,?,?,?)').run(Date.now(), id, name, String(text).slice(0, 300), reason ?? ''),
    recentBlocked: (n = 100) => db.prepare('SELECT ts, user_id, name, text, reason FROM blocked ORDER BY id DESC LIMIT ?').all(clampN(n, 500)),
    blockedStats: () => db.prepare('SELECT reason, COUNT(*) AS n FROM blocked GROUP BY reason ORDER BY n DESC').all(),
    close: () => db.close(),
  };
}

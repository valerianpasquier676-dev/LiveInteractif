import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_FILE = fileURLToPath(new URL('../data/arena.db', import.meta.url));

export function openDb(file = DEFAULT_FILE) {
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
  `);

  const addStat = (col) => db.prepare(`UPDATE users SET ${col}=${col}+? WHERE id=?`);
  const stat = { wins: addStat('wins'), kills: addStat('kills'), deaths: addStat('deaths'),
    coins: addStat('coins'), rounds: addStat('rounds') };
  const upsert = db.prepare(`INSERT INTO users(id,name,last_seen) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen`);
  const getUser = db.prepare('SELECT * FROM users WHERE id=?');
  const addMsg = db.prepare('INSERT INTO messages(ts,user_id,role,text) VALUES(?,?,?,?)');
  const userMsgs = db.prepare('SELECT role,text FROM messages WHERE user_id=? ORDER BY id DESC LIMIT ?');
  const recentMsgs = db.prepare(`SELECT m.role,m.text,u.name FROM messages m
    LEFT JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT ?`);
  const board = {
    wins: db.prepare('SELECT id,name,wins,kills,coins,rounds FROM users ORDER BY wins DESC, kills DESC LIMIT ?'),
    kills: db.prepare('SELECT id,name,wins,kills,coins,rounds FROM users ORDER BY kills DESC, wins DESC LIMIT ?'),
    coins: db.prepare('SELECT id,name,wins,kills,coins,rounds FROM users ORDER BY coins DESC, wins DESC LIMIT ?'),
  };
  const donors = db.prepare('SELECT id,name,coins FROM users WHERE coins>0 ORDER BY coins DESC LIMIT ?');

  return {
    touchUser: (id, name) => upsert.run(id, name, Date.now()),
    addStat: (id, col, n = 1) => stat[col].run(n, id),
    getUser: (id) => getUser.get(id),
    saveMessage: (userId, role, text) => addMsg.run(Date.now(), userId, role, text),
    userHistory: (userId, n = 8) => userMsgs.all(userId, n).reverse(),
    recentChat: (n = 10) => recentMsgs.all(n).reverse(),
    leaderboard: (col = 'wins', n = 10) => (board[col] ?? board.wins).all(n),
    topDonors: (n = 5) => donors.all(n),
    close: () => db.close(),
  };
}

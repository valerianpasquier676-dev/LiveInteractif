import { EventEmitter } from 'node:events';
import { config, POWERS } from './config.js';
import { safeName, check } from './filter.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rank = (id) => POWERS.length - POWERS.findIndex((w) => w.id === id);

export function powerForCoins(coins) {
  return POWERS.find((p) => coins >= p.min)?.id ?? null;
}

/**
 * Moteur de l'arène. Phases : lobby -> fight -> ended -> lobby ...
 * Émet des événements 'evt' { type, ... } consommés par le dashboard et l'IA.
 */
export class Arena extends EventEmitter {
  constructor(db, opts = {}) {
    super();
    this.db = db;
    this.opts = { lobbySeconds: config.lobbySeconds, startHp: config.startHp, tickMs: 1000, endSeconds: 10, ...opts };
    this.round = 0;
    this.players = new Map();
    this.roundCoins = new Map(); // userId -> pièces ce round
    this.heart = 0;
    this.feed = [];
    this.stats = { viewers: 0, likes: 0, coins: 0, chats: 0, joins: 0, rounds: 0, since: Date.now() };
    this.newRound();
  }

  emitEvt(e) {
    const evt = { ts: Date.now(), round: this.round, ...e };
    this.feed.push(evt);
    if (this.feed.length > 100) this.feed.shift();
    this.emit('evt', evt);
    return evt;
  }

  start() { this.loop = setInterval(() => this.tick(), this.opts.tickMs); return this; }
  stop() { clearInterval(this.loop); }

  newRound() {
    this.round++;
    this.phase = 'lobby';
    this.timer = this.opts.lobbySeconds;
    this.players.clear();
    this.roundCoins.clear();
    this.tickN = 0;
    this.killTicks = [];
    this.boss = null; // le Titan : boss commun qui attaque tout le monde
    this.bossDone = false;
    this.lastCarnage = -99;
    this.finalAnnounced = false;
    this.winner = null;
    this.emitEvt({ type: 'lobby', seconds: this.timer });
  }

  // ---------- entrées (chat / cadeaux / likes) ----------
  join(id, name, via = 'comment') {
    name = safeName(name);
    this.db.touchUser(id, name);
    if (this.phase !== 'lobby') return null; // inscriptions fermées : spectateur
    let p = this.players.get(id);
    if (p) return p;
    p = { id, name, hp: this.opts.startHp, maxHp: this.opts.startHp, power: null, shield: false,
      pending: [], alive: true, kills: 0, via };
    this.players.set(id, p);
    this.stats.joins++;
    this.emitEvt({ type: 'join', id, name, via });
    return p;
  }

  chat(id, name, text) {
    name = safeName(name);
    this.db.touchUser(id, name);
    const c = check(text);
    if (c.ok) this.db.saveMessage(id, 'user', text); // un message filtré n'entre jamais dans la mémoire de l'IA
    this.stats.chats++;
    this.emitEvt({ type: 'chat', id, name, text: c.ok ? text : '[message filtré]', filtered: !c.ok });
    this.join(id, name, 'comment');
  }

  gift(id, name, coins, giftName = 'cadeau') {
    if (!(coins > 0)) return;
    name = safeName(name);
    this.db.touchUser(id, name);
    this.db.addStat(id, 'coins', coins);
    const total = (this.roundCoins.get(id) ?? 0) + coins;
    this.roundCoins.set(id, total);
    this.stats.coins += coins;
    const p = this.join(id, name, 'gift') ?? this.players.get(id);
    const power = powerForCoins(total);
    this.db.saveGift(id, name, giftName, coins, power, this.round); // historique durable
    this.emitEvt({ type: 'gift', id, name, coins, giftName, power });
    if (p?.alive && power) this.grantPower(p, power);
  }

  like(id, name, count = 1) {
    name = safeName(name);
    this.db.touchUser(id, name);
    this.join(id, name, 'like');
    const p = this.players.get(id);
    if (this.phase === 'fight' && p?.alive) p.hp = Math.min(p.maxHp, p.hp + count); // Like = soin
    this.heart += count;
    this.stats.likes += count;
    while (this.heart >= config.heartGoal) {
      this.heart -= config.heartGoal;
      for (const q of this.alive()) q.hp = Math.min(q.maxHp, q.hp + 25);
      this.emitEvt({ type: 'heartRain' });
    }
  }

  grantPower(p, power) {
    if (power === 'bouclier') {
      if (p.shield) return;
      p.shield = true;
    } else {
      if (p.power && rank(p.power) >= rank(power)) return;
      p.power = power;
      if (power === 'berserk') { p.maxHp = Math.round(this.opts.startHp * 1.5); p.hp = p.maxHp; }
    }
    if (power === 'foudre' || power === 'legende') {
      if (this.phase === 'fight') this.fire(p, power); else p.pending.push(power);
    }
    this.emitEvt({ type: 'power', id: p.id, name: p.name, power });
  }

  // pouvoirs instantanés : foudre & météores
  fire(p, power) {
    if (power === 'foudre') {
      for (const q of this.alive()) if (q !== p) this.damage(q, 25, p, 'foudre');
      this.emitEvt({ type: 'lightning', id: p.id, name: p.name });
    } else if (power === 'legende') {
      for (const q of this.alive()) if (q !== p) this.damage(q, Math.round(q.maxHp * 0.3), p, 'météores');
      this.emitEvt({ type: 'meteors', id: p.id, name: p.name });
    }
  }

  // ---------- boucle ----------
  alive() { return [...this.players.values()].filter((p) => p.alive); }

  tick() {
    if (this.phase === 'lobby') {
      if (this.players.size < 2) { this.timer = this.opts.lobbySeconds; return; } // attend des combattants
      if (--this.timer <= 0) this.startFight();
    } else if (this.phase === 'fight') {
      this.fightTick();
    } else if (this.phase === 'ended') {
      if (--this.timer <= 0) this.newRound();
    }
  }

  startFight() {
    this.phase = 'fight';
    this.emitEvt({ type: 'fightStart', players: this.players.size });
    for (const p of this.players.values()) {
      for (const pw of p.pending) if (p.alive) this.fire(p, pw);
      p.pending = [];
    }
    this.checkEnd();
  }

  mult(p) {
    return p.power === 'berserk' || p.power === 'legende' ? 3 : p.power === 'epee' || p.power === 'vampire' ? 2 : 1;
  }

  // ---------- boss : le Titan ----------
  spawnBoss() {
    const n = this.alive().length;
    const max = 120 + 30 * n;
    this.boss = { name: 'TITAN', hp: max, max, age: 0, dmg: new Map() };
    this.emitEvt({ type: 'bossSpawn', name: 'TITAN', hp: max });
  }

  bossTick() {
    const b = this.boss;
    b.age++;
    const alive = this.alive();
    for (const p of alive.sort(() => Math.random() - 0.5).slice(0, 2)) this.damage(p, 20, null, 'boss'); // le Titan frappe 2 gladiateurs
    for (const p of this.alive()) { // tout le monde tape le Titan
      const d = Math.round(rand(2, 5) * this.mult(p));
      b.hp -= d;
      b.dmg.set(p.name, (b.dmg.get(p.name) ?? 0) + d);
    }
    if (b.hp <= 0) {
      const mvp = [...b.dmg.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      for (const p of this.alive()) p.hp = Math.min(p.maxHp, p.hp + 20); // récompense : soin pour les survivants
      this.boss = null; this.bossDone = true;
      this.emitEvt({ type: 'bossDown', mvp });
    } else if (b.age >= 18) {
      this.boss = null; this.bossDone = true;
      this.emitEvt({ type: 'bossLeave' });
    }
  }

  // événements d'arène aléatoires (toutes les ~25 s de combat)
  hazard() {
    const alive = this.alive();
    if (alive.length < 3) return;
    if (Math.random() < 0.5) {
      for (const p of alive) this.damage(p, 8, null, 'tremblement de terre');
      this.emitEvt({ type: 'hazard', kind: 'tremblement de terre' });
    } else {
      const hit = alive.filter(() => Math.random() < 0.3);
      for (const p of hit) this.damage(p, 25, null, 'pluie de feu');
      this.emitEvt({ type: 'hazard', kind: 'pluie de feu', hit: hit.length });
    }
  }

  fightTick() {
    this.tickN++;
    if (this.alive().length > 1) {
      for (const a of this.alive().sort(() => Math.random() - 0.5)) {
        if (!a.alive || Math.random() > 0.6) continue;
        const targets = this.alive().filter((t) => t !== a);
        if (!targets.length) break;
        this.damage(pick(targets), Math.round(rand(8, 16) * this.mult(a)), a, 'attaque');
      }
    }
    if (this.tickN % 25 === 0) this.hazard();
    if (!this.boss && !this.bossDone && this.tickN >= 12 && this.alive().length >= 4) this.spawnBoss();
    if (this.boss) this.bossTick();
    if (this.tickN > 90) for (const p of this.alive()) this.damage(p, 6, null, 'tempête'); // mort subite
    this.checkEnd();
  }

  checkEnd() {
    if (this.phase !== 'fight') return;
    const alive = this.alive();
    if (alive.length === 2 && !this.finalAnnounced) {
      this.finalAnnounced = true;
      this.emitEvt({ type: 'finalDuel', a: alive[0].name, b: alive[1].name });
    }
    if (alive.length <= 1) this.endRound(alive[0] ?? null);
  }

  damage(target, amount, source, cause) {
    if (!target.alive) return;
    target.hp -= amount;
    if (source?.power === 'vampire' && cause === 'attaque' && source.alive) {
      source.hp = Math.min(source.maxHp, source.hp + Math.round(amount / 2)); // vol de vie
    }
    if (target.hp > 0) return;
    if (target.shield) { // Bouclier : retour en vie
      target.shield = false;
      target.hp = Math.round(target.maxHp / 2);
      this.emitEvt({ type: 'shieldSave', id: target.id, name: target.name });
      return;
    }
    target.hp = 0;
    target.alive = false;
    this.db.addStat(target.id, 'deaths');
    if (source) { source.kills++; this.db.addStat(source.id, 'kills'); }
    this.emitEvt({ type: 'kill', victim: target.name, killer: source?.name ?? null, cause, left: this.alive().length });
    if (source && (source.kills === 3 || source.kills === 5 || source.kills === 8)) {
      this.emitEvt({ type: 'streak', name: source.name, kills: source.kills });
    }
    this.killTicks.push(this.tickN);
    this.killTicks = this.killTicks.filter((t) => this.tickN - t <= 2);
    if (this.killTicks.length >= 4 && this.tickN - this.lastCarnage > 8) {
      this.lastCarnage = this.tickN;
      this.emitEvt({ type: 'carnage' });
    }
  }

  endRound(winner) {
    this.phase = 'ended';
    this.timer = this.opts.endSeconds;
    this.winner = winner;
    this.boss = null;
    this.stats.rounds++;
    for (const p of this.players.values()) this.db.addStat(p.id, 'rounds');
    if (winner) this.db.addStat(winner.id, 'wins');
    this.emitEvt({ type: 'roundEnd', winner: winner?.name ?? null, kills: winner?.kills ?? 0 });
  }

  // ---------- état pour le dashboard ----------
  snapshot() {
    return {
      round: this.round, phase: this.phase, timer: this.timer, tick: this.tickN,
      heart: this.heart, heartGoal: config.heartGoal, winner: this.winner?.name ?? null,
      winnerKills: this.winner?.kills ?? 0, stats: this.stats,
      boss: this.boss ? { name: this.boss.name, hp: Math.max(0, this.boss.hp), max: this.boss.max } : null,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, hp: Math.max(0, p.hp), maxHp: p.maxHp,
        power: p.power, shield: p.shield, alive: p.alive, kills: p.kills,
        coins: this.roundCoins.get(p.id) ?? 0 })).sort((a, b) => b.alive - a.alive || b.hp - a.hp),
      leaderboard: this.db.leaderboard('wins', 10),
      donors: this.db.topDonors(5),
    };
  }
}

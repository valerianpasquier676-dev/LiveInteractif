import { EventEmitter } from 'node:events';
import { config, POWERS } from './config.js';
import { safeName, check } from './filter.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rank = (id) => POWERS.length - POWERS.findIndex((w) => w.id === id);

const cleanAvatar = (u) => (typeof u === 'string' && u.startsWith('https://') && u.length < 600 ? u : null);

/**
 * Équilibrage. Mesuré sur des milliers de rounds simulés : un combat dure ~40-70 s quel que soit le nombre de joueurs,
 * les éliminations sont étalées, les égalités sont rares, et aucun viewer ne peut devenir immortel en spammant les likes.
 */
export const BALANCE = {
  attackProb: 0.3,          // chance d'attaquer à chaque seconde
  dmgMin: 6, dmgMax: 11,    // dégâts d'une attaque (avant multiplicateur du pouvoir)
  focusWeak: 0.5,           // part des attaques qui visent le plus faible parmi 3 cibles (étale les éliminations)
  lightningDmg: 20,         // Foudre : dégâts à tous les autres (ne tue jamais : laisse 1 PV)
  meteorsPct: 0.25,         // Légende : % des PV max retirés à tous les autres (ne tue jamais)
  likeHealPerTick: 1.5,     // soin max par seconde grâce aux likes d'un viewer (inférieur aux dégâts moyens : pas d'immortalité)
  heartRainHeal: 20,        // pluie de cœurs
  heartRainCooldown: 15,    // secondes minimum entre deux pluies de cœurs en combat
  bossTick: 20,             // seconde d'apparition du Titan (s'il reste au moins 5 gladiateurs)
  suddenDeathTick: 120,     // la tempête commence : -6 PV/s pour tous
};

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
    this.opts = { lobbySeconds: config.lobbySeconds, startHp: config.startHp, tickMs: 1000, endSeconds: 10, ...BALANCE, ...opts };
    this.round = 0;
    this.players = new Map();
    this.roundCoins = new Map(); // userId -> pièces ce round
    this.heart = 0;
    this.feed = [];
    this.stats = { viewers: 0, likes: 0, coins: 0, chats: 0, joins: 0, rounds: 0, shares: 0, follows: 0, since: Date.now() };
    this.fans = new Map(); // compteurs de la session par viewer (commentaires, cœurs, partages, abonnements)
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
    this.rainReadyTick = 0;
    this.finalAnnounced = false;
    this.winner = null;
    this.emitEvt({ type: 'lobby', seconds: this.timer });
  }

  // ---------- entrées (chat / cadeaux / likes) ----------
  join(id, name, via = 'comment', avatar = null) {
    name = safeName(name);
    avatar = cleanAvatar(avatar);
    this.db.touchUser(id, name, avatar);
    if (this.phase !== 'lobby') return null; // inscriptions fermées : spectateur
    let p = this.players.get(id);
    if (p) { if (avatar) p.avatar = avatar; return p; }
    p = { id, name, hp: this.opts.startHp, maxHp: this.opts.startHp, power: null, shield: false,
      pending: [], alive: true, kills: 0, via, avatar, healBudget: this.opts.likeHealPerTick };
    this.players.set(id, p);
    this.stats.joins++;
    this.emitEvt({ type: 'join', id, name, via, avatar });
    return p;
  }

  chat(id, name, text, meta = {}) {
    name = safeName(name);
    this.db.touchUser(id, name, cleanAvatar(meta.avatar));
    const c = check(text);
    if (c.ok) this.db.saveMessage(id, 'user', text); // un message filtré n'entre jamais dans la mémoire de l'IA
    else this.db.saveBlocked(id, name, text, c.reason); // mais il reste visible dans le backstage (onglet modération)
    this.stats.chats++;
    this.fan(id, name).chats++;
    this.emitEvt({ type: 'chat', id, name, text: c.ok ? text : '[message filtré]', filtered: !c.ok });
    this.join(id, name, 'comment', meta.avatar);
  }

  gift(id, name, coins, giftName = 'cadeau', meta = {}) {
    if (!(coins > 0)) return;
    name = safeName(name);
    this.db.touchUser(id, name);
    this.db.addStat(id, 'coins', coins);
    const total = (this.roundCoins.get(id) ?? 0) + coins;
    this.roundCoins.set(id, total);
    this.stats.coins += coins;
    const p = this.join(id, name, 'gift', meta.avatar) ?? this.players.get(id);
    // un pouvoir n'est attribué qu'à un gladiateur en vie (inscrit pendant les inscriptions) : sinon le cadeau
    // fait seulement l'animation de pièces, sans annoncer un pouvoir qui n'existera pas
    const active = !!p && p.alive && this.phase !== 'ended';
    const power = active ? powerForCoins(total) : null;
    this.db.saveGift(id, name, giftName, coins, power, this.round); // historique durable
    this.emitEvt({ type: 'gift', id, name, coins, giftName, power, spectator: !p, giftImage: cleanAvatar(meta.giftImage), repeat: meta.repeat ?? 1, avatar: cleanAvatar(meta.avatar) });
    if (active && power) this.grantPower(p, power);
  }

  like(id, name, count = 1, meta = {}) {
    name = safeName(name);
    this.db.touchUser(id, name, cleanAvatar(meta.avatar));
    this.join(id, name, 'like', meta.avatar);
    const p = this.players.get(id);
    if (this.phase === 'fight' && p?.alive) { // Like = soin, mais plafonné par seconde (sinon spammer les likes rendrait immortel)
      const heal = Math.min(count, p.healBudget);
      p.hp = Math.min(p.maxHp, p.hp + heal);
      p.healBudget -= heal;
    }
    this.heart = Math.min(this.heart + count, config.heartGoal * 2); // la jauge déborde au maximum d'une pluie en réserve
    this.stats.likes += count;
    this.fan(id, name).likes += count;
    this.checkHeart();
  }

  /** Partage du live / abonnement : Maxima remercie (regroupés). Compte aussi comme inscription au round. */
  share(id, name, meta = {}) { this.social('share', 'shares', id, name, meta); }
  follow(id, name, meta = {}) { this.social('follow', 'follows', id, name, meta); }
  social(type, key, id, name, meta) {
    name = safeName(name);
    this.db.touchUser(id, name, cleanAvatar(meta.avatar));
    this.stats[key]++;
    this.fan(id, name)[key]++;
    this.emitEvt({ type, id, name });
    this.join(id, name, type, meta.avatar);
  }

  fan(id, name) {
    let f = this.fans.get(id);
    if (!f) { f = { id, name, chats: 0, likes: 0, shares: 0, follows: 0 }; this.fans.set(id, f); }
    f.name = name;
    return f;
  }

  /** Viewers les plus actifs de la session pour `kind` ('chats' | 'likes' | 'shares'), au moins `min`. */
  topFans(kind, n = 3, min = 1) {
    return [...this.fans.values()].filter((f) => f[kind] >= min).sort((a, b) => b[kind] - a[kind]).slice(0, n);
  }

  /** Pluie de cœurs : jauge pleine -> soin pour tous. En combat, au plus une toutes les `heartRainCooldown` secondes. */
  checkHeart() {
    if (this.heart < config.heartGoal) return;
    if (this.phase === 'fight' && this.tickN < this.rainReadyTick) return; // la jauge reste pleine, la pluie attend
    this.heart -= config.heartGoal;
    if (this.phase === 'fight') this.rainReadyTick = this.tickN + this.opts.heartRainCooldown;
    for (const q of this.alive()) q.hp = Math.min(q.maxHp, q.hp + this.opts.heartRainHeal);
    this.emitEvt({ type: 'heartRain' });
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
    // l'annonce du pouvoir vient AVANT son effet (foudre / météores), pour que l'animation suive l'ordre
    this.emitEvt({ type: 'power', id: p.id, name: p.name, power, later: (power === 'foudre' || power === 'legende') && this.phase !== 'fight' });
    if (power === 'foudre' || power === 'legende') {
      if (this.phase === 'fight') this.fire(p, power); else p.pending.push(power); // en inscriptions : déclenché au début du combat
    }
  }

  // pouvoirs instantanés : foudre & météores
  fire(p, power) {
    // l'événement (donc l'animation) part AVANT les dégâts : la foudre tombe, puis les gladiateurs réagissent
    if (power === 'foudre') {
      this.emitEvt({ type: 'lightning', id: p.id, name: p.name });
      for (const q of this.alive()) if (q !== p) this.damage(q, this.opts.lightningDmg, p, 'foudre', { nonLethal: true });
    } else if (power === 'legende') {
      this.emitEvt({ type: 'meteors', id: p.id, name: p.name });
      for (const q of this.alive()) if (q !== p) this.damage(q, Math.round(q.maxHp * this.opts.meteorsPct), p, 'météores', { nonLethal: true });
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

  /** Cible : au hasard, ou (une fois sur deux) la plus faible parmi 3 candidats : étale les éliminations dans le temps. */
  pickTarget(targets) {
    if (Math.random() >= this.opts.focusWeak) return pick(targets);
    return [pick(targets), pick(targets), pick(targets)].sort((x, y) => x.hp - y.hp)[0];
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
    if (alive.length <= 3) { // il ne gâche pas la fin : s'il reste 3 gladiateurs ou moins, il s'en va
      this.boss = null; this.bossDone = true;
      this.emitEvt({ type: 'bossLeave' });
      return;
    }
    const strikes = Math.min(2, alive.length - 3); // et il ne frappe jamais en dessous de 3 survivants
    for (const p of alive.sort(() => Math.random() - 0.5).slice(0, strikes)) this.damage(p, 20, null, 'boss');
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
    for (const p of this.alive()) p.healBudget = Math.min(3, p.healBudget + this.opts.likeHealPerTick); // recharge du soin par likes
    if (this.alive().length > 1) {
      for (const a of this.alive().sort(() => Math.random() - 0.5)) {
        if (!a.alive || Math.random() > this.opts.attackProb) continue;
        const targets = this.alive().filter((t) => t !== a);
        if (!targets.length) break;
        this.damage(this.pickTarget(targets), Math.round(rand(this.opts.dmgMin, this.opts.dmgMax) * this.mult(a)), a, 'attaque');
      }
    }
    if (this.tickN % 25 === 0) this.hazard();
    if (!this.boss && !this.bossDone && this.tickN >= this.opts.bossTick && this.alive().length >= 5) this.spawnBoss();
    if (this.boss) this.bossTick();
    if (this.tickN > this.opts.suddenDeathTick) { // mort subite : la tempête frappe un par un, et s'arrête dès qu'il n'en reste qu'un (pas d'égalité)
      for (const p of this.alive().sort(() => Math.random() - 0.5)) {
        if (this.alive().length <= 1) break;
        this.damage(p, 6, null, 'tempête');
      }
    }
    this.checkHeart();
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

  damage(target, amount, source, cause, { nonLethal = false } = {}) {
    if (!target.alive) return;
    target.hp -= amount;
    if (nonLethal && target.hp < 1) target.hp = 1; // foudre / météores affaiblissent mais ne tuent jamais
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
    this.emitEvt({ type: 'roundEnd', winner: winner?.name ?? null, kills: winner?.kills ?? 0, winnerAvatar: winner?.avatar ?? null });
  }

  // ---------- état pour le dashboard ----------
  snapshot() {
    return {
      round: this.round, phase: this.phase, timer: this.timer, tick: this.tickN,
      heart: this.heart, heartGoal: config.heartGoal, winner: this.winner?.name ?? null,
      winnerKills: this.winner?.kills ?? 0, stats: this.stats,
      boss: this.boss ? { name: this.boss.name, hp: Math.max(0, this.boss.hp), max: this.boss.max } : null,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, hp: Math.max(0, p.hp), maxHp: p.maxHp,
        power: p.power, shield: p.shield, alive: p.alive, kills: p.kills, avatar: p.avatar ?? null,
        coins: this.roundCoins.get(p.id) ?? 0 })).sort((a, b) => b.alive - a.alive || b.hp - a.hp),
      leaderboard: this.db.leaderboard('wins', 10),
      donors: this.db.topDonors(5),
    };
  }
}

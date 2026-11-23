import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Arena, powerForCoins, BALANCE } from '../src/game.js';
import { Brain } from '../src/ai.js';

const mk = () => new Arena(openDb(':memory:'), { lobbySeconds: 2, endSeconds: 1 });

test('paliers cadeaux -> pouvoirs', () => {
  assert.equal(powerForCoins(0), null);
  assert.equal(powerForCoins(1), 'epee');
  assert.equal(powerForCoins(5), 'bouclier');
  assert.equal(powerForCoins(30), 'berserk');
  assert.equal(powerForCoins(100), 'vampire');
  assert.equal(powerForCoins(500), 'foudre');
  assert.equal(powerForCoins(5000), 'legende');
});

test('inscription par commentaire, cadeau et like', () => {
  const a = mk();
  a.chat('u1', 'Un', 'salut');
  a.gift('u2', 'Deux', 50, 'Rose');
  a.like('u3', 'Trois', 3);
  assert.equal(a.players.size, 3);
  assert.equal(a.players.get('u2').power, 'berserk');
});

test('un round complet produit un vainqueur et des stats', () => {
  const a = mk();
  for (const n of ['a', 'b', 'c', 'd']) a.chat(n, n, 'go');
  a.tick(); a.tick();
  assert.equal(a.phase, 'fight');
  for (let i = 0; i < 300 && a.phase === 'fight'; i++) a.tick();
  assert.equal(a.phase, 'ended');
  if (a.winner) assert.equal(a.db.getUser(a.winner.id).wins, 1); // (égalité possible si les 2 derniers tombent ensemble)
  a.tick();
  assert.equal(a.phase, 'lobby');
  assert.equal(a.round, 2);
});

test('le bouclier sauve une fois', () => {
  const a = mk();
  a.chat('x', 'x', 'go'); a.chat('y', 'y', 'go');
  a.gift('x', 'x', 5);
  const x = a.players.get('x');
  assert.ok(x.shield);
  a.phase = 'fight';
  a.damage(x, 999, a.players.get('y'), 'test');
  assert.ok(x.alive && !x.shield);
  a.damage(x, 999, a.players.get('y'), 'test');
  assert.ok(!x.alive);
});

test('les likes remplissent la pluie de coeurs', () => {
  const a = mk();
  const seen = [];
  a.on('evt', (e) => seen.push(e.type));
  a.like('u', 'u', 300);
  assert.ok(seen.includes('heartRain'));
  assert.equal(a.heart, 0);
});

test("l'IA répond avec l'historique du viewer et le sauvegarde", async () => {
  const db = openDb(':memory:');
  const a = new Arena(db, { lobbySeconds: 60 });
  const calls = [];
  const brain = new Brain(a, db, { minGapMs: 0, llm: async (m) => { calls.push(m); return 'Je me souviens de toi !'; } });
  const said = [];
  brain.on('say', (s) => said.push(s));
  a.chat('u1', 'Alice', 'Je suis fan de karim');
  a.chat('u1', 'Alice', 'Maximus tu te souviens de moi ?');
  await brain.drain(); // 1re réponse (le 2e message est en cooldown) -> on laisse le premier job passer
  brain.stop();
  const all = calls.flat().map((m) => m.content).join('\n');
  assert.ok(all.includes('Maximus') || all.includes('fan de karim'));
  assert.ok(said.some((s) => s.text.includes('@Alice')));
  assert.ok(db.userHistory('u1', 10).some((h) => h.role === 'ai'));
});

test('historique des cadeaux conservé en base', () => {
  const a = mk();
  a.gift('u', 'Uma', 50, 'Rose');
  a.gift('u', 'Uma', 5, 'Heart');
  const g = a.db.recentGifts(10);
  assert.equal(g.length, 2);
  assert.equal(g[1].coins, 50);
  assert.equal(a.db.giftTotals()[0].coins, 55);
});

test('le Titan apparaît, attaque et finit par tomber ou partir', () => {
  const a = mk();
  for (let i = 0; i < 8; i++) a.chat('p' + i, 'P' + i, 'go');
  a.tick(); a.tick();
  for (const p of a.players.values()) { p.hp = p.maxHp = 5000; } // personne ne meurt : on isole le boss
  const seen = [];
  a.on('evt', (e) => seen.push(e.type));
  a.tickN = a.opts.bossTick - 1;
  for (let i = 0; i < 40 && a.phase === 'fight'; i++) a.fightTick();
  assert.ok(seen.includes('bossSpawn'));
  assert.ok(seen.includes('bossDown') || seen.includes('bossLeave'));
  assert.equal(a.boss, null);
  assert.equal(a.snapshot().boss, null);
});

// ---------- chaque pouvoir fait vraiment ce qu'il annonce, et l'animation (événement) passe avant l'effet ----------
const room = (n = 3) => {
  const a = mk();
  for (let i = 0; i < n; i++) a.chat('p' + i, 'P' + i, 'go');
  const seen = [];
  a.on('evt', (e) => seen.push(e.type));
  return { a, seen, p: (i) => a.players.get('p' + i) };
};

test('pouvoirs de dégâts : épée x2, vampire x2, berserk x3 (+50 % PV), légende x3', () => {
  const { a, p } = room(1);
  a.gift('p0', 'P0', 1);   assert.equal(a.mult(p(0)), 2);
  a.gift('p0', 'P0', 99);  assert.equal(p(0).power, 'vampire'); assert.equal(a.mult(p(0)), 2); // 100 cumulés
  const r2 = room(1); r2.a.gift('p0', 'P0', 30);
  assert.equal(r2.p(0).power, 'berserk'); assert.equal(r2.p(0).maxHp, 150); assert.equal(r2.p(0).hp, 150); assert.equal(r2.a.mult(r2.p(0)), 3);
  const r3 = room(1); r3.a.gift('p0', 'P0', 1000); assert.equal(r3.a.mult(r3.p(0)), 3);
});

test('vampire : vole 50 % des dégâts qu\'il inflige', () => {
  const { a, p } = room(2);
  a.gift('p0', 'P0', 100);
  a.phase = 'fight';
  p(0).hp = 40;
  a.damage(p(1), 20, p(0), 'attaque');
  assert.equal(p(0).hp, 50);
});

test('bouclier : activé par le cadeau, sauve une fois', () => {
  const { a, p } = room(2);
  a.gift('p0', 'P0', 5);
  assert.ok(p(0).shield);
  a.phase = 'fight';
  a.damage(p(0), 9999, p(1), 'attaque');
  assert.ok(p(0).alive);
});

test('foudre et légende : annoncés en inscriptions, déclenchés au début du combat, animation AVANT les dégâts', () => {
  const { a, seen, p } = room(3);
  a.gift('p0', 'P0', 500);
  a.gift('p1', 'P1', 1000);
  assert.equal(p(2).hp, 100); // rien avant le combat
  assert.ok(seen.includes('power') && !seen.includes('lightning'));
  seen.length = 0;
  a.tick(); a.tick(); // -> fightStart
  const iStart = seen.indexOf('fightStart');
  assert.ok(iStart >= 0);
  const iLight = seen.indexOf('lightning'), iMet = seen.indexOf('meteors');
  assert.ok(iLight > iStart && iMet > iStart);
  assert.equal(p(2).hp, 100 - BALANCE.lightningDmg - 100 * BALANCE.meteorsPct); // foudre + météores
  assert.equal(p(0).hp, 100 - 100 * BALANCE.meteorsPct); // le lanceur de foudre subit les météores de l'autre, pas sa propre foudre
});

test('pouvoir donné en plein combat : l\'annonce précède l\'effet', () => {
  const { a, seen, p } = room(3);
  a.tick(); a.tick();
  assert.equal(a.phase, 'fight');
  for (const q of a.players.values()) q.hp = q.maxHp = 5000;
  seen.length = 0;
  a.gift('p0', 'P0', 500);
  assert.ok(seen.indexOf('power') < seen.indexOf('lightning'));
  assert.equal(p(1).hp, 5000 - BALANCE.lightningDmg);
});

test('un spectateur (arrivé après le début) ne reçoit pas de pouvoir fantôme', () => {
  const { a, seen } = room(2);
  a.tick(); a.tick();
  const evts = [];
  a.on('evt', (e) => evts.push(e));
  a.gift('late', 'Late', 1000);
  const g = evts.find((e) => e.type === 'gift');
  assert.equal(g.power, null); assert.equal(g.spectator, true);
  assert.ok(!evts.some((e) => e.type === 'power' || e.type === 'meteors'));
});

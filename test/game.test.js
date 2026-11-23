import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Arena, powerForCoins } from '../src/game.js';
import { Brain } from '../src/ai.js';

const mk = () => new Arena(openDb(':memory:'), { lobbySeconds: 2, endSeconds: 1 });

test('paliers cadeaux -> pouvoirs', () => {
  assert.equal(powerForCoins(0), null);
  assert.equal(powerForCoins(1), 'epee');
  assert.equal(powerForCoins(10), 'bouclier');
  assert.equal(powerForCoins(50), 'berserk');
  assert.equal(powerForCoins(100), 'vampire');
  assert.equal(powerForCoins(200), 'foudre');
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
  a.gift('x', 'x', 10);
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
  a.tickN = 11;
  for (let i = 0; i < 40 && a.phase === 'fight'; i++) a.fightTick();
  assert.ok(seen.includes('bossSpawn'));
  assert.ok(seen.includes('bossDown') || seen.includes('bossLeave'));
  assert.equal(a.boss, null);
  assert.equal(a.snapshot().boss, null);
});

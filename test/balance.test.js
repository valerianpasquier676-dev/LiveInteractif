import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Arena, BALANCE } from '../src/game.js';

// Mini-simulation du vrai moteur (le script complet a mesuré des milliers de rounds ; ici on garde ses garde-fous).
function play(n, { likes = 0, gifts = false, max = 400 } = {}) {
  const a = new Arena(openDb(':memory:'), { lobbySeconds: 1, endSeconds: 1 });
  const seen = { bossLeaveLow: false, minAliveDuringBoss: 99 };
  a.on('evt', (e) => { if (e.type === 'kill' && e.cause === 'boss') seen.minAliveDuringBoss = Math.min(seen.minAliveDuringBoss, e.left); });
  for (let i = 0; i < n; i++) a.chat('p' + i, 'P' + i, 'go');
  if (gifts) for (let i = 0; i < n; i++) a.gift('p' + i, 'P' + i, [1, 5, 30, 100, 500, 1000][i % 6]);
  a.tick(); a.tick();
  let ticks = 0;
  while (a.phase === 'fight' && ticks < max) {
    if (likes) for (const p of a.alive()) a.like(p.id, p.name, likes);
    a.tick(); ticks++;
    for (const p of a.players.values()) assert.ok(Number.isFinite(p.hp) && p.hp <= p.maxHp + 1e-9, `PV aberrants ${p.hp}/${p.maxHp}`);
  }
  return { ticks, winner: a.winner, done: a.phase === 'ended', ...seen };
}
const median = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];

test('tous les rounds se terminent avec un vainqueur, pas d\'égalité (2 à 30 joueurs)', () => {
  for (const n of [2, 3, 6, 12, 30]) {
    const rs = Array.from({ length: 25 }, () => play(n));
    assert.ok(rs.every((r) => r.done), `n=${n} : round non terminé`);
    assert.equal(rs.filter((r) => !r.winner).length, 0, `n=${n} : égalités`);
  }
});

test('rythme : un combat dure entre 20 s et 2 min 30, quel que soit le nombre de joueurs', () => {
  for (const n of [2, 6, 12, 30]) {
    const m = median(Array.from({ length: 21 }, () => play(n).ticks));
    assert.ok(m >= 20 && m <= 150, `n=${n} : durée médiane ${m} s`);
  }
});

test('spammer les likes ne rend pas immortel : le round finit (au plus tard par la tempête)', () => {
  for (const likes of [5, 15]) {
    const r = play(6, { likes });
    assert.ok(r.done && r.winner, `likes x${likes} : round infini ou égalité`);
    assert.ok(r.ticks <= BALANCE.suddenDeathTick + 40, `likes x${likes} : ${r.ticks} s`);
  }
});

test('même si tout le monde achète les gros pouvoirs, foudre et météores ne tuent jamais à eux seuls', () => {
  const a = new Arena(openDb(':memory:'), { lobbySeconds: 1 });
  for (let i = 0; i < 6; i++) a.chat('p' + i, 'P' + i, 'go');
  for (let i = 0; i < 6; i++) { a.gift('p' + i, 'P' + i, 1000); a.gift('p' + i, 'P' + i, 500); }
  const kills = [];
  a.on('evt', (e) => { if (e.type === 'kill') kills.push(e.cause); });
  a.tick(); // début du combat (aucune attaque encore) : les 6 légendes déchaînent leurs météores et leur foudre
  assert.ok(a.phase === 'fight');
  assert.ok(!kills.includes('foudre') && !kills.includes('météores'));
  assert.ok(a.alive().length === 6 && a.alive().every((p) => p.hp >= 1)); // tous affaiblis, personne d'éliminé
});

test('le Titan ne frappe jamais quand il reste 3 gladiateurs ou moins', () => {
  for (let i = 0; i < 15; i++) {
    const r = play(8);
    assert.ok(r.minAliveDuringBoss >= 3, `le Titan a fini avec ${r.minAliveDuringBoss} survivants`);
  }
});

test('la pluie de cœurs a un délai de récupération en combat', () => {
  const a = new Arena(openDb(':memory:'), { lobbySeconds: 1 });
  a.chat('a', 'A', 'go'); a.chat('b', 'B', 'go');
  a.tick(); a.tick();
  let rains = 0;
  a.on('evt', (e) => { if (e.type === 'heartRain') rains++; });
  a.like('a', 'A', 300 * 5);      // 5 jauges d'un coup
  assert.equal(rains, 1);          // une seule pluie, pas cinq
  for (let i = 0; i < BALANCE.heartRainCooldown; i++) for (const p of a.alive()) p.hp = p.maxHp, a.fightTick();
  assert.ok(rains >= 2);           // la deuxième part une fois le délai écoulé
});

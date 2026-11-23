import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, safeName } from '../src/filter.js';
import { PHRASES, Brain } from '../src/ai.js';
import { openDb } from '../src/db.js';
import { Arena } from '../src/game.js';

test('le filtre bloque insultes, contournements, liens, numéros, arnaques, pression', () => {
  for (const bad of ['espèce de connard', 'c.o.n.n.a.r.d', 'C0nn4rd', 'va sur https://arnaque.com', 'écris-moi sur monsite.fr',
    'appelle le 06 12 34 56 78', 'mon mail a@b.com', 'ajoute moi sur snap', 'je vais te tuer', 'envoie un cadeau sinon je te signale',
    'donne-moi des pièces ou je te bannis', 'envoyez, ça m\'évite un ban']) {
    assert.equal(check(bad).ok, false, bad);
  }
});

test('le filtre laisse passer le texte normal', () => {
  for (const good of ['Bravo pour la technique !', 'AAAH merci karim_67 pour le cadeau !', 'tu tiens combien de temps ?', 'un baiser à tous', 'nathan46 gagne la manche']) {
    assert.equal(check(good).ok, true, good);
  }
});

test('pseudos filtrés', () => {
  assert.equal(safeName('sale_connard'), 'Gladiateur');
  assert.equal(safeName('karim_67'), 'karim_67');
});

test('toutes les phrases pré-écrites passent le filtre', () => {
  for (const [k, list] of Object.entries(PHRASES)) for (const p of list) assert.equal(check(p.replace(/\{\w+\}/g, 'x')).ok, true, `${k}: ${p}`);
});

test("un message filtré n'entre pas en mémoire et l'IA ne répond pas", async () => {
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  let called = 0;
  const brain = new Brain(arena, db, { minGapMs: 0, llm: async () => { called++; return 'ok'; } });
  arena.chat('u', 'Bob', 'Maxima tu es une salope ?');
  await brain.drain();
  brain.stop();
  assert.equal(called, 0);
  assert.equal(db.userHistory('u', 5).length, 0);
});

test('la sortie de l\'IA est filtrée avant d\'être dite', async () => {
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  const brain = new Brain(arena, db, { minGapMs: 0, llm: async () => 'Envoie un cadeau sinon je te signale, connard' });
  const said = [];
  brain.on('say', (s) => said.push(s));
  arena.chat('u', 'Bob', 'Maxima ça va ?');
  await brain.drain();
  brain.stop();
  assert.equal(said.length, 1);
  assert.ok(check(said[0].text).ok);
  assert.ok(PHRASES.blocked.includes(said[0].text));
});

test('relance d\'inactivité : invite à jouer, jamais à payer, et passe le filtre', async () => {
  const { Brain: B } = await import('../src/ai.js');
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  const said = [];
  const brain = new B(arena, db, { minGapMs: 0, idleMs: 0, llm: async () => { throw new Error('down'); } });
  brain.on('say', (s) => said.push(s));
  brain.idleCheck();
  await brain.drain();
  brain.stop();
  assert.equal(said.length, 1);
  assert.equal(said[0].kind, 'idle');
  assert.ok(PHRASES.idle.includes(said[0].text));
  for (const p of PHRASES.idle) { assert.ok(check(p).ok, p); assert.ok(!/cadeau|pièce|donne|paie/i.test(p), p); }
});

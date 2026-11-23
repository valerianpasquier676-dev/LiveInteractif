import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Arena } from '../src/game.js';
import { Brain, PHRASES } from '../src/ai.js';

const setup = (llm = async () => 'ok') => {
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  const brain = new Brain(arena, db, { minGapMs: 0, llm });
  brain.stop(); // on pilote drain() à la main
  const said = [];
  brain.on('say', (s) => said.push(s));
  return { db, arena, brain, said };
};
const down = async () => { throw new Error('IA en panne'); };

test('compteurs par viewer : commentaires, cœurs, partages, abonnements', () => {
  const { arena } = setup();
  for (let i = 0; i < 5; i++) arena.chat('a', 'Alice', 'salut ' + i);
  arena.chat('b', 'Bob', 'yo');
  arena.like('b', 'Bob', 50);
  arena.like('a', 'Alice', 10);
  arena.share('c', 'Chloé');
  arena.follow('c', 'Chloé');
  assert.deepEqual(arena.topFans('chats', 3, 3).map((f) => f.name), ['Alice']);
  assert.deepEqual(arena.topFans('likes', 3, 30).map((f) => f.name), ['Bob']);
  assert.equal(arena.fans.get('c').shares, 1);
  assert.equal(arena.stats.shares, 1);
  assert.equal(arena.stats.follows, 1);
  assert.ok(arena.players.has('c'), 'partager inscrit aussi au round');
});

test('Maxima répond aussi aux plus gros commentateurs et aux plus gros envoyeurs de cœurs (sans question)', async () => {
  const prompts = [];
  const { arena, brain, said } = setup(async (m) => { prompts.push(m[0].content); return 'merci à toi'; });
  arena.chat('x', 'Xavier', 'coucou'); // viewer de passage : pas de réponse
  await brain.drain();
  assert.equal(said.length, 0);
  for (let i = 0; i < 3; i++) arena.chat('a', 'Alice', 'allez les gladiateurs ' + i);
  await brain.drain();
  assert.ok(said.some((s) => s.text.startsWith('@Alice')));
  assert.ok(prompts.some((p) => p.includes('plus actifs')));
  arena.like('h', 'Hugo', 40);
  arena.chat('h', 'Hugo', 'trop bien');
  await brain.drain();
  assert.ok(said.some((s) => s.text.startsWith('@Hugo')), 'top cœurs');
});

test('un fan très actif ne reçoit pas une réponse à chaque message (cooldown)', async () => {
  const { arena, brain, said } = setup();
  for (let i = 0; i < 10; i++) { arena.chat('a', 'Alice', 'message ' + i); await brain.drain(); }
  assert.equal(said.filter((s) => s.text.startsWith('@Alice')).length, 1);
});

test('partages et abonnements : un seul merci regroupé, avec les pseudos', async () => {
  const { arena, brain, said } = setup(down);
  arena.share('a', 'Alice');
  arena.share('b', 'Bob');
  arena.follow('c', 'Chloé');
  await brain.drain();
  assert.equal(said.length, 0, 'on attend 3 s pour regrouper');
  for (const s of brain.pendingSocial) s.ts -= 4000;
  await brain.drain();
  await brain.drain();
  assert.equal(said.length, 1);
  assert.equal(said[0].kind, 'social');
  assert.ok(said[0].text.includes('Alice, Bob'), said[0].text);
});

test('mention spéciale aux plus actifs, puis invitation à partager / s\'abonner (rien promis en échange)', async () => {
  const prompts = [];
  const { arena, brain, said } = setup(async (m) => { prompts.push(m.at(-1).content); throw new Error('panne'); });
  for (let i = 0; i < 4; i++) arena.chat('a', 'Alice', 'go ' + i);
  arena.like('b', 'Bob', 80);
  brain.queue = []; // on ignore la réponse au chat déclenchée ci-dessus
  const t = Date.now();
  brain.socialCheck(t); // rien : trop tôt
  assert.equal(brain.queue.length, 0);
  brain.socialCheck(t + brain.shoutoutMs);
  await brain.drain();
  assert.equal(said.at(-1).kind, 'shoutout');
  assert.ok(said.at(-1).text.includes('Alice') && said.at(-1).text.includes('Bob'), said.at(-1).text);
  brain.socialCheck(t + brain.promoMs);
  await brain.drain();
  assert.equal(said.at(-1).kind, 'promo');
  assert.ok(PHRASES.promo.includes(said.at(-1).text));
  assert.ok(prompts.at(-1).includes('Ne promets RIEN en échange'));
});

test('chat inondé de questions : Maxima garde du temps pour l\'action et les remerciements', async () => {
  const { arena, brain, said } = setup();
  for (let i = 0; i < 8; i++) arena.chat('q' + i, 'Q' + i, 'qui va gagner ?');
  assert.equal(brain.queue.filter((q) => q.kind === 'reply').length, 3, 'au plus 3 réponses en attente');
  arena.share('s', 'Sam');
  for (const s of brain.pendingSocial) s.ts -= 4000;
  arena.emitEvt({ type: 'carnage' });
  for (let i = 0; i < 6; i++) await brain.drain();
  const kinds = said.map((s) => s.kind);
  assert.ok(kinds.includes('social') && kinds.includes('carnage'), kinds.join(','));
  assert.ok(!kinds.join(',').includes('reply,reply,reply'), kinds.join(','));
  arena.chat('q7', 'Q7', 'et moi ?'); // la file s'est vidée : les questions suivantes sont de nouveau prises
  assert.ok(brain.queue.some((q) => q.kind === 'reply'));
});

test('réglages : 0 = jamais de mention ni d\'invitation', () => {
  const { arena, brain } = setup();
  brain.applySettings({ minGapSeconds: 3.5, idleSeconds: 35, idleChat: true, shoutoutMinutes: 0, promoMinutes: 0 });
  for (let i = 0; i < 4; i++) arena.chat('a', 'Alice', 'go ' + i);
  brain.queue = [];
  brain.socialCheck(Date.now() + 24 * 3600e3);
  assert.equal(brain.queue.length, 0);
});

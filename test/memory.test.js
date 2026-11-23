import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Arena } from '../src/game.js';
import { Brain } from '../src/ai.js';
import { buildMemory, memoryPrompt, keywords } from '../src/memory.js';

const setup = () => {
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  return { db, arena };
};

test('recherche : par pseudo, par texte, par rôle, pagination, jokers SQL neutralisés', () => {
  const { db, arena } = setup();
  arena.chat('1', 'karim_67', "j'adore les dragons");
  arena.chat('2', 'juliette', 'vive les dragons rouges');
  arena.chat('1', 'karim_67', 'salut tout le monde');
  db.saveMessage('1', 'ai', 'Hihi karim, les dragons sont sympas');
  assert.equal(db.searchMessages({ q: 'dragons' }).total, 3);
  assert.equal(db.searchMessages({ user: 'karim' }).total, 3);
  assert.equal(db.searchMessages({ user: 'karim', q: 'dragons', role: 'user' }).total, 1);
  assert.equal(db.searchMessages({ role: 'ai' }).rows[0].name, 'karim_67');
  assert.equal(db.searchMessages({ q: 'dragons', limit: 1, offset: 1 }).rows.length, 1);
  assert.equal(db.searchMessages({ q: '%' }).total, 0);   // "%" cherché littéralement, pas comme joker
  assert.equal(db.searchMessages({ q: '_' }).total, 0);
  assert.equal(db.findUsers('juli')[0].name, 'juliette');
  assert.equal(db.findUsers('')[0].name != null, true);
});

test('fiche viewer : première vue, messages, cadeaux préférés', () => {
  const { db, arena } = setup();
  arena.chat('1', 'karim_67', 'hello');
  arena.gift('1', 'karim_67', 30, 'Doughnut');
  arena.gift('1', 'karim_67', 1, 'Rose');
  const p = db.userProfile('1');
  assert.equal(p.messages, 1); assert.equal(p.gifts, 2); assert.equal(p.giftCoins, 31);
  assert.equal(p.topGifts[0].gift, 'Doughnut');
  assert.ok(p.first_seen > 0);
  assert.equal(db.userProfile('inconnu'), null);
  assert.equal(db.conversation('1').length, 1);
});

test('modération : un message bloqué est consultable mais pas mémorisé', () => {
  const { db, arena } = setup();
  arena.chat('9', 'troll', 'espèce de connard');
  assert.equal(db.recentBlocked()[0].reason, 'insulte');
  assert.equal(db.blockedStats()[0].n, 1);
  assert.equal(db.searchMessages({ q: 'connard' }).total, 0);
});

test('mots-clés : sans mots vides ni accents', () => {
  assert.deepEqual(keywords('Maxima tu te souviens de mon DRAGON préféré ?'), ['souviens', 'dragon', 'prefere']);
});

test("mémoire longue : retrouve un vieux souvenir hors des 8 derniers messages et un viewer cité", () => {
  const { db, arena } = setup();
  arena.chat('2', 'juliette', 'mon dragon préféré est le vert');
  for (let i = 0; i < 12; i++) arena.chat('1', 'karim_67', `message numéro ${i} sans rapport`);
  arena.chat('1', 'karim_67', 'je suis le roi des dragons');
  const mem = buildMemory(db, { id: '1', text: 'tu te souviens des dragons et de juliette ?', exclude: [] });
  assert.ok(mem.relevant.some((r) => r.text.includes('roi des dragons')));
  assert.equal(mem.mentions[0].name, 'juliette');
  assert.ok(mem.mentions[0].messages[0].text.includes('dragon préféré'));
  const txt = memoryPrompt(mem, 'karim_67');
  assert.match(txt, /MÉMOIRE/); assert.match(txt, /juliette/); assert.match(txt, /roi des dragons/);
});

test("l'IA reçoit la mémoire dans son prompt et se souvient d'un autre viewer", async () => {
  const { db, arena } = setup();
  arena.chat('2', 'juliette', 'ma couleur préférée est le violet');
  const sent = [];
  const brain = new Brain(arena, db, { minGapMs: 0, llm: async (m) => { sent.push(m); return 'Je me souviens !'; } });
  const said = [];
  brain.on('say', (s) => said.push(s));
  arena.chat('1', 'karim_67', 'Maxima, tu te souviens de juliette et de sa couleur ?');
  await brain.drain();
  brain.stop();
  const system = sent.at(-1)[0].content;
  assert.match(system, /MÉMOIRE/);
  assert.match(system, /violet/);
  assert.equal(said.length, 1);
});

test('la mémoire ne rappelle jamais un message filtré', () => {
  const { db } = setup();
  db.touchUser('1', 'a'); db.touchUser('2', 'bob_le_gentil');
  db.saveMessage('2', 'user', 'tu es un connard');          // inséré en direct (ancienne donnée) : doit être ignoré
  db.saveMessage('2', 'user', 'mon plat préféré, les pâtes');
  const mem = buildMemory(db, { id: '1', text: 'que sais-tu de bob_le_gentil ?', exclude: [] });
  assert.equal(mem.mentions[0].messages.length, 1);
  assert.match(mem.mentions[0].messages[0].text, /pâtes/);
});

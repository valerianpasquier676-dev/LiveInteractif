import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { config } from '../src/config.js';
import { LlmChain, providers } from '../src/llm.js';
import { Brain, PHRASES } from '../src/ai.js';
import { openDb } from '../src/db.js';
import { Arena } from '../src/game.js';
import { parseSchedule, inWindow, LiveLink } from '../src/tiktok.js';

const fakeProvider = (text, fail = false) => ({ enabled: () => true, label: () => 'fake', chat: async () => { if (fail) throw new Error('down'); return text; } });

test('chaîne IA : Gemma (ollama) puis Groq puis phrases', async () => {
  const chain = new LlmChain(['ollama', 'groq'], { ollama: fakeProvider('', true), groq: fakeProvider('salut de groq') });
  assert.equal(await chain.chat([]), 'salut de groq');
  assert.equal(chain.last, 'groq');
  assert.equal(chain.status().providers[0].ok, false);

  const dead = new LlmChain(['ollama', 'groq'], { ollama: fakeProvider('', true), groq: fakeProvider('', true) });
  await assert.rejects(() => dead.chat([]));
});

test('Maximus retombe sur les phrases pré-écrites si tout est down', async () => {
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  const dead = new LlmChain(['ollama'], { ollama: fakeProvider('', true) });
  const brain = new Brain(arena, db, { llm: dead, minGapMs: 0 });
  const said = [];
  brain.on('say', (s) => said.push(s));
  arena.chat('u', 'Bob', 'Maximus ça va ?');
  await brain.drain();
  brain.stop();
  assert.equal(said.length, 1);
  assert.equal(said[0].provider, 'phrases');
  assert.ok(PHRASES.reply.some((p) => p.replace('{name}', 'Bob') === said[0].text));
});

test('protocole réel Ollama (/api/chat, /api/tags) et Groq (OpenAI)', async () => {
  const seen = {};
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen[req.url] = { body: b ? JSON.parse(b) : null, auth: req.headers.authorization };
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'gemma3:latest' }] }));
      else if (req.url === '/api/chat') res.end(JSON.stringify({ message: { content: 'réponse gemma' } }));
      else res.end(JSON.stringify({ choices: [{ message: { content: 'réponse groq' } }] }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  Object.assign(config, { ollamaUrl: base, ollamaModel: 'gemma3', groqUrl: base, groqKey: 'k', groqModel: 'm' });
  try {
    assert.equal(await providers.ollama.chat([{ role: 'user', content: 'x' }]), 'réponse gemma');
    assert.equal(seen['/api/chat'].body.model, 'gemma3');
    assert.equal(seen['/api/chat'].body.stream, false);
    assert.deepEqual(await providers.ollama.health(), { up: true, hasModel: true, models: ['gemma3:latest'] });
    assert.equal(await providers.groq.chat([{ role: 'user', content: 'x' }]), 'réponse groq');
    assert.equal(seen['/chat/completions'].auth, 'Bearer k');
    config.ollamaModel = 'gemma4';
    assert.equal((await providers.ollama.health()).hasModel, false);
  } finally { srv.close(); }
});

test('planning horaire', () => {
  const w = parseSchedule('12:00-14:00, 18:00-23:30');
  const at = (h, m) => new Date(2026, 0, 1, h, m);
  assert.ok(inWindow(w, at(12, 0)) && inWindow(w, at(13, 59)));
  assert.ok(!inWindow(w, at(14, 0)) && !inWindow(w, at(16, 0)) && !inWindow(w, at(23, 30)));
  assert.ok(inWindow(parseSchedule('22:00-02:00'), at(1, 0))); // passe minuit
  assert.ok(inWindow([], at(5, 0))); // vide = toujours
  assert.throws(() => parseSchedule('midi'));
});

test('LiveLink : se connecte dans la plage, réessaie tant que pas en live, se coupe hors plage', async () => {
  const arena = new Arena(openDb(':memory:'), { lobbySeconds: 60 });
  let tries = 0, disconnected = 0;
  const connect = async () => { if (++tries < 2) throw new Error('pas en live'); return { disconnect: () => { disconnected++; } }; };
  const link = new LiveLink(arena, { user: 'x', windows: [], connect, retryMs: 0, log: () => {} });
  await link.tick();
  assert.equal(link.status, 'waiting-live');
  await link.tick();
  assert.equal(link.status, 'live');
  link.windows = [[0, 0]]; // plage vide -> hors plage (a<=b, m>=0 && m<0 faux)
  await link.tick();
  assert.equal(link.status, 'waiting-window');
  assert.equal(disconnected, 1);
  link.setMode('on');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(link.status, 'live');
  await link.stop();
});

test('requête en course : si le 1er fournisseur est lent, le 2e est lancé en parallèle et gagne', async () => {
  let slowAborted = false;
  const slow = { enabled: () => true, label: () => 'slow', chat: (m, { signal } = {}) => new Promise((res, rej) => { const t = setTimeout(() => res('lent'), 400); signal?.addEventListener('abort', () => { slowAborted = true; clearTimeout(t); rej(new Error('annulé')); }); }) };
  const fast = fakeProvider('rapide');
  const chain = new LlmChain(['ollama', 'groq'], { ollama: slow, groq: fast }, { hedgeMs: 40 });
  const t0 = Date.now();
  assert.equal(await chain.chat([]), 'rapide');
  assert.ok(Date.now() - t0 < 300, 'doit répondre bien avant la fin du fournisseur lent');
  assert.equal(chain.last, 'groq');
  assert.equal(slowAborted, true);                       // le perdant est annulé
  assert.equal(chain.state.ollama.ok, null);             // et n'est pas compté comme une panne
  assert.equal(chain.stats.hedged, 1);
});

test('si le 1er répond vite, le 2e n\'est jamais appelé', async () => {
  let calls = 0;
  const second = { enabled: () => true, label: () => 's', chat: async () => { calls++; return 'x'; } };
  const chain = new LlmChain(['ollama', 'groq'], { ollama: fakeProvider('vite'), groq: second }, { hedgeMs: 200 });
  assert.equal(await chain.chat([]), 'vite');
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(calls, 0);
});

test('Maxima ne fait pas attendre l\'antenne : IA trop lente -> phrase pré-écrite immédiate', async () => {
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  const brain = new Brain(arena, db, { minGapMs: 0, narrateDeadlineMs: 80, llm: () => new Promise((r) => setTimeout(() => r('trop tard'), 600)) });
  const said = [];
  brain.on('say', (s) => said.push(s));
  const t0 = Date.now();
  await brain.narrate({ type: 'heartRain' });
  brain.stop();
  assert.ok(Date.now() - t0 < 400);
  assert.equal(said[0].provider, 'phrases');
  assert.ok(PHRASES.heartRain.includes(said[0].text));
});

test('les répliques périmées sont jetées et les prompts restent compacts', async () => {
  const db = openDb(':memory:');
  const arena = new Arena(db, { lobbySeconds: 60 });
  const brain = new Brain(arena, db, { minGapMs: 0, llm: async () => 'ok' });
  brain.stop();
  let ran = false;
  brain.enqueue(1, async () => { ran = true; }, -1); // déjà périmée
  await brain.drain();
  assert.equal(ran, false);
  const d = brain.describe({ type: 'gift', name: 'Karim', coins: 30, giftName: 'Doughnut', power: 'berserk', avatar: 'https://p16.tiktokcdn.com/' + 'a'.repeat(300), giftImage: 'https://x' });
  assert.ok(d.includes('Doughnut') && !d.includes('tiktokcdn') && d.length < 200, d);
});

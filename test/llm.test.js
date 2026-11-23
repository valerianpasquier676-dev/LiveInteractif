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

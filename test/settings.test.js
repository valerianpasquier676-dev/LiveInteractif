import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Settings } from '../src/settings.js';
import { Arena } from '../src/game.js';
import { Brain } from '../src/ai.js';
import { openDb } from '../src/db.js';

test('réglages : valeurs bornées, clés inconnues ignorées, événement de changement', () => {
  const s = new Settings(null);
  let changed = null;
  s.on('change', (all, patch) => { changed = patch; });
  const out = s.update({ pitch: 99, volume: -3, idleSeconds: 9999, minGapSeconds: 0, voiceEnabled: 0, hack: 'x', voiceName: 'a'.repeat(500) });
  assert.equal(out.pitch, 2); assert.equal(out.volume, 0); assert.equal(out.idleSeconds, 300); assert.equal(out.minGapSeconds, 1);
  assert.equal(out.voiceEnabled, false); assert.equal(out.voiceName.length, 80); assert.ok(!('hack' in out));
  assert.equal(changed.pitch, 2);
  changed = null;
  s.update({ pitch: 2 }); // inchangé : pas d'événement
  assert.equal(changed, null);
  assert.equal(s.update({ pitch: 'abc' }).pitch, 0.5); // valeur invalide -> borne basse, jamais NaN
});

test('réglages : sauvegardés sur disque et relus au redémarrage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-'));
  const file = join(dir, 'settings.json');
  try {
    new Settings(file).update({ voiceEnabled: false, rate: 1.3 });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).rate, 1.3);
    const again = new Settings(file).get();
    assert.equal(again.voiceEnabled, false); assert.equal(again.rate, 1.3);
    assert.equal(again.pitch, 1.55); // les autres gardent leur valeur par défaut
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Maxima applique les réglages du backstage (délai, relances)', () => {
  const db = openDb(':memory:');
  const brain = new Brain(new Arena(db, { lobbySeconds: 60 }), db, { llm: async () => 'ok' });
  brain.applySettings({ minGapSeconds: 8, idleSeconds: 120, idleChat: false });
  brain.stop();
  assert.equal(brain.minGapMs, 8000); assert.equal(brain.idleMs, 120000); assert.equal(brain.idleEnabled, false);
  brain.idleCheck(); assert.equal(brain.queue.length, 0); // relances coupées
});

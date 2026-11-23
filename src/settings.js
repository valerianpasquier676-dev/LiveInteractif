// Réglages modifiables en direct depuis le backstage (voix, relances, photos...). Sauvegardés dans data/settings.json
// pour survivre à un redémarrage. Les réglages « techniques » (port, clés, modèles) restent dans .env.
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const FILE = fileURLToPath(new URL('../data/settings.json', import.meta.url));

/** Chaque réglage : valeur par défaut + validation (bornes). */
const SPEC = {
  voiceEnabled: { def: true, parse: (v) => !!v },
  volume: { def: 1, parse: (v) => clamp(v, 0, 1) },
  pitch: { def: 1.55, parse: (v) => clamp(v, 0.5, 2) },
  rate: { def: 1, parse: (v) => clamp(v, 0.6, 1.6) },
  voiceName: { def: '', parse: (v) => String(v ?? '').slice(0, 80) },
  showAvatars: { def: config.showAvatars, parse: (v) => !!v },
  idleChat: { def: true, parse: (v) => !!v },          // Maxima relance l'ambiance quand c'est calme
  idleSeconds: { def: 35, parse: (v) => clamp(v, 10, 300) },
  minGapSeconds: { def: 3.5, parse: (v) => clamp(v, 1, 20) }, // délai minimum entre deux répliques de Maxima
  shoutoutMinutes: { def: 3, parse: (v) => clamp(v, 0, 30) }, // mention spéciale aux viewers les plus actifs (0 = jamais)
  promoMinutes: { def: 5, parse: (v) => clamp(v, 0, 60) },    // invitation à partager le live / s'abonner (0 = jamais)
};
function clamp(v, lo, hi) { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; }

export class Settings extends EventEmitter {
  constructor(file = FILE) {
    super();
    this.file = file;
    this.values = Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [k, s.def]));
    if (file) {
      try { this.merge(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* pas encore de fichier : valeurs par défaut */ }
    }
  }

  merge(patch) {
    const changed = {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (!(k in SPEC)) continue; // clés inconnues ignorées
      const val = SPEC[k].parse(v);
      if (val !== this.values[k]) { this.values[k] = val; changed[k] = val; }
    }
    return changed;
  }

  get() { return { ...this.values }; }

  update(patch) {
    const changed = this.merge(patch);
    if (Object.keys(changed).length) {
      if (this.file) { try { mkdirSync(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true }); writeFileSync(this.file, JSON.stringify(this.values, null, 2)); } catch (e) { console.warn('[réglages] sauvegarde impossible :', e.message); } }
      this.emit('change', this.get(), changed);
    }
    return this.get();
  }
}

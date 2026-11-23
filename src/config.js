import { readFileSync } from 'node:fs';

// mini loader .env (sans dépendance)
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const e = process.env;
export const config = {
  port: +e.PORT || 3000,
  tiktokUser: (e.TIKTOK_USERNAME || '').replace(/^@/, ''),
  simulate: e.SIMULATE === '1' || !e.TIKTOK_USERNAME,
  ollamaUrl: e.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaModel: e.OLLAMA_MODEL || 'gemma3',
  lobbySeconds: +e.LOBBY_SECONDS || 45,
  startHp: +e.START_HP || 100,
  heartGoal: 300, // likes pour déclencher la "Pluie de cœurs"
};

// Cadeau (pièces) -> pouvoir au départ. Le plus haut palier atteint gagne.
export const POWERS = [
  { id: 'legende', label: 'Légende', min: 1000, desc: 'Météores + dégâts x3' },
  { id: 'foudre', label: 'Foudre', min: 200, desc: "Frappe toute l'arène" },
  { id: 'berserk', label: 'Berserk', min: 50, desc: 'Géant, dégâts x3' },
  { id: 'bouclier', label: 'Bouclier', min: 10, desc: 'Retour en vie' },
  { id: 'epee', label: 'Épée', min: 1, desc: 'Dégâts x2' },
];

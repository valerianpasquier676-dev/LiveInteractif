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
  host: e.HOST || '127.0.0.1',
  port: +e.PORT || 3030,
  tiktokUser: (e.TIKTOK_USERNAME || '').replace(/^@/, ''),
  signApiKey: e.TIKTOK_SIGN_API_KEY || '', // facultatif : clé Euler Stream (www.eulerstream.com) si les limites gratuites bloquent la connexion
  simulate: e.SIMULATE === '1' || !e.TIKTOK_USERNAME,
  // Plages horaires où le lien TikTok s'active tout seul, ex: "12:00-14:00,18:00-23:30". Vide = tout le temps.
  schedule: e.SCHEDULE || '',
  // Ordre des fournisseurs IA ; en dernier recours : phrases pré-écrites.
  llmOrder: (e.LLM_ORDER || 'ollama,groq').split(',').map((s) => s.trim()).filter(Boolean),
  ollamaUrl: e.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaModel: e.OLLAMA_MODEL || 'gemma4:e4b',
  ollamaTimeoutMs: +e.OLLAMA_TIMEOUT_MS || 8000, // au-delà, la requête Gemma est abandonnée
  ollamaThreads: +e.OLLAMA_THREADS || 0, // cœurs CPU donnés à Gemma (0 = automatique) ; moins = plus de CPU pour le stream
  // Délais de l'IA (ms). Par défaut : réglés pour un PC avec carte graphique. Gemma sur processeur seul : voir .env.example
  aiHedgeMs: +e.AI_HEDGE_MS || 2000, // le 1er fournisseur n'a pas répondu : le suivant (Groq) est lancé en parallèle
  aiNarrateMs: +e.AI_NARRATE_MS || 3500, // commentaire d'action : au-delà, phrase pré-écrite
  aiReplyMs: +e.AI_REPLY_MS || 7000, // réponse au chat : au-delà, phrase pré-écrite
  groqKey: e.GROQ_API_KEY || '',
  groqModel: e.GROQ_MODEL || 'openai/gpt-oss-120b', // llama-3.3-70b-versatile a été arrêté par Groq le 16/08/2026
  groqUrl: e.GROQ_URL || 'https://api.groq.com/openai/v1',
  showAvatars: e.SHOW_AVATARS !== '0', // photos de profil des viewers dans l'arène
  persona: e.PERSONA_NAME || 'Maxima',
  lobbySeconds: +e.LOBBY_SECONDS || 45,
  startHp: +e.START_HP || 100,
  heartGoal: 300, // likes pour déclencher la "Pluie de cœurs"
};

// Cadeau (pièces) -> pouvoir. Le plus haut palier atteint (cumulé sur le round) gagne.
export const POWERS = [
  { id: 'legende', label: 'Légende', min: 1000, desc: 'Météores + dégâts x3' },
  { id: 'foudre', label: 'Foudre', min: 500, desc: "Frappe toute l'arène" },
  { id: 'vampire', label: 'Vampire', min: 100, desc: 'Dégâts x2, vole 50 % en vie' },
  { id: 'berserk', label: 'Berserk', min: 30, desc: 'Géant, dégâts x3' },
  { id: 'bouclier', label: 'Bouclier', min: 5, desc: 'Retour en vie' },
  { id: 'epee', label: 'Épée', min: 1, desc: 'Dégâts x2' },
];

// Barème affiché en bas de l'écran : un vrai cadeau TikTok par palier. Prix INDICATIFS : en live, le catalogue
// réel de TikTok (prix + image) remplace ces valeurs. Le pouvoir donné dépend toujours du prix réel payé.
export const BAREME = [
  { gift: 'Rose', emoji: '🌹', coins: 1, power: 'epee' },
  { gift: 'Finger Heart', emoji: '🫰', coins: 5, power: 'bouclier' },
  { gift: 'Doughnut', emoji: '🍩', coins: 30, power: 'berserk' },
  { gift: 'Hand Hearts', emoji: '🫶', coins: 100, power: 'vampire' },
  { gift: 'Money Gun', emoji: '💸', coins: 500, power: 'foudre' },
  { gift: 'Galaxy', emoji: '🌌', coins: 1000, power: 'legende' },
];

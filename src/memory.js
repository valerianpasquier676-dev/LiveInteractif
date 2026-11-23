// Mémoire à long terme de Maxima : au lieu de ne relire que les derniers messages, elle FOUILLE l'historique
// (la même recherche que l'onglet « Historique » du backstage) pour retrouver des souvenirs pertinents.
import { check } from './filter.js';

const STOP = new Set(('avec dans pour mais vous nous elle elles ils sont suis es est ete etre avoir fait faire plus tres tout tous toute comme cette ces '
  + 'leur leurs quoi quel quelle quand donc alors aussi bien encore deja jamais rien dire dit peux veux veut vais allez salut coucou merci maxima maximus '
  + 'gladiateur gladiateurs arene live combat cest jai tes mes mon ton son').split(' '));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Mots-clés significatifs d'un message (4 lettres et +, sans mots vides), au plus 4. */
export function keywords(text, max = 4) {
  const out = [];
  for (const w of norm(String(text)).split(/[^a-z0-9]+/)) if (w.length >= 4 && !STOP.has(w) && !out.includes(w)) out.push(w);
  return out.slice(0, max);
}

/**
 * @param exclude textes déjà présents dans le prompt (historique récent, message courant) : on ne les répète pas
 * @returns { profile, relevant:[{ts,text}], mentions:[{name,wins,messages:[{ts,text}]}] }
 */
export function buildMemory(db, { id, text, exclude = [] }) {
  const skip = new Set(exclude);
  const profile = db.userProfile(id);
  const relevant = [];
  for (const kw of keywords(text)) {
    for (const r of db.searchMessages({ userId: id, q: kw, role: 'user', limit: 5 }).rows) {
      if (skip.has(r.text) || relevant.some((x) => x.id === r.id) || !check(r.text).ok) continue;
      relevant.push({ id: r.id, ts: r.ts, text: r.text });
    }
  }
  relevant.sort((a, b) => b.ts - a.ts);

  // « tu te souviens de karim ? » : si le message cite le pseudo d'un autre viewer connu, on rappelle ce qu'il a dit
  const mentions = [];
  for (const tok of String(text).split(/[^\p{L}\p{N}_.]+/u)) {
    const name = tok.replace(/^@/, '');
    if (name.length < 4 || mentions.length >= 2) continue;
    const u = db.userByName(name);
    if (!u || u.id === id || mentions.some((m) => m.id === u.id)) continue;
    const prof = db.userProfile(u.id);
    const msgs = db.searchMessages({ userId: u.id, role: 'user', limit: 3 }).rows.filter((m) => check(m.text).ok).map((m) => ({ ts: m.ts, text: m.text }));
    mentions.push({ id: u.id, name: u.name, wins: prof?.wins ?? 0, kills: prof?.kills ?? 0, messages: msgs });
  }
  return { profile, relevant: relevant.slice(0, 3).map(({ ts, text }) => ({ ts, text })), mentions };
}

const day = (ts) => new Date(ts).toLocaleDateString('fr-FR');

/** Texte injecté dans le prompt de l'IA (vide s'il n'y a rien à se rappeler). */
export function memoryPrompt(mem, name) {
  const lines = [];
  const p = mem.profile;
  if (p) {
    lines.push(`${name} est connu(e) depuis le ${day(p.first_seen)} : ${p.messages} messages, ${p.wins} victoires, ${p.kills} éliminations`
      + (p.giftCoins ? `, ${p.giftCoins} pièces offertes${p.topGifts[0] ? ` (surtout ${p.topGifts[0].gift})` : ''}` : '') + '.');
  }
  if (mem.relevant.length) lines.push('Souvenirs liés à ce qu\'il/elle dit : ' + mem.relevant.map((r) => `« ${r.text} » (${day(r.ts)})`).join(' ; '));
  for (const m of mem.mentions) {
    lines.push(`Tu connais aussi ${m.name} (${m.wins} victoires, ${m.kills} éliminations)` + (m.messages.length ? ` ; il/elle a dit : ${m.messages.map((x) => `« ${x.text} »`).join(' ; ')}` : '') + '.');
  }
  return lines.length ? 'MÉMOIRE (faits réels tirés de l\'historique, utilise-les naturellement, ex. « tu m\'avais dit que… », sans rien inventer) :\n' + lines.join('\n') : '';
}

// Filtre de contenu : tout ce qui est affiché, envoyé à l'IA ou lu à voix haute passe par ici.

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', $: 's', '@': 'a', '!': 'i' };

/** minuscules, sans accents, leet décodé : "C0nn4rd" -> "connard" */
export function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[013457$@!]/g, (c) => LEET[c]);
}

const BAD = {
  insulte: ['connard', 'connasse', 'salope', 'pute', 'encule', 'enfoire', 'fdp', 'ntm', 'nique', 'batard', 'merde', 'debile', 'abruti', 'ordure', 'trouduc'],
  haine: ['negre', 'bougnoule', 'youpin', 'sale arabe', 'sale noir', 'sale juif', 'pede', 'tapette', 'sale blanc', 'nazi', 'hitler'],
  sexuel: ['sexe', 'bite', 'chatte', 'porno', 'nudes', 'nude', 'seins', 'onlyfans'],
  violence: ['te tuer', 'te viole', 'tue toi', 'suicide', 'kys', 'va mourir', 'je vais te frapper', 'egorger'],
  arnaque: ['snap', 'insta', 'whatsapp', 'telegram', 'cashapp', 'paypal', 'iban', 'crypto', 'bitcoin', 'gratuit sur', 'follow4follow', 'sub4sub'],
};
// l'IA ne doit jamais mettre la pression pour obtenir des cadeaux
const PRESSURE = [/sinon.{0,25}(ban|bann|signal|poursui|police|plainte)/, /(donne|envoie|offre|paie|paye).{0,40}(sinon|ou je)/,
  /(sois|devi?ens).{0,15}(mon|ma) (chouchou|prefere)/, /(m'?evite|eviter|evitez|evites)\s+(un |le |les )?(ban|bann|signalement)/, /(ou je (te|vous) )(signale|bannis)/];

const URL_RE = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|fr|net|org|io|ly|me|gg|tv)\b\S*/gi;
const MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE_RE = /(\+?\d[\d .-]{8,}\d)/g;

/** @returns {{ ok: boolean, reason?: string, text: string }} text = version nettoyée (liens/mails/numéros retirés) */
export function check(input) {
  const raw = String(input ?? '');
  const text = raw.replace(MAIL_RE, '').replace(URL_RE, '').replace(PHONE_RE, '').replace(/\s+/g, ' ').trim();
  if (text !== raw.replace(/\s+/g, ' ').trim()) return { ok: false, reason: 'données perso / lien', text };
  const n = normalize(text);
  const squashed = n.replace(/[^a-z]/g, ''); // "c.o.n.n.a.r.d" / "c o n n a r d"
  const words = ` ${n.replace(/[^a-z]+/g, ' ')} `;
  for (const [reason, list] of Object.entries(BAD)) {
    for (const w of list) {
      const hit = w.length <= 5 ? words.includes(` ${w} `) : words.includes(w) || squashed.includes(w.replace(/ /g, ''));
      if (hit) return { ok: false, reason, text };
    }
  }
  if (PRESSURE.some((re) => re.test(n))) return { ok: false, reason: 'pression', text };
  return { ok: true, text };
}

/** Pseudo affichable : sinon nom neutre. */
export function safeName(name, fallback = 'Gladiateur') {
  const n = String(name ?? '').trim().slice(0, 30);
  return n && check(n).ok ? n : fallback;
}

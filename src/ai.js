import { EventEmitter } from 'node:events';
import { config, POWERS } from './config.js';

const PERSONA = `Tu es MAXIMUS, le commentateur de l'Arène des viewers, un live TikTok où les viewers deviennent des gladiateurs.
Style : énergique, drôle, un peu arrogant, comme un commentateur de combat. Français, 1 à 2 phrases courtes (max 220 caractères), pas de markdown, 1 emoji max.
Tu te souviens de ce que les viewers t'ont dit (historique fourni). Tu remercies les gros donateurs par leur pseudo, tu réponds aux questions du chat, tu commentes l'action.
Règles du jeu : un cadeau = un pouvoir au départ (${POWERS.map((p) => `${p.label} ${p.min}+ pièces : ${p.desc}`).join(' ; ')}). Un like = soin. 300 likes = pluie de cœurs qui soigne tout le monde. Commentaire = inscription au prochain round.
N'invente jamais de résultat de combat : utilise uniquement les faits fournis.`;

/** Appel Ollama (Gemma). Renvoie null si indisponible -> fallback texte. */
export async function ollamaChat(messages, { signal } = {}) {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.ollamaModel, messages, stream: false,
      options: { temperature: 0.9, num_predict: 90 } }),
    signal: signal ?? AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  return (json.message?.content ?? '').trim();
}

const FALLBACK = {
  kill: (e) => (e.killer ? `${e.killer} envoie ${e.victim} au tapis ! Plus que ${e.left} debout !` : `${e.victim} tombe, il en reste ${e.left} !`),
  finalDuel: (e) => `DUEL FINAL : ${e.a} contre ${e.b} ! Qui va tenir ?`,
  roundEnd: (e) => (e.winner ? `${e.winner} gagne la manche avec ${e.kills} éliminations !` : 'Personne ne survit... égalité !'),
  gift: (e) => `Merci ${e.name} pour le cadeau, ${e.power ? 'pouvoir ' + e.power + ' activé' : 'respect'} !`,
  heartRain: () => 'PLUIE DE CŒURS ! Tout le monde récupère de la vie !',
  fightStart: (e) => `Que le combat commence ! ${e.players} gladiateurs dans l'arène !`,
  lightning: (e) => `${e.name} déclenche la FOUDRE sur l'arène !`,
  meteors: (e) => `${e.name} fait pleuvoir les météores !`,
  shieldSave: (e) => `${e.name} revient d'entre les morts grâce à son bouclier !`,
  lobby: () => "Nouveau round ! Écris un commentaire ou envoie un cadeau pour entrer dans l'arène !",
};

/**
 * Le "cerveau" : écoute le jeu, décide quand parler, garde la mémoire (SQLite),
 * répond au chat (questions + top donateurs) et commente l'action.
 * Émet 'say' { text, kind, to? }.
 */
export class Brain extends EventEmitter {
  constructor(arena, db, { llm = ollamaChat, minGapMs = 5000 } = {}) {
    super();
    this.arena = arena;
    this.db = db;
    this.llm = llm;
    this.minGapMs = minGapMs;
    this.lastSay = 0;
    this.busy = false;
    this.queue = []; // { prio, run }
    this.lastReplyTo = new Map();
    this.pendingKills = [];
    arena.on('evt', (e) => this.onEvent(e));
    this.timer = setInterval(() => this.drain(), 1000);
  }

  stop() { clearInterval(this.timer); }

  isTopDonor(id) {
    return this.db.topDonors(3).some((d) => d.id === id);
  }

  onEvent(e) {
    switch (e.type) {
      case 'chat': {
        const isQuestion = /\?|maximus|@ia/i.test(e.text);
        const vip = this.isTopDonor(e.id);
        const cool = Date.now() - (this.lastReplyTo.get(e.id) ?? 0) > 20000;
        if ((isQuestion || vip) && cool) {
          this.lastReplyTo.set(e.id, Date.now());
          this.enqueue(isQuestion ? 3 : 2, () => this.replyToChat(e, vip));
        }
        break;
      }
      case 'gift': if (e.coins >= 10) this.enqueue(2, () => this.narrate(e)); break;
      case 'kill': this.pendingKills.push(e); break; // regroupés pour ne pas spammer
      case 'finalDuel': case 'roundEnd': case 'fightStart': case 'heartRain':
      case 'lightning': case 'meteors': case 'shieldSave': case 'lobby':
        this.enqueue(e.type === 'roundEnd' || e.type === 'finalDuel' ? 4 : 1, () => this.narrate(e));
        break;
    }
  }

  enqueue(prio, run) {
    this.queue.push({ prio, run, ts: Date.now() });
    this.queue = this.queue.filter((q) => Date.now() - q.ts < 30000).sort((a, b) => b.prio - a.prio).slice(0, 8);
  }

  async drain() {
    if (this.busy || Date.now() - this.lastSay < this.minGapMs) return;
    if (!this.queue.length && this.pendingKills.length >= 2) {
      const kills = this.pendingKills.splice(0);
      this.enqueue(1, () => this.narrate({ type: 'kills', kills }));
    }
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try { await job.run(); } catch (err) { this.emit('error', err); } finally { this.busy = false; }
  }

  context() {
    const s = this.arena.snapshot();
    const alive = s.players.filter((p) => p.alive);
    return `Round ${s.round}, phase ${s.phase}, ${alive.length}/${s.players.length} gladiateurs en vie. `
      + `Top donateurs : ${s.donors.map((d) => `${d.name} (${d.coins})`).join(', ') || 'aucun'}. `
      + `Meilleurs : ${s.leaderboard.slice(0, 3).map((u) => `${u.name} (${u.wins} victoires)`).join(', ') || 'aucun'}.`;
  }

  describe(e) {
    if (e.type === 'kills') return 'Éliminations récentes : ' + e.kills.map((k) => `${k.killer ?? 'la tempête'} a éliminé ${k.victim}`).join(' ; ') + `. Il reste ${e.kills.at(-1).left} joueurs.`;
    return `Événement ${e.type} : ${JSON.stringify(e)}`;
  }

  async say(text, kind, to = null) {
    text = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return;
    this.lastSay = Date.now();
    if (to) this.db.saveMessage(to, 'ai', text); // mémoire : on garde ce que l'IA a dit à chaque viewer
    this.emit('say', { ts: Date.now(), text, kind, to });
  }

  async narrate(e) {
    const fb = FALLBACK[e.type]?.(e) ?? (e.type === 'kills' ? FALLBACK.kill(e.kills.at(-1)) : '');
    let text = fb;
    try {
      const out = await this.llm([
        { role: 'system', content: PERSONA },
        { role: 'user', content: `${this.context()}\n${this.describe(e)}\nCommente en une ou deux phrases.` },
      ]);
      if (out) text = out;
    } catch { /* Ollama down : fallback */ }
    await this.say(text, e.type);
  }

  async replyToChat(e, vip) {
    const history = this.db.userHistory(e.id, 8).slice(0, -1); // sans le message courant
    const user = this.db.getUser(e.id);
    const msgs = [
      { role: 'system', content: PERSONA + `\nTu parles à ${e.name}${vip ? ' (TOP DONATEUR, traite-le en VIP)' : ''}. `
        + `Ses stats : ${user?.wins ?? 0} victoires, ${user?.kills ?? 0} éliminations, ${user?.coins ?? 0} pièces offertes.` },
      { role: 'user', content: `[contexte jeu] ${this.context()}` },
      ...history.map((h) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
      { role: 'user', content: e.text },
    ];
    let text = `@${e.name} ${vip ? 'merci pour ton soutien, le roi de l\'arène !' : 'bien vu, reste dans l\'arène et tu verras !'}`;
    try {
      const out = await this.llm(msgs);
      if (out) text = `@${e.name} ${out}`;
    } catch { /* fallback */ }
    await this.say(text, 'reply', e.id);
  }
}

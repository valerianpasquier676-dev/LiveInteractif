import { EventEmitter } from 'node:events';
import { POWERS } from './config.js';
import { LlmChain } from './llm.js';

const PERSONA = `Tu es MAXIMUS, le commentateur de l'Arène des viewers, un live TikTok où les viewers deviennent des gladiateurs.
Style : énergique, drôle, un peu arrogant, comme un commentateur de combat. Français, 1 à 2 phrases courtes (max 220 caractères), pas de markdown, 1 emoji max.
Tu te souviens de ce que les viewers t'ont dit (historique fourni). Tu remercies les gros donateurs par leur pseudo, tu réponds aux questions du chat, tu commentes l'action.
Règles du jeu : un cadeau = un pouvoir au départ (${POWERS.map((p) => `${p.label} ${p.min}+ pièces : ${p.desc}`).join(' ; ')}). Un like = soin. 300 likes = pluie de cœurs qui soigne tout le monde. Commentaire = inscription au prochain round.
N'invente jamais de résultat de combat : utilise uniquement les faits fournis.`;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fill = (t, e) => t.replace(/\{(\w+)\}/g, (_, k) => e[k] ?? '');

/** Phrases pré-écrites (dernier recours si Gemma ET Groq sont indisponibles). */
export const PHRASES = {
  kill: [
    '{killer} envoie {victim} au tapis ! Il reste {left} gladiateurs debout !',
    'Aïe ! {victim} vient de goûter au sable, merci {killer} ! Plus que {left} !',
    '{killer} ne fait pas de cadeau : {victim} est éliminé ! {left} restants !',
    'Quel coup de {killer} ! {victim} quitte l\'arène !',
  ],
  killStorm: ['{victim} n\'a pas survécu à la tempête ! Il en reste {left} !', 'La tempête ne pardonne pas : adieu {victim} !'],
  kills: ['Ça tombe de partout ! Il reste {left} gladiateurs !', 'Quelle boucherie, plus que {left} debout !', 'Le sable rougit, {left} survivants !'],
  streak: ['{name} est en FEU avec {kills} éliminations !', '{name} enchaîne, {kills} victimes ! Qui l\'arrête ?'],
  carnage: ['CARNAGE ! Les gladiateurs tombent comme des mouches !', 'C\'est un massacre dans l\'arène !'],
  hazard: ['L\'arène elle-même se retourne contre vous : {kind} !', 'Attention, {kind} ! Personne n\'est à l\'abri !'],
  finalDuel: ['DUEL FINAL : {a} contre {b} ! Qui va tenir ?', 'Il n\'en reste que deux : {a} et {b} ! Le public est debout !'],
  roundEnd: ['{winner} gagne la manche avec {kills} éliminations ! Respect !', 'Victoire de {winner} ! Tu tiendrais combien de temps, toi ?'],
  roundEndNone: ['Personne ne survit... égalité dans le sang !'],
  gift: ['Merci {name} pour le cadeau, {power} activé ! Le public t\'adore !', '{name} régale l\'arène, merci ! Pouvoir {power} !', 'Un grand merci {name} ! Tu vas faire des dégâts !'],
  heartRain: ['PLUIE DE CŒURS ! Tout le monde récupère de la vie !', 'Les cœurs pleuvent, merci le public ! Soin pour tous !'],
  fightStart: ['Que le combat commence ! {players} gladiateurs dans l\'arène !', 'Les portes s\'ouvrent ! {players} combattants, un seul survivant !'],
  lightning: ['{name} déclenche la FOUDRE sur l\'arène !', 'La foudre de {name} frappe tout le monde !'],
  meteors: ['{name} fait pleuvoir les météores ! Courez !', 'Météores de {name} ! Quelle puissance !'],
  shieldSave: ['{name} revient d\'entre les morts grâce à son bouclier !', 'Le bouclier de {name} le sauve in extremis !'],
  lobby: ['Nouveau round ! Écris un commentaire ou envoie un cadeau pour entrer dans l\'arène !', 'Les inscriptions sont ouvertes ! Un commentaire et tu es gladiateur !'],
  replyVip: ['@{name} merci pour ton soutien, le roi de l\'arène !', '@{name} notre VIP ! Tout le public te remercie !'],
  reply: ['@{name} bien vu ! Reste dans l\'arène et tu verras !', '@{name} bonne question ! Envoie un cadeau pour un pouvoir et prouve-le !', '@{name} je t\'ai à l\'œil, gladiateur !'],
};

/**
 * Le "cerveau" : écoute le jeu, décide quand parler, garde la mémoire (SQLite),
 * répond au chat (questions + top donateurs) et commente l'action.
 * Émet 'say' { text, kind, to?, provider }.
 */
export class Brain extends EventEmitter {
  /** llm : une LlmChain, ou une simple fonction (messages) => texte (tests). */
  constructor(arena, db, { llm = new LlmChain(), minGapMs = 5000 } = {}) {
    super();
    this.arena = arena;
    this.db = db;
    this.chain = typeof llm === 'function' ? { chat: llm, last: null, noteFallback() { this.last = 'phrases'; } } : llm;
    this.minGapMs = minGapMs;
    this.lastSay = 0;
    this.busy = false;
    this.queue = [];
    this.lastReplyTo = new Map();
    this.pendingKills = [];
    this.stats = { said: 0, replies: 0 };
    arena.on('evt', (e) => this.onEvent(e));
    this.timer = setInterval(() => this.drain(), 1000);
  }

  stop() { clearInterval(this.timer); }

  isTopDonor(id) { return this.db.topDonors(3).some((d) => d.id === id); }

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
      case 'finalDuel': case 'roundEnd': this.enqueue(4, () => this.narrate(e)); break;
      case 'carnage': case 'streak': case 'hazard': this.enqueue(2, () => this.narrate(e)); break;
      case 'fightStart': case 'heartRain': case 'lightning': case 'meteors': case 'shieldSave': case 'lobby':
        this.enqueue(1, () => this.narrate(e));
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

  phrase(e) {
    let key = e.type;
    let data = e;
    if (e.type === 'kills') data = { left: e.kills.at(-1).left };
    else if (e.type === 'kill' && !e.killer) key = 'killStorm';
    else if (e.type === 'roundEnd' && !e.winner) key = 'roundEndNone';
    return fill(pick(PHRASES[key] ?? ['']), data);
  }

  say(text, kind, to = null) {
    text = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return;
    this.lastSay = Date.now();
    this.stats.said++;
    if (to) this.db.saveMessage(to, 'ai', text); // mémoire : ce que l'IA a dit à chaque viewer
    this.emit('say', { ts: Date.now(), text, kind, to, provider: this.chain.last });
  }

  async ask(messages, fallback) {
    try {
      const out = await this.chain.chat(messages);
      if (out) return out;
    } catch { /* Gemma et Groq indisponibles */ }
    this.chain.noteFallback?.();
    return fallback;
  }

  async narrate(e) {
    const text = await this.ask([
      { role: 'system', content: PERSONA },
      { role: 'user', content: `${this.context()}\n${this.describe(e)}\nCommente en une ou deux phrases.` },
    ], this.phrase(e));
    this.say(text, e.type);
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
    const fb = fill(pick(vip ? PHRASES.replyVip : PHRASES.reply), { name: e.name });
    const out = await this.ask(msgs, null);
    this.stats.replies++;
    this.say(out ? `@${e.name} ${out}` : fb, 'reply', e.id);
  }
}

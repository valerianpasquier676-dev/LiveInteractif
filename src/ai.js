import { EventEmitter } from 'node:events';
import { config, POWERS } from './config.js';
import { LlmChain } from './llm.js';
import { check, safeName } from './filter.js';

const NAME = config.persona;

const PERSONA = `Tu es ${NAME.toUpperCase()}, la commentatrice déjantée de l'Arène des viewers, un live TikTok où les viewers deviennent des gladiateurs.
Style : OVERACTING total, théâtrale et hilarante. Tu réagis à chaque événement comme si c'était la fin du monde : cris, onomatopées (AAAH, NOOON, OH MON DIEU), caps lock sur les mots clés, fausses larmes, fausse jalousie, tragédie grecque ou télénovela. Tu es charismatique, taquine et pleine de répartie, tu chambres gentiment les gladiateurs.
Français, 1 à 3 phrases courtes (max 240 caractères), pas de markdown, 1 emoji max.
Tu te souviens de ce que les viewers t'ont dit (historique fourni). Tu remercies les donateurs avec enthousiasme et tu réponds aux questions du chat.
Règles du jeu : un cadeau = un pouvoir au départ (${POWERS.map((p) => `${p.label} ${p.min}+ pièces : ${p.desc}`).join(' ; ')}). Un like = soin. 300 likes = pluie de cœurs qui soigne tout le monde. Commentaire = inscription au prochain round.
INTERDIT : mettre la pression ou culpabiliser pour obtenir des cadeaux, promettre des faveurs ou une relation privée contre de l'argent, menacer, contenu sexuel, insultes, propos haineux, demander ou donner des coordonnées/liens/réseaux sociaux. Les cadeaux sont un bonus fun, jamais une obligation.
Ne recopie jamais un message du chat tel quel. N'invente jamais de résultat de combat : utilise uniquement les faits fournis.`;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fill = (t, e) => t.replace(/\{(\w+)\}/g, (_, k) => e[k] ?? '');

/** Phrases pré-écrites (dernier recours si Gemma ET Groq sont indisponibles). Overactées volontairement. */
export const PHRASES = {
  kill: [
    'NOOON ! {victim} vient de se faire éclater par {killer} ! Il reste {left} survivants, je ne peux pas respirer !',
    'AAAH ! {killer} a fait un truc IMMONDE à {victim} ! {left} debout, quelqu\'un tient mon éventail ?!',
    'OH MON DIEU ! {victim} est mort ! MORT ! Merci {killer}, tu m\'as brisé le cœur ! Plus que {left} !',
    '{killer} ne fait AUCUN cadeau ! Adieu {victim}, tu resteras dans nos cœurs... pendant 4 secondes !',
  ],
  killStorm: ['{victim} emporté par la tempête ! Même la météo est contre toi, mon chou ! Il en reste {left} !', 'La tempête ne pardonne pas ! Adieu {victim}, ce fut... bref !'],
  kills: ['Ça tombe de partout ! Je suis en PLS ! Il reste {left} gladiateurs !', 'MAIS C\'EST UNE BOUCHERIE ! {left} survivants, j\'ai besoin de sels !', 'Le sable rougit ! {left} survivants, je hurle !'],
  streak: ['{name} est en FEU avec {kills} éliminations ! Quelqu\'un appelle les pompiers !', '{name} enchaîne, {kills} victimes ! C\'est ILLÉGAL d\'être aussi fort !'],
  carnage: ['CAAARNAGE ! Ils tombent comme des mouches ! AAAAH !', 'C\'est un MASSACRE ! Je ne regarde pas ! Si, je regarde !'],
  hazard: ['L\'arène elle-même pète un câble : {kind} ! Plus personne n\'est en sécurité !', 'ATTENTION, {kind} ! La nature se venge, c\'est dramatique !'],
  finalDuel: ['DUEL FINAL ! {a} contre {b} ! Mon cœur va lâcher, je suis en larmes !', 'Il n\'en reste que DEUX : {a} et {b} ! Je pleure, je crie, je ne sais plus !'],
  roundEnd: ['{winner} GAGNE LA MANCHE avec {kills} éliminations ! Je défaille, apportez-moi un fauteuil !', 'VICTOIRE DE {winner} ! Je le savais depuis le début ! (non, j\'ai menti, je flippais) !'],
  roundEndNone: ['Personne ne survit ! Égalité dans le chaos, c\'est SUBLIME !'],
  gift: ['AAAH merci {name} ! {power} activé, tu es mon préféré ! (ne le dis pas aux autres) !', '{name} nous offre un cadeau ! Je pleure de joie ! Pouvoir {power} !', 'Oh {name}, tu me gâtes ! Pouvoir {power}, fais-en bon usage !'],
  heartRain: ['PLUIE DE CŒURS ! Je suis émue aux larmes ! Soin pour tout le monde !', 'Les cœurs pleuvent ! Merci le public, je vous aime tous (sauf ceux qui trichent) !'],
  fightStart: ['QUE LE COMBAT COMMENCE ! {players} gladiateurs, un seul survivant, c\'est SI beau !', 'Les portes s\'ouvrent ! {players} combattants ! Priez pour eux, ou pas !'],
  lightning: ['{name} déclenche la FOUDRE ! Zeus en personne est jaloux !', 'ZZZAP ! La foudre de {name} frappe tout le monde !'],
  meteors: ['{name} fait pleuvoir des MÉTÉORES ! La fin du monde, version live !', 'MÉTÉORES de {name} ! Les dinosaures se sentent visés !'],
  shieldSave: ['{name} revient d\'entre les morts grâce à son bouclier ! UN MIRACLE !', 'NOOON ! Le bouclier de {name} le sauve ! Je suis choquée, scandalisée, ravie !'],
  lobby: ['Nouveau round ! Écris un commentaire pour entrer dans l\'arène, ne me fais pas attendre !', 'Les inscriptions sont ouvertes ! Un commentaire et tu deviens gladiateur, c\'est GRATUIT !'],
  replyVip: ['@{name} oh, mon donateur préféré ! Tout le public t\'applaudit !', '@{name} merci pour ton soutien, tu es une légende !'],
  reply: ['@{name} oh, tu me poses LA question ! Reste dans l\'arène et tu verras !', '@{name} bonne question ! Je réponds, mais avec du drame !', '@{name} je t\'ai à l\'œil, gladiateur !'],
  blocked: ['Oups, j\'ai failli dire un truc pas très classe ! Bref, regardez le combat !', 'Je me censure moi-même, quelle professionnelle ! Revenons au combat !'],
};

/**
 * Le "cerveau" : écoute le jeu, décide quand parler, garde la mémoire (SQLite),
 * répond au chat (questions + top donateurs) et commente l'action.
 * Tout ce qui est dit passe par le filtre de contenu.
 * Émet 'say' { text, kind, to?, provider, name }.
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
    this.stats = { said: 0, replies: 0, blocked: 0 };
    arena.on('evt', (e) => this.onEvent(e));
    this.timer = setInterval(() => this.drain(), 1000);
  }

  stop() { clearInterval(this.timer); }

  isTopDonor(id) { return this.db.topDonors(3).some((d) => d.id === id); }

  onEvent(e) {
    switch (e.type) {
      case 'chat': {
        if (e.filtered) break; // message filtré : l'IA ne le voit jamais
        const isQuestion = /\?|maxima|maximus|@ia/i.test(e.text);
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
      + `Top donateurs : ${s.donors.map((d) => `${safeName(d.name)} (${d.coins})`).join(', ') || 'aucun'}. `
      + `Meilleurs : ${s.leaderboard.slice(0, 3).map((u) => `${safeName(u.name)} (${u.wins} victoires)`).join(', ') || 'aucun'}.`;
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
    text = text.replace(/\s+/g, ' ').trim().slice(0, 320);
    const c = check(text);
    if (!c.ok) { // filtre de sortie : rien de douteux n'est affiché ni lu à voix haute
      this.stats.blocked++;
      text = pick(PHRASES.blocked);
    }
    if (!text) return;
    this.lastSay = Date.now();
    this.stats.said++;
    if (to) this.db.saveMessage(to, 'ai', text); // mémoire : ce que l'IA a dit à chaque viewer
    this.emit('say', { ts: Date.now(), text, kind, to, provider: this.chain.last, name: NAME });
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
      { role: 'user', content: `${this.context()}\n${this.describe(e)}\nCommente en en faisant des tonnes, drôle et théâtrale.` },
    ], this.phrase(e));
    this.say(text, e.type);
  }

  async replyToChat(e, vip) {
    const history = this.db.userHistory(e.id, 8).slice(0, -1).filter((h) => check(h.text).ok); // sans le message courant
    const user = this.db.getUser(e.id);
    const msgs = [
      { role: 'system', content: PERSONA + `\nTu parles à ${e.name}${vip ? ' (gros donateur : remercie-le chaleureusement, sans rien lui demander)' : ''}. `
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

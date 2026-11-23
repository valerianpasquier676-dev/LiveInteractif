import { EventEmitter } from 'node:events';
import { config, POWERS } from './config.js';
import { LlmChain } from './llm.js';
import { check, safeName } from './filter.js';
import { buildMemory, memoryPrompt } from './memory.js';

const NAME = config.persona;

const PERSONA = `Tu es ${NAME.toUpperCase()}, la commentatrice déjantée de l'Arène des viewers, un live TikTok où les viewers deviennent des gladiateurs.
Style : KAWAII, mignonne, pétillante et pleine d'énergie, avec de l'OVERACTING total, théâtrale et hilarante. Tu as de temps en temps un petit mot mignon (hihi, kyaa, nyaa, owo) mais sans en abuser, et tu appelles les viewers « gladiateurs » ou « chouchous ». Tu réagis à chaque événement comme si c'était la fin du monde : cris, onomatopées (AAAH, NOOON, OH MON DIEU), caps lock sur les mots clés, fausses larmes, fausse jalousie, tragédie grecque ou télénovela. Tu es charismatique, taquine et pleine de répartie, tu chambres gentiment les gladiateurs.
Français, 1 à 3 phrases courtes (max 240 caractères), pas de markdown, 1 emoji max.
Tu te souviens de ce que les viewers t'ont dit (historique fourni). Tu remercies les donateurs avec enthousiasme, tu réponds aux questions du chat, tu mets en avant les viewers les plus actifs (commentaires, cœurs) et tu remercies ceux qui partagent le live ou s'abonnent.
Règles du jeu : un cadeau = un pouvoir au départ (${POWERS.map((p) => `${p.label} ${p.min}+ pièces : ${p.desc}`).join(' ; ')}). Un like = soin. 300 likes = pluie de cœurs qui soigne tout le monde. Commentaire = inscription au prochain round.
INTERDIT : mettre la pression ou culpabiliser pour obtenir des cadeaux, promettre des faveurs ou une relation privée contre de l'argent, promettre quoi que ce soit en échange d'un partage, d'un abonnement ou d'un like, menacer, contenu sexuel, insultes, propos haineux, demander ou donner des coordonnées/liens/réseaux sociaux. Les cadeaux sont un bonus fun, jamais une obligation.
Ne recopie jamais un message du chat tel quel. N'invente jamais de résultat de combat : utilise uniquement les faits fournis.`;

// noms d'événements en français pour l'IA (sinon elle lit « heartRain » tel quel à l'antenne)
const EVENT_LABEL = {
  gift: 'cadeau reçu', heartRain: 'pluie de cœurs, tout le monde est soigné', fightStart: 'début du combat', finalDuel: 'duel final',
  roundEnd: 'fin de la manche', lobby: 'inscriptions ouvertes pour le prochain round', bossSpawn: 'le Titan (boss) arrive',
  bossDown: 'le Titan est vaincu', bossLeave: 'le Titan repart', lightning: 'foudre sur toute l\'arène', meteors: 'pluie de météores',
  shieldSave: 'un bouclier sauve un gladiateur', carnage: 'carnage, plein d\'éliminations d\'un coup', streak: 'série d\'éliminations',
  hazard: 'catastrophe dans l\'arène', kill: 'élimination',
};
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
  bossSpawn: ['LE TITAN ARRIVE ! Le sol tremble, je tremble, tout tremble ! Unissez-vous, gladiateurs !', 'OH NON, UN BOSS ! Le Titan débarque ! Ça va être une boucherie, je suis ravie !'],
  bossDown: ['LE TITAN EST TOMBÉ ! {mvp} lui a infligé le plus de dégâts, quel héros ! Je pleure !', 'VICTOIRE CONTRE LE TITAN ! Bravo {mvp}, tu es un monstre toi-même !'],
  bossLeave: ['Le Titan s\'en va, vexé ! Il reviendra, avec des snacks et de la rancune !'],
  killBoss: ['Le Titan écrase {victim} ! Une crêpe de gladiateur, à emporter !', 'BOUM ! {victim} a goûté au poing du Titan ! Il reste {left} !'],
  idle: [
    "Hihi, ça manque de monde dans l'arène ! Écris un petit commentaire et tu deviens gladiateur, c'est tout simple !",
    "Coucou les chouchous ! Un commentaire = une place dans l'arène, venez tenter votre chance, kyaa !",
    'Psst, tu sais que chaque like soigne les gladiateurs ? Allez, un petit cœur pour la bonne cause !',
    'Dis-moi en commentaire qui va gagner le prochain round, je note tout, hihi !',
    "Les gladiateurs s'impatientent ! Écris ton pseudo en commentaire et rejoins le combat !",
  ],
  blocked: ['Oups, j\'ai failli dire un truc pas très classe ! Bref, regardez le combat !', 'Je me censure moi-même, quelle professionnelle ! Revenons au combat !'],
  // viewers les plus actifs, partages / abonnements, invitation à partager (jamais rien promis en échange : règles TikTok)
  replyFan: ['@{name} toi, tu es PARTOUT dans ce live et j\'adore ça ! Merci d\'être là, chouchou !', '@{name} mon fidèle gladiateur ! Ta présence me fait fondre, hihi !'],
  shoutoutBoth: ['Mention spéciale à {chatter}, la pipelette du live avec {nc} commentaires, et à {liker} qui nous a envoyé {nl} cœurs ! Je vous ADORE !'],
  shoutoutChat: ['Gros bisou à {chatter} qui fait vivre le chat comme personne : {nc} commentaires ! Tu es mon chouchou officiel !'],
  shoutoutLike: ['{liker} nous a envoyé {nl} cœurs ! Mon petit cœur déborde, merci merci MERCI !'],
  socialShare: ['Merci {names} pour le partage ! Vous ramenez du monde dans l\'arène, je vous aime !', 'AAAH {names} a partagé le live ! Plus on est de fous, plus ça tape fort, merci !'],
  socialFollow: ['Bienvenue dans la famille {names}, merci pour l\'abonnement, kyaa !', '{names} s\'abonne ! Je suis émue, tu ne rateras plus aucun combat !'],
  promo: [
    "Si tu t'amuses dans l'arène, partage le live à tes potes : plus on est de fous, plus ça tape fort, hihi !",
    'Abonne-toi pour ne rater aucun combat, les chouchous, je vous attends à chaque round !',
    "Psst, envoie le live à ton meilleur ami et viens le défier dans l'arène, ça va être ÉPIQUE !",
  ],
};

/**
 * Le "cerveau" : écoute le jeu, décide quand parler, garde la mémoire (SQLite),
 * répond au chat (questions + top donateurs) et commente l'action.
 * Tout ce qui est dit passe par le filtre de contenu.
 * Émet 'say' { text, kind, to?, provider, name }.
 */
export class Brain extends EventEmitter {
  /** llm : une LlmChain, ou une simple fonction (messages) => texte (tests). */
  constructor(arena, db, { llm = new LlmChain(), minGapMs = 3500, idleMs = 35000, narrateDeadlineMs = 3500, replyDeadlineMs = 7000 } = {}) {
    super();
    this.arena = arena;
    this.db = db;
    this.chain = typeof llm === 'function' ? { chat: llm, last: null, noteFallback() { this.last = 'phrases'; } } : llm;
    this.minGapMs = minGapMs;
    this.idleMs = idleMs;
    this.idleEnabled = true;
    // Au-delà de ces délais on ne fait PAS attendre l'antenne : phrase pré-écrite tout de suite (l'IA lente est ignorée)
    this.narrateDeadlineMs = narrateDeadlineMs;
    this.replyDeadlineMs = replyDeadlineMs;
    this.lastSay = 0;
    this.busy = false;
    this.queue = [];
    this.lastReplyTo = new Map();
    this.pendingKills = [];
    this.pendingSocial = []; // partages / abonnements, regroupés en un seul « merci »
    this.replyStreak = 0; // réponses au chat d'affilée (voir drain)
    this.shoutoutMs = 3 * 60000; // mention spéciale aux viewers les plus actifs
    this.promoMs = 5 * 60000; // invitation à partager / s'abonner
    this.lastShoutout = this.lastPromo = Date.now();
    this.stats = { said: 0, replies: 0, blocked: 0 };
    arena.on('evt', (e) => this.onEvent(e));
    this.timer = setInterval(() => { this.drain(); this.idleCheck(); this.socialCheck(); }, 250); // 4x/s : pas d'attente inutile entre deux répliques
  }

  stop() { clearInterval(this.timer); }

  /** Réglages modifiables en direct depuis le backstage (src/settings.js). */
  applySettings(s) {
    this.minGapMs = s.minGapSeconds * 1000;
    this.idleMs = s.idleSeconds * 1000;
    this.idleEnabled = !!s.idleChat;
    this.shoutoutMs = (s.shoutoutMinutes ?? 3) * 60000; // 0 = jamais
    this.promoMs = (s.promoMinutes ?? 5) * 60000;
  }

  /** Viewer parmi les plus actifs de la session (top 3 commentaires ou top 3 cœurs) ? -> ses compteurs, sinon null. */
  fanOf(id) {
    const top = this.arena.topFans('chats', 3, 3).some((f) => f.id === id) || this.arena.topFans('likes', 3, 30).some((f) => f.id === id);
    if (!top) return null;
    const f = this.arena.fans.get(id);
    return { chats: f.chats, likes: f.likes };
  }

  /**
   * De temps en temps (réglable dans le backstage) : mention spéciale aux viewers les plus actifs, et invitation à
   * partager le live / s'abonner. Priorité basse, mais elles passent même quand le chat est très actif (voir drain).
   */
  socialCheck(now = Date.now()) {
    if (this.arena.phase === 'ended' || this.queue.some((q) => q.kind === 'shoutout' || q.kind === 'promo')) return;
    if (this.shoutoutMs > 0 && now - this.lastShoutout >= this.shoutoutMs) {
      this.lastShoutout = now;
      const c = this.arena.topFans('chats', 1, 3)[0], l = this.arena.topFans('likes', 1, 30)[0];
      if (c || l) {
        this.enqueue(1, () => this.narrate({ type: 'shoutout', chatter: c && { name: c.name, n: c.chats }, liker: l && { name: l.name, n: l.likes } }), 60000, 'shoutout');
        return;
      }
    }
    if (this.promoMs > 0 && now - this.lastPromo >= this.promoMs) {
      this.lastPromo = now;
      this.enqueue(1, () => this.narrate({ type: 'promo' }), 60000, 'promo');
    }
  }

  /** Si personne n'a rien dit depuis un moment, une petite relance dynamique (inviter à commenter / liker). */
  idleCheck() {
    if (!this.idleEnabled || this.busy || this.queue.length || Date.now() - this.lastSay < this.idleMs) return;
    if (this.arena.phase === 'ended') return;
    this.enqueue(1, () => this.narrate({ type: 'idle', phase: this.arena.phase }));
  }

  isTopDonor(id) { return this.db.topDonors(3).some((d) => d.id === id); }

  onEvent(e) {
    switch (e.type) {
      case 'chat': {
        if (e.filtered) break; // message filtré : l'IA ne le voit jamais
        const isQuestion = /\?|maxima|maximus|@ia/i.test(e.text);
        const vip = this.isTopDonor(e.id);
        // les viewers les plus actifs (commentaires, cœurs) ont aussi droit à une réponse, mais moins souvent
        const fan = isQuestion || vip ? null : this.fanOf(e.id);
        const cool = Date.now() - (this.lastReplyTo.get(e.id) ?? 0) > (fan ? 60000 : 20000);
        // au plus 3 réponses en attente : au-delà, la réponse arriverait trop tard (et l'action ne passerait plus)
        const room = this.queue.filter((q) => q.kind === 'reply').length < 3;
        if ((isQuestion || vip || fan) && cool && room) {
          this.lastReplyTo.set(e.id, Date.now());
          this.enqueue(isQuestion ? 3 : 2, () => this.replyToChat(e, vip, fan), 25000, 'reply'); // une réponse au chat reste valable plus longtemps
        }
        break;
      }
      case 'share': case 'follow': this.pendingSocial.push(e); break;
      case 'gift': if (e.coins >= 10) this.enqueue(2, () => this.narrate(e)); break;
      case 'kill': this.pendingKills.push(e); break; // regroupés pour ne pas spammer
      case 'finalDuel': case 'roundEnd': this.enqueue(4, () => this.narrate(e)); break;
      case 'bossSpawn': case 'bossDown': this.enqueue(4, () => this.narrate(e)); break;
      case 'bossLeave': this.enqueue(1, () => this.narrate(e)); break;
      case 'carnage': case 'streak': case 'hazard': this.enqueue(2, () => this.narrate(e)); break;
      case 'fightStart': case 'heartRain': case 'lightning': case 'meteors': case 'shieldSave': case 'lobby':
        this.enqueue(1, () => this.narrate(e));
        break;
    }
  }

  /** ttl : au-delà, la réplique est périmée (on commenterait quelque chose qui date) et elle est jetée. */
  enqueue(prio, run, ttl = 10000, kind = 'narrate') {
    this.queue.push({ prio, run, ts: Date.now(), ttl, kind });
    this.queue = this.queue.filter((q) => Date.now() - q.ts < q.ttl).sort((a, b) => b.prio - a.prio).slice(0, 8);
  }

  async drain() {
    if (this.busy || Date.now() - this.lastSay < this.minGapMs) return;
    this.queue = this.queue.filter((q) => Date.now() - q.ts < q.ttl);
    this.pendingKills = this.pendingKills.filter((k) => Date.now() - k.ts < 12000); // pas de vieilles éliminations
    if (this.pendingKills.length >= 2 && !this.queue.some((q) => q.kind === 'kills')) {
      const kills = this.pendingKills.splice(0);
      this.enqueue(1, () => this.narrate({ type: 'kills', kills }), 10000, 'kills');
    }
    // partages / abonnements : on attend 3 s pour remercier tout le monde d'un coup
    this.pendingSocial = this.pendingSocial.filter((s) => Date.now() - s.ts < 60000);
    if (this.pendingSocial.length && Date.now() - this.pendingSocial[0].ts >= 3000) {
      const list = this.pendingSocial.splice(0);
      const names = (type) => [...new Set(list.filter((s) => s.type === type).map((s) => s.name))].slice(0, 4);
      this.enqueue(2, () => this.narrate({ type: 'social', shares: names('share'), follows: names('follow') }), 20000);
    }
    if (!this.queue.length) return;
    // équilibre : au plus 2 réponses au chat d'affilée quand autre chose attend (combat, remerciements, invitations),
    // et une réplique qui attend gagne en priorité (+1 toutes les 3 s) : les éliminations ou l'invitation à partager
    // ne restent pas bloquées derrière un flot de cadeaux
    const now = Date.now(), score = (q) => q.prio + (now - q.ts) / 3000;
    const others = this.replyStreak >= 2 ? this.queue.filter((q) => q.kind !== 'reply') : [];
    const pool = others.length ? others : this.queue;
    const job = pool.reduce((best, q) => (score(q) > score(best) ? q : best));
    this.queue.splice(this.queue.indexOf(job), 1);
    this.replyStreak = job.kind === 'reply' ? this.replyStreak + 1 : 0;
    this.busy = true;
    try { await job.run(); } catch (err) { this.emit('error', err); } finally { this.busy = false; }
  }

  context() {
    const s = this.arena.snapshot();
    const alive = s.players.filter((p) => p.alive);
    const c = this.arena.topFans('chats', 1, 3)[0], l = this.arena.topFans('likes', 1, 30)[0];
    const fans = [c && `${safeName(c.name)} (${c.chats} commentaires)`, l && `${safeName(l.name)} (${l.likes} cœurs)`].filter(Boolean);
    return `Round ${s.round}, phase ${s.phase}, ${alive.length}/${s.players.length} gladiateurs en vie. `
      + `Top donateurs : ${s.donors.map((d) => `${safeName(d.name)} (${d.coins})`).join(', ') || 'aucun'}. `
      + `Meilleurs : ${s.leaderboard.slice(0, 3).map((u) => `${safeName(u.name)} (${u.wins} victoires)`).join(', ') || 'aucun'}.`
      + (fans.length ? ` Les plus actifs : ${fans.join(', ')}.` : '');
  }

  describe(e) {
    if (e.type === 'idle') return `Il y a un petit moment de calme (phase ${e.phase}). Relance l'ambiance en invitant les viewers à commenter pour entrer dans l'arène, à liker pour soigner, ou à parier sur le gagnant. Ne demande JAMAIS de cadeaux.`;
    if (e.type === 'promo') return "Petit moment pour inviter les viewers, gentiment et en une seule phrase, à partager le live à leurs amis ou à s'abonner pour ne rater aucun combat. Ne promets RIEN en échange (aucun pouvoir, aucun avantage), aucune pression, ne parle pas de cadeaux.";
    if (e.type === 'shoutout') return 'Mention spéciale aux viewers les plus actifs du live : '
      + [e.chatter && `${e.chatter.name} (le plus de commentaires : ${e.chatter.n})`, e.liker && `${e.liker.name} (le plus de cœurs envoyés : ${e.liker.n})`].filter(Boolean).join(' et ')
      + '. Nomme-les et remercie-les chaleureusement, sans rien leur demander.';
    if (e.type === 'social') return 'Remercie chaleureusement '
      + [e.shares.length && `pour le partage du live : ${e.shares.join(', ')}`, e.follows.length && `pour l'abonnement : ${e.follows.join(', ')}`].filter(Boolean).join(' ; ')
      + '. Une ou deux phrases.';
    if (e.type === 'kills') return 'Éliminations récentes : ' + e.kills.map((k) => `${k.killer ?? 'la tempête'} a éliminé ${k.victim}`).join(' ; ') + `. Il reste ${e.kills.at(-1).left} joueurs.`;
    // seulement les faits utiles (pas d'URL d'avatar ni d'image : ça gonflerait le prompt et ralentirait l'IA)
    const facts = {};
    for (const k of ['name', 'coins', 'giftName', 'power', 'victim', 'killer', 'left', 'cause', 'winner', 'kills', 'a', 'b', 'mvp', 'kind', 'players', 'hp']) if (e[k] != null) facts[k] = e[k];
    return `Événement « ${EVENT_LABEL[e.type] ?? e.type} » : ${JSON.stringify(facts)}`;
  }

  phrase(e) {
    let key = e.type;
    let data = e;
    if (e.type === 'kills') data = { left: e.kills.at(-1).left };
    else if (e.type === 'shoutout') {
      key = e.chatter && e.liker ? 'shoutoutBoth' : e.chatter ? 'shoutoutChat' : 'shoutoutLike';
      data = { chatter: e.chatter?.name, nc: e.chatter?.n, liker: e.liker?.name, nl: e.liker?.n };
    } else if (e.type === 'social') {
      key = e.shares.length ? 'socialShare' : 'socialFollow';
      data = { names: (e.shares.length ? e.shares : e.follows).join(', ') };
    }
    else if (e.type === 'kill' && e.cause === 'boss') key = 'killBoss';
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

  /** Demande à l'IA ; passé `deadlineMs` (ou si tout est en panne) on renvoie la phrase pré-écrite sans attendre. */
  async ask(messages, fallback, deadlineMs = this.narrateDeadlineMs) {
    let timer;
    try {
      const out = await Promise.race([
        this.chain.chat(messages),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('trop lent')), deadlineMs); }),
      ]);
      if (out) return out;
    } catch { /* Gemma et Groq indisponibles ou trop lents */ } finally { clearTimeout(timer); }
    this.chain.noteFallback?.();
    return fallback;
  }

  async narrate(e) {
    const text = await this.ask([
      { role: 'system', content: PERSONA },
      // l'événement d'abord, le contexte ensuite : les petits modèles (Gemma e2b) commentaient sinon le contexte au lieu de l'action
      { role: 'user', content: `À COMMENTER MAINTENANT : ${this.describe(e)}\n(Contexte, seulement si utile : ${this.context()})\nRéagis à CET événement en faisant des tonnes, mignonne, drôle et théâtrale.` },
    ], this.phrase(e));
    this.say(text, e.type);
  }

  async replyToChat(e, vip, fan = null) {
    const history = this.db.userHistory(e.id, 8).slice(0, -1).filter((h) => check(h.text).ok); // sans le message courant
    // mémoire longue : on fouille l'historique (souvenirs liés au message, viewers cités) en plus des derniers messages
    const mem = memoryPrompt(buildMemory(this.db, { id: e.id, text: e.text, exclude: [e.text, ...history.map((h) => h.text)] }), e.name);
    const msgs = [
      { role: 'system', content: PERSONA + `\nTu parles à ${e.name}${vip ? ' (gros donateur : remercie-le chaleureusement, sans rien lui demander)'
        : fan ? ` (un des viewers les plus actifs du live : ${fan.chats} commentaires, ${fan.likes} cœurs ; remercie-le pour sa présence en répondant à son message, sans rien lui demander)` : ''}.` + (mem ? '\n' + mem : '') },
      { role: 'user', content: `[contexte jeu] ${this.context()}` },
      ...history.map((h) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
      { role: 'user', content: e.text },
    ];
    const fb = fill(pick(vip ? PHRASES.replyVip : fan ? PHRASES.replyFan : PHRASES.reply), { name: e.name });
    const out = await this.ask(msgs, null, this.replyDeadlineMs);
    this.stats.replies++;
    this.say(out ? `@${e.name} ${out}` : fb, 'reply', e.id);
  }
}

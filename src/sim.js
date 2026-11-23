const NAMES = ['karim_67', 'juliette', 'hamza_59', 'nour.b', 'ilyes_k', 'lea_gaming', 'tom.d', 'yasmine', 'nathan46', 'sofia_x',
  'enzo_r', 'camille', 'bilal.p', 'manon_77', 'adam_k', 'lina', 'maxime_b', 'ines.m', 'rayan_92', 'clara'];
const COMMENTS = ['Salut tout le monde !', 'je vais gagner', 'Maximus tu tiens combien de temps ?', 'GO GO GO', 'Qui est en tête ?',
  'trop fort ce live', 'Maximus tu te souviens de moi ?', 'comment on gagne un bouclier ?', 'lol', 'allez ilyes !'];
const GIFTS = [['Rose', 1], ['Rose', 1], ['Doughnut', 30], ['Heart Me', 1], ['Lion', 29999], ['Galaxy', 1000], ['Hand Hearts', 100], ['Gem', 10]];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** Faux viewers : commentaires, likes et cadeaux aléatoires. */
export function startSimulator(arena, { intervalMs = 700 } = {}) {
  const t = setInterval(() => {
    const name = pick(NAMES);
    const r = Math.random();
    if (r < 0.35) arena.chat(name, name, pick(COMMENTS));
    else if (r < 0.86) arena.like(name, name, 1 + Math.floor(Math.random() * 8));
    else if (r < 0.88) arena.share(name, name);
    else if (r < 0.9) arena.follow(name, name);
    else {
      const [g, c] = pick(GIFTS);
      arena.gift(name, name, Math.min(c, 1200), g);
    }
  }, intervalMs);
  return () => clearInterval(t);
}

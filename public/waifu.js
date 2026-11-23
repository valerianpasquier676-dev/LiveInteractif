// Mascotte de l'arène : MAXIMA, une petite gladiatrice kawaii (personnage ORIGINAL dessiné en SVG).
// Elle cligne des yeux, regarde l'arène, bouge la bouche quand elle parle et réagit aux événements.
// Aucun asset externe : tout est dessiné ici (pas de droits d'auteur à gérer, rien à télécharger).

const SVG = `
<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg" class="wf">
  <defs>
    <linearGradient id="wfHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9ac4"/><stop offset="1" stop-color="#e0558f"/></linearGradient>
    <radialGradient id="wfIris" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#b99bff"/><stop offset=".6" stop-color="#6a4de0"/><stop offset="1" stop-color="#3b2a9a"/></radialGradient>
    <linearGradient id="wfGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#e0a21a"/></linearGradient>
  </defs>

  <g class="tail tL"><path d="M52 70 C10 90 8 170 34 215 C46 190 44 150 62 118 Z" fill="url(#wfHair)" stroke="#b83d78" stroke-width="2"/></g>
  <g class="tail tR"><path d="M148 70 C190 90 192 170 166 215 C154 190 156 150 138 118 Z" fill="url(#wfHair)" stroke="#b83d78" stroke-width="2"/></g>

  <g class="body">
    <path d="M58 250 C58 205 76 180 100 180 C124 180 142 205 142 250 Z" fill="#fff4e6" stroke="#c9a47a" stroke-width="2"/>
    <path d="M70 250 C70 214 84 192 100 192 C116 192 130 214 130 250 Z" fill="url(#wfGold)" stroke="#b07a10" stroke-width="2"/>
    <path d="M88 200 L100 224 L112 200" fill="none" stroke="#b07a10" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="100" cy="226" r="6" fill="#e0314b" stroke="#8a1a2c" stroke-width="2"/>
    <path d="M58 205 Q42 215 40 250 L62 250 Z" fill="#d83a52"/><path d="M142 205 Q158 215 160 250 L138 250 Z" fill="#d83a52"/>
    <rect x="90" y="166" width="20" height="20" rx="8" fill="#ffe0cc"/>
  </g>

  <g class="head">
    <path d="M44 104 C40 60 70 38 100 38 C130 38 160 60 156 104 C156 140 138 150 100 150 C62 150 44 140 44 104 Z" fill="url(#wfHair)" stroke="#b83d78" stroke-width="2"/>
    <ellipse cx="100" cy="110" rx="52" ry="48" fill="#ffe3d1" stroke="#e0a98c" stroke-width="2"/>
    <ellipse cx="68" cy="128" rx="11" ry="6.5" fill="#ff9fb4" opacity=".55"/><ellipse cx="132" cy="128" rx="11" ry="6.5" fill="#ff9fb4" opacity=".55"/>

    <g class="eyes">
      <!-- yeux normaux -->
      <g class="eye-normal">
        <g transform="translate(78 112)"><ellipse rx="15" ry="19" fill="#fff" stroke="#3a2a4a" stroke-width="2.5"/><g class="iris"><circle r="11.5" cy="1" fill="url(#wfIris)"/><circle r="5.2" cy="1" fill="#1b1033"/></g><circle cx="-4.5" cy="-6" r="4" fill="#fff"/><circle cx="4" cy="5" r="2" fill="#fff" opacity=".85"/></g>
        <g transform="translate(122 112)"><ellipse rx="15" ry="19" fill="#fff" stroke="#3a2a4a" stroke-width="2.5"/><g class="iris"><circle r="11.5" cy="1" fill="url(#wfIris)"/><circle r="5.2" cy="1" fill="#1b1033"/></g><circle cx="-4.5" cy="-6" r="4" fill="#fff"/><circle cx="4" cy="5" r="2" fill="#fff" opacity=".85"/></g>
      </g>
      <!-- choc : yeux grands, pupilles minuscules -->
      <g class="eye-shock">
        <g transform="translate(78 111)"><ellipse rx="17" ry="22" fill="#fff" stroke="#3a2a4a" stroke-width="2.5"/><circle r="5" fill="#1b1033"/></g>
        <g transform="translate(122 111)"><ellipse rx="17" ry="22" fill="#fff" stroke="#3a2a4a" stroke-width="2.5"/><circle r="5" fill="#1b1033"/></g>
      </g>
      <!-- content : ^ ^ -->
      <g class="eye-happy" fill="none" stroke="#3a2a4a" stroke-width="5" stroke-linecap="round"><path d="M62 116 Q78 94 94 116"/><path d="M106 116 Q122 94 138 116"/></g>
      <!-- coeurs -->
      <g class="eye-heart" fill="#ff3d79" stroke="#a31a4a" stroke-width="2"><path transform="translate(78 112)" d="M0 12 C-22 -4 -12 -20 0 -8 C12 -20 22 -4 0 12 Z"/><path transform="translate(122 112)" d="M0 12 C-22 -4 -12 -20 0 -8 C12 -20 22 -4 0 12 Z"/></g>
      <!-- sournois : paupières à moitié fermées -->
      <g class="eye-smug"><g transform="translate(78 114)"><ellipse rx="15" ry="12" fill="#fff" stroke="#3a2a4a" stroke-width="2.5"/><circle r="9" fill="url(#wfIris)"/><circle r="4" fill="#1b1033"/><path d="M-17 -4 Q0 -18 17 -4" fill="#ffe3d1" stroke="#3a2a4a" stroke-width="3"/></g>
        <g transform="translate(122 114)"><ellipse rx="15" ry="12" fill="#fff" stroke="#3a2a4a" stroke-width="2.5"/><circle r="9" fill="url(#wfIris)"/><circle r="4" fill="#1b1033"/><path d="M-17 -4 Q0 -18 17 -4" fill="#ffe3d1" stroke="#3a2a4a" stroke-width="3"/></g></g>
    </g>

    <g class="brows" fill="none" stroke="#b83d78" stroke-width="3.5" stroke-linecap="round"><path class="bL" d="M62 86 Q78 80 92 86"/><path class="bR" d="M108 86 Q122 80 138 86"/></g>

    <g class="mouth">
      <path class="m-closed" d="M91 137 Q100 145 109 137" fill="none" stroke="#a33a52" stroke-width="3" stroke-linecap="round"/>
      <path class="m-cat" d="M90 136 Q95 143 100 137 Q105 143 110 136" fill="none" stroke="#a33a52" stroke-width="3" stroke-linecap="round"/>
      <ellipse class="m-small" cx="100" cy="139" rx="6" ry="7" fill="#b8344e" stroke="#7a1d33" stroke-width="2"/>
      <g class="m-wide"><path d="M86 132 Q100 166 114 132 Z" fill="#b8344e" stroke="#7a1d33" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="100" cy="148" rx="8" ry="5" fill="#ff7f94"/></g>
    </g>

    <path class="sweat" d="M150 82 C142 98 156 98 150 82 Z" fill="#8fd3ff" stroke="#3f8fbf" stroke-width="2"/>
    <g class="tears" fill="#8fd3ff" stroke="#3f8fbf" stroke-width="1.5"><path d="M70 130 C62 148 78 148 70 130 Z"/><path d="M130 130 C122 148 138 148 130 130 Z"/></g>
    <g class="sparkles" fill="#fff6a8" stroke="#e0a21a" stroke-width="1.5"><path d="M30 60 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 Z"/><path d="M170 50 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z"/></g>

    <!-- mèches, accroche-cœur, bandeau de gladiatrice -->
    <path d="M48 96 C52 56 84 46 100 46 C116 46 148 56 152 96 C140 76 128 70 118 68 C108 80 90 80 82 68 C70 72 58 80 48 96 Z" fill="url(#wfHair)" stroke="#b83d78" stroke-width="2"/>
    <path class="ahoge" d="M100 46 C96 24 112 14 120 20 C110 24 108 34 106 46 Z" fill="url(#wfHair)" stroke="#b83d78" stroke-width="2"/>
    <path d="M48 70 Q100 52 152 70" fill="none" stroke="url(#wfGold)" stroke-width="9" stroke-linecap="round"/>
    <circle cx="100" cy="61" r="7" fill="#e0314b" stroke="#8a1a2c" stroke-width="2"/>
    <g fill="#7ed957" stroke="#3d8a22" stroke-width="1.5"><ellipse cx="62" cy="66" rx="9" ry="4" transform="rotate(-25 62 66)"/><ellipse cx="138" cy="66" rx="9" ry="4" transform="rotate(25 138 66)"/></g>
  </g>
</svg>`;

const CSS = `
.wf { width:100%; height:100%; overflow:visible; animation: wfBob 3.4s ease-in-out infinite; transform-origin: 50% 100%; }
.wf .tail { transform-box: fill-box; transform-origin: 50% 0; }
.wf .tL { animation: wfSwayL 3.1s ease-in-out infinite; } .wf .tR { animation: wfSwayR 3.1s ease-in-out infinite; }
.wf .head { transform-box: fill-box; transform-origin: 50% 90%; transition: transform .25s; }
.wf .ahoge { transform-box: fill-box; transform-origin: 20% 100%; animation: wfAhoge 2.2s ease-in-out infinite; }
.wf .iris { transform: translate(var(--gx, 2px), var(--gy, -1px)); transition: transform .3s; }
.wf .eyes { transform-box: fill-box; transform-origin: 50% 55%; transition: transform .08s; }
.wf.blink .eyes { transform: scaleY(.08); }
.wf .eye-shock,.wf .eye-happy,.wf .eye-heart,.wf .eye-smug,.wf .sweat,.wf .tears,.wf .sparkles,
.wf .m-cat,.wf .m-small,.wf .m-wide { display:none; }
.wf[data-exp=shock] .eye-normal,.wf[data-exp=happy] .eye-normal,.wf[data-exp=heart] .eye-normal,.wf[data-exp=smug] .eye-normal,.wf[data-exp=scared] .eye-normal { display:none; }
.wf[data-exp=shock] .eye-shock,.wf[data-exp=scared] .eye-shock { display:inline; } .wf[data-exp=happy] .eye-happy { display:inline; }
.wf[data-exp=heart] .eye-heart { display:inline; } .wf[data-exp=smug] .eye-smug { display:inline; }
.wf[data-exp=scared] .sweat,.wf[data-exp=shock] .sweat { display:inline; } .wf[data-exp=sad] .tears { display:inline; }
.wf[data-exp=happy] .sparkles,.wf[data-exp=heart] .sparkles { display:inline; animation: wfTwinkle .7s ease-in-out infinite; }
.wf[data-exp=shock] .bL,.wf[data-exp=scared] .bL { d: path("M62 78 Q78 70 92 80"); } .wf[data-exp=shock] .bR,.wf[data-exp=scared] .bR { d: path("M108 80 Q122 70 138 78"); }
.wf[data-exp=smug] .bL { d: path("M62 90 Q78 80 92 84"); } .wf[data-exp=smug] .bR { d: path("M108 84 Q122 80 138 90"); }
.wf[data-exp=sad] .bL { d: path("M62 88 Q78 82 92 78"); } .wf[data-exp=sad] .bR { d: path("M108 78 Q122 82 138 88"); }
.wf[data-exp=shock] .head { transform: rotate(-3deg); } .wf[data-exp=happy] .head,.wf[data-exp=heart] .head { transform: rotate(5deg); } .wf[data-exp=smug] .head { transform: rotate(-5deg); }
/* bouche : une forme visible à la fois */
.wf[data-m=closed] .m-closed { display:inline; } .wf[data-m=cat] .m-cat { display:inline; }
.wf[data-m=small] .m-small { display:inline; } .wf[data-m=wide] .m-wide { display:inline; }
.wf[data-m=closed] .m-small,.wf[data-m=closed] .m-wide,.wf[data-m=cat] .m-closed,.wf[data-m=small] .m-closed,.wf[data-m=wide] .m-closed { display:none; }
.wf.pop { animation: wfPop .45s cubic-bezier(.3,1.6,.5,1), wfBob 3.4s ease-in-out infinite; }
@keyframes wfBob { 0%,100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-2.5%) rotate(1.2deg); } }
@keyframes wfSwayL { 0%,100% { transform: rotate(3deg); } 50% { transform: rotate(-4deg); } }
@keyframes wfSwayR { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(4deg); } }
@keyframes wfAhoge { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }
@keyframes wfTwinkle { 0%,100% { opacity:1; transform: scale(1); } 50% { opacity:.4; transform: scale(.8); } }
@keyframes wfPop { 0% { transform: scale(1); } 40% { transform: scale(1.12) translateY(-4%); } 100% { transform: scale(1); } }
`;

/** Réactions : expression (yeux) + forme de bouche au repos. */
const REACTIONS = {
  neutral: { exp: 'normal', m: 'closed' }, happy: { exp: 'happy', m: 'small' }, heart: { exp: 'heart', m: 'cat' },
  shock: { exp: 'shock', m: 'small' }, scared: { exp: 'scared', m: 'wide' }, smug: { exp: 'smug', m: 'cat' }, sad: { exp: 'sad', m: 'closed' },
};

export function createWaifu(container) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  container.innerHTML = SVG;
  const svg = container.querySelector('svg');
  let timers = [], talking = false, rest = REACTIONS.neutral, holdUntil = 0, mouthTimer = null;
  const set = (r) => { svg.dataset.exp = r.exp; if (!talking) svg.dataset.m = r.m; };
  set(rest);
  svg.dataset.m = 'closed';

  // clignement des yeux, toutes les 2,5 à 5 s
  (function blink() { svg.classList.add('blink'); setTimeout(() => svg.classList.remove('blink'), 130); setTimeout(blink, 2500 + Math.random() * 2500); })();
  // regard : elle suit l'arène (en haut à droite) avec des coups d'œil aléatoires
  (function gaze() { svg.style.setProperty('--gx', (2 + Math.random() * 3 - 1.5).toFixed(1) + 'px'); svg.style.setProperty('--gy', (-1.5 + Math.random() * 2 - 1).toFixed(1) + 'px'); setTimeout(gaze, 1200 + Math.random() * 1800); })();

  const api = {
    /** réaction temporaire : api.react('shock', 1500) */
    react(kind, ms = 1800) {
      const r = REACTIONS[kind] ?? REACTIONS.neutral;
      set(r); svg.classList.remove('pop'); void svg.getBoundingClientRect(); svg.classList.add('pop');
      svg.style.setProperty('--gx', '4px'); svg.style.setProperty('--gy', '-3px'); // elle regarde l'action
      holdUntil = Date.now() + ms;
      setTimeout(() => { if (Date.now() >= holdUntil - 20) set(rest); }, ms);
    },
    /** bouche qui bouge tant qu'elle parle (synchronisée avec la voix si disponible) */
    talk(on) {
      talking = on; clearInterval(mouthTimer);
      if (on) { const shapes = ['small', 'wide', 'small', 'closed', 'wide']; let i = 0; mouthTimer = setInterval(() => { svg.dataset.m = shapes[(i++ + Math.floor(Math.random() * 2)) % shapes.length]; }, 120); }
      else svg.dataset.m = (REACTIONS[Object.keys(REACTIONS).find((k) => REACTIONS[k].exp === svg.dataset.exp)] ?? REACTIONS.neutral).m;
    },
    /** parle pendant une durée estimée (quand la voix est coupée) */
    talkFor(text) { api.talk(true); clearTimeout(api._t); api._t = setTimeout(() => api.talk(false), Math.min(9000, 700 + text.length * 55)); },
  };
  return api;
}

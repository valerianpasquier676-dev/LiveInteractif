// Arène 3D (three.js) : colisée, foule, gladiateurs, pièces, foudre, météores, boss Titan.
import * as THREE from 'three';

const R_ARENA = 9;
const GLAD_SCALE = 1.6; // les gladiateurs sont agrandis pour rester lisibles sur un écran de téléphone
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const hueOf = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const POWER_COLOR = { epee: 0xffd84d, bouclier: 0x6ec8ff, berserk: 0xff3b2f, vampire: 0xb04dff, foudre: 0x9fd0ff, legende: 0xffb300 };

// ---------- textures dessinées au canvas ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const emojiCache = new Map();
function emojiTex(ch) {
  if (!emojiCache.has(ch)) emojiCache.set(ch, canvasTex(128, 128, (g) => { g.font = '96px "Segoe UI Emoji","Apple Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 70); }));
  return emojiCache.get(ch);
}
const nameCache = new Map();
function nameTex(name, color = '#fff') {
  const k = name + color;
  if (!nameCache.has(k)) nameCache.set(k, canvasTex(256, 64, (g, w, h) => {
    g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#000'; g.strokeText(name.slice(0, 14), w / 2, h / 2);
    g.fillStyle = color; g.fillText(name.slice(0, 14), w / 2, h / 2);
  }));
  return nameCache.get(k);
}
const sandTex = () => canvasTex(1024, 1024, (g, w) => {
  const c = w / 2, gr = g.createRadialGradient(c, c, 40, c, c, c);
  gr.addColorStop(0, '#f0c27a'); gr.addColorStop(.75, '#cf8f50'); gr.addColorStop(1, '#8a4f2a');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '90,50,20' : '255,230,170'},${Math.random() * .12})`; g.fillRect(Math.random() * w, Math.random() * w, 2 + Math.random() * 3, 2 + Math.random() * 3); }
  g.strokeStyle = 'rgba(80,35,15,.55)'; g.lineWidth = 8;
  for (const r of [c * .96, c * .6, c * .2]) { g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); }
  g.lineWidth = 5; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(c + Math.cos(i * TAU / 12) * c * .2, c + Math.sin(i * TAU / 12) * c * .2); g.lineTo(c + Math.cos(i * TAU / 12) * c * .96, c + Math.sin(i * TAU / 12) * c * .96); g.stroke(); }
});

// ---------- images (photos de profil, images de cadeaux) ----------
const imgSrc = (u) => (u.startsWith('data:') ? u : '/api/img?u=' + encodeURIComponent(u)); // proxy serveur (CORS)
const urlTex = new Map();
function remoteTex(url) {
  if (!urlTex.has(url)) { const t = new THREE.Texture(); t.colorSpace = THREE.SRGBColorSpace; urlTex.set(url, t);
    const im = new Image(); im.onload = () => { t.image = im; t.needsUpdate = true; }; im.src = imgSrc(url); }
  return urlTex.get(url);
}
// pastille de profil ronde (photo si chargée, sinon initiale) avec anneau de la couleur du pouvoir
function paintAvatar(canvas, img, letter, hue, ring) {
  const g = canvas.getContext('2d'), w = canvas.width, c = w / 2;
  g.clearRect(0, 0, w, w); g.save(); g.beginPath(); g.arc(c, c, c - 8, 0, TAU); g.clip();
  if (img) g.drawImage(img, 0, 0, w, w);
  else { g.fillStyle = `hsl(${hue} 65% 45%)`; g.fillRect(0, 0, w, w); g.fillStyle = '#fff'; g.font = 'bold ' + w * .5 + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, c, c + 4); }
  g.restore(); g.lineWidth = 9; g.strokeStyle = ring; g.beginPath(); g.arc(c, c, c - 8, 0, TAU); g.stroke();
}

// ---------- particules ----------
class Particles {
  constructor(scene, cap = 2000) {
    this.cap = cap; this.i = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.grav = new Float32Array(cap);
    for (let k = 0; k < cap; k++) this.pos[k * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.pts.frustumCulled = false; scene.add(this.pts);
  }
  burst(p, n, color, speed = 4, life = 0.8, gravity = 9, up = 0) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const j = this.i++ % this.cap, a = rnd(0, TAU), e = rnd(-.2, 1), s = rnd(.3, 1) * speed;
      this.pos.set([p.x, p.y, p.z], j * 3);
      this.vel.set([Math.cos(a) * s * (1 - e * .5), e * s + up, Math.sin(a) * s * (1 - e * .5)], j * 3);
      this.col.set([c.r, c.g, c.b], j * 3); this.life[j] = life * rnd(.6, 1.2); this.grav[j] = gravity;
    }
  }
  confetti(n = 120) {
    for (let k = 0; k < n; k++) {
      const j = this.i++ % this.cap, c = new THREE.Color().setHSL(Math.random(), 1, .6);
      this.pos.set([rnd(-9, 9), rnd(10, 16), rnd(-9, 9)], j * 3); this.vel.set([rnd(-1, 1), rnd(-6, -2), rnd(-1, 1)], j * 3);
      this.col.set([c.r, c.g, c.b], j * 3); this.life[j] = rnd(2, 3.5); this.grav[j] = 0.5;
    }
  }
  update(dt) {
    for (let k = 0; k < this.cap; k++) {
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -999; continue; }
      this.life[k] -= dt; this.vel[k * 3 + 1] -= this.grav[k] * dt;
      for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt;
      if (this.pos[k * 3 + 1] < 0.1 && this.grav[k] > 1) { this.pos[k * 3 + 1] = 0.1; this.vel[k * 3 + 1] *= -0.3; }
    }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true;
  }
}

export function createArena(container, opts = {}) {
  const SHOW_AVATARS = opts.avatars !== false;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a0b10);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  let shake = 0, camT = 0;
  const FLASH = new THREE.Color(0xdfe8ff);

  function resize() {
    const w = container.clientWidth || 540, h = container.clientHeight || 960;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); fit();
  }
  function fit() {
    const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const dist = 10.6 / Math.tan(Math.min(vf, hf) / 2);
    const el = 56 * Math.PI / 180;
    camera.userData.base = new THREE.Vector3(0, dist * Math.sin(el) + 1, dist * Math.cos(el));
  }
  addEventListener('resize', resize);

  // ----- lumières -----
  scene.add(new THREE.HemisphereLight(0xffe2b0, 0x4a2418, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2); sun.position.set(6, 20, 10); scene.add(sun);
  const torches = [];
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8 + .2, x = Math.cos(a) * 9.7, z = Math.sin(a) * 9.7;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.18, .25, 2.4, 8), new THREE.MeshLambertMaterial({ color: 0x4a2a18 })); post.position.set(x, 1.2, z); scene.add(post);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(.38, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff9a2e })); fl.position.set(x, 2.7, z); fl.scale.y = 1.5; scene.add(fl);
    if (i % 2 === 0) { const l = new THREE.PointLight(0xff8a2e, 60, 16, 2); l.position.set(x, 3, z); scene.add(l); torches.push({ fl, l }); } else torches.push({ fl });
  }

  // ----- sol, murs, gradins -----
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R_ARENA, 64), new THREE.MeshLambertMaterial({ map: sandTex() }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const prof = [[9, 0], [9, 2], [10.4, 2], [10.4, 3.3], [11.8, 3.3], [11.8, 4.6], [13.2, 4.6], [13.2, 5.9], [14.6, 5.9], [14.6, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), new THREE.MeshLambertMaterial({ color: 0x9a5a34, side: THREE.DoubleSide }));
  scene.add(bowl);
  for (let i = 0; i < 28; i++) { // arches sombres dans le mur
    const a = i * TAU / 28, arch = new THREE.Mesh(new THREE.BoxGeometry(.9, 1.1, .3), new THREE.MeshBasicMaterial({ color: 0x1a0a08 }));
    arch.position.set(Math.cos(a) * 9.02, .8, Math.sin(a) * 9.02); arch.rotation.y = -a + Math.PI / 2; scene.add(arch);
  }
  // foule
  const steps = [[9.3, 10.3, 2], [10.6, 11.6, 3.3], [12, 13, 4.6], [13.4, 14.4, 5.9]];
  const CROWD = 1100, crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.17, .3, 2, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), CROWD);
  const crowdData = [];
  for (let i = 0; i < CROWD; i++) {
    const [r0, r1, y] = steps[i % steps.length], a = rnd(0, TAU), r = rnd(r0, r1);
    crowdData.push({ x: Math.cos(a) * r, y: y + .32, z: Math.sin(a) * r, ph: rnd(0, TAU), sp: rnd(2, 5) });
    crowd.setColorAt(i, new THREE.Color().setHSL(Math.random(), rnd(.4, .8), rnd(.35, .65)));
  }
  scene.add(crowd);
  const dummy = new THREE.Object3D();
  let cheer = 0;
  function updateCrowd(t) {
    for (let i = 0; i < CROWD; i++) {
      const d = crowdData[i];
      dummy.position.set(d.x, d.y + Math.abs(Math.sin(t * d.sp + d.ph)) * (.05 + cheer * .35), d.z); dummy.updateMatrix(); crowd.setMatrixAt(i, dummy.matrix);
    }
    crowd.instanceMatrix.needsUpdate = true;
  }

  // ----- gladiateurs -----
  const glads = new Map();
  const skin = [0xf2c9a0, 0xe0ac7e, 0xc68642, 0x8d5524, 0xffdbb0];
  function makeGlad(p) {
    const g = new THREE.Group(), col = new THREE.Color().setHSL(hueOf(p.id) / 360, .7, .5);
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.34, .5, 4, 10), lam(col)); body.position.y = .65; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.3, 14, 12), lam(skin[hueOf(p.id) % skin.length])); head.position.y = 1.32; g.add(head);
    const faceParts = [head];
    for (const sx of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0x111111 })); eye.position.set(sx * .1, 1.36, .27); g.add(eye); faceParts.push(eye); }
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(.34, 14, 8, 0, TAU, 0, Math.PI / 2), lam(0xb8bcc4)); helmet.position.y = 1.36; g.add(helmet); faceParts.push(helmet);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(.08, .22, .5), lam(0xc0262d)); crest.position.set(0, 1.78, 0); g.add(crest); faceParts.push(crest);
    // photo de profil (2D, toujours face caméra) à la place de la tête ; initiale colorée si pas de photo
    const avCanvas = document.createElement('canvas'); avCanvas.width = avCanvas.height = 128;
    const avTex = new THREE.CanvasTexture(avCanvas); avTex.colorSpace = THREE.SRGBColorSpace;
    const avatar = new THREE.Sprite(new THREE.SpriteMaterial({ map: avTex, transparent: true, depthTest: false })); avatar.scale.set(1.15, 1.15, 1); avatar.position.y = 1.55; avatar.renderOrder = 9; g.add(avatar);
    if (SHOW_AVATARS) faceParts.forEach((m) => { m.visible = false; }); else avatar.visible = false;
    const arm = new THREE.Group(); arm.position.set(.46, .95, .05); g.add(arm);
    const sword = new THREE.Group(); sword.position.set(0, -.15, .25); sword.rotation.x = Math.PI / 2; arm.add(sword);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.09, .95, .03), new THREE.MeshLambertMaterial({ color: 0xe8eef5 })); blade.position.y = .5; sword.add(blade);
    sword.add(new THREE.Mesh(new THREE.BoxGeometry(.32, .07, .07), lam(0xc9a227)));
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .07, 16), lam(0x5a7bd0)); shield.rotation.z = Math.PI / 2; shield.rotation.y = .3; shield.position.set(-.5, .85, .12); shield.visible = false; g.add(shield);
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(.95, 16, 12), new THREE.MeshBasicMaterial({ color: 0x6ec8ff, transparent: true, opacity: .22 })); bubble.position.y = .9; bubble.visible = false; g.add(bubble);
    const aura = new THREE.Mesh(new THREE.TorusGeometry(.75, .06, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffd84d })); aura.rotation.x = Math.PI / 2; aura.position.y = .08; aura.visible = false; g.add(aura);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(.3, .35, 6), new THREE.MeshBasicMaterial({ color: 0xffc200 })); crown.position.y = 1.9; crown.visible = false; g.add(crown);
    const cape = new THREE.Mesh(new THREE.ConeGeometry(.5, 1.1, 8, 1, true), new THREE.MeshLambertMaterial({ color: 0x5a0f7a, side: THREE.DoubleSide })); cape.position.set(0, .75, -.35); cape.rotation.x = -.35; cape.visible = false; g.add(cape);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTex(p.name), transparent: true, depthTest: false })); tag.scale.set(2.2, .55, 1); tag.position.y = 2.35; tag.renderOrder = 10; g.add(tag);
    const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, depthTest: false })); hpBg.scale.set(1.25, .18, 1); hpBg.position.y = 2.0; hpBg.renderOrder = 10; g.add(hpBg);
    const hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4ade80, depthTest: false })); hpFg.scale.set(1.15, .1, 1); hpFg.position.y = 2.0; hpFg.renderOrder = 11; g.add(hpFg);
    const a = hueOf(p.id) / 360 * TAU, r = rnd(5.5, 7.8);
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.scale.setScalar(.01);
    scene.add(g);
    const o0 = { avCanvas, avTex, avatar, avImg: null, avUrl: null, avRing: '' };
    return { ...o0, id: p.id, g, body, head, arm, sword, shield, bubble, aura, crown, cape, tag, hpFg, hpBg, base: col, p, vx: 0, vz: 0, atk: 0, swing: 0, dead: 0, bornAt: clock.elapsedTime, scaleT: 1, name: p.name };
  }

  function styleGlad(o, p) {
    o.p = p;
    const pw = p.power;
    o.scaleT = GLAD_SCALE * (pw === 'berserk' ? 1.5 : pw === 'legende' ? 1.3 : 1);
    o.body.material.color.copy(pw === 'berserk' ? new THREE.Color(0xc02a1c) : o.base);
    o.shield.visible = o.bubble.visible = !!p.shield && p.alive;
    o.aura.visible = !!pw && p.alive; if (pw) o.aura.material.color.set(POWER_COLOR[pw]);
    o.crown.visible = pw === 'legende'; o.cape.visible = pw === 'vampire';
    o.sword.scale.setScalar(pw === 'epee' || pw === 'legende' ? 1.5 : 1);
    const f = Math.max(0, Math.min(1, p.hp / p.maxHp));
    o.hpFg.scale.x = 1.15 * f; o.hpFg.position.x = -(1.15 - 1.15 * f) / 2; o.hpFg.material.color.set(f > .35 ? 0x4ade80 : 0xff4d5e);
    o.hpFg.visible = o.hpBg.visible = p.alive; o.tag.visible = p.alive || o.dead < 2;
    // photo de profil : (re)chargement si l'URL change ; anneau = couleur du pouvoir
    if (SHOW_AVATARS) {
      if (p.avatar && p.avatar !== o.avUrl) { o.avUrl = p.avatar; o.avRing = ''; const im = new Image(); im.onload = () => { o.avImg = im; o.avRing = ''; }; im.src = imgSrc(p.avatar); }
      const ring = pw ? '#' + POWER_COLOR[pw].toString(16).padStart(6, '0') : '#ffffff';
      if (o.avRing !== ring + (o.avImg ? 'i' : 'n')) { o.avRing = ring + (o.avImg ? 'i' : 'n'); paintAvatar(o.avCanvas, o.avImg, (p.name[0] ?? '?').toUpperCase(), hueOf(p.id), ring); o.avTex.needsUpdate = true; }
      o.avatar.material.opacity = p.alive ? 1 : .45;
    }
  }

  // ----- boss Titan -----
  const boss = (() => {
    const g = new THREE.Group(), lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 16), lam(0x5b1a3a)); body.position.y = 3; body.scale.set(1, 1.15, .95); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), lam(0x7a2a4a)); head.position.y = 5.7; g.add(head);
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(.35, 1.5, 8), lam(0xf0e6c8)); horn.position.set(sx * .9, 6.9, 0); horn.rotation.z = -sx * .5; g.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe14d })); eye.position.set(sx * .45, 5.85, 1.05); g.add(eye);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(.7, .9, 2, 10), lam(0x4a1530)); leg.position.set(sx * 1.1, 1, 0); g.add(leg);
    }
    const arm = new THREE.Group(); arm.position.set(2.2, 4.2, 0); g.add(arm);
    const club = new THREE.Mesh(new THREE.CylinderGeometry(.5, .9, 4, 10), lam(0x6b4423)); club.position.y = -1.8; arm.add(club);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTex('TITAN', '#ff6b6b'), transparent: true, depthTest: false })); tag.scale.set(4.5, 1.1, 1); tag.position.y = 8.6; tag.renderOrder = 12; g.add(tag);
    const bgb = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0, depthTest: false })); bgb.scale.set(5, .5, 1); bgb.position.y = 7.9; bgb.renderOrder = 12; g.add(bgb);
    const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3b3b, depthTest: false })); fg.scale.set(4.8, .34, 1); fg.position.y = 7.9; fg.renderOrder = 13; g.add(fg);
    g.visible = false; g.scale.setScalar(.8); scene.add(g);
    return { g, arm, fg, active: false, t: 0, slam: 0, target: new THREE.Vector3(0, 0, -2.5), fall: 0 };
  })();

  // ----- effets -----
  const particles = new Particles(scene);
  const clock = { elapsedTime: 0, last: performance.now(), getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; this.elapsedTime += d; return d; } };
  const fx = []; // objets temporaires { obj, update(dt) -> false pour retirer }
  const addFx = (obj, update) => { scene.add(obj); fx.push({ obj, update }); };
  const posOf = (name) => { for (const o of glads.values()) if (o.name === name) return o.g.position.clone(); return new THREE.Vector3(rnd(-5, 5), 0, rnd(-5, 5)); };
  const ring = (pos, color, big = 5) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(.3, .5, 32), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, opacity: .9 }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos).setY(.15); let t = 0;
    addFx(m, (dt) => { t += dt * 1.6; m.scale.setScalar(1 + t * big); m.material.opacity = Math.max(0, .9 - t); return t < 1; });
  };
  const rain = (emoji, n, speed = 4, size = .9) => {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: typeof emoji === 'string' ? emojiTex(emoji) : emoji, transparent: true })); s.scale.setScalar(size);
      s.position.set(rnd(-8, 8), rnd(8, 18), rnd(-8, 8)); const v = rnd(.6, 1) * speed;
      addFx(s, (dt) => { s.position.y -= v * dt; s.material.opacity = s.position.y > .5 ? 1 : Math.max(0, s.material.opacity - dt * 2); return s.position.y > -1 && s.material.opacity > 0; });
    }
  };
  const coinGeo = new THREE.CylinderGeometry(.28, .28, .07, 16), coinMat = new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x6a4a00 });
  const coins = (n, at) => {
    for (let i = 0; i < Math.min(n, 60); i++) {
      const c = new THREE.Mesh(coinGeo, coinMat); c.rotation.x = Math.PI / 2;
      c.position.set((at?.x ?? 0) + rnd(-3, 3), rnd(9, 15), (at?.z ?? 0) + rnd(-3, 3));
      let vy = 0, life = 4.5, spin = rnd(4, 9);
      addFx(c, (dt) => { vy -= 14 * dt; c.position.y += vy * dt; if (c.position.y < .3) { c.position.y = .3; vy = -vy * .45; } c.rotation.z += spin * dt; life -= dt; if (life < .6) c.scale.setScalar(Math.max(.01, life / .6)); return life > 0; });
    }
  };
  const bolt = (to) => {
    const pts = []; for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(to.x + (i < 8 ? rnd(-.8, .8) : 0), 16 - i * 2, to.z + (i < 8 ? rnd(-.8, .8) : 0)));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xcfe6ff })); let t = .35;
    addFx(l, (dt) => { t -= dt; return t > 0; });
    particles.burst(to.clone().setY(.5), 14, 0x9fd0ff, 5, .5);
  };
  const meteor = (to, delay) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    m.position.set(to.x + 10, 24, to.z - 10); let wait = delay;
    addFx(m, (dt) => {
      if ((wait -= dt) > 0) { m.visible = false; return true; } m.visible = true;
      m.position.x -= 13 * dt; m.position.y -= 24 * dt; m.position.z += 13 * dt; particles.burst(m.position, 2, 0xffa24a, 1, .5, 0);
      if (m.position.y <= .6) { particles.burst(m.position.clone().setY(.4), 40, 0xff7a1a, 7, .9); ring(m.position, 0xff9a2e, 4); shake = Math.max(shake, .5); return false; }
      return true;
    });
  };
  let flash = 0;
  const flashColor = new THREE.Color(0xdfe8ff);

  // gros sprite (emoji ou image de cadeau) qui apparaît, grossit puis s'estompe
  const bigSprite = (map, y = 6, life = 2.6, size = 7) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: typeof map === 'string' ? emojiTex(map) : map, transparent: true, depthTest: false }));
    s.position.set(0, y, 0); s.renderOrder = 20; let t = 0;
    addFx(s, (dt) => { t += dt; const k = t / life; s.scale.setScalar(size * (.4 + Math.min(1, k * 3) * .6 + k * .2)); s.position.y = y + k * 2; s.material.opacity = k < .75 ? 1 : Math.max(0, (1 - k) * 4); return t < life; });
  };
  // Galaxy / Universe : tourbillon d'étoiles violettes + éclat
  const galaxyFx = () => {
    flashColor.set(0xb08cff); flash = .8; shake = Math.max(shake, .4); bigSprite('🌌', 7, 3.2, 8); let t = 0;
    addFx(new THREE.Object3D(), (dt) => { t += dt; for (let i = 0; i < 6; i++) { const a = t * 3 + i, r = 1 + t * 2.5; particles.burst(new THREE.Vector3(Math.cos(a) * r, .8 + Math.random() * 3, Math.sin(a) * r), 1, [0xb08cff, 0x6ec8ff, 0xff8ad8, 0xffffff][i % 4], 1.2, 1.2, -1); } return t < 2.6; });
  };
  // Lion : le roi de la jungle rugit, secousse + ondes de choc
  const lionFx = () => { bigSprite('🦁', 5, 2.8, 9); shake = Math.max(shake, 1); ring(new THREE.Vector3(0, 0, 0), 0xffb347, 10); ring(new THREE.Vector3(0, 0, 0), 0xff6a2e, 7); particles.burst(new THREE.Vector3(0, 2, 0), 70, 0xffc247, 9, 1.2); };
  // animation propre à chaque cadeau (par nom) ; sinon : l'image réelle du cadeau en pluie, ou des pièces
  const giftFx = (e) => {
    const k = (e.giftName ?? '').toLowerCase(), n = Math.min(40, 8 * (e.repeat ?? 1));
    if (k === 'rose') rain('🌹', n, 3);
    else if (k === 'finger heart') rain('🫰', n, 3.5);
    else if (k === 'doughnut') rain('🍩', n, 4);
    else if (k === 'hand hearts') rain('🫶', n, 3.5);
    else if (k === 'money gun') { rain('💸', 45, 6); coins(50); }
    else if (k === 'galaxy' || k === 'universe') galaxyFx();
    else if (k === 'lion') lionFx();
    else if (e.giftImage) rain(remoteTex(e.giftImage), Math.min(30, 6 + 4 * (e.repeat ?? 1)), 4, 1.3);
    if (!['rose', 'finger heart', 'doughnut', 'hand hearts'].includes(k)) coins(Math.min(60, 6 + Math.round(Math.sqrt(e.coins) * 3)), posOf(e.name));
  };

  // ----- API -----
  let S = null;
  const api = {
    setState(s) {
      S = s;
      const seen = new Set();
      for (const p of s.players) {
        seen.add(p.id);
        let o = glads.get(p.id);
        if (!o) { o = makeGlad(p); glads.set(p.id, o); }
        const wasAlive = o.p?.alive !== false;
        if (wasAlive && !p.alive) { o.dead = 0.001; particles.burst(o.g.position.clone().setY(1), 28, 0xff4d4d, 5, .8); }
        o.name = p.name; styleGlad(o, p);
      }
      for (const [id, o] of glads) if (!seen.has(id)) { scene.remove(o.g); glads.delete(id); } // nouveau round
      if (s.boss && !boss.active) { boss.active = true; boss.g.visible = true; boss.g.position.set(0, 0, -16); boss.fall = 0; boss.g.rotation.x = 0; boss.g.scale.setScalar(1); }
      if (boss.active && s.boss) { const f = Math.max(0, s.boss.hp / s.boss.max); boss.fg.scale.x = 4.8 * f; boss.fg.position.x = -(4.8 - 4.8 * f) / 2; }
    },
    onEvent(e) {
      switch (e.type) {
        case 'kill': { const p = posOf(e.victim); cheer = Math.max(cheer, .6); particles.burst(p.setY(1), 16, 0xffffff, 4, .5);
          const sk = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex('💀'), transparent: true })); sk.scale.setScalar(1.2); sk.position.copy(p).setY(2.2); let t = 0;
          addFx(sk, (dt) => { t += dt; sk.position.y += dt * 1.4; sk.material.opacity = Math.max(0, 1 - t / 1.6); return t < 1.6; }); break; }
        case 'gift': giftFx(e); cheer = Math.max(cheer, .5);
          break;
        case 'power': { // un pouvoir vient d'être attribué : explosion de couleur sur le gladiateur
          const p = posOf(e.name), c = POWER_COLOR[e.power] ?? 0xffffff; ring(p, c, 3); ring(p, 0xffffff, 2);
          particles.burst(p.clone().setY(1), 40, c, 5, 1, 3, 3); cheer = Math.max(cheer, .6); break; }
        case 'lightning': flash = 1; shake = Math.max(shake, .7); if (S) for (const p of S.players.filter((q) => q.alive).slice(0, 8)) bolt(posOf(p.name)); break;
        case 'meteors': shake = Math.max(shake, .4); { const al = S ? S.players.filter((q) => q.alive) : []; (al.length ? al : [{ name: '' }]).slice(0, 10).forEach((p, i) => meteor(posOf(p.name), i * .12)); } break;
        case 'heartRain': rain('❤️', 40, 3.5); cheer = 1; break;
        case 'hazard': shake = Math.max(shake, .8); if (e.kind === 'pluie de feu') for (let i = 0; i < 8; i++) meteor(new THREE.Vector3(rnd(-6, 6), 0, rnd(-6, 6)), i * .15); break;
        case 'shieldSave': ring(posOf(e.name), 0x6ec8ff, 3); particles.burst(posOf(e.name).setY(1), 30, 0x6ec8ff, 5, .9); break;
        case 'roundEnd': particles.confetti(220); rain('🏆', 6, 2.5, 1.4); cheer = 1; coins(40); break;
        case 'fightStart': cheer = 1; shake = .3; break;
        case 'carnage': shake = Math.max(shake, 1); break;
        case 'bossSpawn': shake = 1.2; cheer = 1; break;
        case 'bossDown': boss.fall = .001; shake = 1.2; coins(60); particles.confetti(160); break;
        case 'bossLeave': boss.fall = -.001; break;
      }
    },
    resize,
  };

  // ----- boucle -----
  function frame() {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    camT += dt; shake = Math.max(0, shake - dt * 1.5); cheer = Math.max(0, cheer - dt * .4); flash = Math.max(0, flash - dt * 3);
    // gladiateurs
    const all = [...glads.values()], alive = all.filter((o) => o.p.alive);
    const fighting = S?.phase === 'fight';
    for (const o of all) {
      const g = o.g, p = o.p;
      const target = (p.alive ? o.scaleT : GLAD_SCALE) * (t - o.bornAt < .5 ? (t - o.bornAt) / .5 : 1);
      g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, Math.max(target, .01), .15));
      if (!p.alive) { // KO : il s'écroule puis disparaît
        o.dead += dt; g.rotation.z = Math.min(Math.PI / 2, o.dead * 4); g.position.y = Math.max(0, .3 - o.dead * .1); if (o.dead > 3.5) g.scale.setScalar(Math.max(.01, g.scale.x - dt)); o.tag.visible = false; continue;
      }
      let tx = g.position.x, tz = g.position.z, moving = false;
      if (fighting) {
        let near = null, nd = 1e9;
        for (const q of alive) if (q !== o) { const d = q.g.position.distanceToSquared(g.position); if (d < nd) { nd = d; near = q; } }
        if (boss.active && boss.g.visible && (!near || Math.random() < .002)) near = { g: boss.g };
        if (near) { const dx = near.g.position.x - g.position.x, dz = near.g.position.z - g.position.z, d = Math.hypot(dx, dz) || 1;
          g.rotation.y = Math.atan2(dx, dz);
          if (d > 1.5) { tx += dx / d * 2.4 * dt; tz += dz / d * 2.4 * dt; moving = true; }
          else { o.swing += dt * 9; if (Math.sin(o.swing) > .95 && !o.hit) { o.hit = true; particles.burst(near.g.position.clone().setY(1.1), 6, 0xffe08a, 3, .35); } if (Math.sin(o.swing) < 0) o.hit = false; } }
      } else if (S?.phase === 'ended') { // victoire : le gagnant saute au centre
        if (S.winner === o.name) { tx *= .96; tz *= .96; g.position.y = Math.abs(Math.sin(t * 6)) * .6; o.arm.rotation.x = -2.6; g.rotation.y += dt * 2; } else { o.arm.rotation.x = 0; }
      } else { // lobby : ils se promènent en cercle et se chauffent
        const a = Math.atan2(g.position.z, g.position.x) + dt * .25 * (1 + (hueOf(o.id) % 3) * .1), r = 6.4 + Math.sin(t + hueOf(o.id)) * .4;
        tx = Math.cos(a) * r; tz = Math.sin(a) * r; moving = true; g.rotation.y = -a + Math.PI; o.arm.rotation.x = Math.sin(t * 3 + hueOf(o.id)) * .4;
      }
      for (const q of alive) if (q !== o) { const dx = tx - q.g.position.x, dz = tz - q.g.position.z, d = Math.hypot(dx, dz); if (d < 1 && d > .001) { tx += dx / d * (1 - d) * .4; tz += dz / d * (1 - d) * .4; } }
      const rr = Math.hypot(tx, tz); if (rr > 8.3) { tx *= 8.3 / rr; tz *= 8.3 / rr; }
      g.position.x = THREE.MathUtils.lerp(g.position.x, tx, S?.phase === 'lobby' ? 1 : .6); g.position.z = THREE.MathUtils.lerp(g.position.z, tz, S?.phase === 'lobby' ? 1 : .6);
      if (S?.phase !== 'ended') g.position.y = moving ? Math.abs(Math.sin(t * 9 + hueOf(o.id))) * .12 : 0;
      if (fighting) o.arm.rotation.x = Math.sin(o.swing) > 0 ? -Math.sin(o.swing) * 1.8 : 0;
      if (p.shield) o.bubble.rotation.y += dt; o.aura.rotation.z += dt * 2; o.aura.scale.setScalar(1 + Math.sin(t * 4) * .05);
      if (p.power === 'foudre' && Math.random() < .05) particles.burst(g.position.clone().setY(1.3), 3, 0x9fd0ff, 2, .3, 0);
      if (p.power === 'legende' && Math.random() < .08) particles.burst(g.position.clone().setY(1.5), 2, 0xffc200, 1.5, .5, -1);
    }
    // boss
    if (boss.active) {
      const bg = boss.g;
      if (boss.fall > 0) { boss.fall += dt; bg.rotation.x = Math.min(1.4, boss.fall * 1.2); bg.position.y = -boss.fall * .6; if (boss.fall > 2.2) { boss.active = false; bg.visible = false; boss.fall = 0; particles.burst(new THREE.Vector3(0, 2, -2), 60, 0xffc200, 8, 1.2); } }
      else if (boss.fall < 0) { bg.position.z -= dt * 6; if (bg.position.z < -22) { boss.active = false; bg.visible = false; boss.fall = 0; } }
      else { bg.position.z = THREE.MathUtils.lerp(bg.position.z, boss.target.z, .03); boss.slam += dt;
        const ph = (boss.slam % 1.3) / 1.3; boss.arm.rotation.x = ph < .5 ? -2.4 * (ph / .5) : -2.4 + 2.4 * ((ph - .5) / .5) * 1.1;
        if (ph > .5 && !boss.hit) { boss.hit = true; shake = Math.max(shake, .6); const p = bg.position.clone().add(new THREE.Vector3(2.2, 0, 3.5)); ring(p, 0xff5a3a, 6); particles.burst(p.setY(.4), 30, 0xffa24a, 6, .7); } if (ph < .5) boss.hit = false; }
      if (S && !S.boss && boss.fall === 0 && boss.active) { boss.active = false; bg.visible = false; }
    }
    // effets temporaires
    for (let i = fx.length - 1; i >= 0; i--) if (!fx[i].update(dt)) { scene.remove(fx[i].obj); fx.splice(i, 1); }
    particles.update(dt); updateCrowd(t);
    for (const [i, tr] of torches.entries()) { tr.fl.scale.set(1, 1.3 + Math.sin(t * 12 + i) * .25, 1); if (tr.l) tr.l.intensity = 55 + Math.sin(t * 15 + i * 2) * 12; }
    scene.background.set(0x1a0b10).lerp(flashColor, flash * .7);
    if (flash === 0) flashColor.copy(FLASH);
    // caméra : légère dérive + secousses
    const b = camera.userData.base ?? new THREE.Vector3(0, 30, 20), sway = Math.sin(camT * .25) * .06;
    camera.position.set(b.x + b.z * Math.sin(sway) + (Math.random() - .5) * shake, b.y + (Math.random() - .5) * shake, b.z * Math.cos(sway) + (Math.random() - .5) * shake);
    camera.lookAt(0, 0.8, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  resize(); requestAnimationFrame(frame);
  return api;
}

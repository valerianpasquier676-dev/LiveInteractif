import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUser, parseChat, parseLike, parseGift, parseViewers, parseCatalog } from '../src/tiktokMap.js';
import { isAllowedImageUrl, fetchImage } from '../src/imgproxy.js';
import { openDb } from '../src/db.js';
import { Arena, powerForCoins } from '../src/game.js';

// formes réelles de tiktok-live-connector v2 (proto v3)
const user = { id: '7001', displayId: 'karim_67', nickname: 'Karim 🔥', avatarThumb: { urlList: ['https://p16-sign.tiktokcdn.com/a.jpeg'] } };

test('lecture des messages TikTok v2', () => {
  assert.deepEqual(parseUser({ user }), { id: '7001', name: 'karim_67', avatar: 'https://p16-sign.tiktokcdn.com/a.jpeg' });
  assert.equal(parseChat({ user, content: 'salut' }).text, 'salut');
  assert.equal(parseLike({ user, count: 15 }).count, 15);
  assert.equal(parseViewers({ total: '128' }), 128);
});

test('cadeaux : série en cours ignorée, total = prix x répétitions, image', () => {
  const gift = { name: 'Rose', diamondCount: 1, type: 1, image: { urlList: ['https://p16.tiktokcdn.com/rose.png'] } };
  assert.equal(parseGift({ user, gift, repeatCount: 3, repeatEnd: 0 }), null);
  const g = parseGift({ user, gift, repeatCount: 3, repeatEnd: 1 });
  assert.equal(g.coins, 3); assert.equal(g.gift, 'Rose'); assert.equal(g.image, 'https://p16.tiktokcdn.com/rose.png'); assert.equal(g.name, 'karim_67');
  assert.equal(parseGift({ user, gift: { name: 'Galaxy', diamondCount: 1000, type: 2 }, repeatCount: 1, repeatEnd: 0 }).coins, 1000); // cadeau non-série : compté tout de suite
});

test('catalogue des cadeaux (formats variables)', () => {
  const c = parseCatalog({ gifts: [{ name: 'Rose', diamond_count: 1, image: { url_list: ['https://x.tiktokcdn.com/r.png'] } }, { diamondCount: 5 }] });
  assert.deepEqual(c, [{ name: 'Rose', coins: 1, image: 'https://x.tiktokcdn.com/r.png' }]);
});

test('proxy d\'images : liste blanche stricte', async () => {
  assert.ok(isAllowedImageUrl('https://p16-sign.tiktokcdn.com/a.jpeg'));
  for (const bad of ['http://p16.tiktokcdn.com/a.jpg', 'https://evil.com/a.jpg', 'https://tiktokcdn.com.evil.com/a.jpg', 'https://user:pw@p16.tiktokcdn.com/a.jpg',
    'https://127.0.0.1/a.jpg', 'https://p16.tiktokcdn.com:8443/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', '']) assert.equal(isAllowedImageUrl(bad), false, bad);
  let called = 0;
  assert.equal(await fetchImage('https://evil.com/a.png', async () => { called++; }), null);
  assert.equal(called, 0); // jamais de requête vers un hôte non autorisé
  const png = Buffer.from([137, 80, 78, 71]);
  const ok = await fetchImage('https://p16.tiktokcdn.com/ok.png', async () => ({ ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => png }));
  assert.equal(ok.type, 'image/png');
  assert.equal(await fetchImage('https://p16.tiktokcdn.com/html.png', async () => ({ ok: true, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => png })), null);
});

test('avatars et image de cadeau transmis par le moteur', () => {
  const a = new Arena(openDb(':memory:'), { lobbySeconds: 60 });
  const seen = [];
  a.on('evt', (e) => seen.push(e));
  a.gift('7001', 'karim_67', 1000, 'Galaxy', { avatar: 'https://p16.tiktokcdn.com/a.jpeg', giftImage: 'https://p16.tiktokcdn.com/g.png', repeat: 1 });
  a.chat('7002', 'x', 'yo', { avatar: 'http://pas-https.com/a.jpg' }); // refusé : pas https
  const snap = a.snapshot();
  assert.equal(snap.players.find((p) => p.id === '7001').avatar, 'https://p16.tiktokcdn.com/a.jpeg');
  assert.equal(snap.players.find((p) => p.id === '7002').avatar, null);
  assert.equal(seen.find((e) => e.type === 'gift').giftImage, 'https://p16.tiktokcdn.com/g.png');
  assert.equal(a.db.getUser('7001').avatar, 'https://p16.tiktokcdn.com/a.jpeg');
  assert.equal(powerForCoins(5), 'bouclier'); assert.equal(powerForCoins(30), 'berserk'); assert.equal(powerForCoins(500), 'foudre');
});

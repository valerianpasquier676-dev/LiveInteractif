// Proxy d'images : le navigateur ne peut pas lire directement les images du CDN TikTok dans WebGL (CORS).
// Le serveur les télécharge et les re-sert depuis le même domaine. LISTE BLANCHE stricte pour éviter qu'on
// s'en serve pour appeler n'importe quel site (SSRF).

const ALLOWED = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibyteimg.com', 'byteimg.com', 'muscdn.com', 'tiktokv.com', 'tiktokv.us', 'tiktokv.eu'];
const MAX_BYTES = 600_000;
const cache = new Map(); // url -> { type, body }

export function isAllowedImageUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    return ALLOWED.some((d) => u.hostname === d || u.hostname.endsWith('.' + d));
  } catch { return false; }
}

export async function fetchImage(raw, fetchFn = fetch) {
  if (!isAllowedImageUrl(raw)) return null;
  if (cache.has(raw)) return cache.get(raw);
  const res = await fetchFn(raw, { signal: AbortSignal.timeout(6000), redirect: 'error' }); // pas de redirection hors liste blanche
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) return null;
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BYTES) return null;
  const out = { type, body };
  cache.set(raw, out);
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return out;
}

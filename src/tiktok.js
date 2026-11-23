import { config } from './config.js';

const uid = (d) => d.user?.uniqueId ?? d.uniqueId ?? 'inconnu';
const nick = (d) => d.user?.nickname ?? d.nickname ?? uid(d);

/** Branche le live TikTok réel (tiktok-live-connector v2) sur l'arène. */
export async function connectTikTok(arena, log = console.log) {
  const { TikTokLiveConnection, WebcastEvent } = await import('tiktok-live-connector');
  const conn = new TikTokLiveConnection(config.tiktokUser);

  conn.on(WebcastEvent.CHAT, (d) => arena.chat(uid(d), nick(d), d.comment));
  conn.on(WebcastEvent.LIKE, (d) => arena.like(uid(d), nick(d), d.likeCount ?? 1));
  conn.on(WebcastEvent.GIFT, (d) => {
    // Les cadeaux "streak" (giftType 1) ne comptent qu'à la fin de la série.
    if (d.giftType === 1 && !d.repeatEnd) return;
    const coins = (d.diamondCount ?? d.gift?.diamondCount ?? 0) * (d.repeatCount ?? 1);
    arena.gift(uid(d), nick(d), coins, d.giftName ?? d.gift?.name);
  });
  conn.on(WebcastEvent.STREAM_END, () => log('[tiktok] live terminé'));

  const state = await conn.connect();
  log(`[tiktok] connecté à @${config.tiktokUser} (room ${state.roomId})`);
  return conn;
}

// Lecture des messages de tiktok-live-connector v2 (proto v3) -> données simples pour l'arène.
// Tolérant : accepte aussi l'ancien format (uniqueId, comment, likeCount...).

const first = (img) => img?.urlList?.[0] ?? img?.url_list?.[0] ?? (Array.isArray(img?.url) ? img.url[0] : null) ?? null;

export function parseUser(d) {
  const u = d?.user ?? d ?? {};
  const handle = u.displayId || u.uniqueId || '';
  const id = String(u.id && u.id !== '0' ? u.id : handle || 'inconnu');
  const name = handle || u.nickname || u.nickName || 'inconnu';
  const avatar = first(u.avatarThumb) ?? first(u.avatarMedium) ?? first(u.profilePicture) ?? d?.profilePictureUrl ?? null;
  return { id, name, avatar };
}

export const parseChat = (d) => ({ ...parseUser(d), text: String(d?.content ?? d?.comment ?? '') });
export const parseLike = (d) => ({ ...parseUser(d), count: Math.max(1, Number(d?.count ?? d?.likeCount ?? 1) || 1) });

/** Renvoie null pour un cadeau "en série" pas encore terminé (on compte à la fin de la série). */
export function parseGift(d) {
  const g = d?.gift ?? d?.giftDetails ?? {};
  const streakable = (g.type ?? d?.giftType) === 1;
  if (streakable && !d?.repeatEnd) return null;
  const repeat = Math.max(1, Number(d?.repeatCount ?? 1) || 1);
  const unit = Number(g.diamondCount ?? d?.diamondCount ?? 0) || 0;
  return { ...parseUser(d), gift: g.name ?? g.giftName ?? d?.giftName ?? 'cadeau', coins: unit * repeat, repeat,
    image: first(g.image) ?? first(g.icon) ?? g.giftImage?.giftPictureUrl ?? d?.giftPictureUrl ?? null };
}

export const parseViewers = (d) => Number(d?.total ?? d?.viewerCount ?? 0) || 0;

/** Catalogue des cadeaux du live : [{ name, coins, image }] (format de réponse variable selon la version). */
export function parseCatalog(res) {
  const list = Array.isArray(res) ? res : res?.gifts ?? res?.data?.gifts ?? [];
  return list.map((g) => ({ name: g.name, coins: Number(g.diamond_count ?? g.diamondCount ?? 0) || 0, image: first(g.image) ?? first(g.icon) }))
    .filter((g) => g.name);
}

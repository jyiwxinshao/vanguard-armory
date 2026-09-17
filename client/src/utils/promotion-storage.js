export const PROMOTION_SEEN_KEY = 'game_store.promotions.seen.v1';

export function createPromotionStorage({ storage } = {}) {
  function local() {
    try {
      return storage || globalThis.localStorage || null;
    } catch {
      return null;
    }
  }

  function readSeen() {
    const store = local();
    if (!store) return [];
    try {
      const raw = store.getItem(PROMOTION_SEEN_KEY);
      if (raw === null) return [];
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  function hasSeen(id) {
    return readSeen().includes(id);
  }

  function markSeenMany(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id);
    if (!list.length) return;
    const store = local();
    if (!store) return;
    const next = Array.from(new Set([...readSeen(), ...list]));
    try {
      store.setItem(PROMOTION_SEEN_KEY, JSON.stringify(next));
    } catch {
      /* Failed writes simply mean it may show again later. */
    }
  }

  function markSeen(id) {
    markSeenMany([id]);
  }

  function nextUnseen(list) {
    return (Array.isArray(list) ? list : []).find((promotion) => promotion?.active && !hasSeen(promotion.id)) || null;
  }

  return { readSeen, hasSeen, markSeen, markSeenMany, nextUnseen };
}

export const promotionStorage = createPromotionStorage();

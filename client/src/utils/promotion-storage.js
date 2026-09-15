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

  function markSeen(id) {
    if (typeof id !== 'string' || !id) return;
    const store = local();
    if (!store) return;
    const next = Array.from(new Set([...readSeen(), id]));
    try {
      store.setItem(PROMOTION_SEEN_KEY, JSON.stringify(next));
    } catch {
      /* Failed writes simply mean it may show again later. */
    }
  }

  function nextUnseen(list) {
    return (Array.isArray(list) ? list : []).find((promotion) => promotion?.active && !hasSeen(promotion.id)) || null;
  }

  return { readSeen, hasSeen, markSeen, nextUnseen };
}

export const promotionStorage = createPromotionStorage();

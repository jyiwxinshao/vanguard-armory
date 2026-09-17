export function decidePromotions({ promotions, hasSeen, isInitialHome, isDev }) {
  const active = (Array.isArray(promotions) ? promotions : []).filter((promotion) => promotion?.active);
  if (!active.length) return [];
  if (!isInitialHome) return [];
  if (!isDev && active.every((promotion) => hasSeen(promotion.id))) return [];
  return active;
}

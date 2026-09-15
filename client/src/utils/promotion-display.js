export function decidePromotion({ promotion, hasSeen, isInitialHome, isDev }) {
  if (!promotion?.active) return null;
  if (!isInitialHome) return null;
  if (!isDev && hasSeen(promotion.id)) return null;
  return promotion;
}

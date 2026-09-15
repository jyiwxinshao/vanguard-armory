import { reactive } from 'vue';

export const promotionSession = reactive({
  initialPath: null,
  consumed: false,
});

export function recordInitialRoute(path) {
  if (promotionSession.initialPath === null) promotionSession.initialPath = path;
}

export function consumeInitialHome() {
  const eligible = promotionSession.initialPath === '/' && !promotionSession.consumed;
  promotionSession.consumed = true;
  return eligible;
}

export function resetPromotionSession() {
  promotionSession.initialPath = null;
  promotionSession.consumed = false;
}

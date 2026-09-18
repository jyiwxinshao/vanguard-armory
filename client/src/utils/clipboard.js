// Pure clipboard helper: resolves to a result object so callers can decide how
// to surface success or failure without this module depending on UI/notify.
export async function copyToClipboard(text, { clipboard = globalThis.navigator?.clipboard } = {}) {
  if (!text) return { ok: false, reason: 'empty' };
  if (!clipboard || typeof clipboard.writeText !== 'function') return { ok: false, reason: 'unavailable' };
  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

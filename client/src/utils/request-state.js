// A lost response or 5xx can occur after the mutation committed. Fetch the
// latest state before allowing another action; 4xx business rejections are definite.
export function isUncertainRequest(error) {
  if (!error || typeof error !== 'object') return false;
  if (['CART_SESSION_CHANGED', 'AUTH_STATE_CHANGED', 'STORAGE_UNAVAILABLE', 'ERR_CANCELED'].includes(error.code)) return false;
  if (error.name === 'CanceledError' || error.name === 'AbortError') return false;
  if (error.response) return error.response.status >= 500;
  return true;
}

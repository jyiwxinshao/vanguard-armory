const copy = (value) => JSON.parse(JSON.stringify(value));
const keyFor = (userId) => `game_store.checkout.${userId}.v1`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function createCheckoutStorage({ storage, lock, uuid = () => globalThis.crypto.randomUUID() } = {}) {
  function local() {
    try { if (storage || globalThis.localStorage) return storage || globalThis.localStorage; } catch { /* Report a safe actionable message. */ }
    throw new Error('浏览器无法保存下单记录，请允许本站使用本地存储');
  }
  function read(userId) {
    const raw = local().getItem(keyFor(userId));
    if (raw === null) return null;
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('本地下单记录损坏，原数据已保留'); }
    if (!value || ![1, 2].includes(value.version) || value.user_id !== userId || !['pending', 'rejected'].includes(value.state) || !uuidPattern.test(value.payload?.request_id)
      || !Array.isArray(value.payload.items) || !value.payload.items.length || value.payload.items.length > 100
      || typeof value.payload.server !== 'string'
      || (value.version === 1 ? (typeof value.payload.character_name !== 'string' || typeof value.payload.remark !== 'string') : (!Number.isSafeInteger(value.payload.character_id) || value.payload.character_id < 1))) {
      throw new Error('本地下单记录格式不支持，原数据已保留');
    }
    return value;
  }
  async function change(userId, guard, edit) {
    const task = () => {
      if (!guard()) throw new Error('账号状态已变化，请重新登录');
      const before = read(userId);
      const after = edit(before);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        try { if (after) local().setItem(keyFor(userId), JSON.stringify(after)); else local().removeItem(keyFor(userId)); }
        catch { throw new Error('下单记录保存失败，原记录已保留，请检查浏览器存储空间'); }
      }
      return copy(after);
    };
    if (lock) return lock(task);
    if (!globalThis.navigator?.locks) throw new Error('浏览器不支持安全保存下单记录，请使用支持 Web Locks 的浏览器和本机或 HTTPS 地址');
    return globalThis.navigator.locks.request(keyFor(userId), task);
  }
  return {
    read,
    prepare: (userId, payload, guard) => change(userId, guard, (existing) => existing || { version: 2, user_id: userId, state: 'pending', payload: { ...copy(payload), request_id: uuid() } }),
    pending: (userId, requestId, guard) => change(userId, guard, (value) => value?.payload.request_id === requestId ? { ...value, state: 'pending' } : value),
    rejected: (userId, requestId, guard) => change(userId, guard, (value) => value?.payload.request_id === requestId ? { ...value, state: 'rejected' } : value),
    complete: (userId, requestId, guard) => change(userId, guard, (value) => value?.payload.request_id === requestId ? null : value),
    discardRejected: (userId, guard) => change(userId, guard, (value) => {
      if (value && value.state !== 'rejected') throw new Error('上一次下单结果尚未确认，请先恢复该订单');
      return null;
    }),
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseStockDelta(value) {
  const text = String(value).trim();
  const number = Number(text);
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(number) || number === 0 || Math.abs(number) > 4294967295) throw new Error('请输入非零整数，例如 +10 或 -2，绝对值不超过 4294967295');
  return number;
}
export function createStockStorage({ storage, lock, uuid = () => globalThis.crypto.randomUUID() } = {}) {
  const keyFor = (userId, id) => `game_store.admin_stock.${userId}.${id}.v1`;
  function local() {
    try { if (storage || globalThis.localStorage) return storage || globalThis.localStorage; } catch { /* Keep pending operations intact. */ }
    throw new Error('浏览器无法保存库存操作，请允许本地存储后重试');
  }
  function read(userId, id) {
    let raw;
    try { raw = local().getItem(keyFor(userId, id)); } catch { throw new Error('无法读取本地库存操作，未发送请求'); }
    if (raw === null) return null;
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('本地库存操作损坏，原记录已保留，请联系维护人员'); }
    if (!value || value.version !== 1 || value.user_id !== userId || value.equipment_id !== id || !uuidPattern.test(value.payload?.request_id)
      || !Number.isSafeInteger(value.payload.delta) || value.payload.delta === 0 || Math.abs(value.payload.delta) > 4294967295) throw new Error('本地库存操作格式无效，原记录已保留');
    return value;
  }
  async function change(userId, id, guard, edit) {
    const task = () => {
      if (!guard()) throw new Error('账号或装备已变化，未发送请求');
      const before = read(userId, id);
      const after = edit(before);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        try { if (after) local().setItem(keyFor(userId, id), JSON.stringify(after)); else local().removeItem(keyFor(userId, id)); }
        catch { throw new Error('库存操作记录保存失败，请检查浏览器存储空间'); }
      }
      return after;
    };
    if (lock) return lock(task);
    if (!globalThis.navigator?.locks) throw new Error('浏览器不支持安全保存库存操作，请使用支持 Web Locks 的浏览器及本机或 HTTPS 地址');
    return globalThis.navigator.locks.request(keyFor(userId, id), task);
  }
  return {
    read,
    prepare: (userId, id, delta, guard) => change(userId, id, guard, (existing) => existing || { version: 1, user_id: userId, equipment_id: id, payload: { request_id: uuid(), delta: parseStockDelta(delta) } }),
    complete: (userId, id, requestId, guard) => change(userId, id, guard, (value) => value?.payload.request_id === requestId ? null : value),
  };
}

export const stockRejection = (reason) => ({ deleted: '装备已删除，不能调整库存', insufficient_stock: '可售库存不足，未执行减少', stock_overflow: '库存超过允许上限，未执行增加' })[reason] || '本次调整未执行';

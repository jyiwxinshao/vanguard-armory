export const GUEST_CART_KEY = 'game_store.guest_cart.v1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
export function validateGuestQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999) fail('购买数量必须是 1–9999 的整数');
}
export function validateEquipmentId(id) {
  if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295) fail('装备 ID 无效');
}
function validate(data) {
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.batches)) fail('本地购物车格式或版本不支持，原数据已保留');
  const batches = new Set();
  for (const batch of data.batches) {
    if (!batch || !uuidPattern.test(batch.batch_id) || batches.has(batch.batch_id) || !Array.isArray(batch.items) || batch.items.length > 100) fail('本地购物车批次损坏，原数据已保留');
    batches.add(batch.batch_id);
    const ids = new Set();
    for (const item of batch.items) {
      validateEquipmentId(item?.equipment_id); validateGuestQuantity(item?.quantity);
      if (ids.has(item.equipment_id)) fail('本地购物车包含重复条目，原数据已保留');
      ids.add(item.equipment_id);
    }
    if (batch.merge !== null) {
      validateEquipmentId(batch.merge?.target_user_id);
      if (batch.merge.state !== 'pending') fail('本地合并记录损坏，原数据已保留');
    }
  }
  if (data.active_batch_id !== null && !data.batches.some((batch) => batch.batch_id === data.active_batch_id && batch.merge === null)) fail('本地购物车活动批次无效，原数据已保留');
  if (data.batches.some((batch) => batch.merge === null && batch.batch_id !== data.active_batch_id)) fail('本地购物车存在未识别批次，原数据已保留');
  return data;
}

export function createGuestCartStorage({ storage, lock, uuid = () => globalThis.crypto.randomUUID() } = {}) {
  function getStorage() {
    try { return storage || globalThis.localStorage || fail('浏览器无法保存购物车'); }
    catch { return fail('浏览器无法读取或保存购物车，请检查存储权限'); }
  }
  function read() {
    const raw = getStorage().getItem(GUEST_CART_KEY);
    if (raw === null) return { version: 1, revision: 0, active_batch_id: null, batches: [] };
    let data;
    try { data = JSON.parse(raw); } catch { return fail('本地购物车内容损坏，原数据已保留'); }
    return validate(data);
  }
  function withLock(task) {
    if (lock) return lock(task);
    if (!globalThis.navigator?.locks) return Promise.reject(new Error('当前浏览器不支持安全保存购物车，请使用新版 Chrome、Edge 或 Safari，并通过 localhost 或 HTTPS 访问'));
    return globalThis.navigator.locks.request(GUEST_CART_KEY, task);
  }
  async function change(edit, guard = () => true) {
    return withLock(() => {
      if (!guard()) return fail('账号状态已变化，请重试');
      const data = read();
      const before = JSON.stringify(data);
      const result = edit(data);
      if (JSON.stringify(data) !== before) {
        data.revision += 1;
        validate(data);
        try { getStorage().setItem(GUEST_CART_KEY, JSON.stringify(data)); }
        catch { return fail('本地购物车保存失败，原数据未清除，请检查浏览器存储空间'); }
      }
      return clone(result ?? data);
    });
  }
  function active(data) {
    let batch = data.batches.find((entry) => entry.batch_id === data.active_batch_id);
    if (!batch) {
      batch = { batch_id: uuid(), items: [], merge: null };
      data.batches.push(batch); data.active_batch_id = batch.batch_id;
    }
    return batch;
  }
  return {
    read,
    ensureGuest: (guard) => change((data) => active(data), guard),
    mutate: (edit, guard) => change((data) => {
      const batch = active(data); edit(batch.items);
      if (batch.items.length > 100) fail('购物车最多容纳 100 种装备');
      return batch;
    }, guard),
    prepare: (userId, guard) => change((data) => {
      const batch = data.batches.find((entry) => entry.batch_id === data.active_batch_id);
      if (batch?.items.length) {
        batch.merge = { target_user_id: userId, state: 'pending' };
        data.active_batch_id = null;
      }
      return data.batches.filter((entry) => entry.merge?.target_user_id === userId);
    }, guard),
    acknowledge: (batch, userId, guard) => change((data) => {
      const stored = data.batches.find((entry) => entry.batch_id === batch.batch_id);
      if (!stored) return;
      if (stored.merge?.target_user_id !== userId || JSON.stringify(stored.items) !== JSON.stringify(batch.items)) fail('本地合并批次已变化，暂不清理');
      data.batches = data.batches.filter((entry) => entry !== stored);
    }, guard),
  };
}

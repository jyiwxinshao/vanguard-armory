import { randomUUID } from 'node:crypto';
import { createGuestCartStorage } from '../../src/utils/guest-cart-storage.js';
export function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}
export function storageHarness(storage = memoryStorage()) {
  let tail = Promise.resolve();
  const lock = (fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
  const create = () => createGuestCartStorage({ storage, lock, uuid: randomUUID });
  return { storage, store: create(), create };
}


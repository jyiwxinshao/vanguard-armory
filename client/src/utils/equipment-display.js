export const RARITY_META = Object.freeze([
  { value: 'SSR', label: '传说', color: '#F59E0B', rgb: '245, 158, 11' },
  { value: 'SR', label: '史诗', color: '#A855F7', rgb: '168, 85, 247' },
  { value: 'R', label: '稀有', color: '#38BDF8', rgb: '56, 189, 248' },
  { value: 'N', label: '普通', color: '#94A3B8', rgb: '148, 163, 184' },
]);

export const CATEGORY_META = Object.freeze([
  { value: 'weapon', label: '武器' },
  { value: 'armor', label: '护甲' },
  { value: 'accessory', label: '饰品' },
  { value: 'consumable', label: '道具' },
]);

export function rarityMeta(value) {
  return RARITY_META.find((item) => item.value === value) || RARITY_META[RARITY_META.length - 1];
}

export function categoryLabel(value) {
  return CATEGORY_META.find((item) => item.value === value)?.label || value;
}

export function isNewItem(item) {
  return item?.is_new === true || item?.is_new === 1;
}

export function canQuickAdd(item, cartCanWrite) {
  return Boolean(cartCanWrite) && Number(item?.stock) > 0;
}

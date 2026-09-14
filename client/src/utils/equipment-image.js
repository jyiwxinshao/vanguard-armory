export const EQUIPMENT_PLACEHOLDER = '/images/equipments/placeholder.svg';

export function equipmentImageSource(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020]/u.test(value)) return EQUIPMENT_PLACEHOLDER;
  try {
    const url = new URL(value, 'https://game-store.invalid');
    const pathname = decodeURIComponent(url.pathname);
    if (!value.startsWith('/images/equipments/') || url.origin !== 'https://game-store.invalid'
      || !pathname.startsWith('/images/equipments/') || pathname.includes('..') || /[\\\u0000-\u0020]/u.test(pathname)) return EQUIPMENT_PLACEHOLDER;
    return `${url.pathname}${url.search}`;
  } catch { return EQUIPMENT_PLACEHOLDER; }
}

export const nextEquipmentImage = (source) => source === EQUIPMENT_PLACEHOLDER ? null : EQUIPMENT_PLACEHOLDER;

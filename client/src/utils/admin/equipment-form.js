export function equipmentCreateBody(form) {
  const errors = {};
  const price = String(form.price).trim();
  const match = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(price);
  const cents = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : NaN;
  if (!Number.isInteger(cents) || cents < 1 || cents > 1000000) errors.price = '价格为 0.01–10000 元，最多两位小数';
  const body = { price: cents, rarity: form.rarity, category: form.category, status: form.status, new_until: null };
  for (const [key, max, required] of [['name', 50, true], ['image', 500, true], ['description', 500, false], ['series_code', 64, false]]) {
    const value = String(form[key] || '').trim();
    if ((required && !value) || [...value].length > max) errors[key] = `请填写${required ? '非空且' : ''}不超过 ${max} 字的内容`;
    body[key] = value || null;
  }
  for (const key of ['attack', 'defense', 'stock']) {
    const value = String(form[key]).trim();
    if (!/^\d+$/.test(value) || Number(value) > 4294967295) errors[key] = '请输入 0–4294967295 的整数';
    body[key] = Number(value);
  }
  if (form.new_until) {
    const value = String(form.new_until);
    const date = new Date(value);
    const localValue = Number.isNaN(date.getTime()) ? '' : localEquipmentDate(date);
    // datetime-local is interpreted in the browser's timezone, then sent as UTC.
    if (!/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) || localValue !== (value.length === 16 ? `${value}:00` : value)) errors.new_until = '请输入有效的本地日期与时间';
    else body.new_until = date.toISOString();
  }
  return { body, errors };
}

function localEquipmentDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function equipmentEditForm(item) {
  return {
    name: item.name, price: `${Math.floor(item.price / 100)}.${String(item.price % 100).padStart(2, '0')}`,
    rarity: item.rarity, category: item.category, image: item.image,
    attack: String(item.attack), defense: String(item.defense), status: item.status,
    description: item.description || '', series_code: item.series_code || '',
    new_until: item.new_until ? localEquipmentDate(new Date(item.new_until)) : '',
    edit_version: item.edit_version,
  };
}

export function equipmentUpdateBody(form) {
  const result = equipmentCreateBody({ ...form, stock: '0' });
  delete result.body.stock;
  result.body.edit_version = form.edit_version;
  return result;
}

export function equipmentCreateFailure(error) {
  // A timeout or 5xx can occur after commit: never invite an automatic resubmit.
  return !error.response || error.response.status >= 500;
}

const EQUIPMENT_FORM_FIELDS = ['name', 'price', 'rarity', 'category', 'image', 'attack', 'defense', 'stock', 'status', 'description', 'series_code', 'new_until'];

// Stable baseline for unsaved-change detection. Missing fields normalize to an
// empty string so create (with stock) and edit (without stock) compare safely,
// and null/undefined/whitespace never cause a false dirty.
export function equipmentFormSnapshot(form) {
  return Object.fromEntries(EQUIPMENT_FORM_FIELDS.map((key) => [key, String(form?.[key] ?? '').trim()]));
}

export function equipmentFormDirty(form, baseline) {
  if (!baseline || typeof baseline !== 'object') return false;
  return JSON.stringify(equipmentFormSnapshot(form)) !== JSON.stringify(baseline);
}

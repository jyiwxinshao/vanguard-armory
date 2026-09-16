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
    const localValue = Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    // datetime-local is interpreted in the browser's timezone, then sent as UTC.
    if (!/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || localValue !== value) errors.new_until = '请输入有效的本地日期与时间';
    else body.new_until = date.toISOString();
  }
  return { body, errors };
}

export function equipmentCreateFailure(error) {
  // A timeout or 5xx can occur after commit: never invite an automatic resubmit.
  return !error.response || error.response.status >= 500;
}

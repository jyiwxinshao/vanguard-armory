const moneyFormatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });
export const formatMoney = (cents) => moneyFormatter.format(cents / 100);

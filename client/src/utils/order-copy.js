import { copyToClipboard } from './clipboard.js';

export async function copyOrderNumber(orderNo, { notify, clipboard } = {}) {
  const result = await copyToClipboard(orderNo, { clipboard });
  if (result.ok) notify?.success?.('订单号已复制');
  else notify?.error?.('复制失败，请手动复制');
  return result.ok;
}

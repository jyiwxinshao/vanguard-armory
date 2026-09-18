import { ElMessageBox } from 'element-plus';
import 'element-plus/es/components/message-box/style/css';

export async function confirmEquipmentLeave() {
  try {
    await ElMessageBox.confirm('当前装备资料尚未保存，离开后修改将丢失。确定离开吗？', '未保存的修改', {
      confirmButtonText: '确认离开',
      cancelButtonText: '继续编辑',
      type: 'warning',
    });
    return true;
  } catch {
    return false;
  }
}

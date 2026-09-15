import { ElMessage } from 'element-plus';
import 'element-plus/es/components/message/style/css';

const DURATION = 2800;

function show(message, type) {
  return ElMessage({
    message,
    type,
    duration: DURATION,
    customClass: 'vanguard-message',
    showClose: false,
    grouping: false,
    offset: 20,
  });
}

export const notify = {
  success: (message) => show(message, 'success'),
  info: (message) => show(message, 'info'),
  warning: (message) => show(message, 'warning'),
  error: (message) => show(message, 'error'),
};

export default notify;

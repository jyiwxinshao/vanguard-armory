import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './config/database.js';

const server = createApp().listen(env.port, env.host, () => {
  console.log(`API: http://${env.host}:${env.port}`);
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${env.port} 已被占用，请停止旧服务或修改 server/.env 中的 PORT` : `启动失败：${error.code || 'UNKNOWN'}`);
  process.exitCode = 1;
  void closePool();
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

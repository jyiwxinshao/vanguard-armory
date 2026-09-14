import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  // Only these non-secret values enter the Vite configuration, never client code.
  const serverEnv = loadEnv(mode, fileURLToPath(new URL('../server', import.meta.url)), ['HOST', 'PORT']);
  return {
    plugins: [vue()],
    server: {
      proxy: { '/api': { target: `http://${serverEnv.HOST || '127.0.0.1'}:${serverEnv.PORT || '3000'}` } },
    },
  };
});

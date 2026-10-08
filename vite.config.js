import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'url';

const port = Number(process.env.PORT) || 8090;

export default defineConfig({
  root: 'client',
  plugins: [vue()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': `http://localhost:${port}`,
      '/webhook': `http://localhost:${port}`,
    },
  },
});

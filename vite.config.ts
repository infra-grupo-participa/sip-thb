import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// App único (host único): o front mora em src/web e o build sai em dist/web,
// que o Express serve em produção. Em dev, Vite (:5173) faz proxy de /api → :3000.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
});

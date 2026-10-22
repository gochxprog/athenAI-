// Versión 2 de AthenAI: se compila a dist/v2 y la grabadora la sirve en /v2/ (la versión actual sigue en /).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const aqui = (r: string) => fileURLToPath(new URL(r, import.meta.url));

export default defineConfig({
  root: aqui('.'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': aqui('../src'), '@v2': aqui('./src') } },
  // En desarrollo, la API va a una grabadora (VPS=http://ip:8080 npm run v2:dev).
  server: { proxy: { '/api': process.env.VPS ?? 'http://localhost:8080' } },
  build: { outDir: aqui('../dist/v2'), emptyOutDir: true, chunkSizeWarningLimit: 800 },
});

// Versión 2 de AthenAI: se compila a dist/v2 y la grabadora la sirve en /v2/ (la versión actual sigue en /).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import tailwind from 'tailwindcss';
import base from '../tailwind.config.js';

const aqui = (r: string) => fileURLToPath(new URL(r, import.meta.url));

export default defineConfig({
  root: aqui('.'),
  base: './',
  plugins: [react()],
  // Tailwind solo para las vistas del Juez que se reutilizan de la plataforma vieja (mismo código, mismo aspecto).
  css: { postcss: { plugins: [tailwind({ ...base, corePlugins: { preflight: false }, content: [aqui('./src/**/*.tsx'), aqui('../src/components/laboratorio/vista/*.tsx'), aqui('../src/components/charts/AbanicoTrayectorias.tsx')] })] } },
  resolve: { alias: { '@': aqui('../src'), '@v2': aqui('./src') } },
  // En desarrollo, la API va a una grabadora (VPS=http://ip:8080 npm run v2:dev).
  server: { proxy: { '/api': process.env.VPS ?? 'http://localhost:8080' } },
  build: { outDir: aqui('../dist/v2'), emptyOutDir: true, chunkSizeWarningLimit: 800 },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';

// Python en el navegador (Pyodide) servido desde la propia app: funciona sin internet y sin CDN.
const PYODIDE = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const origen = fileURLToPath(new URL('./node_modules/pyodide/', import.meta.url));
const destino = fileURLToPath(new URL('./public/pyodide/', import.meta.url));
if (existsSync(origen)) {
  mkdirSync(destino, { recursive: true });
  // Se recopia si cambia el tamaño (otra versión de pyodide).
  for (const f of PYODIDE) if (!existsSync(destino + f) || statSync(destino + f).size !== statSync(origen + f).size) copyFileSync(origen + f, destino + f);
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // three.js por sí solo ronda los 690 kB; se carga aparte y solo en los módulos 3D.
    chunkSizeWarningLimit: 800,
  },
});

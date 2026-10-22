// Empaqueta la grabadora en un solo archivo (grabadora/dist/grabadora.mjs) que corre con Node 22, sin npm install.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const comun = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@': `${raiz}src` },
  logLevel: 'info',
};
await build({ ...comun, entryPoints: [`${raiz}grabadora/grabadora.ts`], outfile: `${raiz}grabadora/dist/grabadora.mjs`, banner: { js: '// Grabadora 24/7 de athenAI · generado con «npm run grabadora:build»' } });
// Importador de la historia de Binance (se corre aparte, a mano: importar.sh).
await build({ ...comun, entryPoints: [`${raiz}grabadora/importador.ts`], outfile: `${raiz}grabadora/dist/importar.mjs`, banner: { js: '// Importador de historia de athenAI · generado con «npm run grabadora:build»' } });

// Empaqueta la grabadora en un solo archivo (grabadora/dist/grabadora.mjs) que corre con Node 22, sin npm install.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
await build({
  entryPoints: [`${raiz}grabadora/grabadora.ts`],
  outfile: `${raiz}grabadora/dist/grabadora.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@': `${raiz}src` },
  banner: { js: '// Grabadora 24/7 de athenAI · generado con «npm run grabadora:build»' },
  logLevel: 'info',
});

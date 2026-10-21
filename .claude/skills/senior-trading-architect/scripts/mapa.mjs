// Mapa del código de AthenAI: por carpeta, cada archivo con lo que importa (interno), quién lo importa y su prueba.
// Uso: node .claude/skills/senior-trading-architect/scripts/mapa.mjs   → escribe MAPA.md junto a SKILL.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../../..');
const CARPETAS = ['src', 'grabadora'];
const EXT = ['.ts', '.tsx', '.mjs'];

const archivos = [];
const recorrer = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) recorrer(p);
    else if (EXT.includes(path.extname(e.name))) archivos.push(p);
  }
};
for (const c of CARPETAS) if (fs.existsSync(path.join(RAIZ, c))) recorrer(path.join(RAIZ, c));

const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');
const resolver = (desde, spec) => {
  let base;
  if (spec.startsWith('@/')) base = path.join(RAIZ, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(desde), spec);
  else return null;
  for (const s of ['', ...EXT, '/index.ts', '/index.tsx']) if (fs.existsSync(base + s) && fs.statSync(base + s).isFile()) return rel(base + s);
  return null;
};

const esPrueba = (r) => /\.test\.tsx?$/.test(r);
const importa = new Map();
const loImportan = new Map();
for (const a of archivos) {
  const r = rel(a);
  const texto = fs.readFileSync(a, 'utf8');
  const deps = new Set();
  for (const m of texto.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const d = resolver(a, m[1] ?? m[2]);
    if (d) deps.add(d);
  }
  importa.set(r, [...deps].sort());
  for (const d of deps) loImportan.set(d, [...(loImportan.get(d) ?? []), r]);
}

const grupos = new Map();
for (const r of [...importa.keys()].filter((x) => !esPrueba(x)).sort()) {
  const g = path.posix.dirname(r);
  grupos.set(g, [...(grupos.get(g) ?? []), r]);
}

const corto = (r) => r.replace(/^src\//, '');
let md = `# Mapa del código · AthenAI\n\nGenerado por \`scripts/mapa.mjs\` (${archivos.length} archivos). Leer esto antes de explorar.\n`;
md += 'Formato: `archivo` → importa · ← lo importan · 🧪 prueba\n';
for (const [g, lista] of grupos) {
  md += `\n## ${corto(g)}\n`;
  for (const r of lista) {
    const imp = importa.get(r).filter((x) => !esPrueba(x)).map((x) => path.posix.basename(x)).join(', ');
    const por = (loImportan.get(r) ?? []).filter((x) => !esPrueba(x));
    const pruebas = (loImportan.get(r) ?? []).filter(esPrueba).map((x) => path.posix.basename(x));
    md += `- \`${path.posix.basename(r)}\``;
    if (imp) md += ` → ${imp}`;
    if (por.length) md += ` · ← ${por.length <= 4 ? por.map((x) => path.posix.basename(x)).join(', ') : `${por.length} archivos`}`;
    if (pruebas.length) md += ` · 🧪 ${pruebas.join(', ')}`;
    md += '\n';
  }
}
fs.writeFileSync(path.join(AQUI, '..', 'MAPA.md'), md);
console.log(`MAPA.md: ${grupos.size} carpetas, ${[...grupos.values()].flat().length} archivos.`);

// Auditoría visual sin cabeza: recorre los 11 módulos y las pestañas del Juez, captura cada uno y falla si hay
// errores de página o de consola. Uso (con `npx vite preview --port 4173` corriendo):
//   node .claude/skills/senior-trading-architect/scripts/auditoria-visual.cjs <carpeta> [http://localhost:4173]
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')));
}

const carpeta = process.argv[2] || 'auditoria';
const base = (process.argv[3] || 'http://localhost:4173').replace(/\/$/, '');
const MODULOS = ['panel', 'orderflow', 'laboratorio', 'investigacion', 'estrategias', 'conocimiento', 'agentes', 'paper', 'decisiones', 'maquinas', 'datos'];

(async () => {
  fs.mkdirSync(carpeta, { recursive: true });
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const b = await chromium.launch(exe).catch(() => chromium.launch());
  const errores = [];
  const avisosRed = [];
  for (const [nombre, vista] of [['pc', { width: 1280, height: 1000 }], ['movil', { width: 390, height: 900 }]]) {
    const p = await (await b.newContext({ viewport: vista })).newPage();
    p.on('pageerror', (e) => errores.push(`${nombre} · página: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      // Recursos externos que la red del entorno bloquea (Binance, fuentes): aviso, no fallo de la plataforma.
      if (/Failed to load resource: net::ERR_/.test(m.text())) avisosRed.push(`${nombre} · ${m.text()}`);
      else errores.push(`${nombre} · consola: ${m.text()}`);
    });
    for (const m of MODULOS) {
      await p.goto(`${base}/#/${m}`);
      await p.waitForTimeout(2500);
      await p.screenshot({ path: path.join(carpeta, `${nombre}-${m}.png`) });
    }
    // Pestañas del Juez (solo si hay resultados guardados).
    await p.goto(`${base}/#/laboratorio`);
    await p.waitForTimeout(1500);
    const lab = p.locator('[data-modo-lab="resultados"]');
    if (await lab.count()) {
      await lab.click();
      await p.waitForTimeout(1500);
      for (const id of await p.locator('[data-pestana-juez]').evaluateAll((xs) => xs.map((x) => x.dataset.pestanaJuez))) {
        await p.locator(`[data-pestana-juez="${id}"]`).click();
        await p.waitForTimeout(1200);
        await p.screenshot({ path: path.join(carpeta, `${nombre}-juez-${id}.png`) });
      }
    }
  }
  await b.close();
  if (avisosRed.length) console.log(`Avisos de red (no cuentan): ${avisosRed.length}`);
  console.log(errores.length ? `ERRORES (${errores.length}):\n${errores.join('\n')}` : `OK · 0 errores · capturas en ${carpeta}`);
  process.exit(errores.length ? 1 : 0);
})();

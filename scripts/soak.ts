// Prueba de resistencia: N horas de mercado DEMO a través del pipeline completo.
// Mide, hora a hora, el tiempo de proceso por minuto de mercado y la memoria tras forzar el GC.
// Uso: node --expose-gc node_modules/vite-node/vite-node.mjs scripts/soak.ts 8
import { GeneradorDemo } from '../src/motores/fuentes/demo';
import { Pipeline } from '../src/motores/nucleo/pipeline';

const horas = Number(process.argv[2] ?? 8);
const gen = new GeneradorDemo(99);
const p = new Pipeline();
const gc = (globalThis as { gc?: () => void }).gc;
const filas: string[] = ['hora,ms_pipeline_por_min,heap_mb,trades_cinta,columnas_lhm,rachas_pools,eventos,filas_features'];
for (let h = 1; h <= horas; h += 1) {
  let msPipeline = 0;
  for (let m = 0; m < 60; m += 1) {
    const msgs = gen.avanzar(60_000);
    const t0 = performance.now();
    for (const msg of msgs) p.procesar(msg);
    // El gráfico pide estado ~4 veces por segundo en vivo; aquí 1 por minuto para medir su coste.
    p.estado({ nBarras: 200, footprint: true, nivelesFootprint: 80 });
    msPipeline += performance.now() - t0;
  }
  gc?.();
  const mem = p.estado({ nBarras: 10, footprint: false, nivelesFootprint: 0 }).memoria;
  filas.push([h, (msPipeline / 60).toFixed(1), (process.memoryUsage().heapUsed / 1e6).toFixed(1), mem.cinta, mem.columnasLhm, mem.rachasPools, mem.eventos, mem.filasFeatures].join(','));
  console.log(filas[filas.length - 1]);
}
console.log('\n' + filas.join('\n'));

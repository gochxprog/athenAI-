import { GeneradorDemo } from '../src/motores/fuentes/demo';
import { Pipeline } from '../src/motores/nucleo/pipeline';

const minutos = Number(process.argv[2] ?? 10);
const gen = new GeneradorDemo(11);
const p = new Pipeline();
const tiempos: Record<string, number> = { generador: 0, trades: 0, libro: 0, oi: 0 };
const cuenta: Record<string, number> = { trades: 0, libro: 0, oi: 0 };
for (let m = 0; m < minutos; m += 1) {
  let t0 = performance.now();
  const msgs = gen.avanzar(60_000);
  tiempos.generador += performance.now() - t0;
  for (const msg of msgs) {
    t0 = performance.now();
    p.procesar(msg);
    const dt = performance.now() - t0;
    if (msg.tipo === 'trades') { tiempos.trades += dt; cuenta.trades += msg.trades.length; }
    else if (msg.tipo === 'libro') { tiempos.libro += dt; cuenta.libro += 1; }
    else if (msg.tipo === 'oi') { tiempos.oi += dt; cuenta.oi += 1; }
  }
}
console.log(JSON.stringify({ minutos, tiempos: Object.fromEntries(Object.entries(tiempos).map(([k, v]) => [k, Math.round(v)])), cuenta, msPorMinutoSimulado: Math.round(Object.values(tiempos).reduce((a, b) => a + b, 0) / minutos) }));

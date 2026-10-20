// Comprueba que la cinta DEMO tiene magnitudes realistas.
import { GeneradorDemo } from '../src/motores/fuentes/demo';
import { Pipeline } from '../src/motores/nucleo/pipeline';
const g = new GeneradorDemo(5);
const p = new Pipeline();
let min = Infinity, max = -Infinity;
const rangos: number[] = [];
for (let m = 0; m < 180; m += 1) {
  let lo = Infinity, hi = -Infinity;
  for (const msg of g.avanzar(60_000)) {
    p.procesar(msg);
    if (msg.tipo === 'trades') for (const t of msg.trades) { lo = Math.min(lo, t.price); hi = Math.max(hi, t.price); }
  }
  rangos.push(hi - lo); min = Math.min(min, lo); max = Math.max(max, hi);
}
const tipos: Record<string, number> = {};
for (const e of p.mercado.eventos.ultimos(600)) tipos[e.tipo] = (tipos[e.tipo] ?? 0) + 1;
const pools = p.mercado.poolsVivos().map((x) => x.volume.toFixed(0));
console.log({ min, max, rangoMedio1m: (rangos.reduce((a, b) => a + b) / rangos.length).toFixed(1), eventos600: tipos, pools, filas: p.todasLasFilas().length });

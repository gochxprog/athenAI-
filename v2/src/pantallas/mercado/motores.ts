// Lectura de cada motor a partir de las últimas filas que grabó el VPS (≈ 30 min). Solo lee los valores que ya
// calcularon los motores: aquí no se calcula nada nuevo. `lado`: 1 compradores · −1 vendedores · 0 neutro.
import type { Fila } from '../../vps';

export interface Lectura { texto: string; lado: -1 | 0 | 1; fuerza: number }
export interface Motor { id: string; nombre: string; explica: string; clave: string[]; leer: (f: Fila[]) => Lectura }

const v = (f: Fila | undefined, k: string) => f?.valores[k] ?? null;
const ult = (f: Fila[], n: number) => f.slice(-n);
const suma = (f: Fila[], k: string) => f.reduce((s, x) => s + (x.valores[k] ?? 0), 0);
const max = (f: Fila[], k: string) => f.reduce((m, x) => Math.max(m, x.valores[k] ?? 0), 0);
const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;
const nada: Lectura = { texto: '—', lado: 0, fuerza: 0 };
/** Dos lados (comprador/vendedor) de un mismo motor: gana el más fuerte. */
const duelo = (c: number, ve: number, txt: (lado: 'compra' | 'venta', x: number) => string, escala = 1): Lectura =>
  !c && !ve ? { texto: 'Nada', lado: 0, fuerza: 0 } : c >= ve ? { texto: txt('compra', c), lado: 1, fuerza: Math.min(1, c / escala) } : { texto: txt('venta', ve), lado: -1, fuerza: Math.min(1, ve / escala) };

export const MOTORES: Motor[] = [
  {
    id: 'flujo', nombre: 'Flujo', clave: ['flujo_5_ratio'],
    explica: 'Quién está agrediendo en las últimas 5 barras: compras a mercado contra ventas a mercado. Más de 15 % hacia un lado ya es dominio.',
    leer: (f) => {
      const x = v(f.at(-1), 'flujo_5_ratio');
      if (x === null) return nada;
      return { texto: Math.abs(x) < 0.15 ? `Equilibrio (${x >= 0 ? '+' : '−'}${pct(x)})` : `${x > 0 ? 'Compradores' : 'Vendedores'} ${pct(x)}`, lado: Math.abs(x) < 0.15 ? 0 : x > 0 ? 1 : -1, fuerza: Math.min(1, Math.abs(x) * 2) };
    },
  },
  {
    id: 'cvd', nombre: 'CVD de la sesión', clave: ['cvd_sesion_ratio'],
    explica: 'Delta acumulado de la sesión sobre el volumen: si en toda la sesión mandan los compradores o los vendedores.',
    leer: (f) => {
      const x = v(f.at(-1), 'cvd_sesion_ratio');
      return x === null ? nada : { texto: `${x >= 0 ? 'Compradores' : 'Vendedores'} ${pct(x)}`, lado: Math.abs(x) < 0.05 ? 0 : x > 0 ? 1 : -1, fuerza: Math.min(1, Math.abs(x) * 4) };
    },
  },
  {
    id: 'absorcion', nombre: 'Absorción', clave: ['absorcion_bid', 'absorcion_ask'],
    explica: 'Alguien grande se come las agresiones sin dejar mover el precio. En el bid = absorben ventas (soporte); en el ask = absorben compras (techo). Score 0–100.',
    leer: (f) => duelo(max(ult(f, 10), 'absorcion_bid'), max(ult(f, 10), 'absorcion_ask'), (l, x) => `${l === 'compra' ? 'En el bid' : 'En el ask'} · ${Math.round(x)}`, 100),
  },
  {
    id: 'bigtrades', nombre: 'Big trades', clave: ['bigtrades_compra_frac', 'bigtrades_venta_frac'],
    explica: 'Bloques grandes a mercado: qué parte del volumen reciente fue de órdenes gordas compradoras o vendedoras.',
    leer: (f) => duelo(suma(ult(f, 10), 'bigtrades_compra_frac') / 10, suma(ult(f, 10), 'bigtrades_venta_frac') / 10, (l, x) => `${l === 'compra' ? 'Compran' : 'Venden'} grande · ${pct(x)} del volumen`, 0.3),
  },
  {
    id: 'icebergs', nombre: 'Icebergs', clave: ['icebergs_bid', 'icebergs_ask'],
    explica: 'Órdenes escondidas que se recargan en el mismo precio. Muchos en el bid = alguien defiende comprando; en el ask = defiende vendiendo.',
    leer: (f) => duelo(suma(f, 'icebergs_bid'), suma(f, 'icebergs_ask'), (l, x) => `${x} en el ${l === 'compra' ? 'bid' : 'ask'} · 30 min`, 5),
  },
  {
    id: 'stopruns', nombre: 'Stop runs', clave: ['stoprun_alto', 'stoprun_bajo'],
    explica: 'Barridos de stops: el precio pasa un máximo o mínimo, salta los stops y vuelve. Barrer mínimos suele preceder rebotes; barrer máximos, caídas.',
    leer: (f) => duelo(suma(f, 'stoprun_bajo'), suma(f, 'stoprun_alto'), (l, x) => `Barrió ${l === 'compra' ? 'mínimos' : 'máximos'} ×${x} · 30 min`, 3),
  },
  {
    id: 'agotamiento', nombre: 'Agotamiento', clave: ['agotamiento_prev_alcista', 'agotamiento_prev_bajista'],
    explica: 'El lado que empujaba se queda sin fuerza: mucho volumen y el precio ya no avanza. Agotamiento vendedor apunta arriba; comprador, abajo.',
    leer: (f) => duelo(max(ult(f, 10), 'agotamiento_prev_bajista'), max(ult(f, 10), 'agotamiento_prev_alcista'), (l) => (l === 'compra' ? 'Vendedores cansados' : 'Compradores cansados'), 100),
  },
  {
    id: 'oi', nombre: 'Open Interest', clave: ['oi_delta_pct', 'oi_cuadrante'],
    explica: 'Posiciones abiertas en futuros. Sube con el precio = largos nuevos; sube con precio bajando = cortos nuevos; baja = se cierran posiciones.',
    leer: (f) => {
      const d = suma(f, 'oi_delta_pct');
      const c = v(f.at(-1), 'oi_cuadrante');
      const q = ['neutral', 'largos nuevos', 'cubren cortos', 'cortos nuevos', 'liquidan largos'][c ?? 0] ?? 'neutral';
      return f.length ? { texto: `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)} % · ${q}`, lado: c === 1 || c === 2 ? 1 : c === 3 || c === 4 ? -1 : 0, fuerza: Math.min(1, Math.abs(d) / 2) } : nada;
    },
  },
  {
    id: 'liq', nombre: 'Liquidaciones', clave: ['liq_largos_frac', 'liq_cortos_frac'],
    explica: 'Posiciones cerradas a la fuerza. Liquidan largos = ventas forzadas (presión abajo); liquidan cortos = compras forzadas (presión arriba).',
    leer: (f) => duelo(suma(f, 'liq_cortos_frac'), suma(f, 'liq_largos_frac'), (l) => `Liquidan ${l === 'compra' ? 'cortos' : 'largos'}`, 0.5),
  },
  {
    id: 'libro', nombre: 'Libro (DOM)', clave: ['obi_10'],
    explica: 'Desequilibrio de las 10 primeras filas del libro: más órdenes de compra esperando (soporte) o de venta (resistencia).',
    leer: (f) => {
      const x = v(f.at(-1), 'obi_10');
      return x === null ? nada : { texto: `${Math.abs(x) < 0.1 ? 'Parejo' : x > 0 ? 'Más compra esperando' : 'Más venta esperando'} · ${x >= 0 ? '+' : '−'}${pct(x)}`, lado: Math.abs(x) < 0.1 ? 0 : x > 0 ? 1 : -1, fuerza: Math.min(1, Math.abs(x)) };
    },
  },
  {
    id: 'funding', nombre: 'Funding', clave: ['funding_tasa'],
    explica: 'Lo que pagan los largos a los cortos cada 8 h. Muy positivo = muchos largos apalancados (riesgo de barrido abajo); negativo = al revés.',
    leer: (f) => {
      const x = v(f.at(-1), 'funding_tasa');
      return x === null ? nada : { texto: `${(x * 100).toFixed(4)} % · ${x > 0 ? 'pagan los largos' : x < 0 ? 'pagan los cortos' : 'neutro'}`, lado: 0, fuerza: Math.min(1, Math.abs(x) / 0.0005) };
    },
  },
  {
    id: 'evento', nombre: 'Eventos fuertes', clave: ['ventana_evento'],
    explica: 'FOMC, CPI, NFP… En la ventana de un evento fuerte los bots no deberían abrir: el mercado se vuelve loco.',
    leer: (f) => (v(f.at(-1), 'ventana_evento') ? { texto: 'Dentro de la ventana · no operar', lado: -1, fuerza: 1 } : { texto: 'Sin eventos ahora', lado: 0, fuerza: 0 }),
  },
];

/** Últimos momentos en que el motor marcó algo (para la explicación de la tarjeta). */
export const eventos = (m: Motor, f: Fila[]) => f.filter((x) => m.clave.some((k) => (x.valores[k] ?? 0) !== 0 && !k.endsWith('ratio') && k !== 'obi_10' && k !== 'funding_tasa' && k !== 'oi_delta_pct')).slice(-5).reverse();

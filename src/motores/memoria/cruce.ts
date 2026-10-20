// Cruce entre mercados (por ejemplo BTC frente a XAU).
// Las dollar bars de cada activo no caen a la misma hora, así que se alinean en una rejilla de 5 min
// (último cierre conocido en cada punto) y se mide la correlación de los retornos.
// Un patrón que aparece en dos mercados poco correlacionados es más fiable: esa prueba la hará el Juez (Bloque C).

export interface SerieCierres {
  simbolo: string;
  /** Ordenadas por cierre ascendente. */
  puntos: { cierre: number; close: number }[];
}

export interface CruceMercados {
  a: string;
  b: string;
  /** Correlación de los retornos de 5 min en la ventana (null si hay pocos puntos). */
  correlacion: number | null;
  puntos: number;
}

const PASO = 300_000;
const MIN_PUNTOS = 30;

function rejilla(serie: SerieCierres['puntos'], tiempos: number[]): (number | null)[] {
  const out: (number | null)[] = [];
  let j = -1;
  for (const t of tiempos) {
    while (j + 1 < serie.length && serie[j + 1].cierre <= t) j += 1;
    // Sin dato reciente (más de 3 pasos) se considera ausente: no se rellena un mercado cerrado.
    out.push(j >= 0 && t - serie[j].cierre <= 3 * PASO ? serie[j].close : null);
  }
  return out;
}

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < MIN_PUNTOS) return null;
  const mx = x.reduce((a, v) => a + v, 0) / n;
  const my = y.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function cruzarMercados(series: readonly SerieCierres[], ahora: number, ventanaMs = 86_400_000): CruceMercados[] {
  const desde = Math.floor((ahora - ventanaMs) / PASO) * PASO;
  const tiempos: number[] = [];
  for (let t = desde; t <= ahora; t += PASO) tiempos.push(t);
  const alineadas = series.map((s) => rejilla(s.puntos, tiempos));
  const out: CruceMercados[] = [];
  for (let i = 0; i < series.length; i += 1) {
    for (let j = i + 1; j < series.length; j += 1) {
      const ra: number[] = [];
      const rb: number[] = [];
      for (let k = 1; k < tiempos.length; k += 1) {
        const a0 = alineadas[i][k - 1];
        const a1 = alineadas[i][k];
        const b0 = alineadas[j][k - 1];
        const b1 = alineadas[j][k];
        if (a0 && a1 && b0 && b1) {
          ra.push(Math.log(a1 / a0));
          rb.push(Math.log(b1 / b0));
        }
      }
      out.push({ a: series[i].simbolo, b: series[j].simbolo, correlacion: pearson(ra, rb), puntos: ra.length });
    }
  }
  return out;
}

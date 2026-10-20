// Modelo oculto de Markov (HMM) gaussiano con covarianza diagonal.
//
// El mercado pasa por "estados" que no se ven directamente (rango, tendencia, día raro); lo que sí se ve son
// las Features de cada barra. El HMM aprende:
//   - cómo son las Features en cada estado (media y varianza de cada dimensión);
//   - con qué probabilidad se pasa de un estado a otro (matriz de transición: los regímenes duran).
// Entrenamiento: Baum-Welch (EM) con forward-backward escalado. Uso en vivo: SOLO el filtro forward,
// que usa información hasta la barra actual (nunca mira al futuro).
import { crearAleatorio } from '@/lib/random';

export interface ModeloHMM {
  k: number;
  d: number;
  pi: number[];
  a: number[][];
  medias: number[][];
  varianzas: number[][];
  logVerosimilitud: number;
  iteraciones: number;
}

const VAR_MIN = 1e-3;
const LOG_2PI = Math.log(2 * Math.PI);

function logGauss(x: readonly number[], mu: readonly number[], v: readonly number[]): number {
  let s = 0;
  for (let j = 0; j < x.length; j += 1) {
    const dif = x[j] - mu[j];
    s += -0.5 * (LOG_2PI + Math.log(v[j]) + (dif * dif) / v[j]);
  }
  return s;
}

/** Probabilidades de emisión por barra y estado, escaladas por barra para evitar desbordes. */
function emisiones(m: ModeloHMM, x: readonly (readonly number[])[]): { b: Float64Array; escala: Float64Array } {
  const n = x.length;
  const b = new Float64Array(n * m.k);
  const escala = new Float64Array(n);
  const lg = new Float64Array(m.k);
  for (let t = 0; t < n; t += 1) {
    let max = -Infinity;
    for (let i = 0; i < m.k; i += 1) {
      lg[i] = logGauss(x[t], m.medias[i], m.varianzas[i]);
      if (lg[i] > max) max = lg[i];
    }
    escala[t] = max;
    for (let i = 0; i < m.k; i += 1) b[t * m.k + i] = Math.exp(lg[i] - max);
  }
  return { b, escala };
}

/** k-means con inicialización k-means++ (semilla fija): punto de partida estable para EM. */
function kmedias(x: readonly (readonly number[])[], k: number, semilla: number): number[][] {
  const r = crearAleatorio(semilla);
  const d = x[0].length;
  const dist2 = (p: readonly number[], q: readonly number[]) => p.reduce((s, v, j) => s + (v - q[j]) ** 2, 0);
  const centros: number[][] = [[...x[Math.floor(r() * x.length)]]];
  while (centros.length < k) {
    const ds = x.map((p) => Math.min(...centros.map((c) => dist2(p, c))));
    const total = ds.reduce((a, v) => a + v, 0);
    let u = r() * total;
    let elegido = 0;
    for (let i = 0; i < ds.length; i += 1) {
      u -= ds[i];
      if (u <= 0) {
        elegido = i;
        break;
      }
    }
    centros.push([...x[elegido]]);
  }
  for (let it = 0; it < 15; it += 1) {
    const suma = centros.map(() => new Array(d).fill(0));
    const cuenta = new Array(k).fill(0);
    for (const p of x) {
      let mejor = 0;
      let dm = Infinity;
      centros.forEach((c, i) => {
        const dd = dist2(p, c);
        if (dd < dm) {
          dm = dd;
          mejor = i;
        }
      });
      cuenta[mejor] += 1;
      p.forEach((v, j) => (suma[mejor][j] += v));
    }
    centros.forEach((c, i) => {
      if (cuenta[i] > 0) for (let j = 0; j < d; j += 1) c[j] = suma[i][j] / cuenta[i];
    });
  }
  return centros;
}

/** Entrena un HMM gaussiano de `k` estados con Baum-Welch. */
export function entrenarHMM(x: readonly (readonly number[])[], k = 3, opciones: { iteraciones?: number; tolerancia?: number; semilla?: number } = {}): ModeloHMM {
  const n = x.length;
  const d = x[0]?.length ?? 0;
  if (n < k * 10 || d === 0) throw new Error(`Datos insuficientes para el HMM (${n} barras)`);
  const maxIt = opciones.iteraciones ?? 60;
  const tol = opciones.tolerancia ?? 1e-4;

  // Varianza global como punto de partida y piso.
  const mediaG = new Array(d).fill(0);
  for (const p of x) p.forEach((v, j) => (mediaG[j] += v / n));
  const varG = new Array(d).fill(0);
  for (const p of x) p.forEach((v, j) => (varG[j] += (v - mediaG[j]) ** 2 / n));

  const m: ModeloHMM = {
    k,
    d,
    pi: new Array(k).fill(1 / k),
    a: Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 0.9 : 0.1 / (k - 1)))),
    medias: kmedias(x, k, opciones.semilla ?? 7),
    varianzas: Array.from({ length: k }, () => varG.map((v) => Math.max(v, VAR_MIN))),
    logVerosimilitud: -Infinity,
    iteraciones: 0,
  };

  const alfa = new Float64Array(n * k);
  const beta = new Float64Array(n * k);
  const c = new Float64Array(n);
  let previa = -Infinity;

  for (let it = 0; it < maxIt; it += 1) {
    const { b, escala } = emisiones(m, x);
    // Forward escalado.
    for (let t = 0; t < n; t += 1) {
      let s = 0;
      for (let j = 0; j < k; j += 1) {
        let acc = 0;
        if (t === 0) acc = m.pi[j];
        else for (let i = 0; i < k; i += 1) acc += alfa[(t - 1) * k + i] * m.a[i][j];
        const v = acc * b[t * k + j];
        alfa[t * k + j] = v;
        s += v;
      }
      c[t] = s > 0 ? s : 1e-300;
      for (let j = 0; j < k; j += 1) alfa[t * k + j] /= c[t];
    }
    let ll = 0;
    for (let t = 0; t < n; t += 1) ll += Math.log(c[t]) + escala[t];
    // Backward escalado.
    for (let j = 0; j < k; j += 1) beta[(n - 1) * k + j] = 1;
    for (let t = n - 2; t >= 0; t -= 1) {
      for (let i = 0; i < k; i += 1) {
        let acc = 0;
        for (let j = 0; j < k; j += 1) acc += m.a[i][j] * b[(t + 1) * k + j] * beta[(t + 1) * k + j];
        beta[t * k + i] = acc / c[t + 1];
      }
    }
    // Paso M.
    const gammaSum = new Array(k).fill(0);
    const xiSum = Array.from({ length: k }, () => new Array(k).fill(0));
    const mu = Array.from({ length: k }, () => new Array(d).fill(0));
    const sq = Array.from({ length: k }, () => new Array(d).fill(0));
    const gammaSinUltima = new Array(k).fill(0);
    for (let t = 0; t < n; t += 1) {
      for (let i = 0; i < k; i += 1) {
        const g = alfa[t * k + i] * beta[t * k + i];
        gammaSum[i] += g;
        if (t < n - 1) gammaSinUltima[i] += g;
        for (let j = 0; j < d; j += 1) {
          mu[i][j] += g * x[t][j];
          sq[i][j] += g * x[t][j] * x[t][j];
        }
        if (t === 0) m.pi[i] = g;
      }
      if (t < n - 1) {
        for (let i = 0; i < k; i += 1) {
          for (let j = 0; j < k; j += 1) xiSum[i][j] += (alfa[t * k + i] * m.a[i][j] * b[(t + 1) * k + j] * beta[(t + 1) * k + j]) / c[t + 1];
        }
      }
    }
    for (let i = 0; i < k; i += 1) {
      const gs = Math.max(gammaSum[i], 1e-9);
      for (let j = 0; j < d; j += 1) {
        const media = mu[i][j] / gs;
        m.medias[i][j] = media;
        m.varianzas[i][j] = Math.max(sq[i][j] / gs - media * media, VAR_MIN);
      }
      const filas = xiSum[i].reduce((a, v) => a + v, 0) || 1;
      for (let j = 0; j < k; j += 1) m.a[i][j] = Math.max(xiSum[i][j] / filas, 1e-6);
      const norm = m.a[i].reduce((a, v) => a + v, 0);
      for (let j = 0; j < k; j += 1) m.a[i][j] /= norm;
    }
    const sp = m.pi.reduce((a, v) => a + v, 0) || 1;
    m.pi = m.pi.map((v) => Math.max(v / sp, 1e-6));
    m.logVerosimilitud = ll;
    m.iteraciones = it + 1;
    if (Math.abs(ll - previa) < tol * Math.max(1, Math.abs(ll))) break;
    previa = ll;
  }
  return m;
}

/**
 * Filtro forward: probabilidad de cada estado en cada barra usando SOLO la información hasta esa barra.
 * Es lo que se usa en vivo y en la validación fuera de muestra (sin mirar al futuro).
 */
export function filtrarHMM(m: ModeloHMM, x: readonly (readonly number[])[]): number[][] {
  const out: number[][] = [];
  let prev: number[] | null = null;
  for (const p of x) {
    const lg = m.medias.map((mu, i) => logGauss(p, mu, m.varianzas[i]));
    const max = Math.max(...lg);
    const actual: number[] = new Array(m.k);
    let s = 0;
    for (let j = 0; j < m.k; j += 1) {
      let prior = 0;
      if (!prev) prior = m.pi[j];
      else for (let i = 0; i < m.k; i += 1) prior += prev[i] * m.a[i][j];
      actual[j] = prior * Math.exp(lg[j] - max);
      s += actual[j];
    }
    for (let j = 0; j < m.k; j += 1) actual[j] = s > 0 ? actual[j] / s : 1 / m.k;
    out.push(actual);
    prev = actual;
  }
  return out;
}

// Motores 7 y 8 · Sobreajuste: Deflated Sharpe Ratio y PBO (Bailey y López de Prado). Único sitio donde se calculan.
//
// Motor 7 · Deflated Sharpe (DSR). Entradas: SR_obs (Sharpe por barra, fuera de muestra), N (variantes probadas en
// total), T (barras), γ₃ (asimetría), γ₄ (curtosis, 3 = normal) y Var_SR (varianza de los Sharpe de las N variantes).
//   SR*  = √Var_SR · ((1 − γ) · Z⁻¹(1 − 1/N) + γ · Z⁻¹(1 − 1/(N · e)))      γ = 0,5772… (Euler-Mascheroni)
//   σ_SR = √((1 − γ₃ · SR_obs + ((γ₄ − 1)/4) · SR_obs²) / (T − 1))
//   DSR  = Φ((SR_obs − SR*) / σ_SR)          aprueba si DSR ≥ 0,95
//   Con una sola variante en la ejecución, Var_SR = 1/T (varianza del Sharpe estimado por azar).
//
// Motor 8 · PBO por CSCV. La serie de cada variante se corta en S = 16 bloques. Para cada una de las
// C(16, 8) = 12.870 mitades IS (y su complemento OOS):
//   se elige la variante con mayor rendimiento acumulado en el IS (suma de log-retornos = compuesto exacto);
//   ω = rango de esa variante en el OOS / (N + 1)  (rango 1 = la peor);  λ = logit(ω) = ln(ω / (1 − ω))
//   PBO = #(ω < 0,5) / C          aprueba si PBO < 0,05
// Por rapidez, se precalculan las sumas por bloque: cada combinación cuesta O(S · N).

export const EULER_GAMMA = 0.5772156649015329;
export const DSR_MINIMO = 0.95;
export const PBO_MAXIMO = 0.05;
export const BLOQUES_PBO = 16;

/** Φ(x): distribución normal estándar acumulada (Abramowitz y Stegun 26.2.17, error < 7,5·10⁻⁸). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Z⁻¹(p): cuantil de la normal estándar (algoritmo de Acklam, error relativo < 1,2·10⁻⁹). */
export function normalInversa(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  if (q < 0.02425) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > 1 - 0.02425) return -normalInversa(1 - q);
  const t = q - 0.5;
  const r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Asimetría (γ₃) y curtosis (γ₄, no exceso: 3 = normal) poblacionales. */
export function momentos(x: readonly number[]): { asimetria: number; curtosis: number } {
  const n = x.length;
  if (!n) return { asimetria: 0, curtosis: 3 };
  const m = x.reduce((a, v) => a + v, 0) / n;
  const s2 = x.reduce((a, v) => a + (v - m) ** 2, 0) / n;
  if (s2 <= 0) return { asimetria: 0, curtosis: 3 };
  const s = Math.sqrt(s2);
  return { asimetria: x.reduce((a, v) => a + ((v - m) / s) ** 3, 0) / n, curtosis: x.reduce((a, v) => a + ((v - m) / s) ** 4, 0) / n };
}

/** SR*: el Sharpe máximo que se espera solo por azar al probar N variantes. */
export function srEsperadoMaximo(varSr: number, n: number): number {
  if (n <= 1) return 0;
  return Math.sqrt(Math.max(varSr, 0)) * ((1 - EULER_GAMMA) * normalInversa(1 - 1 / n) + EULER_GAMMA * normalInversa(1 - 1 / (n * Math.E)));
}

/** σ_SR: desviación del Sharpe estimado, corregida por asimetría y curtosis. */
export function sigmaSharpe(sr: number, t: number, asimetria: number, curtosis: number): number {
  return Math.sqrt(Math.max(1e-12, 1 - asimetria * sr + ((curtosis - 1) / 4) * sr * sr) / Math.max(1, t - 1));
}

export interface DetalleDsr {
  dsr: number;
  srObs: number;
  srEstrella: number;
  sigma: number;
  n: number;
  t: number;
  asimetria: number;
  curtosis: number;
  varSr: number;
  /** De dónde salió Var_SR. */
  origenVarSr: 'variantes' | 'azar';
}

/** Deflated Sharpe con todos sus términos. `sharpesVariantes`: Sharpe por barra de cada variante de esta ejecución. */
export function deflatedSharpe(retornos: readonly number[], srObs: number, n: number, sharpesVariantes: readonly number[]): DetalleDsr {
  const t = retornos.length;
  const { asimetria, curtosis } = momentos(retornos);
  const validos = sharpesVariantes.filter((x) => Number.isFinite(x));
  let varSr = 1 / Math.max(1, t);
  let origenVarSr: DetalleDsr['origenVarSr'] = 'azar';
  if (validos.length > 1) {
    const m = validos.reduce((a, v) => a + v, 0) / validos.length;
    varSr = validos.reduce((a, v) => a + (v - m) ** 2, 0) / (validos.length - 1);
    origenVarSr = 'variantes';
  }
  const srEstrella = srEsperadoMaximo(varSr, n);
  const sigma = sigmaSharpe(srObs, t, asimetria, curtosis);
  return { dsr: normalCdf((srObs - srEstrella) / sigma), srObs, srEstrella, sigma, n, t, asimetria, curtosis, varSr, origenVarSr };
}

export interface DetallePbo {
  pbo: number;
  bloques: number;
  combinaciones: number;
  /** Combinaciones con ω < 0,5. */
  malas: number;
  /** Muestra de λ = logit(ω) (≤ 400 valores) para el histograma. */
  lambdas: number[];
  variantes: number;
}

/** Todas las combinaciones de `k` elementos de 0..n−1. */
export function combinaciones(n: number, k: number): number[][] {
  const out: number[][] = [];
  const act: number[] = [];
  const rec = (desde: number) => {
    if (act.length === k) {
      out.push([...act]);
      return;
    }
    for (let i = desde; i <= n - (k - act.length); i += 1) {
      act.push(i);
      rec(i + 1);
      act.pop();
    }
  };
  rec(0);
  return out;
}

/** PBO por CSCV. `retornos[v][i]`: retorno de la variante v en la barra i. Null con menos de 2 variantes o pocos datos. */
export function pboCscv(retornos: readonly (readonly number[])[], bloques = BLOQUES_PBO): DetallePbo | null {
  const nv = retornos.length;
  if (nv < 2 || bloques % 2) return null;
  const n = retornos[0].length;
  const tam = Math.floor(n / bloques);
  if (tam < 10) return null;
  // Rendimiento acumulado de cada variante en cada bloque (suma de log-retornos).
  const suma = retornos.map((r) => Array.from({ length: bloques }, (_, b) => {
    let s = 0;
    for (let i = b * tam; i < (b + 1) * tam; i += 1) s += Math.log(Math.max(1e-12, 1 + r[i]));
    return s;
  }));
  const total = suma.map((xs) => xs.reduce((a, x) => a + x, 0));
  const combos = combinaciones(bloques, bloques / 2);
  let malas = 0;
  const lambdas: number[] = [];
  const paso = Math.max(1, Math.floor(combos.length / 400));
  combos.forEach((dentro, ci) => {
    const is = suma.map((xs) => dentro.reduce((a, b) => a + xs[b], 0));
    let mejor = 0;
    for (let v = 1; v < nv; v += 1) if (is[v] > is[mejor]) mejor = v;
    const oos = total.map((t, v) => t - is[v]);
    const rango = oos.filter((x) => x < oos[mejor]).length + 1;
    const w = rango / (nv + 1);
    // PBO = P(λ ≤ 0): la mejor dentro de muestra cae en la mitad de abajo (o justo en la mediana) fuera de muestra.
    if (w <= 0.5) malas += 1;
    if (ci % paso === 0) lambdas.push(Math.log(w / (1 - w)));
  });
  return { pbo: malas / combos.length, bloques, combinaciones: combos.length, malas, lambdas, variantes: nv };
}

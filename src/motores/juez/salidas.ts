// Gestión de salidas: stop, objetivo (RR) y cómo se mueve el stop (fijo, a break-even o escalonado).
// Es el MISMO código para el Juez (backtest) y para los bots en vivo: lo que el Juez aprueba es lo que el bot hace.
//
// Notación: 1R = |entrada − stop inicial| (lo que se arriesga). MFE / MAE = lo máximo que fue a favor / en contra, en R.
//
//   1. Entrada al cierre de la barra de la señal (igual que el Backtest): precio E, costo de un lado.
//   2. Stop inicial  S = E − lado · k · ATR(i)      (ATR causal: solo barras ≤ i)      Objetivo  T = E + lado · RR · 1R
//   3. En cada barra siguiente, con su máximo y mínimo:
//        - si toca el stop y el objetivo en la MISMA barra se asume el stop (lo peor: no se sabe cuál fue primero);
//        - toca el stop → sale al precio del stop; toca el objetivo → sale al precio del objetivo.
//   4. Al cierre de la barra se mueve el stop según el MFE alcanzado (rige desde la barra siguiente, nunca dentro
//      de la misma barra: así no se inventa el orden de los precios):
//        fija        → nunca se mueve
//        be1R        → MFE ≥ 1R: stop a break-even (entrada + los costos de entrar y salir)
//        escalonada  → MFE ≥ 1R: break-even;  MFE ≥ kR (k ≥ 2): stop a (k − 1)R
//   5. Si la estrategia cambia de posición, sale al cierre (como el Backtest). Tras un stop u objetivo no vuelve a
//      entrar hasta que la estrategia cambie de señal (una señal = una operación).
//   6. Máximo de barras opcional: al llegar, sale al cierre (motivo «tiempo»).
//   7. Retorno de la barra de salida = lado · (precio de salida / cierre anterior − 1); el resto, como el Backtest.

import { costoPorLado, COSTOS_POR_DEFECTO, type Costos } from './costos';

export type ModoGestion = 'fija' | 'be1R' | 'escalonada';
export const MODOS_GESTION: readonly ModoGestion[] = ['fija', 'be1R', 'escalonada'];
export const NOMBRE_GESTION: Record<ModoGestion, string> = { fija: 'Stop fijo', be1R: 'Break-even a 1R', escalonada: 'Escalonada (BE a 1R, luego (k−1)R)' };

export interface ReglasSalida {
  /** Distancia del stop en ATR (k). */
  stopAtr: number;
  /** Objetivo en R (1:RR). */
  rr: number;
  gestion: ModoGestion;
  /** Periodo del ATR (por defecto 14). */
  periodoAtr?: number;
  /** Salida por tiempo (barras). */
  maxBarras?: number;
}

export interface Vela {
  high: number;
  low: number;
  close: number;
}

export type MotivoSalida = 'objetivo' | 'stop' | 'break-even' | 'stop-en-ganancia' | 'senal' | 'tiempo' | 'fin';

export interface MovimientoStop {
  barra: number;
  stop: number;
  /** R asegurados con el nuevo stop (0 = break-even). */
  r: number;
}

/** Una posición gestionada (en el backtest o en vivo). */
export interface PosicionGestionada {
  lado: 1 | -1;
  entrada: number;
  precioEntrada: number;
  stopInicial: number;
  stop: number;
  objetivo: number;
  /** 1R en precio. */
  riesgo: number;
  /** Máximo a favor y en contra, en R. */
  mfe: number;
  mae: number;
  movimientos: MovimientoStop[];
}

export interface OperacionGestionada {
  entrada: number;
  salida: number;
  lado: 1 | -1;
  precioEntrada: number;
  precioSalida: number;
  stopInicial: number;
  objetivo: number;
  riesgo: number;
  /** Resultado de precio en R (sin costos). */
  r: number;
  /** Retorno neto con costos (fracción). */
  retorno: number;
  mfe: number;
  mae: number;
  motivo: MotivoSalida;
  movimientos: MovimientoStop[];
  barras: number;
}

export interface ResultadoSalidas {
  retornos: number[];
  equity: number[];
  operaciones: OperacionGestionada[];
}

/** ATR causal por barra: en i solo usa barras ≤ i (null hasta tener 2 barras). */
export function atrSerie(velas: readonly Vela[], periodo = 14): (number | null)[] {
  const tr: number[] = velas.map((v, i) => (i === 0 ? v.high - v.low : Math.max(v.high - v.low, Math.abs(v.high - velas[i - 1].close), Math.abs(v.low - velas[i - 1].close))));
  const out: (number | null)[] = new Array(velas.length).fill(null);
  let suma = 0;
  for (let i = 0; i < velas.length; i += 1) {
    suma += tr[i];
    if (i >= periodo) suma -= tr[i - periodo];
    if (i >= 1) out[i] = suma / Math.min(i + 1, periodo);
  }
  return out;
}

/** Abre una posición gestionada al precio de entrada. Null si no hay ATR válido. */
export function abrirGestionada(lado: 1 | -1, barra: number, precio: number, atr: number | null, reglas: ReglasSalida): PosicionGestionada | null {
  if (atr === null || !(atr > 0) || !(precio > 0)) return null;
  const riesgo = reglas.stopAtr * atr;
  if (!(riesgo > 0)) return null;
  const stop = precio - lado * riesgo;
  return { lado, entrada: barra, precioEntrada: precio, stopInicial: stop, stop, objetivo: precio + lado * reglas.rr * riesgo, riesgo, mfe: 0, mae: 0, movimientos: [] };
}

/** ¿La vela toca el stop o el objetivo? Si toca los dos, el stop (lo peor). */
export function revisarSalida(p: PosicionGestionada, v: Vela): { precio: number; motivo: MotivoSalida } | null {
  const tocaStop = p.lado === 1 ? v.low <= p.stop : v.high >= p.stop;
  if (tocaStop) {
    const ultimo = p.movimientos[p.movimientos.length - 1];
    return { precio: p.stop, motivo: !ultimo ? 'stop' : ultimo.r > 0 ? 'stop-en-ganancia' : 'break-even' };
  }
  const tocaObjetivo = p.lado === 1 ? v.high >= p.objetivo : v.low <= p.objetivo;
  return tocaObjetivo ? { precio: p.objetivo, motivo: 'objetivo' } : null;
}

/** Al cierre de una barra (sin salida): actualiza MFE/MAE y mueve el stop según la gestión. Rige desde la barra siguiente. */
export function actualizarGestion(p: PosicionGestionada, v: Vela, barra: number, reglas: ReglasSalida, costos: Costos = COSTOS_POR_DEFECTO): void {
  const favor = ((p.lado === 1 ? v.high : v.low) - p.precioEntrada) * p.lado;
  const contra = ((p.lado === 1 ? v.low : v.high) - p.precioEntrada) * p.lado;
  p.mfe = Math.max(p.mfe, favor / p.riesgo);
  p.mae = Math.min(p.mae, contra / p.riesgo);
  if (reglas.gestion === 'fija' || p.mfe < 1) return;
  // R a asegurar: be1R → 0 (break-even); escalonada → floor(MFE) − 1 (sin pasar del objetivo).
  const nivel = reglas.gestion === 'be1R' ? 0 : Math.min(Math.floor(p.mfe + 1e-9) - 1, Math.max(0, Math.ceil(reglas.rr) - 1));
  const cubreCostos = nivel === 0 ? 2 * costoPorLado(costos) * p.precioEntrada : 0;
  const nuevo = p.precioEntrada + p.lado * (nivel * p.riesgo + cubreCostos);
  if ((nuevo - p.stop) * p.lado > 1e-12) {
    p.stop = nuevo;
    p.movimientos.push({ barra, stop: nuevo, r: nivel });
  }
}

/**
 * Backtest con gestión de salidas. Mismas reglas anti-futuro que el Backtest: la señal de la barra i entra al cierre
 * de i; el stop y el objetivo se vigilan desde la barra i + 1 con su máximo y mínimo.
 */
export function backtestConSalidas(velas: readonly Vela[], posiciones: readonly number[], reglas: ReglasSalida, costos: Costos = COSTOS_POR_DEFECTO, desde = 0, hasta = velas.length, huecos?: readonly boolean[]): ResultadoSalidas {
  const n = velas.length;
  const c = costoPorLado(costos);
  const atr = atrSerie(velas, reglas.periodoAtr ?? 14);
  const retornos = new Array(n).fill(0);
  const equity = new Array(n).fill(1);
  const operaciones: OperacionGestionada[] = [];
  let pos: PosicionGestionada | null = null;
  let factor = 1;
  // Señal ya usada: tras un stop/objetivo no se re-entra hasta que la estrategia cambie de señal.
  let senalUsada = 0;
  const cerrar = (i: number, precio: number, motivo: MotivoSalida) => {
    if (!pos) return;
    factor *= 1 - c;
    operaciones.push({ entrada: pos.entrada, salida: i, lado: pos.lado, precioEntrada: pos.precioEntrada, precioSalida: precio, stopInicial: pos.stopInicial, objetivo: pos.objetivo, riesgo: pos.riesgo, r: ((precio - pos.precioEntrada) * pos.lado) / pos.riesgo, retorno: factor - 1, mfe: pos.mfe, mae: pos.mae, motivo, movimientos: pos.movimientos, barras: i - pos.entrada });
    pos = null;
  };

  for (let i = desde; i < hasta; i += 1) {
    const v = velas[i];
    let r = 1;
    if (pos && i > desde) {
      const previo = velas[i - 1].close;
      const s = revisarSalida(pos, v);
      if (s) {
        const rp = pos.lado * (s.precio / previo - 1);
        factor *= 1 + rp;
        r *= (1 + rp) * (1 - c);
        senalUsada = pos.lado;
        cerrar(i, s.precio, s.motivo);
      } else {
        const rp = pos.lado * (v.close / previo - 1);
        factor *= 1 + rp;
        r *= 1 + rp;
      }
    }
    // Decisión al cierre de i (posición efectiva: 0 antes de un hueco y en la última barra del tramo).
    const fin = i >= hasta - 1 || huecos?.[i + 1] === true;
    const p = fin ? 0 : Math.sign(posiciones[i] ?? 0);
    if (p !== senalUsada) senalUsada = 0;
    if (pos) {
      const tiempo = reglas.maxBarras !== undefined && i - pos.entrada >= reglas.maxBarras;
      if (p !== pos.lado || tiempo) {
        r *= 1 - c;
        cerrar(i, v.close, fin && p === 0 && (posiciones[i] ?? 0) !== 0 ? 'fin' : tiempo && p === pos.lado ? 'tiempo' : 'senal');
        if (tiempo) senalUsada = p;
      } else {
        actualizarGestion(pos, v, i, reglas, costos);
      }
    }
    if (!pos && p !== 0 && p !== senalUsada) {
      const nueva = abrirGestionada(p as 1 | -1, i, v.close, atr[i], reglas);
      if (nueva) {
        pos = nueva;
        factor = 1 - c;
        r *= 1 - c;
        senalUsada = p;
      }
    }
    retornos[i] = r - 1;
  }
  let e = 1;
  for (let i = 0; i < n; i += 1) {
    e *= 1 + retornos[i];
    equity[i] = e;
  }
  return { retornos, equity, operaciones };
}

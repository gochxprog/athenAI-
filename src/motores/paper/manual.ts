// Órdenes a mano de la Terminal (Paper, sin dinero real). Mismo Ejecutor (llenado, comisión, deslizamiento) y la
// MISMA gestión de salidas que el Juez (juez/salidas.ts): stop, objetivo y cómo se mueve el stop.
//
//   Riesgo:     riesgoUsd = capital × riesgo%            distancia = |entrada − stop|  (k × ATR o precio dado)
//   Tamaño:     cantidad = riesgoUsd / distancia          (nocional ≤ libre; si no, se recorta)
//               o lotaje fijo: cantidad dada, riesgo = cantidad × distancia (si no cabe en lo libre, no se abre)
//   Libre:      capital × apalancamiento − nocional de las posiciones ya abiertas en esa cuenta (hasta 5 a la vez)
//   Liquidación: con apalancamiento A, ≈ 1/A de movimiento en contra liquida en Binance; el stop tiene que quedar
//               antes (distancia/precio < 0,8/A) o la orden no se abre.
//   En vivo (cada segundo), con el lado del libro por el que se saldría:
//     largo → bid      corto → ask          (toca stop y objetivo a la vez → stop)
//     sale a mercado con deslizamiento (como un stop real); si no, mueve el stop según la gestión.
import { actualizarGestion, abrirGestionada, revisarSalida, type ModoGestion, type MotivoSalida, type ReglasSalida, type Vela } from '../juez/salidas';
import { comisionUsd, type Costos } from '../juez/costos';
import { cerrar, precioLlenado, precioMedio, type Bot, type MercadoVivo, type MotivoCierre, type OperacionPaper } from './ejecutor';

export interface OrdenManual {
  lado: 1 | -1;
  /** Riesgo por operación, fracción de la cuenta (0,005 = 0,5 %). */
  riesgoPct: number;
  /** Lotaje fijo (unidades del activo, p. ej. 0,01 BTC). Si viene, manda sobre el riesgo %. */
  cantidad?: number;
  /** Stop: k × ATR o un precio. */
  stopAtr?: number;
  /** ATR con el que se mide el stop (p. ej. el de las velas del gráfico). Sin él: el ATR del motor (dollar bars). */
  atr?: number;
  stopPrecio?: number;
  /** Objetivo en R (1:RR) o un precio. */
  rr?: number;
  objetivoPrecio?: number;
  gestion: ModoGestion;
  /** Apalancamiento (1 = sin apalancamiento, hasta APALANCAMIENTO_MAXIMO). */
  apalancamiento?: number;
}

export const RIESGO_MAXIMO = 0.05;
export const APALANCAMIENTO_MAXIMO = 10;
export const APALANCAMIENTOS = [1, 2, 3, 5, 10];
/** Posiciones a mano abiertas a la vez en un mismo mercado. */
export const MAX_POSICIONES = 5;
/** La cuenta con la que se mide una orden: su capital y el nocional que ya tienen abierto sus posiciones. */
export interface CuentaOrden {
  capital: number;
  abierto: number;
}
const libreDe = (c: CuentaOrden, o: OrdenManual) => Math.max(0, c.capital * (o.apalancamiento ?? 1) - c.abierto);

/** ¿La posición tiene objetivo? (sin objetivo se guarda ±Number.MAX_VALUE). */
export const tieneObjetivo = (objetivo: number) => Math.abs(objetivo) < 1e300;

/** Lo mínimo que cuesta entrar y salir a mercado (comisión + deslizamiento base, los dos lados), en USD. */
export const costosIdaVuelta = (c: Costos, nocional: number) => (2 * Math.abs(nocional) * (c.comisionPb + c.deslizamientoPb)) / 10_000;

/** Cantidad para arriesgar riesgoUsd con esa distancia de stop, sin pasar de `tope` de nocional (lo libre). */
export function tamanoPorRiesgo(capital: number, riesgoPct: number, distancia: number, precio: number, tope = capital): { cantidad: number; riesgoUsd: number; recortada: boolean } {
  const riesgoUsd = capital * riesgoPct;
  let cantidad = distancia > 0 ? riesgoUsd / distancia : 0;
  let recortada = false;
  if (cantidad * precio > tope) {
    cantidad = tope / precio;
    recortada = true;
  }
  return { cantidad, riesgoUsd: cantidad * distancia, recortada };
}

/** Vista previa del ticket (lo que se ve antes de mandar la orden). Null si falta precio o stop. */
export function previaOrden(cuenta: CuentaOrden, m: MercadoVivo | null, o: OrdenManual): { entrada: number; stop: number; objetivo: number | null; cantidad: number; riesgoUsd: number; objetivoUsd: number | null; rr: number | null; recortada: boolean } | null {
  const ref = m ? (o.lado === 1 ? m.ask : m.bid) ?? precioMedio(m) : null;
  if (!ref || !(ref > 0)) return null;
  const atr = o.atr ?? m?.atr ?? null;
  const distancia = o.stopPrecio !== undefined ? Math.abs(ref - o.stopPrecio) : o.stopAtr !== undefined && atr ? o.stopAtr * atr : 0;
  if (!(distancia > 0)) return null;
  const stop = ref - o.lado * distancia;
  const objetivo = o.objetivoPrecio ?? (o.rr ? ref + o.lado * o.rr * distancia : null);
  const t = o.cantidad !== undefined ? { cantidad: o.cantidad, riesgoUsd: o.cantidad * distancia, recortada: false } : tamanoPorRiesgo(cuenta.capital, o.riesgoPct, distancia, ref, libreDe(cuenta, o));
  const objetivoUsd = objetivo === null ? null : Math.abs(objetivo - ref) * t.cantidad;
  return { entrada: ref, stop, objetivo, cantidad: t.cantidad, riesgoUsd: t.riesgoUsd, objetivoUsd, rr: objetivo === null ? null : Math.abs(objetivo - ref) / distancia, recortada: t.recortada };
}

/**
 * Abre la orden a mercado con su stop y objetivo en `bot` (sin posición). `cuenta`: el capital y lo ya abierto de
 * la cuenta a la que pertenece (por defecto, el propio bot). Devuelve un mensaje si no se puede.
 */
export function abrirManual(bot: Bot, m: MercadoVivo, o: OrdenManual, cuenta: CuentaOrden = { capital: bot.capital, abierto: 0 }): string | null {
  if (bot.posicion) return 'Ya hay una posición abierta en este mercado: ciérrala primero.';
  const apal = o.apalancamiento ?? 1;
  if (!(apal >= 1 && apal <= APALANCAMIENTO_MAXIMO)) return `El apalancamiento va de 1× a ${APALANCAMIENTO_MAXIMO}×.`;
  if (o.cantidad !== undefined) {
    if (!(o.cantidad > 0)) return 'El lotaje tiene que ser mayor que 0.';
  } else if (!(o.riesgoPct > 0) || o.riesgoPct > RIESGO_MAXIMO) return `El riesgo por operación tiene que estar entre 0 y ${RIESGO_MAXIMO * 100} %.`;
  const libre = libreDe(cuenta, o);
  if (!(libre > 0)) return `Sin margen libre: tus posiciones abiertas ya usan ${Math.round(cuenta.abierto).toLocaleString('es-ES')} USD de ${Math.round(cuenta.capital * apal).toLocaleString('es-ES')} (${apal}×). Sube el apalancamiento o cierra alguna.`;
  const pre = previaOrden(cuenta, m, o);
  if (!pre) return 'Falta precio en vivo o el stop no es válido (con stop por ATR hace falta el ATR del mercado).';
  if (apal > 1 && Math.abs(pre.entrada - pre.stop) / pre.entrada >= 0.8 / apal) return `Con ${apal}× te liquidarían antes de tocar el stop (≈ ${num1(100 / apal)} % en contra): acerca el stop o baja el apalancamiento.`;
  const f = precioLlenado(o.lado, m, pre.cantidad * pre.entrada, bot.costos);
  if (!f) return 'Sin precio para llenar la orden.';
  const distancia = Math.abs(pre.entrada - pre.stop);
  // Con el precio real de llenado: el stop queda a la misma distancia elegida.
  const cantidad = o.cantidad ?? tamanoPorRiesgo(cuenta.capital, o.riesgoPct, distancia, f.precio, libre).cantidad;
  if (cantidad * f.precio > libre * (1 + 1e-9)) return `Ese lotaje vale ${Math.round(cantidad * f.precio).toLocaleString('es-ES')} USD y te quedan libres ${Math.round(libre).toLocaleString('es-ES')} USD (${apal}×): no cabe.`;
  if (o.cantidad !== undefined && (cantidad * distancia) / cuenta.capital > RIESGO_MAXIMO) return `Con ese lotaje y ese stop arriesgas más del ${RIESGO_MAXIMO * 100} % de la cuenta: acerca el stop o baja el lotaje.`;
  const reglas: ReglasSalida = { stopAtr: 1, rr: pre.rr ?? 1e9, gestion: o.gestion };
  const g = abrirGestionada(o.lado, 0, f.precio, distancia, reglas);
  if (!g) return 'No se pudo calcular el stop.';
  // Sin objetivo: un número enorme (Infinity no sobrevive a JSON en el disco del VPS ni en la API).
  if (pre.objetivo === null) g.objetivo = o.lado * Number.MAX_VALUE;
  else if (o.objetivoPrecio !== undefined) g.objetivo = o.objetivoPrecio;
  const comision = comisionUsd(bot.costos, cantidad * f.precio);
  bot.posicion = { lado: o.lado, cantidad, precioEntrada: f.precio, t: m.t, capitalEntrada: cuenta.capital, comisionEntrada: comision, deslizEntradaUsd: cantidad * Math.abs(f.precio - f.base), funding: 0 };
  bot.capital -= comision;
  bot.gestion = { posicion: g, reglas };
  return null;
}

const num1 = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });

const MOTIVO: Record<MotivoSalida, MotivoCierre> = { objetivo: 'objetivo', stop: 'stop', 'break-even': 'break-even', 'stop-en-ganancia': 'stop-en-ganancia', senal: 'senal', tiempo: 'tiempo', fin: 'manual' };

/** Cierra a mercado y anota lo planeado y el resultado en R. */
export function cerrarGestionada(bot: Bot, m: MercadoVivo, motivo: MotivoCierre): OperacionPaper | null {
  const g = bot.gestion?.posicion;
  const op = cerrar(bot, m, motivo);
  if (op && g) op.gestion = { stopInicial: g.stopInicial, objetivo: g.objetivo, riesgo: g.riesgo, r: ((op.precioSalida - op.precioEntrada) * op.lado) / g.riesgo, mfe: g.mfe, mae: g.mae, movimientos: g.movimientos };
  if (op) bot.gestion = null;
  return op;
}

/** Cada segundo: ¿tocó stop u objetivo? Si no, mueve el stop. Devuelve la operación si cerró. */
export function vigilarGestion(bot: Bot, m: MercadoVivo): OperacionPaper | null {
  const g = bot.gestion;
  const p = bot.posicion;
  if (!g || !p) return null;
  const lado = p.lado === 1 ? m.bid : m.ask;
  const precio = lado !== null && lado > 0 ? lado : precioMedio(m);
  if (precio === null) return null;
  const vela: Vela = { high: precio, low: precio, close: precio };
  const s = revisarSalida(g.posicion, vela);
  if (s) return cerrarGestionada(bot, m, MOTIVO[s.motivo]);
  actualizarGestion(g.posicion, vela, m.t, g.reglas, bot.costos);
  return null;
}

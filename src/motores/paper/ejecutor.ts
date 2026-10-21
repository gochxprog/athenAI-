// Motor Ejecutor (Paper Trading): convierte la posición que pide una estrategia en operaciones simuladas al precio
// vivo del mercado, sin dinero real. Los costos salen de costos.ts (los mismos que usa el Juez).
//
// Llenado (orden a mercado, taker):
//   compra = ask · (1 + d)        venta = bid · (1 − d)        (sin libro: último precio)
//   d = deslizamiento dinámico (costos.ts): base + 0,1 · ATR/precio + (orden / liquidez de 10 niveles) · distancia
// Tamaño:   nocional = capital × exposición      cantidad = nocional / precio de llenado
// Comisión: nocional × comisión (taker) en la entrada y en la salida; se descuenta del capital al momento.
// Funding:  en cada cobro (00, 08, 16 UTC) con la posición abierta: pago = lado × cantidad × precio × tasa
//           (tasa > 0: el largo paga y el corto cobra). Se descuenta del capital al momento.
// Al cerrar: P&L de precio = lado × cantidad × (salida − entrada)
//            P&L neto = P&L de precio − comisiones − funding
//            retorno = P&L neto / capital antes de entrar   ·   retorno por unidad = retorno / exposición
//            (el retorno por unidad es comparable con las operaciones del Juez, que usan exposición 1).
// Capital en vivo (equity) = capital + lado × cantidad × (precio medio − entrada).
import { cobrosFunding, comisionUsd, deslizamientoDinamico, type Costos } from '../juez/costos';
import type { Combo } from '../juez/juez';
import type { Proveedor } from '../almacen/almacen';
import type { ResumenFlujo } from '../nucleo/pipeline';

export interface MercadoVivo {
  t: number;
  bid: number | null;
  ask: number | null;
  precio: number | null;
  atr: number | null;
  libro10: ResumenFlujo['libro10'];
  fundingTasa: number | null;
  enVivo: boolean;
}

export type EstadoBot = 'activo' | 'sin-datos' | 'pausado-dia' | 'cuarentena' | 'fuera-de-banda' | 'pausado' | 'apagado';

export type MotivoCierre = 'senal' | 'guardian' | 'hueco' | 'apagado' | 'manual';

export interface PosicionAbierta {
  lado: 1 | -1;
  cantidad: number;
  precioEntrada: number;
  t: number;
  /** Capital antes de entrar (base del retorno). */
  capitalEntrada: number;
  comisionEntrada: number;
  deslizEntradaUsd: number;
  /** Funding pagado (+) o cobrado (−) mientras estuvo abierta, en USD. */
  funding: number;
}

export interface OperacionPaper {
  id?: number;
  botId: string;
  simbolo: string;
  lado: 1 | -1;
  entradaT: number;
  salidaT: number;
  precioEntrada: number;
  precioSalida: number;
  cantidad: number;
  nocional: number;
  comisiones: number;
  deslizamientoUsd: number;
  funding: number;
  pnl: number;
  retorno: number;
  retornoUnidad: number;
  motivo: MotivoCierre;
}

export interface Bot {
  id: string;
  nombre: string;
  estrategiaId: string;
  codigo: string;
  combo: Combo;
  proveedor: Proveedor;
  simbolo: string;
  creado: number;
  veredicto: string;
  score: number | null;
  /** Fracción del capital por operación (1 = todo el capital, sin apalancamiento). */
  exposicion: number;
  capitalInicial: number;
  /** Capital realizado (USD): ya descuenta comisiones y funding. */
  capital: number;
  posicion: PosicionAbierta | null;
  estado: EstadoBot;
  motivo: string;
  costos: Costos;
  /** Retornos de las operaciones fuera de muestra del Juez (para la banda del Monte Carlo). */
  retornosJuez: number[];
  dia: { fecha: string; pico: number };
  /** Día (UTC) en que el Guardián lo pausó por la caída máxima. */
  pausadoDia: string | null;
  perdidasSeguidas: number;
  operaciones: number;
  /** Π(1 + retorno por unidad) − 1 de las operaciones cerradas. */
  retornoUnidadAcum: number;
  ultimoFundingT: number;
  ultimaSenalT: number | null;
  ultimaSenal: number | null;
  ultimoPrecio: number | null;
  /** Hubo un corte de datos con la posición abierta: se cierra al volver (nunca se mantiene a través de un hueco). */
  hueco: boolean;
  ultimaActualizacion: number;
  curva: { t: number; e: number }[];
}

export const MAX_PUNTOS_CURVA = 1_000;

export function precioMedio(m: MercadoVivo): number | null {
  if (m.bid !== null && m.ask !== null && m.bid > 0 && m.ask > 0) return (m.bid + m.ask) / 2;
  return m.precio !== null && m.precio > 0 ? m.precio : null;
}

/** Precio de llenado de una orden a mercado. `sentido` 1 = compra, −1 = venta. Null si no hay precio. */
export function precioLlenado(sentido: 1 | -1, m: MercadoVivo, nocional: number, costos: Costos): { precio: number; base: number; desliz: number } | null {
  const lado = sentido === 1 ? m.ask : m.bid;
  const base = lado !== null && lado > 0 ? lado : m.precio;
  if (base === null || !(base > 0)) return null;
  const desliz = deslizamientoDinamico(costos, {
    precio: base,
    atr: m.atr,
    nocionalOrden: nocional,
    liquidezLado: m.libro10 ? (sentido === 1 ? m.libro10.askUsd : m.libro10.bidUsd) : null,
    distanciaLado: m.libro10 ? (sentido === 1 ? m.libro10.askDist : m.libro10.bidDist) : null,
  });
  return { precio: base * (1 + sentido * desliz), base, desliz };
}

export function abrir(bot: Bot, lado: 1 | -1, m: MercadoVivo): boolean {
  if (bot.posicion || !(bot.capital > 0)) return false;
  const nocional = bot.capital * bot.exposicion;
  const f = precioLlenado(lado, m, nocional, bot.costos);
  if (!f || !(nocional > 0)) return false;
  const cantidad = nocional / f.precio;
  const comision = comisionUsd(bot.costos, nocional);
  bot.posicion = { lado, cantidad, precioEntrada: f.precio, t: m.t, capitalEntrada: bot.capital, comisionEntrada: comision, deslizEntradaUsd: cantidad * Math.abs(f.precio - f.base), funding: 0 };
  bot.capital -= comision;
  return true;
}

/** Cierra la posición. Sin precio vivo usa el último conocido (apagado de emergencia con el mercado caído). */
export function cerrar(bot: Bot, m: MercadoVivo, motivo: MotivoCierre): OperacionPaper | null {
  const p = bot.posicion;
  if (!p) return null;
  const nocionalSalida = p.cantidad * (precioMedio(m) ?? bot.ultimoPrecio ?? p.precioEntrada);
  const f = precioLlenado(p.lado === 1 ? -1 : 1, m, nocionalSalida, bot.costos) ?? (bot.ultimoPrecio ? { precio: bot.ultimoPrecio, base: bot.ultimoPrecio, desliz: 0 } : null);
  if (!f) return null;
  const comisionSalida = comisionUsd(bot.costos, p.cantidad * f.precio);
  const pnlPrecio = p.lado * p.cantidad * (f.precio - p.precioEntrada);
  bot.capital += pnlPrecio - comisionSalida;
  bot.posicion = null;
  const pnl = pnlPrecio - p.comisionEntrada - comisionSalida - p.funding;
  const retorno = p.capitalEntrada > 0 ? pnl / p.capitalEntrada : 0;
  return {
    botId: bot.id,
    simbolo: bot.simbolo,
    lado: p.lado,
    entradaT: p.t,
    salidaT: m.t,
    precioEntrada: p.precioEntrada,
    precioSalida: f.precio,
    cantidad: p.cantidad,
    nocional: p.cantidad * p.precioEntrada,
    comisiones: p.comisionEntrada + comisionSalida,
    deslizamientoUsd: p.deslizEntradaUsd + p.cantidad * Math.abs(f.precio - f.base),
    funding: p.funding,
    pnl,
    retorno,
    retornoUnidad: bot.exposicion > 0 ? retorno / bot.exposicion : 0,
    motivo,
  };
}

/** Lleva la posición a `objetivo` (−1, 0 o 1). Girar de largo a corto = cerrar y abrir. Devuelve lo cerrado. */
export function rebalancear(bot: Bot, objetivo: number, m: MercadoVivo): OperacionPaper[] {
  const o = objetivo > 0 ? 1 : objetivo < 0 ? -1 : 0;
  const cerradas: OperacionPaper[] = [];
  if (bot.posicion && bot.posicion.lado !== o) {
    const op = cerrar(bot, m, 'senal');
    if (op) cerradas.push(op);
  }
  if (o !== 0 && !bot.posicion) abrir(bot, o as 1 | -1, m);
  return cerradas;
}

/** Cobra o paga el funding de los cortes (00, 08, 16 UTC) que pasaron desde la última revisión. */
export function aplicarFunding(bot: Bot, t: number, tasa: number | null, precioMarca: number | null): number {
  const cobros = cobrosFunding(bot.ultimoFundingT, t);
  bot.ultimoFundingT = Math.max(bot.ultimoFundingT, t);
  const p = bot.posicion;
  if (!p || cobros <= 0 || tasa === null || precioMarca === null) return 0;
  const pago = p.lado * p.cantidad * precioMarca * tasa * cobros;
  bot.capital -= pago;
  p.funding += pago;
  return pago;
}

export function equity(bot: Bot, m: MercadoVivo | null): number {
  const p = bot.posicion;
  if (!p) return bot.capital;
  const precio = (m && precioMedio(m)) ?? bot.ultimoPrecio ?? p.precioEntrada;
  return bot.capital + p.lado * p.cantidad * (precio - p.precioEntrada);
}

/** Registra una operación cerrada en los contadores del bot. */
export function anotarOperacion(bot: Bot, op: OperacionPaper): void {
  bot.operaciones += 1;
  bot.perdidasSeguidas = op.pnl < 0 ? bot.perdidasSeguidas + 1 : 0;
  bot.retornoUnidadAcum = (1 + bot.retornoUnidadAcum) * (1 + op.retornoUnidad) - 1;
}

export function anotarCurva(bot: Bot, t: number, e: number, cadaMs = 60_000): void {
  const u = bot.curva[bot.curva.length - 1];
  if (u && t - u.t < cadaMs) return;
  bot.curva.push({ t, e });
  if (bot.curva.length > MAX_PUNTOS_CURVA) bot.curva = bot.curva.filter((_, i) => i % 2 === 0 || i === bot.curva.length - 1);
}

const CABECERA = ['simbolo', 'lado', 'entrada', 'salida', 'precio_entrada', 'precio_salida', 'cantidad', 'nocional_usd', 'comisiones_usd', 'deslizamiento_usd', 'funding_usd', 'pnl_usd', 'retorno', 'motivo'];

export function operacionesCsv(ops: readonly OperacionPaper[]): string {
  const filas = ops.map((o) => [o.simbolo, o.lado > 0 ? 'largo' : 'corto', new Date(o.entradaT).toISOString(), new Date(o.salidaT).toISOString(), o.precioEntrada, o.precioSalida, o.cantidad, o.nocional, o.comisiones, o.deslizamientoUsd, o.funding, o.pnl, o.retorno, o.motivo].join(','));
  return [CABECERA.join(','), ...filas].join('\n');
}

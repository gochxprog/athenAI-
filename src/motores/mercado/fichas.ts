// Ficha de cada mercado: cómo se mide un CONTRATO allí. El tamaño a mano (Terminal) se piensa en contratos, sea donde
// sea; la ficha dice cuántas unidades del activo son 1 contrato y cuánto vale cada punto de precio por contrato.
//
//   valor del punto = tamaño del contrato × multiplicador        (1 punto = 1 unidad de precio, p. ej. 1 USD)
//   riesgo por contrato = |entrada − stop| × valor del punto
//
// Agregar un mercado nuevo (otro broker, Rithmic…) = agregar su ficha aquí. Nada más cambia.
import type { MercadoId } from './mercadoId';

export interface FichaMercado {
  mercado: MercadoId;
  /** Qué es, en palabras. */
  nombre: string;
  tipo: 'perpetuo' | 'futuro' | 'spot' | 'cfd';
  /** Unidad del activo (BTC, oz…). */
  unidad: string;
  /** Unidades del activo en 1 contrato. */
  contrato: number;
  /** Valor ($) de 1 punto de precio por contrato. */
  valorPunto: number;
  tick: number;
  /** Mínimo y paso de contratos por orden. */
  minContratos: number;
  pasoContratos: number;
  /** Datos de la ficha comprobados con el exchange o el broker (false = valor por defecto, revisar). */
  verificada: boolean;
}

const binance = (simbolo: string, unidad: string, contrato: number, tick: number, nombre: string): FichaMercado => ({
  mercado: `binance:${simbolo}`,
  nombre,
  tipo: 'perpetuo',
  unidad,
  // En los perpetuos lineales de Binance 1 «contrato» = el paso mínimo de cantidad; el P&L es lineal en USDT.
  contrato,
  valorPunto: contrato,
  tick,
  minContratos: 1,
  pasoContratos: 1,
  verificada: true,
});

export const FICHAS: readonly FichaMercado[] = [
  binance('BTCUSDT', 'BTC', 0.001, 0.1, 'Bitcoin perpetuo (Binance USD-M)'),
  binance('XAUUSDT', 'oz', 0.001, 0.01, 'Oro perpetuo (Binance USD-M)'),
  binance('ETHUSDT', 'ETH', 0.001, 0.01, 'Ether perpetuo (Binance USD-M)'),
  // Futuros de la CME por Rithmic (cuando se conecte): micro oro, 10 oz por contrato.
  { mercado: 'rithmic:MGC', nombre: 'Micro oro (CME)', tipo: 'futuro', unidad: 'oz', contrato: 10, valorPunto: 10, tick: 0.1, minContratos: 1, pasoContratos: 1, verificada: true },
];

/** Ficha del mercado; si no está, una por defecto (1 contrato = 1 unidad) marcada como no verificada. */
export function fichaDe(mercado: MercadoId): FichaMercado {
  const f = FICHAS.find((x) => x.mercado === mercado);
  if (f) return f;
  const simbolo = mercado.slice(mercado.indexOf(':') + 1);
  return { mercado, nombre: simbolo, tipo: 'perpetuo', unidad: simbolo.replace(/USDT$|USDC$|USD$/, ''), contrato: 1, valorPunto: 1, tick: 0.01, minContratos: 1, pasoContratos: 1, verificada: false };
}

/** Cantidad del activo de N contratos. */
export const unidadesDe = (f: FichaMercado, contratos: number) => contratos * f.contrato;

/** Contratos enteros (según el paso) que caben en una cantidad del activo, redondeando hacia abajo. */
export function contratosDe(f: FichaMercado, cantidad: number): number {
  const n = Math.floor((cantidad / f.contrato + 1e-9) / f.pasoContratos) * f.pasoContratos;
  return Math.max(0, n);
}

/** Riesgo ($) por contrato con ese stop. */
export const riesgoPorContrato = (f: FichaMercado, entrada: number, stop: number) => Math.abs(entrada - stop) * f.valorPunto;

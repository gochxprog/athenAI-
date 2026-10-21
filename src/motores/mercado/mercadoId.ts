// Identidad única de un mercado (market_id): «proveedor:SÍMBOLO», por ejemplo «binance:BTCUSDT».
// Es la ÚNICA definición en toda la plataforma. Cada fila, señal, etiqueta, resultado del Juez, paper y bot lleva
// su market_id, y los datos de cada mercado viven aislados (carpeta propia en la grabadora, rango propio en el
// navegador). Un edge encontrado en un mercado nunca se prueba ni se usa en otro.
import type { Proveedor } from '@/motores/almacen/almacen';

export type MercadoId = `${Proveedor}:${string}`;

const PROVEEDORES_VALIDOS: readonly string[] = ['binance', 'rithmic', 'grabadora'];
const SIMBOLO = /^[A-Z0-9]{2,20}$/;

export function mercadoId(proveedor: Proveedor, simbolo: string): MercadoId {
  if (!PROVEEDORES_VALIDOS.includes(proveedor)) throw new Error(`Proveedor desconocido: ${proveedor}`);
  if (!SIMBOLO.test(simbolo)) throw new Error(`Símbolo no válido: ${simbolo}`);
  return `${proveedor}:${simbolo}`;
}

export function esMercadoId(x: unknown): x is MercadoId {
  if (typeof x !== 'string') return false;
  const i = x.indexOf(':');
  return i > 0 && PROVEEDORES_VALIDOS.includes(x.slice(0, i)) && SIMBOLO.test(x.slice(i + 1));
}

export function partesMercado(id: MercadoId): { proveedor: Proveedor; simbolo: string } {
  if (!esMercadoId(id)) throw new Error(`market_id no válido: ${String(id)}`);
  const i = id.indexOf(':');
  return { proveedor: id.slice(0, i) as Proveedor, simbolo: id.slice(i + 1) };
}

/** Nombre de carpeta del mercado en disco: «binance:BTCUSDT» → «binance_btcusdt». */
export function carpetaMercado(id: MercadoId): string {
  const { proveedor, simbolo } = partesMercado(id);
  return `${proveedor}_${simbolo.toLowerCase()}`;
}

/** Inversa de `carpetaMercado` (null si el nombre no es una carpeta de mercado). */
export function mercadoDeCarpeta(nombre: string): MercadoId | null {
  const m = /^([a-z]+)_([a-z0-9]{2,20})$/.exec(nombre);
  if (!m) return null;
  const id = `${m[1]}:${m[2].toUpperCase()}`;
  return esMercadoId(id) ? id : null;
}

/** Como `mercadoId`, pero devuelve null en vez de lanzar (para datos que llegan de fuera: feeds, guardados viejos). */
export function mercadoIdSeguro(proveedor: string, simbolo: string): MercadoId | null {
  const id = `${proveedor}:${simbolo}`;
  return esMercadoId(id) ? id : null;
}

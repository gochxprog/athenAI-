// Captura del gráfico para los avisos de apertura: velas (verde sube, morado baja) con la entrada, el stop y el
// objetivo, y sus precios a la derecha. PNG dibujado a mano (píxeles + zlib): sin navegador ni librerías en el VPS.
import zlib from 'node:zlib';

export interface MarcasCaptura {
  lado: 1 | -1;
  entrada: number;
  stop: number | null;
  objetivo: number | null;
}
type Vela = { open: number; high: number; low: number; close: number };
type Color = readonly [number, number, number];

const FONDO: Color = [0, 0, 0];
const SUBE: Color = [126, 226, 168];
const BAJA: Color = [168, 85, 247];
const ROJO: Color = [229, 132, 139];
const BLANCO: Color = [217, 219, 223];
const REJILLA: Color = [30, 30, 33];
// Cifras de 3 × 5 píxeles (filas de arriba abajo, 3 bits cada una).
const CIFRAS: Record<string, number[]> = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 1, 1, 1], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7], '.': [0, 0, 0, 0, 2],
};

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = TABLA_CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function trozo(tipo: string, datos: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(datos.length, 0);
  cab.write(tipo, 4, 'ascii');
  const fin = Buffer.alloc(4);
  fin.writeUInt32BE(crc32(Buffer.concat([cab.subarray(4), datos])), 0);
  return Buffer.concat([cab, datos, fin]);
}

/** PNG (RGB, 8 bits) de un lienzo de `ancho × alto` píxeles. */
export function png(ancho: number, alto: number, rgb: Uint8Array): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y += 1) filas.set(rgb.subarray(y * ancho * 3, (y + 1) * ancho * 3), y * (ancho * 3 + 1) + 1);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(filas, { level: 9 })), trozo('IEND', Buffer.alloc(0))]));
}

export function capturaPng(velas: readonly Vela[], m: MarcasCaptura, ancho = 720, alto = 400): Uint8Array {
  const rgb = new Uint8Array(ancho * alto * 3);
  const punto = (x: number, y: number, c: Color) => {
    if (x < 0 || y < 0 || x >= ancho || y >= alto) return;
    rgb.set(c, (Math.round(y) * ancho + Math.round(x)) * 3);
  };
  const caja = (x0: number, y0: number, x1: number, y1: number, c: Color) => {
    for (let y = Math.round(Math.min(y0, y1)); y <= Math.round(Math.max(y0, y1)); y += 1) for (let x = Math.round(x0); x <= Math.round(x1); x += 1) punto(x, y, c);
  };
  caja(0, 0, ancho - 1, alto - 1, FONDO);
  const [izq, der, arriba, abajo] = [8, ancho - 92, 14, alto - 14];
  const niveles = [m.entrada, m.stop, m.objetivo].filter((x): x is number => x !== null && Number.isFinite(x));
  const lo = Math.min(...velas.map((v) => v.low), ...niveles);
  const hi = Math.max(...velas.map((v) => v.high), ...niveles);
  const margen = (hi - lo) * 0.06 || 1;
  const y = (p: number) => abajo - ((p - (lo - margen)) / (hi - lo + 2 * margen)) * (abajo - arriba);
  for (let k = 1; k < 5; k += 1) caja(izq, arriba + ((abajo - arriba) * k) / 5, der, arriba + ((abajo - arriba) * k) / 5, REJILLA);
  const paso = (der - izq) / Math.max(1, velas.length);
  velas.forEach((v, i) => {
    const c = v.close >= v.open ? SUBE : BAJA;
    const x = izq + paso * (i + 0.5);
    caja(x, y(v.high), x, y(v.low), c);
    const medio = Math.max(1, Math.floor(paso * 0.32));
    caja(x - medio, y(Math.max(v.open, v.close)), x + medio, y(Math.min(v.open, v.close)), c);
  });
  const texto = (s: string, x0: number, yc: number, c: Color, z = 2) =>
    [...s].forEach((ch, i) => (CIFRAS[ch] ?? []).forEach((fila, f) => [0, 1, 2].forEach((b) => fila & (4 >> b) && caja(x0 + (i * 4 + b) * z, yc - 5 * (z / 2) + f * z, x0 + (i * 4 + b) * z + z - 1, yc - 5 * (z / 2) + f * z + z - 1, c))));
  const dec = m.entrada < 100 ? 2 : 1;
  const linea = (p: number | null, c: Color, guiones: boolean) => {
    if (p === null || !Number.isFinite(p)) return;
    for (let x = izq; x <= der; x += 1) if (!guiones || x % 10 < 6) punto(x, y(p), c);
    texto(p.toFixed(dec), der + 6, y(p), c);
  };
  linea(m.stop, ROJO, true);
  linea(m.objetivo, SUBE, true);
  linea(m.entrada, BLANCO, false);
  // Flecha de la entrada sobre la última vela: ▲ largo, ▼ corto.
  const xe = izq + paso * (velas.length - 0.5);
  for (let k = 0; k < 7; k += 1) caja(xe - k, y(m.entrada) + m.lado * (6 + k), xe + k, y(m.entrada) + m.lado * (6 + k), BLANCO);
  return png(ancho, alto, rgb);
}

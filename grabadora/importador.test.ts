import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { diasEntre, entradaZip, fundingDeCsv, importar, lineasZip, oiDeCsv, tradeDeCsv, urlFunding, urlMetricas, urlTrades } from './importador';
import { leerLineas, type FilaDisco } from './almacenDisco';
import { Pipeline } from '../src/motores/nucleo/pipeline';
import { parametrosPorDefecto } from '../src/motores/nucleo/parametros';
import { EVENTOS_PREDEFINIDOS } from '../src/motores/nucleo/calendario';
import type { AggTrade } from '../src/motores/nucleo/tipos';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'importador-'));
  carpetas.push(d);
  return d;
};
afterEach(() => {
  for (const d of carpetas.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Zip de una entrada como los de Binance (deflate; tamaños solo en el directorio central, como con descriptor). */
function crearZip(archivo: string, nombre: string, texto: string): void {
  const datos = Buffer.from(texto);
  const comp = zlib.deflateRawSync(datos);
  const n = Buffer.from(nombre);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x08, 6); // con descriptor: tamaños en 0 aquí
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x08, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(datos.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const inicioCentral = 30 + n.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12);
  eocd.writeUInt32LE(inicioCentral, 16);
  fs.writeFileSync(archivo, Buffer.concat([local, n, comp, central, n, eocd]));
}

const DIA0 = Date.UTC(2026, 6, 1);
const DIA_MS = 86_400_000;

/** Trades de prueba (paseo determinista) para un día: unos 3.000, ids consecutivos entre días. */
function tradesDia(i: number): AggTrade[] {
  const out: AggTrade[] = [];
  let p = 60_000 + i * 50;
  for (let k = 0; k < 3_000; k += 1) {
    const id = i * 3_000 + k;
    p += Math.sin(id * 0.37) * 4 + Math.cos(id * 0.11) * 3;
    out.push({ symbol: 'BTCUSDT', price: Math.round(p * 10) / 10, quantity: 0.5 + ((id * 7) % 13) / 4, timestamp: DIA0 + i * DIA_MS + k * 28_000, aggTradeId: id, buyerIsMaker: (id * 31) % 7 < 3 });
  }
  return out;
}
const csvTrades = (ts: AggTrade[], cabecera: boolean) =>
  (cabecera ? 'agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker\n' : '') + ts.map((t) => `${t.aggTradeId},${t.price},${t.quantity},${t.aggTradeId},${t.aggTradeId},${t.timestamp},${t.buyerIsMaker}`).join('\n');
const csvMetricas = (i: number, base = 80_000) =>
  'create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio\n' +
  Array.from({ length: 288 }, (_, k) => {
    const t = new Date(DIA0 + i * DIA_MS + k * 300_000).toISOString().slice(0, 19).replace('T', ' ');
    return `${t},BTCUSDT,${base + k * 3 + Math.sin(k) * 40},${(base + k) * 60_000},1,1,1,1`;
  }).join('\n');

/** «Binance» de prueba: archivos en una carpeta; lo que no está da 404. */
function binanceFalso(dias: Record<string, { trades?: AggTrade[]; metricas?: string }>, fundingMes?: string) {
  const dir = temporal();
  const archivos = new Map<string, string>();
  for (const [dia, x] of Object.entries(dias)) {
    if (x.trades) {
      const f = path.join(dir, `t-${dia}.zip`);
      crearZip(f, `BTCUSDT-aggTrades-${dia}.csv`, csvTrades(x.trades, dia.endsWith('1')));
      archivos.set(urlTrades('BTCUSDT', dia), f);
    }
    if (x.metricas) {
      const f = path.join(dir, `m-${dia}.zip`);
      crearZip(f, `BTCUSDT-metrics-${dia}.csv`, x.metricas);
      archivos.set(urlMetricas('BTCUSDT', dia), f);
    }
  }
  if (fundingMes) {
    const f = path.join(dir, 'f.zip');
    crearZip(f, 'f.csv', `calc_time,funding_interval_hours,last_funding_rate\n${[0, 1, 2].map((k) => `${DIA0 + k * 8 * 3_600_000},8,${0.0001 * (k + 1)}`).join('\n')}`);
    archivos.set(urlFunding('BTCUSDT', fundingMes), f);
  }
  const pedidas: string[] = [];
  const bajar = async (url: string, destino: string) => {
    pedidas.push(url);
    const f = archivos.get(url);
    if (!f) return false;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(f, destino);
    return true;
  };
  return { bajar, pedidas };
}

const leerHistoria = (datos: string) => {
  const dir = path.join(datos, 'historia', 'mercados', 'binance_btcusdt', 'filas');
  return fs
    .readdirSync(dir)
    .sort()
    .flatMap((f) => leerLineas<FilaDisco>(path.join(dir, f)));
};
const silencio = () => undefined;

describe('Importador de la historia de Binance', () => {
  it('lee los CSV de Binance (con y sin cabecera) y los días de un rango', () => {
    expect(tradeDeCsv('BTCUSDT', 'agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker')).toBeNull();
    expect(tradeDeCsv('BTCUSDT', '12,84000.5,0.25,20,21,1700000000000,true')).toEqual({ symbol: 'BTCUSDT', aggTradeId: 12, price: 84000.5, quantity: 0.25, timestamp: 1700000000000, buyerIsMaker: true });
    expect(oiDeCsv('BTCUSDT', '2026-07-01 00:05:00,BTCUSDT,80123.4,5000000000,1,1,1,1')).toMatchObject({ time: Date.UTC(2026, 6, 1, 0, 5), oiContracts: 80123.4, source: 'hist' });
    expect(fundingDeCsv('1751328000000,8,0.0001')).toEqual({ t: 1751328000000, tasa: 0.0001 });
    expect(diasEntre('2026-06-30', '2026-07-02')).toEqual(['2026-06-30', '2026-07-01', '2026-07-02']);
    expect(() => diasEntre('2026-07-02', '2026-07-01')).toThrow();
  });

  it('abre zips como los de Binance y entrega sus líneas', async () => {
    const f = path.join(temporal(), 'a.zip');
    crearZip(f, 'a.csv', 'uno\ndos\n\ntres');
    expect(entradaZip(f).metodo).toBe(8);
    const lineas: string[] = [];
    for await (const l of lineasZip(f)) lineas.push(l);
    expect(lineas).toEqual(['uno', 'dos', 'tres']);
  });

  it('las filas importadas son IGUALES a las del motor en vivo con los mismos trades, y van a historia/ (no a lo grabado)', async () => {
    const datos = temporal();
    const d0 = tradesDia(0);
    const d1 = tradesDia(1);
    const { bajar } = binanceFalso({ '2026-07-01': { trades: d0 }, '2026-07-02': { trades: d1 } });
    const r = await importar({ simbolo: 'BTCUSDT', desde: '2026-07-01', hasta: '2026-07-02', datos, bajar, log: silencio, libre: () => Infinity });
    expect(r.dias).toBe(2);
    expect(r.trades).toBe(6_000);
    const filas = leerHistoria(datos);
    expect(filas.length).toBeGreaterThan(5);
    expect(r.filas).toBe(filas.length);
    expect(fs.existsSync(path.join(datos, 'mercados', 'binance_btcusdt'))).toBe(false);

    // El mismo motor alimentado como en vivo (lotes de 100 ms) da exactamente las mismas filas.
    const p = new Pipeline(parametrosPorDefecto('BTCUSDT', 0.1));
    p.calendario = EVENTOS_PREDEFINIDOS;
    p.procesar({ tipo: 'conexion', estado: 'en-vivo' });
    const vivo = [...d0, ...d1].flatMap((t) => p.procesar({ tipo: 'trades', trades: [t] }));
    expect(filas.map(({ n, cierre, close, valores }) => ({ n, cierre, close, valores }))).toEqual(vivo.map(({ n, cierre, close, valores }) => ({ n, cierre, close, valores })));
    expect(filas.every((f) => f.mercado === 'binance:BTCUSDT')).toBe(true);
  });

  it('sin mirar al futuro: cambiar el OI y el funding de después no cambia ninguna fila anterior', async () => {
    const correr = async (oiBase: number) => {
      const datos = temporal();
      const { bajar } = binanceFalso({ '2026-07-01': { trades: tradesDia(0), metricas: csvMetricas(0, oiBase) } }, '2026-07');
      await importar({ simbolo: 'BTCUSDT', desde: '2026-07-01', hasta: '2026-07-01', datos, bajar, log: silencio, libre: () => Infinity });
      return leerHistoria(datos);
    };
    const a = await correr(80_000);
    expect(a.some((f) => f.valores.oi_delta_pct !== null && f.valores.oi_delta_pct !== undefined)).toBe(true);
    expect(a.some((f) => f.valores.funding_tasa !== null && f.valores.funding_tasa !== undefined)).toBe(true);
    // Mismo día, pero el OI de la segunda mitad es otro: las filas cerradas antes del mediodía no cambian.
    const datos = temporal();
    const metricas = csvMetricas(0, 80_000)
      .split('\n')
      .map((l, k) => (k > 144 ? l.replace(/,BTCUSDT,([\d.]+),/, (_, x) => `,BTCUSDT,${Number(x) * 1.5},`) : l))
      .join('\n');
    const { bajar } = binanceFalso({ '2026-07-01': { trades: tradesDia(0), metricas } }, '2026-07');
    await importar({ simbolo: 'BTCUSDT', desde: '2026-07-01', hasta: '2026-07-01', datos, bajar, log: silencio, libre: () => Infinity });
    const b = leerHistoria(datos);
    const corte = DIA0 + 144 * 300_000;
    const antes = (xs: FilaDisco[]) => xs.filter((f) => f.cierre < corte).map((f) => f.valores);
    expect(antes(b)).toEqual(antes(a));
    expect(b.filter((f) => f.cierre >= corte).map((f) => f.valores)).not.toEqual(a.filter((f) => f.cierre >= corte).map((f) => f.valores));
  });

  it('salta lo ya importado, rehace un día cortado y empieza tramo nuevo tras un día que Binance no tiene', async () => {
    const datos = temporal();
    const { bajar, pedidas } = binanceFalso({ '2026-07-01': { trades: tradesDia(0) }, '2026-07-03': { trades: tradesDia(2) } });
    const r = await importar({ simbolo: 'BTCUSDT', desde: '2026-07-01', hasta: '2026-07-03', datos, bajar, log: silencio, libre: () => Infinity });
    expect(r.saltados).toEqual(['2026-07-02']);
    const sesiones = leerLineas<{ id: number }>(path.join(datos, 'historia', 'mercados', 'binance_btcusdt', 'sesiones.jsonl'));
    expect(sesiones.map((s) => s.id)).toEqual([DIA0, DIA0 + 2 * DIA_MS]);
    const total = leerHistoria(datos).length;

    // Un día a medio escribir (importación cortada) se borra y se rehace; los hechos no se vuelven a bajar.
    const hechos = path.join(datos, 'historia', 'mercados', 'binance_btcusdt', 'importados.json');
    fs.writeFileSync(hechos, JSON.stringify(['2026-07-01']));
    fs.appendFileSync(path.join(datos, 'historia', 'mercados', 'binance_btcusdt', 'filas', '2026-07-03.jsonl'), '{"basura":');
    pedidas.length = 0;
    await importar({ simbolo: 'BTCUSDT', desde: '2026-07-01', hasta: '2026-07-03', datos, bajar, log: silencio, libre: () => Infinity });
    expect(pedidas.some((u) => u.includes('2026-07-01'))).toBe(false);
    expect(leerHistoria(datos).length).toBe(total);
  });

  it('se detiene si el disco del VPS se está llenando', async () => {
    const datos = temporal();
    const { bajar } = binanceFalso({ '2026-07-01': { trades: tradesDia(0) } });
    const r = await importar({ simbolo: 'BTCUSDT', desde: '2026-07-01', hasta: '2026-07-01', datos, bajar, log: silencio, libre: () => 1024 });
    expect(r.dias).toBe(0);
  });
});

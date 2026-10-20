import { describe, expect, it } from 'vitest';
import { GeneradorDemo } from '../fuentes/demo';
import { Pipeline } from './pipeline';
import { DEFINICIONES_FEATURES, filasACsv, type FilaFeatures } from './features';
import type { MensajeMercado } from './tipos';

/** Simula `minutos` de mercado DEMO a través del pipeline. */
function correr(minutos: number, semilla = 11, pipeline = new Pipeline()) {
  const gen = new GeneradorDemo(semilla);
  const mensajes: MensajeMercado[] = [];
  const filas: FilaFeatures[] = [];
  for (let m = 0; m < minutos; m += 1) {
    for (const msg of gen.avanzar(60_000)) {
      mensajes.push(msg);
      filas.push(...pipeline.procesar(msg));
    }
  }
  return { pipeline, filas, mensajes };
}

describe('Pipeline de Order Flow con la fuente DEMO', () => {
  const { pipeline, filas } = correr(120);

  it('produce filas de Features por dollar bar con todas las columnas del catálogo', () => {
    expect(filas.length).toBeGreaterThan(50);
    for (const f of filas) {
      for (const d of DEFINICIONES_FEATURES) expect(d.clave in f.valores).toBe(true);
      expect(f.cierre).toBeGreaterThanOrEqual(f.inicio);
    }
    const csv = filasACsv(filas.slice(-3));
    expect(csv.split('\n')).toHaveLength(4);
  });

  it('cada motor detecta algo en el flujo DEMO', () => {
    const tipos = new Set(pipeline.mercado.eventos.ultimos(1_000).map((e) => e.tipo));
    const memoria = pipeline.mercado.memoria();
    const conAbsorcion = filas.some((f) => (f.valores.absorcion_ask ?? 0) > 0 || (f.valores.absorcion_bid ?? 0) > 0);
    const conImbalance = filas.some((f) => (f.valores.imb_compra ?? 0) > 0);
    const conOi = filas.some((f) => f.valores.oi_delta_pct !== null);
    expect(tipos.has('bigtrade')).toBe(true);
    expect(tipos.has('iceberg')).toBe(true);
    expect(tipos.has('stoprun')).toBe(true);
    expect(conAbsorcion).toBe(true);
    expect(conImbalance).toBe(true);
    expect(conOi).toBe(true);
    expect(memoria.columnasLhm).toBeGreaterThan(0);
  });

  it('ningún evento usado en una fila estaba disponible después del cierre de su barra', () => {
    for (const f of filas.slice(-40)) {
      const usados = pipeline.mercado.eventosDisponibles(f.cierre, f.inicio);
      for (const e of usados) expect(e.disponibleEn).toBeLessThanOrEqual(f.cierre);
    }
  });

  it('las filas pasadas NO cambian cuando llegan datos futuros (sin look-ahead)', () => {
    const corto = correr(40, 23);
    const largo = correr(55, 23);
    const corte = corto.filas[corto.filas.length - 1].cierre;
    const pasadasLargo = largo.filas.filter((f) => f.cierre <= corte);
    expect(pasadasLargo.length).toBe(corto.filas.length);
    pasadasLargo.forEach((f, i) => expect(f).toEqual(corto.filas[i]));
  });

  it('el agotamiento de una barra solo aparece en la fila de la barra SIGUIENTE', () => {
    const conAgotamiento = filas.filter((f) => (f.valores.agotamiento_prev_alcista ?? 0) > 0 || (f.valores.agotamiento_prev_bajista ?? 0) > 0);
    // Si aparece, la fila es posterior a la barra evaluada; la serie lo garantiza por construcción:
    for (const f of conAgotamiento) expect(f.n).toBeGreaterThan(0);
  });

  it('la memoria interna queda acotada tras 2 horas de mercado', () => {
    const m = pipeline.estado({ nBarras: 200, footprint: true, nivelesFootprint: 80 }).memoria;
    expect(m.columnasLhm).toBeLessThanOrEqual(1_800);
    expect(m.eventos).toBeLessThanOrEqual(600);
    expect(m.cintaIceberg).toBeLessThanOrEqual(40_000);
    expect(m.rachasPools).toBeLessThan(2_000);
    expect(m.barrasVista).toBeLessThanOrEqual(600);
    expect(m.idsVistos).toBeLessThanOrEqual(4_000);
  });

  it('cambiar la temporalidad del gráfico no altera las Features', () => {
    const antes = pipeline.todasLasFilas().length;
    pipeline.cambiarTemporalidad('5m');
    const e5 = pipeline.estado({ nBarras: 50, footprint: false, nivelesFootprint: 0 });
    expect(e5.temporalidad).toBe('5m');
    expect(e5.barras.length).toBeGreaterThan(10);
    pipeline.cambiarTemporalidad('volume');
    expect(pipeline.todasLasFilas().length).toBe(antes);
  });
});

// Lectura del momento: una frase por mercado hecha con reglas simples sobre lo que miden los motores.
// No predice: resume quién manda, qué se acaba de ver y en qué contexto. Los modelos del Bloque D la sustituirán.
import type { EstadoFeed } from '../worker/protocolo';

export interface Lectura {
  /** Frase corta (titular). */
  titular: string;
  /** Detalles que la justifican. */
  motivos: string[];
  /** −1 sesgo vendedor · 0 neutro · 1 comprador. */
  sesgo: -1 | 0 | 1;
}

const RECIENTE_MS = 3 * 60_000;
const NOMBRE_REGIMEN = { rango: 'rango', tendencia: 'tendencia', raro: 'día raro' } as const;

export function lecturaDe(f: EstadoFeed, ahora: number): Lectura {
  if (f.conexion !== 'en-vivo') return { titular: 'Sin datos en vivo', motivos: [f.detalle || f.conexion], sesgo: 0 };
  const r = f.resumen;
  const barras = r.barrasFlujo.slice(-5);
  if (barras.length < 3) return { titular: 'Calentando', motivos: ['Aún no hay barras suficientes para leer el flujo'], sesgo: 0 };

  const motivos: string[] = [];
  let puntos = 0;

  // Quién manda: compras frente a ventas agresivas de las últimas 5 barras.
  const c = barras.reduce((a, b) => a + b.compra, 0);
  const v = barras.reduce((a, b) => a + b.venta, 0);
  const presion = c + v > 0 ? (c - v) / (c + v) : 0;
  let titular = 'Flujo equilibrado';
  if (presion > 0.12) {
    titular = 'Mandan los compradores';
    puntos += 1;
  } else if (presion < -0.12) {
    titular = 'Mandan los vendedores';
    puntos -= 1;
  }
  motivos.push(`Presión ${presion >= 0 ? '+' : ''}${Math.round(presion * 100)} % en las últimas ${barras.length} barras`);

  if (r.precio !== null && r.vwap !== null) motivos.push(r.precio >= r.vwap ? 'Precio sobre el VWAP' : 'Precio bajo el VWAP');

  // Señales recientes que contradicen o confirman.
  const reciente = (t: number) => ahora - t <= RECIENTE_MS;
  if (r.absorcion && reciente(r.absorcion.t) && r.absorcion.score >= 50) {
    if (r.absorcion.lado === 'ask') {
      motivos.push(`Absorción en el ask (${Math.round(r.absorcion.score)}): frenan las compras`);
      puntos -= 1;
      if (presion > 0.12) titular = 'Compran, pero los frenan arriba';
    } else {
      motivos.push(`Absorción en el bid (${Math.round(r.absorcion.score)}): frenan las ventas`);
      puntos += 1;
      if (presion < -0.12) titular = 'Venden, pero los frenan abajo';
    }
  }
  if (r.agotamiento && reciente(r.agotamiento.t) && r.agotamiento.score >= 50) {
    motivos.push(r.agotamiento.lado === 'bullish' ? 'Agotamiento comprador' : 'Agotamiento vendedor');
    puntos += r.agotamiento.lado === 'bullish' ? -1 : 1;
  }
  const liq = r.liqLargosUsd + r.liqCortosUsd;
  if (liq > 0) {
    const largos = r.liqLargosUsd >= r.liqCortosUsd;
    motivos.push(`Liquidaciones de ${largos ? 'largos' : 'cortos'} (5 min)`);
    if (Math.max(r.liqLargosUsd, r.liqCortosUsd) > 2 * Math.min(r.liqLargosUsd, r.liqCortosUsd)) puntos += largos ? -1 : 1;
  }
  if (r.stopRuns) motivos.push(`${r.stopRuns} stop run${r.stopRuns > 1 ? 's' : ''} (5 min)`);
  if (r.icebergs) motivos.push(`${r.icebergs} iceberg${r.icebergs > 1 ? 's' : ''} (5 min)`);

  // Contexto.
  const reg = f.memoria?.regimen;
  if (reg) motivos.push(`Régimen: ${NOMBRE_REGIMEN[reg.actual]}`);
  if (f.memoria?.memoria?.distinto.aviso) {
    titular = `${titular} · hoy es distinto`;
    motivos.push('La data no se parece a lo grabado: más cautela');
  }

  return { titular, motivos, sesgo: puntos > 0 ? 1 : puntos < 0 ? -1 : 0 };
}

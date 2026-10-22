// Convierte las operaciones cerradas de Paper (bots y a mano) en fichas del diario (diario.ts), para el calendario y las
// métricas. R solo existe si la operación tuvo stop (gestión); sin stop, R = null y no entra en la esperanza en R.
import { mercadoIdSeguro, type MercadoId } from '../mercado/mercadoId';
import type { Bot, OperacionPaper } from '../paper/ejecutor';
import type { FichaOperacion } from './diario';

export function fichaDeOperacion(o: OperacionPaper, bot: Bot | undefined): FichaOperacion {
  const g = o.gestion;
  const riesgoUsd = g ? o.cantidad * g.riesgo : 0;
  const pnlPrecio = o.pnl + o.comisiones + o.funding;
  const capitalEntrada = o.retorno !== 0 ? o.pnl / o.retorno : bot?.capitalInicial ?? 0;
  // Tu cuenta a mano se reconoce también por su id (la v2 no la lista entre los bots).
  const manual = bot?.origen === 'manual' || o.botId.startsWith('manual:');
  return {
    id: `${o.botId}#${o.id ?? o.salidaT}`,
    origen: manual ? 'manual' : 'bot',
    botId: manual ? null : o.botId,
    estrategia: manual ? 'Manual' : bot?.nombre ?? o.botId,
    mercado: bot?.mercado ?? (mercadoIdSeguro('binance', o.simbolo) as MercadoId),
    lado: o.lado,
    entrada: { t: o.entradaT, precio: o.precioEntrada, motivo: '', senales: {} },
    stopInicial: g?.stopInicial ?? 0,
    objetivo: g && Math.abs(g.objetivo) < 1e300 ? g.objetivo : null,
    rr: g && Math.abs(g.objetivo) < 1e300 ? Math.abs(g.objetivo - o.precioEntrada) / g.riesgo : null,
    cantidad: o.cantidad,
    riesgoUsd,
    riesgoPct: capitalEntrada > 0 ? riesgoUsd / capitalEntrada : 0,
    capitalEntrada,
    movimientosStop: g?.movimientos ?? [],
    salida: { t: o.salidaT, precio: o.precioSalida, motivo: o.motivo === 'manual' ? 'manual' : o.motivo === 'guardian' || o.motivo === 'apagado' || o.motivo === 'hueco' ? 'guardian' : o.motivo === 'senal' ? 'senal' : o.motivo },
    pnlPrecio,
    comisiones: o.comisiones,
    funding: o.funding,
    deslizamiento: o.deslizamientoUsd,
    deslizamientoEsperado: 0,
    mfe: g?.mfe ?? 0,
    mae: g?.mae ?? 0,
  };
}

// Gráfico de velas (lightweight-charts de TradingView, ~45 KB): zoom con la rueda o dos dedos, arrastrar para moverse,
// eje de precio arrastrable. Negro, sin cuadrícula; marcas de los bots y líneas de su posición abierta.
import { useEffect, useRef } from 'react';
import { ColorType, createChart, CrosshairMode, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesMarker, type UTCTimestamp } from 'lightweight-charts';

/** [inicio ms, open, high, low, close] */
export type VelaG = [number, number, number, number, number];
export interface Marca { t: number; lado: 1 | -1; tipo: 'entrada' | 'salida'; texto: string; gana?: boolean }
export interface Linea { precio: number; titulo: string; tipo: 'entrada' | 'stop' | 'objetivo' }

const SUBE = '#7ee2a8';
const BAJA = '#e5848b';
// lightweight-charts dibuja en UTC: se corre la hora para que el eje muestre la hora de tu teléfono.
const local = (ms: number) => (Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60) as UTCTimestamp;
const COLOR_LINEA = { entrada: '#d9dbdf', stop: BAJA, objetivo: SUBE } as const;

export default function Velas({ velas, vivas, marcas, lineas, clave }: { velas: VelaG[]; vivas: VelaG[]; marcas: Marca[]; lineas: Linea[]; clave: string }) {
  const caja = useRef<HTMLDivElement>(null);
  const grafico = useRef<{ chart: IChartApi; serie: ISeriesApi<'Candlestick'>; lineas: IPriceLine[] } | null>(null);

  useEffect(() => {
    const chart = createChart(caja.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#000' }, textColor: '#8e929a', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: '#1e1e21', scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: '#1e1e21', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#45484e', labelBackgroundColor: '#1e1e21' }, horzLine: { color: '#45484e', labelBackgroundColor: '#1e1e21' } },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    const serie = chart.addCandlestickSeries({ upColor: SUBE, downColor: BAJA, borderVisible: false, wickUpColor: SUBE, wickDownColor: BAJA, priceLineColor: '#45484e' });
    grafico.current = { chart, serie, lineas: [] };
    return () => {
      chart.remove();
      grafico.current = null;
    };
  }, []);

  // Historia completa cada vez que llega del VPS; la vista solo se acomoda al cambiar de mercado o serie (si no,
  // cada recarga te sacaría del zoom en el que estabas).
  const vista = useRef('');
  useEffect(() => {
    const g = grafico.current;
    if (!g || !velas.length) return;
    g.serie.setData(velas.map(([t, o, h, l, c]) => ({ time: local(t), open: o, high: h, low: l, close: c })));
    if (vista.current === clave) return;
    vista.current = clave;
    // Pocas velas: que llenen el ancho; muchas: las últimas, a la derecha.
    if (velas.length < 150) g.chart.timeScale().fitContent();
    else g.chart.timeScale().scrollToRealTime();
  }, [velas, clave]);

  // La vela que se está formando (y la recién cerrada) con lo último que grabó el VPS.
  useEffect(() => {
    const g = grafico.current;
    const ultima = velas.at(-1)?.[0];
    // Sin historia cargada (cambiando de serie) no se mezcla: la vela viva de otra serie rompería el orden.
    if (!g || ultima === undefined) return;
    for (const [t, o, h, l, c] of vivas) if (t >= ultima) g.serie.update({ time: local(t), open: o, high: h, low: l, close: c });
  }, [vivas, velas]);

  useEffect(() => {
    const g = grafico.current;
    if (!g) return;
    const m: SeriesMarker<UTCTimestamp>[] = marcas
      .map((x) => ({
        time: local(x.t),
        position: x.tipo === 'entrada' ? (x.lado > 0 ? 'belowBar' : 'aboveBar') : x.lado > 0 ? 'aboveBar' : 'belowBar',
        shape: x.tipo === 'entrada' ? (x.lado > 0 ? 'arrowUp' : 'arrowDown') : 'circle',
        color: x.tipo === 'entrada' ? '#ffffff' : x.gana ? SUBE : BAJA,
        text: x.texto,
      }) as SeriesMarker<UTCTimestamp>)
      .sort((a, b) => a.time - b.time);
    g.serie.setMarkers(m);
    g.lineas.forEach((l) => g.serie.removePriceLine(l));
    g.lineas = lineas.map((l) => g.serie.createPriceLine({ price: l.precio, title: l.titulo, color: COLOR_LINEA[l.tipo], lineWidth: 1, lineStyle: l.tipo === 'entrada' ? LineStyle.Solid : LineStyle.Dashed, axisLabelVisible: true }));
  }, [marcas, lineas]);

  return <div ref={caja} className="velas" />;
}

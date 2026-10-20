// Pipeline de Order Flow: fuente → motores → (Features para el ML) + (estado para el gráfico).
//
// - Serie CANÓNICA (dollar bars de 10 M USD): alimenta las Features. No cambia con lo que se mire en pantalla.
// - Serie VISTA: la temporalidad elegida en el gráfico; se reconstruye desde la cinta al cambiarla.
// Todo acotado: anillos de tamaño fijo y cinta tipada. El reloj es el del flujo.
import { Anillo, CintaTrades } from './anillo';
import { SerieBarras, type BarraAnalizada } from './serieBarras';
import { MotorMercado, type MetricasFlujo } from './motorMercado';
import { construirFila, type FilaFeatures } from './features';
import { parametrosPorDefecto, type ParametrosSimbolo } from './parametros';
import { eventoEnVentana, type EventoCalendario } from './calendario';
import { type EstadoConexion, type EventoMotor, type IdTemporalidad, type MensajeMercado } from './tipos';

export interface NivelGrafico {
  p: number;
  b: number;
  a: number;
  /** 1 imbalance comprador, −1 vendedor, 0 ninguno. */
  imb: number;
}

export interface BarraGrafico {
  n: number;
  t: number;
  fin: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  d: number;
  poc: number | null;
  completa: boolean;
  niveles?: NivelGrafico[];
  absorcion: { p: number; lado: 'ask' | 'bid'; s: number }[];
  agotamiento: { p: number; lado: 'bullish' | 'bearish'; s: number }[] | null;
  /** CVD acumulado (suma de deltas desde 00:00 UTC) al cierre de la barra. */
  cvd: number;
  /** Open Interest (contratos) vigente al cierre de la barra. */
  oi: number | null;
}

export interface LibroGrafico {
  bids: [number, number, number][];
  asks: [number, number, number][];
  /** Paso de precio de la vista del libro (tick × agrupación). */
  paso: number;
  mid: number | null;
  spread: number | null;
  imbalance: number | null;
  obi10: number | null;
  microPrice: number | null;
  /** Volumen agresor ejecutado por nivel en los últimos 10 s (para la columna de "golpes" del DOM). */
  golpes: { p: number; compra: number; venta: number }[];
}

export interface EstadoGrafico {
  simbolo: string;
  tickSize: number;
  temporalidad: IdTemporalidad;
  paso: number;
  ahora: number;
  conexion: EstadoConexion;
  detalleConexion: string;
  barras: BarraGrafico[];
  enCurso: BarraGrafico | null;
  libro: LibroGrafico | null;
  pools: { p: number; lado: 'ask' | 'bid'; v: number; t0: number }[];
  ghosts: { p: number; lado: 'ask' | 'bid'; v: number; t0: number; tBarrido: number }[];
  eventos: EventoMotor[];
  metricas: MetricasFlujo & { barrasCanonicas: number; cvdSesion: number; oiActual: number | null; vwapSesion: number | null };
  features: { ultimas: FilaFeatures[]; total: number };
  memoria: Record<string, number>;
  heatmap: HeatmapGrafico | null;
}

/**
 * Heatmap de liquidez (tipo Bookmap): liquidez pasiva del libro en el tiempo, del historial LHM de Urus.
 * `datos` es una matriz columna a columna (columna = instante, fila = nivel de precio) con intensidad 0–255
 * en escala logarítmica entre la mediana (0) y el percentil 99 (255) de los tamaños: solo destacan los muros.
 */
export interface HeatmapGrafico {
  tiempos: number[];
  /** Paso de precio de cada fila. */
  paso: number;
  /** Índice de precio de la fila 0 (precio = idx × paso). */
  idx0: number;
  filas: number;
  datos: Uint8Array;
  /** Tamaño (en unidades del activo) que corresponde a intensidad 255. */
  maximo: number;
}

/** Resumen compacto de un mercado: alimenta las tarjetas Multi-Asset y el resto de módulos de la plataforma. */
export interface ResumenFlujo {
  precio: number | null;
  spread: number | null;
  aperturaSesion: number | null;
  vwap: number | null;
  cvdSesion: number;
  /** ATR(14) de la serie canónica (dollar bars), en unidades de precio. */
  atr: number | null;
  oi: number | null;
  /** Cambio del OI en los últimos ~15 min (%). */
  oiDeltaPct: number | null;
  absorcion: { lado: 'ask' | 'bid'; score: number; t: number } | null;
  agotamiento: { lado: 'bullish' | 'bearish'; score: number; t: number } | null;
  /** Imbalances y stacked de las últimas 5 dollar bars. */
  imbCompra: number;
  imbVenta: number;
  stackedCompra: number;
  stackedVenta: number;
  /** Últimos 5 min de mercado. */
  bigCompraUsd: number;
  bigVentaUsd: number;
  liqLargosUsd: number;
  liqCortosUsd: number;
  icebergs: number;
  stopRuns: number;
  poolArriba: { p: number; v: number } | null;
  poolAbajo: { p: number; v: number } | null;
  /** Delta / volumen de la última dollar bar. */
  deltaRatio: number | null;
  /** Absorción máxima de la última barra frente a la media de las 20 previas (× veces). */
  absorcionSpike: number | null;
  /** Compras y ventas agresivas de las últimas 28 dollar bars. */
  barrasFlujo: { compra: number; venta: number }[];
}

const CAPACIDAD_FEATURES = 20_000;

export class Pipeline {
  readonly mercado: MotorMercado;
  readonly cinta = new CintaTrades(500_000);
  readonly features = new Anillo<FilaFeatures>(CAPACIDAD_FEATURES);
  private canonica: SerieBarras;
  private vista: SerieBarras;
  private idVista: IdTemporalidad = '1m';
  private cvdCanonico: number[] = [];
  private totalFilas = 0;
  /** CVD de la vista (suma de deltas desde 00:00 UTC) y OI por barra de la vista. */
  private cvdVista = new Map<number, number>();
  private cvdAcum = 0;
  private diaCvd = -1;
  private golpes = new Anillo<{ t: number; p: number; q: number; compra: boolean }>(20_000);
  /** Hubo un corte (reconexión, resincronización, error) desde la última fila: la próxima se marca con hueco = 1. */
  private huecoPendiente = false;
  /** Eventos fuertes del calendario (fechas conocidas de antemano). */
  calendario: EventoCalendario[] = [];
  conexion: EstadoConexion = 'detenido';
  detalleConexion = '';

  readonly simbolo: string;
  readonly tickSize: number;

  constructor(readonly parametros: ParametrosSimbolo = parametrosPorDefecto()) {
    const { simbolo, tickSize, temporalidades, pasos } = parametros;
    this.simbolo = simbolo;
    this.tickSize = tickSize;
    this.mercado = new MotorMercado(simbolo, tickSize);
    this.canonica = new SerieBarras(temporalidades.dollar, pasos.dollar, 600, tickSize);
    this.vista = new SerieBarras(temporalidades['1m'], pasos['1m'], 600, tickSize);
  }

  get temporalidad(): IdTemporalidad {
    return this.idVista;
  }

  procesar(m: MensajeMercado): FilaFeatures[] {
    const nuevas: FilaFeatures[] = [];
    switch (m.tipo) {
      case 'trades': {
        for (const t of m.trades) {
          this.cinta.push(t);
          this.mercado.trade(t);
          this.golpes.push({ t: t.timestamp, p: t.price, q: t.quantity, compra: !t.buyerIsMaker });
          const c = this.canonica.agregar(t);
          if (c) nuevas.push(this.filaCanonica(c));
          this.alimentarVista(t);
        }
        this.mercado.finLote();
        const vencida = this.vista.cerrarSiVencida(this.mercado.ahora);
        if (vencida) this.registrarCvdVista(vencida);
        break;
      }
      case 'libro': {
        const velas = this.canonica.barras.ultimos(60).map((b) => ({ timestamp: b.inicio, high: b.ohlc.high, low: b.ohlc.low }));
        this.mercado.libroNuevo(m.vista, velas);
        break;
      }
      case 'oi':
        this.mercado.oiNuevo(m.snapshot);
        break;
      case 'liquidacion':
        this.mercado.liquidacion(m.liq);
        break;
      case 'funding':
        this.mercado.funding(m.tasa);
        break;
      case 'conexion':
        if (this.conexion === 'en-vivo' && m.estado !== 'en-vivo') this.huecoPendiente = true;
        this.conexion = m.estado;
        this.detalleConexion = m.detalle ?? '';
        break;
    }
    return nuevas;
  }

  /** Cambia la temporalidad del GRÁFICO reconstruyendo sus barras desde la cinta. No toca las Features. */
  cambiarTemporalidad(id: IdTemporalidad): void {
    if (id === this.idVista) return;
    this.idVista = id;
    this.vista = new SerieBarras(this.parametros.temporalidades[id], this.parametros.pasos[id], 600, this.tickSize);
    this.cvdVista = new Map();
    this.cvdAcum = 0;
    this.diaCvd = -1;
    this.cinta.recorrer(this.simbolo, (t) => this.alimentarVista(t));
    const vencida = this.vista.cerrarSiVencida(this.mercado.ahora);
    if (vencida) this.registrarCvdVista(vencida);
  }

  private alimentarVista(t: { timestamp: number; price: number; quantity: number; aggTradeId: number; buyerIsMaker: boolean; symbol: string }): void {
    const dia = Math.floor(t.timestamp / 86_400_000);
    if (dia !== this.diaCvd) {
      this.diaCvd = dia;
      this.cvdAcum = 0;
    }
    const d = t.buyerIsMaker ? -t.quantity : t.quantity;
    // En barras de tiempo el trade que cierra la barra pertenece a la siguiente; en barras de actividad, a la que cierra.
    const deTiempo = this.vista.temporalidad.tipo === 'tiempo';
    if (!deTiempo) this.cvdAcum += d;
    const v = this.vista.agregar(t);
    if (v) this.registrarCvdVista(v);
    if (deTiempo) this.cvdAcum += d;
  }

  private registrarCvdVista(b: BarraAnalizada): void {
    this.cvdVista.set(b.n, this.cvdAcum);
    if (this.cvdVista.size > 700) {
      const viejo = this.cvdVista.keys().next().value as number;
      this.cvdVista.delete(viejo);
    }
  }

  private filaCanonica(b: BarraAnalizada): FilaFeatures {
    const previas = this.canonica.barras.ultimos(121).slice(0, -1);
    const { fila } = construirFila(b, previas, this.mercado, this.cvdCanonico);
    fila.valores.hueco = this.huecoPendiente ? 1 : 0;
    fila.valores.ventana_evento = eventoEnVentana(this.calendario.filter((e) => e.impacto === 'alto'), b.cierre) ? 1 : 0;
    this.huecoPendiente = false;
    this.cvdCanonico.push(this.mercado.cvdSesion);
    if (this.cvdCanonico.length > 64) this.cvdCanonico = this.cvdCanonico.slice(-32);
    this.features.push(fila);
    this.totalFilas += 1;
    return fila;
  }

  private oiAl(t: number): number | null {
    const oi = this.mercado.oi;
    for (let i = oi.tamaño - 1; i >= 0; i -= 1) {
      const s = oi.get(i)!;
      if (s.time <= t) return s.oiContracts;
    }
    return null;
  }

  private aGrafico(b: BarraAnalizada | ReturnType<SerieBarras['enCurso']>, conNiveles: boolean, completa: boolean, cvd: number): BarraGrafico | null {
    if (!b) return null;
    const analizada = 'senales' in b ? (b as BarraAnalizada) : null;
    const niveles: NivelGrafico[] | undefined = conNiveles
      ? b.footprint.levels.map((l, i) => {
          const s = analizada?.senales.levels[i];
          return { p: l.price, b: l.bidQty, a: l.askQty, imb: s ? (s.imbalance === 'buying' ? 1 : s.imbalance === 'selling' ? -1 : 0) : 0 };
        })
      : undefined;
    return {
      n: b.n,
      t: b.inicio,
      fin: b.cierre,
      o: b.ohlc.open,
      h: b.ohlc.high,
      l: b.ohlc.low,
      c: b.ohlc.close,
      v: b.volumen,
      d: b.delta,
      poc: b.footprint.pocPrice,
      completa,
      niveles,
      absorcion: analizada ? analizada.absorcion.map((x) => ({ p: x.price, lado: x.side, s: x.absorptionScore })) : [],
      agotamiento: analizada?.agotamiento ? analizada.agotamiento.map((x) => ({ p: x.price, lado: x.side, s: x.exhaustionScore })) : null,
      cvd,
      oi: this.oiAl(b.cierre),
    };
  }

  /** Estado para dibujar. `nBarras` y `footprint` limitan el trabajo y el tamaño del mensaje. */
  private cacheHeatmap: { version: number; en: number; h: HeatmapGrafico | null } = { version: -1, en: 0, h: null };

  /** Heatmap de los últimos 30 min de libro (máx. 360 columnas × 360 niveles). Se recalcula como mucho 1 vez/s. */
  heatmap(ahoraMs: number, maxColumnas = 360, maxFilas = 360): HeatmapGrafico | null {
    const lhm = this.mercado.lhm;
    const c = this.cacheHeatmap;
    if (c.version === lhm.version || ahoraMs - c.en < 1_000) return c.h;
    const n = lhm.size;
    const ultima = lhm.last();
    const paso = this.mercado.libro ? this.mercado.libro.tickSize * this.mercado.libro.group : 0;
    if (n < 2 || !ultima || !(paso > 0)) return null;
    const salto = Math.max(1, Math.ceil(n / maxColumnas));
    const cols: NonNullable<ReturnType<typeof lhm.get>>[] = [];
    for (let i = (n - 1) % salto; i < n; i += salto) {
      const col = lhm.get(i);
      if (col && !col.synthetic) cols.push(col);
    }
    if (cols.length < 2) return null;
    const idx0 = ultima.bestBidIdx - Math.floor(maxFilas / 2);
    // Escala: percentil 98 de los tamaños (muestra) para que un muro gigante no apague el resto.
    const muestra: number[] = [];
    for (const col of cols) for (let k = 0; k < col.sizes.length; k += 3) if (col.sizes[k] > 0) muestra.push(col.sizes[k]);
    muestra.sort((a, b) => a - b);
    // Estilo Bookmap: la liquidez "normal" (hasta la mediana) queda oscura; solo brillan los muros.
    const mediana = muestra.length ? muestra[Math.floor(muestra.length * 0.5)] : 1;
    const maximo = muestra.length ? Math.max(muestra[Math.floor(muestra.length * 0.99)], mediana * 1.5) : 1;
    const den = Math.log(maximo / mediana) || 1;
    const datos = new Uint8Array(cols.length * maxFilas);
    cols.forEach((col, ci) => {
      for (let k = 0; k < col.sizes.length; k += 1) {
        const fila = col.minIdx + k - idx0;
        if (fila < 0 || fila >= maxFilas || col.sizes[k] <= mediana) continue;
        datos[ci * maxFilas + fila] = Math.min(255, Math.max(1, Math.round((Math.log(col.sizes[k] / mediana) / den) * 255)));
      }
    });
    const h: HeatmapGrafico = { tiempos: cols.map((x) => x.t), paso, idx0, filas: maxFilas, datos, maximo };
    this.cacheHeatmap = { version: lhm.version, en: ahoraMs, h };
    return h;
  }

  estado(opciones: { nBarras: number; footprint: boolean; nivelesFootprint: number; heatmap?: boolean }): EstadoGrafico {
    const ultimas = this.vista.barras.ultimos(opciones.nBarras);
    const desdeNiveles = ultimas.length - opciones.nivelesFootprint;
    const barras = ultimas.map((b, i) => this.aGrafico(b, opciones.footprint && i >= desdeNiveles, true, this.cvdVista.get(b.n) ?? 0)!);
    const enCurso = this.aGrafico(this.vista.enCurso(), opciones.footprint, false, this.cvdAcum);
    const ahora = this.mercado.ahora;

    let libro: LibroGrafico | null = null;
    const v = this.mercado.libro;
    if (v) {
      const porNivel = new Map<number, { compra: number; venta: number }>();
      for (let i = this.golpes.tamaño - 1; i >= 0; i -= 1) {
        const g = this.golpes.get(i)!;
        if (g.t < ahora - 10_000) break;
        const p = Math.round(g.p / (v.tickSize * v.group)) * v.tickSize * v.group;
        const x = porNivel.get(p) ?? { compra: 0, venta: 0 };
        if (g.compra) x.compra += g.q;
        else x.venta += g.q;
        porNivel.set(p, x);
      }
      libro = {
        bids: v.bids.slice(0, 60).map((l) => [l[0], l[1], l[2]]),
        asks: v.asks.slice(0, 60).map((l) => [l[0], l[1], l[2]]),
        paso: v.tickSize * v.group,
        mid: v.mid,
        spread: v.spread,
        imbalance: v.imbalance,
        obi10: v.obi?.n10 ?? null,
        microPrice: v.microPrice ?? null,
        golpes: [...porNivel].map(([p, x]) => ({ p, ...x })),
      };
    }

    const pools = this.mercado.poolsVivos().map((p) => ({ p: p.price, lado: p.side, v: p.volume, t0: p.t0 }));
    const ghosts = this.mercado.pools.ghostsAlive(ahora).map((g) => ({ p: g.price, lado: g.side, v: g.volume, t0: g.t0, tBarrido: g.tSwept }));
    const oiUltimo = this.mercado.oi.ultimo();

    return {
      simbolo: this.simbolo,
      tickSize: this.tickSize,
      temporalidad: this.idVista,
      paso: this.vista.paso,
      ahora,
      conexion: this.conexion,
      detalleConexion: this.detalleConexion,
      barras,
      enCurso,
      libro,
      pools,
      ghosts,
      eventos: this.mercado.eventos.ultimos(150).reverse(),
      metricas: { ...this.mercado.metricas(), barrasCanonicas: this.totalFilas, cvdSesion: this.mercado.cvdSesion, oiActual: oiUltimo?.oiContracts ?? null, vwapSesion: this.mercado.vwapSesion },
      features: { ultimas: this.features.ultimos(40).reverse(), total: this.totalFilas },
      heatmap: opciones.heatmap ? this.heatmap(ahora) : null,
      memoria: { ...this.mercado.memoria(), cinta: this.cinta.tamaño, barrasVista: this.vista.barras.tamaño, barrasCanonicas: this.canonica.barras.tamaño, filasFeatures: this.features.tamaño, cvdVista: this.cvdVista.size },
    };
  }

  resumen(): ResumenFlujo {
    const m = this.mercado;
    const ahora = m.ahora;
    const canon = this.canonica.barras.ultimos(30);
    const ultimas5 = canon.slice(-5);
    const suma = (f: (b: BarraAnalizada) => number) => ultimas5.reduce((a, b) => a + f(b), 0);

    // ATR(14) de la serie canónica.
    let atr: number | null = null;
    if (canon.length >= 2) {
      const desde = Math.max(1, canon.length - 14);
      let tot = 0;
      for (let i = desde; i < canon.length; i += 1) {
        const b = canon[i].ohlc;
        const prev = canon[i - 1].ohlc.close;
        tot += Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
      }
      atr = tot / (canon.length - desde);
    }

    let absorcion: ResumenFlujo['absorcion'] = null;
    let agotamiento: ResumenFlujo['agotamiento'] = null;
    for (let i = canon.length - 1; i >= Math.max(0, canon.length - 10); i -= 1) {
      const b = canon[i];
      if (!absorcion && b.absorcion.length) {
        const x = b.absorcion.reduce((a, c) => (c.absorptionScore > a.absorptionScore ? c : a));
        absorcion = { lado: x.side, score: x.absorptionScore, t: b.cierre };
      }
      if (!agotamiento && b.agotamiento?.length) {
        const x = b.agotamiento.reduce((a, c) => (c.exhaustionScore > a.exhaustionScore ? c : a));
        agotamiento = { lado: x.side, score: x.exhaustionScore, t: b.cierre };
      }
    }

    const ev = m.eventosDisponibles(ahora, ahora - 300_000);
    const usd = (tipo: EventoMotor['tipo'], lado: EventoMotor['lado']) => ev.filter((e) => e.tipo === tipo && e.lado === lado).reduce((a, e) => a + e.magnitud, 0);

    const oiUlt = m.oi.ultimo();
    let oiDeltaPct: number | null = null;
    if (oiUlt) {
      for (let i = m.oi.tamaño - 1; i >= 0; i -= 1) {
        const x = m.oi.get(i)!;
        if (x.time <= oiUlt.time - 900_000 || i === 0) {
          oiDeltaPct = x.oiContracts > 0 && x !== oiUlt ? (oiUlt.oiContracts / x.oiContracts - 1) * 100 : null;
          break;
        }
      }
    }

    const precio = m.ultimoPrecio;
    const pools = m.poolsVivos();
    let poolArriba: ResumenFlujo['poolArriba'] = null;
    let poolAbajo: ResumenFlujo['poolAbajo'] = null;
    if (precio !== null) {
      for (const p of pools) {
        if (p.side === 'ask' && p.price > precio && (!poolArriba || p.price < poolArriba.p)) poolArriba = { p: p.price, v: p.volume };
        if (p.side === 'bid' && p.price < precio && (!poolAbajo || p.price > poolAbajo.p)) poolAbajo = { p: p.price, v: p.volume };
      }
    }

    const ultima = canon[canon.length - 1];
    const maxAbs = (b: BarraAnalizada) => (b.absorcion.length ? Math.max(...b.absorcion.map((x) => x.absorptionScore)) : 0);
    const previas = canon.slice(-21, -1);
    const mediaAbs = previas.length ? previas.reduce((a, b) => a + maxAbs(b), 0) / previas.length : 0;

    return {
      precio,
      spread: m.libro?.spread ?? null,
      aperturaSesion: m.aperturaSesion,
      vwap: m.vwapSesion,
      cvdSesion: m.cvdSesion,
      atr,
      oi: oiUlt?.oiContracts ?? null,
      oiDeltaPct,
      absorcion,
      agotamiento,
      imbCompra: suma((b) => b.senales.levels.filter((l) => l.buyingImbalance).length),
      imbVenta: suma((b) => b.senales.levels.filter((l) => l.sellingImbalance).length),
      stackedCompra: suma((b) => b.senales.stackedImbalances.filter((x) => x.direction === 'buying').length),
      stackedVenta: suma((b) => b.senales.stackedImbalances.filter((x) => x.direction === 'selling').length),
      bigCompraUsd: usd('bigtrade', 'compra'),
      bigVentaUsd: usd('bigtrade', 'venta'),
      liqLargosUsd: usd('liquidacion', 'venta'),
      liqCortosUsd: usd('liquidacion', 'compra'),
      icebergs: ev.filter((e) => e.tipo === 'iceberg').length,
      stopRuns: ev.filter((e) => e.tipo === 'stoprun').length,
      poolArriba,
      poolAbajo,
      deltaRatio: ultima && ultima.volumen > 0 ? ultima.delta / ultima.volumen : null,
      absorcionSpike: ultima && mediaAbs > 0 ? maxAbs(ultima) / mediaAbs : null,
      barrasFlujo: canon.slice(-28).map((b) => ({ compra: (b.volumen + b.delta) / 2, venta: (b.volumen - b.delta) / 2 })),
    };
  }

  todasLasFilas(): FilaFeatures[] {
    return this.features.ultimos(this.features.tamaño);
  }
}

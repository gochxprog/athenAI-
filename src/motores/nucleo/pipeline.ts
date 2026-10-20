// Pipeline de Order Flow: fuente → motores → (Features para el ML) + (estado para el gráfico).
//
// - Serie CANÓNICA (dollar bars de 10 M USD): alimenta las Features. No cambia con lo que se mire en pantalla.
// - Serie VISTA: la temporalidad elegida en el gráfico; se reconstruye desde la cinta al cambiarla.
// Todo acotado: anillos de tamaño fijo y cinta tipada. El reloj es el del flujo.
import { Anillo, CintaTrades } from './anillo';
import { SerieBarras, type BarraAnalizada } from './serieBarras';
import { MotorMercado, type MetricasFlujo } from './motorMercado';
import { construirFila, type FilaFeatures } from './features';
import { AGRUPACION_POR_TEMPORALIDAD, TEMPORALIDADES, type EstadoConexion, type EventoMotor, type IdTemporalidad, type MensajeMercado } from './tipos';

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
  conexion: EstadoConexion = 'detenido';
  detalleConexion = '';

  constructor(readonly simbolo = 'BTCUSDT', readonly tickSize = 0.1) {
    this.mercado = new MotorMercado(simbolo, tickSize);
    this.canonica = new SerieBarras(TEMPORALIDADES.dollar, AGRUPACION_POR_TEMPORALIDAD.dollar, 600, tickSize);
    this.vista = new SerieBarras(TEMPORALIDADES['1m'], AGRUPACION_POR_TEMPORALIDAD['1m'], 600, tickSize);
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
      case 'conexion':
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
    this.vista = new SerieBarras(TEMPORALIDADES[id], AGRUPACION_POR_TEMPORALIDAD[id], 600, this.tickSize);
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
  estado(opciones: { nBarras: number; footprint: boolean; nivelesFootprint: number }): EstadoGrafico {
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
      memoria: { ...this.mercado.memoria(), cinta: this.cinta.tamaño, barrasVista: this.vista.barras.tamaño, barrasCanonicas: this.canonica.barras.tamaño, filasFeatures: this.features.tamaño, cvdVista: this.cvdVista.size },
    };
  }

  todasLasFilas(): FilaFeatures[] {
    return this.features.ultimos(this.features.tamaño);
  }
}

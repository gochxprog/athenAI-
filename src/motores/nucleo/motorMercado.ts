// Motores que no dependen de la temporalidad: libro (DOM), LHM, icebergs, stop runs, big trades, CVD de sesión y OI.
// Todo el estado está acotado; el reloj es SIEMPRE el del flujo de datos (nunca Date.now()), así que la
// misma cinta produce exactamente los mismos eventos en vivo y en un backtest.
import { pickAutoSession, SessionCVDEngine } from '../flujo/order-flow/session-cvd';
import { BigTradeDetector, type BigTradeEvent } from '../flujo/big-trades/engine';
import { IcebergTracker, type IcebergTrade } from '../flujo/order-flow/iceberg-detector';
import { StopRunSeries, type StopRunTrade } from '../flujo/order-flow/stoprun-detector';
import { LiquidityHistory } from '../flujo/lhm/liquidity-history';
import { DEFAULT_POOL_CONFIG, LiquidityPoolEngine, type Pool, type PoolCandle, type PoolConfig } from '../flujo/lhm/liquidity-pools';
import { Anillo } from './anillo';
import { grupoParaPrecio } from './parametros';
import type { AggTrade, EventoMotor, Liquidacion, OpenInterestSnapshot, OrderBookView } from './tipos';

/** 30 min de libro a 1 foto/s (6 h serían hasta ~345 MB por símbolo en el peor caso). */
const CAPACIDAD_LHM = 1_800;
const CINTA_ICEBERG_MAX = 40_000;
const MAX_EVENTOS = 600;
const MAX_IDS_VISTOS = 4_000;
const MARGEN_INICIO_MS = 60_000;
/** Una foto del libro vale para una barra si es de hasta 2 s antes de su cierre (si no: libro viejo o resincronizando). */
const LIBRO_VIGENTE_MS = 2_000;

export interface MetricasFlujo {
  tradesPorSeg: number;
  volumenPorSeg: number;
  nocionalPorSeg: number;
  compraPorSeg: number;
  ventaPorSeg: number;
}

/** Lo grabado antes de un reinicio, hasta `hasta` (ms): la sesión del CVD (delta y volumen desde su inicio) y el
 *  día UTC del VWAP (apertura, Σ precio × volumen y volumen desde las 00:00). Cada parte, null si no está completa. */
export interface BaseSesion {
  hasta: number;
  cvd: { inicioSesion: number; delta: number; volumen: number } | null;
  dia: { inicio: number; apertura: number; nocional: number; volumen: number } | null;
}

export class MotorMercado {
  readonly cvd: SessionCVDEngine;
  readonly bigTrades: BigTradeDetector;
  readonly icebergs = new IcebergTracker();
  readonly stopRuns = new StopRunSeries();
  readonly lhm = new LiquidityHistory(CAPACIDAD_LHM, 1_000);
  readonly pools = new LiquidityPoolEngine();
  readonly configPools: PoolConfig = { ...DEFAULT_POOL_CONFIG, group: 5, minPersistence: 3 };
  readonly eventos = new Anillo<EventoMotor>(MAX_EVENTOS);
  readonly oi = new Anillo<OpenInterestSnapshot>(5_000);
  /** Últimas fotos del libro con sus pools y las últimas tasas de funding, con su hora: cada barra toma las vigentes
   *  a su cierre y nunca una posterior (el libro se publica cada 250 ms y los trades cada 100 ms). */
  private readonly fotos = new Anillo<{ t: number; vista: OrderBookView; pools: Pool[] }>(16);
  private readonly fundings = new Anillo<{ t: number; tasa: number }>(8);

  libro: OrderBookView | null = null;
  ahora = 0;
  ultimoPrecio: number | null = null;
  /** Primer precio de la sesión UTC en curso. */
  aperturaSesion: number | null = null;
  cvdSesion = 0;
  /** Volumen (compra + venta) negociado en la sesión del CVD: para el ratio CVD / volumen. */
  cvdVolumenSesion = 0;
  /** VWAP de la sesión UTC en curso. */
  vwapSesion: number | null = null;
  /**
   * El CVD y el VWAP «de sesión» solo son completos si se vio la sesión desde su inicio (con 1 min de margen) y sin
   * cortes. Si la app se abrió a mitad de sesión o se cortó la conexión, empiezan a medias: las Features lo marcan.
   */
  cvdCompleto = false;
  vwapCompleto = false;
  /** La sesión del CVD está abierta (entre 21:00 y 22:00 UTC no hay ninguna: el CVD queda congelado). */
  cvdActivo = false;
  /** Última tasa de funding conocida (perpetuos; null si la fuente no la da). */
  fundingTasa: number | null = null;

  private cintaIceberg: IcebergTrade[] = [];
  private loteStopRun: StopRunTrade[] = [];
  private readonly idsVistos = new Map<string, true>();
  private ghostsVistos = new Map<string, true>();
  private sesionUtc = -1;
  private base: BaseSesion | null = null;
  private cvdBase = 0;
  private volumenBase = 0;
  private nocionalSesion = 0;
  private volumenSesion = 0;
  // Métricas por segundo (anillo de 10 s).
  private readonly segundos = new Anillo<{ s: number; n: number; v: number; usd: number; compra: number; venta: number }>(10);

  constructor(readonly simbolo = 'BTCUSDT', readonly tickSize = 0.1) {
    this.cvd = new SessionCVDEngine({ symbol: simbolo, bucketMs: 60_000, maxPointsPerSession: 1_500 });
    this.bigTrades = new BigTradeDetector(simbolo);
  }

  trade(t: AggTrade): void {
    if (t.timestamp > this.ahora) this.ahora = t.timestamp;
    this.ultimoPrecio = t.price;
    const r = this.cvd.processTick({ timestamp: t.timestamp, price: t.price, volume: t.quantity, isBuyerMaker: t.buyerIsMaker, id: t.aggTradeId });
    const sesion = this.cvd.getState(r.session);
    const auto = pickAutoSession(t.timestamp);
    this.cvdActivo = auto.active;
    if (r.isReset) {
      // Tras un reinicio a mitad de sesión: lo grabado desde su inicio (sin cortes y hasta hace nada) la completa.
      const b = this.base?.cvd && this.base.cvd.inicioSesion === auto.startMs && t.timestamp - this.base.hasta <= MARGEN_INICIO_MS ? this.base.cvd : null;
      if (this.base) this.base.cvd = null;
      const sirve = !!b;
      this.cvdBase = b?.delta ?? 0;
      this.volumenBase = b?.volumen ?? 0;
      this.cvdCompleto = sirve || t.timestamp - auto.startMs <= MARGEN_INICIO_MS;
    }
    this.cvdSesion = r.cvd + this.cvdBase;
    this.cvdVolumenSesion = sesion.buyVolume + sesion.sellVolume + this.volumenBase;

    const dia = Math.floor(t.timestamp / 86_400_000);
    if (dia !== this.sesionUtc) {
      this.sesionUtc = dia;
      this.aperturaSesion = t.price;
      this.nocionalSesion = 0;
      this.volumenSesion = 0;
      this.vwapCompleto = t.timestamp - dia * 86_400_000 <= MARGEN_INICIO_MS;
      // Tras un reinicio: el día ya grabado desde las 00:00 (sin cortes y hasta hace nada) lo completa.
      const d = this.base?.dia;
      if (d && d.inicio === dia * 86_400_000 && t.timestamp - this.base!.hasta <= MARGEN_INICIO_MS) {
        [this.aperturaSesion, this.nocionalSesion, this.volumenSesion, this.vwapCompleto] = [d.apertura, d.nocional, d.volumen, true];
      }
      if (this.base) this.base.dia = null;
    }
    this.nocionalSesion += t.price * t.quantity;
    this.volumenSesion += t.quantity;
    this.vwapSesion = this.nocionalSesion / this.volumenSesion;

    for (const ev of this.bigTrades.ingest(t, t.timestamp)) this.registrarBigTrade(ev, t.timestamp);

    const lado = t.buyerIsMaker ? 'SELL' : 'BUY';
    this.cintaIceberg.push({ ts: t.timestamp, price: t.price, qty: t.quantity, side: lado });
    this.loteStopRun.push({ id: t.aggTradeId, ts: t.timestamp, price: t.price, qty: t.quantity, side: lado });

    const s = Math.floor(t.timestamp / 1000);
    let seg = this.segundos.ultimo();
    if (!seg || seg.s !== s) {
      seg = { s, n: 0, v: 0, usd: 0, compra: 0, venta: 0 };
      this.segundos.push(seg);
    }
    seg.n += 1;
    seg.v += t.quantity;
    seg.usd += t.price * t.quantity;
    if (t.buyerIsMaker) seg.venta += t.quantity;
    else seg.compra += t.quantity;
  }

  /** Tras cada lote de trades: motores que trabajan por lote. */
  finLote(): void {
    if (this.loteStopRun.length > 0) {
      const antes = this.stopRuns.version;
      // «Tick» del detector = paso del libro (tick × agrupación, ≈ 1 USD en BTC): con el tick crudo
      // (0,1 USD) la ruptura mínima de 2 ticks era de 20 centavos y cualquier ruido contaba como ruptura.
      // Sin libro (historia importada) se usa la misma agrupación que tendría el libro a ese precio.
      const paso = this.libro ? this.libro.tickSize * this.libro.group : this.tickSize * grupoParaPrecio(this.ultimoPrecio ?? 0, this.tickSize);
      this.stopRuns.update(this.loteStopRun, paso);
      this.loteStopRun = [];
      if (this.stopRuns.version !== antes) {
        for (const e of this.stopRuns.events) {
          const id = `sr:${e.id}`;
          if (this.idsVistos.has(id)) continue;
          this.recordarId(id);
          this.registrar({
            id,
            tipo: 'stoprun',
            t: e.breakT,
            disponibleEn: this.ahora,
            precio: e.level,
            lado: e.direction === 'HIGH' ? 'compra' : 'venta',
            magnitud: e.burstMultiple,
            detalle: `Barrido del ${e.direction === 'HIGH' ? 'máximo' : 'mínimo'} ${e.level.toFixed(1)} · ráfaga ${e.burstMultiple.toFixed(1)}× · ${e.confidence}`,
          });
        }
      }
    }
    for (const ev of this.bigTrades.flushIfIdle(this.ahora)) this.registrarBigTrade(ev, this.ahora);
    // Cinta acotada para icebergs: solo hace falta el tramo reciente (amortizado O(1)).
    if (this.cintaIceberg.length > CINTA_ICEBERG_MAX) this.cintaIceberg = this.cintaIceberg.slice(-CINTA_ICEBERG_MAX / 2);
  }

  /** Nueva foto del libro (vista agregada del libro). */
  libroNuevo(vista: OrderBookView, velas: readonly PoolCandle[]): void {
    this.procesarLibro(vista, velas);
    this.fotos.push({ t: vista.updatedAt, vista, pools: [...this.pools.list()] });
  }

  /** La foto del libro (y sus pools) vigente en t: la última con hora ≤ t y de hace menos de 2 s; si no, null. */
  libroEn(t: number): { vista: OrderBookView; pools: Pool[] } | null {
    for (let i = this.fotos.tamaño - 1; i >= 0; i -= 1) {
      const f = this.fotos.get(i)!;
      if (f.t <= t) return t - f.t <= LIBRO_VIGENTE_MS ? f : null;
    }
    return null;
  }

  /** Tasa de funding publicada hasta t (la última con hora ≤ t). */
  fundingEn(t: number): number | null {
    for (let i = this.fundings.tamaño - 1; i >= 0; i -= 1) if (this.fundings.get(i)!.t <= t) return this.fundings.get(i)!.tasa;
    return null;
  }

  private procesarLibro(vista: OrderBookView, velas: readonly PoolCandle[]): void {
    this.libro = vista;
    const t = Math.max(this.ahora, vista.updatedAt);
    if (t > this.ahora) this.ahora = t;
    if (!this.lhm.record(vista, t)) return;

    const antes = this.icebergs.version;
    this.icebergs.update(this.lhm, this.cintaIceberg);
    if (this.icebergs.version !== antes) {
      for (const e of this.icebergs.events) {
        const id = `ice:${e.id}`;
        if (this.idsVistos.has(id)) continue;
        this.recordarId(id);
        this.registrar({
          id,
          tipo: 'iceberg',
          t: e.firstT,
          disponibleEn: t,
          precio: e.price,
          lado: e.side === 'ASK' ? 'compra' : 'venta',
          magnitud: e.ratio,
          detalle: `Iceberg ${e.side === 'BID' ? 'comprador en el bid' : 'vendedor en el ask'} · ${e.filled.toFixed(2)} ejecutado vs ${e.peakVisible.toFixed(2)} visible · ${e.reloads} recargas`,
        });
      }
    }

    this.pools.sync(this.lhm, this.configPools, velas, t);
    for (const g of this.pools.ghostsAlive(t)) {
      const id = `pool:${g.key}:${g.tSwept}`;
      if (this.ghostsVistos.has(id)) continue;
      this.ghostsVistos.set(id, true);
      if (this.ghostsVistos.size > 600) this.ghostsVistos = new Map([...this.ghostsVistos].slice(-300));
      this.registrar({
        id,
        tipo: 'pool-barrido',
        t: g.tSwept,
        disponibleEn: t,
        precio: g.price,
        lado: g.side === 'ask' ? 'compra' : 'venta',
        magnitud: g.volume,
        detalle: `Pool ${g.side === 'ask' ? 'vendedor (ask)' : 'comprador (bid)'} de ${g.volume.toFixed(1)} barrido en ${g.price.toFixed(1)}`,
      });
    }
  }

  oiNuevo(s: OpenInterestSnapshot): void {
    const ultimo = this.oi.ultimo();
    if (ultimo && s.time <= ultimo.time) return;
    this.oi.push(s);
  }

  poolsVivos(): Pool[] {
    return this.pools.list();
  }

  metricas(): MetricasFlujo {
    const segs = this.segundos.ultimos(10).filter((x) => x.s >= Math.floor(this.ahora / 1000) - 10);
    const n = Math.max(1, segs.length);
    const suma = (k: 'n' | 'v' | 'usd' | 'compra' | 'venta') => segs.reduce((a, x) => a + x[k], 0) / n;
    return { tradesPorSeg: suma('n'), volumenPorSeg: suma('v'), nocionalPorSeg: suma('usd'), compraPorSeg: suma('compra'), ventaPorSeg: suma('venta') };
  }

  /** Tamaño de las estructuras internas: sirve para vigilar que nada crece sin límite. */
  memoria() {
    return {
      columnasLhm: this.lhm.size,
      pools: this.pools.size,
      rachasPools: this.pools.streakSize,
      eventos: this.eventos.tamaño,
      cintaIceberg: this.cintaIceberg.length,
      barrasStopRun: this.stopRuns.barCount,
      eventosStopRun: this.stopRuns.events.length,
      eventosIceberg: this.icebergs.events.length,
      idsVistos: this.idsVistos.size,
      oi: this.oi.tamaño,
    };
  }

  /** Eventos conocidos en (desde, hasta]: cada evento cae en UNA sola barra (sin contar dos veces ni perder los que
   *  llegan entre el cierre de una barra y el primer trade de la siguiente). `disponibleEn` no siempre crece en el
   *  anillo (liquidaciones y big trades), así que se recorre entero (está acotado a MAX_EVENTOS). */
  eventosDisponibles(hasta: number, desde: number): EventoMotor[] {
    const out: EventoMotor[] = [];
    for (let i = this.eventos.tamaño - 1; i >= 0; i -= 1) {
      const e = this.eventos.get(i) as EventoMotor;
      if (e.disponibleEn > desde && e.disponibleEn <= hasta) out.push(e);
    }
    return out;
  }

  /** Hubo un corte de datos: el CVD y el VWAP de la sesión en curso ya no están completos. */
  /** Lo grabado antes de reiniciar (se usa en el primer trade si encaja; ver trade()). */
  sembrar(b: BaseSesion): void {
    this.base = { ...b };
  }

  marcarHueco(): void {
    this.cvdCompleto = false;
    this.vwapCompleto = false;
  }

  /** Tasa de funding vigente publicada por el exchange (Binance markPrice). */
  funding(tasa: number, t = this.ahora): void {
    if (!Number.isFinite(tasa)) return;
    this.fundingTasa = tasa;
    this.fundings.push({ t, tasa });
  }

  /** Liquidación forzada publicada por el exchange (Binance forceOrder). */
  liquidacion(liq: Liquidacion): void {
    const usd = liq.precio * liq.cantidad;
    const disponibleEn = Math.max(this.ahora, liq.t);
    this.registrar({
      id: `liq:${liq.t}:${liq.precio}:${liq.cantidad}:${liq.lado}`,
      tipo: 'liquidacion',
      t: liq.t,
      disponibleEn,
      precio: liq.precio,
      lado: liq.lado,
      magnitud: usd,
      detalle: `Liquidación de ${liq.lado === 'venta' ? 'largos' : 'cortos'} · ${(usd / 1e3).toFixed(0)} k USD a ${liq.precio}`,
    });
  }

  private registrarBigTrade(ev: BigTradeEvent, disponibleEn: number): void {
    this.registrar({
      id: `bt:${ev.timestamp}:${ev.price}:${ev.volume_base}`,
      tipo: 'bigtrade',
      t: ev.timestamp,
      disponibleEn,
      precio: ev.price,
      lado: ev.side === 'BUY' ? 'compra' : 'venta',
      magnitud: ev.notional_usd,
      detalle: `Big trade ${ev.side === 'BUY' ? 'comprador' : 'vendedor'} ${ev.volume_base.toFixed(3)} BTC · ${(ev.notional_usd / 1e3).toFixed(0)} k USD · z ${ev.z_score.toFixed(1)}`,
    });
  }

  registrar(e: EventoMotor): void {
    this.eventos.push(e);
  }

  private recordarId(id: string): void {
    this.idsVistos.set(id, true);
    if (this.idsVistos.size > MAX_IDS_VISTOS) {
      // Se descarta la mitad más antigua (Map conserva el orden de inserción).
      let quitar = this.idsVistos.size - MAX_IDS_VISTOS / 2;
      for (const k of this.idsVistos.keys()) {
        if (quitar-- <= 0) break;
        this.idsVistos.delete(k);
      }
    }
  }
}

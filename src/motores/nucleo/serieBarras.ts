// Serie de barras analizadas: Footprint + señales microestructurales + absorción + agotamiento.
// Todas las evaluaciones usan los motores de Urus SIN modificar su lógica.
import { computeCandleSignals, computeVolumeBaseline, type FootprintCandleSignals } from '../urus/order-flow/microstructure';
import { evaluateAbsorptionAt, DEFAULT_ABSORPTION_CONFIG, type AbsorptionCandleInput, type AbsorptionDetection } from '../urus/order-flow/absorption-engine';
import { evaluateExhaustionAt, DEFAULT_EXHAUSTION_CONFIG, type ExhaustionDetection } from '../urus/order-flow/exhaustion-engine';
import { Anillo } from './anillo';
import { ConstructorBarras, type BarraCerrada } from './barras';
import type { AggTrade, Temporalidad } from './tipos';

export interface BarraAnalizada extends BarraCerrada {
  /** Imbalances diagonales, stacked imbalances, POC y delta-POC (microstructure de Urus). */
  senales: FootprintCandleSignals;
  /** Absorciones de ESTA barra. Disponibles al cierre de la barra. */
  absorcion: AbsorptionDetection[];
  /**
   * Agotamiento de ESTA barra. El motor de Urus usa la vela SIGUIENTE como evidencia de falta de continuación,
   * así que solo se conoce al cerrar la barra siguiente: null hasta entonces (nunca se adelanta al ML).
   */
  agotamiento: ExhaustionDetection[] | null;
  /** Instante del flujo en que se conoció `agotamiento` (= cierre de la barra siguiente). */
  agotamientoDisponibleEn: number | null;
}

// Ventana que necesitan los motores: base de 20 velas + contexto/persistencia + la vela siguiente.
const VENTANA = Math.max(DEFAULT_ABSORPTION_CONFIG.lookbackCandles, DEFAULT_EXHAUSTION_CONFIG.lookbackCandles, DEFAULT_EXHAUSTION_CONFIG.extremeLookbackCandles) + 2;

export class SerieBarras {
  readonly barras: Anillo<BarraAnalizada>;
  private readonly constructorBarras: ConstructorBarras;
  /** Entradas de los motores, reutilizadas para que los cachés internos (WeakMap por array de niveles) acierten. */
  private readonly entradas = new WeakMap<BarraAnalizada, AbsorptionCandleInput>();

  constructor(
    readonly temporalidad: Temporalidad,
    paso: number,
    capacidad = 600,
    tickSize = 0.1,
  ) {
    this.constructorBarras = new ConstructorBarras(temporalidad, paso, tickSize);
    this.barras = new Anillo<BarraAnalizada>(capacidad);
  }

  get paso(): number {
    return this.constructorBarras.pasoEfectivo;
  }

  /** Procesa un trade. Devuelve la barra cerrada y analizada, si se cerró alguna. */
  agregar(t: AggTrade): BarraAnalizada | null {
    const cerrada = this.constructorBarras.agregar(t);
    return cerrada ? this.analizar(cerrada) : null;
  }

  cerrarSiVencida(ahora: number): BarraAnalizada | null {
    const cerrada = this.constructorBarras.cerrarSiVencida(ahora);
    return cerrada ? this.analizar(cerrada) : null;
  }

  enCurso(): BarraCerrada | null {
    return this.constructorBarras.enCurso();
  }

  private entrada(b: BarraAnalizada): AbsorptionCandleInput {
    let e = this.entradas.get(b);
    if (!e) {
      e = { timestamp: b.inicio, levels: b.footprint.levels, complete: true, ohlc: b.ohlc };
      this.entradas.set(b, e);
    }
    return e;
  }

  private analizar(b: BarraCerrada): BarraAnalizada {
    const previas = this.barras.ultimos(VENTANA - 1);
    const baseline = computeVolumeBaseline(previas.map((p) => ({ timestamp: p.inicio, levels: p.footprint.levels })));
    const senales = computeCandleSignals(
      { timestamp: b.inicio, levels: b.footprint.levels, pocPrice: b.footprint.pocPrice, open: b.ohlc.open, close: b.ohlc.close },
      { step: this.paso, baseline, direction: b.ohlc.close >= b.ohlc.open ? 'up' : 'down' },
    );
    const analizada: BarraAnalizada = { ...b, senales, absorcion: [], agotamiento: null, agotamientoDisponibleEn: null };

    const ventana = [...previas, analizada];
    const entradas = ventana.map((x) => this.entrada(x));
    const idx = entradas.length - 1;
    analizada.absorcion = evaluateAbsorptionAt(entradas, idx, this.paso).detections;

    // Agotamiento de la barra ANTERIOR, ahora que existe la siguiente (esta) como evidencia.
    if (idx >= 1) {
      const anterior = ventana[idx - 1];
      anterior.agotamiento = evaluateExhaustionAt(entradas, idx - 1, this.paso).detections;
      anterior.agotamientoDisponibleEn = b.cierre;
    }

    this.barras.push(analizada);
    return analizada;
  }
}

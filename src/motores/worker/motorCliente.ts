// Cliente único del Worker del motor. Vive mientras la app esté abierta: el motor sigue procesando y
// generando Features aunque el usuario cambie de módulo (los modelos no pierden barras).
import type { EstadoGrafico } from '../nucleo/pipeline';
import type { IdTemporalidad } from '../nucleo/tipos';
import type { ConfigFuente, MensajeAlMotor, MensajeDelMotor } from './protocolo';

type Oyente = (estado: EstadoGrafico, msProceso: number) => void;

class MotorCliente {
  private worker: Worker | null = null;
  private oyentes = new Set<Oyente>();
  private ultimo: { estado: EstadoGrafico; ms: number } | null = null;
  private esperandoCsv: ((csv: string, filas: number) => void) | null = null;
  fuente: ConfigFuente = { tipo: 'demo' };
  error: string | null = null;

  private asegurar(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./motor.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MensajeDelMotor>) => {
      const m = e.data;
      if (m.tipo === 'estado') {
        this.ultimo = { estado: m.estado, ms: m.msProceso };
        for (const o of this.oyentes) o(m.estado, m.msProceso);
      } else if (m.tipo === 'features-csv') {
        this.esperandoCsv?.(m.csv, m.filas);
        this.esperandoCsv = null;
      } else if (m.tipo === 'error') {
        this.error = m.mensaje;
      }
    };
    w.onerror = (e) => {
      this.error = e.message || 'Error en el motor';
    };
    this.worker = w;
    this.enviar({ tipo: 'iniciar', fuente: this.fuente });
    return w;
  }

  private enviar(m: MensajeAlMotor): void {
    this.asegurar().postMessage(m);
  }

  suscribir(o: Oyente): () => void {
    this.asegurar();
    this.oyentes.add(o);
    if (this.ultimo) o(this.ultimo.estado, this.ultimo.ms);
    return () => this.oyentes.delete(o);
  }

  usarFuente(f: ConfigFuente): void {
    this.fuente = f;
    this.enviar({ tipo: 'iniciar', fuente: f });
  }

  temporalidad(id: IdTemporalidad): void {
    this.enviar({ tipo: 'temporalidad', id });
  }

  vista(nBarras: number, footprint: boolean, nivelesFootprint: number): void {
    this.enviar({ tipo: 'vista', nBarras, footprint, nivelesFootprint });
  }

  exportarFeatures(): Promise<{ csv: string; filas: number }> {
    return new Promise((ok) => {
      this.esperandoCsv = (csv, filas) => ok({ csv, filas });
      this.enviar({ tipo: 'exportar-features' });
    });
  }
}

export const motorOrderFlow = new MotorCliente();

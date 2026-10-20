// Cliente del worker del Laboratorio. Se crea al primer uso; «Cancelar» lo termina (corta bucles infinitos).
import type { EstrategiaEnVivo, MensajeLaboratorio, MensajeSenales, PeticionLaboratorio, PeticionSenales, RespuestaLaboratorio, SenalEstrategia } from './protocolo';

class LaboratorioCliente {
  private worker: Worker | null = null;
  private siguiente = 1;
  private enSenales = new Map<number, (s: SenalEstrategia[]) => void>();
  private pendiente: { id: number; ok: (r: RespuestaLaboratorio) => void; mal: (e: Error) => void; progreso: (t: string) => void } | null = null;

  private asegurar(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./laboratorio.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MensajeLaboratorio | MensajeSenales>) => {
      const m = e.data;
      if (m.tipo === 'senales') {
        this.enSenales.get(m.id)?.(m.senales);
        this.enSenales.delete(m.id);
        return;
      }
      const p = this.pendiente;
      if (!p || m.id !== p.id) return;
      if (m.tipo === 'progreso') p.progreso(m.texto);
      else {
        this.pendiente = null;
        if (m.tipo === 'resultado') p.ok(m.respuesta);
        else p.mal(new Error(m.mensaje));
      }
    };
    w.onerror = (e) => {
      for (const ok of this.enSenales.values()) ok([]);
      this.enSenales.clear();
      this.pendiente?.mal(new Error(e.message || 'Error en el laboratorio'));
      this.pendiente = null;
    };
    this.worker = w;
    return w;
  }

  ejecutar(peticion: Omit<PeticionLaboratorio, 'id'>, progreso: (texto: string) => void): Promise<RespuestaLaboratorio> {
    this.cancelar();
    const id = this.siguiente++;
    return new Promise((ok, mal) => {
      this.pendiente = { id, ok, mal, progreso };
      this.asegurar().postMessage({ ...peticion, id });
    });
  }

  /** Señal actual de estrategias juzgadas (se usa un worker aparte para no cruzarse con el Juez). */
  senales(estrategias: EstrategiaEnVivo[]): Promise<SenalEstrategia[]> {
    const id = this.siguiente++;
    return new Promise((ok) => {
      this.enSenales.set(id, ok);
      this.asegurar().postMessage({ tipo: 'senales', id, estrategias } satisfies PeticionSenales);
    });
  }

  /** Detiene la ejecución en curso (termina el worker; Python se vuelve a cargar en la siguiente). */
  cancelar(): void {
    if (!this.pendiente) return;
    this.pendiente.mal(new Error('Cancelado'));
    this.pendiente = null;
    this.worker?.terminate();
    this.worker = null;
  }
}

export const laboratorio = new LaboratorioCliente();
/** Worker propio para las señales en vivo del Panel General. */
export const senalesLaboratorio = new LaboratorioCliente();

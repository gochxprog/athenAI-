// Cliente del worker del Laboratorio. Se crea al primer uso; «Cancelar» lo termina (corta bucles infinitos).
import type { MensajeLaboratorio, PeticionLaboratorio, RespuestaLaboratorio } from './protocolo';

class LaboratorioCliente {
  private worker: Worker | null = null;
  private siguiente = 1;
  private pendiente: { id: number; ok: (r: RespuestaLaboratorio) => void; mal: (e: Error) => void; progreso: (t: string) => void } | null = null;

  private asegurar(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./laboratorio.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MensajeLaboratorio>) => {
      const m = e.data;
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

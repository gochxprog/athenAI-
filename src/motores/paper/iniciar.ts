// Arranca el motor de Paper Trading con el flujo del motor, las señales del Laboratorio y el notificador.
import { motorOrderFlow } from '../worker/motorCliente';
import { senalesLaboratorio } from '../laboratorio/laboratorioCliente';
import { notificador } from '../notificaciones/notificador';
import { AlmacenPaper } from './almacenPaper';
import { MotorPaper } from './motorPaper';

export const motorPaper = new MotorPaper({
  senales: (xs) => senalesLaboratorio.senales(xs),
  avisar: (a) => void notificador.enviar(a),
  reloj: () => Date.now(),
  almacen: new AlmacenPaper(),
  local: typeof localStorage === 'undefined' ? null : localStorage,
});

let iniciado = false;

export function iniciarPaper(): void {
  if (iniciado) return;
  iniciado = true;
  let ocupado = false;
  void motorPaper.cargar().then(() => {
    motorOrderFlow.suscribirFeeds((feeds) => {
      // Si la revisión anterior sigue (Python calculando una señal), se salta este segundo.
      if (ocupado) return;
      ocupado = true;
      motorPaper
        .alFeeds(feeds.feeds)
        .catch((e) => notificador.error(`Paper Trading: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          ocupado = false;
        });
    });
  });
}

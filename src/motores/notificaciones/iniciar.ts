// Conecta el notificador con el motor (feeds, registro) y el calendario. Se llama una vez al abrir la app.
import { motorOrderFlow } from '../worker/motorCliente';
import { notificador } from './notificador';

let iniciado = false;

export function iniciarNotificaciones(): void {
  if (iniciado) return;
  iniciado = true;
  let ultimoRegistro = 0;
  motorOrderFlow.suscribirFeeds((feeds, registro) => {
    notificador.revisarFeeds(feeds.feeds);
    // Errores del motor y del guardado que aparecen en el registro.
    for (const e of registro) {
      if (e.t <= ultimoRegistro) break;
      if (/^Error|No se pudo guardar/.test(e.texto)) notificador.error(e.texto);
    }
    if (registro[0]) ultimoRegistro = Math.max(ultimoRegistro, registro[0].t);
  });
  const calendario = () => notificador.revisarCalendario(motorOrderFlow.calendario);
  calendario();
  setInterval(calendario, 30_000);
}

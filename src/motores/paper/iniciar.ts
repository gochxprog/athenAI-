// Arranca el motor de Paper Trading con el flujo del motor, las señales del Laboratorio y el notificador.
// Si la grabadora del VPS tiene bots 24/7, la plataforma usa ESOS (motorPaper apunta a ellos) y el motor del
// navegador no opera, para que nunca haya dos copias del mismo bot.
import { motorOrderFlow } from '../worker/motorCliente';
import { senalesLaboratorio } from '../laboratorio/laboratorioCliente';
import { notificador } from '../notificaciones/notificador';
import { grabadora } from '../grabadora/cliente';
import { AlmacenPaper } from './almacenPaper';
import { MotorPaper, type NuevoBot } from './motorPaper';
import { MotorPaperRemoto } from './paperRemoto';
import type { Bot } from './ejecutor';
import type { ReglasGuardian } from './guardian';

const local = new MotorPaper({
  senales: (xs) => senalesLaboratorio.senales(xs),
  avisar: (a) => void notificador.enviar(a),
  reloj: () => Date.now(),
  almacen: new AlmacenPaper(),
  local: typeof localStorage === 'undefined' ? null : localStorage,
});

export const motorPaperRemoto = new MotorPaperRemoto((ruta, cuerpo) => grabadora.api(ruta, cuerpo));

/** Los bots que se ven y se manejan: los del VPS si están disponibles; si no, los del navegador. */
class PaperActivo {
  get activo(): MotorPaper | MotorPaperRemoto {
    return motorPaperRemoto.disponible ? motorPaperRemoto : local;
  }
  /** Los bots corren en el VPS (24/7). */
  get enVps(): boolean {
    return motorPaperRemoto.disponible;
  }
  get bots(): Bot[] {
    return this.activo.bots;
  }
  get apagado(): boolean {
    return this.activo.apagado;
  }
  get bitacora() {
    return this.activo.bitacora;
  }
  get reglas(): ReglasGuardian {
    return this.activo.reglas;
  }
  get cargado(): boolean {
    return this.activo.cargado;
  }
  suscribir(o: () => void): () => void {
    const a = local.suscribir(o);
    const b = motorPaperRemoto.suscribir(o);
    return () => {
      a();
      b();
    };
  }
  operaciones = (botId?: string) => this.activo.operaciones(botId);
  mercado = (b: Bot) => this.activo.mercado(b);
  crearBot = (d: NuevoBot) => this.activo.crearBot(d);
  ordenManual = (d: Parameters<MotorPaper['ordenManual']>[0]) => this.activo.ordenManual(d);
  cerrarManual = (id: string) => this.activo.cerrarManual(id);
  pausar = (id: string) => this.activo.pausar(id);
  reanudar = (id: string) => this.activo.reanudar(id);
  borrar = (id: string) => this.activo.borrar(id);
  apagarTodo = () => this.activo.apagarTodo();
  rearmar = () => this.activo.rearmar();
  setReglas = (r: Partial<ReglasGuardian>) => this.activo.setReglas(r);
}

export const motorPaper = new PaperActivo();

let iniciado = false;

export function iniciarPaper(): void {
  if (iniciado) return;
  iniciado = true;
  // ¿Hay bots 24/7 en el VPS? Se mira al abrir y cada 10 s (cada 2 s mientras alguien mira la pantalla).
  void motorPaperRemoto.cargar();
  setInterval(() => void motorPaperRemoto.cargar(), 10_000);
  grabadora.suscribir(() => void motorPaperRemoto.cargar());
  let ocupado = false;
  void local.cargar().then(() => {
    motorOrderFlow.suscribirFeeds((feeds) => {
      // Si la revisión anterior sigue (Python calculando una señal), se salta este segundo.
      // Con bots en el VPS, el navegador no opera: los bots viven allí.
      if (ocupado || motorPaperRemoto.disponible) return;
      ocupado = true;
      local
        .alFeeds(feeds.feeds)
        .catch((e) => notificador.error(`Paper Trading: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          ocupado = false;
        });
    });
  });
}

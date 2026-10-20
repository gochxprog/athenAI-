// Web Worker del motor de Order Flow: todo el cálculo vive aquí, fuera del hilo de la interfaz.
// La UI solo recibe un estado compacto a ~5 Hz y dibuja; aunque el motor procese miles de trades,
// la pantalla no se traba.
import { Pipeline } from '../nucleo/pipeline';
import { filasACsv } from '../nucleo/features';
import { GeneradorDemo } from '../fuentes/demo';
import { FuenteUrus } from '../fuentes/urusSSE';
import type { MensajeMercado } from '../nucleo/tipos';
import type { ConfigFuente, MensajeAlMotor, MensajeDelMotor } from './protocolo';

const ctx = self as unknown as { postMessage: (m: MensajeDelMotor) => void; onmessage: ((e: MessageEvent<MensajeAlMotor>) => void) | null };

const HZ_ESTADO = 5;
let pipeline = new Pipeline();
let opcionesVista = { nBarras: 160, footprint: false, nivelesFootprint: 70 };
let detenerFuente: (() => void) | null = null;
let msAcumulados = 0;
let publicador: ReturnType<typeof setInterval> | null = null;

function procesar(m: MensajeMercado): void {
  const t0 = performance.now();
  pipeline.procesar(m);
  msAcumulados += performance.now() - t0;
}

function publicar(): void {
  const t0 = performance.now();
  const estado = pipeline.estado(opcionesVista);
  const ms = msAcumulados + (performance.now() - t0);
  msAcumulados = 0;
  ctx.postMessage({ tipo: 'estado', estado, msProceso: ms });
}

function iniciar(fuente: ConfigFuente): void {
  detenerFuente?.();
  const temporalidad = pipeline.temporalidad;
  pipeline = new Pipeline(fuente.tipo === 'urus' ? fuente.simbolo : 'BTCUSDT');
  pipeline.cambiarTemporalidad(temporalidad);

  if (fuente.tipo === 'demo') {
    const gen = new GeneradorDemo(fuente.semilla ?? Date.now() % 1_000_000, Date.now() - 60 * 60_000);
    // Precarga: 60 min de historia (modo rápido: libro 1 vez/s) para que el gráfico y los motores arranquen con contexto.
    for (const m of gen.avanzar(60 * 60_000, true)) procesar(m);
    let ultimo = Date.now();
    const id = setInterval(() => {
      const ahora = Date.now();
      for (const m of gen.avanzar(ahora - ultimo)) procesar(m);
      ultimo = ahora;
    }, 100);
    detenerFuente = () => clearInterval(id);
  } else {
    const f = new FuenteUrus({ baseUrl: fuente.baseUrl, simbolo: fuente.simbolo, onMensaje: procesar });
    f.iniciar();
    detenerFuente = () => f.detener();
  }
  if (!publicador) publicador = setInterval(publicar, 1000 / HZ_ESTADO);
  publicar();
}

ctx.onmessage = (e) => {
  const m = e.data;
  try {
    switch (m.tipo) {
      case 'iniciar':
        iniciar(m.fuente);
        break;
      case 'detener':
        detenerFuente?.();
        detenerFuente = null;
        pipeline.procesar({ tipo: 'conexion', estado: 'detenido' });
        publicar();
        break;
      case 'temporalidad':
        pipeline.cambiarTemporalidad(m.id);
        publicar();
        break;
      case 'vista':
        opcionesVista = { nBarras: m.nBarras, footprint: m.footprint, nivelesFootprint: m.nivelesFootprint };
        publicar();
        break;
      case 'exportar-features': {
        const filas = pipeline.todasLasFilas();
        ctx.postMessage({ tipo: 'features-csv', csv: filasACsv(filas), filas: filas.length });
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ tipo: 'error', mensaje: err instanceof Error ? err.message : String(err) });
  }
};

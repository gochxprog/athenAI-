// Worker del Laboratorio: Python (Pyodide, servido por la propia app) + el Juez.
// Lee las Features guardadas en la carpeta de la fuente, ejecuta la estrategia del usuario y la juzga.
// Va en su propio worker para que un bucle infinito en el código del usuario se pueda cancelar sin tocar el motor.
import { AlmacenFeatures, type FilaGuardada } from '../almacen/almacen';
import { juzgar } from '../juez/juez';
import { normalizarPosiciones } from '../juez/backtest';
import { ejecutarEstrategia, mensajeError, type PyodideMinimo } from './python';
import type { MensajeLaboratorio, PeticionLaboratorio } from './protocolo';

const ctx = self as unknown as { postMessage: (m: MensajeLaboratorio) => void; onmessage: ((e: MessageEvent<PeticionLaboratorio>) => void) | null };

let pyodide: Promise<PyodideMinimo> | null = null;

function cargarPython(): Promise<PyodideMinimo> {
  if (!pyodide) {
    const base = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href;
    pyodide = import(/* @vite-ignore */ `${base}pyodide.mjs`).then((m: { loadPyodide: (o: { indexURL: string }) => Promise<PyodideMinimo> }) => m.loadPyodide({ indexURL: base }));
  }
  return pyodide;
}

async function leer(proveedor: PeticionLaboratorio['proveedor'], simbolo: string): Promise<FilaGuardada[]> {
  const al = new AlmacenFeatures(proveedor);
  try {
    return (await al.leer(simbolo)).filter((f) => Number.isFinite(f.close) && f.close > 0);
  } finally {
    al.cerrar();
  }
}

/** Huecos: barras marcadas por el Vigía o primer barra de una nueva sesión de captura. */
const huecosDe = (filas: FilaGuardada[]) => filas.map((f, i) => f.valores.hueco === 1 || (i > 0 && f.sesion !== filas[i - 1].sesion));

ctx.onmessage = async (e) => {
  const p = e.data;
  const t0 = performance.now();
  const progreso = (texto: string) => ctx.postMessage({ tipo: 'progreso', id: p.id, texto });
  try {
    progreso('Cargando Python (la primera vez tarda unos segundos)…');
    const py = await cargarPython();
    progreso(`Leyendo ${p.simbolo} de la carpeta athenai-${p.proveedor}…`);
    const filas = await leer(p.proveedor, p.simbolo);
    if (filas.length < 100) throw new Error(`Solo hay ${filas.length} filas guardadas de ${p.simbolo} en athenai-${p.proveedor}. Deja grabando el mercado (Centro de datos) y vuelve a probar.`);
    let ejec;
    try {
      ejec = ejecutarEstrategia(py, p.codigo, filas, progreso);
    } catch (err) {
      throw new Error(`Error en tu código:\n${mensajeError(err)}`);
    }
    progreso('El Juez está probando: Walk-Forward, Monte Carlo, Luck test, robustez…');
    const entrada = {
      cierres: filas.map((f) => f.close),
      tiempos: filas.map((f) => f.cierre),
      huecos: huecosDe(filas),
      combos: ejec.combos,
      posiciones: ejec.posiciones,
      costos: p.costos,
      ensayos: p.ensayosPrevios + ejec.combos.length,
      antiFuturo: ejec.antiFuturo,
    };
    let resultado = juzgar(entrada);
    if (p.otro) {
      progreso(`Robustez: misma estrategia en ${p.otro.simbolo}…`);
      const otras = await leer(p.otro.proveedor, p.otro.simbolo);
      if (otras.length >= 100) {
        const combo = ejec.combos[resultado.dentroMuestra.combo];
        let otraPos: number[];
        try {
          otraPos = normalizarPosiciones(ejecutarEstrategia(py, `${p.codigo}\nPARAMETROS = ${JSON.stringify(Object.fromEntries(Object.entries(combo).map(([k, v]) => [k, [v]])))}\n`, otras).posiciones[0], otras.length);
        } catch (err) {
          throw new Error(`Error en tu código con ${p.otro.simbolo}:\n${mensajeError(err)}`);
        }
        const huecosOtro = huecosDe(otras);
        resultado = juzgar({ ...entrada, otroMercado: { simbolo: p.otro.simbolo, cierres: otras.map((f) => f.close), tiempos: otras.map((f) => f.cierre), posiciones: otraPos.map((x, i) => (huecosOtro[i + 1] ? 0 : x)) } });
      } else progreso(`No hay datos suficientes de ${p.otro.simbolo}: se omite esa prueba.`);
    }
    ctx.postMessage({
      tipo: 'resultado',
      id: p.id,
      respuesta: {
        lados: (() => {
          const pos = ejec.posiciones[resultado.dentroMuestra.combo] ?? [];
          return { largos: pos.filter((x) => x > 0).length, cortos: pos.filter((x) => x < 0).length };
        })(),
        resultado,
        combos: ejec.combos, filas: filas.length, desde: filas[0].cierre, hasta: filas[filas.length - 1].cierre, inicioOosT: filas[resultado.inicioOos]?.cierre ?? 0, segundos: (performance.now() - t0) / 1000 },
    });
  } catch (err) {
    ctx.postMessage({ tipo: 'error', id: p.id, mensaje: err instanceof Error ? err.message : String(err) });
  }
};

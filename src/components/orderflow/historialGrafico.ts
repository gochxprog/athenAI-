// Historial del gráfico (solo para dibujar): lo carga al cambiar de mercado o temporalidad y pide más al llegar
// al borde izquierdo. Velas de tiempo → Binance; Dollar Bars → lo grabado del MISMO mercado (VPS o este navegador).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlmacenFeatures, type Proveedor } from '@/motores/almacen/almacen';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import { grabadora } from '@/motores/grabadora/cliente';
import { anteponer, INTERVALO_BINANCE, LIMITE_KLINES, pedirKlines, velasDeFilas, velasDeKlines, type TemporalidadTiempo } from '@/motores/historial/historial';
import type { BarraGrafico } from '@/motores/nucleo/pipeline';
import type { IdTemporalidad } from '@/motores/nucleo/tipos';

/** Tope de velas de historial en memoria (más que suficiente para mirar días atrás). */
export const MAX_HISTORIAL = 20_000;
const PAGINA_FILAS = 2_000;

export interface Historial {
  barras: BarraGrafico[];
  cargando: boolean;
  /** No hay más historia hacia atrás. */
  fin: boolean;
  nota: string | null;
}

const VACIO: Historial = { barras: [], cargando: false, fin: false, nota: null };
const esTiempo = (t: IdTemporalidad): t is TemporalidadTiempo => t in INTERVALO_BINANCE;

export function useHistorial(simbolo: string | undefined, proveedor: Proveedor | undefined, temporalidad: IdTemporalidad): Historial & { pedirMas: () => void } {
  const [h, setH] = useState<Historial>(VACIO);
  const actual = useRef(h);
  actual.current = h;
  const clave = `${proveedor}:${simbolo}:${temporalidad}`;
  const claveRef = useRef(clave);
  /** Para Dollar Bars: carpeta elegida y cierre de la fila más antigua leída. */
  const cursor = useRef<{ almacen: Proveedor | null; antesDe: number }>({ almacen: null, antesDe: Infinity });
  const ocupado = useRef(false);
  // Si al abrir no había nada grabado y luego llega lo del VPS (sincronización), se vuelve a cargar.
  const [recarga, setRecarga] = useState(0);
  useEffect(
    () =>
      grabadora.suscribir(() => {
        const e = grabadora.estado;
        if (!e.enCurso && Object.values(e.nuevas).some((n) => n > 0) && !actual.current.barras.length) setRecarga((x) => x + 1);
      }),
    [],
  );

  const cargar = useCallback(async () => {
    if (!simbolo || !proveedor || ocupado.current) return;
    const k = clave;
    const previo = actual.current;
    if (previo.fin || previo.barras.length >= MAX_HISTORIAL) return;
    ocupado.current = true;
    setH((x) => ({ ...x, cargando: true }));
    try {
      let nuevas: BarraGrafico[] = [];
      let nota: string | null = null;
      if (esTiempo(temporalidad)) {
        if (proveedor !== 'binance') nota = 'El historial de velas de tiempo viene de Binance; este mercado solo se ve en vivo.';
        else {
          const hasta = previo.barras.length ? previo.barras[0].t - 1 : null;
          nuevas = velasDeKlines(await pedirKlines(motorOrderFlow.config.binance.rest, simbolo, temporalidad, hasta, LIMITE_KLINES));
        }
      } else if (temporalidad === 'dollar') {
        // La grabadora 24/7 del VPS tiene más historia; si no hay, lo grabado en este navegador. Nunca se mezclan.
        const c = cursor.current;
        const opciones: Proveedor[] = c.almacen ? [c.almacen] : proveedor === 'binance' ? ['grabadora', 'binance'] : [proveedor];
        for (const p of opciones) {
          const al = new AlmacenFeatures(p);
          try {
            const filas = await al.leerAntes(simbolo, c.antesDe, PAGINA_FILAS);
            if (filas.length) {
              c.almacen = p;
              c.antesDe = filas[0].cierre;
              nuevas = velasDeFilas(filas);
              break;
            }
          } finally {
            al.cerrar();
          }
        }
        if (!nuevas.length && !previo.barras.length) nota = 'Todavía no hay Dollar Bars grabadas de este mercado. Conecta la grabadora del VPS en Datos o deja grabando.';
      } else nota = 'Las Volume Bars solo se ven en vivo (no se graban).';
      if (claveRef.current !== k) return;
      setH((x) => ({ barras: nuevas.length ? anteponer(nuevas, x.barras) : x.barras, cargando: false, fin: !nuevas.length, nota: nota ?? x.nota }));
    } catch (e) {
      if (claveRef.current !== k) return;
      setH((x) => ({ ...x, cargando: false, fin: true, nota: `No se pudo cargar el historial: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      ocupado.current = false;
    }
  }, [clave, simbolo, proveedor, temporalidad]);

  useEffect(() => {
    claveRef.current = clave;
    cursor.current = { almacen: null, antesDe: Infinity };
    ocupado.current = false;
    actual.current = VACIO;
    setH(VACIO);
    void cargar();
  }, [clave, cargar, recarga]);

  return { ...h, pedirMas: () => void cargar() };
}

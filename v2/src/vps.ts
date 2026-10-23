// Datos reales de la grabadora (VPS), en la misma dirección que la página. Un solo sondeo para toda la app.
import { useEffect, useState } from 'react';
import type { Bot, OperacionPaper } from '@/motores/paper/ejecutor';
import type { EventoPaper } from '@/motores/paper/motorPaper';
import type { ReglasGuardian } from '@/motores/paper/guardian';
import type { EstadoSala } from '@/motores/agentes/sala';

export interface Mercado { simbolo: string; conexion: string; detalle: string; filasSesion: number; ultimoCierre: number | null; cortes: number; tradesPerdidos: number }
export interface Fila { cierre: number; close: number; valores: Record<string, number | null> }
export interface Historia { carpeta: string; dias: number; desde: string | null; hasta: string | null; bytes: number; importando: boolean; progreso: { dia: string | null; hechos: number; total: number; fin: boolean } | null }
export interface Vps {
  listo: boolean;
  /** La página se abrió sin entrar con la clave. */
  sinSesion: boolean;
  /** La grabadora no responde. */
  caido: boolean;
  inicio: number | null;
  version: string;
  mercados: Mercado[];
  almacen: { simbolo: string; filas: number; desde: number | null; hasta: number | null; bytes: number }[];
  historia: Historia[];
  bots: Bot[];
  /** Tu cuenta a mano de la Terminal (una por mercado). */
  manuales: Bot[];
  /** Apagado de emergencia activo y reglas del Guardián (de /api/paper). */
  apagado: boolean;
  reglas: ReglasGuardian | null;
  bitacora: EventoPaper[];
  ops: OperacionPaper[];
  /** Últimas filas (≈ 30 min) de cada mercado: precio y Features recién calculadas. */
  filas: Record<string, Fila[]>;
  /** La sala de agentes del VPS (estados reales, radio, fila y recursos); null si la grabadora es vieja. */
  agentes: EstadoSala | null;
}

const CADA_MS = 1_000;
/** Lo que cambia poco (historia importada, operaciones cerradas) se pide 1 de cada 30 vueltas (cada 30 s). */
const LENTO = 30;
const VENTANA_MS = 1_800_000;
let vuelta = 0;
let forzar = true;
let actual: Vps = { listo: false, sinSesion: false, caido: false, inicio: null, version: '', mercados: [], almacen: [], historia: [], bots: [], manuales: [], apagado: false, reglas: null, bitacora: [], ops: [], filas: {}, agentes: null };
const oyentes = new Set<(v: Vps) => void>();
let reloj: ReturnType<typeof setTimeout> | null = null;
/** La grabadora respondió que no tiene bots (BOTS=0): no se vuelve a preguntar. */
let sinBots = false;

async function pedir<T>(ruta: string): Promise<T | null> {
  if (sinBots && ruta.startsWith('/api/paper')) return null;
  const r = await fetch(ruta, { credentials: 'same-origin' });
  if (r.status === 401) throw new Error('sin-sesion');
  if (r.status === 503 && ruta.startsWith('/api/paper')) sinBots = true;
  return r.ok ? ((await r.json()) as T) : null;
}

async function sondear(): Promise<void> {
  try {
    const lento = forzar || vuelta++ % LENTO === 0;
    forzar = false;
    const [e, h, p, o, ag] = await Promise.all([
      pedir<{ inicio: number; version: string; simbolos: Mercado[]; almacen: Vps['almacen'] }>('/api/estado'),
      lento ? pedir<{ mercados: Historia[] }>('/api/historia').catch(() => null) : null,
      pedir<{ bots: Bot[]; bitacora: EventoPaper[]; apagado: boolean; reglas: ReglasGuardian }>('/api/paper').catch(() => null),
      lento ? pedir<{ operaciones: OperacionPaper[] }>('/api/paper/operaciones').catch(() => null) : null,
      pedir<EstadoSala>('/api/agentes').catch(() => null),
    ]);
    if (!e) throw new Error('caido');
    // Filas: solo las nuevas desde la última que ya tenemos (antes se bajaba media hora entera cada 5 s).
    const filas = Object.fromEntries(
      await Promise.all(
        e.simbolos.filter((m) => m.ultimoCierre).map(async (m) => {
          const previas = actual.filas[m.simbolo] ?? [];
          const ultima = previas.at(-1)?.cierre ?? 0;
          if (ultima >= m.ultimoCierre!) return [m.simbolo, previas] as const;
          // Primera vez: las últimas 400 (lo de ahora); después, solo las nuevas desde la última que ya tenemos.
          const ruta = ultima ? `desde=${ultima}&limite=400` : 'ultimas=400';
          const nuevas = (await pedir<{ filas: Fila[] }>(`/api/filas?simbolo=${m.simbolo}&${ruta}`).catch(() => null))?.filas ?? [];
          return [m.simbolo, [...previas, ...nuevas].filter((f) => f.cierre > m.ultimoCierre! - VENTANA_MS)] as const;
        }),
      ),
    );
    // Lo que no cambió conserva la MISMA referencia: las pantallas no recalculan ni redibujan por nada.
    const igual = <T,>(nuevo: T, viejo: T): T => (JSON.stringify(nuevo) === JSON.stringify(viejo) ? viejo : nuevo);
    const mismasFilas = Object.keys(filas).length === Object.keys(actual.filas).length && Object.entries(filas).every(([k, f]) => actual.filas[k] === f);
    actual = { listo: true, sinSesion: false, caido: false, inicio: e.inicio, version: e.version, mercados: e.simbolos, almacen: e.almacen, historia: h ? igual(h.mercados, actual.historia) : actual.historia,
      // Tu cuenta a mano (Terminal) no es un bot: va aparte.
      bots: igual((p?.bots ?? []).filter((b) => b.origen !== 'manual'), actual.bots), manuales: igual((p?.bots ?? []).filter((b) => b.origen === 'manual'), actual.manuales), apagado: p?.apagado ?? false, reglas: igual(p?.reglas ?? null, actual.reglas), bitacora: igual(p?.bitacora ?? [], actual.bitacora), ops: o ? igual(o.operaciones, actual.ops) : actual.ops, filas: mismasFilas ? actual.filas : filas, agentes: ag };
  } catch (err) {
    actual = { ...actual, listo: true, sinSesion: (err as Error).message === 'sin-sesion', caido: (err as Error).message !== 'sin-sesion' };
  }
  oyentes.forEach((f) => f(actual));
  // Un solo temporizador aunque `refrescar` lance un sondeo mientras otro estaba en curso.
  if (reloj) clearTimeout(reloj);
  // Con la pestaña oculta no se consulta al VPS; al volver, se pide todo de una vez.
  reloj = oyentes.size && !document.hidden ? setTimeout(sondear, CADA_MS) : null;
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => !document.hidden && oyentes.size && refrescar());

/** Pide el estado ya (tras una acción), sin esperar al siguiente sondeo. */
export function refrescar(): void {
  forzar = true;
  if (reloj) clearTimeout(reloj);
  void sondear();
}

export function useVps(): Vps {
  const [v, setV] = useState(actual);
  useEffect(() => {
    oyentes.add(setV);
    if (!reloj) void sondear();
    return () => void oyentes.delete(setV);
  }, []);
  return v;
}

/** Operaciones cerradas hoy (hora local). */
export const deHoy = (ops: OperacionPaper[]) => {
  const hoy = new Date().toDateString();
  return ops.filter((o) => new Date(o.salidaT).toDateString() === hoy);
};

/** Lo último que pasó (bots, Guardián, grabadora): alimenta la cinta y el registro del día. */
export function movimientos(v: Vps): { t: number; quien: string; texto: string }[] {
  const bots = v.bitacora.map((e) => ({ t: e.t, quien: e.nombre.toUpperCase(), texto: e.texto }));
  const mercados = v.mercados.map((m) => ({ t: m.ultimoCierre ?? 0, quien: 'GRABADORA', texto: `${m.simbolo} ${m.conexion} · ${m.filasSesion.toLocaleString('es')} filas en esta sesión${m.cortes ? ` · ${m.cortes} cortes` : ''}` }));
  const historia = v.historia.filter((h) => h.dias).map((h) => ({ t: 0, quien: 'HISTORIA', texto: `${h.carpeta.replace('binance_', '').toUpperCase()} · ${h.dias} días importados${h.importando ? ' · importando…' : ''}` }));
  return [...bots, ...mercados, ...historia].sort((a, b) => b.t - a.t);
}

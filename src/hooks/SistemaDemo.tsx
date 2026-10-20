import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SimuladorDemo, type EstadoMercado, type EstadoMotor, type Evento } from '@/lib/simulacion';
import { motorOrderFlow, type EstadoFeeds } from '@/motores/worker/motorCliente';
import type { EntradaRegistro, EstadoFeed, Proveedor } from '@/motores/worker/protocolo';
import { decimalesDe } from '@/lib/format';

interface Instantanea {
  ahora: Date;
  /** Mercado REAL: el activo visible de la fuente activa del Centro de datos (el "chorro"). */
  mercado: EstadoMercado;
  /** Mercado del simulador DEMO: solo para las posiciones DEMO de Paper Trading. */
  mercadoDemo: EstadoMercado;
  motor: EstadoMotor;
  eventos: Evento[];
}


const NOMBRE: Record<Proveedor, string> = { binance: 'Binance Futures', rithmic: 'Rithmic', urus: 'Servidor Urus', simulacion: 'Simulación' };

/** Traduce el resumen del motor al formato que usan los módulos de la plataforma. */
export function mercadoDesdeFeed(f: EstadoFeed | undefined, proveedor: Proveedor | null): EstadoMercado {
  const simbolo = f?.simbolo ?? '—';
  const base = simbolo.replace(/(USDT|USDC|BUSD|USD)$/, '') || simbolo;
  const r = f?.resumen;
  const precio = r?.precio ?? 0;
  const barras = r?.barrasFlujo.length ? r.barrasFlujo : [{ compra: 0, venta: 0 }];
  return {
    simbolo,
    base,
    fuente: proveedor ? NOMBRE[proveedor] : null,
    decimales: decimalesDe(f?.tickSize ?? 0.1),
    real: true,
    spread: r?.spread ?? null,
    precio,
    apertura24h: r?.aperturaSesion ?? precio,
    vwap: r?.vwap ?? precio,
    cvd: r?.cvdSesion ?? 0,
    atr: r?.atr ?? 0,
    oi: r?.oi ?? 0,
    latenciaMs: f?.latenciaMs ?? 0,
    barras,
    dollarBars: f?.filas ?? 0,
    gaps: f?.cortes ?? 0,
    historial: f?.historial.length ? f.historial : precio ? [precio] : [],
    ritmo: f?.ritmo.length ? f.ritmo : [0],
    conectado: f?.conexion === 'en-vivo',
    grabando: !!f && f.guardando && f.conexion === 'en-vivo',
  };
}

function tomar(sim: SimuladorDemo, feeds: EstadoFeeds, registro: readonly EntradaRegistro[]): Instantanea {
  const visible = feeds.feeds.find((f) => f.simbolo === feeds.visible) ?? feeds.feeds[0];
  // Registro: lo de datos es real (motor); modelos, Juez y bots siguen siendo DEMO hasta sus bloques.
  const reales: Evento[] = registro.slice(0, 40).map((e, i) => ({ id: e.t * 100 + i, hora: new Date(e.t), tipo: 'datos', texto: e.texto }));
  const demo = sim.eventos.filter((e) => e.tipo !== 'datos');
  return {
    ahora: new Date(),
    mercado: mercadoDesdeFeed(visible, visible?.proveedor ?? null),
    mercadoDemo: { ...sim.mercado, barras: sim.mercado.barras.map((b) => ({ ...b })), historial: [...sim.mercado.historial] },
    motor: { ...sim.motor, idsPrueba: [...sim.motor.idsPrueba] },
    eventos: [...reales, ...demo].sort((a, b) => b.hora.getTime() - a.hora.getTime()).slice(0, 80),
  };
}

// Simulador DEMO de las pantallas que aún no tienen motor real (Laboratorio DEMO, Investigación, Estrategias,
// Paper, Decisiones, Conocimiento). Solo corre mientras alguna de esas pantallas está abierta: el resto de la
// plataforma (Panel, Order Flow, Datos, Agentes) no lo usa y no se redibuja cada segundo por él.
let sim: SimuladorDemo | null = null;
let instantanea: Instantanea | null = null;
let reloj: ReturnType<typeof setInterval> | null = null;
let quitarFeeds: (() => void) | null = null;
let feeds: { f: EstadoFeeds; r: readonly EntradaRegistro[] } = { f: motorOrderFlow.feeds, r: motorOrderFlow.registro };
const oyentes = new Set<() => void>();

function suscribir(o: () => void): () => void {
  oyentes.add(o);
  if (!reloj) {
    sim ??= new SimuladorDemo();
    quitarFeeds = motorOrderFlow.suscribirFeeds((f, r) => {
      feeds = { f, r };
    });
    reloj = setInterval(() => {
      sim!.tick();
      instantanea = tomar(sim!, feeds.f, feeds.r);
      for (const x of oyentes) x();
    }, 1000);
  }
  return () => {
    oyentes.delete(o);
    if (!oyentes.size && reloj) {
      clearInterval(reloj);
      reloj = null;
      quitarFeeds?.();
      quitarFeeds = null;
    }
  };
}

function leer(): Instantanea {
  if (!instantanea) {
    sim ??= new SimuladorDemo();
    instantanea = tomar(sim, feeds.f, feeds.r);
  }
  return instantanea;
}

/** Se mantiene por compatibilidad: ya no hace nada (el simulador arranca solo cuando una pantalla DEMO lo usa). */
export function SistemaDemoProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useSistema(): Instantanea {
  return useSyncExternalStore(suscribir, leer);
}

/** Hora local, actualizada cada segundo (sin depender del simulador). */
export function useReloj(): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return ahora;
}

export function useMercado() {
  return useSistema().mercado;
}

/** Pulso local para animaciones de datos que necesitan su propio ritmo (ms). */
export function usePulso(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

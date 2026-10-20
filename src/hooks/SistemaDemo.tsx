import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SimuladorDemo, type EstadoMercado, type EstadoMotor, type Evento } from '@/lib/simulacion';

interface Instantanea {
  ahora: Date;
  mercado: EstadoMercado;
  motor: EstadoMotor;
  eventos: Evento[];
}

const Contexto = createContext<Instantanea | null>(null);

function tomar(sim: SimuladorDemo): Instantanea {
  return {
    ahora: new Date(),
    mercado: { ...sim.mercado, barras: sim.mercado.barras.map((b) => ({ ...b })), historial: [...sim.mercado.historial] },
    motor: { ...sim.motor, idsPrueba: [...sim.motor.idsPrueba] },
    eventos: sim.eventos,
  };
}

/** Un único reloj de 1 s alimenta el mercado DEMO, los contadores del motor y el registro. */
export function SistemaDemoProvider({ children }: { children: ReactNode }) {
  const sim = useRef<SimuladorDemo>();
  if (!sim.current) sim.current = new SimuladorDemo();
  const [estado, setEstado] = useState(() => tomar(sim.current!));

  useEffect(() => {
    const id = setInterval(() => {
      sim.current!.tick();
      setEstado(tomar(sim.current!));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}

export function useSistema() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useSistema debe usarse dentro de SistemaDemoProvider');
  return ctx;
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


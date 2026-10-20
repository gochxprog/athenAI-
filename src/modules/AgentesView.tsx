import { useEffect, useRef, useState } from 'react';
import { Bot, Cpu, MousePointerClick, Terminal } from 'lucide-react';
import SalaAgentes3D from '@/components/three/SalaAgentes3D';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import PanelLateral from '@/components/ui/PanelLateral';
import Insignia from '@/components/ui/Insignia';
import Punto from '@/components/ui/Punto';
import Consola, { type LineaConsola } from '@/components/ui/Consola';
import { AGENTES, type AgenteId } from '@/data/mock';
import { useSistema } from '@/hooks/SistemaDemo';
import type { EstadoMercado } from '@/lib/simulacion';
import { crearAleatorio, elegir } from '@/lib/random';
import { conSigno, num } from '@/lib/format';

type Contexto = { m: EstadoMercado; r: () => number; n: number };

/** Plantillas de pensamiento por agente; usan valores vivos del mercado DEMO. */
const PENSAMIENTOS: Record<AgenteId, ((c: Contexto) => { texto: string; tarea: string })[]> = {
  rastreador: [
    ({ m, r }) => {
      const k = 3 + Math.floor(r() * 9);
      return { texto: `Barrido de dollar bars ${num(m.dollarBars - 500)}–${num(m.dollarBars)}: ${k} candidatas con volumen ≥ 2× la media`, tarea: `Barrido de las últimas 500 dollar bars (${k} candidatas)` };
    },
    ({ m }) => ({ texto: `CVD de sesión en ${conSigno(m.cvd, 0)} BTC con el precio en ${num(m.precio, 1)}; sin divergencia relevante`, tarea: 'Vigilando divergencias CVD–precio' }),
    ({ m }) => {
      const d = (m.precio - m.vwap) / m.atr;
      return { texto: `Precio a ${conSigno(d, 2)} ATR del VWAP (${num(m.vwap, 1)}); marco la zona para Flujo`, tarea: 'Marcando zonas respecto al VWAP' };
    },
    ({ r }) => {
      const k = 2 + Math.floor(r() * 6);
      return { texto: `Envío ${k} ventanas con estructura repetida al Lector para su análisis`, tarea: `Preparando ${k} ventanas para el Lector` };
    },
  ],
  lector: [
    ({ r }) => {
      const k = 4 + Math.floor(r() * 10);
      const j = Math.max(1, Math.floor(k * (0.5 + r() * 0.4)));
      return { texto: `PD-031: reviso ${k} ocurrencias nuevas; ${j} coinciden con la firma (similitud ≥ 0,80)`, tarea: 'Revisando ocurrencias de PD-031' };
    },
    () => ({ texto: 'PD-014: la firma mantiene el peso en absorción (+0,88) y agotamiento (+0,79); sin deriva', tarea: 'Comprobando deriva de firmas' }),
    ({ r }) => ({ texto: `PD-011 en las últimas 24 h: win rate local ${num(54 + r() * 8, 1)}% sobre ${18 + Math.floor(r() * 20)} casos`, tarea: 'Midiendo PD-011 en datos recientes' }),
    ({ r }) => ({ texto: `Descarto ${1 + Math.floor(r() * 4)} falsos positivos de PD-019 por spread > 2 ticks`, tarea: 'Filtrando falsos positivos de PD-019' }),
  ],
  sintetizador: [
    ({ r }) => {
      const [a, b] = elegir(r, [['PD-011', 'PD-014'], ['PD-017', 'PD-019'], ['PD-022', 'PD-011'], ['PD-031', 'PD-019']] as const);
      return { texto: `Combino ${a} + ${b} en régimen de ${elegir(r, ['volatilidad baja', 'tendencia', 'volatilidad media'])}`, tarea: `Redactando hipótesis compuesta desde ${a} y ${b}` };
    },
    ({ m, r }) => {
      const k = 60 + Math.floor(r() * 240);
      return { texto: `Hipótesis lista con evidencia en ${k} ocurrencias; la paso a la cola del Juez (CVD actual ${conSigno(m.cvd, 0)} BTC)`, tarea: 'Enviando hipótesis a la cola del Juez' };
    },
    ({ r }) => ({ texto: `Descarto PD-025 + PD-028: señales contradictorias en el ${num(30 + r() * 25, 0)}% de los casos`, tarea: 'Evaluando combinaciones de patrones' }),
    () => ({ texto: 'Resumen: lo aprendido hoy refuerza Order Flow cerca del VWAP; Momentum sin novedades', tarea: 'Redactando resumen de aprendizaje' }),
  ],
  flujo: [
    ({ m, r }) => {
      const nivel = Math.round((m.precio - 20 - r() * 60) / 10) * 10;
      return { texto: `Absorción en el bid ${num(nivel, 0)}: ${num(18 + r() * 60, 1)} BTC ejecutados sin desplazar el precio`, tarea: `Monitoreando absorción en ${num(nivel, 0)}` };
    },
    ({ m }) => {
      const b = m.barras[m.barras.length - 2];
      const d = b.compra - b.venta;
      return { texto: `Delta de la última dollar bar ${conSigno(d, 1)} BTC · agotamiento ${Math.abs(d) < 1.5 ? 'probable' : 'no detectado'}`, tarea: 'Midiendo delta y agotamiento por barra' };
    },
    ({ r }) => ({ texto: `Desequilibrio del libro ${num(0.7 + r() * 1.4, 2)} en los 10 primeros niveles`, tarea: 'Leyendo desequilibrio del libro' }),
    ({ m }) => ({ texto: `Open Interest ${num(m.oi, 0)} BTC · latencia del feed ${m.latenciaMs} ms`, tarea: 'Vigilando Open Interest' }),
  ],
};

interface Bitacora {
  lineas: LineaConsola[];
  tarea: string;
  pensamientos: number;
}

export default function AgentesView() {
  const { mercado } = useSistema();
  const mercadoRef = useRef(mercado);
  mercadoRef.current = mercado;
  const [seleccion, setSeleccion] = useState<AgenteId | null>(null);
  const [bitacoras, setBitacoras] = useState<Record<AgenteId, Bitacora>>(() => {
    const r = crearAleatorio(5);
    const ahora = Date.now();
    const inicial = {} as Record<AgenteId, Bitacora>;
    AGENTES.forEach((a, ai) => {
      const lineas: LineaConsola[] = PENSAMIENTOS[a.id].map((p, i) => {
        const { texto } = p({ m: mercado, r, n: i });
        return { id: `${a.id}-i${i}`, hora: new Date(ahora - (i + 1) * 47_000 - ai * 9_000), texto };
      });
      inicial[a.id] = { lineas, tarea: a.tarea, pensamientos: 120 + ai * 37 };
    });
    return inicial;
  });

  useEffect(() => {
    const r = crearAleatorio(Date.now() % 100000);
    let n = 0;
    const t = setInterval(() => {
      const a = AGENTES[n % AGENTES.length];
      const plantilla = PENSAMIENTOS[a.id][Math.floor(r() * PENSAMIENTOS[a.id].length)];
      const { texto, tarea } = plantilla({ m: mercadoRef.current, r, n });
      n += 1;
      setBitacoras((prev) => {
        const b = prev[a.id];
        if (b.lineas[0]?.texto === texto) return prev;
        return { ...prev, [a.id]: { lineas: [{ id: `${a.id}-${n}`, hora: new Date(), texto }, ...b.lineas].slice(0, 40), tarea, pensamientos: b.pensamientos + 1 } };
      });
    }, 1600);
    return () => clearInterval(t);
  }, []);

  const agente = AGENTES.find((a) => a.id === seleccion) ?? null;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Agentes"
        titulo="Sala de agentes"
        descripcion="Cuatro agentes trabajan sobre los datos de mercado. Exploran, leen, sintetizan y vigilan el Order Flow; proponen hipótesis, pero no aprueban nada ni operan: eso es tarea del Juez y de los bots."
      >
        <Insignia variante="contorno">{AGENTES.length} activos</Insignia>
      </Encabezado>

      <Panel cuerpo="p-0" className="overflow-hidden">
        <div className="relative h-[460px] md:h-[540px]">
          <SalaAgentes3D seleccion={seleccion} onSeleccion={setSeleccion} />
          <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 text-[10px] text-plata-500">
            <MousePointerClick size={12} /> Haz clic en un agente para abrir su consola
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {AGENTES.map((a) => {
          const b = bitacoras[a.id];
          return (
            <button key={a.id} onClick={() => setSeleccion(a.id)} className={`panel panel-hover p-4 text-left ${seleccion === a.id ? 'border-plata-400' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-white">
                  <Bot size={15} strokeWidth={1.5} /> {a.nombre}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-etiqueta text-plata-300">
                  <Punto estado="activo" /> {a.estado}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-plata-500">{a.rol}</p>
              <p className="mt-3 line-clamp-2 min-h-[2.5em] font-mono text-[10.5px] text-plata-200">› {b.lineas[0]?.texto}</p>
              <p className="mt-2 font-mono text-[10px] text-plata-500">{num(b.pensamientos)} pensamientos hoy · {a.modelo}</p>
            </button>
          );
        })}
      </div>

      <PanelLateral abierto={!!agente} onCerrar={() => setSeleccion(null)} subtitulo="Consola del agente" titulo={agente?.nombre ?? ''}>
        {agente && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Insignia variante="solida">{agente.estado}</Insignia>
              <Insignia variante="tenue">
                <Cpu size={10} /> {agente.modelo}
              </Insignia>
            </div>
            <p className="text-[13px] leading-relaxed text-plata-200">{agente.rol}.</p>
            <div className="rounded-lg border border-borde-suave p-3">
              <p className="etiqueta">Tarea actual</p>
              <p className="mt-1 text-sm text-white">{bitacoras[agente.id].tarea}</p>
              <p className="mt-2 font-mono text-[10px] text-plata-500">
                Fuente: Binance USD-M · BTCUSDT {num(mercado.precio, 1)} · {num(mercado.dollarBars)} dollar bars
              </p>
            </div>
            <div>
              <p className="etiqueta mb-2 flex items-center gap-1.5">
                <Terminal size={11} /> Pensamiento en tiempo real
              </p>
              <div className="rounded-lg border border-borde-suave bg-black/60 p-2">
                <Consola lineas={bitacoras[agente.id].lineas} alto="h-[360px]" />
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-plata-500">Los agentes solo leen datos de mercado. No tienen acceso a las reglas del Juez ni a la ejecución de los bots.</p>
          </div>
        )}
      </PanelLateral>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Bot, Cpu, MousePointerClick, Terminal } from 'lucide-react';
import SalaAgentes3D from '@/components/three/SalaAgentes3D';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import PanelLateral from '@/components/ui/PanelLateral';
import Insignia from '@/components/ui/Insignia';
import Punto from '@/components/ui/Punto';
import Consola, { type LineaConsola } from '@/components/ui/Consola';
import { NOMBRE_PROVEEDOR, useFeeds } from '@/components/orderflow/OrderFlowChart';
import { AGENTES, CAPAS, type Agente, type AgenteId } from '@/data/mock';
import type { EstadoFeed } from '@/motores/worker/protocolo';
import { conSigno, decimalesDe, num } from '@/lib/format';
import { leerEstrategias } from '@/components/laboratorio/plantillas';

const ESTADO_FEED: Record<string, string> = {
  conectando: 'conectando',
  'en-vivo': 'en vivo',
  reconectando: 'reconectando',
  'sin-datos': 'sin datos',
  error: 'error',
  detenido: 'detenido',
};

const usdK = (v: number) => (v >= 1e6 ? `${num(v / 1e6, 1)} M` : `${num(v / 1e3, 0)} k`);
const baseDe = (s: string) => s.replace(/(USDT|USDC|BUSD|USD)$/, '') || s;

/** Lo que el Vigía observa ahora en cada feed (datos reales del motor). */
function lineasVigia(feeds: EstadoFeed[]): string[] {
  return feeds.map((f) => {
    const lat = f.latenciaMs === null ? '—' : `${num(f.latenciaMs)} ms`;
    const extra = f.conexion !== 'en-vivo' && f.detalle ? ` · ${f.detalle}` : '';
    return `${f.simbolo} (${NOMBRE_PROVEEDOR[f.proveedor]}): ${ESTADO_FEED[f.conexion] ?? f.conexion} · ${num(f.tradesPorSeg, 1)} trades/s · latencia ${lat} · ${f.cortes} ${f.cortes === 1 ? 'corte' : 'cortes'}${extra}`;
  });
}

/** Lo que Flujo lee en el Order Flow de cada mercado (resumen de los motores de Urus). */
function lineasFlujo(feeds: EstadoFeed[]): string[] {
  const out: string[] = [];
  for (const f of feeds) {
    const r = f.resumen;
    if (f.conexion !== 'en-vivo' || r.precio === null) continue;
    const b = baseDe(f.simbolo);
    const dp = decimalesDe(f.tickSize);
    if (r.absorcion) out.push(`${f.simbolo}: absorción en el ${r.absorcion.lado} (score ${num(r.absorcion.score, 0)}) en una de las últimas 10 dollar bars · precio ${num(r.precio, dp)}`);
    if (r.agotamiento) out.push(`${f.simbolo}: agotamiento ${r.agotamiento.lado === 'bullish' ? 'comprador' : 'vendedor'} confirmado (score ${num(r.agotamiento.score, 0)})`);
    if (r.bigCompraUsd + r.bigVentaUsd > 0) out.push(`${f.simbolo}: big trades en 5 min · compra ${usdK(r.bigCompraUsd)} / venta ${usdK(r.bigVentaUsd)} USD`);
    if (r.liqLargosUsd + r.liqCortosUsd > 0) out.push(`${f.simbolo}: liquidaciones en 5 min · largos ${usdK(r.liqLargosUsd)} / cortos ${usdK(r.liqCortosUsd)} USD`);
    if (r.stackedCompra + r.stackedVenta > 0) out.push(`${f.simbolo}: imbalances apilados en las últimas 5 barras · compra ${r.stackedCompra} / venta ${r.stackedVenta}`);
    if (f.cvdVelocidad !== null) out.push(`${f.simbolo}: CVD de sesión ${conSigno(r.cvdSesion, 2)} ${b} · último minuto ${conSigno(f.cvdVelocidad, 2)} ${b}`);
    if (r.oiDeltaPct !== null) out.push(`${f.simbolo}: Open Interest ${conSigno(r.oiDeltaPct, 2, '%')} en 15 min`);
  }
  return out;
}

/** Lo que el Rastreador sabe de la memoria de cada mercado (régimen, día gemelo, "hoy es distinto"). */
function lineasRastreador(feeds: EstadoFeed[]): string[] {
  const out: string[] = [];
  const nombre = { rango: 'rango', tendencia: 'tendencia', raro: 'día raro' } as const;
  for (const f of feeds) {
    const m = f.memoria;
    if (!m) continue;
    if (m.faltan) out.push(`${f.simbolo}: ${m.faltan} (${num(m.filas)} filas grabadas)`);
    const r = m.regimen;
    if (r) out.push(`${f.simbolo}: régimen ${nombre[r.actual]} (${num(r.probabilidades[r.actual] * 100, 0)} %) desde hace ${r.barrasEnRegimen} barras · validación: ${r.validacion.util ? 'sirve' : 'no concluyente'}`);
    const mem = m.memoria;
    if (mem) {
      out.push(`${f.simbolo}: ${mem.distinto.aviso ? 'HOY ES DISTINTO · ' : ''}${mem.distinto.motivo}`);
      if (mem.resumen) out.push(`${f.simbolo}: ${mem.gemelos.length} gemelos; en ${mem.resumen.subieron} subió en las 20 barras siguientes (mediana ${conSigno(mem.resumen.retornoMediano * 100, 2, '%')})`);
    }
  }
  return out;
}

/** Programador y Juez: lo que pasó en el Laboratorio (estrategias guardadas en este navegador). */
function lineasLaboratorio(id: 'programador' | 'juez'): LineaConsola[] {
  const xs = leerEstrategias();
  const probadas = xs.filter((x) => x.ultimoVeredicto);
  if (id === 'programador') {
    return xs.map((x) => ({ id: `prog-${x.id}`, hora: new Date(x.actualizada), texto: `«${x.nombre}»: ${x.ensayos} ${x.ensayos === 1 ? 'variante ejecutada' : 'variantes ejecutadas'} en Python${x.ultimoVeredicto ? '' : ' · todavía sin probar'}` }));
  }
  if (!probadas.length) return [{ id: 'juez-0', hora: new Date(), texto: 'Sin estrategias juzgadas todavía. Escribe una en Laboratorio → Mis estrategias y pulsa «Probar con el Juez».' }];
  return probadas.map((x) => ({ id: `juez-${x.id}`, hora: new Date(x.actualizada), texto: `«${x.nombre}»: ${x.ultimoVeredicto} · ${x.ensayos} ${x.ensayos === 1 ? 'variante probada' : 'variantes probadas'} (el Deflated Sharpe las descuenta)` }));
}

function lineasSinMotor(a: Agente): LineaConsola[] {
  const t = new Date();
  return [
    { id: `${a.id}-1`, hora: t, texto: `Sin motor todavía. Se activa en el Bloque ${a.bloque} de la hoja de ruta.` },
    { id: `${a.id}-2`, hora: t, texto: `Motor previsto: ${a.motor}.` },
    { id: `${a.id}-3`, hora: t, texto: `Rol: ${a.rol}.` },
  ];
}

export default function AgentesView() {
  const { feeds, registro } = useFeeds();
  const feedsRef = useRef(feeds.feeds);
  feedsRef.current = feeds.feeds;
  const [seleccion, setSeleccion] = useState<AgenteId | null>(null);
  const [consolas, setConsolas] = useState<Record<'vigia' | 'flujo' | 'rastreador', LineaConsola[]>>({ vigia: [], flujo: [], rastreador: [] });
  const n = useRef(0);

  // Vigía y Flujo: cada 3 s anotan lo que ven en los datos reales (sin repetir líneas idénticas).
  useEffect(() => {
    const tick = () => {
      const ahora = new Date();
      setConsolas((prev) => {
        const nuevo = { ...prev };
        for (const [id, lineas] of [
          ['vigia', lineasVigia(feedsRef.current)],
          ['flujo', lineasFlujo(feedsRef.current)],
          ['rastreador', lineasRastreador(feedsRef.current)],
        ] as const) {
          const existentes = new Set(prev[id].slice(0, 12).map((l) => l.texto));
          const frescas = lineas.filter((t) => !existentes.has(t)).slice(0, 3);
          if (frescas.length) nuevo[id] = [...frescas.map((texto) => ({ id: `${id}-${n.current++}`, hora: ahora, texto })), ...prev[id]].slice(0, 60);
        }
        return nuevo;
      });
    };
    tick();
    const t = setInterval(tick, 3_000);
    return () => clearInterval(t);
  }, []);

  const vivos = feeds.feeds.filter((f) => f.conexion === 'en-vivo').length;
  const estadoAgente = (a: Agente): string => {
    if (!a.real) return `Sin motor · Bloque ${a.bloque}`;
    if (!feeds.feeds.length) return 'Sin fuente';
    if (a.id === 'vigia') return `Vigilando ${vivos}/${feeds.feeds.length} feeds`;
    if (a.id === 'programador') return `${leerEstrategias().length} estrategias`;
    if (a.id === 'juez') {
      const xs = leerEstrategias().filter((x) => x.ultimoVeredicto);
      return xs.length ? `${xs.filter((x) => x.ultimoVeredicto === 'APROBADA').length}/${xs.length} aprobadas` : 'Esperando estrategias';
    }
    if (a.id === 'rastreador') {
      const listos = feeds.feeds.filter((f) => f.memoria?.regimen).length;
      return listos ? `Régimen en ${listos}/${feeds.feeds.length} mercados` : 'Esperando historia';
    }
    return vivos ? `Leyendo ${vivos} ${vivos === 1 ? 'mercado' : 'mercados'}` : 'Esperando datos';
  };
  const estados = Object.fromEntries(AGENTES.map((a) => [a.id, estadoAgente(a)])) as Record<AgenteId, string>;
  const consola = (a: Agente): LineaConsola[] => {
    if (!a.real) return lineasSinMotor(a);
    if (a.id === 'vigia') {
      // El Vigía también firma el registro de conexiones del Centro de datos.
      const reg = registro.slice(0, 20).map((e, i) => ({ id: `reg-${e.t}-${i}`, hora: new Date(e.t), texto: e.texto }));
      return [...consolas.vigia, ...reg].sort((x, y) => y.hora.getTime() - x.hora.getTime()).slice(0, 60);
    }
    if (a.id === 'programador' || a.id === 'juez') return lineasLaboratorio(a.id);
    return a.id === 'rastreador' ? consolas.rastreador : consolas.flujo;
  };
  const etiquetaDatos = feeds.feeds.length ? `Datos de mercado · ${feeds.feeds.map((f) => f.simbolo).join(' · ')}` : 'Sin fuente de datos';
  const agente = AGENTES.find((a) => a.id === seleccion) ?? null;
  const reales = AGENTES.filter((a) => a.real).length;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Agentes"
        titulo="Sala de agentes"
        fuente={`${reales} DE ${AGENTES.length} CON MOTOR`}
        descripcion="El equipo que investiga, prueba y vigila. Los agentes nunca operan: eso lo hacen los bots aprobados por el Juez. Cada agente trabaja solo cuando su motor existe; los demás muestran en qué bloque se activan."
      >
        <Insignia variante="contorno">
          {reales} con motor · {AGENTES.length - reales} pendientes
        </Insignia>
      </Encabezado>

      <Panel cuerpo="p-0" className="overflow-hidden">
        <div className="relative h-[480px] md:h-[600px]">
          <SalaAgentes3D seleccion={seleccion} onSeleccion={setSeleccion} estados={estados} etiquetaDatos={etiquetaDatos} />
          <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 text-[10px] text-plata-500">
            <MousePointerClick size={12} /> Haz clic en un agente para abrir su consola
          </div>
        </div>
      </Panel>

      {([1, 2, 3] as const).map((capa) => (
        <section key={capa} className="space-y-2">
          <h3 className="etiqueta">
            Capa {capa} · {CAPAS[capa]}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {AGENTES.filter((a) => a.capa === capa).map((a) => {
              const ultima = consola(a)[0]?.texto;
              return (
                <button key={a.id} data-agente={a.id} onClick={() => setSeleccion(a.id)} className={`panel panel-hover p-4 text-left ${seleccion === a.id ? 'border-plata-400' : ''} ${a.real ? '' : 'opacity-70'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm text-white">
                      <Bot size={15} strokeWidth={1.5} /> {a.nombre}
                    </span>
                    <span className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-etiqueta text-plata-300">
                      <Punto estado={a.real ? (vivos ? 'activo' : 'espera') : 'detenido'} /> {a.real ? 'Motor real' : `Bloque ${a.bloque}`}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-plata-500">{a.rol}</p>
                  <p className="mt-3 line-clamp-2 min-h-[2.5em] font-mono text-[10.5px] text-plata-200">› {ultima ?? 'Esperando datos…'}</p>
                  <p className="mt-2 font-mono text-[10px] text-plata-500">{a.motor}</p>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <PanelLateral abierto={!!agente} onCerrar={() => setSeleccion(null)} subtitulo={agente ? `Capa ${agente.capa} · ${CAPAS[agente.capa]}` : 'Consola del agente'} titulo={agente?.nombre ?? ''}>
        {agente && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Insignia variante={agente.real ? 'solida' : 'tenue'}>{estados[agente.id]}</Insignia>
              <Insignia variante="tenue">
                <Cpu size={10} /> {agente.motor}
              </Insignia>
            </div>
            <p className="text-[13px] leading-relaxed text-plata-200">{agente.rol}.</p>
            {agente.real && (
              <div className="rounded-lg border border-borde-suave p-3">
                <p className="etiqueta">Mercados</p>
                <p className="mt-1 font-mono text-[11px] text-plata-200">
                  {feeds.feeds.length ? feeds.feeds.map((f) => `${f.simbolo} · ${NOMBRE_PROVEEDOR[f.proveedor]} · ${ESTADO_FEED[f.conexion]}`).join('  |  ') : 'Sin fuente: configúrala en el Centro de datos'}
                </p>
              </div>
            )}
            <div>
              <p className="etiqueta mb-2 flex items-center gap-1.5">
                <Terminal size={11} /> {agente.real ? 'Lo que ve en los datos' : 'Estado'}
              </p>
              <div className="rounded-lg border border-borde-suave bg-black/60 p-2">
                <Consola lineas={consola(agente)} alto="h-[360px]" />
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-plata-500">Los agentes no operan ni aprueban nada. Solo los bots que pasan el Juez operan, primero en Paper.</p>
          </div>
        )}
      </PanelLateral>
    </div>
  );
}

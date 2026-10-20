import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Binary, Fingerprint, MapPin, ScanSearch, Sparkles } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Insignia, { InsigniaVeredicto } from '@/components/ui/Insignia';
import Sparkline from '@/components/charts/Sparkline';
import { FEATURES_FIRMA, PATRONES, PRECIO_REFERENCIA, type PatronDescubierto } from '@/data/mock';
import { useSistema } from '@/hooks/SistemaDemo';
import { crearAleatorio, normal } from '@/lib/random';
import { haceTiempo, num, pct } from '@/lib/format';

const W = 100;
const H = 56;

interface PuntoEmb {
  x: number;
  y: number;
  cluster: number; // −1 = ruido
}

/** Proyección 2D (tipo UMAP) de ventanas de Order Flow; los clusters son patrones descubiertos. */
function useEmbedding() {
  return useMemo(() => {
    const rand = crearAleatorio(2026);
    const centros = PATRONES.map((_, i) => {
      const ang = (i / PATRONES.length) * Math.PI * 2 + 0.4;
      return { x: W / 2 + Math.cos(ang) * (30 + rand() * 8), y: H / 2 + Math.sin(ang) * (17 + rand() * 4) };
    });
    const puntos: PuntoEmb[] = [];
    PATRONES.forEach((p, i) => {
      const n = Math.round(p.ocurrencias / 5);
      const disp = 2.2 + rand() * 1.4;
      for (let k = 0; k < n; k++) puntos.push({ x: centros[i].x + normal(rand) * disp, y: centros[i].y + normal(rand) * disp * 0.8, cluster: i });
    });
    for (let k = 0; k < 260; k++) puntos.push({ x: 4 + rand() * (W - 8), y: 3 + rand() * (H - 6), cluster: -1 });
    return { centros, puntos };
  }, []);
}

export default function ConocimientoView() {
  const { mercado } = useSistema();
  const { centros, puntos } = useEmbedding();
  const [activo, setActivo] = useState<number | null>(null);
  const [nuevos, setNuevos] = useState<{ id: number; x: number; y: number; cluster: number }[]>([]);

  // Nuevas ventanas de Order Flow proyectadas en tiempo real.
  useEffect(() => {
    const rand = crearAleatorio(99);
    let id = 0;
    const t = setInterval(() => {
      const enCluster = rand() < 0.55;
      const c = enCluster ? Math.floor(rand() * centros.length) : -1;
      const x = c >= 0 ? centros[c].x + normal(rand) * 2.5 : 4 + rand() * (W - 8);
      const y = c >= 0 ? centros[c].y + normal(rand) * 2 : 3 + rand() * (H - 6);
      setNuevos((prev) => [...prev.slice(-9), { id: id++, x, y, cluster: c }]);
    }, 1100);
    return () => clearInterval(t);
  }, [centros]);

  const enRuido = puntos.filter((p) => p.cluster === -1).length;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Conocimiento"
        titulo="Patrones descubiertos en los datos"
        descripcion="No existe un catálogo de patrones. Los motores ML/DL toman ventanas de Order Flow, las proyectan en un espacio aprendido y agrupan lo que se repite. Cada grupo estable es un patrón descubierto, y solo el Juez dice si sirve."
      >
        <Insignia variante="tenue">Sin catálogo predefinido</Insignia>
        <Insignia variante="contorno">{PATRONES.length} patrones estables</Insignia>
      </Encabezado>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel titulo="Espacio aprendido · ventanas de 128 dollar bars" icono={ScanSearch} accion={<span className="font-mono text-[10px] text-plata-500">DL-Net-01 · proyección 2D</span>} cuerpo="p-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
            {puntos.map((p, i) => {
              const resaltado = activo === null || p.cluster === activo;
              const r = p.cluster === -1 ? 0.22 : 0.3;
              return <circle key={i} cx={p.x} cy={p.y} r={r} fill="#fff" opacity={p.cluster === -1 ? 0.14 : resaltado ? 0.75 : 0.12} />;
            })}
            {centros.map((c, i) => (
              <g key={PATRONES[i].id} opacity={activo === null || activo === i ? 1 : 0.25} onMouseEnter={() => setActivo(i)} onMouseLeave={() => setActivo(null)} className="cursor-pointer">
                <motion.circle
                  cx={c.x}
                  cy={c.y}
                  r={7}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={0.12}
                  strokeDasharray="0.6 0.6"
                  animate={{ strokeDashoffset: [0, 12] }}
                  transition={{ duration: 6 + i, repeat: Infinity, ease: 'linear' }}
                />
                <text x={c.x} y={c.y - 7.8} textAnchor="middle" fontSize={1.9} fill="#fff" fontFamily="JetBrains Mono, monospace" letterSpacing={0.1}>
                  {PATRONES[i].id}
                </text>
              </g>
            ))}
            <AnimatePresence>
              {nuevos.map((n) => (
                <motion.g key={n.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.circle cx={n.x} cy={n.y} fill="none" stroke="#fff" strokeWidth={0.12} initial={{ r: 0.4, opacity: 1 }} animate={{ r: 3, opacity: 0 }} transition={{ duration: 1.6 }} />
                  <circle cx={n.x} cy={n.y} r={0.45} fill="#fff" />
                </motion.g>
              ))}
            </AnimatePresence>
          </svg>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 font-mono text-[10px] text-plata-500">
            <span>● ventana asignada a un patrón</span>
            <span className="opacity-60">· ventana sin estructura (ruido {pct(enRuido / puntos.length, 0)})</span>
            <span>◯ nueva ventana proyectada</span>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel titulo="Proceso de descubrimiento" icono={Sparkles}>
            <ol className="relative space-y-4 border-l border-borde pl-5">
              {[
                ['Order Flow crudo', `${num(mercado.dollarBars)} dollar bars hoy`],
                ['Ventanas de 128 barras', 'delta, volumen, OI, libro, ATR'],
                ['Embedding aprendido', 'DL-Net-01 · 64 dimensiones'],
                ['Agrupación por densidad', 'clusters estables ≥ 60 ocurrencias'],
                ['Firma y estadísticas', 'qué Features pesan y cuánto'],
                ['Juez', 'Walk-Forward · costos · luck test'],
              ].map(([t, d], i) => (
                <li key={t} className="relative">
                  <motion.span
                    className="absolute -left-[23.5px] top-1 h-2 w-2 rounded-full border border-plata-300 bg-black"
                    animate={{ backgroundColor: ['#000000', '#ffffff', '#000000'] }}
                    transition={{ duration: 3, repeat: Infinity, delay: i * 0.5 }}
                  />
                  <p className="text-xs text-white">{t}</p>
                  <p className="font-mono text-[10px] text-plata-500">{d}</p>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel titulo="Resumen">
            <div className="grid grid-cols-2 gap-4">
              <Dato k="Ventanas analizadas" v={num(1_842_300 + mercado.dollarBars)} />
              <Dato k="Patrones estables" v={String(PATRONES.length)} />
              <Dato k="Aprobados por el Juez" v={String(PATRONES.filter((p) => p.juez.veredicto === 'Aprobado').length)} />
              <Dato k="Rechazados" v={String(PATRONES.filter((p) => p.juez.veredicto === 'Rechazado').length)} />
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {PATRONES.map((p, i) => (
          <TarjetaPatron key={p.id} p={p} activo={activo === i} onHover={(v) => setActivo(v ? i : null)} />
        ))}
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="etiqueta">{k}</p>
      <p className="cifra mt-1 text-lg text-white">{v}</p>
    </div>
  );
}

function TarjetaPatron({ p, activo, onHover }: { p: PatronDescubierto; activo: boolean; onHover: (v: boolean) => void }) {
  const { serie, marcas } = useMemo(() => {
    const rand = crearAleatorio(p.semilla);
    const s: number[] = [PRECIO_REFERENCIA - 900 + rand() * 600];
    for (let i = 1; i < 140; i++) s.push(s[i - 1] + normal(rand) * 55);
    const m: number[] = [];
    for (let i = 6; i < s.length; i++) if (rand() < p.ocurrencias / 4200) m.push(i);
    return { serie: s, marcas: m };
  }, [p]);

  const veredicto = p.juez.veredicto === 'Aprobado' ? 'APROBADO' : p.juez.veredicto === 'Rechazado' ? 'RECHAZADO' : 'EN EVALUACIÓN';

  return (
    <motion.div onHoverStart={() => onHover(true)} onHoverEnd={() => onHover(false)} whileHover={{ y: -2 }} className={`panel panel-hover flex flex-col p-4 ${activo ? 'border-plata-400' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm text-white">{p.id}</p>
          <p className="text-[10px] text-plata-500">
            Descubierto el {p.descubierto} · {p.modelo}
          </p>
        </div>
        <InsigniaVeredicto valor={veredicto} />
      </div>
      <p className="mt-3 text-[13px] leading-snug text-plata-100">{p.descriptor}</p>
      <p className="mt-0.5 text-[10px] italic text-plata-500">Descriptor redactado por el modelo a partir de la firma</p>

      <div className="mt-4">
        <p className="etiqueta mb-2 flex items-center gap-1.5">
          <Fingerprint size={11} /> Firma aprendida
        </p>
        <div className="space-y-1">
          {FEATURES_FIRMA.map((f, i) => {
            const v = p.firma[i];
            return (
              <div key={f} className="flex items-center gap-2 text-[10px]">
                <span className="w-[68px] shrink-0 truncate text-plata-400">{f}</span>
                <div className="relative h-2 flex-1">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
                  <motion.span
                    className={`absolute inset-y-0 ${v >= 0 ? 'left-1/2 bg-plata-200' : 'right-1/2 border border-plata-400'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.abs(v) * 50}%` }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <span className="cifra w-9 shrink-0 text-right text-plata-300">{v > 0 ? '+' : v < 0 ? '−' : ''}{num(Math.abs(v), 2)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <p className="etiqueta mb-1 flex items-center gap-1.5">
          <MapPin size={11} /> Dónde se encontró
        </p>
        <Sparkline datos={serie} alto={34} marcas={marcas} area={false} />
        <p className="mt-1 text-[10px] text-plata-500">
          {p.donde.sesion} · {p.donde.regimen} · {p.donde.zona}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-borde-suave pt-3">
        <MiniStat k="Veces" v={num(p.ocurrencias)} />
        <MiniStat k="Win" v={pct(p.juez.winRate, 1)} />
        <MiniStat k="PF" v={num(p.juez.profitFactor, 2)} />
        <MiniStat k="p" v={num(p.juez.pValor, 3)} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-plata-500">
        <Binary size={11} /> Horizonte {p.horizonte} barras · visto {haceTiempo(p.ultimaVezMin)}
      </p>
    </motion.div>
  );
}

function MiniStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-[0.14em] text-plata-500">{k}</p>
      <p className="cifra truncate text-xs text-white">{v}</p>
    </div>
  );
}

// Diario estilo ATAS: calendario del mes (cada día con su P&L, % y operaciones; total por semana), vista del año,
// todas las métricas y el detalle de cada día. Sale de las operaciones cerradas de Paper (bots y a mano), en tu hora.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Pildora from '@/components/ui/Pildora';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { fichaDeOperacion } from '@/motores/diario/desdePaper';
import { pnlNeto, resultadoR, resultadoPct, resumirDiario, type FichaOperacion, type ResumenPeriodo } from '@/motores/diario/diario';
import type { OperacionPaper } from '@/motores/paper/ejecutor';
import { num } from '@/lib/format';
import { useMotorPaper } from './comun';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const dos = (n: number) => String(n).padStart(2, '0');
const dinero = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)}`;
const porc = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v) * 100, 2)} %`;
/** Fondo del cuadrito: verde o rojo muy tenue, más fuerte cuanto más grande el día (relativo al mayor del mes). */
const tinte = (pnl: number, max: number) => {
  if (!pnl || !max) return undefined;
  const a = 0.05 + 0.2 * Math.min(1, Math.abs(pnl) / max);
  return pnl > 0 ? `rgba(52,211,153,${a})` : `rgba(251,113,133,${a})`;
};

export default function Diario({ ops }: { ops: OperacionPaper[] }) {
  const motor = useMotorPaper();
  const desfase = -new Date().getTimezoneOffset();
  const hoy = new Date();
  const [quien, setQuien] = useState('todos');
  const [mercado, setMercado] = useState('todos');
  const [vista, setVista] = useState<'mes' | 'anio'>('mes');
  const [y, setY] = useState(hoy.getFullYear());
  const [m, setM] = useState(hoy.getMonth());
  const [dia, setDia] = useState<string | null>(null);

  const todas = useMemo(() => ops.map((o) => fichaDeOperacion(o, motor.bots.find((b) => b.id === o.botId))), [ops, motor.bots]);
  const quienes = useMemo(() => [...new Map(todas.map((f) => [f.origen === 'manual' ? 'manual' : f.botId ?? '', f.origen === 'manual' ? 'Tú (manual)' : f.estrategia])).entries()], [todas]);
  const mercados = useMemo(() => [...new Set(todas.map((f) => f.mercado))], [todas]);
  const fichas = todas.filter((f) => (quien === 'todos' || (quien === 'manual' ? f.origen === 'manual' : f.botId === quien)) && (mercado === 'todos' || f.mercado === mercado));
  const r = useMemo(() => resumirDiario(fichas, desfase), [fichas, desfase]);
  const porDia = new Map(r.dias.map((d) => [d.clave, d]));
  const claveMes = `${y}-${dos(m + 1)}`;
  const delMes = r.dias.filter((d) => d.clave.startsWith(claveMes));
  const maxMes = Math.max(0, ...delMes.map((d) => Math.abs(d.pnl)));
  const mes = r.meses.find((x) => x.clave === claveMes);

  // Semanas del mes (lunes a domingo), con huecos antes del día 1 y después del último.
  const primero = (new Date(y, m, 1).getDay() + 6) % 7;
  const nDias = new Date(y, m + 1, 0).getDate();
  const celdas: (number | null)[] = [...Array(primero).fill(null), ...Array.from({ length: nDias }, (_, i) => i + 1)];
  while (celdas.length % 7) celdas.push(null);
  const semanas = Array.from({ length: celdas.length / 7 }, (_, i) => celdas.slice(i * 7, i * 7 + 7));
  const mover = (d: number) => {
    const t = new Date(y, m + d, 1);
    setY(t.getFullYear());
    setM(t.getMonth());
    setDia(null);
  };
  const delDia = dia ? fichas.filter((f) => f.salida && claveLocal(f.salida.t, desfase) === dia).sort((a, b) => a.salida!.t - b.salida!.t) : [];

  return (
    <div className="space-y-4" data-diario>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Selector valor={quien} alCambiar={setQuien} opciones={[['todos', 'Todos'], ...quienes]} nombre="Quién" />
        <Selector valor={mercado} alCambiar={setMercado} opciones={[['todos', 'Todos los mercados'], ...mercados.map((x) => [x, x.split(':')[1] ?? x] as [string, string])]} nombre="Mercado" />
        <div className="ml-auto flex rounded-lg border border-borde p-0.5 text-[11px]" role="radiogroup" aria-label="Vista">
          {(['mes', 'anio'] as const).map((v) => (
            <button key={v} role="radio" aria-checked={vista === v} onClick={() => setVista(v)} className={`relative rounded-md px-3 py-1 ${vista === v ? 'text-black' : 'text-plata-300 hover:text-white'}`}>
              {vista === v && <Pildora id="diario-vista" className="absolute inset-0 rounded-md bg-white" rigidez={420} />}
              <span className="relative">{v === 'mes' ? 'Mes' : 'Año'}</span>
            </button>
          ))}
        </div>
      </div>

      {vista === 'mes' ? (
        <Panel
          titulo={
            <span className="flex items-center gap-2">
              <button onClick={() => mover(-1)} aria-label="Mes anterior" className="rounded p-0.5 text-plata-400 hover:text-white">
                <ChevronLeft size={14} />
              </button>
              <span className="w-36 text-center normal-case tracking-normal text-white">
                {MESES[m]} {y}
              </span>
              <button onClick={() => mover(1)} aria-label="Mes siguiente" className="rounded p-0.5 text-plata-400 hover:text-white">
                <ChevronRight size={14} />
              </button>
            </span>
          }
          accion={
            <span className="cifra text-[11px]">
              <span className={mes && mes.pnl < 0 ? 'text-plata-400' : 'text-white'}>{mes ? `${dinero(mes.pnl)} USD` : '—'}</span>
              <span className="text-plata-500"> · {mes ? `${porc(mes.pct)} · ${mes.operaciones} op.` : 'sin operaciones'}</span>
            </span>
          }
          cuerpo="overflow-x-auto p-3"
        >
          <div className="grid min-w-[720px] grid-cols-[repeat(7,minmax(0,1fr))_110px] gap-1.5" data-calendario={claveMes}>
            {[...DIAS, 'Semana'].map((d) => (
              <p key={d} className="px-1 pb-1 text-[9.5px] uppercase tracking-[0.16em] text-plata-500">
                {d}
              </p>
            ))}
            {semanas.map((sem, i) => {
              const tot = sem.reduce<ResumenPeriodo>((a, d) => {
                const x = d ? porDia.get(`${claveMes}-${dos(d)}`) : undefined;
                return x ? { clave: '', pnl: a.pnl + x.pnl, pct: a.pct + x.pct, operaciones: a.operaciones + x.operaciones, ganadoras: a.ganadoras + x.ganadoras } : a;
              }, { clave: '', pnl: 0, pct: 0, operaciones: 0, ganadoras: 0 });
              return [
                ...sem.map((d, k) => {
                  if (!d) return <div key={`${i}-${k}`} className="h-[84px] rounded-lg border border-transparent" />;
                  const clave = `${claveMes}-${dos(d)}`;
                  const x = porDia.get(clave);
                  const esHoy = d === hoy.getDate() && m === hoy.getMonth() && y === hoy.getFullYear();
                  return (
                    <motion.button
                      key={clave}
                      onClick={() => setDia(dia === clave ? null : clave)}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (i * 7 + k) * 0.008 }}
                      style={{ background: tinte(x?.pnl ?? 0, maxMes) }}
                      className={`flex h-[84px] flex-col justify-between rounded-lg border p-2 text-left transition-colors ${dia === clave ? 'border-white' : esHoy ? 'border-plata-400' : 'border-borde-suave hover:border-borde-fuerte'}`}
                      data-dia={clave}
                    >
                      <span className={`text-[10px] ${esHoy ? 'text-white' : 'text-plata-500'}`}>{d}</span>
                      {x ? (
                        <span>
                          <span className={`cifra block text-[13px] ${x.pnl >= 0 ? 'text-white' : 'text-plata-200'}`}>{dinero(x.pnl)}</span>
                          <span className="cifra block text-[9.5px] text-plata-400">
                            {porc(x.pct)} · {x.operaciones} op.
                          </span>
                        </span>
                      ) : (
                        <span className="text-[9.5px] text-plata-600">—</span>
                      )}
                    </motion.button>
                  );
                }),
                <div key={`s${i}`} className="flex h-[84px] flex-col justify-between rounded-lg border border-borde bg-white/[0.02] p-2">
                  <span className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">Sem {i + 1}</span>
                  {tot.operaciones ? (
                    <span>
                      <span className={`cifra block text-[13px] ${tot.pnl >= 0 ? 'text-white' : 'text-plata-300'}`}>{dinero(tot.pnl)}</span>
                      <span className="cifra block text-[9.5px] text-plata-400">
                        {tot.operaciones} op. · {num((tot.ganadoras / tot.operaciones) * 100, 0)} %
                      </span>
                    </span>
                  ) : (
                    <span className="text-[9.5px] text-plata-600">—</span>
                  )}
                </div>,
              ];
            })}
          </div>
          {dia && <DetalleDia clave={dia} fichas={delDia} />}
        </Panel>
      ) : (
        <Anio y={y} meses={r.meses} alCambiar={setY} alElegirMes={(mm) => (setM(mm), setVista('mes'))} />
      )}

      <Metricas r={r} />
    </div>
  );
}

const claveLocal = (t: number, desfase: number) => new Date(t + desfase * 60_000).toISOString().slice(0, 10);

function Selector({ valor, alCambiar, opciones, nombre }: { valor: string; alCambiar: (v: string) => void; opciones: [string, string][]; nombre: string }) {
  return (
    <select value={valor} onChange={(e) => alCambiar(e.target.value)} aria-label={nombre} className="rounded-lg border border-borde bg-black px-2.5 py-1.5 text-[11px] text-plata-100 outline-none focus:border-plata-400">
      {opciones.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );
}

function DetalleDia({ clave, fichas }: { clave: string; fichas: FichaOperacion[] }) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 overflow-x-auto border-t border-borde-suave pt-3" data-detalle-dia={clave}>
      <p className="etiqueta mb-2">Operaciones del {clave.split('-').reverse().join('/')}</p>
      {fichas.length ? (
        <table className="w-full min-w-[640px] text-left text-[11px]">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
              <th className="py-1 font-normal">Hora</th>
              <th className="py-1 font-normal">Quién</th>
              <th className="py-1 font-normal">Lado</th>
              <th className="py-1 text-right font-normal">Entrada → salida</th>
              <th className="py-1 text-right font-normal">R</th>
              <th className="py-1 text-right font-normal">P&L</th>
              <th className="py-1 font-normal">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {fichas.map((f) => {
              const r = resultadoR(f);
              const neto = pnlNeto(f);
              return (
                <tr key={f.id} className="border-t border-borde-suave">
                  <td className="cifra py-1 text-plata-400">{new Date(f.salida!.t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-1 text-plata-100">{f.origen === 'manual' ? 'Tú' : f.estrategia}</td>
                  <td className="py-1 text-plata-300">{f.lado > 0 ? '▲ Largo' : '▼ Corto'}</td>
                  <td className="cifra py-1 text-right text-plata-300">
                    {num(f.entrada.precio, 2)} → {num(f.salida!.precio, 2)}
                  </td>
                  <td className="cifra py-1 text-right text-plata-200">{r === null ? '—' : `${r >= 0 ? '+' : ''}${num(r, 2)}R`}</td>
                  <td className={`cifra py-1 text-right ${neto >= 0 ? 'text-white' : 'text-plata-400'}`}>
                    {dinero(neto)} · {porc(resultadoPct(f) ?? 0)}
                  </td>
                  <td className="py-1 text-plata-400">{f.salida!.motivo === 'senal' ? 'señal' : f.salida!.motivo}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-plata-500">Ese día no hubo operaciones cerradas.</p>
      )}
    </motion.div>
  );
}

function Anio({ y, meses, alCambiar, alElegirMes }: { y: number; meses: ResumenPeriodo[]; alCambiar: (y: number) => void; alElegirMes: (m: number) => void }) {
  const del = meses.filter((x) => x.clave.startsWith(`${y}-`));
  const max = Math.max(0, ...del.map((x) => Math.abs(x.pnl)));
  const total = del.reduce((a, x) => a + x.pnl, 0);
  return (
    <Panel
      titulo={
        <span className="flex items-center gap-2">
          <button onClick={() => alCambiar(y - 1)} aria-label="Año anterior" className="rounded p-0.5 text-plata-400 hover:text-white">
            <ChevronLeft size={14} />
          </button>
          <span className="w-16 text-center normal-case tracking-normal text-white">{y}</span>
          <button onClick={() => alCambiar(y + 1)} aria-label="Año siguiente" className="rounded p-0.5 text-plata-400 hover:text-white">
            <ChevronRight size={14} />
          </button>
        </span>
      }
      accion={<span className={`cifra text-[11px] ${total < 0 ? 'text-plata-400' : 'text-white'}`}>{del.length ? `${dinero(total)} USD en el año` : 'sin operaciones'}</span>}
      cuerpo="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-6"
    >
      {MESES.map((nombre, i) => {
        const x = del.find((d) => d.clave === `${y}-${dos(i + 1)}`);
        return (
          <button key={nombre} onClick={() => alElegirMes(i)} style={{ background: tinte(x?.pnl ?? 0, max) }} className="flex h-24 flex-col justify-between rounded-lg border border-borde-suave p-2.5 text-left hover:border-borde-fuerte" data-mes={`${y}-${dos(i + 1)}`}>
            <span className="text-[10px] uppercase tracking-[0.14em] text-plata-400">{nombre}</span>
            {x ? (
              <span>
                <span className={`cifra block text-sm ${x.pnl >= 0 ? 'text-white' : 'text-plata-200'}`}>{dinero(x.pnl)}</span>
                <span className="cifra block text-[9.5px] text-plata-400">
                  {porc(x.pct)} · {x.operaciones} op. · {num((x.ganadoras / x.operaciones) * 100, 0)} %
                </span>
              </span>
            ) : (
              <span className="text-[9.5px] text-plata-600">—</span>
            )}
          </button>
        );
      })}
    </Panel>
  );
}

function Metricas({ r }: { r: ReturnType<typeof resumirDiario> }) {
  const x = r.metricas;
  const v = (n: number | null, f: (n: number) => string) => (n === null ? '—' : f(n));
  const tarjetas: [string, string, string?][] = [
    ['P&L neto', `${dinero(x.pnlNeto)} USD`, `${x.operaciones} operaciones`],
    ['Ganancia bruta', `${num(x.gananciaBruta, 2)} USD`],
    ['Pérdida bruta', `${num(x.perdidaBruta, 2)} USD`],
    ['Comisiones + funding', `${num(x.comisiones + x.funding, 2)} USD`],
    ['% ganadoras', v(x.aciertos, (n) => `${num(n * 100, 1)} %`)],
    ['Profit factor', v(x.profitFactor, (n) => (Number.isFinite(n) ? num(n, 2) : '∞'))],
    ['Esperanza', v(x.esperanzaR, (n) => `${n >= 0 ? '+' : ''}${num(n, 2)}R`), 'por operación (solo con stop)'],
    ['Llegaron a +1R', v(x.llegaron1R, (n) => `${num(n * 100, 0)} %`)],
    ['Ganancia media', v(x.gananciaMedia, (n) => `${num(n, 2)} USD`)],
    ['Pérdida media', v(x.perdidaMedia, (n) => `${num(n, 2)} USD`)],
    ['Peor caída', `${num(x.maxDrawdown, 2)} USD`, 'del P&L acumulado'],
    ['Mejor / peor día', `${x.mejorDia ? dinero(x.mejorDia.pnl) : '—'} / ${x.peorDia ? dinero(x.peorDia.pnl) : '—'}`],
    ['Racha ganadora', String(x.rachaGanadora), 'operaciones seguidas'],
    ['Racha perdedora', String(x.rachaPerdedora), 'operaciones seguidas'],
    ['Largos', `${dinero(x.largos.pnl)} USD`, `${x.largos.operaciones} op.`],
    ['Cortos', `${dinero(x.cortos.pnl)} USD`, `${x.cortos.operaciones} op.`],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" data-metricas-diario>
        {tarjetas.map(([k, val, nota], i) => (
          <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="panel p-3">
            <p className="etiqueta truncate">{k}</p>
            <p className="cifra mt-1 truncate text-[15px] font-light text-white">{val}</p>
            {nota && <p className="mt-0.5 truncate text-[9.5px] text-plata-500">{nota}</p>}
          </motion.div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel titulo="Por día de la semana" cuerpo="p-4">
          <Barras datos={x.porDiaSemana.map((d, i) => ({ k: DIAS[i], v: d.pnl, n: d.operaciones }))} />
        </Panel>
        <Panel titulo="Por hora de entrada (tu hora)" cuerpo="p-4">
          <Barras datos={x.porHora.map((d, i) => ({ k: i % 3 === 0 ? `${dos(i)}h` : '', v: d.pnl, n: d.operaciones }))} />
        </Panel>
      </div>
    </div>
  );
}

/** Barras divergentes (arriba = ganancia, abajo = pérdida) con una línea en cero. */
function Barras({ datos }: { datos: { k: string; v: number; n: number }[] }) {
  const max = Math.max(1e-9, ...datos.map((d) => Math.abs(d.v)));
  return (
    <div>
      <div className="relative flex h-32 items-stretch gap-[3px]">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/15" />
        {datos.map((d, i) => (
          <div key={i} className="relative flex-1" title={`${d.k || i}: ${dinero(d.v)} USD · ${d.n} op.`}>
            {d.v !== 0 && (
              <motion.div
                className={`absolute inset-x-0 rounded-[2px] ${d.v > 0 ? 'bottom-1/2 bg-white/80' : 'top-1/2 bg-plata-600'}`}
                initial={{ height: 0 }}
                animate={{ height: `${(Math.abs(d.v) / max) * 50}%` }}
                transition={{ duration: 0.6, delay: i * 0.015 }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {datos.map((d, i) => (
          <span key={i} className="flex-1 text-center font-mono text-[9px] text-plata-500">
            {d.k}
          </span>
        ))}
      </div>
    </div>
  );
}

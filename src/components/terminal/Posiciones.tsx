// Posiciones abiertas de todos (bots y a mano): dónde está el precio entre el stop y el objetivo, R vivo y P&L.
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { equity, precioMedio, type Bot } from '@/motores/paper/ejecutor';
import { tieneObjetivo } from '@/motores/paper/manual';
import { num } from '@/lib/format';
import { useMotorPaper, usd } from './comun';

function Recorrido({ b, precio }: { b: Bot; precio: number }) {
  const g = b.gestion?.posicion;
  const p = b.posicion!;
  if (!g) return <span className="text-[10.5px] text-plata-500">sin stop · sale por la señal de su estrategia</span>;
  const objetivo = tieneObjetivo(g.objetivo) ? g.objetivo : p.precioEntrada + p.lado * Math.max(3 * g.riesgo, Math.abs(precio - p.precioEntrada) * 1.2);
  // Eje en R: −1 (stop inicial) … objetivo. El precio y el stop actual se ubican en esa misma escala.
  const rDe = (x: number) => ((x - p.precioEntrada) * p.lado) / g.riesgo;
  const rMax = rDe(objetivo);
  const pos = (r: number) => `${Math.max(0, Math.min(100, ((r + 1) / (rMax + 1)) * 100))}%`;
  const rVivo = rDe(precio);
  return (
    <div className="min-w-[180px]">
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-plata-600 via-white/20 to-white/60" />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-plata-500" style={{ left: pos(-1) }} title="stop inicial" />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-white/60" style={{ left: pos(0) }} title="entrada" />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-white" style={{ left: pos(rMax) }} title="objetivo" />
        <motion.div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-plata-300 bg-black" initial={false} animate={{ left: pos(rDe(g.stop)) }} title="stop actual" />
        <motion.div className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" initial={false} animate={{ left: pos(rVivo) }} transition={{ type: 'spring', stiffness: 160, damping: 22 }} />
      </div>
      <div className="flex justify-between font-mono text-[9px] text-plata-500">
        <span>SL {num(g.stop, 2)}</span>
        <span className="text-plata-200">{rVivo >= 0 ? '+' : ''}{num(rVivo, 2)}R</span>
        <span>{tieneObjetivo(g.objetivo) ? `TP ${num(g.objetivo, 2)}` : 'sin TP'}</span>
      </div>
    </div>
  );
}

export default function Posiciones() {
  const motor = useMotorPaper();
  const abiertas = motor.bots.filter((b) => b.posicion);
  return (
    <div className="overflow-x-auto" data-posiciones={abiertas.length}>
      {abiertas.length ? (
        <table className="w-full min-w-[760px] text-left text-[11px]">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
              <th className="py-1.5 font-normal">Quién</th>
              <th className="py-1.5 font-normal">Lado</th>
              <th className="py-1.5 text-right font-normal">Entrada → ahora</th>
              <th className="px-4 py-1.5 font-normal">Stop → objetivo</th>
              <th className="py-1.5 text-right font-normal">P&L</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {abiertas.map((b) => {
              const p = b.posicion!;
              const m = motor.mercado(b);
              const precio = (m && precioMedio(m)) ?? b.ultimoPrecio ?? p.precioEntrada;
              const pnl = equity(b, m) - b.capital;
              return (
                <tr key={b.id} className="border-t border-borde-suave" data-posicion={b.id}>
                  <td className="py-2">
                    <span className="text-white">{b.origen === 'manual' ? 'Tú' : b.nombre}</span> <span className="text-plata-500">{b.simbolo}</span>
                  </td>
                  <td className="py-2 text-plata-200">{p.lado > 0 ? '▲ Largo' : '▼ Corto'}</td>
                  <td className="cifra py-2 text-right text-plata-300">
                    {num(p.precioEntrada, 2)} → <span className="text-white">{num(precio, 2)}</span>
                  </td>
                  <td className="px-4 py-2">
                    <Recorrido b={b} precio={precio} />
                  </td>
                  <td className={`cifra py-2 text-right ${pnl >= 0 ? 'text-white' : 'text-plata-400'}`}>{usd(pnl)}</td>
                  <td className="py-2 text-right">
                    {b.origen === 'manual' && (
                      <button onClick={() => void motor.cerrarManual(b.id)} className="inline-flex items-center gap-1 rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:border-white hover:text-white" data-cerrar={b.id}>
                        <X size={11} /> Cerrar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="py-4 text-center text-xs text-plata-500">Sin posiciones abiertas. Cuando un bot o tú entren, aparecen aquí con su stop y su objetivo.</p>
      )}
    </div>
  );
}

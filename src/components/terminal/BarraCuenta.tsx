// Barra de cuenta de la Terminal: dónde corren los bots, capital, P&L abierto y del día, bots activos y el apagado.
// Un punto que late con cada segundo del motor: si deja de latir, no llegan datos.
import { motion } from 'framer-motion';
import { Power, ShieldCheck } from 'lucide-react';
import { equity, type OperacionPaper } from '@/motores/paper/ejecutor';
import { num } from '@/lib/format';
import { useMotorPaper } from './comun';

const inicioDiaUtc = (t: number) => Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());

export default function BarraCuenta({ ops, ahora }: { ops: OperacionPaper[]; ahora: number }) {
  const motor = useMotorPaper();
  const bots = motor.bots;
  const capital = bots.reduce((s, b) => s + equity(b, motor.mercado(b)), 0);
  const abierto = bots.reduce((s, b) => s + (b.posicion ? equity(b, motor.mercado(b)) - b.capital : 0), 0);
  const hoy = ops.filter((o) => o.salidaT >= inicioDiaUtc(ahora)).reduce((s, o) => s + o.pnl, 0) + abierto;
  const activos = bots.filter((b) => b.estado === 'activo' && b.origen !== 'manual').length;
  const celda = (k: string, v: string, tono?: number) => (
    <div className="min-w-0 border-l border-borde-suave px-3 first:border-l-0 sm:px-4">
      <p className="truncate text-[9px] uppercase tracking-[0.16em] text-plata-500">{k}</p>
      <p className={`cifra mt-0.5 truncate text-[15px] font-light ${tono === undefined ? 'text-white' : tono >= 0 ? 'text-white' : 'text-plata-400'}`}>
        {tono !== undefined && <span className="mr-1 text-[10px]">{tono >= 0 ? '▲' : '▼'}</span>}
        {v}
      </p>
    </div>
  );
  return (
    <div className="sticky top-16 z-30 -mx-1 bg-black/85 px-1 py-2 backdrop-blur-xl" data-barra-cuenta>
      <div className="flex flex-wrap items-center gap-y-2 rounded-xl border border-borde bg-[linear-gradient(90deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01)_40%,rgba(255,255,255,0.03))] py-2.5">
        <div className="flex items-center gap-2.5 px-4">
          <span className="relative flex h-2 w-2">
            <motion.span key={Math.floor(ahora / 1000)} className="absolute inset-0 rounded-full bg-white" initial={{ scale: 1, opacity: 0.7 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 0.9 }} />
            <span className="relative h-2 w-2 rounded-full bg-white" />
          </span>
          <div>
            <p className="text-[9px] uppercase tracking-[0.16em] text-plata-500">Terminal · Paper</p>
            <p className="text-[11px] text-white" data-donde-bots={motor.enVps ? 'vps' : 'navegador'}>
              {motor.enVps ? 'Bots en tu VPS · 24/7' : 'Bots en este navegador'}
            </p>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 sm:grid-cols-4">
          {celda('Capital Paper', `${num(capital, 2)}`)}
          {celda('P&L abierto', num(Math.abs(abierto), 2), abierto)}
          {celda('P&L de hoy', num(Math.abs(hoy), 2), hoy)}
          {celda('Bots activos', `${activos}/${bots.filter((b) => b.origen !== 'manual').length}`)}
        </div>
        <div className="px-3">
          {motor.apagado ? (
            <button onClick={() => motor.rearmar()} className="flex items-center gap-1.5 rounded-lg border border-white px-3 py-1.5 text-[11px] text-white" data-rearmar>
              <ShieldCheck size={12} /> Rearmar
            </button>
          ) : (
            <button onClick={() => window.confirm('¿Cerrar todas las posiciones y apagar todos los bots?') && void motor.apagarTodo()} className="flex items-center gap-1.5 rounded-lg border border-borde-fuerte px-3 py-1.5 text-[11px] text-plata-100 transition-colors hover:border-white hover:bg-white hover:text-black" data-apagado>
              <Power size={12} /> Apagado de emergencia
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

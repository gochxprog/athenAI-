// Estrategia en el Laboratorio + 8 tarjetas de métricas fuera de muestra con ✓/✕ (estilo de la antigua pantalla).
// Los umbrales marcados «Juez» son reglas del Juez; los marcados «ref.» son solo referencia (no deciden nada).
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import Panel from '@/components/ui/Panel';
import Insignia from '@/components/ui/Insignia';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { MIN_OPERACIONES } from '@/motores/juez/juez';
import { ALFA_LUCK } from '@/motores/juez/luckTest';
import { PBO_MAXIMO } from '@/motores/juez/sobreajuste';
import { conSigno, num } from '@/lib/format';

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : conSigno(v * 100, d, '%'));
const fecha = (t: number) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' });

export function TarjetaEstrategia({ r, nombre, selector }: { r: RespuestaLaboratorio; nombre: string; selector?: ReactNode }) {
  const j = r.resultado;
  return (
    <Panel cuerpo="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3" data-tarjeta-estrategia>
        <div className="min-w-0">
          <p className="etiqueta">Estrategia en el Laboratorio</p>
          <p className="mt-1 text-sm text-white">
            {nombre}
            {j.score && <span className="cifra ml-2 text-plata-300">· {num(j.score.total, 0)}/100</span>}
          </p>
          <p className="text-[11px] text-plata-500">
            {j.mercado ?? 'mercado'} · {num(r.filas)} barras ({fecha(r.desde)} → {fecha(r.hasta)}) · {r.combos.length} {r.combos.length === 1 ? 'variante' : 'variantes'} · {num(j.ensayos)} probadas · comisión y deslizamiento incluidos
            {r.fundingIncluido ? ' · funding incluido' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Insignia variante={j.veredicto === 'APROBADA' ? 'solida' : j.veredicto === 'RECHAZADA' ? 'tachada' : 'contorno'}>{j.veredicto}</Insignia>
          {selector}
        </div>
      </div>
      <p className="mt-3 border-t border-borde-suave pt-3 text-[11.5px] text-plata-200" data-resumen-juez>{j.resumen}</p>
      {(j.alertas ?? []).map((a) => (
        <p key={a} className="mt-1 text-[11px] text-plata-300" data-alerta>
          ⚠ {a}
        </p>
      ))}
    </Panel>
  );
}

export default function TarjetasJuez({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const o = j.oos;
  const pbo = j.pbo;
  const p = j.suerte?.p ?? null;
  const filas: { k: string; v: string; ok: boolean | null; regla: string }[] = [
    { k: 'Win Rate', v: o.aciertos === null ? '—' : pct(o.aciertos, 1).replace('+', ''), ok: o.aciertos === null ? null : o.aciertos >= 0.5, regla: '≥ 50 % · ref.' },
    { k: 'Profit Factor', v: o.factorBeneficio === null ? '—' : num(o.factorBeneficio, 2), ok: o.factorBeneficio === null ? null : o.factorBeneficio > 1.2, regla: '> 1,20 · ref.' },
    { k: 'Expectancy', v: pct(o.retornoMedioOperacion, 3), ok: o.retornoMedioOperacion === null ? null : o.retornoMedioOperacion > 0, regla: '> 0 por operación' },
    { k: 'Max Drawdown', v: pct(-o.maxDrawdown, 1), ok: o.maxDrawdown <= 0.2, regla: '≤ 20 % · Juez' },
    { k: 'Sharpe / Sortino', v: `${o.sharpe === null ? '—' : num(o.sharpe, 2)} / ${o.sortino === null ? '—' : num(o.sortino, 2)}`, ok: o.sharpe === null ? null : o.sharpe > 0, regla: 'Sharpe > 0 fuera de muestra' },
    { k: 'Prob. sobreajuste', v: pbo === null ? '—' : pct(pbo, 0).replace('+', ''), ok: pbo === null ? null : pbo < PBO_MAXIMO, regla: `PBO < ${num(PBO_MAXIMO * 100, 0)} % · Juez` },
    { k: 'Luck test', v: p === null ? '—' : `p = ${num(p, 3)}`, ok: p === null ? null : p < ALFA_LUCK, regla: `p < ${num(ALFA_LUCK, 2)} · Juez` },
    { k: 'Operaciones', v: num(o.operaciones), ok: o.operaciones >= MIN_OPERACIONES, regla: `≥ ${MIN_OPERACIONES} · Juez` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8" data-tarjetas-juez>
      {filas.map((f, i) => (
        <motion.div key={`${r.hasta}-${f.k}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="panel p-3">
          <div className="flex items-center justify-between">
            <p className="etiqueta truncate">{f.k}</p>
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${f.ok ? 'bg-white text-black' : f.ok === null ? 'border border-borde text-plata-500' : 'border border-plata-500 text-plata-400'}`} title={f.ok ? 'Cumple' : f.ok === null ? 'Sin dato' : 'No cumple'}>
              {f.ok ? '✓' : f.ok === null ? '·' : '✕'}
            </span>
          </div>
          <p className={`cifra mt-1.5 text-lg ${f.ok === false ? 'text-plata-400 line-through decoration-plata-600' : 'text-white'}`}>{f.v}</p>
          <p className="mt-0.5 font-mono text-[9.5px] text-plata-500">{f.regla}</p>
        </motion.div>
      ))}
    </div>
  );
}

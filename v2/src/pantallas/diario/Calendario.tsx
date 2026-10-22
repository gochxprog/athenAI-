// Calendario del mes del Diario: cada día con su resultado (verde si ganó, morado si perdió, más intenso cuanto más
// grande) y el total de cada semana. Tocar un día muestra sus operaciones.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ResumenPeriodo } from '@/motores/diario/diario';
import { dinero } from '../../formato';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const dos = (n: number) => String(n).padStart(2, '0');
const tinte = (pnl: number, max: number) => (pnl && max ? `rgba(${pnl > 0 ? '126,226,168' : '168,85,247'},${0.08 + 0.3 * Math.min(1, Math.abs(pnl) / max)})` : undefined);

export default function Calendario({ dias, y, m, mover, dia, elegir }: { dias: ResumenPeriodo[]; y: number; m: number; mover: (d: number) => void; dia: string | null; elegir: (d: string | null) => void }) {
  const porDia = new Map(dias.map((d) => [d.clave, d]));
  const del = dias.filter((d) => d.clave.startsWith(`${y}-${dos(m + 1)}`));
  const max = Math.max(0, ...del.map((d) => Math.abs(d.pnl)));
  const total = del.reduce((s, d) => s + d.pnl, 0);
  // Semanas de lunes a domingo, con huecos antes del 1 y después del último día.
  const primero = (new Date(y, m, 1).getDay() + 6) % 7;
  const celdas: (number | null)[] = [...Array(primero).fill(null), ...Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => i + 1)];
  while (celdas.length % 7) celdas.push(null);
  const semanas = Array.from({ length: celdas.length / 7 }, (_, i) => celdas.slice(i * 7, i * 7 + 7));
  const clave = (d: number) => `${y}-${dos(m + 1)}-${dos(d)}`;

  return (
    <section className="caja calendario">
      <header>
        <button className="boton" onClick={() => mover(-1)} aria-label="Mes anterior"><ChevronLeft size={14} /></button>
        <b>{MESES[m]} {y}</b>
        <span className={`mono ${total > 0 ? 'gana' : total < 0 ? 'pierde' : ''}`}>{dinero(total)} USD · {del.reduce((s, d) => s + d.operaciones, 0)} ops</span>
        <button className="boton" onClick={() => mover(1)} aria-label="Mes siguiente"><ChevronRight size={14} /></button>
      </header>
      <div className="rejilla-cal">
        {[...DIAS, 'Semana'].map((d) => <span key={d} className="et">{d}</span>)}
        {semanas.flatMap((s, i) => {
          const sem = s.reduce<number>((a, d) => a + (d ? porDia.get(clave(d))?.pnl ?? 0 : 0), 0);
          return [
            ...s.map((d, j) =>
              d === null ? (
                <span key={`${i}-${j}`} className="vacia" />
              ) : (
                <button key={`${i}-${j}`} className={`dia ${dia === clave(d) ? 'sel' : ''}`} style={{ background: tinte(porDia.get(clave(d))?.pnl ?? 0, max) }} onClick={() => elegir(dia === clave(d) ? null : clave(d))}>
                  <small>{d}</small>
                  {porDia.get(clave(d)) && <b className="mono">{dinero(porDia.get(clave(d))!.pnl)}</b>}
                  {porDia.get(clave(d)) && <i className="mono">{porDia.get(clave(d))!.operaciones} op</i>}
                </button>
              ),
            ),
            <span key={`s${i}`} className={`semana mono ${sem > 0 ? 'gana' : sem < 0 ? 'pierde' : ''}`}>{sem ? dinero(sem) : '—'}</span>,
          ];
        })}
      </div>
    </section>
  );
}

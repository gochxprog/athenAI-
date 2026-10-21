// Libro de operaciones de la Terminal (bots y manuales), con su CSV. Movido desde Paper Trading.
import { Download } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { operacionesCsv, type OperacionPaper } from '@/motores/paper/ejecutor';
import { descargarCsv } from '@/motores/worker/motorCliente';
import { num } from '@/lib/format';
import { hora, pct, usd } from './comun';

const MOTIVO: Record<string, string> = { senal: 'señal', manual: 'a mano', 'break-even': 'break-even', 'stop-en-ganancia': 'stop en ganancia' };

export default function LibroOperaciones({ ops, nombre }: { ops: OperacionPaper[]; nombre: (id: string) => string }) {
  return (
      <Panel
        titulo="Libro de operaciones"
        accion={
          <button onClick={() => descargarCsv(operacionesCsv(ops), 'operaciones-paper.csv')} disabled={!ops.length} className="flex items-center gap-1 rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:text-white disabled:opacity-40">
            <Download size={11} /> CSV
          </button>
        }
        cuerpo="overflow-x-auto px-4 py-2"
      >
        {ops.length ? (
          <table className="w-full min-w-[820px] text-left text-[11px]" data-operaciones={ops.length}>
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                <th className="py-1 font-normal">Bot</th>
                <th className="py-1 font-normal">Lado</th>
                <th className="py-1 font-normal">Entrada → salida</th>
                <th className="py-1 text-right font-normal">Precios</th>
                <th className="py-1 text-right font-normal">Costos (com. + desl. + funding)</th>
                <th className="py-1 text-right font-normal">Resultado</th>
                <th className="py-1 font-normal">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {ops.slice(-50).reverse().map((o) => (
                <tr key={o.id} className="border-t border-borde-suave">
                  <td className="py-1 text-plata-200">{nombre(o.botId)} <span className="text-plata-500">{o.simbolo}</span></td>
                  <td className="py-1 text-plata-200">{o.lado > 0 ? 'Largo' : 'Corto'}</td>
                  <td className="py-1 text-plata-400">{hora(o.entradaT)} → {hora(o.salidaT)}</td>
                  <td className="cifra py-1 text-right text-plata-300">{num(o.precioEntrada, 2)} → {num(o.precioSalida, 2)}</td>
                  <td className="cifra py-1 text-right text-plata-400">{num(o.comisiones, 2)} + {num(o.deslizamientoUsd, 2)} + {num(o.funding, 2)}</td>
                  <td className="cifra py-1 text-right text-white">{usd(o.pnl)} · {pct(o.retorno)}</td>
                  <td className="py-1 text-plata-400">{MOTIVO[o.motivo] ?? o.motivo}{o.gestion ? ` · ${o.gestion.r >= 0 ? '+' : ''}${num(o.gestion.r, 2)}R` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-3 text-center text-xs text-plata-500">Aún no hay operaciones cerradas.</p>
        )}
      </Panel>
  );
}

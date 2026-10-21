// Página «Resultados del Juez» del Laboratorio: cada prueba guardada como paper, con su panel completo. Datos reales.
import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { leerPapers } from '@/motores/papers/paper';
import { Badge } from '@/components/ui/shadcn/badge';
import { TooltipProvider } from '@/components/ui/shadcn/tooltip';
import PanelJuez from './PanelJuez';

const corta = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function ResultadosJuez({ inicial, version }: { inicial?: string | null; version?: number }) {
  const papers = useMemo(() => {
    void version;
    return leerPapers().sort((a, b) => b.creado - a.creado);
  }, [version]);
  const [id, setId] = useState<string | null>(inicial ?? null);
  const p = papers.find((x) => x.id === id) ?? papers[0] ?? null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4 rounded-2xl bg-black p-1 text-zinc-100" data-resultados-juez>
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Laboratorio · datos reales</p>
            <h2 className="mt-1 text-lg font-medium tracking-tight text-zinc-50">Resultados del Juez</h2>
            <p className="mt-1 max-w-2xl text-[12px] text-zinc-500">Backtest, Walk-Forward, Monte Carlo y el luck test validan: nunca predicen. Ningún modelo puede cambiar las reglas del Juez.</p>
          </div>
          <Badge variant="tenue">
            <Lock className="h-3 w-3" /> Reglas bloqueadas
          </Badge>
        </div>

        {!p ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500" data-sin-resultados>
            Todavía no hay pruebas del Juez. Ve a «Mis estrategias (Python)», elige o escribe una estrategia y pulsa «Probar con el Juez»: el resultado aparecerá aquí.
          </div>
        ) : (
          <PanelJuez
            key={p.id}
            r={p.respuesta}
            nombre={p.estrategia}
            selector={
              <select
                value={p.id}
                onChange={(e) => setId(e.target.value)}
                className="max-w-[300px] rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-zinc-600"
                aria-label="Prueba a analizar"
                data-selector-resultado
              >
                {papers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.estrategia} · {x.simbolo} · {x.respuesta.resultado.veredicto} · {corta(x.creado)}
                  </option>
                ))}
              </select>
            }
          />
        )}
      </div>
    </TooltipProvider>
  );
}

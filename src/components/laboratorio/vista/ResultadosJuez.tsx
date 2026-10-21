// Pestaña «Resultados del Juez» del Laboratorio: el diseño de la antigua pantalla de ejemplos, ahora con los
// resultados REALES de tus estrategias (cada prueba del Juez queda guardada como paper). Nada simulado.
import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Insignia from '@/components/ui/Insignia';
import Panel from '@/components/ui/Panel';
import { leerPapers } from '@/motores/papers/paper';
import { leerEstrategias } from '../plantillas';
import ResultadoJuezVista from '../ResultadoJuez';

const corta = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function ResultadosJuez({ inicial, version }: { inicial?: string | null; version?: number }) {
  const papers = useMemo(() => {
    void version;
    return leerPapers().sort((a, b) => b.creado - a.creado);
  }, [version]);
  const estrategias = useMemo(() => leerEstrategias().length, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [id, setId] = useState<string | null>(inicial ?? null);
  const p = papers.find((x) => x.id === id) ?? papers[0] ?? null;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Laboratorio"
        titulo="Resultados del Juez"
        fuente="DATOS REALES"
        descripcion="Los resultados reales de tus estrategias, prueba por prueba. Backtest, Walk-Forward, Monte Carlo y el luck test validan: nunca predicen. Las reglas del Juez están bloqueadas y ningún modelo puede modificarlas."
      >
        <Insignia variante="contorno">
          <Lock size={10} /> Reglas del Juez bloqueadas
        </Insignia>
      </Encabezado>

      {!p ? (
        <Panel cuerpo="p-4">
          <p className="text-xs text-plata-300" data-sin-resultados>
            Todavía no hay pruebas del Juez. Ve a «Mis estrategias (Python)», elige o escribe una estrategia y pulsa «Probar con el Juez»: el resultado aparecerá aquí con todas sus pestañas.
          </p>
        </Panel>
      ) : (
        <ResultadoJuezVista
          key={p.id}
          r={p.respuesta}
          contexto={{ nombre: p.estrategia, estrategias, papers: papers.length }}
          selector={
            <select
              value={p.id}
              onChange={(e) => setId(e.target.value)}
              className="max-w-[300px] rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400"
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
  );
}

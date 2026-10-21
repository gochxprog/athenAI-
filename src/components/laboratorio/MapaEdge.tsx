// «Dónde funciona cada estrategia»: el veredicto del Juez por estrategia y por mercado (market_id).
// Cada mercado se juzga con sus propios datos; una aprobación en BTC no dice nada de XAU.
import { Grid3x3 } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { juiciosDe, type EstrategiaGuardada } from './plantillas';
import { claveFuente, type FuenteGuardada } from './fuentesGuardadas';

const SIGNO: Record<string, string> = {
  APROBADA: '●',
  'APROBADA CON RESERVA': '◐',
  RECHAZADA: '○',
  'DATOS INSUFICIENTES': '·',
};
const TEXTO: Record<string, string> = {
  APROBADA: 'Aprobada',
  'APROBADA CON RESERVA': 'Con reserva',
  RECHAZADA: 'Rechazada',
  'DATOS INSUFICIENTES': 'Faltan datos',
};

export default function MapaEdge({ estrategias, fuentes }: { estrategias: EstrategiaGuardada[]; fuentes: FuenteGuardada[] }) {
  const juicios = estrategias.map((e) => ({ e, js: juiciosDe(e) }));
  // Columnas: los mercados grabados y cualquier otro en el que ya se haya juzgado algo.
  const mercados = [...new Set([...fuentes.map(claveFuente), ...juicios.flatMap(({ js }) => js.map((j) => j.mercado))])];
  if (!mercados.length) return null;
  return (
    <Panel titulo="Dónde funciona cada estrategia" icono={Grid3x3} cuerpo="space-y-2 p-4">
      <p className="text-[11px] text-plata-400">Veredicto del Juez en cada mercado. Cada mercado se prueba con sus propios datos: que funcione en uno no dice nada de otro. Un bot solo puede operar donde su estrategia fue aprobada.</p>
      <div className="overflow-x-auto" data-mapa-edge>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-plata-500">
              <th className="py-1 pr-3 font-normal">Estrategia</th>
              {mercados.map((m) => (
                <th key={m} className="px-2 py-1 font-mono font-normal">
                  {m.split(':')[1]}
                  <span className="block text-[9px] text-plata-600">{m.split(':')[0]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {juicios.map(({ e, js }) => (
              <tr key={e.id} className="border-t border-borde">
                <td className="py-1.5 pr-3 text-plata-100">{e.nombre}</td>
                {mercados.map((m) => {
                  const j = js.find((x) => x.mercado === m);
                  return (
                    <td key={m} className="px-2 py-1.5" data-celda={`${e.id}|${m}`} data-veredicto={j?.veredicto ?? ''}>
                      {j ? (
                        <span className={j.veredicto.startsWith('APROBADA') ? 'text-white' : 'text-plata-400'} title={new Date(j.fecha).toLocaleString('es-ES')}>
                          {SIGNO[j.veredicto] ?? '·'} {TEXTO[j.veredicto] ?? j.veredicto}
                          <span className="block text-[9px] text-plata-600">{new Date(j.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
                        </span>
                      ) : (
                        <span className="text-plata-600">— sin probar</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

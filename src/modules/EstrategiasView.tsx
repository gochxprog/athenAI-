import { useEffect, useMemo, useState } from 'react';
import { Library } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { leerEstrategias } from '@/components/laboratorio/plantillas';
import { Linea } from '@/components/laboratorio/graficos';
import { VisorPaper } from '@/components/laboratorio/BibliotecaPapers';
import { leerPapers, type Paper } from '@/motores/papers/paper';
import { useNavegar } from '@/hooks/Navegacion';
import { conSigno, num } from '@/lib/format';

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : conSigno(v * 100, 1, '%'));
const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

/** Catálogo real: tus estrategias del Laboratorio con el resultado de su última prueba del Juez. */
export default function EstrategiasView() {
  const navegar = useNavegar();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setVersion((v) => v + 1), 5_000);
    return () => clearInterval(id);
  }, []);
  const filas = useMemo(() => {
    void version;
    const papers = leerPapers();
    return leerEstrategias()
      .map((e) => ({ e, p: papers.filter((x) => x.estrategia === e.nombre).sort((a, b) => b.creado - a.creado)[0] as Paper | undefined }))
      .sort((a, b) => (b.p?.creado ?? b.e.actualizada) - (a.p?.creado ?? a.e.actualizada));
  }, [version]);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = filas.find((x) => x.e.id === selId) ?? filas[0];
  const [viendo, setViendo] = useState<Paper | null>(null);
  const cuenta = (v: string) => filas.filter((x) => x.e.ultimoVeredicto === v).length;

  return (
    <div className="space-y-4">
      <Encabezado modulo="Estrategias" titulo="Catálogo de estrategias" descripcion="Tus estrategias del Laboratorio con el veredicto de su última prueba del Juez. Las aprobadas para Paper Trading son las candidatas a bot." />
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Estrategias', filas.length],
          ['Aprobadas para Paper', cuenta('APROBADA')],
          ['Con reserva', cuenta('APROBADA CON RESERVA')],
          ['Rechazadas', cuenta('RECHAZADA')],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-borde-suave p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-plata-500">{k}</p>
            <p className="cifra text-xl font-light text-white">{num(v as number)}</p>
          </div>
        ))}
      </div>
      <Panel titulo="Estrategias" icono={Library} cuerpo="overflow-x-auto px-4 py-2">
        <table className="w-full min-w-[760px] text-left text-xs" data-catalogo>
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
              <th className="py-1.5 font-normal">Estrategia</th>
              <th className="py-1.5 font-normal">Veredicto</th>
              <th className="py-1.5 font-normal">Mercado</th>
              <th className="py-1.5 text-right font-normal">Nota</th>
              <th className="py-1.5 text-right font-normal">Retorno fuera de muestra</th>
              <th className="py-1.5 text-right font-normal">Sharpe</th>
              <th className="py-1.5 text-right font-normal">Caída máx.</th>
              <th className="py-1.5 font-normal">Probada</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ e, p }) => {
              const j = p?.respuesta.resultado;
              return (
                <tr key={e.id} onClick={() => setSelId(e.id)} className={`cursor-pointer border-t border-borde-suave ${sel?.e.id === e.id ? 'bg-white/[0.04]' : ''}`}>
                  <td className="py-2 text-plata-100">{e.nombre}</td>
                  <td className="py-2 text-white">{e.ultimoVeredicto ?? 'sin probar'}</td>
                  <td className="py-2 text-plata-300">{p ? `${p.simbolo} · ${p.proveedor}` : '—'}</td>
                  <td className="cifra py-2 text-right text-plata-200">{j?.score ? num(j.score.total, 0) : '—'}</td>
                  <td className="cifra py-2 text-right text-white">{pct(j?.oos.retornoTotal)}</td>
                  <td className="cifra py-2 text-right text-plata-300">{j?.oos.sharpe == null ? '—' : num(j.oos.sharpe, 2)}</td>
                  <td className="cifra py-2 text-right text-plata-300">{j ? pct(-j.oos.maxDrawdown) : '—'}</td>
                  <td className="py-2 text-plata-500">{p ? fecha(p.creado) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filas.length && <p className="py-4 text-center text-xs text-plata-500">Aún no hay estrategias. Créalas en el Laboratorio.</p>}
      </Panel>
      {sel && (
        <Panel titulo={`Detalle · ${sel.e.nombre}`} cuerpo="space-y-3 p-4">
          {sel.p ? (
            <>
              <p className="text-sm text-plata-100">{sel.p.respuesta.resultado.resumen}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Capital fuera de muestra (lo que no vio al elegir sus parámetros)</p>
              <Linea datos={sel.p.respuesta.resultado.equityOos} base={1} />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setViendo(sel.p!)} className="rounded-md border border-borde px-3 py-1.5 text-[11px] text-plata-200 hover:text-white">
                  Ver paper completo
                </button>
                <button onClick={() => navegar('laboratorio')} className="rounded-md border border-borde px-3 py-1.5 text-[11px] text-plata-200 hover:text-white">
                  Abrir en el Laboratorio
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-plata-400">Esta estrategia aún no ha pasado por el Juez. Pruébala en el Laboratorio.</p>
          )}
        </Panel>
      )}
      <VisorPaper p={viendo} alCerrar={() => setViendo(null)} />
    </div>
  );
}

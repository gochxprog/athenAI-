import { useEffect, useMemo, useState } from 'react';
import { Gavel } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { useFeeds } from '@/components/orderflow/OrderFlowChart';
import { leerPapers } from '@/motores/papers/paper';
import { notificador } from '@/motores/notificaciones/notificador';
import { num } from '@/lib/format';

type Fila = { t: number; tipo: 'Juez' | 'Aviso' | 'Datos'; texto: string; resultado: string };

/** Bitácora real: veredictos del Juez, avisos enviados y eventos del motor de datos. */
export default function DecisionesView() {
  const { registro } = useFeeds();
  const [version, setVersion] = useState(0);
  useEffect(() => notificador.suscribir(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    const id = setInterval(() => setVersion((v) => v + 1), 5_000);
    return () => clearInterval(id);
  }, []);
  const filas = useMemo<Fila[]>(() => {
    void version;
    const juez: Fila[] = leerPapers().map((p) => ({ t: p.creado, tipo: 'Juez', texto: `«${p.estrategia}» · ${p.simbolo} · ${p.respuesta.resultado.resumen}`, resultado: p.respuesta.resultado.veredicto }));
    const avisos: Fila[] = notificador.historial.map((h) => ({ t: h.t, tipo: 'Aviso', texto: `${h.aviso.titulo} · ${h.canal ?? 'sin canal'}`, resultado: h.ok ? 'enviado' : h.detalle }));
    const datos: Fila[] = registro.slice(0, 60).map((e) => ({ t: e.t, tipo: 'Datos', texto: e.texto, resultado: '' }));
    return [...juez, ...avisos, ...datos].sort((a, b) => b.t - a.t);
  }, [version, registro]);
  const [filtro, setFiltro] = useState<'Todo' | Fila['tipo']>('Todo');
  const vistas = filas.filter((f) => filtro === 'Todo' || f.tipo === filtro);
  const cuenta = (t: Fila['tipo']) => filas.filter((f) => f.tipo === t).length;

  return (
    <div className="space-y-4">
      <Encabezado modulo="Decisiones" titulo="Bitácora de decisiones" descripcion="Todo lo que se decide queda registrado: cada veredicto del Juez (con su motivo), cada aviso enviado y los eventos del motor de datos. Las decisiones de los bots se sumarán cuando exista el motor de Paper Trading." />
      <div className="flex flex-wrap gap-1 rounded-xl border border-borde p-1 w-fit">
        {(['Todo', 'Juez', 'Aviso', 'Datos'] as const).map((t) => (
          <button key={t} onClick={() => setFiltro(t)} className={`rounded-lg px-3 py-1.5 text-xs ${filtro === t ? 'bg-white text-black' : 'text-plata-300 hover:text-white'}`}>
            {t} {t !== 'Todo' && <span className="cifra opacity-60">{num(cuenta(t))}</span>}
          </button>
        ))}
      </div>
      <Panel titulo="Registro" icono={Gavel} cuerpo="overflow-x-auto px-4 py-2">
        <table className="w-full min-w-[640px] text-left text-xs" data-bitacora>
          <tbody>
            {vistas.slice(0, 300).map((f, i) => (
              <tr key={`${f.t}-${i}`} className="border-t border-borde-suave">
                <td className="w-36 py-1.5 text-plata-500">{new Date(f.t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                <td className="w-16 py-1.5 text-[10px] uppercase tracking-[0.1em] text-plata-400">{f.tipo}</td>
                <td className="py-1.5 text-plata-100">{f.texto}</td>
                <td className="py-1.5 text-right text-white">{f.resultado}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!vistas.length && <p className="py-4 text-center text-xs text-plata-500">Todavía no hay decisiones registradas.</p>}
      </Panel>
    </div>
  );
}

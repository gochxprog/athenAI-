import { useReloj } from '@/hooks/SistemaDemo';
import { fechaLarga, hora } from '@/lib/format';
import Punto from '@/components/ui/Punto';
import Insignia from '@/components/ui/Insignia';
import { NOMBRE_PROVEEDOR, useFeeds } from '@/components/orderflow/OrderFlowChart';
import { useNavegar } from '@/hooks/Navegacion';
import { useCalendario } from '@/hooks/useCalendario';

export default function Topbar({ titulo, seccion }: { titulo: string; seccion: string }) {
  const ahora = useReloj();
  const { feeds } = useFeeds();
  const navegar = useNavegar();
  // Estado REAL de la fuente del Centro de datos (no de la simulación).
  const total = feeds.feeds.length;
  const vivos = feeds.feeds.filter((f) => f.conexion === 'en-vivo').length;
  const conError = feeds.feeds.some((f) => f.conexion === 'error');
  const detenido = !total || feeds.feeds.every((f) => f.conexion === 'detenido');
  const texto = detenido ? 'Sin conexión' : vivos === total ? 'En vivo' : vivos > 0 ? `En vivo ${vivos}/${total}` : conError ? 'Error de conexión' : 'Conectando';
  const { enCurso } = useCalendario();
  const distintos = feeds.feeds.filter((f) => f.memoria?.memoria?.distinto.aviso).map((f) => f.simbolo);
  const fuente = feeds.proveedores.map((p) => NOMBRE_PROVEEDOR[p]).join(' + ');

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-borde-suave bg-black/85 pl-16 pr-4 backdrop-blur-xl md:px-6">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium tracking-[0.08em] text-white">
          QUANT-AGENTIC <span className="text-plata-500">v4.1 PRO</span>
        </p>
        <p className="truncate text-[11px] text-plata-500">
          {seccion} <span className="text-plata-600">/</span> <span className="text-plata-300">{titulo}</span>
        </p>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        <div className="hidden text-right sm:block">
          <p className="text-[10px] uppercase tracking-etiqueta text-plata-500">{fechaLarga(ahora)}</p>
          <p className="cifra text-sm text-white">{hora(ahora)}</p>
        </div>
        <div className="hidden h-8 w-px bg-borde sm:block" />
        {enCurso && (
          <span className="hidden rounded-full border border-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-etiqueta text-white md:block" title="Ventana de no operar del calendario de eventos">
            {enCurso.nombre} · no operar
          </span>
        )}
        {distintos.length > 0 && (
          <button onClick={() => navegar('orderflow')} className="hidden rounded-full border border-white bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-etiqueta text-black md:block" title="La data de ahora no se parece a nada de lo grabado">
            Hoy es distinto · {distintos.join(', ')}
          </button>
        )}
        <button
          onClick={() => navegar('datos')}
          title={feeds.feeds.map((f) => `${f.simbolo}: ${f.conexion}${f.detalle ? ` · ${f.detalle}` : ''}`).join('\n') || 'Abrir el Centro de datos'}
          data-estado-fuente
          className="flex items-center gap-2 rounded-full border border-borde px-3 py-1.5 hover:border-plata-400"
        >
          <Punto estado={vivos > 0 ? 'activo' : detenido || conError ? 'detenido' : 'espera'} />
          <span className="text-[10px] font-medium uppercase tracking-etiqueta text-plata-200">
            {fuente && <span className="hidden text-plata-400 lg:inline">{fuente} · </span>}
            {texto}
          </span>
        </button>
        <Insignia variante="tenue" className="hidden md:inline-flex">DEMO</Insignia>
      </div>
    </header>
  );
}

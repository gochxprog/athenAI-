import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Eye, FileText, Printer, Send, Trash2, X } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { borrarPaper, leerPapers, nombreArchivo, paperHtml, type Paper } from '@/motores/papers/paper';
import { notificador } from '@/motores/notificaciones/notificador';

const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

export function descargarPaper(p: Paper): void {
  const url = URL.createObjectURL(new Blob([paperHtml(p)], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo(p);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Imprimir / guardar como PDF: el paper se carga en un marco oculto y se abre el diálogo de impresión. */
export function imprimirPaper(p: Paper): void {
  const marco = document.createElement('iframe');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  marco.srcdoc = paperHtml(p);
  marco.onload = () => {
    marco.contentWindow?.focus();
    marco.contentWindow?.print();
    setTimeout(() => marco.remove(), 60_000);
  };
  document.body.appendChild(marco);
}

export async function enviarPaper(p: Paper): Promise<string> {
  const r = await notificador.enviarArchivo(nombreArchivo(p), paperHtml(p), `📄 Paper «${p.estrategia}» · ${p.simbolo} · ${p.respuesta.resultado.veredicto}\n${p.respuesta.resultado.resumen}`);
  return r.map((x) => `${x.canal ?? 'sin canal'}: ${x.ok ? 'enviado' : x.detalle}`).join(' · ');
}

/** Acciones de un paper (ver, descargar, PDF, enviar). */
export function AccionesPaper({ p, alVer }: { p: Paper; alVer: (p: Paper) => void }) {
  const [estado, setEstado] = useState<string | null>(null);
  const boton = 'flex items-center gap-1 rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:border-plata-400 hover:text-white disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={boton} onClick={() => alVer(p)} aria-label="Ver paper">
        <Eye size={11} /> Ver
      </button>
      <button className={boton} onClick={() => descargarPaper(p)} aria-label="Descargar paper">
        <Download size={11} /> Descargar
      </button>
      <button className={boton} onClick={() => imprimirPaper(p)} aria-label="Imprimir o guardar en PDF">
        <Printer size={11} /> PDF
      </button>
      <button
        className={boton}
        disabled={estado === 'Enviando…'}
        aria-label="Enviar paper"
        onClick={async () => {
          setEstado('Enviando…');
          setEstado(await enviarPaper(p));
        }}
      >
        <Send size={11} /> Enviar
      </button>
      {estado && <span className="text-[10px] text-plata-400" data-envio-paper>{estado}</span>}
    </div>
  );
}

/** Visor a pantalla completa del paper. */
export function VisorPaper({ p, alCerrar }: { p: Paper | null; alCerrar: () => void }) {
  useEffect(() => {
    if (!p) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [p, alCerrar]);
  if (!p) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/85 p-3 backdrop-blur sm:p-6" role="dialog" aria-label={`Paper ${p.estrategia}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="mr-auto truncate text-sm text-white">{p.estrategia}</p>
        <AccionesPaper p={p} alVer={() => undefined} />
        <button onClick={alCerrar} className="rounded-md border border-borde p-1.5 text-plata-200 hover:text-white" aria-label="Cerrar paper">
          <X size={14} />
        </button>
      </div>
      <iframe title={`Paper ${p.estrategia}`} srcDoc={paperHtml(p)} className="flex-1 rounded-lg bg-white" data-visor-paper />
    </div>,
    document.body,
  );
}

/** Biblioteca: todos los papers generados por el Juez en este navegador. */
export default function BibliotecaPapers({ version }: { version: number }) {
  const [papers, setPapers] = useState<Paper[]>(leerPapers);
  const [viendo, setViendo] = useState<Paper | null>(null);
  useEffect(() => setPapers(leerPapers()), [version]);
  return (
    <Panel titulo="Papers" icono={FileText} accion={<span className="text-[10px] text-plata-500">uno por cada prueba del Juez · se guardan en este navegador (últimos 50)</span>} cuerpo="px-4 py-2" >
      {!papers.length && <p className="py-4 text-center text-xs text-plata-500">Todavía no hay papers. Prueba una estrategia con el Juez y aparecerá aquí.</p>}
      <div className="divide-y divide-borde-suave" data-biblioteca-papers>
        {papers.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-white">{p.estrategia}</p>
              <p className="text-[10.5px] text-plata-500">
                {p.simbolo} · {fecha(p.creado)} · <span className="text-plata-200">{p.respuesta.resultado.veredicto}</span> · fuera de muestra {(p.respuesta.resultado.oos.retornoTotal * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %
              </p>
            </div>
            <AccionesPaper p={p} alVer={setViendo} />
            <button onClick={() => setPapers(borrarPaper(p.id))} className="text-plata-500 hover:text-white" aria-label="Borrar paper">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <VisorPaper p={viendo} alCerrar={() => setViendo(null)} />
    </Panel>
  );
}

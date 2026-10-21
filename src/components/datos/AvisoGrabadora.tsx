// Aviso global: la plataforma se abrió desde la grabadora del VPS (misma dirección) y este navegador aún no tiene la
// clave. Se pide UNA vez; luego se descarga sola lo grabado y el gráfico, la Memoria y el Laboratorio lo usan.
import { useEffect, useState } from 'react';
import { HardDrive, X } from 'lucide-react';
import { grabadora } from '@/motores/grabadora/cliente';

export default function AvisoGrabadora() {
  const [, setN] = useState(0);
  useEffect(() => grabadora.suscribir(() => setN((x) => x + 1)), []);
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [probando, setProbando] = useState(false);
  const [cerrado, setCerrado] = useState(false);
  const url = grabadora.estado.detectada;
  if (!url || grabadora.estado.config || cerrado) return null;

  const conectar = async () => {
    setProbando(true);
    setError(null);
    try {
      await grabadora.probar({ url, clave });
      grabadora.guardarConfig({ url, clave });
      await grabadora.sincronizar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbando(false);
    }
  };

  return (
    <div className="border-b border-borde bg-[#0b0b0d] px-4 py-2.5 text-[11.5px] text-plata-200 md:px-6" data-aviso-grabadora>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void conectar();
        }}
      >
        <HardDrive size={14} className="text-white" />
        <span className="min-w-0 flex-1">Estás en tu VPS. Escribe la clave de la grabadora (una sola vez) para cargar todo lo grabado: velas, Memoria y Laboratorio.</span>
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="Clave de la grabadora" aria-label="Clave de la grabadora" autoComplete="current-password" className="w-44 rounded-md border border-borde bg-black px-2 py-1 font-mono text-[11px] text-plata-100" />
        <button type="submit" disabled={!clave || probando} className="rounded-md bg-white px-3 py-1 text-[11px] font-medium text-black disabled:opacity-40">
          {probando ? 'Conectando…' : 'Conectar'}
        </button>
        <button type="button" onClick={() => setCerrado(true)} aria-label="Cerrar aviso" className="text-plata-500 hover:text-white">
          <X size={14} />
        </button>
      </form>
      {error && <p className="mt-1 text-white">{error} La clave está en el VPS: sudo cat /var/lib/athenai-grabadora/clave.txt</p>}
    </div>
  );
}

import { useState } from 'react';
import { Lock } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Etiquetador from '@/components/laboratorio/Etiquetador';
import EstrategiasPython from '@/components/laboratorio/EstrategiasPython';
import Insignia from '@/components/ui/Insignia';

export default function LaboratorioView() {
  const [modo, setModo] = useState<'python' | 'etiquetador'>('python');
  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-xl border border-borde p-1" role="tablist" aria-label="Modo del laboratorio">
        {(
          [
            ['python', 'Mis estrategias y el Juez'],
            ['etiquetador', 'Etiquetador'],
          ] as const
        ).map(([m, t]) => (
          <button key={m} role="tab" aria-selected={modo === m} onClick={() => setModo(m)} className={`rounded-lg px-3.5 py-2 text-xs ${modo === m ? 'bg-white text-black' : 'text-plata-300 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>
      {modo === 'python' ? (
        <>
          <Encabezado
            modulo="Laboratorio"
            titulo="Tus estrategias y el Juez"
            fuente="DATOS REALES"
            descripcion="Escribe una estrategia en Python sobre tus Features guardadas. El Juez la prueba con sus 10 motores (Backtest, Métricas, Walk-Forward, Monte Carlo, Luck test, Robustez, Deflated Sharpe, PBO, Anti-futuro y Veredicto) y te da el veredicto con todas las métricas."
          >
            <Insignia variante="contorno">
              <Lock size={10} /> Reglas del Juez bloqueadas
            </Insignia>
          </Encabezado>
          <EstrategiasPython />
        </>
      ) : (
        <>
          <Encabezado
            modulo="Laboratorio"
            titulo="Etiquetador"
            fuente="DATOS REALES"
            descripcion="Convierte tu historia grabada en ejemplos para que la máquina aprenda: en cada movimiento relevante (CUSUM), qué barrera tocó primero (ganancia, pérdida o tiempo) y la meta-etiqueta de operar o no."
          />
          <Etiquetador />
        </>
      )}
    </div>
  );
}

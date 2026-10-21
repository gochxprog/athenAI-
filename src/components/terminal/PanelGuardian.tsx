// Guardián de la Terminal: reglas, bitácora y cómo se calcula. Movido desde Paper Trading.
import { ShieldAlert } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { num } from '@/lib/format';
import { hora, useMotorPaper } from './comun';

export default function PanelGuardian() {
  const motor = useMotorPaper();
  return (
      <Panel titulo="Guardián" icono={ShieldAlert} cuerpo="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="etiqueta">Caída máxima del día (%)</span>
            <input type="number" min={0.5} step={0.5} value={motor.reglas.ddDiarioMax * 100} onChange={(e) => motor.setReglas({ ddDiarioMax: Math.max(0.005, Number(e.target.value) / 100) })} aria-label="Caída máxima del día" className="mt-1 w-20 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
          <label className="block">
            <span className="etiqueta">Pérdidas seguidas → cuarentena</span>
            <input type="number" min={1} step={1} value={motor.reglas.perdidasSeguidasMax} onChange={(e) => motor.setReglas({ perdidasSeguidasMax: Math.max(1, Math.round(Number(e.target.value))) })} aria-label="Pérdidas seguidas" className="mt-1 w-20 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-borde-suave p-2 font-mono text-[10.5px]" data-bitacora>
          {motor.bitacora.length ? (
            motor.bitacora.slice(0, 60).map((x, i) => (
              <p key={`${x.t}-${i}`} className={x.grave ? 'text-white' : 'text-plata-400'}>
                {hora(x.t)} · {x.nombre}: {x.texto}
              </p>
            ))
          ) : (
            <p className="text-plata-500">Sin novedades. Aquí aparece cada entrada, salida y cada vez que el Guardián actúa (también se envía a Discord / Telegram / ntfy si los configuraste en Datos).</p>
          )}
        </div>
        <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
          <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Señal: al cerrar cada barra se calcula la posición de la estrategia con la variante que eligió el Juez. El bot solo actúa cuando la señal cambia (no se sube a una posición ya empezada).</li>
            <li>Compra = ask × (1 + d) y venta = bid × (1 − d). d = deslizamiento base + 10 % del ATR relativo + (tamaño de la orden ÷ liquidez de 10 niveles) × distancia del 10.º nivel, con tope de 0,5 %.</li>
            <li>Tamaño = capital × exposición. Comisión taker en la entrada y en la salida. Funding a las 00, 08 y 16 UTC: lado × cantidad × precio × tasa (con tasa positiva el largo paga y el corto cobra).</li>
            <li>Resultado = lado × cantidad × (salida − entrada) − comisiones − funding. Retorno = resultado ÷ capital antes de entrar.</li>
            <li>Banda del Juez: se toman al azar k operaciones del Juez (con reemplazo), se encadenan, 2.000 veces, y se miran el P5, P50 y P95. Si el bot va por debajo del P5 tras ≥ {motor.reglas.minOperacionesBanda} operaciones, el Guardián lo pausa.</li>
            <li>Guardián: caída del día ≥ {num(motor.reglas.ddDiarioMax * 100, 1)} % desde el máximo del día (UTC) → cierra y pausa hasta mañana. {motor.reglas.perdidasSeguidasMax} pérdidas seguidas → cuarentena. Sin datos en vivo → no opera, y una posición abierta se cierra al volver. Exposición máxima: APROBADA 1×, con reserva 0,5×.</li>
            <li>Apagado de emergencia: cierra todas las posiciones al precio de ese momento y apaga todos los bots.</li>
          </ul>
        </details>
      </Panel>
  );
}

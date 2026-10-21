import { useEffect, useState } from 'react';
import { Download, Play, Tag } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { senalesLaboratorio } from '@/motores/laboratorio/laboratorioCliente';
import { ETIQUETADOR_POR_DEFECTO, type ResultadoEtiquetador } from '@/motores/etiquetador/etiquetador';
import { claveFuente, useFuentesGuardadas } from './fuentesGuardadas';
import { Explicacion, Histograma } from './graficos';
import { NOMBRE_PROVEEDOR } from '@/components/orderflow/OrderFlowChart';
import { conSigno, num } from '@/lib/format';

const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const pct = (v: number, d = 2) => conSigno(v * 100, d, '%');

function descargar(csv: string, nombre: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Motor Etiquetador: triple barrera + filtro CUSUM + meta-etiquetado sobre las Features grabadas. */
export default function Etiquetador() {
  const fuentes = useFuentesGuardadas();
  const [datos, setDatos] = useState('');
  const [c, setC] = useState({ ...ETIQUETADOR_POR_DEFECTO });
  const [corriendo, setCorriendo] = useState(false);
  const [r, setR] = useState<{ resultado: ResultadoEtiquetador; csv: string; simbolo: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (fuentes[0]) setDatos((d) => d || claveFuente(fuentes[0]));
  }, [fuentes]);

  const ejecutar = async () => {
    const f = fuentes.find((x) => claveFuente(x) === datos);
    if (!f) return;
    setCorriendo(true);
    setError(null);
    // Worker propio de las tareas de fondo: no se cruza con una prueba del Juez en curso.
    const m = await senalesLaboratorio.etiquetar({ proveedor: f.proveedor, simbolo: f.simbolo, config: c });
    setCorriendo(false);
    if (!m.resultado) setError(m.error ?? 'No se pudo etiquetar');
    else setR({ resultado: m.resultado, csv: m.csv, simbolo: f.simbolo });
  };

  const res = r?.resultado;
  const total = res?.etiquetas.length ?? 0;
  const campo = (k: keyof typeof c, etiqueta: string, paso: number) => (
    <label className="block" key={k}>
      <span className="etiqueta">{etiqueta}</span>
      <input type="number" min={0} step={paso} value={c[k]} onChange={(e) => setC((x) => ({ ...x, [k]: Number(e.target.value) }))} aria-label={etiqueta} className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
    </label>
  );

  return (
    <div className="space-y-4" data-etiquetador>
      <Panel titulo="Motor Etiquetador · triple barrera, CUSUM y meta-etiquetado" icono={Tag} cuerpo="space-y-4 p-4">
        <Explicacion
          que="mira tu historia grabada y, en cada momento en que el mercado se movió de verdad (filtro CUSUM), anota qué pasó después: tocó primero la ganancia (+1), la pérdida (−1) o se acabó el tiempo (0)."
          sirve="es el «libro de respuestas» con el que la máquina aprenderá a encontrar estrategias sola: qué datos aparecen justo antes de un +1 o de un −1."
          mirar="que haya bastantes eventos (cientos o más) y una mezcla de +1, −1 y 0. Si casi todo es 0, las barreras están muy lejos o el tiempo es corto."
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="etiqueta">Datos</span>
            <select value={datos} onChange={(e) => setDatos(e.target.value)} aria-label="Datos para etiquetar" className="mt-1 block rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
              {fuentes.map((f) => (
                <option key={claveFuente(f)} value={claveFuente(f)}>
                  {f.simbolo} · {NOMBRE_PROVEEDOR[f.proveedor]} · {num(f.filas)} barras
                </option>
              ))}
            </select>
          </label>
          {campo('pt', 'Take profit (× σ)', 0.5)}
          {campo('sl', 'Stop loss (× σ)', 0.5)}
          {campo('tMax', 'Tiempo máx. (barras)', 5)}
          {campo('cusumMult', 'Umbral CUSUM (× σ)', 0.5)}
          {campo('span', 'Lapso de σ (barras)', 10)}
          <button onClick={ejecutar} disabled={corriendo || !datos} className="flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black disabled:opacity-40">
            <Play size={13} /> {corriendo ? 'Etiquetando…' : 'Etiquetar'}
          </button>
        </div>
        {!fuentes.length && <p className="text-xs text-plata-400">No hay datos guardados todavía. Deja grabando un mercado en el Centro de datos.</p>}
        {error && <p className="text-xs text-white" data-error>{error}</p>}
      </Panel>

      {res && (
        <Panel titulo={`Resultado · ${r!.simbolo}`} accion={<span className="text-[10px] text-plata-500">{num(res.barras)} barras · {num(total)} eventos</span>} cuerpo="space-y-4 p-4">
          {!res.conHighLow && <p className="text-[11.5px] text-plata-200">⚠ Estas barras se grabaron antes de guardar el máximo y el mínimo: se usa el cierre para ver si se toca una barrera (algunos toques dentro de la barra no se ven).</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-etiquetas={total}>
            {[
              ['+1 · ganancia', res.resumen.positivas],
              ['−1 · pérdida', res.resumen.negativas],
              ['0 · tiempo', res.resumen.neutras],
              ['Meta = 1 (operar)', res.resumen.positivas],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg border border-borde-suave p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-plata-500">{k}</p>
                <p className="cifra text-xl font-light text-white">{num(v as number)}</p>
                <p className="text-[10.5px] text-plata-400">{total ? `${num(((v as number) / total) * 100, 1)} % de los eventos` : '—'}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-plata-400">
            {num(res.resumen.largos)} eventos al alza y {num(res.resumen.cortos)} a la baja · duración media {num(res.resumen.duracionMedia, 1)} barras · descartados: {num(res.descartadosHueco)} por cruzar un hueco y {num(res.sinFuturo)} sin futuro suficiente.
          </p>
          {total > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Retorno de cada evento hasta su salida (en la dirección del evento)</p>
              <Histograma valores={res.etiquetas.map((e) => e.retorno)} marcas={[{ v: 0, etiqueta: '0', fuerte: true }]} />
            </div>
          )}
          {total > 0 && (
            <div className="overflow-x-auto">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Últimos 30 eventos</p>
                <button onClick={() => descargar(r!.csv, `etiquetas-${r!.simbolo}.csv`)} className="flex items-center gap-1 rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:text-white">
                  <Download size={11} /> Dataset CSV ({num(total)} filas con sus Features)
                </button>
              </div>
              <table className="w-full min-w-[720px] text-left text-[11px]">
                <thead>
                  <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                    <th className="py-1 font-normal">Evento</th>
                    <th className="py-1 font-normal">Lado</th>
                    <th className="py-1 text-right font-normal">Precio</th>
                    <th className="py-1 text-right font-normal">Barreras (TP / SL)</th>
                    <th className="py-1 font-normal">Tocó</th>
                    <th className="py-1 text-right font-normal">Barras</th>
                    <th className="py-1 text-right font-normal">Retorno</th>
                    <th className="py-1 text-right font-normal">Etiqueta · meta</th>
                  </tr>
                </thead>
                <tbody>
                  {res.etiquetas.slice(-30).reverse().map((e) => (
                    <tr key={e.t0} className="border-t border-borde-suave">
                      <td className="py-1 text-plata-300">{fecha(e.inicio)}</td>
                      <td className="py-1 text-plata-200">{e.lado > 0 ? '↑ sube' : '↓ baja'}</td>
                      <td className="cifra py-1 text-right text-plata-300">{num(e.precio, 2)}</td>
                      <td className="cifra py-1 text-right text-plata-400">{num(e.superior, 2)} / {num(e.inferior, 2)}</td>
                      <td className="py-1 text-plata-200">{e.barrera === 'superior' ? 'arriba' : e.barrera === 'inferior' ? 'abajo' : 'tiempo'}</td>
                      <td className="cifra py-1 text-right text-plata-300">{e.barras}</td>
                      <td className="cifra py-1 text-right text-white">{pct(e.retorno)}</td>
                      <td className="cifra py-1 text-right text-white">{e.etiqueta > 0 ? '+1' : e.etiqueta} · {e.meta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
            <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>σ = volatilidad exponencial de los retornos (lapso {res.config.span} barras), solo con el pasado.</li>
              <li>Filtro CUSUM simétrico: S⁺ = máx(0, S⁺ + r − E[r]) y S⁻ = mín(0, S⁻ + r − E[r]). Si S⁺ supera {res.config.cusumMult} × σ hay un evento al alza; si S⁻ baja de −{res.config.cusumMult} × σ, a la baja. Después se reinician.</li>
              <li>Barreras desde el precio del evento P₀: arriba P₀ × (1 + {res.config.pt} × σ), abajo P₀ × (1 − {res.config.sl} × σ) y tiempo = {res.config.tMax} barras.</li>
              <li>Gana la primera barrera tocada (máximo y mínimo de cada barra). Si en la misma barra se tocan las dos, cuenta la de abajo (caso pesimista).</li>
              <li>Etiqueta en la dirección del evento: tocar a favor = +1, en contra = −1, tiempo = 0. Meta-etiqueta = 1 solo si es +1 (operar); si no, 0 (no operar).</li>
              <li>Los eventos que cruzan un hueco de datos o no tienen {res.config.tMax} barras por delante se descartan.</li>
            </ul>
          </details>
        </Panel>
      )}
    </div>
  );
}

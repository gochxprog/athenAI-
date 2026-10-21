// Matriz de correlación entre variantes (retornos fuera de muestra por barra). Calculada por el Juez.
import { memo } from 'react';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/shadcn/tooltip';
import { SinDatos } from '../Piezas';
import { numero } from '../tema';

/** Color: cian (correlación positiva) · rosa (negativa) · transparente cerca de 0. */
const color = (c: number) => (c >= 0 ? `rgba(34,211,238,${0.08 + 0.72 * Math.min(1, c)})` : `rgba(251,113,133,${0.08 + 0.72 * Math.min(1, -c)})`);

export default memo(function Correlacion({ r }: { r: RespuestaLaboratorio }) {
  const c = r.resultado.correlacion;
  if (!c || c.etiquetas.length < 2) return <SinDatos>Hace falta más de una variante (pon varios valores en PARAMETROS) para ver la correlación.</SinDatos>;
  const n = c.etiquetas.length;
  const fuera = c.matriz.flatMap((f, i) => f.filter((_, k) => k > i));
  const media = fuera.reduce((a, x) => a + x, 0) / Math.max(1, fuera.length);
  return (
    <div className="space-y-3" data-correlacion>
      <div className="overflow-x-auto">
        <div className="grid max-w-3xl gap-[3px]" style={{ gridTemplateColumns: `140px repeat(${n}, minmax(44px, 1fr))` }}>
          <div />
          {c.etiquetas.map((e, k) => (
            <div key={`h${k}`} className="truncate px-1 pb-1 text-center font-mono text-[9.5px] text-zinc-500" title={e}>
              V{k + 1}
            </div>
          ))}
          {c.matriz.map((fila, i) => (
            <div key={`f${i}`} className="contents">
              <div className="truncate pr-2 text-right font-mono text-[10px] text-zinc-400" title={c.etiquetas[i]}>
                V{i + 1} · {c.etiquetas[i]}
              </div>
              {fila.map((v, k) => (
                <Tooltip key={k}>
                  <TooltipTrigger asChild>
                    <div className="flex h-9 items-center justify-center rounded-sm font-mono text-[10px] text-zinc-100" style={{ background: color(v) }}>
                      {numero(v, 2)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    V{i + 1} ({c.etiquetas[i]}) frente a V{k + 1} ({c.etiquetas[k]}): {numero(v, 3)}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        Correlación media entre variantes: <span className="font-mono text-zinc-200">{numero(media, 2)}</span>. Cian = se mueven igual; rosa = al revés. Muy alta (≈ 1) = variantes casi iguales: probar muchas así no aporta información.
      </p>
    </div>
  );
});

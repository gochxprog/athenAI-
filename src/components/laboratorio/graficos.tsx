// Piezas de dibujo compartidas por las secciones del Laboratorio (Juez y Etiquetador).

/** Línea simple en SVG (monocroma). */
export function Linea({ datos, alto = 160, base }: { datos: number[]; alto?: number; base?: number }) {
  if (datos.length < 2) return null;
  const W = 1000;
  const min = Math.min(...datos, base ?? Infinity);
  const max = Math.max(...datos, base ?? -Infinity);
  const y = (v: number) => alto - 6 - ((v - min) / (max - min || 1)) * (alto - 12);
  const paso = Math.max(1, Math.floor(datos.length / 800));
  const pts = datos.filter((_, i) => i % paso === 0 || i === datos.length - 1);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" className="h-40 w-full">
      {base !== undefined && <line x1={0} x2={W} y1={y(base)} y2={y(base)} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Histograma con marcas verticales (percentiles o el valor real). */
export function Histograma({ valores, marcas }: { valores: number[]; marcas: { v: number; etiqueta: string; fuerte?: boolean }[] }) {
  if (!valores.length) return null;
  const todos = [...valores, ...marcas.map((m) => m.v)];
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  const n = 30;
  const cubos = new Array(n).fill(0);
  for (const v of valores) cubos[Math.min(n - 1, Math.floor(((v - min) / (max - min || 1)) * n))] += 1;
  const top = Math.max(...cubos);
  const x = (v: number) => ((v - min) / (max - min || 1)) * 100;
  return (
    <div className="relative h-36 pt-5">
      <div className="flex h-full items-end gap-px">
        {cubos.map((c, i) => (
          <div key={i} className="flex-1 rounded-t-[1px] bg-plata-500/70" style={{ height: `${(c / top) * 100}%` }} />
        ))}
      </div>
      {marcas.map((m) => (
        <div key={m.etiqueta} className="absolute bottom-0 top-0" style={{ left: `${x(m.v)}%` }}>
          <div className={`h-full w-px ${m.fuerte ? 'bg-white' : 'bg-plata-300/70'}`} />
          <span className={`absolute top-0 whitespace-nowrap font-mono text-[9.5px] ${x(m.v) > 75 ? 'right-1' : x(m.v) < 25 ? 'left-1' : '-translate-x-1/2'} ${m.fuerte ? 'text-white' : 'text-plata-400'}`}>{m.etiqueta}</span>
        </div>
      ))}
    </div>
  );
}

/** Recuadro en lenguaje simple: qué es, para qué sirve y qué mirar. */
export function Explicacion({ que, sirve, mirar }: { que: string; sirve: string; mirar: string }) {
  return (
    <div className="rounded-lg border border-borde-suave bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-plata-200" data-explicacion>
      <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Explicación simple</p>
      <p><span className="text-white">Qué es:</span> {que}</p>
      <p><span className="text-white">Para qué te sirve:</span> {sirve}</p>
      <p><span className="text-white">Qué mirar:</span> {mirar}</p>
    </div>
  );
}

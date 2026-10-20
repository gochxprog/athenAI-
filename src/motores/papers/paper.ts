// Papers: cada prueba del Juez queda documentada en un documento autocontenido (HTML que también se imprime
// a PDF): idea, datos, lógica y código, parámetros por tramo, métricas, reglas, gráficos y conclusión.
import type { RespuestaLaboratorio } from '../laboratorio/protocolo';
import type { Costos, Metricas } from '../juez/backtest';
import { DEFINICIONES_FEATURES } from '../nucleo/features';

export interface Paper {
  id: string;
  creado: number;
  estrategia: string;
  codigo: string;
  simbolo: string;
  proveedor: string;
  costos: Costos;
  respuesta: RespuestaLaboratorio;
}

const CLAVE = 'athenai.papers';
const MAX_PAPERS = 50;

const reducir = (xs: number[], max: number) => (xs.length <= max ? xs : Array.from({ length: max }, (_, i) => xs[Math.round((i / (max - 1)) * (xs.length - 1))]));

/** Crea el paper (con las series reducidas para que quepan muchos en el navegador). */
export function crearPaper(datos: Omit<Paper, 'id' | 'creado'>, ahora = Date.now()): Paper {
  const r = datos.respuesta.resultado;
  const respuesta: RespuestaLaboratorio = {
    ...datos.respuesta,
    resultado: {
      ...r,
      equityOos: reducir(r.equityOos, 400),
      monteCarlo: r.monteCarlo ? { ...r.monteCarlo, caminos: r.monteCarlo.caminos.slice(0, 30) } : null,
    },
  };
  return { ...datos, respuesta, id: `p-${ahora}-${Math.round(Math.random() * 1e4)}`, creado: ahora };
}

export function leerPapers(): Paper[] {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as Paper[];
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

export function guardarPaper(p: Paper): Paper[] {
  const xs = [p, ...leerPapers().filter((x) => x.id !== p.id)].slice(0, MAX_PAPERS);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(xs));
  } catch {
    // Sin espacio: se guardan solo los más recientes.
    try {
      localStorage.setItem(CLAVE, JSON.stringify(xs.slice(0, 15)));
    } catch {
      // Almacenamiento bloqueado.
    }
  }
  return xs;
}

export function borrarPaper(id: string): Paper[] {
  const xs = leerPapers().filter((x) => x.id !== id);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(xs));
  } catch {
    // Almacenamiento bloqueado.
  }
  return xs;
}

/** La idea en texto plano: los comentarios del principio del código. */
export function ideaDe(codigo: string): string {
  const lineas: string[] = [];
  for (const l of codigo.split('\n')) {
    const t = l.trim();
    if (t.startsWith('#')) lineas.push(t.replace(/^#+\s?/, ''));
    else if (t && lineas.length) break;
  }
  return lineas.join(' ').trim();
}

/** Lógica descrita automáticamente: Features que usa, parámetros y si opera en largo, corto o ambos. */
export function logicaDe(codigo: string, combos: Record<string, unknown>[], lados?: { largos: number; cortos: number }): { features: string[]; parametros: string[]; lados: string } {
  const usadas = new Set<string>();
  for (const m of codigo.matchAll(/f(?:\.get\(|\[)\s*["']([a-z0-9_]+)["']/g)) usadas.add(m[1]);
  const parametros = combos.length && Object.keys(combos[0]).length ? Object.keys(combos[0]).map((k) => `${k}: ${[...new Set(combos.map((c) => JSON.stringify(c[k])))].join(', ')}`) : [];
  const l = lados ?? { largos: 1, cortos: 0 };
  const texto = l.largos && l.cortos ? 'en largo y en corto' : l.cortos ? 'solo en corto' : l.largos ? 'solo en largo' : 'nunca (no abrió posiciones)';
  return { features: [...usadas], parametros, lados: texto };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

function svgLinea(series: number[][], alto = 180, estilos: string[] = []): string {
  const todos = series.flat();
  if (todos.length < 2) return '';
  const min = Math.min(...todos, 1);
  const max = Math.max(...todos, 1);
  const W = 800;
  const y = (v: number) => (alto - 8 - ((v - min) / (max - min || 1)) * (alto - 16)).toFixed(1);
  const paths = series
    .map((s, k) => {
      const d = s.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, s.length - 1)) * W).toFixed(1)},${y(v)}`).join('');
      return `<path d="${d}" fill="none" ${estilos[k] ?? 'stroke="#111" stroke-width="1.6"'}/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${alto}" width="100%" height="${alto}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" stroke="#999" stroke-dasharray="4 4"/>${paths}</svg>`;
}

function svgHistograma(valores: number[], marca: { v: number; texto: string } | null, alto = 120): string {
  if (!valores.length) return '';
  const todos = marca ? [...valores, marca.v] : valores;
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  const n = 30;
  const cubos = new Array(n).fill(0);
  for (const v of valores) cubos[Math.min(n - 1, Math.floor(((v - min) / (max - min || 1)) * n))] += 1;
  const top = Math.max(...cubos);
  const W = 800;
  const bw = W / n;
  const barras = cubos.map((c, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(alto - (c / top) * (alto - 18)).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${((c / top) * (alto - 18)).toFixed(1)}" fill="#bbb"/>`).join('');
  const m = marca ? (() => {
    const x = (((marca.v - min) / (max - min || 1)) * W).toFixed(1);
    return `<line x1="${x}" x2="${x}" y1="0" y2="${alto}" stroke="#111" stroke-width="2"/><text x="${x}" y="11" font-size="11" text-anchor="${Number(x) > W * 0.7 ? 'end' : 'start'}" fill="#111">${esc(marca.texto)}</text>`;
  })() : '';
  return `<svg viewBox="0 0 ${W} ${alto}" width="100%" height="${alto}" preserveAspectRatio="none">${barras}${m}</svg>`;
}

function filasMetricas(o: Metricas, d: Metricas): string {
  const f = (k: string, a: string, b: string) => `<tr><td>${k}</td><td class="n">${a}</td><td class="n tenue">${b}</td></tr>`;
  return [
    f('Retorno total', pct(o.retornoTotal), pct(d.retornoTotal)),
    f('Sharpe anualizado', num(o.sharpe), num(d.sharpe)),
    f('Drawdown máximo', pct(-o.maxDrawdown), pct(-d.maxDrawdown)),
    f('% de aciertos', o.aciertos === null ? '—' : `${num(o.aciertos * 100, 1)} %`, d.aciertos === null ? '—' : `${num(d.aciertos * 100, 1)} %`),
    f('Factor de beneficio', num(o.factorBeneficio), num(d.factorBeneficio)),
    f('Operaciones', String(o.operaciones), String(d.operaciones)),
    f('Retorno medio por operación', pct(o.retornoMedioOperacion, 3), pct(d.retornoMedioOperacion, 3)),
    f('Tiempo en mercado', `${num(o.exposicion * 100, 0)} %`, `${num(d.exposicion * 100, 0)} %`),
  ].join('');
}

/** Documento HTML autocontenido del paper (sin dependencias externas; listo para imprimir a PDF). */
export function paperHtml(p: Paper): string {
  const r = p.respuesta;
  const j = r.resultado;
  const idea = ideaDe(p.codigo);
  const logica = logicaDe(p.codigo, r.combos, r.lados);
  const nombreFeature = (k: string) => DEFINICIONES_FEATURES.find((d) => d.clave === k)?.nombre ?? k;
  const mc = j.monteCarlo;
  const reglas = j.reglas
    .map((g) => `<tr><td class="c">${g.ok === null ? '—' : g.ok ? '✓' : '✗'}</td><td>${esc(g.nombre)}</td><td>${esc(g.valor)}</td><td class="tenue">${esc(g.umbral)}</td></tr>`)
    .join('');
  const tramos = j.tramos.map((t, i) => `<tr><td>${i + 1}</td><td><code>${esc(JSON.stringify(r.combos[t.combo]))}</code></td><td class="n">${pct(t.retorno)}</td><td class="n">${t.operaciones}</td></tr>`).join('');
  const conclusion =
    j.veredicto === 'APROBADA'
      ? 'La estrategia supera todas las reglas aplicables del Juez con datos que no vio al elegir sus parámetros. Es candidata a operar en Paper; los resultados pasados no garantizan resultados futuros y debe vigilarse frente a lo que el Juez esperaba.'
      : j.veredicto === 'DATOS INSUFICIENTES'
        ? 'Todavía no hay datos suficientes para juzgarla. Hay que seguir grabando el mercado y repetir la prueba.'
        : `La estrategia no supera el Juez: ${j.reglas.filter((g) => g.ok === false).map((g) => g.nombre.toLowerCase()).join(', ')}. No debe operarse.`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.estrategia)} · paper athenAI</title>
<style>
  body{font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;background:#fff;max-width:860px;margin:0 auto;padding:32px 24px}
  h1{font-size:26px;margin:0 0 4px;font-weight:600} h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
  .sub{color:#666;font-size:12px} .veredicto{border:2px solid #111;padding:12px 14px;margin:18px 0} .veredicto b{font-size:20px;letter-spacing:.05em}
  table{border-collapse:collapse;width:100%;font-size:12.5px} td,th{padding:5px 6px;border-bottom:1px solid #eee;text-align:left;vertical-align:top} th{font-weight:600;color:#555;font-size:11px;text-transform:uppercase}
  .n{text-align:right;font-variant-numeric:tabular-nums} .c{text-align:center;width:22px} .tenue{color:#777}
  pre{background:#f5f5f5;border:1px solid #e5e5e5;padding:12px;overflow:auto;font-size:11.5px;line-height:1.45} code{font-size:11.5px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px} .nota{color:#666;font-size:11.5px}
  @media print{body{padding:0}h2{break-after:avoid}pre,svg,table{break-inside:avoid}}
</style></head><body>
<p class="sub">athenAI · paper del Laboratorio · generado ${fecha(p.creado)}</p>
<h1>${esc(p.estrategia)}</h1>
<p class="sub">${esc(p.simbolo)} · ${esc(p.proveedor)} · ${r.filas.toLocaleString('es-ES')} dollar bars (${fecha(r.desde)} → ${fecha(r.hasta)})</p>
<div class="veredicto"><b>${j.veredicto}</b><br>${esc(j.resumen)}</div>

<h2>1. Idea</h2>
<p>${idea ? esc(idea) : '<span class="tenue">Sin descripción. Escribe comentarios (# …) al principio del código para explicar la idea.</span>'}</p>

<h2>2. Lógica en texto plano</h2>
<ul>
<li>Opera ${logica.lados}. La posición decidida al cierre de una dollar bar se aplica desde la barra siguiente.</li>
<li>Datos que usa: ${logica.features.length ? logica.features.map((k) => `<b>${esc(nombreFeature(k))}</b> (<code>${esc(k)}</code>)`).join(', ') : 'no se detectaron Features'}.</li>
<li>Parámetros probados: ${logica.parametros.length ? logica.parametros.map(esc).join(' · ') : 'ninguno (una sola variante)'}. ${r.combos.length} ${r.combos.length === 1 ? 'variante' : 'variantes'} en esta prueba; ${j.ensayos} en total con esta idea.</li>
<li>Costos: comisión ${p.costos.comisionPb} pb + deslizamiento ${p.costos.deslizamientoPb} pb por lado.</li>
</ul>

<h2>3. Código</h2>
<pre>${esc(p.codigo)}</pre>

<h2>4. Walk-Forward (fuera de muestra)</h2>
<p class="nota">El 30 % inicial solo sirve para elegir parámetros. Cada tramo se prueba con los parámetros elegidos con los datos anteriores (20 barras de embargo). Fuera de muestra desde ${fecha(r.inicioOosT)}.</p>
${svgLinea([j.equityOos])}
<table><tr><th>Tramo</th><th>Parámetros elegidos</th><th class="n">Retorno</th><th class="n">Operaciones</th></tr>${tramos}</table>

<h2>5. Métricas</h2>
<table><tr><th></th><th class="n">Fuera de muestra</th><th class="n">Dentro (optimista)</th></tr>${filasMetricas(j.oos, j.dentroMuestra)}</table>
<p class="nota">«Dentro» usa la mejor variante con toda la historia y siempre sale mejor de lo que es: solo cuenta «fuera de muestra».</p>

<h2>6. Reglas del Juez</h2>
<table><tr><th></th><th>Regla</th><th>Valor</th><th>Umbral</th></tr>${reglas}</table>

<h2>7. Monte Carlo y Luck test</h2>
<div class="grid">
<div><p><b>Monte Carlo</b> (2.000 órdenes de las operaciones)</p>${mc ? `${svgLinea([...mc.caminos.slice(0, 30), mc.bandas.p5, mc.bandas.p50, mc.bandas.p95], 150, [...mc.caminos.slice(0, 30).map(() => 'stroke="#000" stroke-opacity="0.12" stroke-width="1"'), 'stroke="#111" stroke-dasharray="4 3" stroke-width="1.2"', 'stroke="#111" stroke-width="2"', 'stroke="#111" stroke-dasharray="4 3" stroke-width="1.2"'])}<p class="nota">P5 ${pct(mc.p5)} · P50 ${pct(mc.p50)} · P95 ${pct(mc.p95)} · peor caída esperable ${pct(-mc.ddP95)} · prob. de caída > 25 %: ${num(mc.probDd25 * 100, 1)} %</p>` : '<p class="nota">Menos de 5 operaciones.</p>'}</div>
<div><p><b>Luck test</b> (1.000 versiones al azar)</p>${j.suerte ? `${svgHistograma(j.suerte.simulaciones, { v: j.suerte.real, texto: `estrategia ${pct(j.suerte.real)}` }, 150)}<p class="nota">p = ${num(j.suerte.p, 3)}</p>` : '<p class="nota">Menos de 5 operaciones.</p>'}</div>
</div>

<h2>8. Robustez</h2>
<table>
<tr><td>Costos ×2</td><td class="n">${pct(j.robustez.costosDobles)}</td></tr>
<tr><td>Tramos positivos</td><td class="n">${num(j.robustez.tramosPositivos * 100, 0)} %</td></tr>
<tr><td>Parámetros vecinos que ganan</td><td class="n">${j.robustez.vecinosPositivos === null ? '—' : `${num(j.robustez.vecinosPositivos * 100, 0)} %`}</td></tr>
<tr><td>Deflated Sharpe</td><td class="n">${num(j.deflatedSharpe, 3)}</td></tr>
<tr><td>PBO (probabilidad de sobreajuste)</td><td class="n">${j.pbo === null ? '—' : `${num(j.pbo * 100, 0)} %`}</td></tr>
<tr><td>Otro mercado</td><td class="n">${j.robustez.otroMercado ? `${esc(j.robustez.otroMercado.simbolo)}: ${pct(j.robustez.otroMercado.retornoTotal)}` : 'no probado'}</td></tr>
</table>

<h2>9. Conclusión</h2>
<p>${esc(conclusion)}</p>
<p class="nota">Documento generado automáticamente por athenAI (Programador + Juez). No es una recomendación de inversión.</p>
</body></html>`;
}

/** Nombre de archivo del paper. */
export function nombreArchivo(p: Paper): string {
  const limpio = p.estrategia.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `paper-${limpio || 'estrategia'}-${p.simbolo}-${new Date(p.creado).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.html`;
}

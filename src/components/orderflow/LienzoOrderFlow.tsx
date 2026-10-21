import { decimalesDe } from '@/lib/format';
import { useEffect, useRef, useState } from 'react';
import type { BarraGrafico, EstadoGrafico, HeatmapGrafico } from '@/motores/nucleo/pipeline';
import type { EventoMotor } from '@/motores/nucleo/tipos';
import { unirConVivo } from '@/motores/historial/historial';

export interface CapasGrafico {
  footprint: boolean;
  heatmap: boolean;
  cvd: boolean;
  oi: boolean;
  absorcion: boolean;
  lhm: boolean;
  eventos: boolean;
}

// Paleta estrictamente monocroma.
const C = {
  fondo: '#000000',
  rejilla: 'rgba(255,255,255,0.045)',
  eje: '#8e929a',
  texto: '#d9dbdf',
  tenue: '#45484e',
  alcista: '#e9eaed',
  bajista: '#7a7e86',
  mecha: '#5a5e66',
  blanco: '#ffffff',
};
const EJE_PRECIO = 66;
const EJE_TIEMPO = 22;
const MARGEN_DERECHO = 18;
const FUENTE = '10px "JetBrains Mono", ui-monospace, monospace';

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const ddmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
/** Barras a la izquierda de la vista a partir de las cuales se pide más historial. */
const BORDE_HISTORIAL = 60;
const fmt = (v: number, dec = 1) => v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtQ = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Heatmap listo para dibujar: la matriz del motor convertida a imagen (blanco con opacidad = liquidez). */
interface HeatmapImagen {
  simbolo: string;
  h: HeatmapGrafico;
  lienzo: HTMLCanvasElement;
}

function crearImagenHeatmap(simbolo: string, h: HeatmapGrafico): HeatmapImagen {
  const cols = h.tiempos.length;
  const lienzo = document.createElement('canvas');
  lienzo.width = cols;
  lienzo.height = h.filas;
  const c = lienzo.getContext('2d')!;
  const img = c.createImageData(cols, h.filas);
  for (let ci = 0; ci < cols; ci += 1) {
    for (let r = 0; r < h.filas; r += 1) {
      const v = h.datos[ci * h.filas + r];
      if (!v) continue;
      // Fila 0 = precio más bajo: abajo en la imagen.
      const o = ((h.filas - 1 - r) * cols + ci) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(Math.pow(v / 255, 1.3) * 0.7 * 255);
    }
  }
  c.putImageData(img, 0, 0);
  return { simbolo, h, lienzo };
}

interface Vista {
  ancho: number;
  /** true hasta que el usuario hace zoom: el ancho se ajusta para llenar el gráfico si hay pocas barras. */
  auto: boolean;
  /** Barras desplazadas desde la derecha (0 = siguiendo el precio en vivo). Admite fracciones (arrastre suave). */
  desplazamiento: number;
  /** Escala de precio fijada por el usuario (centro y rango); null = automática (se ajusta a las velas visibles). */
  precio: { centro: number; rango: number } | null;
  raton: { x: number; y: number } | null;
  /** Último dibujo: escala y áreas, para convertir píxeles en precio durante los gestos. */
  ultimo: { lo: number; hi: number; hPrincipal: number; areaW: number } | null;
}

/** Gesto en curso: un dedo / ratón (desplazar o estirar el eje de precio) o dos dedos (zoom en los dos ejes). */
type Gesto =
  | { tipo: 'arrastre'; x: number; y: number; desp: number; precio: { centro: number; rango: number } | null; enEje: boolean; movido: boolean }
  | { tipo: 'pellizco'; dx: number; dy: number; mx: number; my: number; ancho: number; desp: number; precio: { centro: number; rango: number } };

/** Operaciones de la Terminal sobre el gráfico (bots y manuales): ▲ compra · ▼ venta, y stop / objetivo de lo abierto. */
export interface MarcasGrafico {
  simbolo: string;
  ops: { t: number; p: number; lado: 1 | -1; entrada: boolean }[];
  abiertas: { t0: number; entrada: number; stop: number | null; objetivo: number | null; lado: 1 | -1; quien: string }[];
}

export interface PropsLienzo {
  estado: EstadoGrafico | null;
  /** Opcional (Terminal): sin esto el gráfico es el de siempre. */
  marcas?: MarcasGrafico | null;
  capas: CapasGrafico;
  /** Velas anteriores a lo vivo (solo para dibujar). */
  historial?: readonly BarraGrafico[];
  /** Se llama al acercarse al borde izquierdo: hay que traer más historial. */
  alBordeIzquierdo?: () => void;
}

export default function LienzoOrderFlow({ estado, capas, historial, alBordeIzquierdo, marcas }: PropsLienzo) {
  const contRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const estadoRef = useRef(estado);
  const capasRef = useRef(capas);
  const vista = useRef<Vista>({ ancho: capas.footprint ? 64 : 9, auto: true, desplazamiento: 0, precio: null, raton: null, ultimo: null });
  const sucio = useRef(true);
  const heatmapRef = useRef<HeatmapImagen | null>(null);
  const bordeRef = useRef(alBordeIzquierdo);
  bordeRef.current = alBordeIzquierdo;
  // Historial + vivo, recalculado solo cuando cambia alguno de los dos.
  const unidas = useRef<{ hist: readonly BarraGrafico[] | undefined; vivas: readonly BarraGrafico[] | undefined; todas: BarraGrafico[] }>({ hist: undefined, vivas: undefined, todas: [] });
  if (estado && (unidas.current.hist !== historial || unidas.current.vivas !== estado.barras)) {
    unidas.current = { hist: historial, vivas: estado.barras, todas: unirConVivo(historial ?? [], estado.barras) };
  }
  const barrasRef = useRef(unidas.current.todas);
  barrasRef.current = unidas.current.todas;

  estadoRef.current = estado;
  // El motor solo envía el heatmap cuando cambia: se guarda el último (por activo).
  if (estado?.heatmap && heatmapRef.current?.h !== estado.heatmap) heatmapRef.current = crearImagenHeatmap(estado.simbolo, estado.heatmap);
  else if (estado && heatmapRef.current && heatmapRef.current.simbolo !== estado.simbolo) heatmapRef.current = null;
  const [manual, setManual] = useState(false);
  const marcarManual = useRef(setManual);
  if (capasRef.current.footprint !== capas.footprint) {
    vista.current.ancho = capas.footprint ? 64 : 9;
    vista.current.auto = true;
    vista.current.precio = null;
  }
  // Otro mercado u otra temporalidad: vuelve al vivo con la escala automática.
  const claveVista = estado ? `${estado.simbolo}|${estado.temporalidad}` : '';
  const claveVistaRef = useRef(claveVista);
  if (claveVistaRef.current !== claveVista) {
    claveVistaRef.current = claveVista;
    Object.assign(vista.current, { desplazamiento: 0, precio: null, auto: true, ancho: capas.footprint ? 64 : 9 });
    if (manual) setManual(false);
  }
  capasRef.current = capas;
  const marcasRef = useRef(marcas);
  marcasRef.current = marcas;
  sucio.current = true;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const cont = contRef.current!;
    let raf = 0;
    const ro = new ResizeObserver(() => (sucio.current = true));
    ro.observe(cont);

    const bucle = () => {
      raf = requestAnimationFrame(bucle);
      if (!sucio.current) return;
      sucio.current = false;
      marcarManual.current(vista.current.precio !== null);
      const r = dibujar(canvas, cont, estadoRef.current, barrasRef.current, capasRef.current, vista.current, heatmapRef.current, marcasRef.current);
      if (r && r.inicio < BORDE_HISTORIAL) bordeRef.current?.();
    };
    raf = requestAnimationFrame(bucle);

    const v = vista.current;
    const punteros = new Map<number, { x: number; y: number }>();
    let gesto: Gesto | null = null;
    let ultimoToque = { t: 0, x: 0, y: 0 };
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    /** Escala de precio actual (la automática del último dibujo si el usuario no la ha fijado). */
    const precioActual = () => v.precio ?? (v.ultimo ? { centro: (v.ultimo.lo + v.ultimo.hi) / 2, rango: v.ultimo.hi - v.ultimo.lo } : null);
    const precioPorPx = () => (v.ultimo ? (v.ultimo.hi - v.ultimo.lo) / Math.max(1, v.ultimo.hPrincipal - 16) : 0);
    const reiniciar = () => {
      v.desplazamiento = 0;
      v.auto = true;
      v.precio = null;
      v.ancho = capasRef.current.footprint ? 64 : 9;
      sucio.current = true;
    };
    const empezarPellizco = () => {
      const [a, b] = [...punteros.values()];
      const p = precioActual();
      if (!p) return;
      gesto = { tipo: 'pellizco', dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ancho: v.ancho, desp: v.desplazamiento, precio: p };
    };

    const alRueda = (e: WheelEvent) => {
      e.preventDefault();
      const { x } = local(e);
      const enEje = !!v.ultimo && x > v.ultimo.areaW;
      if (enEje || e.shiftKey) {
        // Sobre el eje de precio (o con Mayús): estira o encoge solo el precio.
        const p = precioActual();
        if (p) v.precio = { centro: p.centro, rango: Math.max(1e-9, p.rango * (e.deltaY > 0 ? 1.12 : 0.89)) };
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Panel táctil: desplazamiento horizontal.
        v.desplazamiento = Math.max(0, v.desplazamiento + e.deltaX / v.ancho);
      } else {
        const factor = e.deltaY > 0 ? 0.88 : 1.14;
        v.ancho = Math.max(1, Math.min(180, v.ancho * factor));
        v.auto = false;
      }
      sucio.current = true;
    };
    const alPresionar = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      punteros.set(e.pointerId, local(e));
      if (punteros.size === 2) empezarPellizco();
      else if (punteros.size === 1) {
        const p = local(e);
        const enEje = !!v.ultimo && p.x > v.ultimo.areaW;
        // Sobre el eje se fija la escala de partida (si no, cada movimiento la multiplicaría otra vez).
        gesto = { tipo: 'arrastre', x: p.x, y: p.y, desp: v.desplazamiento, precio: enEje ? precioActual() : v.precio, enEje, movido: false };
      }
    };
    const alMover = (e: PointerEvent) => {
      const p = local(e);
      v.raton = p;
      if (punteros.has(e.pointerId)) punteros.set(e.pointerId, p);
      const g = gesto;
      if (g?.tipo === 'arrastre' && punteros.size === 1) {
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) g.movido = true;
        if (g.enEje) {
          // Arrastrar el eje de precio: hacia abajo encoge, hacia arriba estira.
          if (g.precio) v.precio = { centro: g.precio.centro, rango: Math.max(1e-9, g.precio.rango * Math.exp(dy * 0.006)) };
        } else {
          v.desplazamiento = Math.max(0, g.desp + dx / v.ancho);
          // Movimiento vertical libre: solo un gesto claramente vertical pasa la escala de precio a manual
          // (un arrastre horizontal con algo de temblor sigue con la escala automática).
          if (g.precio || (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx))) {
            if (!g.precio) g.precio = precioActual();
            if (g.precio) v.precio = { centro: g.precio.centro + dy * precioPorPx(), rango: g.precio.rango };
          }
        }
      } else if (g?.tipo === 'pellizco' && punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        // Separar los dedos en horizontal ensancha las velas; en vertical estira el precio.
        if (g.dx > 30) {
          v.ancho = Math.max(1, Math.min(180, g.ancho * (dx / g.dx)));
          v.auto = false;
        }
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const rango = g.dy > 30 ? Math.max(1e-9, g.precio.rango * (g.dy / Math.max(10, dy))) : g.precio.rango;
        v.precio = { centro: g.precio.centro + (my - g.my) * precioPorPx(), rango };
        v.desplazamiento = Math.max(0, g.desp + (mx - g.mx) / v.ancho);
      }
      sucio.current = true;
    };
    const alSoltar = (e: PointerEvent) => {
      punteros.delete(e.pointerId);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      // Doble toque (o doble clic) sin arrastrar: volver al vivo y a la escala automática.
      if (gesto?.tipo === 'arrastre' && !gesto.movido) {
        const p = local(e);
        const ahora = performance.now();
        if (ahora - ultimoToque.t < 320 && Math.hypot(p.x - ultimoToque.x, p.y - ultimoToque.y) < 30) {
          reiniciar();
          ultimoToque = { t: 0, x: 0, y: 0 };
        } else ultimoToque = { t: ahora, ...p };
      }
      if (punteros.size === 1) {
        const [p] = [...punteros.values()];
        gesto = { tipo: 'arrastre', x: p.x, y: p.y, desp: v.desplazamiento, precio: v.precio, enEje: false, movido: true };
      } else if (punteros.size === 0) gesto = null;
    };
    const alSalir = () => {
      v.raton = null;
      sucio.current = true;
    };
    canvas.addEventListener('wheel', alRueda, { passive: false });
    canvas.addEventListener('pointerdown', alPresionar);
    canvas.addEventListener('pointermove', alMover);
    canvas.addEventListener('pointerup', alSoltar);
    canvas.addEventListener('pointercancel', alSoltar);
    canvas.addEventListener('pointerleave', alSalir);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('wheel', alRueda);
      canvas.removeEventListener('pointerdown', alPresionar);
      canvas.removeEventListener('pointermove', alMover);
      canvas.removeEventListener('pointerup', alSoltar);
      canvas.removeEventListener('pointercancel', alSoltar);
      canvas.removeEventListener('pointerleave', alSalir);
    };
  }, []);

  return (
    <div ref={contRef} className="relative h-full w-full select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-crosshair touch-none" />
      {manual && (
        <button
          onClick={() => {
            vista.current.precio = null;
            sucio.current = true;
            setManual(false);
          }}
          className="absolute right-[72px] top-2 rounded border border-borde bg-black/80 px-2 py-0.5 text-[10px] text-plata-200 hover:text-white"
          data-escala-auto
        >
          Escala auto
        </button>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------------------------

/** Dibuja y devuelve el índice de la primera barra visible (para pedir más historial al acercarse al borde). */
function dibujar(canvas: HTMLCanvasElement, cont: HTMLElement, estado: EstadoGrafico | null, barras: readonly BarraGrafico[], capas: CapasGrafico, v: Vista, heatmap: HeatmapImagen | null, marcas?: MarcasGrafico | null): { inicio: number } | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cont.clientWidth;
  const H = cont.clientHeight;
  if (W < 10 || H < 10) return null;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.fondo;
  ctx.fillRect(0, 0, W, H);
  ctx.font = FUENTE;
  if (!estado || (barras.length === 0 && !estado.enCurso)) {
    ctx.fillStyle = C.eje;
    ctx.textAlign = 'center';
    ctx.fillText('Esperando datos del motor…', W / 2, H / 2);
    return null;
  }

  const dp = decimalesDe(estado.tickSize);
  const todas: readonly BarraGrafico[] = estado.enCurso ? [...barras, estado.enCurso] : barras;
  const areaW = W - EJE_PRECIO;
  const altoSub = (on: boolean, frac: number) => (on ? Math.round((H - EJE_TIEMPO) * frac) : 0);
  const hCvd = altoSub(capas.cvd, 0.17);
  const hOi = altoSub(capas.oi, 0.15);
  const hPrincipal = H - EJE_TIEMPO - hCvd - hOi;

  // Ancho automático: con poca historia las barras se ensanchan para llenar el área.
  if (v.auto) {
    const minimo = capas.footprint ? 64 : 9;
    v.ancho = Math.max(minimo, Math.min(capas.footprint ? 120 : 26, (areaW - MARGEN_DERECHO) / (todas.length + 2)));
  }

  // Barras visibles (el desplazamiento admite fracciones: el arrastre es suave).
  const cabe = Math.ceil((areaW - MARGEN_DERECHO) / v.ancho) + 2;
  v.desplazamiento = Math.min(v.desplazamiento, Math.max(0, todas.length - 5));
  const entero = Math.floor(v.desplazamiento);
  const fraccion = v.desplazamiento - entero;
  const fin = todas.length - entero;
  const ini = Math.max(0, fin - cabe);
  const visibles = todas.slice(ini, fin);
  const xDe = (k: number) => areaW - MARGEN_DERECHO - (visibles.length - 1 - k) * v.ancho - v.ancho / 2 + fraccion * v.ancho;

  // Escala de precio.
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of visibles) {
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
  }
  const pad = Math.max((hi - lo) * 0.08, estado.paso * 2);
  lo -= pad;
  hi += pad;
  // Escala fijada por el usuario (arrastre vertical, pellizco o eje de precio).
  if (v.precio) {
    lo = v.precio.centro - v.precio.rango / 2;
    hi = v.precio.centro + v.precio.rango / 2;
  } else if (capas.footprint) {
    // Footprint: escala vertical con filas legibles (≥ 15 px), centrada en el último precio.
    const filas = Math.max(8, Math.floor((hPrincipal - 16) / 15));
    if ((hi - lo) / estado.paso > filas) {
      const centro = visibles[visibles.length - 1]?.c ?? (lo + hi) / 2;
      lo = centro - (filas / 2) * estado.paso;
      hi = centro + (filas / 2) * estado.paso;
    }
  }
  if (!(hi > lo)) {
    hi = lo + estado.paso * 10;
  }
  v.ultimo = { lo, hi, hPrincipal, areaW };
  const yP = (p: number) => 8 + (1 - (p - lo) / (hi - lo)) * (hPrincipal - 16);
  const pDeY = (y: number) => lo + (1 - (y - 8) / (hPrincipal - 16)) * (hi - lo);

  // Tiempo → x (para pools y eventos).
  const xDeTiempo = (t: number): number | null => {
    if (!visibles.length || t < visibles[0].t) return null;
    let a = 0;
    let z = visibles.length - 1;
    while (a < z) {
      const m = (a + z + 1) >> 1;
      if (visibles[m].t <= t) a = m;
      else z = m - 1;
    }
    const b = visibles[a];
    const dur = Math.max(1, b.fin - b.t);
    return xDe(a) - v.ancho / 2 + Math.min(1, (t - b.t) / dur) * v.ancho;
  };

  // Rejilla y eje de precio.
  ctx.strokeStyle = C.rejilla;
  ctx.lineWidth = 1;
  const pasoEje = escalonPrecio((hi - lo) / Math.max(3, hPrincipal / 48));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let p = Math.ceil(lo / pasoEje) * pasoEje; p <= hi; p += pasoEje) {
    const y = Math.round(yP(p)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(areaW, y);
    ctx.stroke();
    ctx.fillStyle = C.eje;
    ctx.fillText(fmt(p, decimalesDe(pasoEje)), areaW + 6, y);
  }

  // Heatmap de liquidez (tipo Bookmap): detrás de todo, recortado al panel principal.
  if (capas.heatmap && heatmap && heatmap.simbolo === estado.simbolo) {
    const h = heatmap.h;
    const yArriba = yP((h.idx0 + h.filas - 0.5) * h.paso);
    const yAbajo = yP((h.idx0 - 0.5) * h.paso);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, areaW, hPrincipal);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    // Con Footprint el texto de los niveles manda: el heatmap queda más tenue.
    ctx.globalAlpha = capas.footprint ? 0.45 : 1;
    const finVivo = xDeTiempo(estado.ahora) ?? areaW - MARGEN_DERECHO;
    for (let ci = 0; ci < h.tiempos.length; ci += 1) {
      const x0 = xDeTiempo(h.tiempos[ci]);
      if (x0 === null) continue;
      const x1 = ci + 1 < h.tiempos.length ? xDeTiempo(h.tiempos[ci + 1]) ?? x0 + 1 : finVivo;
      const w = Math.max(1, x1 - x0 + 0.5);
      ctx.drawImage(heatmap.lienzo, ci, 0, 1, h.filas, x0, yArriba, w, yAbajo - yArriba);
    }
    ctx.restore();
  }

  // LHM: pools vivos (línea continua) y huellas de pools barridos (discontinua, se desvanece).
  if (capas.lhm) {
    const vMax = Math.max(1, ...estado.pools.map((p) => p.v));
    for (const g of estado.ghosts) {
      if (g.p < lo || g.p > hi) continue;
      const x0 = xDeTiempo(g.t0) ?? 0;
      const x1 = xDeTiempo(g.tBarrido) ?? areaW;
      const edad = Math.min(1, (estado.ahora - g.tBarrido) / 300_000);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - edad) + 0.05})`;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, yP(g.p));
      ctx.lineTo(x1, yP(g.p));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of estado.pools) {
      if (p.p < lo || p.p > hi) continue;
      const y = Math.round(yP(p.p)) + 0.5;
      const x0 = Math.max(0, xDeTiempo(p.t0) ?? 0);
      const grosor = 1 + 5 * Math.sqrt(p.v / vMax);
      ctx.fillStyle = `rgba(255,255,255,${p.lado === 'ask' ? 0.16 : 0.1})`;
      ctx.fillRect(x0, y - grosor / 2, areaW - x0, grosor);
      ctx.strokeStyle = `rgba(255,255,255,${p.lado === 'ask' ? 0.75 : 0.5})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(areaW, y);
      ctx.stroke();
      etiquetaEje(ctx, areaW, y, `${p.lado === 'ask' ? 'A' : 'B'} ${fmtQ(p.v)}`, false);
    }
  }

  // Velas o Footprint (recortado al panel principal).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, areaW, hPrincipal);
  ctx.clip();
  const maxNivel = capas.footprint ? Math.max(1, ...visibles.flatMap((b) => (b.niveles ?? []).map((n) => Math.max(n.a, n.b)))) : 1;
  const altoFila = Math.abs(yP(0) - yP(estado.paso));
  visibles.forEach((b, k) => {
    const x = xDe(k);
    if (capas.footprint && b.niveles && v.ancho >= 18) dibujarFootprint(ctx, b, x, v.ancho, yP, altoFila, estado.paso, maxNivel);
    else dibujarVela(ctx, b, x, v.ancho, yP);

    if (capas.absorcion) {
      for (const a of b.absorcion) {
        const y = yP(a.p);
        const r = 3 + (a.s - 50) / 9;
        ctx.strokeStyle = C.blanco;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + (a.lado === 'ask' ? v.ancho * 0.22 : -v.ancho * 0.22), y, Math.max(3, r), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const e of b.agotamiento ?? []) {
        const y = yP(e.p);
        const arriba = e.lado === 'bullish';
        ctx.fillStyle = C.blanco;
        ctx.beginPath();
        const yy = arriba ? y - 9 : y + 9;
        ctx.moveTo(x - 4, yy + (arriba ? -3 : 3));
        ctx.lineTo(x + 4, yy + (arriba ? -3 : 3));
        ctx.lineTo(x, yy + (arriba ? 3 : -3));
        ctx.closePath();
        ctx.fill();
      }
    }
  });

  if (capas.eventos) dibujarEventos(ctx, estado.eventos, xDeTiempo, yP, lo, hi);
  if (marcas && marcas.simbolo === estado.simbolo) dibujarMarcas(ctx, marcas, xDeTiempo, yP, lo, hi, areaW);
  ctx.restore();

  // VWAP de sesión y precio actual.
  const vwap = estado.metricas.vwapSesion;
  if (vwap !== null && vwap > lo && vwap < hi) {
    const y = Math.round(yP(vwap)) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(areaW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.eje;
    ctx.textAlign = 'left';
    ctx.fillText('VWAP', 6, y - 7);
  }
  const ultima = todas[todas.length - 1];
  if (ultima) {
    const y = Math.round(yP(ultima.c)) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(areaW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    etiquetaEje(ctx, areaW, y, fmt(ultima.c, dp), true);
  }

  // Subpaneles.
  let ySub = hPrincipal;
  if (capas.cvd) {
    dibujarSerie(ctx, visibles.map((b) => b.cvd), xDe, ySub, hCvd, areaW, 'CVD', (x) => `${x > 0 ? '+' : ''}${fmt(x, 0)}`, false);
    ySub += hCvd;
  }
  if (capas.oi) {
    const vals = visibles.map((b) => b.oi);
    dibujarSerie(ctx, vals, xDe, ySub, hOi, areaW, 'Open Interest', (x) => fmt(x, 0), true);
  }

  // Eje de tiempo.
  const yT = H - EJE_TIEMPO;
  ctx.strokeStyle = C.tenue;
  ctx.beginPath();
  ctx.moveTo(0, yT + 0.5);
  ctx.lineTo(areaW, yT + 0.5);
  ctx.stroke();
  ctx.fillStyle = C.eje;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cada = Math.max(1, Math.round(110 / v.ancho));
  visibles.forEach((b, k) => {
    if ((ini + k) % cada !== 0) return;
    // Con historia de varios días, la primera etiqueta de cada día lleva la fecha.
    const anterior = visibles[k - cada];
    const otroDia = anterior && new Date(anterior.t).getDate() !== new Date(b.t).getDate();
    ctx.fillText(otroDia ? ddmm(b.t) : hhmm(b.t), xDe(k), yT + EJE_TIEMPO / 2);
  });

  // Cruz y tooltip.
  const m = v.raton;
  if (m && m.x < areaW && m.y < yT) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(m.x + 0.5, 0);
    ctx.lineTo(m.x + 0.5, yT);
    ctx.moveTo(0, m.y + 0.5);
    ctx.lineTo(areaW, m.y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    if (m.y < hPrincipal) etiquetaEje(ctx, areaW, m.y, fmt(pDeY(m.y), dp), true);
    const k = Math.round((m.x - xDe(0)) / v.ancho);
    const b = visibles[k];
    if (b) {
      const lineas = [
        `${ddmm(b.t)} ${hhmm(b.t)}${b.completa ? '' : ' · en curso'}`,
        `O ${fmt(b.o, dp)}  H ${fmt(b.h, dp)}`,
        `L ${fmt(b.l, dp)}  C ${fmt(b.c, dp)}`,
        `Vol ${fmtQ(b.v)}  Δ ${b.d > 0 ? '+' : ''}${fmtQ(b.d)}`,
        `CVD ${fmt(b.cvd, 0)}${b.oi !== null ? `  OI ${fmt(b.oi, 0)}` : ''}`,
      ];
      if (b.absorcion.length) lineas.push(`Absorción ${b.absorcion.map((a) => `${a.lado} ${a.s.toFixed(0)}`).join(' · ')}`);
      if (b.agotamiento?.length) lineas.push(`Agotamiento ${b.agotamiento.map((a) => `${a.lado === 'bullish' ? 'alcista' : 'bajista'} ${a.s.toFixed(0)}`).join(' · ')}`);
      const ancho = Math.max(...lineas.map((l) => ctx.measureText(l).width)) + 16;
      ctx.fillStyle = 'rgba(10,10,11,0.92)';
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(10, 10, ancho, lineas.length * 14 + 10);
      ctx.strokeRect(10.5, 10.5, ancho, lineas.length * 14 + 10);
      ctx.fillStyle = C.texto;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lineas.forEach((l, i) => ctx.fillText(l, 18, 16 + i * 14));
    }
  }
  return { inicio: ini };
}

/** Entradas y salidas (▲ ▼, llenas = entrada, huecas = salida) y líneas de entrada, stop y objetivo de lo abierto. */
function dibujarMarcas(ctx: CanvasRenderingContext2D, m: MarcasGrafico, xDeTiempo: (t: number) => number | null, yP: (p: number) => number, lo: number, hi: number, areaW: number): void {
  const fin = areaW - MARGEN_DERECHO;
  for (const a of m.abiertas) {
    const x0 = Math.max(0, xDeTiempo(a.t0) ?? 0);
    const linea = (p: number | null, color: string, guion: number[], etiqueta: string) => {
      if (p === null || p <= lo || p >= hi) return;
      const y = Math.round(yP(p)) + 0.5;
      ctx.strokeStyle = color;
      ctx.setLineDash(guion);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(fin, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '9px ui-monospace, Menlo, monospace';
      const w = ctx.measureText(etiqueta).width + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(fin - w - 2, y - 7, w, 13);
      ctx.strokeStyle = color;
      ctx.strokeRect(fin - w - 2 + 0.5, y - 6.5, w - 1, 12);
      ctx.fillStyle = color;
      ctx.fillText(etiqueta, fin - w + 2, y + 3);
    };
    linea(a.objetivo, 'rgba(255,255,255,0.85)', [5, 4], `TP · ${a.quien}`);
    linea(a.stop, 'rgba(142,146,154,0.9)', [2, 3], `SL · ${a.quien}`);
    linea(a.entrada, 'rgba(255,255,255,0.45)', [], `${a.lado > 0 ? 'LARGO' : 'CORTO'} · ${a.quien}`);
  }
  for (const o of m.ops) {
    if (o.p <= lo || o.p >= hi) continue;
    const x = xDeTiempo(o.t);
    if (x === null) continue;
    const y = yP(o.p);
    const compra = o.entrada ? o.lado === 1 : o.lado === -1;
    const yy = compra ? y + 9 : y - 9;
    ctx.beginPath();
    ctx.moveTo(x, yy + (compra ? -5 : 5));
    ctx.lineTo(x - 5, yy + (compra ? 3 : -3));
    ctx.lineTo(x + 5, yy + (compra ? 3 : -3));
    ctx.closePath();
    if (o.entrada) {
      ctx.fillStyle = C.blanco;
      ctx.fill();
    } else {
      ctx.strokeStyle = C.blanco;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

function escalonPrecio(bruto: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(bruto)));
  const n = bruto / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

function etiquetaEje(ctx: CanvasRenderingContext2D, areaW: number, y: number, texto: string, solida: boolean): void {
  ctx.font = FUENTE;
  const w = ctx.measureText(texto).width + 10;
  ctx.fillStyle = solida ? '#ffffff' : 'rgba(20,20,22,0.95)';
  ctx.fillRect(areaW + 2, y - 8, w, 16);
  if (!solida) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(areaW + 2.5, y - 7.5, w - 1, 15);
  }
  ctx.fillStyle = solida ? '#000000' : '#d9dbdf';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, areaW + 7, y);
}

function dibujarVela(ctx: CanvasRenderingContext2D, b: BarraGrafico, x: number, ancho: number, yP: (p: number) => number): void {
  const alcista = b.c >= b.o;
  const cuerpo = Math.max(1, Math.floor(ancho * 0.7));
  ctx.strokeStyle = C.mecha;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, yP(b.h));
  ctx.lineTo(Math.round(x) + 0.5, yP(b.l));
  ctx.stroke();
  const y1 = yP(Math.max(b.o, b.c));
  const y2 = yP(Math.min(b.o, b.c));
  const h = Math.max(1, y2 - y1);
  if (alcista) {
    ctx.fillStyle = b.completa ? C.alcista : 'rgba(233,234,237,0.7)';
    ctx.fillRect(Math.round(x - cuerpo / 2), y1, cuerpo, h);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.round(x - cuerpo / 2), y1, cuerpo, h);
    ctx.strokeStyle = C.bajista;
    ctx.strokeRect(Math.round(x - cuerpo / 2) + 0.5, y1 + 0.5, cuerpo - 1, Math.max(0, h - 1));
  }
}

function dibujarFootprint(
  ctx: CanvasRenderingContext2D,
  b: BarraGrafico,
  x: number,
  ancho: number,
  yP: (p: number) => number,
  altoFila: number,
  paso: number,
  maxNivel: number,
): void {
  const col = ancho - 6;
  const x0 = x - col / 2 + 3;
  const mitad = (col - 3) / 2;
  const conTexto = altoFila >= 11 && col >= 56;
  // Mecha y cuerpo finos a la izquierda: contexto OHLC.
  ctx.fillStyle = C.mecha;
  ctx.fillRect(x0 - 3, yP(b.h), 1, Math.max(1, yP(b.l) - yP(b.h)));
  ctx.fillStyle = b.c >= b.o ? C.alcista : C.bajista;
  ctx.fillRect(x0 - 4, yP(Math.max(b.o, b.c)), 3, Math.max(1, yP(Math.min(b.o, b.c)) - yP(Math.max(b.o, b.c))));

  for (const n of b.niveles ?? []) {
    const yTop = yP(n.p + paso / 2);
    const h = Math.max(1, altoFila - (altoFila > 4 ? 1 : 0));
    const aB = 0.06 + 0.5 * (n.b / maxNivel);
    const aA = 0.06 + 0.5 * (n.a / maxNivel);
    ctx.fillStyle = `rgba(255,255,255,${aB * 0.75})`;
    ctx.fillRect(x0 + 3, yTop, mitad, h);
    ctx.fillStyle = `rgba(255,255,255,${aA})`;
    ctx.fillRect(x0 + 3 + mitad + 1, yTop, mitad, h);
    if (n.imb !== 0) {
      ctx.strokeStyle = C.blanco;
      ctx.lineWidth = 1;
      const xi = n.imb > 0 ? x0 + 3 + mitad + 1 : x0 + 3;
      ctx.strokeRect(xi + 0.5, yTop + 0.5, mitad - 1, Math.max(0, h - 1));
    }
    if (conTexto) {
      ctx.font = `${Math.min(11, Math.floor(altoFila * 0.8))}px "JetBrains Mono", monospace`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = n.imb < 0 ? '#ffffff' : '#c5c8ce';
      ctx.textAlign = 'right';
      ctx.fillText(fmtQ(n.b), x0 + 1 + mitad, yTop + h / 2);
      ctx.fillStyle = n.imb > 0 ? '#ffffff' : '#c5c8ce';
      ctx.textAlign = 'left';
      ctx.fillText(fmtQ(n.a), x0 + 6 + mitad, yTop + h / 2);
    }
  }
  if (b.poc !== null) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 2.5, yP(b.poc + paso / 2) + 0.5, col - 2, Math.max(1, altoFila - 1));
  }
  ctx.font = FUENTE;
}

function dibujarEventos(
  ctx: CanvasRenderingContext2D,
  eventos: EventoMotor[],
  xDeTiempo: (t: number) => number | null,
  yP: (p: number) => number,
  lo: number,
  hi: number,
): void {
  for (const e of eventos) {
    if (e.precio < lo || e.precio > hi) continue;
    const x = xDeTiempo(e.t);
    if (x === null) continue;
    const y = yP(e.precio);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = C.blanco;
    ctx.fillStyle = C.blanco;
    if (e.tipo === 'bigtrade') {
      const r = Math.min(16, 3 + Math.sqrt(e.magnitud / 250_000) * 4);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (e.lado === 'compra') {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fill();
      } else ctx.stroke();
    } else if (e.tipo === 'iceberg') {
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      if (e.lado === 'venta') ctx.fill();
      else ctx.stroke();
    } else if (e.tipo === 'stoprun') {
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x - 5, y + 5);
      ctx.stroke();
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x - 30, y);
      ctx.lineTo(x + 30, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function dibujarSerie(
  ctx: CanvasRenderingContext2D,
  valores: (number | null)[],
  xDe: (k: number) => number,
  y0: number,
  alto: number,
  areaW: number,
  titulo: string,
  formato: (x: number) => string,
  conDeltas: boolean,
): void {
  ctx.strokeStyle = C.tenue;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y0 + 0.5);
  ctx.lineTo(areaW, y0 + 0.5);
  ctx.stroke();
  const nums = valores.filter((x): x is number => x !== null && Number.isFinite(x));
  ctx.fillStyle = C.eje;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(titulo, 6, y0 + 5);
  if (nums.length < 2) return;
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const y = (x: number) => y0 + 16 + (1 - (x - lo) / (hi - lo)) * (alto - 24);
  if (lo < 0 && hi > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y(0));
    ctx.lineTo(areaW, y(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (conDeltas) {
    // ΔOI por barra: rellena si sube, hueca si baja.
    const dMax = Math.max(1e-9, ...valores.map((x, i) => (i > 0 && x !== null && valores[i - 1] !== null ? Math.abs(x - (valores[i - 1] as number)) : 0)));
    const base = y0 + alto - 4;
    valores.forEach((x, i) => {
      const prev = valores[i - 1];
      if (i === 0 || x === null || prev === null || prev === undefined) return;
      const d = x - prev;
      const h = (Math.abs(d) / dMax) * (alto * 0.35);
      const xx = xDe(i);
      if (d >= 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(xx - 1.5, base - h, 3, h);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.strokeRect(xx - 1, base - h + 0.5, 2, h);
      }
    });
  }
  ctx.strokeStyle = '#e9eaed';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  let empezado = false;
  valores.forEach((x, i) => {
    if (x === null || !Number.isFinite(x)) return;
    if (!empezado) {
      ctx.moveTo(xDe(i), y(x));
      empezado = true;
    } else ctx.lineTo(xDe(i), y(x));
  });
  ctx.stroke();
  ctx.fillStyle = C.eje;
  ctx.textBaseline = 'middle';
  ctx.fillText(formato(hi), areaW + 6, y(hi));
  ctx.fillText(formato(lo), areaW + 6, y(lo));
  const ultimo = nums[nums.length - 1];
  etiquetaEje(ctx, areaW, y(ultimo), formato(ultimo), false);
}

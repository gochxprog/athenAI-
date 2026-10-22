// Lo que pinta la pantalla gigante de la sala (canvas 2D): mercados, velas, la radio de los agentes y las cifras.
export interface DatosMuro {
  /** Velas ya cerradas (o en curso) de cada mercado; `serie` dice de qué son («1 MIN», «10 S»). */
  mercados: { simbolo: string; precio: number | null; velas: VelaMuro[]; serie: string; conexion: string }[];
  /** Lo último que dijeron los agentes (lo más nuevo primero). */
  lineas: { t: number; quien: string; color: string; texto: string }[];
  cifras: { nombre: string; valor: string }[];
}

export const ANCHO_MURO = 2048;
const W = ANCHO_MURO;
export const ALTO_MURO = 640;
const H = ALTO_MURO;
const MONO = 'ui-monospace, Menlo, "DejaVu Sans Mono", monospace';
const TENUE = 'rgba(255,255,255,0.38)';
const hora = (t: number) => new Date(t).toLocaleTimeString('es-ES');
const precioTxt = (p: number) => p.toLocaleString('es-ES', { maximumFractionDigits: p < 100 ? 4 : 1, minimumFractionDigits: p < 100 ? 2 : 1 });

/** Recorta el texto con «…» para que quepa en `ancho` píxeles. */
function caber(g: CanvasRenderingContext2D, s: string, ancho: number) {
  if (g.measureText(s).width <= ancho) return s;
  let n = s.length;
  while (n > 1 && g.measureText(`${s.slice(0, n)}…`).width > ancho) n--;
  return `${s.slice(0, n)}…`;
}

function etiqueta(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.fillStyle = TENUE;
  g.font = `600 17px ${MONO}`;
  g.fillText(s.split('').join(String.fromCharCode(8202)), x, y);
}

const SUBE = '#7ee2a8';
const BAJA = '#a855f7';
const SEG_VELA = 10;
export interface VelaMuro { o: number; h: number; l: number; c: number; v?: number }

/** Velas de 10 s armadas con el precio de cada segundo (solo lo que ya pasó). */
export function velasDe(h: number[]): VelaMuro[] {
  const out = [];
  for (let i = 0; i + 1 < h.length; i += SEG_VELA) {
    const x = h.slice(i, i + SEG_VELA + 1);
    out.push({ o: x[0], h: Math.max(...x), l: Math.min(...x), c: x[x.length - 1] });
  }
  return out;
}

function grafico(g: CanvasRenderingContext2D, m: DatosMuro['mercados'][number], x: number, y: number, w: number, h: number) {
  const vs = m.velas;
  const alto = h - 70;
  if (vs.length < 2) {
    g.fillStyle = TENUE;
    g.font = `400 26px ${MONO}`;
    g.fillText('Esperando precios…', x + 20, y + 60);
    return;
  }
  const lo = Math.min(...vs.map((v) => v.l));
  const hi = Math.max(...vs.map((v) => v.h));
  const py = (v: number) => y + (hi > lo ? (1 - (v - lo) / (hi - lo)) * alto : alto / 2);
  // Rejilla y precios del eje.
  g.font = `400 16px ${MONO}`;
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(x, py(v), w - 110, 1);
    g.fillStyle = TENUE;
    g.fillText(precioTxt(v), x + w - 100, py(v) + 5);
  }
  const paso = (w - 120) / vs.length;
  vs.forEach((v, i) => {
    const cx = x + i * paso + paso / 2;
    g.fillStyle = g.strokeStyle = v.c >= v.o ? SUBE : BAJA;
    g.fillRect(cx - 1, py(v.h), 2, Math.max(1, py(v.l) - py(v.h)));
    g.fillRect(cx - paso * 0.32, Math.min(py(v.o), py(v.c)), paso * 0.64, Math.max(2, Math.abs(py(v.o) - py(v.c))));
  });
  // Línea del último precio.
  const ult = vs[vs.length - 1].c;
  g.fillStyle = '#fff';
  g.fillRect(x, py(ult), w - 110, 1);
  g.fillRect(x + w - 104, py(ult) - 13, 104, 26);
  g.fillStyle = '#000';
  g.font = `600 16px ${MONO}`;
  g.fillText(precioTxt(ult), x + w - 100, py(ult) + 6);
  // Abajo: el volumen de cada vela (si lo hay).
  const maxV = Math.max(0, ...vs.map((v) => v.v ?? 0));
  if (maxV > 0)
    vs.forEach((v, i) => {
      g.fillStyle = v.c >= v.o ? 'rgba(126,226,168,0.35)' : 'rgba(168,85,247,0.35)';
      const bh = ((v.v ?? 0) / maxV) * 50;
      g.fillRect(x + i * paso + paso * 0.18, y + h - bh, paso * 0.64, bh);
    });
}

export function pintarMuro(g: CanvasRenderingContext2D, d: DatosMuro, t: number) {
  g.fillStyle = '#050608';
  g.fillRect(0, 0, W, H);
  // Barra de arriba.
  g.fillStyle = '#fff';
  g.font = `600 24px ${MONO}`;
  g.fillText('ATHENAI · SALA DE CONTROL', 40, 50);
  if (Math.floor(t / 700) % 2 === 0) {
    g.fillStyle = '#ef4444';
    g.beginPath();
    g.arc(470, 42, 8, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = TENUE;
  g.font = `500 20px ${MONO}`;
  g.fillText('EN VIVO', 488, 49);
  g.textAlign = 'right';
  g.fillStyle = '#fff';
  g.font = `500 28px ${MONO}`;
  g.fillText(hora(t), W - 40, 52);
  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(40, 76, W - 80, 2);
  [400, 1480].forEach((x) => g.fillRect(x, 100, 2, H - 140));

  // Izquierda: cada mercado con su precio y el cambio de los últimos 5 min.
  etiqueta(g, 'MERCADOS', 40, 125);
  if (!d.mercados.length) {
    g.fillStyle = TENUE;
    g.font = `400 24px ${MONO}`;
    g.fillText('Sin fuente de datos', 40, 175);
  }
  // El gráfico del centro va pasando de un mercado a otro cada 8 s.
  const actual = d.mercados.length ? Math.floor(t / 8000) % d.mercados.length : -1;
  d.mercados.slice(0, 4).forEach((m, i) => {
    const y = 150 + i * 112;
    const o0 = m.velas[0]?.o;
    const cambio = m.precio !== null && o0 ? (m.precio / o0 - 1) * 100 : null;
    if (i === actual) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(28, y - 6, 352, 100);
    }
    g.fillStyle = m.conexion === 'en-vivo' ? SUBE : '#e5848b';
    g.beginPath();
    g.arc(46, y + 14, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = TENUE;
    g.font = `600 19px ${MONO}`;
    g.fillText(m.simbolo, 62, y + 20);
    g.fillStyle = '#fff';
    g.font = `300 44px ${MONO}`;
    g.fillText(m.precio === null ? '—' : precioTxt(m.precio), 40, y + 70);
    if (cambio !== null) {
      g.fillStyle = cambio >= 0 ? SUBE : BAJA;
      g.font = `500 18px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(`${cambio >= 0 ? '▲' : '▼'} ${Math.abs(cambio).toFixed(2)} %`, 375, y + 20);
      g.textAlign = 'left';
    }
  });

  // Centro: velas del mercado de turno.
  const m = d.mercados[actual];
  if (m) {
    etiqueta(g, `${m.simbolo} · VELAS DE ${m.serie}`, 440, 125);
    grafico(g, m, 440, 160, 1010, H - 200);
  }

  // Derecha: la radio de la sala y las cifras del día.
  etiqueta(g, 'RADIO DE LA SALA', 1515, 125);
  g.font = `400 18px ${MONO}`;
  if (!d.lineas.length) {
    g.fillStyle = TENUE;
    g.fillText('Nadie ha dicho nada todavía.', 1515, 165);
  }
  d.lineas.slice(0, 5).forEach((l, i) => {
    const y = 166 + i * 56;
    g.globalAlpha = 1 - i * 0.1;
    g.fillStyle = l.color;
    g.beginPath();
    g.arc(1521, y - 6, 5, 0, Math.PI * 2);
    g.fill();
    g.font = `600 19px ${MONO}`;
    g.fillText(`${l.quien.toUpperCase()} · ${hora(l.t).slice(0, 5)}`, 1534, y);
    g.fillStyle = '#d9dbdf';
    g.font = `400 19px ${MONO}`;
    g.fillText(caber(g, l.texto, W - 1555), 1515, y + 25);
    g.globalAlpha = 1;
  });
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(1515, 444, W - 1555, 2);
  d.cifras.slice(0, 4).forEach((c, i) => {
    const x = 1515 + (i % 2) * 260;
    const y = 470 + Math.floor(i / 2) * 76;
    g.fillStyle = TENUE;
    g.font = `600 14px ${MONO}`;
    g.fillText(c.nombre.toUpperCase(), x, y + 10);
    g.fillStyle = '#fff';
    g.font = `300 38px ${MONO}`;
    g.fillText(caber(g, c.valor, 240), x, y + 52);
  });

  // Líneas de barrido muy tenues (look de pantalla).
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = (t / 40) % 6; y < H; y += 6) g.fillRect(0, y, W, 1);
}


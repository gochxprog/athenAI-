import type { AgenteId } from '@/data/agentes';

/**
 * Lo que se ve en la pantalla de cada agente (solo decoración de la sala; no lee ni toca datos).
 * Cada función pinta un cuadro en un canvas 2D de ANCHO × ALTO para el instante t (segundos).
 */
export const ANCHO = 256;
export const ALTO = 150;

type Dibujo = (g: CanvasRenderingContext2D, t: number, color: string) => void;

const TINTA = 'rgba(255,255,255,0.75)';
const TENUE = 'rgba(255,255,255,0.25)';
const MONO = '10px ui-monospace, Menlo, monospace';

/** Ruido suave y determinista (no usa Math.random: la pantalla no salta entre cuadros). */
function onda(x: number, s: number) {
  return Math.sin(x * 0.9 + s) * 0.5 + Math.sin(x * 0.37 + s * 1.7) * 0.35 + Math.sin(x * 2.3 + s * 0.4) * 0.15;
}

function titulo(g: CanvasRenderingContext2D, texto: string, color: string) {
  g.fillStyle = color;
  g.fillRect(8, 9, 4, 4);
  g.fillStyle = TENUE;
  g.font = MONO;
  g.fillText(texto, 16, 14);
}

function curva(g: CanvasRenderingContext2D, ys: number[], x0: number, x1: number, color: string, ancho = 1.5) {
  g.strokeStyle = color;
  g.lineWidth = ancho;
  g.beginPath();
  ys.forEach((y, i) => {
    const x = x0 + ((x1 - x0) * i) / (ys.length - 1);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
}

/** Vigía: grabando el mercado (REC parpadeando, pulso de datos y contador). */
const vigia: Dibujo = (g, t, color) => {
  titulo(g, 'GRABANDO · BTCUSDT', color);
  if (Math.floor(t * 1.5) % 2 === 0) {
    g.fillStyle = '#ef4444';
    g.beginPath();
    g.arc(222, 12, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = TINTA;
  g.font = MONO;
  g.fillText('REC', 196, 15);
  // Pulso tipo electrocardiograma que avanza.
  const ys: number[] = [];
  for (let i = 0; i < 60; i++) {
    const fase = (i + t * 12) % 20;
    ys.push(78 - (fase > 9 && fase < 11 ? (fase < 10 ? 34 : -18) : onda(i + t * 4, 1) * 4));
  }
  curva(g, ys, 10, 246, color);
};

/** Flujo: libro de órdenes (compras a la izquierda, ventas a la derecha). */
const flujo: Dibujo = (g, t, color) => {
  titulo(g, 'ORDER FLOW · LIBRO', color);
  for (let i = 0; i < 9; i++) {
    const y = 26 + i * 12;
    const compra = 20 + (onda(i * 3, t * 1.4) + 1) * 45;
    const venta = 20 + (onda(i * 3 + 7, t * 1.2) + 1) * 45;
    g.fillStyle = color;
    g.globalAlpha = 0.75;
    g.fillRect(124 - compra, y, compra, 8);
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.35;
    g.fillRect(132, y, venta, 8);
    g.globalAlpha = 1;
  }
  g.fillStyle = TENUE;
  g.fillRect(127, 24, 2, 112);
};

/** Rastreador: gráfico de precio que avanza con la zona del régimen sombreada. */
const rastreador: Dibujo = (g, t, color) => {
  titulo(g, 'RÉGIMEN · HISTORIA', color);
  g.fillStyle = color;
  g.globalAlpha = 0.12;
  g.fillRect(120, 22, 80, 118);
  g.globalAlpha = 1;
  const ys: number[] = [];
  for (let i = 0; i < 70; i++) ys.push(82 - onda((i + t * 6) * 0.35, 2) * 34);
  curva(g, ys, 8, 248, TINTA);
  g.fillStyle = TENUE;
  g.font = MONO;
  g.fillText('día gemelo', 128, 134);
};

const CODIGO = [
  'def senal(filas, i):',
  '    f = filas[i]',
  "    if f['absorcion_bid'] > 70:",
  '        return 1',
  "    if f['flujo_5_ratio'] < -0.4:",
  '        return -1',
  '    return 0',
];

/** Programador: escribe código Python letra por letra. */
const programador: Dibujo = (g, t, color) => {
  titulo(g, 'estrategia.py', color);
  g.font = MONO;
  const total = CODIGO.join('\n').length;
  let quedan = Math.floor((t * 14) % (total + 40));
  CODIGO.forEach((linea, i) => {
    const visible = linea.slice(0, Math.max(0, quedan));
    quedan -= linea.length + 1;
    g.fillStyle = TENUE;
    g.fillText(String(i + 1), 8, 34 + i * 15);
    g.fillStyle = /def|return|if/.test(visible.trim().split(' ')[0] ?? '') ? color : TINTA;
    g.fillText(visible, 24, 34 + i * 15);
    if (quedan < 0 && quedan > -(linea.length + 2) && Math.floor(t * 3) % 2 === 0) {
      g.fillStyle = TINTA;
      g.fillRect(24 + g.measureText(visible).width + 1, 26 + i * 15, 5, 10);
    }
  });
};

/** Juez: abanico de Monte Carlo que se va dibujando, con la curva real resaltada. */
const juez: Dibujo = (g, t, color) => {
  titulo(g, 'MONTE CARLO · WALK-FORWARD', color);
  const avance = Math.min(1, ((t * 0.25) % 1.3) / 1);
  const n = Math.max(2, Math.floor(60 * avance));
  for (let k = 0; k < 14; k++) {
    const ys: number[] = [];
    for (let i = 0; i < n; i++) ys.push(120 - i * 0.9 - onda(i * 0.3, k * 2.1) * (6 + i * 0.5));
    curva(g, ys, 10, 10 + (236 * (n - 1)) / 59, 'rgba(255,255,255,0.18)', 1);
  }
  const real: number[] = [];
  for (let i = 0; i < n; i++) real.push(120 - i * 1.1 - onda(i * 0.3, 0.7) * 6);
  curva(g, real, 10, 10 + (236 * (n - 1)) / 59, color, 2);
};

/** Etiquetador: precio con la triple barrera (arriba, abajo y tiempo). */
const etiquetador: Dibujo = (g, t, color) => {
  titulo(g, 'TRIPLE BARRERA', color);
  const x0 = 70 + ((t * 20) % 80);
  g.strokeStyle = color;
  g.setLineDash([4, 3]);
  g.strokeRect(x0, 46, 90, 64);
  g.setLineDash([]);
  const ys: number[] = [];
  for (let i = 0; i < 70; i++) ys.push(80 - onda(i * 0.4, 3) * 26);
  curva(g, ys, 8, 248, TINTA);
  g.fillStyle = TENUE;
  g.font = MONO;
  g.fillText('+1', x0 + 94, 50);
  g.fillText('-1', x0 + 94, 112);
};

/** Lector: un documento (todavía sin motor: la pantalla queda apagada). */
const lector: Dibujo = (g, _t, color) => {
  titulo(g, 'MODELOS · BLOQUE D', color);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = TENUE;
    g.fillRect(12, 30 + i * 14, 120 + ((i * 53) % 100), 4);
  }
};

/** Sintetizador: redacta el informe (todavía sin motor: la pantalla queda apagada). */
const sintetizador: Dibujo = (g, _t, color) => {
  titulo(g, 'INFORME SEMANAL', color);
  g.fillStyle = TINTA;
  g.fillRect(12, 28, 110, 6);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = TENUE;
    g.fillRect(12, 46 + i * 13, 200 - ((i * 37) % 80), 4);
  }
};

/** Guardián: medidores de riesgo (caída del día, pérdidas seguidas) y escudo. */
const guardian: Dibujo = (g, t, color) => {
  titulo(g, 'RIESGO · PAPER', color);
  const barras: [string, number][] = [
    ['caída del día', 0.25 + (onda(t * 0.5, 1) + 1) * 0.12],
    ['pérdidas seguidas', 0.2 + (onda(t * 0.3, 4) + 1) * 0.1],
    ['banda del Juez', 0.4 + (onda(t * 0.4, 7) + 1) * 0.1],
  ];
  g.font = MONO;
  barras.forEach(([nombre, v], i) => {
    const y = 36 + i * 32;
    g.fillStyle = TENUE;
    g.fillText(nombre, 12, y);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(12, y + 6, 160, 8);
    g.fillStyle = color;
    g.fillRect(12, y + 6, 160 * v, 8);
  });
  g.strokeStyle = TINTA;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(214, 48);
  g.lineTo(236, 56);
  g.lineTo(234, 86);
  g.lineTo(214, 104);
  g.lineTo(194, 86);
  g.lineTo(192, 56);
  g.closePath();
  g.stroke();
  g.fillStyle = TINTA;
  g.fillText('OK', 207, 80);
};

/** Ejecutor: velas que avanzan con marcas de compra y venta. */
const ejecutor: Dibujo = (g, t, color) => {
  titulo(g, 'PAPER · BTCUSDT', color);
  const corrimiento = Math.floor(t * 2);
  for (let i = 0; i < 22; i++) {
    const k = i + corrimiento;
    const a = 78 - onda(k * 0.5, 5) * 30;
    const c = 78 - onda((k + 1) * 0.5, 5) * 30;
    const x = 12 + i * 10.8;
    const sube = c < a;
    g.fillStyle = sube ? color : 'rgba(255,255,255,0.45)';
    g.fillRect(x + 4, Math.min(a, c) - 5, 1, Math.abs(c - a) + 10);
    g.fillRect(x, Math.min(a, c), 9, Math.max(2, Math.abs(c - a)));
    if (k % 9 === 0) {
      g.fillStyle = TINTA;
      g.font = MONO;
      g.fillText(sube ? '▲' : '▼', x, sube ? 132 : 30);
    }
  }
};

export const PANTALLAS: Record<AgenteId, Dibujo> = {
  vigia,
  flujo,
  rastreador,
  programador,
  juez,
  etiquetador,
  lector,
  sintetizador,
  guardian,
  ejecutor,
};

// =============================================================================
// Datos DEMO — sin backend, sin APIs reales, sin dinero real.
// Referencia de mercado: BTCUSDT perpetuo (Binance USD-M) en torno a 84.700 USD.
// =============================================================================

export const PRECIO_REFERENCIA = 84_712.5;

export type ModeloId = 'DL-Net-01' | 'LGBM-Flow-02' | 'RF-Alpha-01';

// --- Contadores del motor (coherentes entre sí) -----------------------------
// generadas = aprobadas + rechazadas + en proceso + en cola
export const CONTADORES_INICIALES = {
  hipotesis: 1284,
  aprobadas: 23,
  rechazadas: 1214,
  pruebas: 12,
  cola: 35,
};

// --- Modelos (los que aprenden) ---------------------------------------------
export interface Modelo {
  id: ModeloId;
  tipo: 'Deep Learning' | 'Machine Learning';
  familia: string;
  ubicacion: 'Cerebro' | 'Laboratorio';
  detalle: string;
  auc: number;
  accuracy: number;
  ultimoEntreno: string;
  muestras: number;
}

export const MODELOS: Modelo[] = [
  {
    id: 'DL-Net-01',
    tipo: 'Deep Learning',
    familia: 'Transformer temporal',
    ubicacion: 'Cerebro',
    detalle: '6 capas · 4 cabezas de atención · ventana 128 dollar bars',
    auc: 0.641,
    accuracy: 0.587,
    ultimoEntreno: 'en curso · época 47/120',
    muestras: 1_842_300,
  },
  {
    id: 'LGBM-Flow-02',
    tipo: 'Machine Learning',
    familia: 'LightGBM',
    ubicacion: 'Laboratorio',
    detalle: '1.200 iteraciones · 63 hojas · learning rate 0,03',
    auc: 0.628,
    accuracy: 0.579,
    ultimoEntreno: 'hace 38 min',
    muestras: 1_842_300,
  },
  {
    id: 'RF-Alpha-01',
    tipo: 'Machine Learning',
    familia: 'Random Forest',
    ubicacion: 'Laboratorio',
    detalle: '400 árboles · profundidad máx. 12 · 6 Features',
    auc: 0.604,
    accuracy: 0.566,
    ultimoEntreno: 'hace 2 h 10 min',
    muestras: 1_842_300,
  },
];

// --- Hipótesis (propuestas por los modelos desde los datos) -----------------
export type Tema = 'Order Flow' | 'Volatilidad' | 'Mean Reversion' | 'Momentum';
export const TEMAS: Tema[] = ['Order Flow', 'Volatilidad', 'Mean Reversion', 'Momentum'];

export type EstadoHipotesis = 'Nueva' | 'En cola' | 'En prueba' | 'Aprobada' | 'Rechazada';

export interface Hipotesis {
  id: string;
  titulo: string;
  tema: Tema;
  modelo: ModeloId;
  evidencia: string;
  ocurrencias: number;
  ventana: string;
  confianza: number;
  estado: EstadoHipotesis;
  highlights: { vwap: string; atr: string; delta: string; volumen: string };
}

export const HIPOTESIS: Hipotesis[] = [
  // Order Flow
  { id: 'H-1271', titulo: 'Delta contrario absorbido en el VWAP tras pico de volumen', tema: 'Order Flow', modelo: 'LGBM-Flow-02', evidencia: 'En 412 dollar bars con volumen ≥ 3× la media de 20, el CVD se invirtió a menos de 0,3σ del VWAP y el precio revirtió 0,35 ATR en las 6 barras siguientes en el 58,7% de los casos.', ocurrencias: 412, ventana: '01-jun → 15-oct', confianza: 0.62, estado: 'En prueba', highlights: { vwap: '84.655 (−0,2σ)', atr: '192 USD', delta: '−318 BTC', volumen: '3,1× media' } },
  { id: 'H-1263', titulo: 'Agotamiento comprador tras 5 barras de absorción en el ask', tema: 'Order Flow', modelo: 'DL-Net-01', evidencia: 'La red detectó 156 secuencias con ≥ 5 barras de absorción en el ask seguidas de delta negativo; la reversión media fue de 0,6 ATR con un 61,5% de aciertos fuera de muestra.', ocurrencias: 156, ventana: '01-jun → 15-oct', confianza: 0.66, estado: 'Aprobada', highlights: { vwap: '84.910 (+1,1σ)', atr: '205 USD', delta: '−412 BTC', volumen: '2,4× media' } },
  { id: 'H-1279', titulo: 'Desequilibrio del libro previo a ruptura de máximo de sesión', tema: 'Order Flow', modelo: 'LGBM-Flow-02', evidencia: 'Cuando el desequilibrio bid/ask supera 1,8 durante 3 barras cerca del máximo de sesión, la ruptura se sostiene 4 barras en el 54,1% de 233 casos.', ocurrencias: 233, ventana: '15-jul → 15-oct', confianza: 0.55, estado: 'Nueva', highlights: { vwap: '84.702 (+0,4σ)', atr: '178 USD', delta: '+226 BTC', volumen: '1,9× media' } },
  { id: 'H-1248', titulo: 'Divergencia CVD–precio en nuevos extremos', tema: 'Order Flow', modelo: 'RF-Alpha-01', evidencia: 'Nuevo máximo de 4 h con CVD descendente: la reversión ocurrió en el 51,2% de 174 casos; tras costos el edge desaparece.', ocurrencias: 174, ventana: '01-may → 30-sep', confianza: 0.49, estado: 'Rechazada', highlights: { vwap: '84.120 (+1,6σ)', atr: '231 USD', delta: '−155 BTC', volumen: '1,3× media' } },
  // Volatilidad
  { id: 'H-1275', titulo: 'Compresión de ATR con Open Interest creciente antes de expansión', tema: 'Volatilidad', modelo: 'DL-Net-01', evidencia: 'ATR 5m bajo el percentil 10 durante 40 barras con OI +2,5%: la expansión direccional ≥ 1 ATR llegó en 4–8 barras en el 63,8% de 94 casos.', ocurrencias: 94, ventana: '01-jun → 15-oct', confianza: 0.6, estado: 'En prueba', highlights: { vwap: '84.690 (0,0σ)', atr: '118 USD (P8)', delta: '+42 BTC', volumen: '0,7× media' } },
  { id: 'H-1259', titulo: 'Reversión tras toque de banda de 2,1 ATR con OI decreciente', tema: 'Volatilidad', modelo: 'RF-Alpha-01', evidencia: 'Con el precio a +2,1 ATR del VWAP y OI cayendo > 3%, el retorno al VWAP en 12 barras ocurrió en el 57,9% de 142 casos.', ocurrencias: 142, ventana: '01-jun → 15-oct', confianza: 0.57, estado: 'En cola', highlights: { vwap: '84.240 (+2,1σ)', atr: '214 USD', delta: '−96 BTC', volumen: '1,6× media' } },
  { id: 'H-1281', titulo: 'Régimen de volatilidad alterno entre sesión de Asia y Londres', tema: 'Volatilidad', modelo: 'DL-Net-01', evidencia: 'El modelo agrupa 61 días donde un ATR de Asia < P20 precede a una apertura de Londres con rango > 1,8 ATR.', ocurrencias: 61, ventana: '01-ago → 15-oct', confianza: 0.52, estado: 'Nueva', highlights: { vwap: '84.580 (−0,3σ)', atr: '141 USD', delta: '+18 BTC', volumen: '0,9× media' } },
  { id: 'H-1237', titulo: 'Expansión posterior a liquidaciones en cascada', tema: 'Volatilidad', modelo: 'LGBM-Flow-02', evidencia: 'Tras caídas de OI > 4% en 5 minutos, la continuación fue del 49,6% (n = 118); indistinguible del azar en el luck test.', ocurrencias: 118, ventana: '01-may → 30-sep', confianza: 0.47, estado: 'Rechazada', highlights: { vwap: '83.910 (−2,4σ)', atr: '296 USD', delta: '−1.140 BTC', volumen: '4,8× media' } },
  // Mean Reversion
  { id: 'H-1266', titulo: 'Reversión al VWAP en rangos de ATR bajo', tema: 'Mean Reversion', modelo: 'RF-Alpha-01', evidencia: 'Con ATR bajo el percentil 15, el precio volvió al VWAP desde ±0,8σ en el 64,3% de 289 casos, con un R medio de 1,2 neto de costos.', ocurrencias: 289, ventana: '01-jun → 15-oct', confianza: 0.64, estado: 'Aprobada', highlights: { vwap: '84.705 (−0,8σ)', atr: '126 USD', delta: '+64 BTC', volumen: '0,8× media' } },
  { id: 'H-1277', titulo: 'Retorno al punto de control del volumen de la sesión previa', tema: 'Mean Reversion', modelo: 'LGBM-Flow-02', evidencia: 'Las aperturas a > 0,5 ATR del POC previo regresaron al POC en 10 barras en el 56,4% de 202 casos.', ocurrencias: 202, ventana: '15-jul → 15-oct', confianza: 0.56, estado: 'En prueba', highlights: { vwap: '84.630 (−0,5σ)', atr: '167 USD', delta: '−38 BTC', volumen: '1,1× media' } },
  { id: 'H-1254', titulo: 'Exceso de delta en el cierre de la barra de 1 h', tema: 'Mean Reversion', modelo: 'DL-Net-01', evidencia: 'Delta de la última barra de la hora > 2σ: reversión parcial (0,3 ATR) en el 53,0% de 260 casos; el R:R resultó insuficiente.', ocurrencias: 260, ventana: '01-may → 30-sep', confianza: 0.5, estado: 'Rechazada', highlights: { vwap: '84.480 (+0,9σ)', atr: '183 USD', delta: '+505 BTC', volumen: '2,2× media' } },
  { id: 'H-1283', titulo: 'Reversión del funding implícito tras desequilibrio sostenido', tema: 'Mean Reversion', modelo: 'LGBM-Flow-02', evidencia: 'Basis perp–índice > 0,04% durante 30 barras con CVD plano: corrección de 0,4 ATR en el 55,8% de 77 casos.', ocurrencias: 77, ventana: '01-ago → 15-oct', confianza: 0.54, estado: 'Nueva', highlights: { vwap: '84.760 (+0,6σ)', atr: '152 USD', delta: '+12 BTC', volumen: '1,0× media' } },
  // Momentum
  { id: 'H-1269', titulo: 'Continuación tras ruptura del VWAP con volumen > 2×', tema: 'Momentum', modelo: 'DL-Net-01', evidencia: 'Ruptura del VWAP con volumen ≥ 2× y delta a favor: continuación de 3 o más barras en el 62,9% de 318 casos fuera de muestra.', ocurrencias: 318, ventana: '01-jun → 15-oct', confianza: 0.65, estado: 'Aprobada', highlights: { vwap: '84.690 (cruce)', atr: '188 USD', delta: '+374 BTC', volumen: '2,3× media' } },
  { id: 'H-1273', titulo: 'Impulso de Open Interest en ruptura de rango', tema: 'Momentum', modelo: 'LGBM-Flow-02', evidencia: 'OI +3,2% durante la ruptura de un rango de 6 h: continuación de 1 ATR en el 57,1% de 198 casos.', ocurrencias: 198, ventana: '01-jun → 15-oct', confianza: 0.58, estado: 'En prueba', highlights: { vwap: '84.590 (+1,2σ)', atr: '201 USD', delta: '+291 BTC', volumen: '2,0× media' } },
  { id: 'H-1280', titulo: 'Seguimiento de tendencia tras absorción fallida del vendedor', tema: 'Momentum', modelo: 'RF-Alpha-01', evidencia: 'Absorción en el bid que cede en ≤ 2 barras: continuación bajista de 0,8 ATR en el 55,3% de 121 casos.', ocurrencias: 121, ventana: '15-jul → 15-oct', confianza: 0.53, estado: 'Nueva', highlights: { vwap: '84.810 (−1,0σ)', atr: '176 USD', delta: '−268 BTC', volumen: '1,7× media' } },
  { id: 'H-1242', titulo: 'Momentum de apertura de Nueva York', tema: 'Momentum', modelo: 'RF-Alpha-01', evidencia: 'Dirección de los primeros 15 min de NY mantenida 1 h: 50,8% en 221 casos; tras comisión y slippage el resultado es negativo.', ocurrencias: 221, ventana: '01-may → 30-sep', confianza: 0.46, estado: 'Rechazada', highlights: { vwap: '84.350 (+0,7σ)', atr: '219 USD', delta: '+182 BTC', volumen: '1,8× media' } },
];

/** Relaciones entre hipótesis (comparten Features o se derivan una de otra). */
export const RELACIONES_HIPOTESIS: [string, string][] = [
  ['H-1271', 'H-1263'], ['H-1271', 'H-1266'], ['H-1263', 'H-1248'], ['H-1279', 'H-1273'],
  ['H-1279', 'H-1263'], ['H-1275', 'H-1273'], ['H-1275', 'H-1281'], ['H-1259', 'H-1266'],
  ['H-1259', 'H-1237'], ['H-1266', 'H-1277'], ['H-1277', 'H-1254'], ['H-1283', 'H-1277'],
  ['H-1269', 'H-1273'], ['H-1269', 'H-1271'], ['H-1280', 'H-1263'], ['H-1242', 'H-1269'],
  ['H-1237', 'H-1273'], ['H-1254', 'H-1248'], ['H-1281', 'H-1242'], ['H-1280', 'H-1269'],
];

// --- Patrones descubiertos (sin catálogo previo) ----------------------------
export const FEATURES_FIRMA = ['Δ CVD', 'Vol. rel.', 'Dist. VWAP', 'ATR pct.', 'Δ OI', 'Absorción', 'Agotamiento', 'Spread'] as const;

export interface PatronDescubierto {
  id: string;
  descriptor: string;
  modelo: ModeloId;
  ocurrencias: number;
  /** Pesos aprendidos por Feature (−1 … 1), mismo orden que FEATURES_FIRMA. */
  firma: number[];
  horizonte: number;
  donde: { sesion: string; regimen: string; zona: string };
  juez: { winRate: number; profitFactor: number; pValor: number; veredicto: 'Aprobado' | 'Rechazado' | 'En evaluación' };
  descubierto: string;
  ultimaVezMin: number;
  semilla: number;
}

export const PATRONES: PatronDescubierto[] = [
  { id: 'PD-011', descriptor: 'Delta contrario con volumen alto junto al VWAP', modelo: 'LGBM-Flow-02', ocurrencias: 412, firma: [-0.82, 0.74, -0.61, 0.12, -0.08, 0.66, 0.31, -0.05], horizonte: 6, donde: { sesion: 'Londres / NY', regimen: 'Volatilidad media', zona: '±0,3σ del VWAP' }, juez: { winRate: 0.587, profitFactor: 1.41, pValor: 0.031, veredicto: 'En evaluación' }, descubierto: '02-sep', ultimaVezMin: 134, semilla: 11 },
  { id: 'PD-014', descriptor: 'Secuencia de absorción en el ask que precede a delta negativo', modelo: 'DL-Net-01', ocurrencias: 156, firma: [-0.58, 0.49, 0.42, 0.21, -0.33, 0.88, 0.79, 0.04], horizonte: 8, donde: { sesion: 'NY', regimen: 'Tendencia agotada', zona: 'Máximo de sesión' }, juez: { winRate: 0.615, profitFactor: 1.62, pValor: 0.012, veredicto: 'Aprobado' }, descubierto: '27-ago', ultimaVezMin: 41, semilla: 14 },
  { id: 'PD-017', descriptor: 'Compresión de rango con acumulación de Open Interest', modelo: 'DL-Net-01', ocurrencias: 94, firma: [0.08, -0.44, 0.02, -0.91, 0.72, 0.15, -0.12, -0.38], horizonte: 8, donde: { sesion: 'Asia', regimen: 'Volatilidad baja', zona: 'Rango de 6 h' }, juez: { winRate: 0.638, profitFactor: 1.55, pValor: 0.024, veredicto: 'En evaluación' }, descubierto: '11-sep', ultimaVezMin: 302, semilla: 17 },
  { id: 'PD-019', descriptor: 'Ruptura del VWAP acompañada de delta a favor', modelo: 'DL-Net-01', ocurrencias: 318, firma: [0.79, 0.68, 0.55, 0.24, 0.31, -0.18, -0.42, -0.06], horizonte: 4, donde: { sesion: 'Londres / NY', regimen: 'Tendencia', zona: 'Cruce del VWAP' }, juez: { winRate: 0.629, profitFactor: 1.71, pValor: 0.008, veredicto: 'Aprobado' }, descubierto: '19-ago', ultimaVezMin: 12, semilla: 19 },
  { id: 'PD-022', descriptor: 'Retorno al VWAP en régimen de ATR bajo', modelo: 'RF-Alpha-01', ocurrencias: 289, firma: [0.12, -0.36, -0.88, -0.74, -0.05, 0.22, 0.09, -0.21], horizonte: 10, donde: { sesion: 'Asia / Londres', regimen: 'Volatilidad baja', zona: '±0,8σ del VWAP' }, juez: { winRate: 0.643, profitFactor: 1.58, pValor: 0.019, veredicto: 'Aprobado' }, descubierto: '14-ago', ultimaVezMin: 98, semilla: 22 },
  { id: 'PD-025', descriptor: 'Extremo nuevo con CVD divergente', modelo: 'RF-Alpha-01', ocurrencias: 174, firma: [-0.66, 0.18, 0.71, 0.33, -0.12, 0.08, 0.52, 0.11], horizonte: 10, donde: { sesion: 'Todas', regimen: 'Mixto', zona: 'Máximo / mínimo de 4 h' }, juez: { winRate: 0.512, profitFactor: 0.94, pValor: 0.21, veredicto: 'Rechazado' }, descubierto: '05-ago', ultimaVezMin: 501, semilla: 25 },
  { id: 'PD-028', descriptor: 'Liquidaciones en cascada seguidas de vacío de liquidez', modelo: 'LGBM-Flow-02', ocurrencias: 118, firma: [-0.91, 0.95, -0.47, 0.88, -0.83, -0.22, 0.14, 0.67], horizonte: 5, donde: { sesion: 'NY', regimen: 'Volatilidad extrema', zona: 'Sin zona fija' }, juez: { winRate: 0.496, profitFactor: 0.88, pValor: 0.34, veredicto: 'Rechazado' }, descubierto: '29-jul', ultimaVezMin: 1_340, semilla: 28 },
  { id: 'PD-031', descriptor: 'Desequilibrio del libro sostenido cerca del máximo', modelo: 'LGBM-Flow-02', ocurrencias: 233, firma: [0.47, 0.39, 0.36, 0.05, 0.28, -0.31, -0.08, -0.52], horizonte: 4, donde: { sesion: 'Londres', regimen: 'Tendencia', zona: 'Máximo de sesión' }, juez: { winRate: 0.541, profitFactor: 1.18, pValor: 0.072, veredicto: 'En evaluación' }, descubierto: '08-oct', ultimaVezMin: 23, semilla: 31 },
];

// --- Estrategias (propuestas por los modelos, con veredicto del Juez) -------
export type Veredicto = 'Aprobada' | 'Rechazada' | 'En evaluación';

export interface Estrategia {
  id: string;
  nombre: string;
  origen: string;
  modelo: ModeloId;
  veredicto: Veredicto;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  maxDD: number;
  sharpe: number;
  sortino: number;
  overfitting: number;
  trades: number;
  pValor: number;
  fecha: string;
  motivo?: string;
  semilla: number;
}

export const ESTRATEGIAS: Estrategia[] = [
  { id: 'E-087', nombre: 'Continuación tras ruptura del VWAP', origen: 'H-1269 · PD-019', modelo: 'DL-Net-01', veredicto: 'Aprobada', winRate: 0.629, profitFactor: 1.71, expectancy: 38.4, maxDD: -2_140, sharpe: 1.86, sortino: 2.47, overfitting: 9, trades: 318, pValor: 0.008, fecha: '14-oct', semilla: 87 },
  { id: 'E-084', nombre: 'Reversión al VWAP con ATR bajo', origen: 'H-1266 · PD-022', modelo: 'RF-Alpha-01', veredicto: 'Aprobada', winRate: 0.643, profitFactor: 1.58, expectancy: 29.1, maxDD: -1_860, sharpe: 1.64, sortino: 2.12, overfitting: 13, trades: 289, pValor: 0.019, fecha: '11-oct', semilla: 84 },
  { id: 'E-081', nombre: 'Agotamiento tras absorción en el ask', origen: 'H-1263 · PD-014', modelo: 'DL-Net-01', veredicto: 'Aprobada', winRate: 0.615, profitFactor: 1.62, expectancy: 41.7, maxDD: -2_420, sharpe: 1.52, sortino: 1.98, overfitting: 16, trades: 156, pValor: 0.012, fecha: '07-oct', semilla: 81 },
  { id: 'E-090', nombre: 'Delta contrario absorbido en el VWAP', origen: 'H-1271 · PD-011', modelo: 'LGBM-Flow-02', veredicto: 'En evaluación', winRate: 0.587, profitFactor: 1.41, expectancy: 22.6, maxDD: -2_780, sharpe: 1.31, sortino: 1.66, overfitting: 19, trades: 412, pValor: 0.031, fecha: '19-oct', semilla: 90 },
  { id: 'E-089', nombre: 'Expansión tras compresión con OI', origen: 'H-1275 · PD-017', modelo: 'DL-Net-01', veredicto: 'En evaluación', winRate: 0.638, profitFactor: 1.55, expectancy: 47.9, maxDD: -2_310, sharpe: 1.44, sortino: 1.91, overfitting: 21, trades: 94, pValor: 0.024, fecha: '18-oct', semilla: 89 },
  { id: 'E-088', nombre: 'Ruptura de rango con impulso de OI', origen: 'H-1273', modelo: 'LGBM-Flow-02', veredicto: 'Rechazada', winRate: 0.571, profitFactor: 1.19, expectancy: 9.8, maxDD: -4_960, sharpe: 0.84, sortino: 1.02, overfitting: 31, trades: 198, pValor: 0.047, fecha: '16-oct', motivo: 'Drawdown excedido: 14,2% (límite 12%)', semilla: 88 },
  { id: 'E-086', nombre: 'Divergencia CVD en extremos', origen: 'H-1248 · PD-025', modelo: 'RF-Alpha-01', veredicto: 'Rechazada', winRate: 0.512, profitFactor: 0.94, expectancy: -4.2, maxDD: -5_620, sharpe: 0.38, sortino: 0.44, overfitting: 38, trades: 174, pValor: 0.21, fecha: '13-oct', motivo: 'Win rate bajo y luck test fallido (p = 0,21)', semilla: 86 },
  { id: 'E-085', nombre: 'Continuación tras liquidaciones', origen: 'H-1237 · PD-028', modelo: 'LGBM-Flow-02', veredicto: 'Rechazada', winRate: 0.496, profitFactor: 0.88, expectancy: -7.9, maxDD: -6_340, sharpe: 0.21, sortino: 0.25, overfitting: 44, trades: 118, pValor: 0.34, fecha: '12-oct', motivo: 'Explicable por azar (luck test p = 0,34)', semilla: 85 },
  { id: 'E-083', nombre: 'Reversión de exceso de delta horario', origen: 'H-1254', modelo: 'DL-Net-01', veredicto: 'Rechazada', winRate: 0.53, profitFactor: 1.04, expectancy: 1.6, maxDD: -3_880, sharpe: 0.52, sortino: 0.61, overfitting: 27, trades: 260, pValor: 0.12, fecha: '09-oct', motivo: 'Ratio R:R insuficiente (0,92 neto)', semilla: 83 },
  { id: 'E-082', nombre: 'Momentum de apertura de Nueva York', origen: 'H-1242', modelo: 'RF-Alpha-01', veredicto: 'Rechazada', winRate: 0.508, profitFactor: 0.97, expectancy: -2.3, maxDD: -4_410, sharpe: 0.33, sortino: 0.4, overfitting: 35, trades: 221, pValor: 0.18, fecha: '08-oct', motivo: 'Costo de comisión y slippage supera el edge', semilla: 82 },
  { id: 'E-080', nombre: 'Scalping de spread en el libro', origen: 'H-1219', modelo: 'LGBM-Flow-02', veredicto: 'Rechazada', winRate: 0.552, profitFactor: 0.91, expectancy: -1.1, maxDD: -3_150, sharpe: 0.29, sortino: 0.33, overfitting: 41, trades: 1_204, pValor: 0.09, fecha: '05-oct', motivo: 'Costo de comisión y slippage supera el edge', semilla: 80 },
  { id: 'E-079', nombre: 'Reversión en banda de 2,1 ATR', origen: 'H-1259', modelo: 'RF-Alpha-01', veredicto: 'Rechazada', winRate: 0.579, profitFactor: 1.22, expectancy: 11.4, maxDD: -2_960, sharpe: 1.12, sortino: 1.39, overfitting: 48, trades: 142, pValor: 0.044, fecha: '03-oct', motivo: 'Sobreajuste: PBO 48% (límite 25%)', semilla: 79 },
  { id: 'E-077', nombre: 'Mean reversion intradía multi-Feature', origen: 'H-1201', modelo: 'DL-Net-01', veredicto: 'Rechazada', winRate: 0.601, profitFactor: 1.36, expectancy: 18.2, maxDD: -2_550, sharpe: 1.48, sortino: 1.8, overfitting: 57, trades: 336, pValor: 0.028, fecha: '29-sep', motivo: 'Sobreajuste: degradación IS→OOS del 61%', semilla: 77 },
  { id: 'E-074', nombre: 'Seguimiento de delta en la sesión de Asia', origen: 'H-1188', modelo: 'LGBM-Flow-02', veredicto: 'Rechazada', winRate: 0.468, profitFactor: 0.83, expectancy: -9.6, maxDD: -5_070, sharpe: 0.12, sortino: 0.14, overfitting: 29, trades: 187, pValor: 0.41, fecha: '25-sep', motivo: 'Win rate bajo (46,8%)', semilla: 74 },
];

/** Capital de referencia de los backtests del Juez (USD). */
export const CAPITAL_BACKTEST = 35_000;

// --- Reglas del Juez (bloqueadas: los modelos no pueden modificarlas) --------
export const REGLAS_JUEZ = [
  { regla: 'Sharpe Out-of-Sample (Walk-Forward)', umbral: '≥ 1,00' },
  { regla: 'Degradación In-Sample → Out-of-Sample', umbral: '≤ 35%' },
  { regla: 'Win Rate fuera de muestra', umbral: '≥ 55%' },
  { regla: 'Ratio R:R neto de costos', umbral: '≥ 1,10' },
  { regla: 'Profit Factor neto de costos', umbral: '≥ 1,30' },
  { regla: 'Max Drawdown sobre capital', umbral: '≤ 12%' },
  { regla: 'Luck test (permutación, 1.000 shuffles)', umbral: 'p ≤ 0,05' },
  { regla: 'Probabilidad de sobreajuste (PBO)', umbral: '≤ 25%' },
  { regla: 'Mínimo de operaciones en la muestra', umbral: '≥ 80' },
  { regla: 'Costos: comisión taker + slippage', umbral: '0,04% + 1 tick' },
];

/** Motivos de rechazo acumulados (suman CONTADORES_INICIALES.rechazadas = 1.214). */
export const RECHAZOS_JUEZ = [
  { razon: 'Win rate bajo', cantidad: 312 },
  { razon: 'Ratio R:R insuficiente', cantidad: 268 },
  { razon: 'Costo de comisión / slippage', cantidad: 251 },
  { razon: 'Drawdown excedido', cantidad: 174 },
  { razon: 'Luck test fallido', cantidad: 129 },
  { razon: 'Sobreajuste (PBO alto)', cantidad: 80 },
];

// --- Agentes ------------------------------------------------------------------
export type AgenteId = 'vigia' | 'flujo' | 'rastreador' | 'programador' | 'juez' | 'etiquetador' | 'lector' | 'sintetizador' | 'guardian' | 'ejecutor';

/** Bloque de la hoja de ruta (docs/HOJA_DE_RUTA.md) en el que se construye el motor de cada agente. */
export type Bloque = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface Agente {
  id: AgenteId;
  nombre: string;
  /** 1 Detectores · 2 Contexto y decisión · 3 Ejecución y gestión. */
  capa: 1 | 2 | 3;
  rol: string;
  /** Motor que hace el trabajo real. */
  motor: string;
  bloque: Bloque;
  /** true si su motor ya existe y trabaja con datos reales. */
  real: boolean;
}

export const CAPAS: Record<Agente['capa'], string> = { 1: 'Detectores', 2: 'Contexto y decisión', 3: 'Ejecución y gestión' };

// Regla: ningún agente aparece trabajando sin un motor real detrás.
export const AGENTES: Agente[] = [
  { id: 'vigia', nombre: 'Vigía', capa: 1, rol: 'Vigila las conexiones de cada mercado: estado, latencia, cortes y huecos en los datos', motor: 'Centro de datos · feeds', bloque: 'A', real: true },
  { id: 'flujo', nombre: 'Flujo', capa: 1, rol: 'Lee el Order Flow de cada mercado: absorción, agotamiento, imbalances, CVD, big trades y liquidaciones', motor: 'Motores de Urus', bloque: 'A', real: true },
  { id: 'rastreador', nombre: 'Rastreador', capa: 1, rol: 'Régimen del mercado (rango / tendencia / raro), día gemelo y aviso de "hoy es distinto"', motor: 'Memoria del mercado (HMM + similitud)', bloque: 'B', real: true },
  { id: 'programador', nombre: 'Programador', capa: 2, rol: 'Corre las estrategias que escribes en Python sobre las Features guardadas', motor: 'Editor Python (Pyodide)', bloque: 'C', real: true },
  { id: 'juez', nombre: 'Juez', capa: 2, rol: 'Prueba todo con Walk-Forward, Monte Carlo, Luck test y robustez, y da el veredicto', motor: 'Motor de validación', bloque: 'C', real: true },
  { id: 'etiquetador', nombre: 'Etiquetador', capa: 2, rol: 'Marca en el pasado qué pasó después de cada barra (triple barrera) para que los modelos aprendan', motor: 'Triple barrera', bloque: 'D', real: false },
  { id: 'lector', nombre: 'Lector', capa: 2, rol: 'Entrena los modelos (machine learning y deep learning) y separa las Features útiles del ruido', motor: 'LightGBM / red neuronal', bloque: 'D', real: false },
  { id: 'sintetizador', nombre: 'Sintetizador', capa: 2, rol: 'Resume lo aprendido en hipótesis legibles y en el informe semanal', motor: 'Informes', bloque: 'E', real: false },
  { id: 'guardian', nombre: 'Guardián', capa: 3, rol: 'Riesgo de los bots: límites de pérdida, correlación entre mercados y apagado de emergencia', motor: 'Supervisor de riesgo', bloque: 'E', real: false },
  { id: 'ejecutor', nombre: 'Ejecutor', capa: 3, rol: 'Envía las órdenes de los bots aprobados con órdenes limit (pasivas)', motor: 'Ejecución', bloque: 'E', real: false },
];

// --- Bots (ejecutan solo estrategias aprobadas, con el modelo congelado) -----
export interface Bot {
  id: string;
  nombre: string;
  estrategia: string;
  estado: 'Ejecutando' | 'En espera de señal' | 'Pausado por monitor';
  hashModelo: string;
  operacionesHoy: number;
  pnlHoy: number;
  ddUsado: number;
  ddLimite: number;
  slippageReal: number;
  slippageEsperado: number;
  latenciaMs: number;
  nota: string;
}

export const BOTS: Bot[] = [
  { id: 'B-01', nombre: 'Bot VWAP-Ruptura', estrategia: 'E-087', estado: 'Ejecutando', hashModelo: 'a3f9c12', operacionesHoy: 7, pnlHoy: 412.6, ddUsado: 2.1, ddLimite: 6, slippageReal: 0.8, slippageEsperado: 1, latenciaMs: 38, nota: 'Reglas estáticas · posición abierta' },
  { id: 'B-02', nombre: 'Bot Reversión-ATR', estrategia: 'E-084', estado: 'Ejecutando', hashModelo: '7be0d45', operacionesHoy: 4, pnlHoy: 186.2, ddUsado: 1.4, ddLimite: 6, slippageReal: 1.1, slippageEsperado: 1, latenciaMs: 41, nota: 'Reglas estáticas · posición abierta' },
  { id: 'B-03', nombre: 'Bot Agotamiento-Ask', estrategia: 'E-081', estado: 'En espera de señal', hashModelo: '19c4e8a', operacionesHoy: 2, pnlHoy: -64.3, ddUsado: 0.9, ddLimite: 6, slippageReal: 0.9, slippageEsperado: 1, latenciaMs: 36, nota: 'Sin señal desde hace 47 min' },
  { id: 'B-04', nombre: 'Bot VWAP-Ruptura (réplica B)', estrategia: 'E-087', estado: 'Pausado por monitor', hashModelo: 'a3f9c12', operacionesHoy: 3, pnlHoy: -228.9, ddUsado: 6, ddLimite: 6, slippageReal: 2.6, slippageEsperado: 1, latenciaMs: 112, nota: 'Slippage 2,6× lo esperado · pausa automática' },
];

export interface PosicionPaper {
  id: string;
  bot: string;
  par: 'BTCUSDT';
  lado: 'Long' | 'Short';
  entrada: number;
  tamaño: number;
  stop: number;
  objetivo: number;
  abierta: string;
}

export const POSICIONES: PosicionPaper[] = [
  { id: 'P-3318', bot: 'B-01', par: 'BTCUSDT', lado: 'Long', entrada: 84_596.0, tamaño: 0.12, stop: 84_402.0, objetivo: 84_980.0, abierta: '−18 min' },
  { id: 'P-3321', bot: 'B-02', par: 'BTCUSDT', lado: 'Short', entrada: 84_781.5, tamaño: 0.08, stop: 84_955.0, objetivo: 84_610.0, abierta: '−6 min' },
];

export const CUENTA_PAPER = { capitalInicial: 50_000, realizadoHistorico: 3_184.7, dias: 37 };

// --- Decisiones -------------------------------------------------------------
export interface Decision {
  /** Minutos antes del momento actual (las horas se calculan en vivo). */
  haceMin: number;
  tipo: 'Veredicto del Juez' | 'Ejecución de bot' | 'Monitor' | 'Dinero real';
  ref: string;
  detalle: string;
  resultado: 'APROBADA' | 'RECHAZADA' | 'EJECUTADA' | 'PAUSADO' | 'BLOQUEADO';
}

export const DECISIONES: Decision[] = [
  { haceMin: 6, tipo: 'Ejecución de bot', ref: 'B-02 · E-084', detalle: 'SHORT 0,080 BTC @ 84.781,5 · stop 84.955 · objetivo 84.610', resultado: 'EJECUTADA' },
  { haceMin: 12, tipo: 'Monitor', ref: 'B-04 · E-087', detalle: 'Slippage medio 2,6 ticks frente a 1 tick esperado en 3 operaciones', resultado: 'PAUSADO' },
  { haceMin: 18, tipo: 'Ejecución de bot', ref: 'B-01 · E-087', detalle: 'LONG 0,120 BTC @ 84.596,0 · stop 84.402 · objetivo 84.980', resultado: 'EJECUTADA' },
  { haceMin: 36, tipo: 'Veredicto del Juez', ref: 'E-088 · H-1273', detalle: 'Max Drawdown 14,2% supera el límite del 12%', resultado: 'RECHAZADA' },
  { haceMin: 51, tipo: 'Dinero real', ref: 'E-087', detalle: 'Solicitud de paso a cuenta real: faltan 23 de 60 días de Paper Trading y el OK del dueño', resultado: 'BLOQUEADO' },
  { haceMin: 67, tipo: 'Ejecución de bot', ref: 'B-03 · E-081', detalle: 'SHORT 0,060 BTC @ 84.902,0 cerrada en stop · −64,3 USD', resultado: 'EJECUTADA' },
  { haceMin: 93, tipo: 'Veredicto del Juez', ref: 'E-087 · H-1269', detalle: 'Re-validación semanal: Sharpe OOS 1,66 · PBO 9% · p = 0,008', resultado: 'APROBADA' },
  { haceMin: 116, tipo: 'Veredicto del Juez', ref: 'E-086 · H-1248', detalle: 'Win rate 51,2% y luck test p = 0,21', resultado: 'RECHAZADA' },
  { haceMin: 148, tipo: 'Ejecución de bot', ref: 'B-02 · E-084', detalle: 'LONG 0,080 BTC @ 84.433,0 cerrada en objetivo · +118,4 USD', resultado: 'EJECUTADA' },
  { haceMin: 180, tipo: 'Veredicto del Juez', ref: 'E-085 · H-1237', detalle: 'Resultado explicable por azar: luck test p = 0,34', resultado: 'RECHAZADA' },
  { haceMin: 257, tipo: 'Ejecución de bot', ref: 'B-01 · E-087', detalle: 'LONG 0,120 BTC @ 84.212,5 cerrada en objetivo · +201,0 USD', resultado: 'EJECUTADA' },
  { haceMin: 343, tipo: 'Veredicto del Juez', ref: 'E-084 · H-1266', detalle: 'Re-validación semanal: Sharpe OOS 1,52 · PBO 13% · p = 0,019', resultado: 'APROBADA' },
];

// --- Sistema --------------------------------------------------------------------
export interface Maquina {
  id: string;
  rol: string;
  estado: 'Operativa' | 'Standby' | 'Mantenimiento';
  cpu: number;
  ram: number;
  gpu: number | null;
  procesos: number;
  uptime: string;
  region: string;
}

export const MAQUINAS: Maquina[] = [
  { id: 'srv-dl-01', rol: 'Entrenamiento Deep Learning (Cerebro)', estado: 'Operativa', cpu: 71, ram: 64, gpu: 88, procesos: 3, uptime: '41 d 6 h', region: 'eu-central' },
  { id: 'srv-ml-01', rol: 'Laboratorio ML (RF / LightGBM)', estado: 'Operativa', cpu: 83, ram: 57, gpu: null, procesos: 6, uptime: '41 d 6 h', region: 'eu-central' },
  { id: 'srv-juez-01', rol: 'Juez: Backtest · Walk-Forward · Monte Carlo', estado: 'Operativa', cpu: 92, ram: 48, gpu: null, procesos: 12, uptime: '18 d 2 h', region: 'eu-central' },
  { id: 'srv-recorder', rol: 'Recorder de Order Flow (Binance USD-M)', estado: 'Operativa', cpu: 24, ram: 31, gpu: null, procesos: 2, uptime: '172 d 9 h', region: 'ap-northeast' },
  { id: 'srv-bots-01', rol: 'Ejecución de bots (Paper Trading)', estado: 'Operativa', cpu: 18, ram: 22, gpu: null, procesos: 4, uptime: '37 d 0 h', region: 'ap-northeast' },
  { id: 'srv-db-01', rol: 'Base de datos de series temporales', estado: 'Standby', cpu: 9, ram: 41, gpu: null, procesos: 1, uptime: '96 d 14 h', region: 'eu-central' },
];

export interface Feature {
  nombre: string;
  descripcion: string;
  importancia: number;
  calculoMs: number;
  ventana: string;
}

export const FEATURES: Feature[] = [
  { nombre: 'CVD Delta', descripcion: 'Delta de volumen acumulado (compras agresivas − ventas agresivas)', importancia: 0.214, calculoMs: 0.4, ventana: 'Sesión' },
  { nombre: 'VWAP (distancia σ)', descripcion: 'Distancia del precio al VWAP de sesión en desviaciones', importancia: 0.181, calculoMs: 0.3, ventana: 'Sesión' },
  { nombre: 'Absorción', descripcion: 'Volumen ejecutado contra un nivel sin desplazar el precio', importancia: 0.152, calculoMs: 1.8, ventana: '5 barras' },
  { nombre: 'ATR', descripcion: 'Average True Range y su percentil en 30 días', importancia: 0.127, calculoMs: 0.2, ventana: '14 × 5m' },
  { nombre: 'Open Interest (Δ)', descripcion: 'Cambio porcentual del interés abierto del perpetuo', importancia: 0.109, calculoMs: 0.6, ventana: '15 min' },
  { nombre: 'Agotamiento', descripcion: 'Caída del delta a favor tras un impulso con volumen decreciente', importancia: 0.093, calculoMs: 1.2, ventana: '8 barras' },
  { nombre: 'Volumen relativo', descripcion: 'Volumen de la barra frente a la media de 20 barras', importancia: 0.071, calculoMs: 0.1, ventana: '20 barras' },
  { nombre: 'Desequilibrio del libro', descripcion: 'Ratio bid/ask en los 10 primeros niveles', importancia: 0.053, calculoMs: 0.9, ventana: 'Instantánea' },
];

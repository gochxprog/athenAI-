// Equipo de agentes de la plataforma: cada uno con el motor real que hace su trabajo.
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
  { id: 'flujo', nombre: 'Flujo', capa: 1, rol: 'Lee el Order Flow de cada mercado: absorción, agotamiento, imbalances, CVD, big trades y liquidaciones', motor: 'Motores de Order Flow', bloque: 'A', real: true },
  { id: 'rastreador', nombre: 'Rastreador', capa: 1, rol: 'Régimen del mercado (rango / tendencia / raro), día gemelo y aviso de "hoy es distinto"', motor: 'Memoria del mercado (HMM + similitud)', bloque: 'B', real: true },
  { id: 'programador', nombre: 'Programador', capa: 2, rol: 'Corre las estrategias que escribes en Python sobre las Features guardadas', motor: 'Editor Python (Pyodide)', bloque: 'C', real: true },
  { id: 'juez', nombre: 'Juez', capa: 2, rol: 'Prueba todo con Walk-Forward, Monte Carlo, Luck test y robustez, y da el veredicto', motor: 'Motor de validación', bloque: 'C', real: true },
  { id: 'etiquetador', nombre: 'Etiquetador', capa: 2, rol: 'Marca en el pasado qué pasó después de cada movimiento relevante (CUSUM + triple barrera + meta-etiqueta) para que los modelos aprendan', motor: 'Triple barrera + CUSUM', bloque: 'D', real: true },
  { id: 'lector', nombre: 'Lector', capa: 2, rol: 'Entrena los modelos (machine learning y deep learning) y separa las Features útiles del ruido', motor: 'LightGBM / red neuronal', bloque: 'D', real: false },
  { id: 'sintetizador', nombre: 'Sintetizador', capa: 2, rol: 'Resume lo aprendido en hipótesis legibles y en el informe semanal', motor: 'Informes', bloque: 'E', real: false },
  { id: 'guardian', nombre: 'Guardián', capa: 3, rol: 'Riesgo de los bots: límites de pérdida, correlación entre mercados y apagado de emergencia', motor: 'Guardián (caída del día, pérdidas seguidas, banda del Juez, apagado)', bloque: 'E', real: true },
  { id: 'ejecutor', nombre: 'Ejecutor', capa: 3, rol: 'Ejecuta en Paper las señales de los bots aprobados al precio vivo, con comisión, deslizamiento y funding', motor: 'Ejecutor de Paper', bloque: 'E', real: true },
];

/** Seña de cada agente: su color (camiseta, luz del puesto y punto del rótulo) y algo en la cabeza. */
export type Accesorio = 'antena' | 'auriculares' | 'sombrero' | 'gorra' | 'birrete' | 'cinta' | 'gorro' | 'boina' | 'casco' | 'visera';
export const ESTILO_AGENTE: Record<AgenteId, { color: string; accesorio: Accesorio; nombreAccesorio: string }> = {
  vigia: { color: '#22d3ee', accesorio: 'antena', nombreAccesorio: 'antena' },
  flujo: { color: '#3b82f6', accesorio: 'auriculares', nombreAccesorio: 'auriculares' },
  rastreador: { color: '#22c55e', accesorio: 'sombrero', nombreAccesorio: 'sombrero de explorador' },
  programador: { color: '#a855f7', accesorio: 'gorra', nombreAccesorio: 'gorra al revés' },
  juez: { color: '#eab308', accesorio: 'birrete', nombreAccesorio: 'birrete' },
  etiquetador: { color: '#f97316', accesorio: 'cinta', nombreAccesorio: 'cinta en la frente' },
  lector: { color: '#ec4899', accesorio: 'gorro', nombreAccesorio: 'gorro de lana' },
  sintetizador: { color: '#14b8a6', accesorio: 'boina', nombreAccesorio: 'boina' },
  guardian: { color: '#ef4444', accesorio: 'casco', nombreAccesorio: 'casco' },
  ejecutor: { color: '#84cc16', accesorio: 'visera', nombreAccesorio: 'visera' },
};

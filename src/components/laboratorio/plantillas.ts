// Plantillas de estrategia en Python. Solo usan Features de la fila actual y de filas anteriores.
import type { Proveedor } from '@/motores/almacen/almacen';
import type { Combo } from '@/motores/juez/juez';

export interface EstrategiaGuardada {
  id: string;
  nombre: string;
  codigo: string;
  /** Variantes probadas en total con esta idea (alimenta el Deflated Sharpe: probar mucho tiene coste). */
  ensayos: number;
  ultimoVeredicto?: string;
  /** Mercado y variante de la última prueba del Juez (para calcular su señal en vivo). */
  juzgada?: { proveedor: Proveedor; simbolo: string; combo: Combo };
  actualizada: number;
}

export const PLANTILLAS: { nombre: string; codigo: string }[] = [
  {
    nombre: 'Absorción en el bid',
    codigo: `# Compra cuando hay absorción fuerte en el bid con delta negativo
# (los vendedores agresivos chocan contra un comprador grande) y mantiene N barras.

PARAMETROS = {
    "umbral": [50, 65, 80],    # score mínimo de absorción (0-100)
    "mantener": [5, 10],       # barras que se mantiene la posición
}

def estrategia(filas, p):
    pos = []
    quedan = 0
    for f in filas:
        if f.get("hueco") == 1 or f.get("ventana_evento") == 1:
            quedan = 0                      # sin datos fiables o evento fuerte: fuera
        elif (f.get("absorcion_bid") or 0) >= p["umbral"] and (f.get("delta_ratio") or 0) < 0:
            quedan = p["mantener"]
        pos.append(1 if quedan > 0 else 0)
        quedan = max(0, quedan - 1)
    return pos
`,
  },
  {
    nombre: 'Momentum de CVD',
    codigo: `# Sigue al CVD: si la pendiente del CVD de las últimas 5 barras es fuerte, se pone de su lado.

PARAMETROS = {
    "percentil": [70, 80, 90],   # qué tan fuerte debe ser la pendiente (respecto a lo visto hasta ahora)
}

def estrategia(filas, p):
    pos = []
    vistos = []                    # solo pendientes PASADAS: nada del futuro
    for f in filas:
        x = f.get("cvd_pendiente_5")
        lado = 0
        if x is not None and len(vistos) >= 50:
            orden = sorted(abs(v) for v in vistos[-500:])
            corte = orden[int(len(orden) * p["percentil"] / 100) - 1]
            if abs(x) >= corte:
                lado = 1 if x > 0 else -1
        if x is not None:
            vistos.append(x)
        pos.append(lado)
    return pos
`,
  },
  {
    nombre: 'Reversión tras agotamiento',
    codigo: `# Cuando se confirma un agotamiento comprador, vende; si es vendedor, compra. Mantiene N barras.

PARAMETROS = {
    "umbral": [40, 60],
    "mantener": [8, 15],
}

def estrategia(filas, p):
    pos = []
    lado, quedan = 0, 0
    for f in filas:
        alcista = f.get("agotamiento_prev_alcista") or 0
        bajista = f.get("agotamiento_prev_bajista") or 0
        if alcista >= p["umbral"]:
            lado, quedan = -1, p["mantener"]
        elif bajista >= p["umbral"]:
            lado, quedan = 1, p["mantener"]
        pos.append(lado if quedan > 0 else 0)
        quedan = max(0, quedan - 1)
    return pos
`,
  },
];

const CLAVE = 'athenai.estrategias';

export function leerEstrategias(): EstrategiaGuardada[] {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as EstrategiaGuardada[] | null;
    if (Array.isArray(x) && x.length) return x;
  } catch {
    // Sin almacenamiento local.
  }
  return [{ id: 'e-1', nombre: PLANTILLAS[0].nombre, codigo: PLANTILLAS[0].codigo, ensayos: 0, actualizada: Date.now() }];
}

export function guardarEstrategias(xs: EstrategiaGuardada[]): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(xs));
  } catch {
    // Almacenamiento bloqueado: vale para esta sesión.
  }
}

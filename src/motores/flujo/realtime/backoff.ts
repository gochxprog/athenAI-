/**
 * Backoff exponencial con jitter, compartido por cliente y servidor.
 *
 * El jitter es lo que evita el "efecto manada": si N componentes (o N procesos) pierden la conexión
 * a la vez y todos reintentan con el mismo retardo determinista, los reintentos llegan juntos, vuelven
 * a saturar el servidor y vuelven a fallar a la vez. Con jitter se reparten en el tiempo.
 *
 * Módulo puro (sin timers ni DOM): se prueba de forma determinista inyectando `rng`.
 */
export type JitterMode = "none" | "equal" | "full";

export interface BackoffOptions {
  /** Retardo del primer reintento (antes de jitter). */
  baseMs: number;
  /** Techo del retardo exponencial (antes de jitter). */
  maxMs: number;
  /** `full`: [floor, d]; `equal`: [d/2, d]; `none`: d. */
  jitter?: JitterMode;
  /** Suelo absoluto tras aplicar jitter: evita reintentos "inmediatos" (0 ms) que reabren la tormenta. */
  floorMs?: number;
  /** Factor de crecimiento (2 por defecto). */
  factor?: number;
}

/** `attempt` empieza en 1 (primer reintento). */
export function computeBackoffDelay(
  attempt: number,
  options: BackoffOptions,
  rng: () => number = Math.random,
): number {
  const factor = options.factor ?? 2;
  const exp = Math.min(options.maxMs, options.baseMs * factor ** Math.max(0, attempt - 1));
  const floor = Math.min(options.floorMs ?? 0, exp);
  const mode = options.jitter ?? "full";
  const r = Math.min(1, Math.max(0, rng()));
  const delay =
    mode === "none" ? exp : mode === "equal" ? exp / 2 + (exp / 2) * r : floor + (exp - floor) * r;
  return Math.max(floor, Math.round(delay));
}

/** Contador de intentos + cálculo del siguiente retardo. */
export class Backoff {
  private attempts = 0;

  constructor(
    private readonly options: BackoffOptions,
    private readonly rng: () => number = Math.random,
  ) {}

  /** Devuelve el retardo del siguiente reintento y avanza el contador. */
  next(): number {
    this.attempts += 1;
    return computeBackoffDelay(this.attempts, this.options, this.rng);
  }

  reset(): void {
    this.attempts = 0;
  }

  get attemptCount(): number {
    return this.attempts;
  }
}

/** `Retry-After` en segundos o fecha HTTP → ms (null si no es válido). */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Math.round(Number(trimmed) * 1000));
  const at = Date.parse(trimmed);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

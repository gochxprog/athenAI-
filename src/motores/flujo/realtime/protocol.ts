/**
 * Protocolo de la conexión maestra de tiempo real (cliente ⇄ servidor).
 *
 * UNA conexión SSE por pestaña (`GET /api/realtime/stream`) transporta todos los "topics". El cliente
 * declara qué topics quiere con `POST /api/realtime/subscriptions` enviando el CONJUNTO COMPLETO deseado
 * (idempotente: un reintento o un POST duplicado no puede dejar el estado a medias) y un `rev`
 * creciente (un POST atrasado que llega tarde se ignora).
 *
 * Frames del stream (`event: m`, `data: Envelope`):
 *   { t: <topic>, e: <evento>, d: <payload> }
 * Frames de control (`event: hello | bye`) no llevan topic.
 *
 * Eventos por topic:
 *   kline:SYM:INT        → connected | snapshot | data | provider-error
 *   trades:SYM           → status | trades
 *   book:SYM:DEPTH:GROUP → status | book
 *   bigtrades:SYM        → status | big-trade
 *   (todos)              → attached (el servidor ya engancha el topic; equivale al `onopen` de un SSE propio)
 *                          detached (el servidor lo soltó por un error no recuperable)
 */

export type ParsedTopic =
  | { kind: "kline"; symbol: string; interval: string }
  | { kind: "trades"; symbol: string }
  | { kind: "book"; symbol: string; depth: number; group: number }
  | { kind: "bigtrades"; symbol: string };

export interface Envelope<T = unknown> {
  t: string;
  e: string;
  d: T;
}

export interface HelloPayload {
  sessionId: string;
  heartbeatMs: number;
  serverTime: number;
}


export const SYMBOL_PATTERN = /^[A-Z0-9]{5,20}$/;
const INTERVAL_PATTERN = /^[0-9]{1,2}[smhdwM]$/;

export const BOOK_MIN_DEPTH = 5;
export const BOOK_MAX_DEPTH = 300;
export const BOOK_MAX_GROUP = 1_000;

export function klineTopic(symbol: string, interval: string): string {
  return `kline:${symbol.toUpperCase()}:${interval}`;
}
export function tradesTopic(symbol: string): string {
  return `trades:${symbol.toUpperCase()}`;
}
export function bookTopic(symbol: string, depth: number, group: number): string {
  return `book:${symbol.toUpperCase()}:${depth}:${group}`;
}
export function bigTradesTopic(symbol: string): string {
  return `bigtrades:${symbol.toUpperCase()}`;
}

function intInRange(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/** Valida y descompone un topic. Devuelve null si no es canónico (la forma canónica es la única aceptada). */
export function parseTopic(key: string): ParsedTopic | null {
  if (typeof key !== "string" || key.length > 80) return null;
  const parts = key.split(":");
  const symbol = parts[1];
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) return null;
  switch (parts[0]) {
    case "kline":
      return parts.length === 3 && INTERVAL_PATTERN.test(parts[2]) ? { kind: "kline", symbol, interval: parts[2] } : null;
    case "trades":
      return parts.length === 2 ? { kind: "trades", symbol } : null;
    case "bigtrades":
      return parts.length === 2 ? { kind: "bigtrades", symbol } : null;
    case "book": {
      if (parts.length !== 4) return null;
      const depth = intInRange(parts[2], BOOK_MIN_DEPTH, BOOK_MAX_DEPTH);
      const group = intInRange(parts[3], 1, BOOK_MAX_GROUP);
      return depth !== null && group !== null ? { kind: "book", symbol, depth, group } : null;
    }
    default:
      return null;
  }
}

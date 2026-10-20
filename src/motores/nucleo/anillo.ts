import type { AggTrade } from './tipos';

/** Anillo de capacidad fija para objetos. get(0) = más antiguo. La memoria nunca supera `capacidad`. */
export class Anillo<T> {
  private readonly datos: (T | undefined)[];
  private cabeza = 0;
  private cuenta = 0;

  constructor(readonly capacidad: number) {
    if (!Number.isInteger(capacidad) || capacidad < 1) throw new Error(`Capacidad inválida: ${capacidad}`);
    this.datos = new Array<T | undefined>(capacidad);
  }

  get tamaño(): number {
    return this.cuenta;
  }

  push(valor: T): void {
    if (this.cuenta < this.capacidad) {
      this.datos[(this.cabeza + this.cuenta) % this.capacidad] = valor;
      this.cuenta += 1;
      return;
    }
    this.datos[this.cabeza] = valor;
    this.cabeza = (this.cabeza + 1) % this.capacidad;
  }

  get(i: number): T | undefined {
    if (i < 0 || i >= this.cuenta) return undefined;
    return this.datos[(this.cabeza + i) % this.capacidad];
  }

  ultimo(): T | undefined {
    return this.get(this.cuenta - 1);
  }

  /** Copia de los últimos `n` elementos, del más antiguo al más reciente. */
  ultimos(n: number): T[] {
    const desde = Math.max(0, this.cuenta - n);
    const out: T[] = [];
    for (let i = desde; i < this.cuenta; i += 1) out.push(this.get(i) as T);
    return out;
  }

  vaciar(): void {
    this.datos.fill(undefined);
    this.cabeza = 0;
    this.cuenta = 0;
  }
}

/**
 * Cinta de trades en arrays tipados (≈ 33 bytes por trade, sin objetos por trade).
 * 500.000 trades ≈ 16 MB: varias horas de BTCUSDT para poder reconstruir barras al cambiar de temporalidad.
 */
export class CintaTrades {
  private readonly ts: Float64Array;
  private readonly precio: Float64Array;
  private readonly cantidad: Float64Array;
  private readonly idTrade: Float64Array;
  private readonly makerCompra: Uint8Array;
  private cabeza = 0;
  private cuenta = 0;

  constructor(readonly capacidad = 500_000) {
    this.ts = new Float64Array(capacidad);
    this.precio = new Float64Array(capacidad);
    this.cantidad = new Float64Array(capacidad);
    this.idTrade = new Float64Array(capacidad);
    this.makerCompra = new Uint8Array(capacidad);
  }

  get tamaño(): number {
    return this.cuenta;
  }

  push(t: AggTrade): void {
    const i = this.cuenta < this.capacidad ? (this.cabeza + this.cuenta) % this.capacidad : this.cabeza;
    this.ts[i] = t.timestamp;
    this.precio[i] = t.price;
    this.cantidad[i] = t.quantity;
    this.idTrade[i] = t.aggTradeId;
    this.makerCompra[i] = t.buyerIsMaker ? 1 : 0;
    if (this.cuenta < this.capacidad) this.cuenta += 1;
    else this.cabeza = (this.cabeza + 1) % this.capacidad;
  }

  /** Recorre los trades del más antiguo al más reciente sin crear arrays intermedios. */
  recorrer(simbolo: string, fn: (t: AggTrade) => void): void {
    const tmp: AggTrade = { symbol: simbolo, price: 0, quantity: 0, timestamp: 0, aggTradeId: 0, buyerIsMaker: false };
    for (let k = 0; k < this.cuenta; k += 1) {
      const i = (this.cabeza + k) % this.capacidad;
      tmp.timestamp = this.ts[i];
      tmp.price = this.precio[i];
      tmp.quantity = this.cantidad[i];
      tmp.aggTradeId = this.idTrade[i];
      tmp.buyerIsMaker = this.makerCompra[i] === 1;
      fn(tmp);
    }
  }

  primerTimestamp(): number | null {
    return this.cuenta > 0 ? this.ts[this.cabeza] : null;
  }

  vaciar(): void {
    this.cabeza = 0;
    this.cuenta = 0;
  }
}

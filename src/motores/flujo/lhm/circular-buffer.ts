/**
 * Buffer circular de capacidad fija. Al llenarse sobrescribe el elemento más
 * antiguo: la memoria del historial de liquidez nunca crece sin límite.
 * Acceso cronológico: get(0) = más antiguo, get(size - 1) = más reciente.
 */
export class CircularBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0; // posición del elemento más antiguo
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`CircularBuffer capacity must be a positive integer (got ${capacity})`);
    }
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      this.items[(this.head + this.count) % this.capacity] = item;
      this.count += 1;
      return;
    }
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
  }

  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return this.items[(this.head + index) % this.capacity];
  }

  last(): T | undefined {
    return this.get(this.count - 1);
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}

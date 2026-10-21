// Almacén en disco de la grabadora (VPS): una línea JSON por fila de Features, un archivo por símbolo y día UTC.
//   {datos}/filas/{SIMBOLO}/{AAAA-MM-DD}.jsonl     filas en orden de cierre
//   {datos}/sesiones.jsonl                         una línea por sesión (arranque o recalibración)
// Sin dependencias ni base de datos: si el VPS se apaga a mitad de una escritura, como mucho se pierde la última
// línea (se descarta al leer si está incompleta).
import fs from 'node:fs';
import path from 'node:path';
import type { FilaFeatures } from '../src/motores/nucleo/features';
import type { ParametrosSimbolo } from '../src/motores/nucleo/parametros';

export interface FilaDisco extends FilaFeatures {
  simbolo: string;
  sesion: number;
}

export interface SesionDisco {
  id: number;
  simbolo: string;
  inicio: number;
  parametros: ParametrosSimbolo;
}

const dia = (t: number) => new Date(t).toISOString().slice(0, 10);
const valido = (s: string) => /^[A-Z0-9]{2,20}$/.test(s);

export class AlmacenDisco {
  private pendientes = new Map<string, string[]>();
  private cache: Map<string, ResumenDisco> | null = null;

  constructor(readonly carpeta: string) {
    fs.mkdirSync(path.join(carpeta, 'filas'), { recursive: true });
  }

  private archivo(simbolo: string, t: number): string {
    return path.join(this.carpeta, 'filas', simbolo, `${dia(t)}.jsonl`);
  }

  nuevaSesion(simbolo: string, parametros: ParametrosSimbolo, inicio: number, id: number): SesionDisco {
    const s: SesionDisco = { id, simbolo, inicio, parametros };
    fs.appendFileSync(path.join(this.carpeta, 'sesiones.jsonl'), `${JSON.stringify(s)}\n`);
    return s;
  }

  sesiones(simbolo?: string): SesionDisco[] {
    const f = path.join(this.carpeta, 'sesiones.jsonl');
    if (!fs.existsSync(f)) return [];
    return leerLineas<SesionDisco>(f).filter((s) => !simbolo || s.simbolo === simbolo);
  }

  /** Encola filas; `vaciar()` las escribe (se llama cada pocos segundos). */
  guardar(simbolo: string, sesion: number, filas: readonly FilaFeatures[]): void {
    for (const f of filas) {
      const a = this.archivo(simbolo, f.cierre);
      const xs = this.pendientes.get(a) ?? [];
      xs.push(JSON.stringify({ ...f, simbolo, sesion }));
      this.pendientes.set(a, xs);
    }
  }

  vaciar(): number {
    let n = 0;
    for (const [a, xs] of this.pendientes) {
      fs.mkdirSync(path.dirname(a), { recursive: true });
      fs.appendFileSync(a, `${xs.join('\n')}\n`);
      this.anotar(path.basename(path.dirname(a)), xs);
      n += xs.length;
    }
    this.pendientes.clear();
    return n;
  }

  simbolos(): string[] {
    const d = path.join(this.carpeta, 'filas');
    return fs.existsSync(d) ? fs.readdirSync(d).filter(valido).sort() : [];
  }

  /** Días con datos de un símbolo (ordenados). */
  dias(simbolo: string): string[] {
    if (!valido(simbolo)) return [];
    const d = path.join(this.carpeta, 'filas', simbolo);
    return fs.existsSync(d) ? fs.readdirSync(d).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).map((x) => x.slice(0, 10)).sort() : [];
  }

  /** Filas con cierre > `desde`, en orden, como mucho `limite`. `mas` = quedan más después. */
  leer(simbolo: string, desde: number, limite: number): { filas: FilaDisco[]; mas: boolean } {
    const salida: FilaDisco[] = [];
    const desdeDia = Number.isFinite(desde) && desde > 0 ? dia(desde) : '0000-00-00';
    for (const d of this.dias(simbolo)) {
      if (d < desdeDia) continue;
      for (const f of leerLineas<FilaDisco>(path.join(this.carpeta, 'filas', simbolo, `${d}.jsonl`))) {
        if (!(f.cierre > desde)) continue;
        if (salida.length >= limite) return { filas: salida, mas: true };
        salida.push(f);
      }
    }
    return { filas: salida, mas: false };
  }

  /** Resumen por símbolo: filas, primera y última, y bytes. Se calcula una vez y luego se lleva al día al escribir. */
  resumen(): ResumenDisco[] {
    if (!this.cache) {
      this.cache = new Map();
      for (const s of this.simbolos()) {
        const dias = this.dias(s);
        let filas = 0;
        let bytes = 0;
        for (const d of dias) {
          const buf = fs.readFileSync(path.join(this.carpeta, 'filas', s, `${d}.jsonl`));
          bytes += buf.length;
          for (let i = 0; i < buf.length; i += 1) if (buf[i] === 10) filas += 1;
        }
        const primera = dias.length ? leerLineas<FilaDisco>(path.join(this.carpeta, 'filas', s, `${dias[0]}.jsonl`))[0] : undefined;
        const ultimas = dias.length ? leerLineas<FilaDisco>(path.join(this.carpeta, 'filas', s, `${dias[dias.length - 1]}.jsonl`)) : [];
        this.cache.set(s, { simbolo: s, filas, bytes, desde: primera?.cierre ?? null, hasta: ultimas[ultimas.length - 1]?.cierre ?? null });
      }
    }
    return [...this.cache.values()].sort((a, b) => a.simbolo.localeCompare(b.simbolo));
  }

  private anotar(simbolo: string, lineas: string[]): void {
    if (!this.cache) return;
    const r = this.cache.get(simbolo) ?? { simbolo, filas: 0, bytes: 0, desde: null, hasta: null };
    for (const l of lineas) {
      const cierre = (JSON.parse(l) as FilaDisco).cierre;
      r.filas += 1;
      r.bytes += Buffer.byteLength(l) + 1;
      r.desde ??= cierre;
      r.hasta = Math.max(r.hasta ?? cierre, cierre);
    }
    this.cache.set(simbolo, r);
  }
}

export interface ResumenDisco {
  simbolo: string;
  filas: number;
  desde: number | null;
  hasta: number | null;
  bytes: number;
}

/** Lee un .jsonl descartando líneas vacías o cortadas (un apagón a mitad de escritura). */
export function leerLineas<T>(archivo: string): T[] {
  const out: T[] = [];
  for (const l of fs.readFileSync(archivo, 'utf8').split('\n')) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      // Línea incompleta: se ignora.
    }
  }
  return out;
}

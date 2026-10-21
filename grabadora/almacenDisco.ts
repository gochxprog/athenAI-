// Almacén en disco de la grabadora (VPS). Cada mercado vive AISLADO en su propia carpeta (nunca se mezclan):
//   {datos}/mercados/{binance_btcusdt}/filas/{AAAA-MM-DD}.jsonl   filas de Features en orden de cierre
//   {datos}/mercados/{binance_btcusdt}/sesiones.jsonl             una línea por sesión (arranque o recalibración)
// La carpeta sale de `carpetaMercado(market_id)` (src/motores/mercado/mercadoId.ts), la única definición.
// Sin dependencias ni base de datos: si el VPS se apaga a mitad de una escritura, como mucho se pierde la última
// línea (se descarta al leer si está incompleta).
// Migración: la versión anterior guardaba {datos}/filas/{SIMBOLO}/ y un sesiones.jsonl común. Al arrancar se MUEVEN
// (rename, sin copiar ni borrar datos) a la carpeta de su mercado; el sesiones.jsonl viejo queda como .migrado.
import fs from 'node:fs';
import path from 'node:path';
import type { FilaFeatures } from '../src/motores/nucleo/features';
import type { ParametrosSimbolo } from '../src/motores/nucleo/parametros';
import { carpetaMercado, mercadoDeCarpeta, mercadoId, partesMercado, type MercadoId } from '../src/motores/mercado/mercadoId';

/** La grabadora graba Binance USD-M. */
const PROVEEDOR = 'binance' as const;

export interface FilaDisco extends FilaFeatures {
  mercado: MercadoId;
  simbolo: string;
  sesion: number;
}

export interface SesionDisco {
  id: number;
  mercado: MercadoId;
  simbolo: string;
  inicio: number;
  parametros: ParametrosSimbolo;
}

const dia = (t: number) => new Date(t).toISOString().slice(0, 10);
const valido = (s: string) => /^[A-Z0-9]{2,20}$/.test(s);
const ARCHIVO_DIA = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export class AlmacenDisco {
  private pendientes = new Map<string, { simbolo: string; lineas: string[] }>();
  private cache: Map<string, ResumenDisco> | null = null;
  /** Resultado de la migración del formato anterior (null si no hizo falta). */
  readonly migracion: { filas: number; sesiones: number; error?: string } | null;

  constructor(readonly carpeta: string) {
    fs.mkdirSync(path.join(carpeta, 'mercados'), { recursive: true });
    this.migracion = migrarFormatoAnterior(carpeta);
  }

  /** Carpeta del mercado de un símbolo (null si el símbolo no es válido: nunca se sale de {datos}/mercados). */
  private dirMercado(simbolo: string): string | null {
    if (!valido(simbolo)) return null;
    return path.join(this.carpeta, 'mercados', carpetaMercado(mercadoId(PROVEEDOR, simbolo)));
  }

  private archivo(simbolo: string, t: number): string {
    return path.join(this.dirMercado(simbolo)!, 'filas', `${dia(t)}.jsonl`);
  }

  nuevaSesion(simbolo: string, parametros: ParametrosSimbolo, inicio: number, id: number): SesionDisco {
    const dir = this.dirMercado(simbolo);
    if (!dir) throw new Error(`Símbolo no válido: ${simbolo}`);
    const s: SesionDisco = { id, mercado: mercadoId(PROVEEDOR, simbolo), simbolo, inicio, parametros };
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'sesiones.jsonl'), `${JSON.stringify(s)}\n`);
    return s;
  }

  /** Sesiones de un mercado (o de todos si no se indica), sin repetidos y por id. */
  sesiones(simbolo?: string): SesionDisco[] {
    const lista = simbolo === undefined ? this.simbolos() : valido(simbolo) ? [simbolo] : [];
    const porId = new Map<number, SesionDisco>();
    for (const s of lista) {
      const f = path.join(this.dirMercado(s)!, 'sesiones.jsonl');
      if (!fs.existsSync(f)) continue;
      for (const x of leerLineas<SesionDisco>(f)) porId.set(x.id, { ...x, mercado: mercadoId(PROVEEDOR, s), simbolo: s });
    }
    return [...porId.values()].sort((a, b) => a.id - b.id);
  }

  /** Encola filas; `vaciar()` las escribe (se llama cada pocos segundos). */
  guardar(simbolo: string, sesion: number, filas: readonly FilaFeatures[]): void {
    if (!valido(simbolo)) throw new Error(`Símbolo no válido: ${simbolo}`);
    const mercado = mercadoId(PROVEEDOR, simbolo);
    for (const f of filas) {
      const a = this.archivo(simbolo, f.cierre);
      const p = this.pendientes.get(a) ?? { simbolo, lineas: [] };
      p.lineas.push(JSON.stringify({ ...f, mercado, simbolo, sesion }));
      this.pendientes.set(a, p);
    }
  }

  vaciar(): number {
    let n = 0;
    for (const [a, p] of this.pendientes) {
      fs.mkdirSync(path.dirname(a), { recursive: true });
      fs.appendFileSync(a, `${p.lineas.join('\n')}\n`);
      this.anotar(p.simbolo, p.lineas);
      n += p.lineas.length;
    }
    this.pendientes.clear();
    return n;
  }

  /** Símbolos con carpeta de mercado propia (de este proveedor). */
  simbolos(): string[] {
    const d = path.join(this.carpeta, 'mercados');
    if (!fs.existsSync(d)) return [];
    const out: string[] = [];
    for (const nombre of fs.readdirSync(d)) {
      const id = mercadoDeCarpeta(nombre);
      if (!id) continue;
      const { proveedor, simbolo } = partesMercado(id);
      if (proveedor === PROVEEDOR) out.push(simbolo);
    }
    return out.sort();
  }

  /** Días con datos de un símbolo (ordenados). */
  dias(simbolo: string): string[] {
    const dir = this.dirMercado(simbolo);
    if (!dir) return [];
    const d = path.join(dir, 'filas');
    return fs.existsSync(d) ? fs.readdirSync(d).filter((x) => ARCHIVO_DIA.test(x)).map((x) => x.slice(0, 10)).sort() : [];
  }

  /** Filas con cierre > `desde`, en orden, como mucho `limite`. `mas` = quedan más después. */
  leer(simbolo: string, desde: number, limite: number): { filas: FilaDisco[]; mas: boolean } {
    const salida: FilaDisco[] = [];
    const dir = this.dirMercado(simbolo);
    if (!dir) return { filas: salida, mas: false };
    const mercado = mercadoId(PROVEEDOR, simbolo);
    const desdeDia = Number.isFinite(desde) && desde > 0 ? dia(desde) : '0000-00-00';
    for (const d of this.dias(simbolo)) {
      if (d < desdeDia) continue;
      for (const f of leerLineas<FilaDisco>(path.join(dir, 'filas', `${d}.jsonl`))) {
        if (!(f.cierre > desde)) continue;
        if (salida.length >= limite) return { filas: salida, mas: true };
        // Las filas grabadas antes de la migración no traían `mercado`: su carpeta lo dice.
        salida.push({ ...f, mercado, simbolo });
      }
    }
    return { filas: salida, mas: false };
  }

  /** Resumen por mercado: filas, primera y última, y bytes. Se calcula una vez y luego se lleva al día al escribir. */
  resumen(): ResumenDisco[] {
    if (!this.cache) {
      this.cache = new Map();
      for (const s of this.simbolos()) {
        const dir = path.join(this.dirMercado(s)!, 'filas');
        const dias = this.dias(s);
        let filas = 0;
        let bytes = 0;
        for (const d of dias) {
          const buf = fs.readFileSync(path.join(dir, `${d}.jsonl`));
          bytes += buf.length;
          for (let i = 0; i < buf.length; i += 1) if (buf[i] === 10) filas += 1;
        }
        const primera = dias.length ? leerLineas<FilaDisco>(path.join(dir, `${dias[0]}.jsonl`))[0] : undefined;
        const ultimas = dias.length ? leerLineas<FilaDisco>(path.join(dir, `${dias[dias.length - 1]}.jsonl`)) : [];
        this.cache.set(s, { mercado: mercadoId(PROVEEDOR, s), simbolo: s, filas, bytes, desde: primera?.cierre ?? null, hasta: ultimas[ultimas.length - 1]?.cierre ?? null });
      }
    }
    return [...this.cache.values()].sort((a, b) => a.simbolo.localeCompare(b.simbolo));
  }

  private anotar(simbolo: string, lineas: string[]): void {
    if (!this.cache) return;
    const r = this.cache.get(simbolo) ?? { mercado: mercadoId(PROVEEDOR, simbolo), simbolo, filas: 0, bytes: 0, desde: null, hasta: null };
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
  mercado: MercadoId;
  simbolo: string;
  filas: number;
  desde: number | null;
  hasta: number | null;
  bytes: number;
}

/**
 * Pasa el formato anterior ({datos}/filas/{SIMBOLO}/ + sesiones.jsonl común) a una carpeta por mercado.
 * Solo MUEVE archivos (rename). Si un día ya existe en el destino, el viejo se deja donde está (no se pierde nada).
 * Es seguro repetirla: las sesiones repetidas se descartan al leer (por id). Si algo falla, la grabadora sigue.
 */
function migrarFormatoAnterior(carpeta: string): { filas: number; sesiones: number; error?: string } | null {
  const viejaFilas = path.join(carpeta, 'filas');
  const viejaSesiones = path.join(carpeta, 'sesiones.jsonl');
  if (!fs.existsSync(viejaFilas) && !fs.existsSync(viejaSesiones)) return null;
  const r = { filas: 0, sesiones: 0 } as { filas: number; sesiones: number; error?: string };
  try {
    if (fs.existsSync(viejaFilas)) {
      for (const simbolo of fs.readdirSync(viejaFilas).filter(valido)) {
        const origen = path.join(viejaFilas, simbolo);
        const destino = path.join(carpeta, 'mercados', carpetaMercado(mercadoId(PROVEEDOR, simbolo)), 'filas');
        fs.mkdirSync(destino, { recursive: true });
        for (const a of fs.readdirSync(origen).filter((x) => ARCHIVO_DIA.test(x))) {
          if (fs.existsSync(path.join(destino, a))) continue;
          fs.renameSync(path.join(origen, a), path.join(destino, a));
          r.filas += 1;
        }
        if (fs.readdirSync(origen).length === 0) fs.rmdirSync(origen);
      }
      if (fs.readdirSync(viejaFilas).length === 0) fs.rmdirSync(viejaFilas);
    }
    if (fs.existsSync(viejaSesiones)) {
      const porSimbolo = new Map<string, string[]>();
      for (const s of leerLineas<{ simbolo?: string }>(viejaSesiones)) {
        if (!s.simbolo || !valido(s.simbolo)) continue;
        porSimbolo.set(s.simbolo, [...(porSimbolo.get(s.simbolo) ?? []), JSON.stringify({ ...s, mercado: mercadoId(PROVEEDOR, s.simbolo) })]);
      }
      for (const [simbolo, lineas] of porSimbolo) {
        const dir = path.join(carpeta, 'mercados', carpetaMercado(mercadoId(PROVEEDOR, simbolo)));
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'sesiones.jsonl'), `${lineas.join('\n')}\n`);
        r.sesiones += lineas.length;
      }
      fs.renameSync(viejaSesiones, `${viejaSesiones}.migrado`);
    }
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
  }
  return r;
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

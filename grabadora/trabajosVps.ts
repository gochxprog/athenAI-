// Trabajos de los agentes en el VPS (fase A2). Cada uno corre en un PROCESO APARTE con tope de memoria (la
// grabadora nunca se frena) y deja su resultado en disco:
//   Rastreador (cada 15 min): régimen de cada mercado (HMM: rango / tendencia / raro), sus gemelos del pasado y el
//     aviso «hoy es distinto». Con las últimas filas (historia + grabado).       → {datos}/agentes/rastreador.json
//   Etiquetador (cada noche): triple barrera sobre las velas de 5 min de TODA la historia, mes por mes (objetivo
//     2 ATR, stop 1,5 ATR, máximo 60 velas). Cada evento con sus Features es una fila del dataset del ML.
//                                                                               → {datos}/ml/etiquetas/{mercado}/{AAAA-MM}.csv
// Un mes ya etiquetado no se repite (solo el mes actual y el anterior, que pueden tener velas nuevas).
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { AlmacenDisco } from './almacenDisco';
import { armarVelas, type VelaLab } from '../src/motores/laboratorio/velas';
import { detectarRegimen } from '../src/motores/memoria/regimen';
import { buscarMemoria } from '../src/motores/memoria/gemelos';
import { datasetCsv, etiquetar } from '../src/motores/etiquetador/etiquetador';
import { mercadoId } from '../src/motores/mercado/mercadoId';
import type { FilaFeatures } from '../src/motores/nucleo/features';

export const ETIQUETAS = { pt: 2, sl: 1.5, tMax: 60, medida: 'atr' as const };
const FILAS_RASTREADOR = 6_000;
/** Velas antes del mes (para que el ATR y la σ ya estén calientes) y después (para cerrar las barreras). */
const CALENTAR = 300;
const nombre = (s: string) => s.replace(/USDT$/, '');

type Pedido = { tipo: 'rastreador' | 'etiquetador'; datos: string; simbolos: string[] };
export type Resultado = { texto: string; grave?: boolean };

/** Historia importada + lo grabado, en orden y sin repetir (la historia primero). */
const almacenes = (datos: string) => [new AlmacenDisco(path.join(datos, 'historia')), new AlmacenDisco(datos)];
function ultimasFilas(datos: string, simbolo: string, n: number): FilaFeatures[] {
  const [h, g] = almacenes(datos);
  const grab = g.leerUltimas(simbolo, n);
  const hist = grab.length >= n ? [] : h.leerUltimas(simbolo, n).filter((f) => !grab.length || f.cierre < grab[0].cierre);
  return [...hist, ...grab].slice(-n).filter((f) => f.close > 0);
}

export function rastrear(datos: string, simbolos: string[]): Resultado {
  const salida: Record<string, unknown> = {};
  const frases: string[] = [];
  let grave = false;
  for (const s of simbolos) {
    const filas = ultimasFilas(datos, s, FILAS_RASTREADOR);
    const r = detectarRegimen(filas);
    const m = buscarMemoria(filas);
    salida[s] = { t: Date.now(), filas: filas.length, regimen: r && { actual: r.actual, probabilidades: r.probabilidades, barrasEnRegimen: r.barrasEnRegimen, util: r.validacion.util, conclusion: r.validacion.conclusion }, distinto: m?.distinto ?? null, gemelos: m?.resumen ?? null };
    if (!r) frases.push(`${nombre(s)}: faltan datos (${filas.length} filas)`);
    else frases.push(`${nombre(s)} ${r.actual} (${Math.round(r.probabilidades[r.actual] * 100)} %)${m?.distinto.aviso ? ' · HOY ES DISTINTO' : ''}`);
    grave ||= !!m?.distinto.aviso;
  }
  escribir(path.join(datos, 'agentes', 'rastreador.json'), salida);
  return { texto: `Régimen: ${frases.join(' · ') || 'sin mercados'}.`, grave };
}

/** Velas de 5 min de unos días (historia + grabado). */
function velasDias(datos: string, simbolo: string, dias: string[]): VelaLab[] {
  const [h, g] = almacenes(datos);
  let ultimo = -Infinity;
  const filas: FilaFeatures[] = [];
  for (const a of [h, g])
    for (const d of dias) {
      const xs = a.leerDia(simbolo, d).filter((f) => f.cierre > ultimo && f.close > 0);
      if (xs.length) {
        filas.push(...xs);
        ultimo = xs[xs.length - 1].cierre;
      }
    }
  filas.sort((x, y) => x.cierre - y.cierre);
  return armarVelas(filas, '5m');
}

export function etiquetarHistoria(datos: string, simbolos: string[]): Resultado {
  const frases: string[] = [];
  const hoy = new Date().toISOString().slice(0, 7);
  const antes = new Date(Date.now() - 32 * 86_400_000).toISOString().slice(0, 7);
  for (const s of simbolos) {
    const dir = path.join(datos, 'ml', 'etiquetas', s.toLowerCase());
    const dias = [...new Set(almacenes(datos).flatMap((a) => a.dias(s)))].sort();
    const meses = [...new Set(dias.map((d) => d.slice(0, 7)))];
    let hechos = 0;
    let eventos = 0;
    meses.forEach((mes, i) => {
      const archivo = path.join(dir, `${mes}.csv`);
      if (fs.existsSync(archivo) && mes !== hoy && mes !== antes) return;
      // El mes con un poco del anterior (calentar) y del siguiente (cerrar las barreras de los últimos eventos).
      const propios = dias.filter((d) => d.startsWith(mes));
      const previos = dias.filter((d) => d.startsWith(meses[i - 1] ?? '-')).slice(-2);
      const siguientes = dias.filter((d) => d.startsWith(meses[i + 1] ?? '-')).slice(0, 1);
      const velas = velasDias(datos, s, [...previos, ...propios, ...siguientes]);
      const desde = Date.parse(`${mes}-01T00:00:00Z`);
      const hasta = Date.parse(`${meses[i + 1] ?? '9999-12'}-01T00:00:00Z`);
      const r = etiquetar(velas, ETIQUETAS, velas.map((v) => v.valores.hueco === 1));
      // Solo los eventos que empiezan dentro del mes (y con CALENTAR velas de pasado): sin repetir entre meses.
      const delMes = { ...r, etiquetas: r.etiquetas.filter((e) => e.inicio >= desde && e.inicio < hasta && e.t0 >= Math.min(CALENTAR, velas.length / 4)) };
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(archivo, datasetCsv(velas, delMes, mercadoId('binance', s)));
      hechos += 1;
      eventos += delMes.etiquetas.length;
    });
    frases.push(`${nombre(s)}: ${hechos} meses etiquetados (${eventos.toLocaleString('es-ES')} eventos) de ${meses.length}`);
  }
  return { texto: `Etiquetas (objetivo 2 ATR · stop 1,5 ATR · 60 velas de 5 min): ${frases.join(' · ') || 'sin mercados'}.` };
}

function escribir(archivo: string, x: unknown) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(x));
}

/** Proceso hijo (`node grabadora.mjs --trabajo`): recibe un pedido, lo corre y contesta. */
export function atenderTrabajo(): void {
  process.once('message', (p: Pedido) => {
    try {
      const r = p.tipo === 'rastreador' ? rastrear(p.datos, p.simbolos) : etiquetarHistoria(p.datos, p.simbolos);
      process.send?.({ ok: r }, undefined, {}, () => process.disconnect?.());
    } catch (e) {
      process.send?.({ error: e instanceof Error ? e.message : String(e) }, undefined, {}, () => process.disconnect?.());
    }
  });
}

/** En la grabadora: lanza el trabajo en un proceso aparte (tope ~1,2 GB) y espera su resultado. */
export function correrTrabajo(tipo: Pedido['tipo'], datos: string, simbolos: string[], lanzar = () => fork(process.argv[1], ['--trabajo'], { execArgv: ['--max-old-space-size=1200'] })): Promise<Resultado> {
  return new Promise((ok, mal) => {
    const hijo = lanzar();
    let listo = false;
    hijo.once('message', (m: { ok?: Resultado; error?: string }) => {
      listo = true;
      if (m.ok) ok(m.ok);
      else mal(new Error(m.error ?? 'sin respuesta'));
    });
    hijo.once('exit', (c) => !listo && mal(new Error(`el proceso se cerró (${c ?? 'sin código'}): probablemente se quedó sin memoria`)));
    hijo.send({ tipo, datos, simbolos } satisfies Pedido);
  });
}

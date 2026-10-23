// Biblioteca en el VPS: cada prueba del Laboratorio queda guardada (aprobada o no), con su código, su veredicto y
// el resultado completo para volver a verlo. Cuenta TODOS los intentos: probar 50 ideas y quedarse con la que salió
// bien también es sobreajuste, y la Biblioteca lo deja a la vista. Desde aquí una aprobada pasa a Paper: el bot lo
// arma el VPS con el veredicto guardado (nadie puede crear un bot «aprobado» desde fuera).
//   {datos}/biblioteca/indice.json          · resúmenes (los últimos MAX_ENTRADAS)
//   {datos}/biblioteca/resultados/{id}.json · resultado completo (los últimos MAX_RESULTADOS)
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MotorPaper } from '../src/motores/paper/motorPaper';
import { COSTOS_POR_DEFECTO } from '../src/motores/juez/costos';
import { mercadoId } from '../src/motores/mercado/mercadoId';
import type { EntradaBiblioteca, PedidoPrueba, ResultadoPrueba } from '../src/motores/laboratorio/prueba';

export const MAX_ENTRADAS = 500;
export const MAX_RESULTADOS = 100;

export interface ApiBiblioteca {
  guardar(p: PedidoPrueba, r: ResultadoPrueba): EntradaBiblioteca;
  lista(): { entradas: EntradaBiblioteca[]; intentos: number };
  resultado(id: string): ResultadoPrueba | null;
  accion(nombre: string, cuerpo: Record<string, unknown>): Promise<unknown>;
}

const escribir = (f: string, texto: string) => {
  fs.writeFileSync(`${f}.tmp`, texto);
  fs.renameSync(`${f}.tmp`, f);
};

export function crearBiblioteca(o: { datos: string; paper?: () => MotorPaper | null; reloj?: () => number }): ApiBiblioteca {
  const dir = path.join(o.datos, 'biblioteca');
  const dirRes = path.join(dir, 'resultados');
  const indice = path.join(dir, 'indice.json');
  const reloj = o.reloj ?? Date.now;
  fs.mkdirSync(dirRes, { recursive: true });
  const leer = (): { entradas: EntradaBiblioteca[]; intentos: number } => {
    try {
      return JSON.parse(fs.readFileSync(indice, 'utf8')) as { entradas: EntradaBiblioteca[]; intentos: number };
    } catch {
      return { entradas: [], intentos: 0 };
    }
  };
  const archivoRes = (id: string) => (/^[a-z0-9-]{4,40}$/.test(id) ? path.join(dirRes, `${id}.json`) : null);

  return {
    guardar(p, r) {
      const j = r.juez;
      const e: EntradaBiblioteca = {
        id: `${reloj().toString(36)}-${randomUUID().slice(0, 6)}`,
        t: reloj(),
        nombre: p.nombre?.trim() || 'Sin nombre',
        simbolo: p.simbolo,
        serie: p.serie,
        fuente: p.fuente,
        codigo: p.codigo,
        combo: r.combos[j.comboVivo] ?? {},
        // La GESTION de la variante que el Juez lleva a vivo (si probó varios RR o stops, la que ganó).
        gestion: r.gestiones?.[j.comboVivo] ?? r.gestion,
        veredicto: j.veredicto,
        resumen: j.resumen,
        score: j.score?.total ?? null,
        ensayos: j.ensayos,
        velas: { total: r.velas.total, desde: r.velas.desde, hasta: r.velas.hasta },
        oos: { sharpe: j.oos.sharpe, retorno: j.oos.retornoTotal, caida: j.oos.maxDrawdown, operaciones: j.oos.operaciones, aciertos: j.oos.aciertos },
        conResultado: true,
      };
      const b = leer();
      // Los resultados completos más viejos se borran (pesan); su resumen se queda.
      const todas = [e, ...b.entradas].slice(0, MAX_ENTRADAS);
      todas.slice(MAX_RESULTADOS).forEach((x) => {
        if (x.conResultado) fs.rmSync(path.join(dirRes, `${x.id}.json`), { force: true });
        x.conResultado = false;
      });
      escribir(path.join(dirRes, `${e.id}.json`), JSON.stringify(r));
      escribir(indice, JSON.stringify({ entradas: todas, intentos: b.intentos + j.ensayos }));
      return e;
    },
    lista: leer,
    resultado(id) {
      const f = archivoRes(id);
      try {
        return f ? (JSON.parse(fs.readFileSync(f, 'utf8')) as ResultadoPrueba) : null;
      } catch {
        return null;
      }
    },
    async accion(nombre, c) {
      const b = leer();
      const e = b.entradas.find((x) => x.id === c.id);
      if (!e) throw new Error('No existe esa prueba en la Biblioteca.');
      if (nombre === 'borrar') {
        fs.rmSync(path.join(dirRes, `${e.id}.json`), { force: true });
        // El intento sigue contado: borrar una prueba no la des-prueba.
        escribir(indice, JSON.stringify({ ...b, entradas: b.entradas.filter((x) => x !== e) }));
        return { ok: true };
      }
      if (nombre !== 'paper') throw new Error(`Acción desconocida: ${nombre}`);
      const motor = o.paper?.();
      if (!motor) throw new Error('Los bots no están activos en esta grabadora.');
      const r = this.resultado(e.id);
      const capital = Number(c.capital ?? 10_000);
      const bot = await motor.crearBot({
        nombre: e.nombre,
        estrategiaId: e.id,
        codigo: e.codigo,
        combo: e.combo,
        proveedor: 'binance',
        simbolo: e.simbolo,
        mercadoAprobado: mercadoId('binance', e.simbolo),
        veredicto: e.veredicto,
        score: e.score,
        capital,
        exposicion: Number(c.exposicion ?? 1),
        costos: COSTOS_POR_DEFECTO,
        retornosJuez: r?.juez.operacionesOos.map((x) => x.retorno) ?? [],
        serie: e.serie,
        reglasSalida: e.gestion,
      });
      e.botId = bot.id;
      escribir(indice, JSON.stringify(b));
      return { bot };
    },
  };
}

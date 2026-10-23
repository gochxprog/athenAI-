// Entrada del Juez a partir de velas (o filas) y de lo que devolvió la estrategia. Un solo lugar para las reglas de
// datos: huecos (corte o cambio de sesión), funding grabado y market_id.
import type { FilaFeatures } from '../nucleo/features';
import type { EntradaJuez } from '../juez/juez';
import type { MercadoId } from '../mercado/mercadoId';
import type { ResultadoEjecucion } from './python';
import type { VelaLab } from './velas';

/** Hueco = la fila/vela marcó un corte de datos o empieza otra sesión de grabación (no se mantiene posición). */
export const huecosDe = (filas: readonly (FilaFeatures & { sesion?: number })[]) => filas.map((f, i) => f.valores.hueco === 1 || (i > 0 && f.sesion !== filas[i - 1].sesion));

export function entradaJuez(velas: readonly (VelaLab & { sesion?: number })[], mercado: MercadoId, ejec: ResultadoEjecucion, extra: Partial<EntradaJuez> = {}): EntradaJuez {
  const funding = velas.map((v) => v.valores.funding_tasa ?? null);
  return {
    mercado,
    cierres: velas.map((v) => v.close),
    tiempos: velas.map((v) => v.cierre),
    huecos: huecosDe(velas),
    funding: funding.some((x) => x !== null) ? funding : undefined,
    combos: ejec.combos,
    posiciones: ejec.posiciones,
    ensayos: ejec.combos.length,
    antiFuturo: ejec.antiFuturo,
    salidas: ejec.gestion ? { reglas: ejec.gestion, velas } : undefined,
    ...(ejec.gestiones ? { salidasPorCombo: ejec.gestiones } : {}),
    ...extra,
  };
}

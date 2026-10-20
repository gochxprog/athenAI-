/**
 * Convención única de desempate del POC — Point of Control (M5/M6).
 *
 * Antes, cada herramienta desempataba a su manera: el footprint histórico
 * prefería el nivel más cercano al cierre (y luego el precio más alto), el
 * live se quedaba con el primer máximo, el microstructure elegía el precio más
 * alto y el Volume Profile también el primer máximo (precio más bajo). La misma
 * vela podía mostrar distinto POC según la herramienta, o según se viera en
 * vivo o en histórico.
 *
 * Regla única, determinista e independiente del orden de los niveles:
 *   1. mayor volumen;
 *   2. en empate de volumen, el nivel más cercano al precio de referencia
 *      (cierre de la vela);
 *   3. si el empate persiste (o no hay referencia), el precio más alto.
 */
export interface PocCandidate {
  price: number;
  volume: number;
}

/** ¿El candidato desplaza al actual como POC según la convención única? */
export function isBetterPoc(
  candidate: PocCandidate,
  current: PocCandidate,
  referenceClose?: number
): boolean {
  if (candidate.volume !== current.volume) return candidate.volume > current.volume;
  if (referenceClose !== undefined) {
    const candidateDistance = Math.abs(candidate.price - referenceClose);
    const currentDistance = Math.abs(current.price - referenceClose);
    if (candidateDistance !== currentDistance) return candidateDistance < currentDistance;
  }
  return candidate.price > current.price;
}

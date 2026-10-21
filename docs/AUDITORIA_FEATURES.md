# Auditoría de las 39 Features (octubre 2026)

Objetivo: que ninguna Feature dependa de la escala (precio del activo, tamaño de la dollar bar, hora de la sesión) y
que ninguna pueda dar NaN, infinito o bloquear el motor en tiempo real. Sin modelos: la selección de Features con
machine learning se hará después de la grabadora 24/7.

Código: `src/motores/nucleo/features.ts` (`construirFila`, catálogo `DEFINICIONES_FEATURES`). Pruebas:
`features.test.ts` y `pipeline.test.ts`.

## 1. Estacionariedad: qué se cambió

Se cambiaron 11 Features. Las nuevas llevan **clave nueva**: las filas grabadas antes no tienen esas claves y quedan
vacías, así nunca se mezclan dos definiciones bajo el mismo nombre. El total sigue en 39.

| Antes | Problema | Ahora | Fórmula |
|---|---|---|---|
| `delta` | En BTC: con dollar bars fijas en USD, el volumen en BTC baja cuando el precio sube | `delta_z` | 0,6745 × (delta − mediana) / MAD de las 120 barras previas, recortado a ±10 |
| `cvd_sesion` | Acumulado sin límite, crece con la hora de la sesión | `cvd_sesion_ratio` | CVD / volumen de la sesión ∈ [−1, 1] |
| `cvd_pendiente_5` | En BTC | `flujo_5_ratio` | Σ delta / Σ volumen de 5 barras ∈ [−1, 1] |
| `duracion_s` | Colas enormes, cambia con la actividad del día | `duracion_z` | z robusto de log(duración) frente a las 120 previas |
| `imb_compra` | Conteo: depende de cuántos niveles tiene la barra (volatilidad) | `imb_compra_frac` | imbalances / niveles ∈ [0, 1] |
| `imb_venta` | Igual | `imb_venta_frac` | Igual |
| `bigtrades_compra_usd` | USD crudos | `bigtrades_compra_frac` | nocional de big trades / nocional de la barra |
| `bigtrades_venta_usd` | USD crudos | `bigtrades_venta_frac` | Igual |
| `liq_largos_usd` | USD crudos | `liq_largos_frac` | nocional liquidado / nocional de la barra |
| `liq_cortos_usd` | USD crudos | `liq_cortos_frac` | Igual |
| `microprice_ticks` | Depende del tick y del spread | `microprice_spread` | (MicroPrice − mid) / (spread / 2) ∈ [−1, 1] |

El z robusto solo usa barras **anteriores** (nunca la actual ni el futuro), necesita al menos 30 y se recorta a ±10
para que un dato extremo no domine. Con menos de 30 barras queda vacío.

## 2. Ya estaban bien (se quedan)

| Feature | Por qué ya es estacionaria |
|---|---|
| retorno, rango_atr, dist_vwap_atr | Retorno relativo y distancias divididas por el ATR |
| delta_ratio, trades_rel | Proporción [−1, 1] y relación con la media de 20 barras |
| stacked_compra / stacked_venta | Conteos pequeños (0–3) |
| poc_pos, delta_poc_pos | Posición dentro de la barra [0, 1] |
| absorción y agotamiento | Puntuación 0–100 |
| icebergs, stop runs, pools barridos | Conteos de eventos raros por barra |
| funding_tasa | Es una tasa |
| oi_delta_pct, oi_delta_z, oi_cuadrante, oi_flush | Porcentaje, z robusto, categoría y señal 0/1 |
| obi_10 | Proporción [−1, 1] |
| pool_ask_dist_atr, pool_bid_dist_atr | Distancias divididas por el ATR |
| ventana_evento, hueco | Señales 0/1 |

## 3. Nulos, NaN e infinitos

- Todas las divisiones pasan por `div(a, b)`: si el divisor es ~0 o algo no es finito, devuelve vacío (nunca NaN ni ±∞).
- Al final de cada fila, cualquier valor no finito se convierte en vacío.
- Si el cálculo de una fila falla, el motor **no se detiene**: la fila sale vacía con `hueco = 1` y el error se cuenta.
- Pruebas: volumen 0, ATR 0, sin libro, MAD 0, menos de 30 barras y un fallo forzado. En una sesión entera de prueba
  todas las Features son finitas o vacías y las acotadas quedan dentro de su rango.

## 4. Lo que usa estas Features

- **Memoria** (régimen y día gemelo): usa las claves nuevas y salta las filas del catálogo anterior.
- **Plantilla «Momentum de CVD»:** usa `flujo_5_ratio`.
- **Datos ya grabados:** siguen en tu carpeta, pero las 11 Features nuevas solo existen desde ahora. Para el Juez y
  el Etiquetador conviene usar datos grabados después de este cambio.

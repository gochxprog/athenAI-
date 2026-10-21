# Auditoría de fuga de información (lookahead bias y división de datos) · octubre 2026

Pregunta: ¿algún motor deja que el futuro se cuele en lo que se usa para elegir o entrenar? Se revisaron
las Features, el Juez (los 10 motores), el Etiquetador y los bots de Paper.

## 1. ¿Se barajan las barras? — No

Búsqueda en todo el código (`shuffle`, `Math.random`, permutaciones):

| Dónde | Qué baraja | ¿Es fuga? |
|---|---|---|
| Monte Carlo (`juez/monteCarlo.ts`) | El ORDEN de las operaciones fuera de muestra, **después** del Walk-Forward | No: es una prueba de estrés del resultado, no entrena ni elige nada |
| Luck test (`juez/luckTest.ts`) | Retornos o entradas al azar para crear estrategias «de suerte» | No: es la distribución nula contra la que se compara |
| PBO (`juez/sobreajuste.ts`) | Combina bloques IS/OOS (CSCV) de todas las variantes | No: está diseñado así para medir el sobreajuste |
| Ids de bots y papers | `Math.random()` para un nombre único | No toca datos |

Ninguna barra de Order Flow se baraja antes de dividir. Las Features se calculan en orden, barra a barra.

## 2. Esquema de validación — Walk-Forward rodante, cronológico y con embargo

`src/motores/juez/walkForward.ts`:

```ts
// Ventanas rolling: IS de L_IS barras → embargo de 20 barras → OOS de L_OOS barras; paso = L_OOS.
for (let t = 0; t + lIs + lOos <= n; t += lOos)
  out.push({ isDesde: t, isHasta: t + lIs - embargo, oosDesde: t + lIs, oosHasta: t + lIs + lOos });

// En cada ventana: θ* = argmax del objetivo SOLO con barras del IS; luego θ* congelado en el OOS.
const { combo } = elegirVariante(e, v.isDesde, v.isHasta, objetivo);
const b = backtest(e.cierres, e.posiciones[combo], e.costos, v.oosDesde, v.oosHasta, e.opciones);
```

- El pasado elige y el futuro valida; los OOS van uno detrás de otro y no se solapan.
- El embargo de 20 barras evita que el final del IS se cuele en el OOS (las Features miran barras previas).
- En el backtest, la posición decidida al cierre de la barra *i* rige en la *i+1*, y en cada tramo se cierra a la fuerza al final.
- Todas las métricas que deciden (Sharpe, Monte Carlo, Luck test, DSR, estabilidad, costos ×2) son **fuera de muestra**.

## 3. Fugas encontradas y corregidas

| # | Dónde | Problema | Corrección |
|---|---|---|---|
| 1 | `juez/juez.ts` → variante para los bots | La variante que se llevaba a Paper (`dentroMuestra.combo`) se elegía con el Sharpe de **toda** la serie, incluido el tramo de prueba | Nueva `comboVivo`: la que el Walk-Forward elegiría hoy con la misma regla (`elegirVariante` sobre las últimas L_IS barras). Es la que usan los bots y la prueba en otro mercado |
| 2 | `juez/robustez.ts` → vecinos | θ* y sus vecinos se elegían y medían con la serie completa (elegir y evaluar con los mismos datos) | θ* se elige solo con las barras anteriores al primer OOS (menos el embargo), y θ* y sus vecinos se miden solo en el tramo fuera de muestra |

`dentroMuestra` se mantiene solo como **referencia optimista** en pantalla (está rotulada así) y no decide nada.

## 4. Lo que ya estaba blindado (verificado)

- **Features:**
  - los z-scores (`delta_z`, `duracion_z`) usan las 120 barras previas, nunca la actual ni el futuro;
  - el ATR usa barras previas;
  - el agotamiento de una barra entra en la fila siguiente;
  - cada evento tiene `disponibleEn ≤ cierre`;
  - el OI usa la última lectura con hora ≤ cierre;
  - prueba: las filas pasadas no cambian al llegar datos nuevos (`pipeline.test.ts`).
- **Estrategias en Python:** el motor Anti-futuro analiza el código (`filas[i + k]`, normalización con toda la serie) y lo ejecuta con la serie cortada en 8 puntos. Si una posición pasada cambia, la estrategia se rechaza.
- **Etiquetador:**
  - σ y E[r] usan solo el pasado;
  - la etiqueta mira hacia delante a propósito: es la «respuesta» del ejemplo de entrenamiento;
  - nunca se usa en vivo; los bots operan con la señal de la estrategia, no con etiquetas;
  - los eventos sin `tMax` barras por delante no se etiquetan;
  - el CSV trae `evento_inicio` y `evento_fin` para **purgar** solapes cuando se entrene un modelo (fase de ML).
- **Bots de Paper:** solo actúan con la señal de la última barra **cerrada** y al precio de ahora; nunca ven barras futuras.

## 5. Pruebas automáticas nuevas (si alguien rompe esto, fallan)

- `walkForward.test.ts`:
  - las ventanas son cronológicas, con embargo y sin solaparse;
  - destrozar el futuro de una ventana no cambia su θ*;
  - `elegirVariante` ignora las barras fuera de su rango.
- `etiquetador.test.ts`:
  - σ y E[r] no cambian al cortar el futuro;
  - la etiqueta de un evento es idéntica con la serie cortada en t₀ + tMax;
  - no se etiquetan eventos sin futuro suficiente.

## 6. Para la fase de machine learning (cuando se haga)

- División siempre cronológica (nunca `shuffle=True`).
- Validación Walk-Forward o K-fold **purgado** con embargo, usando `evento_inicio`/`evento_fin` del Etiquetador.
- La estandarización se ajusta solo con el tramo de entrenamiento.

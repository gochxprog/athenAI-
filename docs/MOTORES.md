# Motores de athenAI: lista de chequeo

Cada función de la plataforma que calcula algo tiene un motor detrás. Cada motor se hace (o se revisa) **uno por
uno** con el mismo proceso:

1. **Qué mide.**
2. **La matemática:** fórmula y lógica, escritas en el código.
3. **Prueba de que está bien:** valores conocidos o calculados a mano. Si no pasa, no se conecta.
4. **Conectado a su pantalla,** con el resultado y la fórmula visibles.
5. **Visto bueno** del usuario, y al siguiente.

Camino de una estrategia: **Juez (motores 1–10) → APROBADA → bot en Paper (debe comportarse como dijo el Juez)
→ dinero real con tamaño pequeño y Guardián.** Las estrategias que encuentre la propia plataforma (patrones,
machine learning) pasan por el mismo Juez.

## Reglas para todo el trabajo
1. **Un cálculo existe una sola vez.** Si hay otra función que hace lo mismo, se elimina y se usa la única.
2. **Una sola entrada al Juez:** `juzgar()`. Las estrategias, las tuyas o las que encuentre la máquina, solo
   entregan posiciones; los costos y las reglas los pone el Juez.
3. **Nada manual.** Los costos y el funding salen de los datos de la fuente. Si falta un dato, se avisa; no se
   inventa.
4. **Solo Binance por ahora.** El diseño no se cierra a otros mercados.

Estado: ✅ verificado con el proceso · 🔍 funciona, falta revisarlo con el proceso · ⬜ por hacer.

## Laboratorio · el Juez ✅ (los 10 motores verificados)

| # | Motor | Qué mide | Archivo | Estado |
|---|---|---|---|---|
| 1 | Backtest | Retorno por barra, operaciones y capital, con costos, funding y sin cruzar huecos | `backtest.ts` + `costos.ts` | ✅ |
| 2 | Métricas | Retorno, CAGR, Sharpe, Sortino, drawdown, Calmar, aciertos, factor de beneficio, esperanza, rachas | `backtest.ts` | ✅ |
| 3 | Walk-Forward | Ventanas rolling IS → OOS (4:1, paso = OOS), θ* por objetivo (Sharpe / Profit Factor / Retorno), embargo, eficiencia WFE | `walkForward.ts` | ✅ |
| 4 | Monte Carlo | Bootstrap o shuffle de las operaciones (1.000–10.000), probabilidad de ruina (≤ 5 %), DD P95, P5/P50/P95, alerta de orden (DD P95 > 2× backtest) | `monteCarlo.ts` | ✅ |
| 5 | Luck test | Permutación de retornos o entradas aleatorias (1.000–10.000), métrica Sharpe / Retorno / Esperanza, p = (c+1)/(N+1), aprueba si p < 0,05; cada escenario usa el Backtest | `luckTest.ts` | ✅ |
| 6 | Robustez | Costos ×2 (PF > 1,2 y retorno > 0), vecinos contiguos (≥ 70 % aceptables, alerta de isla), otro mercado (automático de la misma familia; no destruye capital), estabilidad en 10 sub-periodos por régimen (≥ 60 % y < 90 % de concentración); 0 fallos aprueba, 1 alerta, ≥ 2 rechaza | `robustez.ts` | ✅ |
| 7 | Deflated Sharpe | SR* por valores extremos, σ_SR con asimetría y curtosis, DSR = Φ((SR − SR*)/σ_SR) ≥ 0,95 | `sobreajuste.ts` | ✅ |
| 8 | PBO | CSCV con 16 bloques (12.870 combinaciones), mejor IS por rendimiento acumulado, ω y λ = logit(ω), PBO < 5 % | `sobreajuste.ts` | ✅ |
| 9 | Anti-futuro | Análisis del código (filas[i + k], filas[-1]; aviso de normalización global) y causalidad en 8 cortes (datos recortados y alterados) | `laboratorio/antiFuturo.ts` + `python.ts` | ✅ |
| 10 | Veredicto | Puertas de cero tolerancia (anti-futuro, ruina, PBO, DSR, Luck, robustez) y puntuación 0–100 (WFE 25 %, costos y vecinos 25 %, DSR/PBO 30 %, curva/Luck 20 %): ≥ 75 aprobada para Paper, < 75 con reserva | `veredicto.ts` | ✅ |

## La plataforma busca estrategias sola (Investigación / Conocimiento)

| Motor | Qué mide | Estado |
|---|---|---|
| Etiquetador (`etiquetador/etiquetador.ts`) | CUSUM simétrico (eventos), triple barrera con σ exponencial (TP/SL × σ, tiempo), etiqueta −1/0/+1 y meta-etiqueta; dataset CSV con las Features | ✅ |
| Patrones | Agrupa momentos parecidos y qué pasó después | ⬜ |
| Selección de Features | Qué datos sirven y cuáles son ruido | ⬜ |
| Machine learning (LightGBM) | Probabilidad de ganar por mercado | ⬜ |
| Generador de hipótesis | Convierte lo encontrado en estrategias para el Juez | ⬜ |

## Datos, Order Flow y Memoria (hechos, por revisar con el proceso)

| Módulo | Motores | Estado |
|---|---|---|
| Datos | Fuente Binance, Vigía de huecos, Barras, Almacén, Calendario (tabla de abajo) | ✅ revisado, falta tu visto bueno |
| Order Flow | Los 11 motores revisados uno por uno (tabla de abajo), con pruebas a mano y la pestaña «Cómo funciona cada motor» | ✅ revisado, falta tu visto bueno |
| Memoria | Régimen (HMM), día gemelo / «hoy es distinto», cruce entre mercados (tabla de abajo) | ✅ revisado, falta tu visto bueno |
| Panel General | Lectura del momento, Features extremas | ✅ revisado (correcto) |

## Order Flow · revisión (octubre 2026)

| # | Motor | Resultado de la revisión |
|---|---|---|
| 1 | Libro (DOM) | **Corregido:** el MicroPrice usaba la cantidad del nivel agrupado; ahora usa el mejor bid y ask reales. Las Features usan el OBI y el MicroPrice del motor (antes se recalculaban con los niveles agrupados y se desviaban hasta 1 USD). |
| 2 | Footprint e imbalances | Correcto (diagonal tipo ATAS, stacked ≥ 3, POC con desempate único). |
| 3 | CVD y VWAP | **Corregido:** la pendiente del CVD saltaba al cambiar de sesión (ahora = delta de las 5 últimas barras). El CVD y el VWAP quedan vacíos en las Features si no se vio la sesión desde el inicio o hubo un corte. |
| 4 | Big trades | Correcto (el z es sobre el volumen; se corrigió el comentario que decía nocional). |
| 5 | Absorción | Correcto. |
| 6 | Agotamiento | Correcto y sin mirar al futuro (se conoce al cerrar la barra siguiente). |
| 7 | Icebergs | **Corregido:** con el libro agrupado, los trades se asignaban al nivel equivocado ~50 % de las veces (redondeo en vez de ask hacia arriba / bid hacia abajo). |
| 8 | Stop runs | **Corregido:** la ruptura mínima usaba el tick crudo (0,2 USD en BTC); ahora usa el paso del libro (≈ 2 USD). |
| 9 | Open Interest | Correcto. |
| 10 | Heatmap y pools | **Mejorado:** el umbral automático de los pools se recalcula cada 10 s mientras hay pocas fotos (antes salía de 1–2 fotos y no cambiaba en 5 min). DOM: compras y ventas de 10 s en el nivel correcto. |
| 11 | Liquidaciones y funding | Correcto (precio medio ejecutado × cantidad ejecutada). |

## Datos · revisión (octubre 2026)

| # | Motor | Resultado de la revisión |
|---|---|---|
| 1 | Fuente Binance | **Corregido:** el primer cambio del libro tras la foto aceptaba U = lastUpdateId + 1 (regla del spot); en Futures debe ser U ≤ lastUpdateId ≤ u. Reconexión, funding y liquidaciones correctos. |
| 2 | Vigía de huecos | **Corregido:** no detectaba trades perdidos. Ahora un salto en el aggTradeId marca la fila siguiente con hueco = 1 y los repetidos se ignoran. La primera barra tras abrir la app también es hueco. Se muestra «Trades perdidos» en Datos. |
| 3 | Barras | Correcto (dollar bars: el trade que cruza el umbral pertenece a la barra). |
| 4 | Almacén | Correcto (clave símbolo + cierre + número, escritura en lotes, cambio de sesión = hueco). |
| 5 | Calendario | Correcto. |

## Memoria · revisión (octubre 2026)

| # | Motor | Resultado de la revisión |
|---|---|---|
| 1 | Régimen (HMM) | **Corregido:** el filtro forward arrastraba el estado de antes de un hueco o de otra sesión; ahora se reinicia en cada tramo. Baum-Welch escalado, correcto. |
| 2 | «Hoy es distinto» | Correcto. |
| 3 | Día gemelo | **Corregido:** la mediana de los gemelos con número par tomaba el valor de arriba; ahora es la media de los dos centrales. |
| 4 | Cruce entre mercados | **Corregido:** arrastraba el último precio hasta 15 min y metía retornos 0 falsos (correlación hacia 0); ahora solo cuenta un precio de los 5 min anteriores. |
| 5 | Panel General (lectura, Features extremas) | Correcto. |

## Por conectar o por hacer

| Pantalla | Motor | Estado |
|---|---|---|
| Estrategias | Catálogo con veredicto y curva (usa el Juez) | 🔍 conectado a datos reales |
| Decisiones | Bitácora real (Juez, avisos, registro del motor) | 🔍 conectado a datos reales |
| Paper Trading | Ejecutor (llenado a bid/ask + deslizamiento dinámico, comisión, funding), libro de operaciones en IndexedDB + CSV, banda P5–P95 del Juez, Guardián (caída del día, pérdidas seguidas, sin datos, exposición por nota, apagado de emergencia), avisos | 🔍 hecho, falta tu visto bueno (`paper/`) |
| Máquinas | Telemetría del navegador | 🔍 conectado a datos reales |

## Pendientes conocidos
- **Backtest:** el funding solo se descuenta en datos grabados desde que se guarda (Feature `funding_tasa`).

## Para después (no se construye ahora)
- Fuente de datos de calidad (Databento o Rithmic): añadirla como fuente, con una función que **descargue datos
  históricos**. Así se hace backtesting con años de historia sin esperar a grabar.

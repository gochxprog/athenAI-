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
| Datos | Fuentes (Binance, Rithmic, Urus), Vigía de huecos, Barras, Almacén | 🔍 |
| Order Flow | Footprint, imbalances, absorción, agotamiento, big trades, icebergs, stop runs, OI, libro, pools, CVD, liquidaciones, Features | 🔍 |
| Memoria | Régimen (HMM), día gemelo / «hoy es distinto», cruce entre mercados | 🔍 |
| Panel General | Lectura del momento, Features extremas | 🔍 |

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

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

Estado: ✅ verificado con el proceso · 🔍 funciona, falta revisarlo con el proceso · ⬜ por hacer.

## Laboratorio · el Juez (en curso)

| # | Motor | Qué mide | Archivo | Estado |
|---|---|---|---|---|
| 1 | Backtest | Retorno por barra, operaciones y capital, con costos y sin cruzar huecos | `src/motores/juez/backtest.ts` | ✅ |
| 2 | Métricas | Sharpe, drawdown, aciertos, factor de beneficio, exposición | `backtest.ts` | 🔍 |
| 3 | Walk-Forward | Resultado en tramos que la estrategia no vio, con purga y embargo | `juez.ts` | 🔍 |
| 4 | Monte Carlo | Rango de resultados y riesgo de ruina, barajando las operaciones | `juez.ts` | 🔍 |
| 5 | Luck test | Si el resultado es suerte (p-valor) | `juez.ts` | 🔍 |
| 6 | Robustez | Costos ×2, parámetros vecinos, otro mercado, estabilidad | `juez.ts` | 🔍 |
| 7 | Deflated Sharpe | Sharpe descontando las variantes probadas | `juez.ts` | 🔍 |
| 8 | PBO | Probabilidad de sobreajuste (CSCV) | `juez.ts` | 🔍 |
| 9 | Anti-futuro | Si el código mira datos posteriores | `src/motores/laboratorio/python.ts` | 🔍 |
| 10 | Veredicto | Reglas fijas sobre los motores 1–9 | `juez.ts` | 🔍 |

## La plataforma busca estrategias sola (Investigación / Conocimiento)

| Motor | Qué mide | Estado |
|---|---|---|
| Etiquetador (triple barrera) | Qué pasó después de cada barra: ganancia, stop o tiempo | ⬜ |
| Patrones | Agrupa momentos parecidos y qué pasó después | ⬜ |
| Selección de Features | Qué datos sirven y cuáles son ruido | ⬜ |
| Machine learning (LightGBM) | Probabilidad de ganar por mercado | ⬜ |
| Generador de hipótesis | Convierte lo encontrado en estrategias para el Juez | ⬜ |

## Datos, Order Flow y Memoria (hechos, por revisar con el proceso)

| Módulo | Motores | Estado |
|---|---|---|
| Datos | Fuentes (Binance, Rithmic, Urus, Simulación), Vigía de huecos, Barras, Almacén | 🔍 |
| Order Flow | Footprint, imbalances, absorción, agotamiento, big trades, icebergs, stop runs, OI, libro, pools, CVD, liquidaciones, Features | 🔍 |
| Memoria | Régimen (HMM), día gemelo / «hoy es distinto», cruce entre mercados | 🔍 |
| Panel General | Lectura del momento, Features extremas | 🔍 |

## Por conectar o por hacer

| Pantalla | Motor | Estado |
|---|---|---|
| Estrategias | Catálogo con veredicto y curva (usa el Juez) | ⬜ |
| Decisiones | Bitácora real | ⬜ |
| Paper Trading | Ejecución en Paper, P&L, Guardián | ⬜ |
| Máquinas | Telemetría | ⬜ |

## Pendientes conocidos
- **Backtest:** funding de los perpetuos (cada 8 h). Hace falta grabarlo como dato.
- **Luck test:** hoy recalcula el capital por su cuenta, de forma aditiva. En el motor 5 pasará a usar el Backtest.

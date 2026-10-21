# AthenAI · Quant Agentic

Plataforma de trading cuantitativo con datos de mercado reales (Binance USD-M Futures por defecto; Rithmic por puente). Solo Paper Trading: el dinero real está bloqueado.

**Lista de motores y su estado:** [`docs/MOTORES.md`](docs/MOTORES.md) · **Inventario:** [`docs/INVENTARIO.md`](docs/INVENTARIO.md) · **Hoja de ruta:** [`docs/HOJA_DE_RUTA.md`](docs/HOJA_DE_RUTA.md) · **Un mercado, un juicio:** [`docs/ARQUITECTURA_MERCADOS.md`](docs/ARQUITECTURA_MERCADOS.md) · **Seguridad del VPS:** [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md)

React 18 + Vite + TypeScript + Tailwind CSS · Three.js / React Three Fiber · Framer Motion · Python en el navegador (Pyodide) para las estrategias.

```bash
npm install
npm run dev        # servidor local
npm run build      # typecheck + build de producción en dist/
npm run lint
npm test           # pruebas de todos los motores
```

## Cómo funciona

- **Datos:** Binance → Vigía de huecos → dollar bars → 39 Features por barra (sin escala: ratios, fracciones y z robustos) → almacén en el navegador (IndexedDB, una carpeta por fuente).
- **Order Flow:** libro (DOM), footprint e imbalances, CVD, big trades, absorción, agotamiento, icebergs, stop runs, Open Interest, heatmap de liquidez y pools, liquidaciones y funding (`src/motores/flujo/`).
- **Memoria:** régimen (HMM), «hoy es distinto», día gemelo y cruce entre mercados.
- **Laboratorio:** estrategias en Python y el **Juez** (10 motores: Backtest, Métricas, Walk-Forward, Monte Carlo, Luck test, Robustez, Deflated Sharpe, PBO, Anti-futuro y Veredicto), más el Etiquetador (triple barrera).
- **Paper Trading:** bots de estrategias aprobadas sobre el precio en vivo, con el Guardián (caída del día, pérdidas seguidas, banda del Juez, apagado de emergencia).

Cada motor se revisa con el mismo proceso: qué mide, fórmulas en el código, pruebas con valores calculados a mano, explicación en pantalla y visto bueno.

## Estructura

```
src/
├── modules/          # una vista por módulo
├── components/       # gráficos, laboratorio, Order Flow, Datos, UI
├── motores/
│   ├── flujo/        # motores de Order Flow (con sus pruebas)
│   ├── nucleo/       # barras, pipeline, Features
│   ├── fuentes/      # Binance y puente de Rithmic
│   ├── memoria/      # régimen, gemelos, cruce
│   ├── juez/         # los 10 motores del Juez
│   ├── etiquetador/  # triple barrera + CUSUM
│   ├── mercado/      # market_id: la única identidad de cada mercado
│   ├── paper/        # Ejecutor y Guardián
│   └── worker/       # Web Worker del motor
└── data/agentes.ts   # los 10 agentes
```

Estilo estrictamente monocromo: fondo #000, superficies de vidrio en grises, bordes #2A2A2E. Los estados se expresan con puntos llenos / huecos, signos +/− y etiquetas, nunca con color.

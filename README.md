# AthenAI · Quant Agentic

Frontend de un sistema de trading cuantitativo agéntico. **Solo frontend y en modo DEMO**: no hay backend, ni APIs reales, ni operativa ni dinero reales. Todos los datos se simulan en el navegador.

React 18 + Vite + TypeScript + Tailwind CSS · Three.js / React Three Fiber · Framer Motion.

```bash
npm install
npm run dev        # servidor local
npm run build      # typecheck + build de producción en dist/
npm run lint
```

## Lógica del sistema

- **Modelos (aprenden):** DL-Net-01 (Deep Learning, vive en la esfera del Cerebro), LGBM-Flow-02 y RF-Alpha-01 (Machine Learning, viven en el Laboratorio). Proponen hipótesis y patrones **solo desde datos de mercado / Order Flow**.
- **Juez (decide):** código plano con reglas bloqueadas (Walk-Forward, costos, luck test, sobreajuste). Valida, nunca predice.
- **Bots (ejecutan):** solo estrategias aprobadas, con reglas estáticas y el modelo congelado; nunca reentrenan en vivo.
- **Fuente de datos:** Binance USD-M Futures → Recorder → dollar bars → Features.

## Módulos

| | Módulo | Contenido |
|---|---|---|
| A | Panel General | Fuentes de datos → esfera 3D de Deep Learning → métricas del motor, cadena de flujo y log del día |
| B | Investigación | Constelación 3D de hipótesis por tema, panel de evidencia y envío al Laboratorio |
| C | Conocimiento | Patrones descubiertos (sin catálogo), espacio aprendido, firma por Feature y estadísticas del Juez |
| D | Laboratorio | Pipeline, equity In-Sample / Out-of-Sample con abanico Monte Carlo, reglas del Juez, rechazos, núcleo ML |
| — | Estrategias | Biblioteca con todos los veredictos, incluidas las rechazadas |
| E | Agentes | Sala 3D con Rastreador, Lector, Sintetizador y Flujo, y su consola en tiempo real |
| F | Paper Trading · Decisiones | Bots monitorizados, posiciones en vivo, cuenta real bloqueada y bitácora de decisiones |
| G | Costos · Máquinas · Datos | Gasto por agente y máquina, telemetría de infraestructura, Recorder y Features |

## Estructura

```
src/
├── App.tsx                 # layout + carga diferida de módulos
├── modules/                # una vista por módulo
├── components/
│   ├── three/              # EsferaCerebro (three.js), Constelacion y SalaAgentes3D (R3F)
│   ├── charts/             # Sparkline, BarrasH, CurvaEquityJuez
│   ├── layout/             # Sidebar, Topbar
│   └── ui/                 # Panel, Insignia, Punto, Consola, PanelLateral…
├── data/mock.ts            # datos DEMO coherentes entre sí
├── lib/simulacion.ts       # mercado BTCUSDT, contadores del motor y log en vivo
└── hooks/SistemaDemo.tsx   # reloj único de 1 s que alimenta toda la app
```

Estilo estrictamente monocromo: fondo #000, superficies de vidrio en grises, bordes #2A2A2E. Los estados se expresan con puntos llenos / huecos, signos +/− y etiquetas, nunca con color.

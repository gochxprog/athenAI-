# QUANT-AGENTIC v4.0 PRO

Plataforma de trading cuantitativo institucional. React + Vite + Tailwind CSS + Three.js.

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm run build    # build de producción en dist/
```

## Módulo A: Dashboard Central y Cerebro 3D

```
src/
├── App.jsx                         # shell: TopBar + Sidebar + vista activa
├── pages/DashboardPage.jsx         # layout 3 + Cerebro 3D + 4, log inferior
├── components/
│   ├── layout/   Sidebar, TopBar, navigation.js (jerarquía del menú)
│   ├── dashboard/Brain3D, LeftPanels, RightPanels, EventLog
│   └── ui/       Panel, StatusIndicator
├── hooks/        useClock, useEventLog
└── lib/format.js
```

Paleta estrictamente monocromática: negro `#000000`, cemento `#12151C` / `#2A2D34` / `#3F444E`, blanco.
Todos los valores arrancan en estado standby; no hay datos de demostración.

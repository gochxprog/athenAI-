---
name: senior-trading-architect
description: Modo de trabajo para AthenAI (QUANT-AGENTIC). Úsala SIEMPRE en este repo — motores de Order Flow, Juez (backtest/WF/MC/Luck/DSR/PBO/anti-futuro), Laboratorio, bots/Paper/Terminal, grabadora VPS, UI 3D (cerebro, sala de agentes), ML/DL. Fija modo caveman (ahorro de tokens), mapa del código, fases spec→build→test→ship, reglas del proyecto, diseño UI y auditoría visual con Playwright.
---

# Senior Trading Architect · AthenAI

Rol: director técnico + ingeniero sénior + arquitecto de IA para trading (Order Flow, ML/DL, 3D de alto rendimiento).

## 1. MODO CAVEMAN (obligatorio, nunca se quita)
- Pensar corto. Escribir corto. Cero relleno, cero repetir lo ya dicho, cero listas de opciones que no se van a usar.
- Leer mínimo: primero `MAPA.md` de esta skill; luego `grep -n` / `sed -n A,Bp`. Nunca releer archivos enteros ya vistos.
- Llamadas independientes en paralelo. Búsquedas amplias → subagente `Explore`.
- Al usuario: frases cortas, español simple, sin jerga (el usuario está aprendiendo). Caveman = breve, no críptico.
- Informe final: qué hice · qué falta · qué necesito de ti. Nada más.

## 2. Reglas fijas del proyecto (no negociables)
- Solo mercado REAL. Cero datos sintéticos/DEMO en la plataforma. Demos de verificación solo en el scratchpad.
- Fuente: solo Binance Futures por ahora. Rithmic (CME) queda preparado (`src/motores/fuentes/rithmicPuente.ts`). Sin MT5. Nunca «Urus». Nunca Tailscale; DuckDNS sí.
- Nada de ML/DL hasta que el usuario lo diga.
- Un mercado, un juicio: todo lleva `market_id` (`src/motores/mercado/mercadoId.ts`); una aprobación no vale para otro mercado.
- Quirúrgico: no borrar lógica de motores ni pantallas que funcionan; solo añadir o arreglar. Nada de trabajo doble: planear dependencias antes.
- Pantallas nuevas: una por una, con fotos, y esperar el OK antes de la siguiente.
- No PR salvo que lo pidan. Rama de la sesión.
- **CONGELADO (desde 22-oct-2026):** una cosa a la vez; nada nuevo hasta que lo anterior esté en uso. Prioridad: que la grabadora grabe en el VPS y el usuario pruebe estrategias con el Juez. Ideas nuevas → `docs/PENDIENTES.md`, nunca directo al código. No proponer 3 cosas nuevas por cada pregunta.
- **Sin depender de un proveedor:** datos y órdenes son ENCHUFES intercambiables (datos: Binance hoy, Rithmic mañana; órdenes: Paper hoy, el broker del usuario mañana). Los bots no saben dónde operan: solo abren, cierran y ponen stop/objetivo (como DISTANCIA, no precio de otro mercado). Las etiquetas (`proveedor:símbolo`) son para el Juez y el Diario. Tamaño en contratos/lotes según la ficha de cada mercado (pendiente).
- Bots, diario y ML viven en el VPS junto a los datos; el navegador solo muestra y manda.

## 3. Fases
**spec** — plan corto en lenguaje simple: qué, por qué, orden por dependencias, qué se reutiliza. Si cambia el núcleo (Juez, motores) o hay decisión del usuario → preguntar antes.
**build** — seguir la skill `codigo-compacto` (DRY, módulos pequeños, nada de archivos gigantes). Reutilizar antes de crear (`MAPA.md`). Igualar estilo del archivo vecino. Lógica de cálculo en `src/motores/**` (pura, testeable); UI en `src/components/**` / `src/modules/**`.
**test** — en este orden, todo debe quedar limpio:
```
npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p grabadora/tsconfig.json
npx eslint .                      # 7 avisos previos conocidos, 0 errores
npx vitest run                    # todas verdes; pruebas nuevas para cada motor nuevo
npm run build && npx vite preview --port 4173 &
node .claude/skills/senior-trading-architect/scripts/auditoria-visual.cjs <scratchpad>/auditoria
```
Toda lógica que use precios: prueba anti-futuro (cambiar barras posteriores no cambia lo ya calculado).
**ship** — commit con trailer de la sesión · push · `git archive -o <scratchpad>/athenai.zip HEAD` · `npm run grabadora:paquete` y copiar `grabadora/dist/athenai-grabadora.zip` al scratchpad · fotos al usuario.

## 4. Trading / Juez / ML
- El Juez es la ley: WF rodante con embargo, Monte Carlo, Luck test, Robustez, DSR, PBO, Anti-futuro, Veredicto. Reglas bloqueadas: ningún modelo las cambia.
- Salidas (stop ATR, RR, fija/be1R/escalonada) = `src/motores/juez/salidas.ts`, mismo código en backtest y en vivo. Barra que toca stop y objetivo → stop.
- Ficha de operación, bitácora y diario (calendario día/semana/mes + métricas) = `src/motores/diario/diario.ts`.
- Todo en R. Stop en estructura con mínimo ATR. Tamaño por % de riesgo.
- ML (cuando se active): un modelo por mercado; dataset del Etiquetador (triple barrera, meta-etiquetado); WF purgado; detector de fugas (`src/motores/ml/antifuga.ts`); reentreno semanal; el Juez valida antes de cambiar modelo; el usuario da el OK.
  - Clásico (LightGBM, CatBoost, XGBoost) → cerebro principal del Panel General.
  - Deep (CNN, LSTM, Transformer) → su propia red neuronal (pantalla aparte).
- Bots y diario viven en el VPS (24/7) junto a la grabadora; el navegador solo muestra.

## 5. Diseño UI (estilo ZIP 5, aprobado por el usuario)
- Monocromo plata sobre negro. Piezas: `Panel`, `Encabezado`, `Insignia`, clases `etiqueta` y `cifra`. Pestañas con píldora blanca `motion` + `layoutId`.
- Gráficos propios en SVG/Canvas animados (`useProgreso`), como `src/components/laboratorio/vista/*`. NO Recharts ni shadcn (rechazados).
- 3D: `@react-three/fiber` + drei. Alta frecuencia en Canvas, sin re-render de React por tick; `memo`; sin `Math.random` en lo que debe ser estable.
- Móvil: probar a 390 px. Sin scroll horizontal salvo tablas.

## 6. Respaldo de modelo («ruteo»)
La skill no cambia de modelo sola. Protocolo:
- Tarea larga o contexto/límite cerca → escribir `<scratchpad>/NOTAS_TRASPASO.md`: objetivo, hecho, falta, archivos clave, comandos, decisiones del usuario. Otra sesión/modelo continúa desde ahí.
- Delegar a subagentes lo mecánico (búsquedas, revisiones) y quedarse con las decisiones.

## 7. Herramientas de esta skill
- `node .claude/skills/senior-trading-architect/scripts/mapa.mjs` → regenera `MAPA.md` (quién importa a quién, pruebas). Correr tras añadir o mover archivos.
- `node .claude/skills/senior-trading-architect/scripts/auditoria-visual.cjs <carpeta> [url]` → recorre los 11 módulos y las pestañas del Juez, captura y falla si hay errores de consola/página.

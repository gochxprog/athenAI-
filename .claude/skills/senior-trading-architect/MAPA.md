# Mapa del código · AthenAI

Generado por `scripts/mapa.mjs` (202 archivos). Leer esto antes de explorar.
Formato: `archivo` → importa · ← lo importan · 🧪 prueba

## grabadora
- `almacenDisco.ts` → mercadoId.ts, features.ts, parametros.ts · ← botsVps.ts, grabadora.ts, servidor.ts · 🧪 bots.test.ts, cliente.test.ts, grabadora.test.ts
- `botsVps.ts` → almacenDisco.ts, protocolo.ts, python.ts, pipeline.ts, almacenPaper.ts, ejecutor.ts, motorPaper.ts, protocolo.ts · ← grabadora.ts, servidor.ts · 🧪 bots.test.ts
- `build.mjs`
- `grabadora.ts` → almacenDisco.ts, botsVps.ts, servidor.ts, binance.ts, calendario.ts, parametros.ts, pipeline.ts, tipos.ts, motorPaper.ts · 🧪 grabadora.test.ts
- `servidor.ts` → almacenDisco.ts, botsVps.ts, mercadoId.ts · ← grabadora.ts · 🧪 bots.test.ts, cliente.test.ts, grabadora.test.ts

## src
- `App.tsx` → AvisoGrabadora.tsx, Sidebar.tsx, Topbar.tsx, metaModulo.ts, Navegacion.tsx, AgentesView.tsx, ConocimientoView.tsx, DashboardView.tsx, DatosView.tsx, DecisionesView.tsx, EstrategiasView.tsx, InvestigacionView.tsx, LaboratorioView.tsx, MaquinasView.tsx, OrderFlowView.tsx, PaperTradingView.tsx, cliente.ts, iniciar.ts, iniciar.ts, nav.ts · ← main.tsx
- `main.tsx` → App.tsx
- `vite-env.d.ts`

## components/charts
- `AbanicoTrayectorias.tsx` → format.ts · ← ResultadoJuez.tsx, MonteCarloJuez.tsx
- `Sparkline.tsx` · ← ResumenMercados.tsx

## components/datos
- `AvisoGrabadora.tsx` → cliente.ts · ← App.tsx
- `CalendarioEventos.tsx` → Insignia.tsx, Panel.tsx, useCalendario.ts, calendario.ts, motorCliente.ts · ← DatosView.tsx
- `MotoresDatos.tsx` → TarjetaMotor.tsx, format.ts, calendario.ts, motorCliente.ts, protocolo.ts · ← DatosView.tsx
- `PanelGrabadora.tsx` → graficos.tsx, Insignia.tsx, Panel.tsx, format.ts, cliente.ts · ← DatosView.tsx
- `PanelNotificaciones.tsx` → Insignia.tsx, Panel.tsx, format.ts, canales.ts, notificador.ts · ← DatosView.tsx

## components/laboratorio
- `BibliotecaPapers.tsx` → Panel.tsx, notificador.ts, paper.ts · ← EstrategiasPython.tsx, EstrategiasView.tsx
- `EstrategiasPython.tsx` → BibliotecaPapers.tsx, MapaEdge.tsx, fuentesGuardadas.ts, plantillas.ts, OrderFlowChart.tsx, Insignia.tsx, Panel.tsx, format.ts, backtest.ts, luckTest.ts, monteCarlo.ts, walkForward.ts, laboratorioCliente.ts, protocolo.ts, mercadoId.ts, notificador.ts, features.ts, paper.ts · ← LaboratorioView.tsx
- `Etiquetador.tsx` → fuentesGuardadas.ts, graficos.tsx, OrderFlowChart.tsx, Panel.tsx, format.ts, etiquetador.ts, laboratorioCliente.ts · ← LaboratorioView.tsx
- `MapaEdge.tsx` → fuentesGuardadas.ts, plantillas.ts, Panel.tsx · ← EstrategiasPython.tsx
- `ResultadoJuez.tsx` → AbanicoTrayectorias.tsx, graficos.tsx, CurvaEquityJuez.tsx, LuckTestJuez.tsx, MonteCarloJuez.tsx, TarjetasJuez.tsx, TiraPasos.tsx, WalkForwardJuez.tsx, Panel.tsx, format.ts, backtest.ts, luckTest.ts, walkForward.ts, protocolo.ts · ← ResultadosJuez.tsx
- `fuentesGuardadas.ts` → mercadoId.ts, motorCliente.ts, protocolo.ts · ← EstrategiasPython.tsx, Etiquetador.tsx, MapaEdge.tsx
- `graficos.tsx` · ← 6 archivos
- `plantillas.ts` → almacen.ts, juez.ts, mercadoId.ts · ← 8 archivos

## components/laboratorio/vista
- `CurvaEquityJuez.tsx` → useProgreso.ts, format.ts, protocolo.ts · ← ResultadoJuez.tsx
- `LuckTestJuez.tsx` → useProgreso.ts, format.ts, luckTest.ts, protocolo.ts · ← ResultadoJuez.tsx
- `MonteCarloJuez.tsx` → AbanicoTrayectorias.tsx, useProgreso.ts, format.ts, protocolo.ts · ← ResultadoJuez.tsx
- `ResultadosJuez.tsx` → ResultadoJuez.tsx, plantillas.ts, Encabezado.tsx, Insignia.tsx, Panel.tsx, paper.ts · ← LaboratorioView.tsx
- `TarjetasJuez.tsx` → Insignia.tsx, Panel.tsx, format.ts, juez.ts, luckTest.ts, sobreajuste.ts, protocolo.ts · ← ResultadoJuez.tsx
- `TiraPasos.tsx` → Panel.tsx, format.ts, protocolo.ts, features.ts · ← ResultadoJuez.tsx
- `WalkForwardJuez.tsx` → format.ts, walkForward.ts, protocolo.ts · ← ResultadoJuez.tsx

## components/layout
- `Sidebar.tsx` → plantillas.ts, OrderFlowChart.tsx, Punto.tsx, agentes.ts, menu.ts, iniciar.ts, nav.ts · ← App.tsx
- `Topbar.tsx` → OrderFlowChart.tsx, Insignia.tsx, Punto.tsx, Navegacion.tsx, useCalendario.ts, useReloj.ts, format.ts · ← App.tsx

## components/orderflow
- `DomEscalera.tsx` → agruparLibro.ts, format.ts, pipeline.ts · ← OrderFlowChart.tsx
- `LienzoOrderFlow.tsx` → format.ts, historial.ts, pipeline.ts, tipos.ts · ← OrderFlowChart.tsx
- `MemoriaMercado.tsx` → OrderFlowChart.tsx, ResumenMercados.tsx, Panel.tsx, TarjetaMotor.tsx, format.ts, regimen.ts, motorCliente.ts, protocolo.ts · ← OrderFlowView.tsx
- `MotoresOrderFlow.tsx` → TarjetaMotor.tsx, format.ts, pipeline.ts, protocolo.ts · ← OrderFlowView.tsx
- `OrderFlowChart.tsx` → DomEscalera.tsx, LienzoOrderFlow.tsx, historialGrafico.ts, Punto.tsx, Navegacion.tsx, pipeline.ts, tipos.ts, motorCliente.ts, protocolo.ts · ← 13 archivos
- `ResumenMercados.tsx` → Sparkline.tsx, OrderFlowChart.tsx, Punto.tsx, useCalendario.ts, format.ts, motorCliente.ts, protocolo.ts · ← MemoriaMercado.tsx, DashboardView.tsx, OrderFlowView.tsx
- `agruparLibro.ts` → pipeline.ts · ← DomEscalera.tsx · 🧪 agruparLibro.test.ts
- `historialGrafico.ts` → almacen.ts, cliente.ts, historial.ts, pipeline.ts, tipos.ts, motorCliente.ts · ← OrderFlowChart.tsx

## components/three
- `EsferaCerebro.tsx` · ← DashboardView.tsx
- `SalaAgentes3D.tsx` → pantallas.ts, agentes.ts · ← AgentesView.tsx
- `pantallas.ts` → agentes.ts · ← SalaAgentes3D.tsx

## components/ui
- `Consola.tsx` → format.ts · ← AgentesView.tsx, DashboardView.tsx
- `Encabezado.tsx` · ← 11 archivos
- `Insignia.tsx` · ← 11 archivos
- `Panel.tsx` · ← 22 archivos
- `PanelLateral.tsx` · ← AgentesView.tsx
- `Punto.tsx` · ← 7 archivos
- `SinMotor.tsx` → Panel.tsx · ← ConocimientoView.tsx, InvestigacionView.tsx
- `TarjetaMotor.tsx` → graficos.tsx, Panel.tsx · ← MotoresDatos.tsx, MemoriaMercado.tsx, MotoresOrderFlow.tsx

## data
- `agentes.ts` · ← Sidebar.tsx, SalaAgentes3D.tsx, pantallas.ts, AgentesView.tsx
- `menu.ts` → nav.ts · ← Sidebar.tsx
- `metaModulo.ts` → nav.ts · ← App.tsx

## hooks
- `Navegacion.tsx` → nav.ts · ← 6 archivos
- `useCalendario.ts` → calendario.ts, motorCliente.ts · ← CalendarioEventos.tsx, Topbar.tsx, ResumenMercados.tsx, DashboardView.tsx
- `useProgreso.ts` · ← CurvaEquityJuez.tsx, LuckTestJuez.tsx, MonteCarloJuez.tsx
- `useReloj.ts` · ← Topbar.tsx

## lib
- `format.ts` · ← 29 archivos
- `random.ts` · ← juez.ts, antiFuturo.ts, hmm.ts, guardian.ts · 🧪 etiquetador.test.ts, backtest.test.ts, juez.test.ts, luckTest.test.ts, monteCarlo.test.ts, robustez.test.ts, sobreajuste.test.ts, walkForward.test.ts, memoria.test.ts, antifuga.test.ts, barras.test.ts, pipeline.test.ts, paper.test.ts

## modules
- `AgentesView.tsx` → plantillas.ts, OrderFlowChart.tsx, SalaAgentes3D.tsx, Consola.tsx, Encabezado.tsx, Insignia.tsx, Panel.tsx, PanelLateral.tsx, Punto.tsx, agentes.ts, format.ts, iniciar.ts, protocolo.ts · ← App.tsx
- `ConocimientoView.tsx` → OrderFlowChart.tsx, Encabezado.tsx, SinMotor.tsx, format.ts · ← App.tsx
- `DashboardView.tsx` → plantillas.ts, OrderFlowChart.tsx, ResumenMercados.tsx, EsferaCerebro.tsx, Consola.tsx, Panel.tsx, Punto.tsx, Navegacion.tsx, useCalendario.ts, format.ts, lectura.ts, laboratorioCliente.ts, protocolo.ts, canales.ts, notificador.ts, protocolo.ts, nav.ts · ← App.tsx
- `DatosView.tsx` → CalendarioEventos.tsx, MotoresDatos.tsx, PanelGrabadora.tsx, PanelNotificaciones.tsx, OrderFlowChart.tsx, Encabezado.tsx, Insignia.tsx, Panel.tsx, Punto.tsx, Navegacion.tsx, format.ts, binance.ts, rithmicPuente.ts, features.ts, motorCliente.ts, protocolo.ts · ← App.tsx
- `DecisionesView.tsx` → OrderFlowChart.tsx, Encabezado.tsx, Panel.tsx, format.ts, notificador.ts, paper.ts · ← App.tsx
- `EstrategiasView.tsx` → BibliotecaPapers.tsx, graficos.tsx, plantillas.ts, Encabezado.tsx, Panel.tsx, Navegacion.tsx, format.ts, paper.ts · ← App.tsx
- `InvestigacionView.tsx` → Encabezado.tsx, SinMotor.tsx · ← App.tsx
- `LaboratorioView.tsx` → EstrategiasPython.tsx, Etiquetador.tsx, ResultadosJuez.tsx, Encabezado.tsx, Insignia.tsx · ← App.tsx
- `MaquinasView.tsx` → OrderFlowChart.tsx, Encabezado.tsx, Panel.tsx, format.ts · ← App.tsx
- `OrderFlowView.tsx` → MemoriaMercado.tsx, MotoresOrderFlow.tsx, OrderFlowChart.tsx, ResumenMercados.tsx, Encabezado.tsx, Insignia.tsx, Panel.tsx, format.ts, cliente.ts, features.ts, pipeline.ts, tipos.ts, motorCliente.ts · ← App.tsx
- `PaperTradingView.tsx` → graficos.tsx, plantillas.ts, Encabezado.tsx, Panel.tsx, format.ts, costos.ts, ejecutor.ts, guardian.ts, iniciar.ts, paper.ts, motorCliente.ts · ← App.tsx

## motores/almacen
- `almacen.ts` → features.ts, parametros.ts · ← 10 archivos · 🧪 almacen.test.ts, cliente.test.ts

## motores/diario
- `diario.ts` → salidas.ts, mercadoId.ts · 🧪 diario.test.ts

## motores/etiquetador
- `etiquetador.ts` → mercadoId.ts, features.ts · ← Etiquetador.tsx, laboratorio.worker.ts, protocolo.ts · 🧪 etiquetador.test.ts, antifuga.test.ts

## motores/flujo/big-trades
- `engine.ts` · ← settings.ts, motorMercado.ts · 🧪 big-trades.audit.test.ts, engine.test.ts
- `filter.ts` · 🧪 big-trades.audit.test.ts
- `settings.ts` → engine.ts

## motores/flujo/lhm
- `circular-buffer.ts` · ← liquidity-history.ts
- `heatmap-math.ts` · ← liquidity-pools.ts
- `liquidity-history.ts` → circular-buffer.ts, order-book.ts · ← liquidity-pools.ts, motorMercado.ts · 🧪 liquidity-ghosts.test.ts, liquidity-pools.test.ts
- `liquidity-pools.ts` → heatmap-math.ts, liquidity-history.ts · ← motorMercado.ts · 🧪 liquidity-ghosts.test.ts, liquidity-pools.test.ts

## motores/flujo/market-data
- `types.ts` · ← engine.ts, types.ts, footprint.ts, tipos.ts

## motores/flujo/open-interest
- `engine.ts` → types.ts, types.ts · ← features.ts · 🧪 engine.test.ts, oi.audit.test.ts
- `types.ts` → types.ts · ← engine.ts, features.ts, tipos.ts · 🧪 engine.test.ts

## motores/flujo/order-flow
- `absorption-engine.ts` → footprint.ts · ← serieBarras.ts · 🧪 absorption-engine.test.ts, exhaustion-engine.test.ts
- `exhaustion-engine.ts` → footprint.ts · ← serieBarras.ts · 🧪 absorption-engine.test.ts, exhaustion-engine.test.ts
- `footprint.ts` → types.ts, microstructure.ts, poc.ts · ← absorption-engine.ts, exhaustion-engine.ts, microstructure.ts, barras.ts · 🧪 footprint.test.ts, microstructure.test.ts, barras.test.ts
- `formulas.ts` · ← microstructure.ts, order-book.ts · 🧪 formulas.test.ts
- `heat-column.ts` → order-book.ts
- `iceberg-detector.ts` · ← motorMercado.ts · 🧪 iceberg-detector.test.ts
- `liquidity-scan.ts` → order-book.ts · 🧪 liquidity-scan.test.ts
- `microstructure.ts` → footprint.ts, formulas.ts, poc.ts · ← footprint.ts, serieBarras.ts · 🧪 formulas.test.ts, microstructure.test.ts
- `order-book.ts` → formulas.ts · ← 6 archivos · 🧪 formulas.test.ts, liquidity-scan.test.ts, order-book.test.ts, puenteSSE.test.ts, pipeline.test.ts
- `poc.ts` · ← footprint.ts, microstructure.ts
- `session-cvd.ts` · ← motorMercado.ts · 🧪 session-cvd.test.ts
- `stoprun-detector.ts` · ← motorMercado.ts · 🧪 stoprun-detector.test.ts

## motores/flujo/realtime
- `backoff.ts` · ← binance.ts, puenteSSE.ts · 🧪 backoff.test.ts
- `protocol.ts` · ← puenteSSE.ts · 🧪 protocol.test.ts

## motores/fuentes
- `binance.ts` → order-book.ts, backoff.ts, parametros.ts, tipos.ts · ← DatosView.tsx, motor.worker.ts, motorCliente.ts, grabadora.ts · 🧪 binance.test.ts
- `puenteSSE.ts` → backoff.ts, protocol.ts, tipos.ts · ← motor.worker.ts · 🧪 puenteSSE.test.ts
- `rithmicPuente.ts` · ← DatosView.tsx, motor.worker.ts, protocolo.ts

## motores/grabadora
- `cliente.ts` → almacen.ts, parametros.ts · ← 6 archivos · 🧪 cliente.test.ts

## motores/historial
- `historial.ts` → features.ts, pipeline.ts · ← LienzoOrderFlow.tsx, historialGrafico.ts · 🧪 historial.test.ts

## motores/investigacion
- `extremos.ts` → features.ts · ← motor.worker.ts, protocolo.ts · 🧪 extremos.test.ts
- `lectura.ts` → protocolo.ts · ← DashboardView.tsx · 🧪 lectura.test.ts

## motores/juez
- `backtest.ts` → costos.ts · ← 10 archivos · 🧪 backtest.test.ts, juez.test.ts, luckTest.test.ts, monteCarlo.test.ts, robustez.test.ts, salidas.test.ts
- `costos.ts` · ← 5 archivos · 🧪 backtest.test.ts, paper.test.ts
- `juez.ts` → random.ts, backtest.ts, luckTest.ts, monteCarlo.ts, robustez.ts, sobreajuste.ts, veredicto.ts, walkForward.ts, mercadoId.ts · ← 8 archivos · 🧪 juez.test.ts, robustez.test.ts, paper.test.ts
- `luckTest.ts` → backtest.ts · ← 6 archivos · 🧪 luckTest.test.ts
- `monteCarlo.ts` → backtest.ts · ← EstrategiasPython.tsx, juez.ts, protocolo.ts, guardian.ts · 🧪 monteCarlo.test.ts, paper.test.ts
- `robustez.ts` → backtest.ts, juez.ts · ← juez.ts · 🧪 robustez.test.ts
- `salidas.ts` → costos.ts · ← diario.ts · 🧪 salidas.test.ts
- `sobreajuste.ts` · ← TarjetasJuez.tsx, juez.ts · 🧪 sobreajuste.test.ts
- `veredicto.ts` · ← juez.ts · 🧪 veredicto.test.ts
- `walkForward.ts` → backtest.ts · ← 5 archivos · 🧪 robustez.test.ts, walkForward.test.ts

## motores/laboratorio
- `antiFuturo.ts` → random.ts · ← python.ts · 🧪 antiFuturo.test.ts
- `laboratorio.worker.ts` → almacen.ts, etiquetador.ts, juez.ts, protocolo.ts, python.ts, mercadoId.ts
- `laboratorioCliente.ts` → protocolo.ts · ← EstrategiasPython.tsx, Etiquetador.tsx, DashboardView.tsx, iniciar.ts
- `protocolo.ts` → almacen.ts, etiquetador.ts, backtest.ts, juez.ts, luckTest.ts, monteCarlo.ts, walkForward.ts · ← 14 archivos · 🧪 paper.test.ts, paper.test.ts, bots.test.ts
- `python.ts` → backtest.ts, juez.ts, antiFuturo.ts, features.ts · ← laboratorio.worker.ts, botsVps.ts · 🧪 python.test.ts

## motores/memoria
- `cruce.ts` · ← motor.worker.ts, protocolo.ts · 🧪 memoria.test.ts
- `gemelos.ts` → features.ts · ← motor.worker.ts, protocolo.ts · 🧪 memoria.test.ts
- `hmm.ts` → random.ts · ← regimen.ts · 🧪 memoria.test.ts
- `regimen.ts` → hmm.ts, features.ts · ← MemoriaMercado.tsx, motor.worker.ts, protocolo.ts · 🧪 memoria.test.ts

## motores/mercado
- `mercadoId.ts` → almacen.ts · ← 12 archivos · 🧪 mercadoId.test.ts

## motores/ml
- `antifuga.ts` · 🧪 antifuga.test.ts

## motores/notificaciones
- `canales.ts` · ← PanelNotificaciones.tsx, DashboardView.tsx, notificador.ts, motorPaper.ts · 🧪 notificador.test.ts, paper.test.ts, paper.test.ts
- `iniciar.ts` → notificador.ts, motorCliente.ts · ← App.tsx
- `notificador.ts` → canales.ts, calendario.ts, protocolo.ts · ← 7 archivos · 🧪 notificador.test.ts

## motores/nucleo
- `anillo.ts` → tipos.ts · ← motorMercado.ts, pipeline.ts, serieBarras.ts
- `barras.ts` → footprint.ts, tipos.ts · ← serieBarras.ts · 🧪 barras.test.ts
- `calendario.ts` · ← 9 archivos
- `features.ts` → engine.ts, types.ts, motorMercado.ts, serieBarras.ts, tipos.ts · ← 15 archivos · 🧪 almacen.test.ts, extremos.test.ts, python.test.ts, memoria.test.ts, antifuga.test.ts, features.test.ts, pipeline.test.ts, grabadora.test.ts
- `motorMercado.ts` → engine.ts, liquidity-history.ts, liquidity-pools.ts, iceberg-detector.ts, session-cvd.ts, stoprun-detector.ts, anillo.ts, tipos.ts · ← features.ts, pipeline.ts · 🧪 features.test.ts, motorMercado.test.ts
- `parametros.ts` → tipos.ts · ← 7 archivos · 🧪 almacen.test.ts, parametros.test.ts, bots.test.ts, cliente.test.ts, grabadora.test.ts
- `pipeline.ts` → order-book.ts, anillo.ts, calendario.ts, features.ts, motorMercado.ts, parametros.ts, serieBarras.ts, tipos.ts · ← 14 archivos · 🧪 historial.test.ts, features.test.ts, pipeline.test.ts
- `serieBarras.ts` → absorption-engine.ts, exhaustion-engine.ts, microstructure.ts, anillo.ts, barras.ts, tipos.ts · ← features.ts, pipeline.ts
- `tipos.ts` → types.ts, types.ts, order-book.ts · ← 17 archivos · 🧪 binance.test.ts, barras.test.ts, motorMercado.test.ts, pipeline.test.ts

## motores/paper
- `almacenPaper.ts` → ejecutor.ts · ← iniciar.ts, motorPaper.ts, botsVps.ts · 🧪 paper.test.ts
- `ejecutor.ts` → almacen.ts, costos.ts, juez.ts, mercadoId.ts, pipeline.ts · ← 7 archivos · 🧪 paper.test.ts, bots.test.ts
- `guardian.ts` → random.ts, monteCarlo.ts, ejecutor.ts · ← PaperTradingView.tsx, iniciar.ts, motorPaper.ts, paperRemoto.ts · 🧪 paper.test.ts
- `iniciar.ts` → cliente.ts, laboratorioCliente.ts, notificador.ts, almacenPaper.ts, ejecutor.ts, guardian.ts, motorPaper.ts, paperRemoto.ts, motorCliente.ts · ← App.tsx, Sidebar.tsx, AgentesView.tsx, PaperTradingView.tsx
- `motorPaper.ts` → almacen.ts, costos.ts, juez.ts, protocolo.ts, mercadoId.ts, canales.ts, almacenPaper.ts, ejecutor.ts, guardian.ts, protocolo.ts · ← iniciar.ts, paperRemoto.ts, botsVps.ts, grabadora.ts · 🧪 paper.test.ts, bots.test.ts
- `paperRemoto.ts` → ejecutor.ts, guardian.ts, motorPaper.ts · ← iniciar.ts · 🧪 paperRemoto.test.ts

## motores/papers
- `paper.ts` → backtest.ts, protocolo.ts, mercadoId.ts, features.ts · ← 6 archivos · 🧪 paper.test.ts

## motores/worker
- `motor.worker.ts` → almacen.ts, binance.ts, puenteSSE.ts, rithmicPuente.ts, extremos.ts, cruce.ts, gemelos.ts, regimen.ts, calendario.ts, features.ts, parametros.ts, pipeline.ts, tipos.ts, protocolo.ts
- `motorCliente.ts` → binance.ts, calendario.ts, pipeline.ts, tipos.ts, protocolo.ts · ← 13 archivos
- `protocolo.ts` → almacen.ts, rithmicPuente.ts, extremos.ts, cruce.ts, gemelos.ts, regimen.ts, calendario.ts, pipeline.ts, tipos.ts · ← 15 archivos · 🧪 lectura.test.ts, notificador.test.ts, paper.test.ts, bots.test.ts

## types
- `nav.ts` · ← 6 archivos

---
name: codigo-compacto
description: Directiva de código limpio, modular y ultra-compacto para AthenAI (trading algorítmico). Úsala SIEMPRE que escribas o cambies código en este repo (Python de estrategias, TypeScript de motores, UI y grabadora): DRY, módulos pequeños de una sola responsabilidad, código idiomático y corto, nada de archivos monolíticos ni bloques repetidos, entregas por fases.
---

# Directiva de Desarrollo: Código Limpio, Modular y Ultra-Compacto

## Propósito
Optimizar el código de los sistemas de trading algorítmico (Python de las estrategias y TypeScript de los motores, la UI y la grabadora), priorizando la concisión, la reutilización de funciones y la legibilidad estricta. Queda terminantemente prohibido generar archivos monolíticos gigantescos o bloques de código repetitivos (anti-patrón de «miles de líneas»).

## Reglas de Arquitectura y Estilo

1. **Principio DRY (Don't Repeat Yourself):**
   - Nunca dupliques lógica. Si un cálculo de indicadores, una validación de riesgo o la gestión de órdenes se usa en más de un lugar, se encapsula en una función o método auxiliar reutilizable.
   - Antes de escribir algo nuevo, busca si ya existe (`MAPA.md` de la skill senior-trading-architect, `grep`).

2. **Modularidad Estricta:**
   - Divide las soluciones en componentes limpios y desacoplados (por ejemplo: cliente WebSocket, gestor de order book, motor de lógica/señales y ejecutor de riesgo).
   - Cada clase, módulo o componente tiene una única responsabilidad clara y un tamaño razonable.
   - **Guía de tamaño:**
     - un archivo nuevo apunta a menos de ~250 líneas;
     - si pasa de ~400, se parte por responsabilidad;
     - una función, idealmente menos de ~40 líneas.

3. **Compacidad Funcional:**
   - Escribe código idiomático:
     - **Python:** comprensiones, generadores, `asyncio`, `collections`, `itertools`;
     - **TypeScript:** `map`, `filter` y `reduce`, tipos derivados, utilidades compartidas.
   - Máxima potencia con la menor cantidad de líneas posible.
   - Evita:
     - la verbosidad excesiva;
     - los comentarios que explican lo obvio (sí se comenta el **porqué** no evidente: anti-futuro, unidades, decisiones del Juez);
     - las variables temporales innecesarias.
   - Compacto **no** es críptico: nombres claros y nada de trucos que un humano no pueda leer de un vistazo.

4. **Formato de Entrega por Fases:**
   - Si un módulo es extenso, entrégalo por bloques lógicos independientes pero completamente funcionales, manteniendo siempre una estructura ligera y limpia.

## Cómo encaja con el proyecto
- Las reglas de `senior-trading-architect` siguen valiendo:
  - el Juez es la ley;
  - prueba anti-futuro en toda lógica con precios;
  - solo datos reales;
  - una pantalla a la vez.
- **Al tocar código viejo:**
  - se deja más corto o igual, nunca más largo sin motivo;
  - lo duplicado que encuentres en lo que tocas se une en una función.
- **Versión 2 (`docs/CROQUIS.md`):** se escribe desde el principio con estas reglas.
  - Reutiliza los motores probados en vez de reescribirlos.
  - Si un motor viejo es demasiado largo, se adelgaza **sin cambiar sus resultados** (comparar la salida antes y después con los mismos datos).
- **Revisión antes de entregar:** contar las líneas de lo nuevo y buscar código repetido (funciones casi iguales, JSX copiado). Si sobra, se compacta antes del commit.

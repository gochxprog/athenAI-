#!/usr/bin/env bash
# Arma grabadora/dist/athenai-grabadora.zip: la grabadora, el instalador, las instrucciones y la plataforma (web/).
set -euo pipefail
cd "$(dirname "$0")/.."
P=grabadora/dist/paquete
rm -rf "$P" grabadora/dist/athenai-grabadora.zip
mkdir -p "$P"
cp grabadora/dist/grabadora.mjs grabadora/dist/importar.mjs grabadora/importar.sh grabadora/instalar.sh grabadora/asegurar.sh grabadora/LEEME.txt "$P/"
# Solo la versión 2 (la vieja ya no se instala): se sirve en /v2/ y la dirección principal lleva ahí.
mkdir -p "$P/web" && cp -r dist/v2 "$P/web/v2"
# Python para las señales de los bots 24/7 (los mismos archivos que usa la plataforma).
mkdir -p "$P/pyodide"
for f in pyodide.mjs pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json package.json; do cp "node_modules/pyodide/$f" "$P/pyodide/"; done
(cd "$P" && python3 -c "import shutil; shutil.make_archive('../athenai-grabadora', 'zip', '.')")
rm -rf "$P"
ls -lh grabadora/dist/athenai-grabadora.zip

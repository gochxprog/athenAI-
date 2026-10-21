#!/usr/bin/env bash
# Arma grabadora/dist/athenai-grabadora.zip: la grabadora, el instalador, las instrucciones y la plataforma (web/).
set -euo pipefail
cd "$(dirname "$0")/.."
P=grabadora/dist/paquete
rm -rf "$P" grabadora/dist/athenai-grabadora.zip
mkdir -p "$P"
cp grabadora/dist/grabadora.mjs grabadora/instalar.sh grabadora/asegurar.sh grabadora/LEEME.txt "$P/"
[ -d dist ] && cp -r dist "$P/web"
(cd "$P" && python3 -c "import shutil; shutil.make_archive('../athenai-grabadora', 'zip', '.')")
rm -rf "$P"
ls -lh grabadora/dist/athenai-grabadora.zip

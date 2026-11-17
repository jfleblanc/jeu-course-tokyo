#!/bin/sh
# Convertit toutes les voitures de tools/cars.config.mjs (ou celles données en argument).
# Variables : MODELS (dossier des glTF décompressés), MESHOPT_JS, SHARP, OUT (défaut public/models).
cd "$(dirname "$0")/.."
ids=${*:-$(node -e "import('./tools/cars.config.mjs').then(m=>console.log(Object.keys(m.CARS).join(' ')))")}
for id in $ids; do
  src=$(node -e "import('./tools/cars.config.mjs').then(m=>console.log(m.CARS['$id'].src))")
  node tools/convert-car.mjs "$MODELS/$src" "$id" "${OUT:-public/models}/$id.glb" 2>&1 | sed "s/^/[$id] /" | grep -v "^\[$id\] *$" | cut -c1-400
done

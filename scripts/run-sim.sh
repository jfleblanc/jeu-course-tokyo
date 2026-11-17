#!/bin/sh
# Lance le banc d'essai physique (nécessite esbuild, fourni avec Vite).
#   sh scripts/run-sim.sh        → banc complet (conduite, ville, courses, progression)
#   sh scripts/run-sim.sh cars   → une ligne par voiture du garage
set -e
mkdir -p .verif
name=sim-${1:-test}
node_modules/.bin/esbuild scripts/$name.ts --bundle --platform=node --format=esm --outfile=.verif/$name.mjs --log-level=warning
node .verif/$name.mjs

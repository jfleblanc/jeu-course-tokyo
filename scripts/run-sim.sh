#!/bin/sh
# Lance le banc d'essai physique (nécessite esbuild, fourni avec Vite).
set -e
mkdir -p .verif
node_modules/.bin/esbuild scripts/sim-test.ts --bundle --platform=node --format=esm --outfile=.verif/sim-test.mjs --log-level=warning
node .verif/sim-test.mjs

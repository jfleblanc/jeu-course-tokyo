# Course de nuit — Tokyo

Jeu de course 3D de nuit dans une ville inspirée de Tokyo. Projet père-fils, usage privé.
Three.js (WebGPU, repli WebGL2 automatique) + TSL, physique Rapier, TypeScript, Vite.

**Jouer :** https://jfleblanc.github.io/jeu-course-tokyo/ (mis à jour à chaque push sur `main`).
Le numéro de version (hash du commit) est affiché en haut à droite.

## Commandes

| Action | Clavier | Manette Switch Pro / Switch 2 Pro |
|---|---|---|
| Accélérer / freiner (et reculer) | `W` / `S` | `ZR` / `ZL` (lissées) |
| Tourner | `A` `D` | stick gauche |
| Drift | `Espace` | `B` ou `A` |
| Boîte auto ↔ manuelle | `M` | `Y` |
| Monter / descendre un rapport (manuelle) | `↑` / `↓` | `R` / `L` |
| Caméra poursuite ↔ intérieure | `C` | `X` |
| Panneau de réglage A/B | `F1` | `−` |
| Basculer conduite A ↔ B | `B` | `+` |
| Replacer la voiture | `R` | clic du stick gauche |
| Lancer une course / l'abandonner | `Entrée` / `Échap` | croix ↑ / croix ← |
| Musique suivante / musique oui-non | `N` / `P` | croix → / croix ↓ |
| Afficher / masquer l'aide | `H` | |

## Développer

```sh
npm install
npm run dev        # serveur local
npm run build      # vérification des types + build de production
npm run sim        # banc d'essai physique sans affichage (0-100, virages, drift…)
npm run smoke      # test de fumée du build dans un navigateur sans tête (après npm run build)
```

Options d'adresse : `?q=bas|moyen|haut` (qualité), `?webgl` (forcer WebGL2), `?graine=1234` (autre ville).

## Organisation du code

```
src/
  config/     tous les réglages : conduite (A/B), monde, rendu, touches
  core/       boucle à pas fixe (60 Hz), PRNG à graine, maths
  input/      actions abstraites ← clavier + manette
  physics/    monde Rapier
  vehicle/    simulation (sans Three.js), moteur/boîte, modèle 3D procédural
  world/      graphe de rues courbes → immeubles le long des rues → maillages et collisions
  render/     rendu WebGPU, matériaux TSL, bloom, caméras
  race/       tracés générés, déroulement d'une course, décor de course
  ai/         pilote automatique des adversaires
  audio/      musique générée par code (pistes décrites dans config/music.ts)
  ui/         HUD et panneau A/B
  debug/      stockage des réglages A/B
scripts/      banc d'essai physique
```

La simulation ne dépend pas du rendu : `vehicle.ts`, `drivetrain.ts`, `streetGraph.ts` et
`cityGen.ts` ne connaissent pas Three.js. Le modèle de la voiture (`carModel.ts`) expose des
emplacements (carrosserie, roues, intérieur, point de vue du conducteur) pour brancher plus
tard un vrai modèle glTF déposé dans `public/models/`.

## Régler la conduite (itération A/B)

1. `F1` ouvre le panneau : deux préréglages, **A** et **B**, et un curseur par réglage.
2. `B` (ou le bouton ⇄) bascule entre A et B en roulant. Le panneau liste ce qui diffère.
3. « Exporter JSON » copie les deux réglages ; on les colle dans `src/config/handling.ts`
   (`PRESET_A` / `PRESET_B`) et on note le choix dans `src/config/handling-history.md`.

Règle : ne changer que deux ou trois réglages à la fois entre A et B.

## Phases

Voir le brief du projet. Phase 1 (conduite + une ville) et phase 2 (une course) : faites.
Ensuite : phase 3 (progression : XP, argent, garage).

## Les courses

`Entrée` tire un tracé au sort dans le réseau de rues (environ 2,6 km, sans demi-tour, surtout
sur les grands axes), place quatre voitures sur la grille et lance le décompte. Des portiques
marquent les points de passage, une colonne de lumière indique le prochain, et chaque virage
marqué est annoncé par une flèche à l'écran et un panneau à chevrons sur place. On peut couper
entre deux points de passage, mais pas en sauter un. Réglages : `src/config/race.ts`.

## La ville

Générée par code à partir d'une graine (`src/config/world.ts`) : un treillis de lignes arrondi en
galet, ondulé et décalé, avec deux avenues en diagonale. Chaque ligne devient une courbe lisse.
On obtient environ 20 km de rues : un périphérique, un boulevard central surmonté d'une autoroute,
de larges avenues courbes et en diagonale, et des rues et ruelles qui servent de raccourcis.
Autour, une autoroute de ceinture de 3,6 km (25 m de large) alterne portions au sol et portions
surélevées ; huit bretelles en pente douce la relient au périphérique. Son mur extérieur est la
limite de la ville. Les immeubles sont
posés le long des rues, orientés selon la courbe ; les cœurs d'îlots sont remplis ensuite.

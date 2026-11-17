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
| Drift | `Espace` | `B` |
| Boîte auto ↔ manuelle | `M` | `Y` |
| Monter / descendre un rapport (manuelle) | `↑` / `↓` | `R` / `L` |
| Caméra poursuite ↔ intérieure | `C` | `X` |
| Panneau de réglage A/B | `F1` | `−` |
| Basculer conduite A ↔ B | `B` | `+` |
| Replacer la voiture | `R` | clic du stick gauche |
| Lancer une course / l'abandonner | `Entrée` / `Échap` | croix ↑ / croix ← |
| Lancer un circuit à 3 tours | `T` | |
| Garage (voitures, améliorations, peinture) | `G` | |
| NOS (si installé) | `Maj` | `A` |
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
  progression/ niveau, XP, argent, garage, sauvegarde (un seul objet versionné)
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

Voir le brief du projet. Phases 1 (conduite + une ville), 2 (courses), 3 (progression) et
4 (contenu de course) : faites. Ensuite : phase 5 (finition).

## Progression

Chaque course rapporte de l'XP et de l'argent, selon la place et le niveau. Quatre paliers de
dix niveaux ; au dernier niveau d'un palier, il faut réussir une **épreuve de palier** (circuit
à trois tours, adversaires renforcés, finir dans les deux premiers). Les adversaires deviennent
meilleurs avec le niveau. Le garage (`G`) permet d'acheter une deuxième voiture, des
améliorations (moteur, pneus, carbone, NOS), une peinture et un néon, et de revendre à 50 %.
Tout est sauvegardé dans le navigateur. Réglages : `src/config/progression.ts` et
`src/config/cars.ts`.

## Les courses

La ville contient une **banque de douze tracés nommés** (huit courses d'environ 2,5 km, quatre
circuits à trois tours), générés une fois pour toutes à partir de graines fixes et validés
automatiquement. Chaque tracé a une **borne de départ** dans la ville (colonne de lumière cyan
pour une course, magenta pour un circuit, pastille sur la mini-carte) : s'arrêter dessus affiche
la **fiche de la course** (longueur, gains, les trois pilotes adverses avec leur voiture et
leurs points forts). `Entrée` propose une course au hasard, `T` un circuit ; `Entrée` de nouveau
lance, `Échap` ferme.

En course : portiques aux points de passage, colonne de lumière sur le prochain, flèche à
l'écran et panneau à chevrons à chaque virage marqué. On peut couper entre deux points de
passage, mais pas en sauter un. Des **mallettes d'argent** (dorées) sont posées sur le parcours,
et parfois un **téléporteur** (anneau violet) qui avance la voiture jusqu'à 100 m, sans jamais
dépasser le premier. Les circuits ont des adversaires 10 % plus rapides et servent d'épreuve de
palier. La mini-carte tourne avec la voiture et montre le tracé, les objets et les adversaires.
L'option d'adresse `?barrieres` affiche un aperçu des rues transversales barrées (désactivé par
défaut). Réglages : `src/config/race.ts` (pilotes, banque, objets).

## Vrais modèles 3D de voitures (essai)

Ajouter `?modele=datsun-240k` à l'adresse remplace la voiture procédurale (joueur et
adversaires) par un vrai modèle : peinture réglable, feux de frein, roues qui tournent et
braquent, vue « capot » à la place de la vue intérieure. Les fichiers sont dans
`public/models/` (crédits et licences : `public/models/CREDITS.md`).

Pour convertir un modèle Sketchfab (glTF décompressé) en GLB léger avec deux niveaux de détail :

```sh
MESHOPT_JS=<dossier js de meshoptimizer> TEX_DIR=<textures réduites> \
  node tools/convert-car.mjs <dossier du modèle> datsun-240k public/models/datsun-240k.glb
```

Chaque voiture a une entrée dans `CARS` (en tête de `tools/convert-car.mjs`) : nom des pièces
de roue, matériaux à regrouper, part de triangles gardée. Le chargement est dans
`src/vehicle/glbCar.ts`, qui remplace les matériaux du fichier par ceux du jeu d'après leur nom.

## La ville

Générée par code à partir d'une graine (`src/config/world.ts`) : un treillis de lignes arrondi en
galet, ondulé et décalé, avec deux avenues en diagonale. Chaque ligne devient une courbe lisse.
On obtient environ 20 km de rues : un périphérique, un boulevard central surmonté d'une autoroute,
de larges avenues courbes et en diagonale, et des rues et ruelles qui servent de raccourcis.
Autour, une autoroute de ceinture de 3,6 km (25 m de large) alterne portions au sol et portions
surélevées ; huit bretelles en pente douce la relient au périphérique. Son mur extérieur est la
limite de la ville. Les immeubles sont
posés le long des rues, orientés selon la courbe ; les cœurs d'îlots sont remplis ensuite.

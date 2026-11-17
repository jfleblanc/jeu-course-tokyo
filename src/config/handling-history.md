# Historique des réglages de conduite

Chaque fois qu'un réglage est retenu après un essai A/B, on le note ici
(date, version testée, ce qui a été choisi et pourquoi).

## 2026-11-16 — Phase 1, premiers préréglages

Point de départ, avant tout essai par les joueurs. Chiffres mesurés au banc d'essai
(`npm run sim`) : 0-100 km/h en 4,8 s, environ 260 km/h en pointe, 1,05 g en virage à 50 km/h.

| | A — « Collée à la route » | B — « Joueuse de l'arrière » |
|---|---|---|
| Adhérence arrière (`gripRear`) | 1.70 | 1.52 |
| Stabilité en lacet (`yawDamping`) | 2.2 | 1.2 |
| Adhérence arrière en drift (`driftRearGrip`) | 0.55 | 0.42 |

Tout le reste est identique. Questions posées aux joueurs : voir le README.

_Choix retenu : à remplir après les essais._

**Choix retenu (2026-11-16, version 7359035) : B.** Les joueurs préfèrent l'arrière plus
joueur. Remarque : le braquage pourrait tourner un peu plus et être plus nerveux.

## 2026-11-16 — Deuxième essai : le braquage

L'ancien B devient le nouveau A (base). Le nouveau B rend le train avant plus mordant.
Augmenter seulement l'angle de braquage ne change presque rien au banc d'essai : à plein
braquage, ce sont les pneus avant qui limitent le virage.

| | A — base (ancien B) | B — « Braquage plus nerveux » |
|---|---|---|
| Adhérence avant (`gripFront`) | 1.55 | 1.64 |
| Angle de dérive max. (`peakSlipDeg`) | 8° | 7° |
| Rapidité du volant (`steerRate`) | 4.5 | 6.5 |

Mesures : rayon de virage à 100 km/h, 58 m (A) contre 53 m (B). Un essai plus fort
(adhérence avant 1.78) partait en tête-à-queue à haute vitesse : écarté.

**Choix retenu (2026-11-16, version da5b578) : B.** Remarque : en drift, la voiture glisse
« comme sur une plaque de glace » et file tout droit vers le mur.

## 2026-11-16 — Troisième essai : l'accroche en drift

Cause : pendant le drift, l'arrière n'avait plus que 42 % de son adhérence, donc presque plus
rien ne courbait la trajectoire (et la voiture accélérait). Nouveau réglage `driftCarve` :
une force appliquée au centre de masse qui ramène la trajectoire vers le nez de la voiture,
sans freiner la rotation.

| | A — base (ancien B) | B — « Drift qui accroche » |
|---|---|---|
| Accroche en drift (`driftCarve`) | 0.3 | 0.75 |
| Angle de drift max. (`driftMaxAngleDeg`) | 38° | 32° |

Mesures, drift de 4 s lancé à 110 km/h, volant braqué : la trajectoire tourne de 84° sans
accroche (ancienne version), 114° en A, 160° en B ; la vitesse finit à 114, 87 et 63 km/h.

**Retour des joueurs (2026-11-16, version 26424a1) :** le drift est trop prononcé ; et quand
on freine en tournant, la voiture perd son virage et continue tout droit.

## 2026-11-16 — Quatrième essai : drift adouci et freinage en virage

Corrections communes à A et B :

- **Freinage en virage** (`trailBraking`, 0.75) : au freinage, les pneus gardent presque toute
  leur tenue latérale. Mesure, plein braquage + frein à fond à 120 km/h : la trajectoire tourne
  de 34° en 1,5 s, contre 22° avant (40° sans freiner).
- **Stabilité au freinage** : l'amortissement du lacet augmente avec le frein (l'arrière allégé
  ne passe plus devant à mi-frein).
- **Contrôle de stabilité** : hors drift, l'antipatinage coupe les gaz si la voiture part en
  travers (elle ne reste plus coincée à tourner en rond plein gaz).
- **Drift adouci** : coup de lacet 0.55 → 0.3, adhérence arrière en drift 0.42 → 0.55,
  accroche 0.6. Le drift se referme seul en 1 à 1,5 s volant droit.

| | A — base | B — « Drift encore plus sage » |
|---|---|---|
| Angle de drift max. (`driftMaxAngleDeg`) | 28° | 22° |
| Adhérence arrière en drift (`driftRearGrip`) | 0.55 | 0.68 |

Mesures, drift tenu volant braqué à 110 km/h : angle stabilisé 30° (A) et 24° (B), contre 40°
avant.

**Choix retenu (2026-11-16, version 22c9b0e) : A**, avec « Freinage en virage » monté à 1.
B (« drift encore plus sage ») reste en place pour être essayé par le deuxième joueur ;
on réajustera plus tard.

## 2026-11-16 — Cinquième essai : plus d'adhérence

Retour des joueurs (version dec9f09) : la chaussée paraît trop mouillée, pas assez de grip,
surtout à haute vitesse.

Base A relevée : adhérence avant 1.64 → 1.90, arrière 1.52 → 1.78, motricité/freinage
1.5 → 1.75, appui aéro 1.6 → 3.2. Mesure : rayon de virage à 100 km/h, 53 m → 41 m.

| | A — base | B — « Encore plus de grip » |
|---|---|---|
| Adhérence avant (`gripFront`) | 1.90 | 2.12 |
| Adhérence arrière (`gripRear`) | 1.78 | 2.00 |
| Appui aéro (`downforce`) | 3.2 | 4.6 |

Mesures : virage à 100 km/h, 41 m de rayon (A) et 35 m (B) ; freinage 257 → 0 km/h en 157 m.

_Choix retenu : à remplir après les essais._

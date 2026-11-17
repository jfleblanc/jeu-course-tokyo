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

# Journal des changements

Jeu de course 3D de nuit dans une ville inspirée de Tokyo, jouable dans le navigateur :
**https://course.jfleblanc.com**

Ce projet est fait à trois : un père et son fils, qui décident et qui jouent, et une IA
(Claude, d'Anthropic) qui écrit le code, le teste et le met en ligne. Ce journal garde la trace
des deux côtés :

- **Décidé par les humains** : ce qui a été demandé, choisi, refusé ou corrigé après avoir joué.
- **Réalisé par l'IA** : ce qui a été construit pour y répondre, et comment ça a été vérifié.

L'IA ne peut pas juger une sensation de conduite, un son ou une ambiance : elle mesure, elle
prend des captures d'écran, mais ce sont les joueurs qui tranchent. Les limites connues sont
écrites telles quelles.

Les identifiants entre parenthèses sont les versions (commits) où le changement est arrivé.

---

## Les règles du jeu, fixées par les humains avant la première ligne de code

- Three.js avec rendu WebGPU (repli WebGL2), physique Rapier, TypeScript, Vite. Pas d'Unreal.
- Toujours de nuit, style « Tokyo néon cinéma » ; géométrie simple, seules les voitures sont détaillées.
- Ville et courses **générées par code**, à partir d'un réseau de rues.
- Sensation de conduite entre arcade et simulation (référence : *The Crew Motorfest*), réglée par
  **essais A/B** : deux réglages dans le jeu, les joueurs conduisent et choisissent.
- Quelque chose de **jouable à chaque étape** ; la branche `main` est toujours jouable ; la
  version est affichée à l'écran.
- Après chaque livraison, l'IA dit ce qui a changé, quoi tester, et **ce qu'elle n'a pas pu vérifier**.
- Tous les réglages dans des fichiers de configuration lisibles (`src/config/`).

---

## 17 novembre 2026 — du premier fichier au garage dans la ville

### Socle et première conduite (8270fc5 → 217f124)
- **Réalisé par l'IA** : projet, physique de véhicule « maison » sur Rapier (chaque sensation a son
  réglage), quartier de nuit procédural, deux caméras, clavier et manette, boîte auto ou manuelle,
  drift, panneau de réglage (F1), mise en ligne automatique.
- **Réalisé par l'IA, de sa propre initiative** : un test de fumée avant chaque mise en ligne (le
  jeu démarre, la voiture roule, aucune erreur) et des bancs d'essai sans affichage pour la
  physique, les tracés et les adversaires (916ef41).

### Réglage de la conduite par essais A/B (da5b578 → 6381b6f)
| Essai | Question posée | Choix des joueurs |
|---|---|---|
| 1 | Arrière sage ou joueur ? | B, l'arrière plus joueur |
| 2 | Braquage | B, train avant plus mordant |
| 3 | Accroche en drift | Refusé : drift trop prononcé, et freiner en tournant faisait filer tout droit |
| 4 | Drift adouci | A, avec le freinage en virage au maximum |
| 5 | Adhérence | « Trop glissant à haute vitesse » ; tranché le 19 novembre : B |

Le détail des valeurs est dans `src/config/handling-history.md`.

### La ville
- **Décidé par les humains** : la première ville en grille est « beaucoup trop carrée ».
- **Réalisé par l'IA** : réseau organique (rues courbes, diagonales, carrefours en biais),
  autoroute de ceinture avec bretelles (dec9f09, 6381b6f).
- **Décidé par les humains** : des quartiers à débloquer, **aussi grands que la ville de base**,
  chacun avec son décor : docks avec entrepôts, conteneurs et grues ; baie « paradisiaque » ;
  Hakone en vraie campagne (« je ne sens pas du tout les montagnes »), avec un long pont pour
  sentir le changement.
- **Réalisé par l'IA** : trois quartiers ouverts par palier, barrières de chantier, affichage par
  morceaux (b61856f, 785bd4e, af9d2e4).
- **Décidé par les humains** : la route de montagne en spirale ne convient pas ; il faut une route
  organique, avec une entrée et une sortie différentes.
- **Réalisé par l'IA** : col de Hakone, 3 km de lacets jusqu'à 125 m, avec relief (4708f25).
  Retour : « pour le col, c'est parfait ».
- **Décidé par les humains** : un tunnel vitré et un pont portuaire entre quartiers ; des limites
  visibles partout où il y a un mur invisible (0731912).

### Courses, progression, contenu (fde3bef → ea90336)
- **Réalisé par l'IA** : tracés générés dans le réseau de rues, adversaires, décompte, classement
  en direct, mini-carte, XP, argent, 40 niveaux, garage, améliorations, NOS, sauvegarde, banque de
  tracés, bornes de départ, fiche des pilotes, mallettes d'argent et téléporteur.
- **Décidé par les humains** : les rues restent **ouvertes** pendant les courses (les barrières
  prévues au départ sont abandonnées) ; les circuits à plusieurs tours servent d'**épreuve de
  palier**, plus difficile.
- **Décidé par les humains** : courses trop faciles avec une bonne voiture ; adversaires du col
  trop passifs une fois doublés.
- **Réalisé par l'IA** : adversaires à la hauteur de la voiture du joueur, pilotes agressifs sur
  le col, départ canon à doser pendant le décompte (8378f1a, 4b62f13, 7d2b70f).

### Voitures (1234e60 → 0292b3c)
- **Décidé par les humains** : les modèles 3D sont choisis et fournis par les joueurs ; vraies
  marques ; voitures plus lourdes « pour mieux pousser les autres » ; un bruit de moteur par
  voiture ; les roues de la RX-7 sont « désaxées ».
- **Réalisé par l'IA** : 13 voitures converties et intégrées, physique propre à chacune (masse,
  roues motrices, empattement), roues recentrées sur les 13 modèles — tâche confiée à un second
  agent en parallèle, avec l'accord des joueurs.

### Musique et sons (26424a1, d8042d7, 7bfa525)
- **Réalisé par l'IA** : musique et bruitages entièrement générés par code, sans fichier audio.
- **Décidé par les humains** : la première musique est refusée (« j'aime pas trop la vibe ») ;
  demande de synthwave / dreamwave. L'IA ne peut pas écouter ce qu'elle produit : seuls les
  joueurs jugent.

### Rendu et physique des routes
- **Décidé par les humains** : « flashs blancs » gênants ; « chaussée patinoire ».
- **Réalisé par l'IA** : halo plafonné, humidité inégale de la chaussée. Retour : « parfait, ne
  plus y toucher ».
- **Décidé par les humains** : les glissières d'autoroute accrochent. Quatre essais successifs de
  l'IA, chacun refusé après avoir roulé, jusqu'aux « glissières douces » (0731912), puis
  « on peut gagner sans toucher au volant » : frotter fait maintenant perdre de la vitesse
  (8378f1a). Retour : « parfait ».
- **Réalisé par l'IA** : rampes sans arrêt net, sauts amortis, lampadaires renversables (636ec0f).

### Joueurs et garage (433eb28 → 666d00e)
- **Décidé par les humains** : plusieurs joueurs sur le même ordinateur, avec un symbole en
  **hiragana** (plutôt qu'en kanji) et un NIP.
- **Décidé par les humains, en corrigeant l'IA** : le garage ne doit pas être un menu mais **un
  vrai lieu, au sous-sol d'un immeuble de la ville**, d'où la partie commence. Le personnage
  fourni par les joueurs (Kaku) remplace le mécano : c'est le joueur lui-même.
- **Réalisé par l'IA** : atelier en sous-sol avec rampe vers la rue, caméra de surveillance,
  personnage, repère « maison » sur les cartes (d127446, 666d00e).

---

## 18 novembre 2026 — garage et grandes courses

- **Réalisé par l'IA** : pick-up Suzuki Carry, souffle du turbo au lever de pied (9435015) ;
  mobilier et voitures garées solides, le personnage monte en voiture (75aeddc) ; grandes courses
  « Tour de la région » par le pont et le tunnel (fbe99d3).
- **Décidé par les humains, en corrigeant l'IA** : le menu du garage en bandeau est refusé ; il
  revient **à gauche**, avec une vignette de chaque voiture et une fiche technique au survol.
- **Décidé par les humains, en revenant sur leur propre choix** : la circulation pendant les
  courses, demandée la veille, est **retirée**.
- **Décidé par les humains** : les arbres aussi doivent être renversables ; les gros sapins ne
  cassent qu'au-dessus d'une certaine vitesse et d'un certain poids (ae806a1).

## 19 novembre 2026 — conduite retenue, effets, épreuves

- **Décidé par les humains** : la conduite B est adoptée (742655e).
- **Réalisé par l'IA** : étincelles, fumée de pneus, poussière, flammes de turbo, éclats de bois,
  objets de rue à renverser (742655e) ; adversaires qui reviennent une fois doublés, grands tours
  par le col, épreuves : contre-la-montre, drift noté, poursuite (b62c62d) ; photos des voitures
  avec la peinture et le néon du joueur, marche à pied dans l'atelier (ec5dcc1).

## 20 novembre 2026 — performance, multijoueur, serveur

### Performance (9d9b38a)
- **Décidé par les humains** : la version de la veille tombe à 10–15 images par seconde par
  moments, même sur une machine puissante.
- **Réalisé par l'IA** : cause trouvée (jusqu'à 700 grands voiles de fumée près de la caméra) ;
  voiles plus petits et plafonnés, garde-fou automatique. Retour : « ça ne ralentit plus ».

### Finitions demandées après avoir joué (03c30c7)
- **Décidé par les humains** : le néon disparaît parfois dans l'asphalte ; ne garder **qu'un seul
  réglage de conduite** ; le personnage « a l'air attardé avec ses bras » : il lui faut de vrais
  mouvements et un vrai outil.
- **Réalisé par l'IA** : néon corrigé, bascule A/B retirée, animations libres de droits (CC0)
  adaptées au squelette du personnage, clé à cliquet en main.

### Classements, livraisons (c8d6fa0, c82560d)
- **Décidé par les humains** : un classement des meilleurs temps par course, avec le joueur et la
  voiture ; un nouveau type de mission, la **livraison de colis** contre la montre, avec des
  missions qui apparaissent et bougent sur la carte ; puis une paie selon la médaille obtenue.
- **Réalisé par l'IA** : 16 livraisons, médailles, classements, paie selon la médaille, la distance
  et le niveau. Les temps des médailles sont estimés, pas encore validés par les joueurs.

### Commandes, caméras, carte (d99e95b, 173917c)
- **Décidé par les humains** : NOS de retour sur Maj, rétroviseur sur M ; caméras de surveillance
  **fixes** dans l'atelier et à la sortie de la rampe ; les courses ne se lancent plus de
  n'importe où mais **sur leur pastille** ; la carte doit prendre tout l'écran, être plus zoomée,
  se déplacer à la souris, et montrer les courses déjà faites.
- **Réalisé par l'IA** : tout cela, plus un itinéraire au clic sur la carte.
- **Corrigé par l'IA après un échec du test automatique** : la voiture restait retenue dans le
  garage ; la version fautive du jeu n'a jamais été mise en ligne (df08ac0).

### Multijoueur (d99e95b, c82560d)
- **Décidé par les humains** : jusqu'à 4 joueurs, chacun sur son ordinateur, dans la même ville ;
  une course à plusieurs démarre quand tous sont sur le même cercle.
- **Question posée par les humains** : comment gérer quatre garages ? **Réponse retenue** : un
  seul immeuble, chaque joueur a son sous-sol privé et reste invisible des autres tant qu'il y est.
- **Réalisé par l'IA** : salons à code de 4 lettres, serveur relais, départ synchronisé.
- **Décidé par les humains, après avoir joué à deux** : les deux joueurs portaient le même nom, et
  les voitures se traversaient ; elles doivent se heurter comme les autres, surtout en course.
- **Réalisé par l'IA** : voitures des autres joueurs solides, noms distingués (c82560d).
  Vérifié à deux navigateurs sur un serveur local ; pas encore jugé entre deux vrais ordinateurs.

### Hébergement (d99e95b, 91138e8 → 7d5f1d1)
- **Décidé par les humains** : une adresse propre (course.jfleblanc.com) sur Cloudflare, puis
  l'abandon de GitHub Pages ; le dépôt reste **public**, comme exemple de travail avec une IA.
- **Réalisé par l'IA** : serveur de salons et de classements (Cloudflare Workers, objets
  durables), puis publication des fichiers du jeu par la chaîne de mise en ligne, avec une
  vérification du serveur en ligne après chaque publication.
- **Fait par les humains** : la création du jeton d'accès et son enregistrement comme secret.
  L'IA n'en avait pas le droit, et le jeton n'est jamais passé par elle.

---

## Ce que cette façon de travailler a montré

- **Les humains corrigent le cap, pas le code.** Les retours sont des phrases de joueurs
  (« ça accroche », « trop carré », « trop facile ») ; l'IA cherche la cause et propose.
- **Plusieurs idées de l'IA ont été refusées** : première ville, première musique, menu en
  bandeau, route en spirale, trois versions des glissières, pose du personnage.
- **Des choix humains ont aussi été annulés par les humains** après essai : barrières en course,
  circulation en course, touche du NOS déplacée puis remise.
- **L'IA vérifie ce qui se mesure** (types, bancs d'essai, captures, test avant mise en ligne) et
  dit ce qui ne se mesure pas : la sensation, le son, le réseau entre deux vraies machines.

## Limites connues

- Le serveur ne contrôle pas les temps envoyés : on peut tricher au classement.
- Circulation, objets renversés et colis ne sont pas partagés entre les joueurs d'un salon.
- La manette n'a pas encore été essayée par les joueurs.
- Le semi-remorque attend un modèle 3D en pièces séparées.

Les crédits des modèles 3D et des animations sont dans `CREDITS.md`.

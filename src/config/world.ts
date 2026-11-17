/** Paramètres de la ville procédurale. Même graine = même ville. */
export const WORLD = {
  seed: 20261116,
  /** Nombre de lignes de rues dans chaque direction (la ville grandira par paramètre selon le palier). */
  lines: 11,
  /** Distance moyenne entre deux lignes (m). */
  spacing: 80,
  /** Arrondi de la ville : 0 = carrée, 1 = ronde. */
  roundness: 0.78,
  /** Amplitude des ondulations du réseau (m) : c'est ce qui rend les rues courbes. */
  warp: 26,
  /** Décalage aléatoire de chaque carrefour (m). */
  jitter: 9,
  /** Part des petites rues supprimées pour créer des îlots irréguliers. */
  removeChance: { street: 0.16, alley: 0.34 },
  roadWidth: { boulevard: 30, avenue: 18, street: 11, alley: 6.5 },
  sidewalk: { boulevard: 4, avenue: 3.2, street: 2, alley: 0.9 },
  highway: {
    height: 8.5,
    rampLength: 78,
    deckHalfWidth: 4.6,
    barrierHeight: 0.95,
    pillarSpacing: 27,
  },
  /** Autoroute de ceinture : fait le tour de la ville, tantôt au sol, tantôt surélevée. */
  /**
   * Quartiers extérieurs, au-delà de l'autoroute de ceinture, ouverts à un certain niveau.
   * `section` = numéro de la portion au sol de la ceinture où se trouve leur sortie (0 à 3).
   */
  districts: {
    /** Longueur de la route d'accès entre la ceinture et le quartier (m). */
    accessLength: 150,
    accessWidth: 14,
    /** Hauteur du tablier d'un pont d'accès (m). */
    bridgeHeight: 18,
    list: [
      // theme : 'baie' = bord de mer (palmiers, hôtels clairs, grande roue), 'docks' = port
      // (entrepôts, conteneurs, grues), 'collines' = quartier bas et très arboré.
      { name: 'Baie de Yokohama', unlockLevel: 11, section: 0, theme: 'baie', lines: 11, spacing: 80, bridge: 0 },
      { name: 'Docks de Kawasaki', unlockLevel: 21, section: 2, theme: 'docks', lines: 11, spacing: 80, bridge: 0 },
      // Les collines sont une campagne : peu de routes (lignes plus espacées), et on y arrive
      // par un grand pont (`bridge` = longueur en mètres).
      { name: 'Collines de Hakone', unlockLevel: 31, section: 1, theme: 'collines', lines: 7, spacing: 130, bridge: 520 },
    ],
  },
  /** Route de montagne des Collines de Hakone : une spirale qui grimpe autour d'une colline jusqu'à un temple. */
  mountain: {
    height: 85,
    /** Rayon de la spirale en bas et en haut (m). */
    baseRadius: 240,
    topRadius: 60,
    turns: 2.25,
    halfWidth: 6.5,
    /** Ligne droite entre le quartier et le pied de la colline (m). */
    approach: 70,
  },
  ringway: {
    /** Distance entre le périphérique et l'axe de l'autoroute (m). */
    offset: 64,
    halfWidth: 12.5,
    height: 8.5,
    /** Nombre de portions au sol (chacune a deux bretelles vers le périphérique). */
    groundSections: 4,
    /** Demi-longueur d'une portion au sol (m). */
    groundHalf: 130,
    /** Longue rampe : à 250 km/h la voiture doit rester collée à la route au sommet. */
    rampLength: 200,
    /** Largeur et longueur d'une bretelle (m). */
    connectorWidth: 9,
    connectorLength: 110,
    pillarSpacing: 30,
  },
} as const;

export type RoadKind = keyof typeof WORLD.roadWidth;

/** Palette néon (linéaire, avant intensité). Magenta, cyan, ambre sur fond bleu nuit. */
export const NEON_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.08, 0.55], // magenta
  [1.0, 0.08, 0.55],
  [0.05, 0.75, 1.0], // cyan
  [0.05, 0.75, 1.0],
  [1.0, 0.55, 0.08], // ambre
  [1.0, 0.12, 0.1], // rouge
  [0.55, 0.2, 1.0], // violet
  [0.1, 1.0, 0.55], // vert menthe
  [1.0, 0.95, 0.85], // blanc chaud
  [0.2, 0.35, 1.0], // bleu
];

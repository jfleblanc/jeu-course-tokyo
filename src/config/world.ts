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

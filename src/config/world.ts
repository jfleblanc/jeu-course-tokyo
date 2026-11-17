/** Paramètres du quartier procédural. Même graine = même ville. */
export const WORLD = {
  seed: 20261116,
  /** Nombre de rues dans chaque direction (la ville grandira par paramètre selon le palier). */
  linesX: 9,
  linesZ: 9,
  spacingMin: 52,
  spacingMax: 92,
  /** Part des petites rues supprimées pour créer des îlots irréguliers. */
  removeEdgeChance: 0.2,
  roadWidth: { boulevard: 30, avenue: 16, street: 10, alley: 6.5 },
  sidewalk: { boulevard: 4, avenue: 3, street: 1.8, alley: 0.9 },
  sidewalkHeight: 0.12,
  highway: {
    height: 8.5,
    rampLength: 78,
    deckHalfWidth: 4.6,
    barrierHeight: 0.95,
    weave: 2.6,
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

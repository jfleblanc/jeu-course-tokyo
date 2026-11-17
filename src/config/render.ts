/** Réglages de rendu (ambiance « Tokyo néon cinéma »). Modifiables dans le panneau F1, onglet Rendu. */
export interface RenderConfig {
  exposure: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  fogDensity: number;
  neon: number;
  wetness: number;
  /** Volume de la musique (0 = coupée). */
  musicVolume: number;
}

export const RENDER_DEFAULTS: RenderConfig = {
  exposure: 1.0,
  bloomStrength: 0.5,
  bloomRadius: 0.6,
  bloomThreshold: 0.72,
  fogDensity: 0.003,
  neon: 1.0,
  wetness: 1.0,
  musicVolume: 0.6,
};

export const RENDER_SLIDERS: { key: keyof RenderConfig; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: 'Exposition', min: 0.4, max: 2.5, step: 0.05 },
  { key: 'bloomStrength', label: 'Bloom (halo des néons)', min: 0, max: 1.6, step: 0.05 },
  { key: 'bloomRadius', label: 'Rayon du bloom', min: 0, max: 1, step: 0.05 },
  { key: 'bloomThreshold', label: 'Seuil du bloom', min: 0.2, max: 1.5, step: 0.02 },
  { key: 'fogDensity', label: 'Brouillard', min: 0, max: 0.012, step: 0.0002 },
  { key: 'neon', label: 'Intensité des néons', min: 0.3, max: 2, step: 0.05 },
  { key: 'wetness', label: 'Reflets chaussée mouillée', min: 0, max: 1.6, step: 0.05 },
  { key: 'musicVolume', label: 'Volume de la musique', min: 0, max: 1, step: 0.05 },
];

export type Quality = 'bas' | 'moyen' | 'haut';

export const QUALITY: Record<Quality, { pixelRatio: number; reflections: boolean; reflectionScale: number; bloom: boolean }> = {
  bas: { pixelRatio: 1, reflections: false, reflectionScale: 0.25, bloom: true },
  moyen: { pixelRatio: 1.25, reflections: true, reflectionScale: 0.4, bloom: true },
  haut: { pixelRatio: 1.5, reflections: true, reflectionScale: 0.6, bloom: true },
};

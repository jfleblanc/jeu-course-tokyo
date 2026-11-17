/**
 * Pistes de musique générées par code. Pour en ajouter une : copier un bloc et changer
 * le tempo, les accords et les motifs. Tout est écrit en demi-tons par rapport à `root`.
 *
 * Style : synthwave / dreamwave / retrowave — tempos posés, accords riches (septièmes,
 * neuvièmes), grandes nappes, piano électrique façon années 80, caisse claire à réverbération
 * coupée, mélodie douce qui glisse d'une note à l'autre.
 *
 * Motifs sur 16 pas (doubles croches) par mesure :
 *  - kick / snare / hat : 'x' = coup, 'o' = charleston ouvert, '.' = silence
 *  - bass : demi-tons au-dessus de la fondamentale de l'accord (null = silence)
 *  - arp  : numéro de la note de l'accord (0, 1, 2… ; au-delà, on monte d'une octave)
 *  - lead / lead2 : mélodie, une note par croche sur 4 mesures (32 cases), null = la note
 *    précédente dure, 'x' (ici -99) = silence. `lead2` est la seconde phrase (fin du morceau).
 */
export interface TrackDef {
  name: string;
  bpm: number;
  /** Note fondamentale (numéro MIDI) de la tonalité. */
  root: number;
  bassOctave: number;
  /** Accords, un par mesure. */
  chords: number[][];
  introBars: number;
  kick: string;
  snare: string;
  hat: string;
  bass: (number | null)[];
  /** Durée d'une note de basse, en pas. */
  bassLength: number;
  bassCutoff: number;
  arp: (number | null)[];
  /** 'bell' = piano électrique FM (doux), 'pluck' = synthé pincé (plus brillant). */
  arpVoice: 'bell' | 'pluck';
  arpLevel: number;
  padCutoff: number;
  /** Profondeur de l'effet de pompe (1 = aucun, 0.3 = très marqué). */
  pump: number;
  lead: (number | null)[];
  lead2?: (number | null)[];
}

const _ = null;
/** Silence dans une mélodie. */
export const REST = -99;
const x = REST;

export const TRACKS: TrackDef[] = [
  {
    // Dreamwave lumineux : do majeur, IV – V – iii – vi, piano électrique et grande nappe.
    name: 'Coucher de soleil sur la baie',
    bpm: 92,
    root: 48, // do
    bassOctave: -1,
    chords: [[5, 9, 12, 16], [7, 11, 14, 17], [4, 7, 11, 14], [9, 12, 16, 19]], // Fa maj7 – Sol7 – Mim7 – Lam7
    introBars: 4,
    kick: 'x.......x.....x.',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.o.',
    bass: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 12, _],
    bassLength: 1.8,
    bassCutoff: 330,
    arp: [0, _, 2, _, 1, _, 3, _, 2, _, 4, _, 3, _, 1, _],
    arpVoice: 'bell',
    arpLevel: 0.14,
    padCutoff: 1700,
    pump: 0.55,
    lead: [
      16, _, _, 14, 12, _, _, _,
      14, _, _, 12, 11, _, 7, _,
      11, _, _, 12, 14, _, _, _,
      12, _, _, _, 9, _, x, _,
    ],
    lead2: [
      19, _, _, 16, _, _, 17, _,
      19, _, 21, _, 19, _, 14, _,
      16, _, _, 14, _, _, 11, _,
      12, _, _, _, _, _, x, _,
    ],
  },
  {
    // Rêverie lente : la mineur, accords de neuvième, beaucoup d'espace.
    name: 'Rêve en VHS',
    bpm: 84,
    root: 45, // la
    bassOctave: -1,
    chords: [[0, 3, 7, 10, 14], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 12]], // Lam9 – Fa maj7 – Do maj7 – Sol add9
    introBars: 4,
    kick: 'x.........x.....',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    bass: [0, _, _, _, _, _, 0, _, 0, _, _, _, 7, _, _, _],
    bassLength: 3.4,
    bassCutoff: 290,
    arp: [0, _, _, 2, _, _, 3, _, _, 4, _, _, 2, _, 3, _],
    arpVoice: 'bell',
    arpLevel: 0.15,
    padCutoff: 2000,
    pump: 0.65,
    lead: [
      x, _, 12, _, _, _, 10, _,
      7, _, _, _, 3, _, 5, _,
      7, _, _, _, _, _, 10, _,
      5, _, _, _, 2, _, x, _,
    ],
    lead2: [
      x, _, 15, _, _, _, 14, _,
      12, _, _, _, 10, _, 7, _,
      10, _, _, _, _, _, 14, _,
      12, _, _, _, _, _, x, _,
    ],
  },
  {
    // Retrowave de route : mi mineur, basse en croches, pour rouler vite sur la ceinture.
    name: 'Autoroute 1986',
    bpm: 104,
    root: 40, // mi
    bassOctave: 0,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]], // Mim7 – Do maj7 – Sol maj7 – Ré6
    introBars: 4,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.o.',
    bass: [0, _, 0, _, 12, _, 0, _, 0, _, 0, _, 12, _, 0, _],
    bassLength: 1.6,
    bassCutoff: 380,
    arp: [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 2, 1, 2, 4, 2],
    arpVoice: 'pluck',
    arpLevel: 0.05,
    padCutoff: 1500,
    pump: 0.45,
    lead: [
      19, _, _, 17, 15, _, _, 12,
      15, _, _, _, 12, _, 10, _,
      14, _, _, 15, 17, _, _, _,
      14, _, _, _, 10, _, x, _,
    ],
    lead2: [
      24, _, _, 22, 19, _, _, _,
      22, _, 19, _, 17, _, 15, _,
      19, _, _, 17, _, _, 14, _,
      17, _, _, _, _, _, x, _,
    ],
  },
  {
    // Nocturne : fa dièse mineur, tempo moyen, piano électrique et mélodie qui chante.
    name: 'Minuit à Shinjuku',
    bpm: 96,
    root: 42, // fa dièse
    bassOctave: 0,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 10]], // Fa#m7 – Ré maj7 – La maj7 – Mi sus
    introBars: 2,
    kick: 'x.....x...x.....',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    bass: [0, _, _, 0, _, _, 0, _, 0, _, _, 0, _, _, 7, _],
    bassLength: 2.4,
    bassCutoff: 310,
    arp: [0, _, 1, 2, _, 3, _, 2, 4, _, 3, 2, _, 1, _, 2],
    arpVoice: 'bell',
    arpLevel: 0.12,
    padCutoff: 1800,
    pump: 0.55,
    lead: [
      12, _, _, _, 10, _, 7, _,
      8, _, _, 7, _, _, 3, _,
      7, _, _, _, 10, _, 12, _,
      10, _, _, _, 5, _, x, _,
    ],
    lead2: [
      15, _, _, 14, _, _, 12, _,
      14, _, _, 12, 10, _, 7, _,
      12, _, _, _, 14, _, 15, _,
      14, _, _, _, _, _, x, _,
    ],
  },
];

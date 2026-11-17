/**
 * Pistes de musique générées par code. Pour en ajouter une : copier un bloc et changer
 * le tempo, les accords et les motifs. Tout est écrit en demi-tons par rapport à `root`.
 *
 * Motifs sur 16 pas (doubles croches) par mesure :
 *  - kick / snare / hat : 'x' = coup, 'o' = charleston ouvert, '.' = silence
 *  - bass : demi-tons au-dessus de la fondamentale de l'accord (null = silence)
 *  - arp  : numéro de la note de l'accord (0, 1, 2… ; au-delà, on monte d'une octave)
 *  - lead : mélodie, une note par croche sur 4 mesures (32 cases), null = la note précédente dure
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
  arpWave: OscillatorType;
  arpLevel: number;
  padCutoff: number;
  /** Profondeur de l'effet de pompe (1 = aucun, 0.3 = très marqué). */
  pump: number;
  lead: (number | null)[];
}

const _ = null;

export const TRACKS: TrackDef[] = [
  {
    // Synthwave classique : la mineur, quatre temps bien marqués, arpège brillant.
    name: 'Néon Drive',
    bpm: 104,
    root: 45, // la
    bassOctave: 0,
    chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], // Lam – Fa – Do – Sol
    introBars: 4,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.o.',
    bass: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 12, _, 0, _],
    bassLength: 1.7,
    bassCutoff: 420,
    arp: [0, 2, 3, 2, 1, 3, 4, 3, 0, 2, 3, 2, 1, 3, 5, 3],
    arpWave: 'sawtooth',
    arpLevel: 0.085,
    padCutoff: 1500,
    pump: 0.4,
    lead: [
      7, _, _, 5, 3, _, _, _,
      0, _, _, 3, _, _, 5, _,
      7, _, _, 10, _, 7, _, _,
      5, _, _, _, 2, _, _, _,
    ],
  },
  {
    // Outrun plus sombre et plus rapide : ré mineur, basse galopante.
    name: 'Minuit Express',
    bpm: 122,
    root: 50, // ré
    bassOctave: -1,
    chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]], // Rém – Sib – Do – Rém
    introBars: 2,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..o...o...o...o.',
    bass: [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 0, 12],
    bassLength: 0.85,
    bassCutoff: 520,
    arp: [0, _, 3, _, 2, _, 4, _, 0, _, 3, _, 2, _, 5, _],
    arpWave: 'square',
    arpLevel: 0.06,
    padCutoff: 1100,
    pump: 0.32,
    lead: [
      12, _, 7, _, 3, _, 7, _,
      8, _, _, 7, 5, _, 3, _,
      10, _, 5, _, 2, _, 5, _,
      7, _, _, _, 0, _, _, _,
    ],
  },
  {
    // Ambiance calme pour flâner en ville : fa dièse mineur, tempo lent, accords riches.
    name: 'Pluie sur Shibuya',
    bpm: 86,
    root: 42, // fa dièse
    bassOctave: 0,
    chords: [[0, 3, 7, 10], [-2, 2, 5, 9], [-4, 0, 3, 7], [-2, 2, 5]], // Fa#m7 – Mi – Ré maj7 – Mi
    introBars: 2,
    kick: 'x.........x.....',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    bass: [0, _, _, _, _, _, 0, _, _, _, 7, _, _, _, _, _],
    bassLength: 3.6,
    bassCutoff: 340,
    arp: [0, _, _, 2, _, _, 3, _, _, 4, _, _, 2, _, _, _],
    arpWave: 'triangle',
    arpLevel: 0.11,
    padCutoff: 1900,
    pump: 0.6,
    lead: [
      _, _, 7, _, _, _, 10, _,
      _, _, 5, _, _, _, 2, _,
      _, _, 7, _, _, _, 3, _,
      _, _, 5, _, 2, _, _, _,
    ],
  },
];

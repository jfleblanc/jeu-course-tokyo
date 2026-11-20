/**
 * Classements : les meilleurs temps (ou scores) de chaque course, épreuve et livraison, avec le
 * joueur et la voiture. Communs à tous les joueurs de cet ordinateur (un seul tableau dans le
 * navigateur). Le format est prêt à être partagé entre ordinateurs le jour où le jeu a un serveur.
 */
export interface RecordEntry {
  player: string;
  symbol: string;
  car: string;
  /** Temps en secondes, ou points pour le drift. */
  value: number;
  /** Date ISO (jour). */
  date: string;
}

const KEY = 'jeu-course-tokyo.records';
const KEEP = 5;

type Table = Record<string, RecordEntry[]>;

function read(): Table {
  try {
    const raw = localStorage.getItem(KEY);
    const d = raw ? (JSON.parse(raw) as { version?: number; table?: Table }) : null;
    return d?.table ?? {};
  } catch {
    return {};
  }
}

function write(t: Table): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, table: t }));
  } catch {
    /* stockage plein ou interdit : tant pis pour le classement */
  }
}

/** Les meilleurs résultats d'une épreuve, le meilleur d'abord. */
export function recordsFor(key: string): RecordEntry[] {
  return read()[key] ?? [];
}

/**
 * Inscrit un résultat. `higherIsBetter` : vrai pour des points (drift), faux pour un temps.
 * Un joueur n'a qu'une ligne par voiture : sa meilleure. Renvoie son rang (1 = record), ou 0 s'il
 * n'entre pas au classement, et s'il a amélioré sa propre marque.
 */
export function submitRecord(key: string, entry: RecordEntry, higherIsBetter: boolean): { rank: number; improved: boolean } {
  const t = read();
  const list = t[key] ?? [];
  const better = (a: number, b: number): boolean => (higherIsBetter ? a > b : a < b);
  const mine = list.findIndex((e) => e.player === entry.player && e.car === entry.car);
  let improved = true;
  if (mine >= 0) {
    if (better(entry.value, (list[mine] as RecordEntry).value)) list.splice(mine, 1);
    else improved = false;
  }
  if (improved) list.push(entry);
  list.sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  list.length = Math.min(list.length, KEEP);
  t[key] = list;
  write(t);
  const rank = list.findIndex((e) => e.player === entry.player && e.car === entry.car && e.value === entry.value) + 1;
  return { rank, improved };
}

export const fmtRecordTime = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/** Tableau prêt à afficher (HTML). `points` : les valeurs sont des points et non des temps. */
export function recordsHtml(key: string, points: boolean, highlight?: { player: string; car: string }): string {
  const list = recordsFor(key);
  if (list.length === 0) return '<div class="rec-empty">Aucun temps enregistré : à vous d’ouvrir le classement.</div>';
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  return list
    .map((e, k) => `<div class="rec${highlight && e.player === highlight.player && e.car === highlight.car ? ' me' : ''}"><i>${k + 1}</i><span class="who"><b>${esc(e.symbol)}</b> ${esc(e.player)}</span><span class="car">${esc(e.car)}</span><em>${points ? `${Math.round(e.value).toLocaleString('fr-CA')} pts` : fmtRecordTime(e.value)}</em></div>`)
    .join('');
}

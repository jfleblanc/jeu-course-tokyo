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

import { NET } from '../config/net';

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
  // Classement partagé entre ordinateurs : on prévient le serveur (sans attendre, et sans s'en faire s'il est injoignable).
  if (improved) {
    void fetch(`${NET.server}/api/records`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cle: key, points: higherIsBetter, ligne: entry }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { liste?: RecordEntry[] } | null) => { if (d?.liste) { const tt = read(); tt[key] = d.liste; write(tt); } })
      .catch(() => undefined);
  }
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

/** Les classements dont la valeur est un nombre de points (le plus grand gagne). */
const isPoints = (key: string): boolean => key.startsWith('drift|');

/**
 * Récupère le classement partagé et le fusionne avec celui de ce navigateur ; les temps faits
 * hors ligne sont envoyés au passage. Sans réseau, on garde simplement le classement local.
 */
export async function syncRecords(): Promise<void> {
  try {
    const res = await fetch(`${NET.server}/api/records`);
    if (!res.ok) return;
    const remote = ((await res.json()) as { table?: Table }).table ?? {};
    const local = read();
    for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      const points = isPoints(key);
      const theirs = remote[key] ?? [];
      const all = [...theirs];
      for (const e of local[key] ?? []) {
        const k = all.findIndex((x) => x.player === e.player && x.car === e.car);
        const known = k >= 0 && (points ? (all[k] as RecordEntry).value >= e.value : (all[k] as RecordEntry).value <= e.value);
        if (known) continue;
        if (k >= 0) all.splice(k, 1);
        all.push(e);
        // un temps que le serveur n'a pas : on le lui envoie
        void fetch(`${NET.server}/api/records`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cle: key, points, ligne: e }) }).catch(() => undefined);
      }
      all.sort((a, b) => (points ? b.value - a.value : a.value - b.value));
      all.length = Math.min(all.length, KEEP);
      local[key] = all;
    }
    write(local);
  } catch {
    /* hors ligne : classement local seulement */
  }
}

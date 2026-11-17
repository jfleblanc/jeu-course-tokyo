/**
 * Joueurs : plusieurs parties sur le même ordinateur. Chaque joueur a une carte (nom, symbole,
 * NIP facultatif) et sa propre sauvegarde. Le NIP n'est pas une protection sérieuse — tout reste
 * dans le navigateur — : il évite seulement qu'on joue la partie d'un autre par mégarde.
 */
export interface Profile {
  id: string;
  name: string;
  /** Symbole de course (un caractère). */
  symbol: string;
  /** Empreinte du NIP, ou '' s'il n'y en a pas. */
  pin: string;
  created: number;
}

/** Ce qu'on affiche sur la carte d'un joueur, lu dans sa sauvegarde. */
export interface ProfileSummary {
  level: number;
  money: number;
  races: number;
  wins: number;
  active: number;
  cars: { model: string; paint: number }[];
}

const LIST_KEY = 'jeu-course-tokyo.joueurs';
const ACTIVE_KEY = 'jeu-course-tokyo.joueur-actif';
const OLD_SAVE_KEY = 'jeu-course-tokyo.joueur';

/** Symboles proposés : vent, dragon, tigre, tonnerre, étoile, cerisier, démon, samouraï, loup, flamme, nuit, lune. */
export const SYMBOLS = ['風', '龍', '虎', '雷', '星', '桜', '鬼', '侍', '狼', '炎', '夜', '月'] as const;

export const saveKeyFor = (id: string): string => `${OLD_SAVE_KEY}.${id}`;

const hashPin = (pin: string): string => {
  if (!pin) return '';
  let h = 2166136261;
  for (const ch of `tokyo:${pin}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
};

function read(): Profile[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (raw) {
      const list = JSON.parse(raw) as Profile[];
      if (Array.isArray(list)) return list.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string');
    }
    // Première fois avec cette version : la partie existante devient le premier joueur.
    const old = localStorage.getItem(OLD_SAVE_KEY);
    if (old) {
      const first: Profile = { id: 'j1', name: 'Joueur 1', symbol: SYMBOLS[0], pin: '', created: Date.now() };
      localStorage.setItem(saveKeyFor(first.id), old);
      localStorage.setItem(LIST_KEY, JSON.stringify([first]));
      return [first];
    }
  } catch {
    // stockage indisponible : pas de joueurs enregistrés
  }
  return [];
}

function write(list: Profile[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    // tant pis
  }
}

export const listProfiles = (): Profile[] => read();

export function createProfile(name: string, symbol: string, pin: string): Profile {
  const list = read();
  const p: Profile = { id: `j${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, name: name.trim().slice(0, 14) || `Joueur ${list.length + 1}`, symbol, pin: hashPin(pin), created: Date.now() };
  list.push(p);
  write(list);
  return p;
}

export function deleteProfile(id: string): void {
  write(read().filter((p) => p.id !== id));
  try {
    localStorage.removeItem(saveKeyFor(id));
  } catch {
    // tant pis
  }
}

export const pinMatches = (p: Profile, pin: string): boolean => p.pin === '' || p.pin === hashPin(pin);

export function activeProfileId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    return id && read().some((p) => p.id === id) ? id : null;
  } catch {
    return null;
  }
}

export function setActiveProfile(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // tant pis
  }
}

export function profileSummary(id: string): ProfileSummary {
  const empty: ProfileSummary = { level: 1, money: 0, races: 0, wins: 0, active: 0, cars: [] };
  try {
    const raw = localStorage.getItem(saveKeyFor(id));
    if (!raw) return empty;
    const d = JSON.parse(raw) as Partial<ProfileSummary> & { cars?: { model: string; paint?: number }[] };
    return { level: d.level ?? 1, money: d.money ?? 0, races: d.races ?? 0, wins: d.wins ?? 0, active: d.active ?? 0, cars: (d.cars ?? []).map((c) => ({ model: c.model, paint: c.paint ?? -1 })) };
  } catch {
    return empty;
  }
}

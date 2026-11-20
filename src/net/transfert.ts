/**
 * Déménagement du jeu vers course.jfleblanc.com : les sauvegardes vivent dans le navigateur, par
 * adresse de site. Ce module emporte les joueurs, leurs parties et les classements d'une adresse
 * à l'autre, dans le lien lui-même (« #transfert=… »). Il doit être importé en tout premier :
 * il écrit dans le stockage avant que le reste du jeu ne le lise.
 */
const PREFIX = 'jeu-course-tokyo';
const NEW_HOME = 'https://course.jfleblanc.com/';

const encode = (s: string): string => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (s: string): string => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** Résultat de l'arrivée d'un transfert, pour l'annoncer au joueur ('' : rien à dire). */
export let transferNote = '';

function receive(): void {
  const m = /^#transfert=(.+)$/.exec(location.hash);
  if (!m) return;
  try {
    const data = JSON.parse(decode(m[1] as string)) as Record<string, string>;
    history.replaceState(null, '', location.pathname + location.search);
    if (localStorage.getItem(`${PREFIX}.joueurs`)) {
      transferNote = 'Il y a déjà des joueurs ici : le transfert n’a rien remplacé.';
      return;
    }
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
      if (!k.startsWith(PREFIX) || typeof v !== 'string') continue;
      localStorage.setItem(k, v);
      n++;
    }
    transferNote = n ? 'Vos joueurs et vos parties ont été transférés.' : '';
  } catch {
    transferNote = 'Le lien de transfert est illisible.';
  }
}
receive();

/** Vrai sur l'ancienne adresse (GitHub Pages) : on y propose le déménagement. */
export const onOldHome = location.hostname.endsWith('github.io');

/** Lien vers la nouvelle adresse, avec toutes les sauvegardes de ce navigateur. */
export function transferUrl(): string {
  const data: Record<string, string> = {};
  try {
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (key && key.startsWith(PREFIX)) data[key] = localStorage.getItem(key) ?? '';
    }
  } catch {
    return NEW_HOME;
  }
  return Object.keys(data).length ? `${NEW_HOME}#transfert=${encode(JSON.stringify(data))}` : NEW_HOME;
}

// Personnes reconnues au shoot à plusieurs. Les visages (photo + signature) restent sur ce téléphone ;
// seuls le nom et les résultats de chaque joueur vont dans la session enregistrée.
import { minFaceDistance } from "../vision/people";

export const ME = "me";

export interface KnownPerson {
  /** « me » pour le joueur lui-même, sinon un identifiant gardé d'une session à l'autre. */
  key: string;
  name: string;
  /** Signatures de visage (vides si la personne n'a pas donné son accord). */
  descriptors: number[][];
  photo: string | null;
  updated: string;
}

/** Résultat d'un joueur dans une session de shoot (enregistré dans results.players). */
export interface PlayerResult {
  key: string;
  name: string;
  made: number;
  attempts: number;
  pct: number;
}

const storeKey = (userId: string) => `pb.people.v1.${userId}`;

export function knownPeople(userId: string): KnownPerson[] {
  try { return JSON.parse(localStorage.getItem(storeKey(userId)) ?? "[]"); } catch { return []; }
}
function write(userId: string, list: KnownPerson[]): boolean {
  try { localStorage.setItem(storeKey(userId), JSON.stringify(list)); return true; } catch { return false; }
}

/** La personne connue la plus proche de ces visages, si elle est assez proche pour être « probablement » elle. */
export function recognize(userId: string, descriptors: number[][]): { person: KnownPerson; distance: number } | null {
  if (!descriptors.length) return null;
  let best: { person: KnownPerson; distance: number } | null = null;
  for (const p of knownPeople(userId)) {
    if (!p.descriptors.length) continue;
    const d = minFaceDistance(p.descriptors, descriptors);
    if (d < 0.5 && (!best || d < best.distance)) best = { person: p, distance: d };
  }
  return best;
}

/** Enregistre ou complète une personne. faces : seulement si elle est d'accord pour que son visage soit gardé. */
export function rememberPerson(userId: string, p: { key: string; name: string; faces?: { descriptors: number[][]; photo: string | null } | null }) {
  const list = knownPeople(userId);
  const cur = list.find((x) => x.key === p.key);
  const now = new Date().toISOString();
  if (cur) {
    cur.name = p.name;
    cur.updated = now;
    if (p.faces) {
      // on garde les 8 dernières signatures : la reconnaissance suit les changements (coiffure, lumière)
      cur.descriptors = [...p.faces.descriptors, ...cur.descriptors].slice(0, 8);
      cur.photo = p.faces.photo ?? cur.photo;
    }
  } else {
    list.push({ key: p.key, name: p.name, descriptors: p.faces?.descriptors.slice(0, 8) ?? [], photo: p.faces?.photo ?? null, updated: now });
  }
  // stockage plein : on retire les photos les plus anciennes, les signatures restent
  if (!write(userId, list)) {
    for (const x of [...list].sort((a, b) => a.updated.localeCompare(b.updated))) { x.photo = null; if (write(userId, list)) break; }
  }
}

/** Efface le visage d'une personne du téléphone (son nom et ses résultats restent). */
export function forgetFace(userId: string, key: string) {
  const list = knownPeople(userId);
  const p = list.find((x) => x.key === key);
  if (p) { p.descriptors = []; p.photo = null; write(userId, list); }
}

export const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "") === b.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "");

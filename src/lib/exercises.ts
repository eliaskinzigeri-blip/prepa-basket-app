import data from "../data/exercises.json";
import { GYM_EQUIPMENT, TEMPLATES, type DoseStyle } from "../data/catalog";
import type { Exercise, Profile } from "./types";
import type { Progression } from "./progression";

export const EXERCISES = data as Exercise[];
const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
export const exercise = (id: string) => BY_ID.get(id);

/** Matériel disponible selon le lieu du créneau (US7 / US17). */
export function equipmentFor(location: string | null | undefined, profile: Pick<Profile, "home_equipment">): Set<string> {
  if (location === "salle") return new Set(GYM_EQUIPMENT);
  if (location === "terrain") return new Set(profile.home_equipment.filter((e) => e === "corde" || e === "plots" || e === "elastiques"));
  return withImplied(new Set(profile.home_equipment));
}

/** Qui a 2 kettlebells en a forcément une : les exercices à une seule kettlebell restent proposés. */
export function withImplied(set: Set<string>): Set<string> {
  if (set.has("kettlebell_x2")) set.add("kettlebell");
  if (set.has("rameur")) set.add("banc"); // le Woodrower se replie en banc
  return set;
}

const canDo = (e: Exercise, eq: Set<string>) => e.equipment.every((x) => eq.has(x));

/** Tirage stable : même séance → mêmes exercices (aperçu = séance), séances différentes → exercices variés. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Level = Pick<Progression, "stage" | "step" | "age"> & { lestKg?: number; deload?: boolean };
const BEGINNER: Level = { stage: 1, step: 0, age: null };
// Lest possible : exercices au poids du corps (ou sur box, banc, barre de traction), hors mobilité, cardio
// et sauts en contrebas / unipodaux, où un lest charge trop les tendons à la réception.
export const NO_LOAD_GEAR = new Set(["box", "plots", "banc", "barre_traction"]);
export const canLest = (e: Exercise) => e.equipment.every((x) => NO_LOAD_GEAR.has(x)) && !["mobilite", "cardio", "cheville"].includes(e.pattern)
  && !/Depth|Single|Unipodal|1759|1374/i.test(e.id + " " + e.name);

export function exercisesFor(template: string, location: string | null | undefined, profile: Pick<Profile, "home_equipment">, minutes: number, seed = "", prog: Level = BEGINNER): Exercise[] {
  const t = TEMPLATES[template] ?? TEMPLATES.haut;
  const eq = equipmentFor(location, profile);
  const count = minutes <= 30 ? 4 : minutes <= 45 ? 5 : minutes <= 60 ? 6 : 8;
  // récupération : toujours facile ; avant 15 ans, pas de mouvements olympiques ni de barre lourde au niveau avancé
  const stage = t.style === "light" ? 1 : prog.stage;
  const young = prog.age != null && prog.age < 15;
  const used = new Set<string>();
  const out: Exercise[] = [];
  for (const pattern of t.patterns) {
    if (out.length >= count) break;
    // séance légère : aucun exercice qui charge fortement les jambes
    const pool = EXERCISES.filter((e) => e.pattern === pattern && canDo(e, eq) && !used.has(e.id) && (t.heavyLegs || !e.heavyLegs)
      && e.level <= stage && !(young && e.level === 3 && e.equipment.includes("barre")));
    // le plus dur débloqué d'abord (on progresse), puis le matériel du lieu (en salle : barres et machines), puis tirage
    const top = Math.max(0, ...pool.map((e) => e.level));
    const hard = pool.filter((e) => e.level === top);
    const most = Math.max(0, ...hard.map((e) => e.equipment.length));
    const best = hard.filter((e) => e.equipment.length >= Math.min(most, 1));
    const pick = best.sort((a, b) => hash(seed + a.id) - hash(seed + b.id))[0];
    if (pick) {
      used.add(pick.id);
      const ex = prescribe(pick, t.style ?? "hyper", prog.step, stage, young);
      // Semaine allégée : une série de moins et pas de lest, mêmes exercices (on garde la technique)
      if (prog.deload) out.push({ ...ex, sets: Math.max(2, ex.sets - 1) });
      else out.push(prog.lestKg && t.style !== "light" && canLest(ex) ? { ...ex, lest: prog.lestKg } : ex);
    }
  }
  return out;
}

const EXPLOSIVE = new Set(["saut", "puissance", "lateral", "cheville"]);

/**
 * Dosage selon l'objectif de la séance et le palier : le volume monte de palier en palier
 * (+2 reps ou +10 s, puis +1 série), et repart de la base quand des exercices plus durs se débloquent.
 */
export function prescribe(e: Exercise, style: DoseStyle, step: number, stage = 1, young = false): Exercise {
  if (e.pattern === "mobilite" || style === "light") return e;
  const moreSets = step >= 2 ? 1 : 0;
  const moreReps = step % 2 === 1 ? 2 : 0;
  if (e.seconds) {
    const base = style === "endu" ? Math.max(e.seconds, 40) : e.seconds;
    return { ...e, sets: e.sets + moreSets, seconds: Math.min(90, base + 10 * (step % 2 === 1 ? 1 : 0) + 5 * step + 5 * (stage - 1)), rest: style === "endu" ? 30 : e.rest };
  }
  const explosive = EXPLOSIVE.has(e.pattern);
  if (style === "power" && explosive) return { ...e, sets: 3 + moreSets + (stage >= 3 ? 1 : 0), reps: 5 + (step % 2), rest: 90 };
  if (style === "endu") return { ...e, sets: 3, reps: 15 + 3 * step, rest: 30 };
  // mollets et chevilles : toujours en séries longues
  if (e.pattern === "mollet") return { ...e, sets: 3 + moreSets, reps: 12 + moreReps * 2, rest: 60 };
  if (style === "force" || (style === "power" && !explosive)) return { ...e, sets: 3 + moreSets, reps: (young ? 8 : 6) + moreReps, rest: 120 }; // ados : jamais très lourd
  // prise de muscle : 10-12 reps, 3 à 4 séries, repos court
  if (explosive) return { ...e, sets: 3 + moreSets, reps: 6, rest: 75 };
  return { ...e, sets: 3 + moreSets, reps: (e.level === 3 ? 8 : 10) + moreReps, rest: 75 }; // variantes avancées : un peu moins de reps
}

/** Équivalents : même schéma de mouvement (même muscle), matériel disponible. */
export function alternatives(ex: Exercise, location: string | null | undefined, profile: Pick<Profile, "home_equipment">): Exercise[] {
  const eq = equipmentFor(location, profile);
  return EXERCISES.filter((e) => e.id !== ex.id && e.pattern === ex.pattern && canDo(e, eq));
}

/** Consigne des deux côtés, affichée pendant la séance. */
export function sideHint(e: Exercise): string | null {
  const n = e.seconds ? `${e.seconds} s` : `${e.reps} reps`;
  if (e.side === "each") return `Un côté à la fois : ${n} à gauche, puis ${n} à droite. Les deux côtés font une série.`;
  if (e.side === "alt") return `En alternant gauche et droite : ${n} de chaque côté par série.`;
  return null;
}

export function dose(e: Exercise): string {
  const per = e.side ? " par côté" : "";
  return (e.seconds ? `${e.sets} × ${e.seconds} s${per}` : `${e.sets} séries × ${e.reps} reps${per}`) + (e.lest ? ` · lest ${String(e.lest).replace(".", ",")} kg` : "");
}

/** Estimation 1RM (Epley) pour suivre la charge sur un exercice. */
export function oneRm(load: number, reps: number) {
  return load * (1 + reps / 30);
}

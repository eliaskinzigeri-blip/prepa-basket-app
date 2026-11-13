// Niveau d'entraînement du joueur : plus il s'entraîne et progresse à ses tests, plus les séances se corsent.
// 3 niveaux (exercices débloqués) et 4 paliers par niveau (volume qui monte), puis exercices plus durs au niveau suivant.
import type { CalEvent, Goal, Measurement, Profile } from "./types";
import { forecast } from "./goals";

export interface Progression {
  stage: 1 | 2 | 3; // exercices jusqu'à ce niveau de difficulté
  step: 0 | 1 | 2 | 3; // palier de volume dans le niveau
  done: number; // workouts faits ces 4 derniers mois
  toNext: number | null; // séances avant le palier suivant (null : au maximum)
  age: number | null;
  /** Au-delà du dernier palier : lest conseillé sur les exercices au poids du corps (kg, 0 sinon). */
  lestKg: number;
  lestPct: number;
}

const EXP: Record<string, number> = { lt1: 0, "1-3": 0.3, "3-5": 0.6, gt5: 0.9 };
const LVL: Record<string, number> = { loisir: 0, departemental: 0.2, regional: 0.4, national: 0.6 };
const PER_SESSION = 0.1; // 10 séances = un niveau, 2 à 3 séances = un palier
const MAX = 3.5; // fin du palier 12
const PHYSICAL = new Set(["dunk", "vertical", "sprint", "cardio", "physique"]);

export function progressionOf(profile: Profile, events: CalEvent[], goals: Goal[], measurements: Measurement[]): Progression {
  const doneList = events.filter((e) => e.type === "workout" && e.status === "done");
  const done = doneList.length;
  // Séance trop facile (lest ajouté de soi-même ou ressenti « facile ») : elle compte double ; ressenti « très dur » : moitié.
  // le rameur n'est pas du renforcement : il ne fait pas monter le niveau des exercices
  // séance partiellement faite : elle compte pour moitié, quel que soit le ressenti
  const credit = doneList.filter((e) => !e.payload.rower).reduce((n, e) => n + (e.payload.partial ? 0.5 : e.payload.easy || e.payload.feel === 5 ? 2 : e.payload.feel === 4 ? 1.5 : e.payload.feel === 1 ? 0.5 : 1), 0);
  // progrès vers les objectifs physiques (0 à 1) : un joueur qui progresse vite monte plus vite
  const physical = goals.filter((g) => !g.archived && PHYSICAL.has(g.kind)).map((g) => forecast(g, measurements, profile).progress);
  const gains = physical.length ? physical.reduce((a, b) => a + b, 0) / physical.length : 0;
  const points = (EXP[profile.experience ?? "lt1"] ?? 0) + (LVL[profile.level ?? "loisir"] ?? 0) + credit * PER_SESSION + gains;
  const stage = Math.min(3, 1 + Math.floor(points)) as Progression["stage"];
  const inStage = stage === 3 ? Math.min(0.999, (points - 2) / 1.5) : points - Math.floor(points);
  const step = Math.min(3, Math.floor(inStage * 4)) as Progression["step"];
  const age = profile.birth_date ? (Date.now() - Date.parse(profile.birth_date)) / 3.15576e10 : null;
  // Niveau max dépassé : le poids du corps ne suffit plus, on ajoute un lest (gilet lesté ou sac à dos).
  // 5 % du poids du corps, +2,5 % toutes les 5 séances ; plafond 10 % avant 16 ans, 15 % après.
  const beyond = points - MAX;
  const cap = age != null && age < 16 ? 0.1 : 0.15;
  const lestPct = beyond >= 0 ? Math.min(cap, 0.05 + 0.025 * Math.floor(beyond / (5 * PER_SESSION))) : 0;
  const lestKg = lestPct ? Math.max(1, Math.round(((profile.weight_kg ?? 60) * lestPct) * 2) / 2) : 0;
  const nextAt = beyond >= 0 ? (lestPct >= cap ? null : MAX + (Math.floor(beyond / (5 * PER_SESSION)) + 1) * 5 * PER_SESSION)
    : stage === 3 && step === 3 ? MAX : stage === 3 ? 2 + ((step + 1) / 4) * 1.5 : Math.floor(points) + (step + 1) / 4;
  return { stage, step, done, toNext: nextAt == null ? null : Math.max(1, Math.ceil((nextAt - points) / PER_SESSION - 1e-9)), age, lestKg, lestPct };
}

export const STAGE_LABEL = { 1: "Bases", 2: "Intermédiaire", 3: "Avancé" } as const;

/** Position globale de 1 à 12, pour l'afficher simplement (« palier 6 / 12 »). */
export const levelIndex = (p: Pick<Progression, "stage" | "step">) => (p.stage - 1) * 4 + p.step + 1;

// Objectifs du joueur : chaque objectif suit une mesure, se vérifie par un test mensuel,
// oriente les priorités du programme et reçoit une estimation du temps nécessaire.
import { addDays, today } from "./format";
import type { Goal, GoalKind, Measurement, Profile } from "./types";

export const RIM_CM = 305;
/** Hauteur de main au-dessus du cercle pour dunker (ballon de 24 cm en main). */
const DUNK_MARGIN: Record<string, number> = { une: 15, deux: 22 };
/** Un saut avec élan monte en moyenne ~12 % plus haut qu'un saut sur place (test mesuré). */
const APPROACH_GAIN = 1.12;

export const GOAL_KINDS: { id: GoalKind; label: string; hint: string; icon: "bolt" | "target" | "timer" | "flame" | "scale" | "ball" | "trophy" }[] = [
  { id: "dunk", label: "Dunker", hint: "Calculé avec ta taille et ton allonge", icon: "trophy" },
  { id: "shoot", label: "Pourcentage au tir", hint: "3 points, mi-distance ou lancers francs", icon: "target" },
  { id: "sprint", label: "Sprint", hint: "La distance et le temps que tu veux", icon: "timer" },
  { id: "cardio", label: "Avoir un bon cardio", hint: "Test navette (Luc Léger) chaque mois", icon: "flame" },
  { id: "physique", label: "Meilleur physique", hint: "Poids, masse grasse ou muscle", icon: "scale" },
  { id: "vertical", label: "Sauter plus haut", hint: "Une détente en cm", icon: "bolt" },
  { id: "dribble", label: "Être ambidextre", hint: "Dribble et finition aussi bons de la main faible", icon: "ball" },
];

export const SHOOT_ZONES = [
  { id: "3pts", label: "3 points", metric: "shoot_ext_pct", game: "cinq_spots" },
  { id: "mi", label: "Mi-distance", metric: "mid_pct", game: "cinq_spots_mi" },
  { id: "lf", label: "Lancers francs", metric: "ft_pct", game: "lancers_francs" },
] as const;

export const PHYSIQUE_METRICS = [
  { id: "weight", label: "Poids", unit: "kg", digits: 1 },
  { id: "fat_pct", label: "Masse grasse", unit: "%", digits: 1 },
  { id: "muscle_kg", label: "Masse musculaire", unit: "kg", digits: 1 },
] as const;

/** Niveaux de cardio proposés : vitesse maximale aérobie (VMA) visée au test navette. */
export const CARDIO_LEVELS = [
  { vma: 13, label: "Correct", hint: "palier 8 environ" },
  { vma: 14.5, label: "Bon cardio", hint: "palier 11 environ" },
  { vma: 16, label: "Très bon", hint: "palier 14 environ" },
];

export interface GoalMetric {
  kind: string; // type de mesure suivie
  label: string;
  unit: string;
  digits: number;
  better: "higher" | "lower";
  test: { id: string; label: string; to: string };
}

export function reachOf(p: Pick<Profile, "reach_cm" | "height_cm">): number {
  return p.reach_cm ?? Math.round((p.height_cm ?? 178) * 1.33);
}

/** Détente sur place (test) nécessaire pour dunker. */
export function dunkTarget(p: Pick<Profile, "reach_cm" | "height_cm">, hands: string): number {
  const needed = RIM_CM + (DUNK_MARGIN[hands] ?? 15) - reachOf(p);
  return Math.max(10, Math.ceil(needed / APPROACH_GAIN));
}

export function metricOf(g: Pick<Goal, "kind" | "params">): GoalMetric {
  switch (g.kind) {
    case "dunk":
    case "vertical":
      return { kind: "vertical", label: "Détente sur place", unit: "cm", digits: 0, better: "higher", test: { id: "vertical", label: "Test de détente", to: "/test/vertical" } };
    case "shoot": {
      const z = SHOOT_ZONES.find((x) => x.id === g.params.zone) ?? SHOOT_ZONES[0];
      return { kind: z.metric, label: `% ${z.label.toLowerCase()}`, unit: "%", digits: 0, better: "higher", test: { id: `shoot:${z.id}`, label: `Séance de tir ${z.label.toLowerCase()}`, to: `/shoot?jeu=${z.game}` } };
    }
    case "sprint": {
      const d = Number(g.params.distance) || 20;
      const camera = d === 10 || d === 20;
      return { kind: camera ? `sprint${d}` : `sprint_${d}`, label: `Sprint ${d} m`, unit: "s", digits: 2, better: "lower",
        test: { id: `sprint:${d}`, label: `Sprint ${d} m`, to: camera ? `/test/sprint${d}` : `/test/chrono?d=${d}` } };
    }
    case "cardio":
      return { kind: "vma", label: "VMA", unit: "km/h", digits: 1, better: "higher", test: { id: "navette", label: "Test navette Luc Léger", to: "/test/navette" } };
    case "physique": {
      const m = PHYSIQUE_METRICS.find((x) => x.id === g.params.metric) ?? PHYSIQUE_METRICS[0];
      const lose = g.params.direction === "baisser";
      return { kind: m.id, label: m.label, unit: m.unit, digits: m.digits, better: lose ? "lower" : "higher", test: { id: "pesee", label: "Pesée", to: "/mesures" } };
    }
    case "dribble":
      // ambidextrie : test de dribble main faible / main forte, enchaîné avec la finition des deux mains
      return { kind: "ambi_index", label: "Indice d'ambidextrie", unit: "%", digits: 0, better: "higher", test: { id: "ambi", label: "Test main faible (dribble + finition)", to: "/dribble/ambi?suite=finition" } };
  }
}

export function goalTitle(g: Pick<Goal, "kind" | "params" | "target">): string {
  switch (g.kind) {
    case "dunk": return g.params.hands === "deux" ? "Dunker à deux mains" : "Dunker à une main";
    case "vertical": return `${g.target} cm de détente`;
    case "shoot": {
      const z = SHOOT_ZONES.find((x) => x.id === g.params.zone) ?? SHOOT_ZONES[0];
      return `${g.target} % ${z.id === "lf" ? "aux lancers francs" : `à ${z.label.toLowerCase()}`}`;
    }
    case "sprint": return `${g.params.distance} m en ${String(g.target).replace(".", ",")} s`;
    case "cardio": return CARDIO_LEVELS.find((c) => c.vma === g.target)?.label ?? `VMA ${String(g.target).replace(".", ",")} km/h`;
    case "physique": {
      const m = PHYSIQUE_METRICS.find((x) => x.id === g.params.metric) ?? PHYSIQUE_METRICS[0];
      return `${m.label} : ${String(g.target).replace(".", ",")} ${m.unit}`;
    }
    case "dribble": return Number(g.target) >= 100 ? "Être ambidextre" : `Ambidextre à ${g.target} %`;
  }
}

/** Compétences du programme travaillées par l'objectif (priorités 60 / 25 / 15). */
export function skillsOf(g: Pick<Goal, "kind" | "params">): string[] {
  switch (g.kind) {
    case "dunk": case "vertical": return ["detente", "force"];
    case "shoot": return [g.params.zone === "mi" ? "mi_distance" : g.params.zone === "lf" ? "lancers" : "shoot_ext"];
    case "sprint": return ["vitesse"];
    case "cardio": return ["endurance"];
    case "physique": return g.params.metric === "fat_pct" || g.params.direction === "baisser" ? ["endurance", "force"] : ["muscle", "force"];
    case "dribble": return ["main_faible"];
  }
}

/**
 * Priorités du programme : les compétences des objectifs passent en tête (dans l'ordre où ils ont été fixés),
 * les priorités choisies avant restent travaillées en second plan.
 */
export function prioritiesFor(goals: Goal[], p: Pick<Profile, "priorities_high" | "priorities_low">) {
  // la compétence principale de chaque objectif d'abord, puis les secondaires (ex. la force pour le dunk)
  const lists = goals.map(skillsOf);
  const fromGoals = [...new Set([...lists.map((l) => l[0]), ...lists.flatMap((l) => l.slice(1))])];
  const high = fromGoals.slice(0, 3);
  const low = [...new Set([...fromGoals.slice(3), ...p.priorities_high, ...p.priorities_low])].filter((s) => !high.includes(s)).slice(0, 4);
  return high.length ? { priorities_high: high, priorities_low: low } : null;
}

/** Tests à passer à la session mensuelle : un par objectif (sans doublon). */
export function testsFor(goals: Goal[]) {
  const seen = new Map<string, GoalMetric["test"]>();
  for (const g of goals) { const t = metricOf(g).test; if (!seen.has(t.id)) seen.set(t.id, t); }
  return [...seen.values()];
}

// ——— Estimation du délai ———

// Progression mensuelle de départ, avant d'avoir assez de tests (ordres de grandeur prudents
// pour un jeune joueur qui suit le programme 3 à 4 fois par semaine).
// Rythme de départ (avant d'avoir 2 tests) : gain d'entraînement par mois, plus élevé quand on part de loin,
// auquel s'ajoute la croissance chez les ados (la détente, la masse musculaire et la VMA progressent seules à 12-17 ans).
// Repères : programmes de pliométrie chez les jeunes ≈ +5 à 8 cm en 8 à 12 semaines ; puberté ≈ +4 kg de muscle par an.
const TRAINING: Record<string, (v: number) => number> = {
  vertical: (v) => 2.2 * Math.min(1.5, Math.max(0.35, (85 - v) / 45)), // cm
  shoot_ext_pct: (v) => 3 * Math.max(0.4, (90 - v) / 60), mid_pct: (v) => 3 * Math.max(0.4, (95 - v) / 60), ft_pct: (v) => 3 * Math.max(0.4, (100 - v) / 50),
  vma: (v) => 0.35 * Math.min(1.4, Math.max(0.4, (20 - v) / 7)), // km/h
  weight: () => 1.2, fat_pct: () => 0.6, muscle_kg: () => 0.35,
  weak_dribble_rate: () => 0.15,
  ambi_index: (v) => 3 * Math.max(0.4, (100 - v) / 30), // points d'indice par mois, plus vite quand l'écart est grand
};
const GROWTH: Record<string, [number, number]> = { vertical: [0.35, 0.15], muscle_kg: [0.4, 0.2], vma: [0.04, 0.02] }; // par mois : 12-16 ans, 16-18 ans
// Niveau de jeu : un joueur déjà entraîné progresse un peu moins vite qu'un débutant, sans être pénalisé fortement.
const LEVEL_FACTOR: Record<string, number> = { loisir: 1.1, departemental: 1, regional: 0.95, national: 0.9 };

function priorRate(kind: string, v: number, age: number | null): number {
  if (kind.startsWith("sprint")) return v * (0.012 + (age != null && age < 18 ? 0.003 : 0)); // ~1,2 à 1,5 % du temps par mois
  const g = GROWTH[kind];
  const growth = !g || age == null || age < 11 || age >= 18 ? 0 : age < 16 ? g[0] : g[1];
  // les ados répondent mieux à l'entraînement que les adultes déjà formés
  const adult = age != null && age >= 18 ? 0.75 : 1;
  return (TRAINING[kind] ?? (() => 0))(v) * adult + growth;
}

export interface Forecast {
  current: number | null;
  baseline: number | null;
  target: number;
  progress: number; // 0–1, depuis la première mesure
  reached: boolean;
  months: number | null; // null : test de départ à passer
  date: string | null;
  basis: "estimation" | "progression"; // d'où vient le rythme
  stalled: boolean;
}

/** Une valeur par jour (la meilleure), triée. */
function series(ms: Measurement[], kind: string, better: "higher" | "lower") {
  const byDay = new Map<string, number>();
  for (const m of ms) {
    if (m.kind !== kind) continue;
    const d = m.measured_at.slice(0, 10), v = Number(m.value);
    const prev = byDay.get(d);
    if (prev == null || (better === "higher" ? v > prev : v < prev)) byDay.set(d, v);
  }
  return [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ d, v }));
}

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

export function forecast(g: Goal, ms: Measurement[], p: Pick<Profile, "level" | "reach_cm" | "height_cm" | "birth_date">): Forecast {
  const m = metricOf(g);
  const target = g.kind === "dunk" ? dunkTarget(p, String(g.params.hands)) : Number(g.target);
  const pts = series(ms, m.kind, m.better);
  const current = pts.length ? pts[pts.length - 1].v : null;
  const sign = m.better === "higher" ? 1 : -1;
  if (current == null) return { current, baseline: g.baseline, target, progress: 0, reached: false, months: null, date: null, basis: "estimation", stalled: false };

  const baseline = g.baseline ?? pts[0].v;
  const gap = (target - current) * sign;
  const total = (target - baseline) * sign;
  const progress = gap <= 0 ? 1 : total > 0 ? Math.max(0, Math.min(1, 1 - gap / total)) : 0;
  if (gap <= 0) return { current, baseline, target, progress: 1, reached: true, months: 0, date: today(), basis: "progression", stalled: false };

  // Rythme : estimation (niveau, âge, point de départ), puis corrigé par la vraie progression (pente des tests).
  const level = LEVEL_FACTOR[p.level ?? "departemental"] ?? 1;
  const age0 = p.birth_date ? (Date.now() - Date.parse(p.birth_date)) / 3.15576e10 : null;
  let observed = 0, w = 0, basis: Forecast["basis"] = "estimation", stalled = false;
  const span = pts.length >= 2 ? daysBetween(pts[0].d, pts[pts.length - 1].d) : 0;
  if (pts.length >= 2 && span >= 21) {
    const xs = pts.map((x) => daysBetween(pts[0].d, x.d) / 30.4), ys = pts.map((x) => x.v);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0));
    observed = slope * sign;
    if (observed > 0) { w = pts.length >= 3 ? 0.7 : 0.5; basis = "progression"; } else stalled = true;
  }
  // Simulation semaine par semaine : le rythme baisse en approchant de l'objectif (gains plus durs) et l'âge avance.
  let v = current, months = 0;
  while ((target - v) * sign > 0 && months < 48) {
    const age = age0 == null ? null : age0 + months / 12;
    const prior = priorRate(m.kind, v, age) * level * (stalled ? 0.5 : 1);
    v += sign * ((1 - w) * prior + w * observed) * 0.25;
    months += 0.25;
  }
  months = Math.max(0.5, months);
  return { current, baseline, target, progress, reached: false, months, date: addDays(today(), Math.round(months * 30.4)), basis, stalled };
}

export function monthsLabel(months: number): string {
  if (months < 1) return "moins d'un mois";
  if (months >= 48) return "plus de 4 ans";
  const r = Math.round(months);
  return r >= 24 ? `environ ${Math.round(months / 12)} ans` : `environ ${r} mois`;
}

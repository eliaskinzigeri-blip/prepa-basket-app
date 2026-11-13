import { addDays, mondayOf } from "./format";
import type { Measurement } from "./types";

export interface Indicator { kind: string; label: string; unit: string; digits: number; better: "higher" | "lower" }

export const INDICATORS: Record<string, Indicator> = {
  shoot_pct: { kind: "shoot_pct", label: "% au shoot", unit: "%", digits: 0, better: "higher" },
  shoot_ext_pct: { kind: "shoot_ext_pct", label: "% au shoot extérieur", unit: "%", digits: 0, better: "higher" },
  mid_pct: { kind: "mid_pct", label: "% à mi-distance", unit: "%", digits: 0, better: "higher" },
  ft_pct: { kind: "ft_pct", label: "% aux lancers francs", unit: "%", digits: 0, better: "higher" },
  finish_pct: { kind: "finish_pct", label: "% de finition", unit: "%", digits: 0, better: "higher" },
  weak_dribble_rate: { kind: "weak_dribble_rate", label: "Main faible", unit: "dr/s", digits: 1, better: "higher" },
  strong_dribble_rate: { kind: "strong_dribble_rate", label: "Main forte", unit: "dr/s", digits: 1, better: "higher" },
  weak_finish_pct: { kind: "weak_finish_pct", label: "% de finition main faible", unit: "%", digits: 0, better: "higher" },
  strong_finish_pct: { kind: "strong_finish_pct", label: "% de finition main forte", unit: "%", digits: 0, better: "higher" },
  ambi_index: { kind: "ambi_index", label: "Indice d'ambidextrie", unit: "%", digits: 0, better: "higher" },
  dribble_rate: { kind: "dribble_rate", label: "Dribbles par seconde", unit: "dr/s", digits: 1, better: "higher" },
  vertical: { kind: "vertical", label: "Détente verticale", unit: "cm", digits: 0, better: "higher" },
  broad: { kind: "broad", label: "Saut sans élan", unit: "cm", digits: 0, better: "higher" },
  sprint10: { kind: "sprint10", label: "Sprint 10 m", unit: "s", digits: 2, better: "lower" },
  sprint20: { kind: "sprint20", label: "Sprint 20 m", unit: "s", digits: 2, better: "lower" },
  agility: { kind: "agility", label: "Agilité", unit: "s", digits: 2, better: "lower" },
  weight: { kind: "weight", label: "Poids", unit: "kg", digits: 1, better: "higher" },
  fat_pct: { kind: "fat_pct", label: "Masse grasse", unit: "%", digits: 1, better: "lower" },
  muscle_kg: { kind: "muscle_kg", label: "Masse musculaire", unit: "kg", digits: 1, better: "higher" },
  bmr: { kind: "bmr", label: "Métabolisme de base", unit: "kcal/j", digits: 0, better: "higher" },
  rower_pace20: { kind: "rower_pace20", label: "Allure rameur (test 20 min)", unit: "s/500 m", digits: 0, better: "lower" },
  rhr: { kind: "rhr", label: "FC au repos", unit: "bpm", digits: 0, better: "lower" },
  hrv: { kind: "hrv", label: "Variabilité cardiaque (RMSSD)", unit: "ms", digits: 0, better: "higher" },
  sleep: { kind: "sleep", label: "Sommeil (moyenne par nuit)", unit: "h", digits: 1, better: "higher" },
  vma: { kind: "vma", label: "VMA (test navette)", unit: "km/h", digits: 1, better: "higher" },
  vo2max: { kind: "vo2max", label: "VO2max estimée", unit: "ml/kg/min", digits: 0, better: "higher" },
  volume: { kind: "volume", label: "Charges soulevées", unit: "kg", digits: 0, better: "higher" },
};

/** Indicateur suivi pour chaque compétence prioritaire. */
export const SKILL_INDICATOR: Record<string, string> = {
  shoot_ext: "shoot_ext_pct", mi_distance: "mid_pct", lancers: "ft_pct", finition: "finish_pct", main_faible: "ambi_index",
  detente: "vertical", vitesse: "sprint10", defense: "agility", force: "volume", endurance: "vma", muscle: "muscle_kg",
};

/** Moyennes hebdomadaires (lundi) d'une série de mesures. */
export function weekly(ms: { value: number; at: string }[], from: string, to: string) {
  const out: { week: string; value: number | null }[] = [];
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 7);
    const v = ms.filter((m) => m.at >= w && m.at < end).map((m) => Number(m.value));
    out.push({ week: w, value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null });
  }
  return out;
}

export function series(measurements: Measurement[], kind: string) {
  // Trié par horodatage complet : plusieurs pesées le même jour restent dans l ordre.
  return measurements.filter((m) => m.kind === kind).sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    .map((m) => ({ value: Number(m.value), at: m.measured_at.slice(0, 10) }));
}

/** Numéro de semaine ISO, pour les axes (S41, S42…). */
export function isoWeek(s: string): number {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

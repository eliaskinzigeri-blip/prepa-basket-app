// Sommeil, chronotype et forme du matin.
// - Journal : une nuit par jour (datée du réveil), heure du coucher, du lever, note de 1 à 5, réveil libre ou non.
// - Objectif : 9 h (8 à 10 h recommandées de 13 à 18 ans, American Academy of Sleep Medicine 2016).
// - Chronotype : méthode du Munich ChronoType Questionnaire (Roenneberg 2003, 2012) : milieu du sommeil les jours
//   libres (MSF), corrigé du sommeil rattrapé (MSFsc = MSF − (SDf − SDweek) / 2 si on dort plus les jours libres).
// - Forme du matin : méthode de l'entraînement guidé par la VFC (Plews 2012-2013, Vesterinen 2016, Javaloyes 2019) :
//   ln(RMSSD) de chaque matin (première mesure du jour) ; zone normale = moyenne des 30 jours précédents (hors dernière
//   semaine dès 14 jours de mesures) ± 0,5 écart-type
//   (le plus petit changement qui compte) ; la TENDANCE (moyenne glissante sur 7 jours) sous la zone normale signe une
//   fatigue qui s'installe ; une chute du jour sous moyenne − 1 écart-type (Kiviniemi 2007) signe une nuit ou un jour
//   difficile (début de maladie, stress). Une seule mesure un peu basse ne veut rien dire : la VFC varie de 5 à 10 %
//   d'un jour à l'autre.
import { addDays, iso } from "./format";

export interface SleepLog { date: string; bed_min: number; wake_min: number; quality: number | null; free_day: boolean }
export type Chronotype = "matin" | "intermediaire" | "soir";
export type Readiness = "vert" | "orange" | "rouge";

export const SLEEP_TARGET = 9 * 60;
export const FALL_ASLEEP = 15;

export const duration = (l: Pick<SleepLog, "bed_min" | "wake_min">) => l.wake_min - l.bed_min;
/** Milieu du sommeil, en minutes depuis minuit du jour du réveil. */
export const midpoint = (l: Pick<SleepLog, "bed_min" | "wake_min">) => l.bed_min + duration(l) / 2;

/** 22 h 30 → « 22 h 30 » ; minutes négatives = la veille. */
export function clockOf(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
/** Durée : 515 → « 8 h 35 ». */
export function hoursOf(min: number): string {
  const m = Math.round(Math.abs(min));
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Les 7 dernières nuits : durée moyenne, dette par rapport aux 9 h, écart de lever semaine / jours libres. */
export function weekStats(logs: SleepLog[], day: string) {
  const from = addDays(day, -6);
  const week = logs.filter((l) => l.date >= from && l.date <= day);
  const durs = week.map(duration);
  const school = week.filter((l) => !l.free_day), free = week.filter((l) => l.free_day);
  return {
    nights: week.length,
    avgMin: durs.length ? Math.round(mean(durs)) : null,
    debtMin: durs.reduce((n, d) => n + Math.max(0, SLEEP_TARGET - d), 0),
    // Lever des jours libres moins lever des jours de cours (« décalage horaire » du lundi au-delà de 2 h)
    wakeGapMin: school.length && free.length ? Math.round(mean(free.map((l) => l.wake_min)) - mean(school.map((l) => l.wake_min))) : null,
  };
}

/** Chronotype (MCTQ) sur les 60 derniers jours : il faut au moins 4 nuits de jours libres. */
export function chronotypeOf(logs: SleepLog[], day: string): { type: Chronotype; msfsc: number; freeNights: number } | { type: null; freeNights: number } {
  const recent = logs.filter((l) => l.date > addDays(day, -60) && l.date <= day);
  const free = recent.filter((l) => l.free_day), work = recent.filter((l) => !l.free_day);
  if (free.length < 4) return { type: null, freeNights: free.length };
  const sdf = mean(free.map(duration));
  const sdw = work.length ? mean(work.map(duration)) : sdf;
  const sdweek = (5 * sdw + 2 * sdf) / 7;
  const msf = mean(free.map(midpoint));
  const msfsc = Math.round(sdf > sdw ? msf - (sdf - sdweek) / 2 : msf);
  return { type: msfsc < 180 ? "matin" : msfsc <= 300 ? "intermediaire" : "soir", msfsc, freeNights: free.length };
}

export const CHRONO_LABEL: Record<Chronotype, string> = { matin: "Plutôt du matin", intermediaire: "Intermédiaire", soir: "Plutôt du soir" };

/** Heure de coucher conseillée (minutes, négatif = la veille) pour 9 h de sommeil avant le réveil des jours de cours. */
export const bedtimeFor = (wakeSchoolMin: number) => wakeSchoolMin - SLEEP_TARGET - FALL_ASLEEP;

// ---------- forme du matin ----------

export interface HrvPoint { value: number; measured_at: string }
const localDay = (ts: string) => iso(new Date(ts));

export interface HrvStatus {
  /** Valeur du matin (ms) et moyenne des 7 derniers jours (ms). */
  today: number; week: number;
  /** Zone normale (ms) : moyenne des 30 jours précédents ± 0,5 écart-type, sur ln(RMSSD). */
  low: number; high: number;
  /** Écart du jour, en écarts-types (ln). */
  z: number;
  /** Tendance 7 jours sous la zone normale (au moins 3 mesures dans la semaine). */
  trendLow: boolean;
  /** Chute du jour : sous moyenne − 1 écart-type. */
  drop: boolean;
  baselineDays: number;
}

/** Une valeur par jour : la première mesure, celle du réveil. */
function daily(points: HrvPoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of [...points].filter((x) => x.value > 0).sort((a, b) => a.measured_at.localeCompare(b.measured_at))) {
    const d = localDay(p.measured_at);
    if (!out.has(d)) out.set(d, Math.log(p.value));
  }
  return out;
}

/** VFC du jour face à ta zone normale ; null sans mesure ce jour-là ou tant qu'il n'y a pas 7 jours de référence. */
export function hrvStatus(points: HrvPoint[], day: string): HrvStatus | null {
  const days = daily(points);
  const t = days.get(day);
  if (t == null) return null;
  // Référence : les 30 jours précédents ; avec au moins 14 jours, sans la dernière semaine, pour qu'une fatigue qui
  // s'installe ne se cache pas dans sa propre référence
  const prior = [...days].filter(([d]) => d < day && d >= addDays(day, -30));
  const older = prior.filter(([d]) => d <= addDays(day, -7));
  const base = (older.length >= 14 ? older : prior).map(([, v]) => v);
  if (base.length < 7) return null;
  const m = mean(base);
  const sd = Math.max(0.03, Math.sqrt(base.reduce((n, x) => n + (x - m) ** 2, 0) / (base.length - 1)));
  const week = [...days].filter(([d]) => d <= day && d > addDays(day, -7)).map(([, v]) => v);
  const w = mean(week);
  const r = (x: number) => Math.round(Math.exp(x));
  return {
    today: r(t), week: r(w), low: r(m - 0.5 * sd), high: r(m + 0.5 * sd), z: Math.round(((t - m) / sd) * 100) / 100,
    trendLow: week.length >= 3 && w < m - 0.5 * sd, drop: t < m - sd, baselineDays: base.length,
  };
}

/** Nombre de jours de mesure avant que la zone normale soit connue (7 au minimum). */
export function hrvCalibration(points: HrvPoint[], day: string): number {
  return Math.max(0, 7 - [...daily(points).keys()].filter((d) => d < day && d >= addDays(day, -30)).length);
}

export interface ReadinessResult { level: Readiness | null; reasons: string[] }

/** Forme du jour : 🟢 séance normale, 🟠 séance allégée, 🔴 récupération à la place de la séance lourde. */
export function readinessFor(day: string, logs: SleepLog[], hrv: HrvPoint[]): ReadinessResult {
  const night = logs.find((l) => l.date === day);
  const h = hrvStatus(hrv, day);
  const hy = hrvStatus(hrv, addDays(day, -1));
  if (!night && !h) return { level: null, reasons: [] };
  const reasons: string[] = [];
  const dur = night ? duration(night) : null;
  const poorNight = !!night && ((dur ?? 0) < 8 * 60 || (night.quality ?? 3) <= 2);
  // Rouge
  if (dur != null && dur < 6 * 60 + 30) reasons.push(`nuit de ${hoursOf(dur)}, moins de 6 h 30`);
  if (h?.drop && h.trendLow) reasons.push("VFC en forte baisse ce matin, et en baisse depuis plusieurs jours");
  else if (h?.drop && hy?.drop) reasons.push("VFC en forte baisse deux matins de suite");
  else if (h?.drop && poorNight) reasons.push("VFC en forte baisse après une mauvaise nuit");
  if (reasons.length) return { level: "rouge", reasons };
  // Orange
  if (dur != null && dur < 8 * 60) reasons.push(`nuit de ${hoursOf(dur)}, moins de 8 h`);
  if (night && (night.quality ?? 3) <= 2) reasons.push(`nuit notée ${night.quality}/5`);
  if (h?.drop) reasons.push("VFC nettement plus basse que d'habitude ce matin");
  else if (h?.trendLow) reasons.push("VFC en baisse sur les 7 derniers jours");
  if (reasons.length) return { level: "orange", reasons };
  return { level: "vert", reasons: [dur != null ? `nuit de ${hoursOf(dur)}` : "", h ? "VFC dans ta zone normale" : ""].filter(Boolean) };
}

export function redStreak(day: string, logs: SleepLog[], hrv: HrvPoint[]): number {
  let n = 0;
  while (n < 14 && readinessFor(addDays(day, -n), logs, hrv).level === "rouge") n++;
  return n;
}

export const READINESS_LABEL: Record<Readiness, string> = { vert: "En forme", orange: "Un peu fatigué", rouge: "Pas récupéré" };

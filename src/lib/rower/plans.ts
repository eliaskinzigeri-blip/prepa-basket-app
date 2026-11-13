// Ce que le rameur apporte au basket : séances, zones et règles de sécurité. Sans Bluetooth : ce fichier reste léger.
// Les durées et la résistance 2-3 sont un choix de prudence, pas des chiffres d'étude.
import type { CalEvent, Profile } from "../types";

export type ZoneId = "ut2" | "ut1" | "seuil" | "intense";
export type RowerKind = "endurance" | "warmup" | "recup" | "test";

/** Zones du guide RameFit : `low` / `high` en % des watts de référence (allure 2 000 m). */
export const ZONES: Record<ZoneId, { name: string; short: string; effort: string; talk: string; low: number; high: number; hr: [number, number] }> = {
  ut2: { name: "Endurance", short: "Z2", effort: "4–5", talk: "Conversation possible", low: 0.55, high: 0.65, hr: [0.6, 0.7] },
  ut1: { name: "Soutenu", short: "Z3", effort: "6", talk: "Phrases courtes", low: 0.65, high: 0.75, hr: [0.7, 0.8] },
  seuil: { name: "Seuil", short: "Z4", effort: "7–8", talk: "Quelques mots seulement", low: 0.75, high: 0.88, hr: [0.8, 0.9] },
  intense: { name: "Intense", short: "Z5", effort: "9–10", talk: "Impossible de parler", low: 0.88, high: 1.02, hr: [0.9, 1] },
};

const paceAt = (ref: number, pct: number) => ref * Math.cbrt(1 / pct);
/** Allure de référence tant qu'aucun test n'a été fait (indicative). */
export const DEFAULT_REF = 155;
/** Un 20 min se tient à environ 92 % des watts d'un 2 000 m. */
export const refFrom20Min = (paceSec: number) => paceSec * Math.cbrt(0.92);
/** Fourchette d'allure : [rapide, lente] en s/500 m. */
export function zonePace(zone: ZoneId, ref: number): [number, number] {
  const z = ZONES[zone];
  return [Math.round(paceAt(ref, z.high)), Math.round(paceAt(ref, z.low))];
}
export const hrMax = (age: number) => Math.round(208 - 0.7 * age);
export const hrAt = (pct: number, age: number) => Math.round(pct * hrMax(age));

/** Âge inconnu : on applique les règles les plus prudentes. */
export const ageOf = (p: Pick<Profile, "birth_date"> | null | undefined) =>
  p?.birth_date ? Math.floor((Date.now() - Date.parse(p.birth_date)) / 3.15576e10) : 13;
export const isJunior = (age: number) => age < 16;
export const needsParentConsent = (age: number) => age < 15;

export const hasRower = (p: Pick<Profile, "home_equipment"> | null | undefined) => Boolean(p?.home_equipment?.includes("rameur"));

export interface RowInterval { label: string; work: boolean; seconds: number; zone: ZoneId | null; spm: [number, number]; resistance: number; isTest?: boolean }
export interface RowerPlan { kind: RowerKind; title: string; lead: string; intervals: RowInterval[]; seconds: number }

const CALM: [number, number] = [22, 24];
const easy = (label: string, seconds: number, resistance: number): RowInterval => ({ label, work: false, seconds, zone: null, spm: CALM, resistance });

export function rowerPlan(kind: RowerKind, sessionMinutes = 45): RowerPlan {
  let title: string, lead: string, intervals: RowInterval[];
  if (kind === "endurance") {
    // 20 à 30 min en tout : le basket et le club comptent déjà comme cardio dans la semaine.
    const main = sessionMinutes >= 45 ? 20 : 14;
    const warm = sessionMinutes >= 45 ? 5 : 4;
    const cool = sessionMinutes >= 45 ? 5 : 2;
    title = "Endurance au rameur";
    lead = "Facile : tu dois pouvoir parler en ramant. C'est ce qui construit ton cardio de match.";
    intervals = [easy("Échauffement", warm * 60, 3), { label: "Endurance", work: true, seconds: main * 60, zone: "ut2", spm: CALM, resistance: 4 }, easy("Retour au calme", cool * 60, 2)];
  } else if (kind === "warmup") {
    title = "Échauffement au rameur";
    lead = "Très facile, juste pour monter en température avant ta séance. Il ne doit pas te fatiguer.";
    intervals = [easy("Échauffement", 5 * 60, 3)];
  } else if (kind === "recup") {
    title = "Récupération au rameur";
    lead = "Facultatif et très facile : tu dois finir plus frais qu'au début.";
    intervals = [easy("Récupération", 12 * 60, 2)];
  } else {
    title = "Test de niveau 20 min";
    lead = "Il cale tes allures au rameur. Il ne remplace pas le test navette, qui reste la mesure de ton cardio.";
    intervals = [easy("Échauffement", 5 * 60, 3), { label: "Test", work: true, seconds: 20 * 60, zone: null, spm: [22, 30], resistance: 5, isTest: true }, easy("Retour au calme", 3 * 60, 2)];
  }
  return { kind, title, lead, intervals, seconds: intervals.reduce((n, i) => n + i.seconds, 0) };
}

/** Détente, vitesse, explosivité, appuis : le rameur dur dans la même séance fait baisser la force explosive. */
const EXPLOSIVE = new Set(["detente", "vitesse", "explosivite", "appuis"]);

/** Le rameur que peut proposer cette séance du calendrier (à la maison, si le rameur est coché). */
export function rowerOffer(e: Pick<CalEvent, "type" | "location" | "payload">, p: Pick<Profile, "home_equipment"> | null | undefined): { kind: RowerKind; note: string } | null {
  if (e.type !== "workout" || !hasRower(p) || (e.location ?? "maison") !== "maison" || e.payload.rower) return null;
  const t = e.payload.template ?? "";
  if (t === "recup") return { kind: "recup", note: "Facultatif · 12 min très faciles" };
  if (EXPLOSIVE.has(t)) return { kind: "warmup", note: "Facultatif · 5 min très faciles, rien de plus dur avant cette séance" };
  return { kind: "warmup", note: "Facultatif · 5 min très faciles, résistance 3" };
}

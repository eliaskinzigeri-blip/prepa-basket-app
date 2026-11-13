// Objectifs nutrition du jour pour un ado basketteur, d'après la recherche du 9/11/2026 (rapport « Objectifs nutritionnels
// ado basketteur »), revérifiés le même jour (« Objectifs nutritionnels risque de surestimation ») contre la dépense
// mesurée à l'eau doublement marquée chez des garçons de 13 ans de 51 kg (Stables 2023, Hannon 2020, Torun 2005) :
// - énergie : le niveau d'activité (PAL) est une moyenne de semaine, pas un coefficient par jour. On part donc d'une
//   journée sans sport (métabolisme × 1,45, NASEM 2023 « inactif » et Stables 2023) et on ajoute le coût net de CHAQUE
//   activité du calendrier, selon son type et sa durée (kcal par kg et par heure au-dessus de cette base, d'après le
//   Youth Compendium 2018) : la musculation dépense peu (beaucoup de repos entre les séries), la détente un peu plus,
//   le cardio (rameur, entraînement club) le plus par minute. Aucun choix à faire : tout vient du calendrier.
//   Pas de surplus voulu : la croissance construit le muscle si les besoins sont couverts ; le risque à cet âge est de
//   manger trop peu (REDs, consensus CIO 2023) ;
// - protéines (revu le 11/11/2026, rapport « Protéines ado sportif ») : 1,6 g/kg les jours sans sport, 1,8 g/kg les jours
//   d'entraînement ou de match. 1,4 g/kg est un plancher (bilan azoté Boisseau 2007, méthode qui sous-estime le besoin ;
//   bilan positif seulement vers 1,57 chez des garçons de 15 ans, Boisseau 2002) ; les jeunes athlètes visent 1,4 à 2,0
//   (Hannon 2020, ISSN 2017) ; au-delà de ~1,6 g/kg aucun gain musculaire n'est démontré (Morton 2018, adultes), et jusqu'à
//   2,0 aucun risque connu. En 4 à 5 prises de ~0,3 g/kg (15 à 20 g), dont une juste après l'entraînement, sans poudre ;
// - glucides selon la charge (Thomas, Erdman et Burke 2016) : le reste de l'énergie, au moins 4,5 / 6 / 7 g/kg, 8 au plus ;
// - lipides 30 % de l'énergie (repère 25 à 35 % chez les 4-18 ans).
import { supabase } from "./supabase";
import type { CalEvent, Slot } from "./types";

export type DayType = "repos" | "entrainement" | "match";
export type MealType = "petit-dej" | "dejeuner" | "gouter" | "diner" | "collation";

export const DAY_LABEL: Record<DayType, string> = { repos: "Repos", entrainement: "Entraînement", match: "Match" };
export const MEAL_LABEL: Record<MealType, string> = { "petit-dej": "Petit-déjeuner", dejeuner: "Déjeuner", gouter: "Goûter", diner: "Dîner", collation: "Après l'entraînement" };
export const MEAL_ORDER: MealType[] = ["petit-dej", "dejeuner", "gouter", "collation", "diner"];

// Journée sans sport : métabolisme × 1,45 (collège, trajets, vie quotidienne).
const REST_PAL = 1.45;
/** Coût net des activités, en kcal par kg et par heure au-dessus de la journée sans sport. */
export const NET_KCAL_PER_KG_H: Record<string, number> = {
  club: 6, // entraînement de basket en club
  endurance: 6.5, // cardio continu (rameur en zone 2) : autant qu'un entraînement club, minute par minute
  detente: 4.5, explosivite: 4.5, vitesse: 4.5, appuis: 4.5, // sauts et sprints, avec des pauses
  muscle: 3, haut: 3, force: 3, // musculation : beaucoup de repos entre les séries
  recup: 1.5,
  shoot: 3.5, dribble: 4.5, test: 3.5,
};
/** Un match : environ 7 kcal/kg en tout (4 × 10 min, temps de jeu partagé, échauffement compris). */
const MATCH_KCAL_PER_KG = 7;

export interface DayActivity { label: string; minutes: number; kcal: number }

const weekdayOf = (d: string) => (new Date(d + "T12:00:00").getDay() + 6) % 7; // lundi = 0

/** Activités physiques du jour, tirées du calendrier (séances, match) et des entraînements club. */
export function activitiesOf(events: CalEvent[], slots: Slot[], date: string, weightKg: number): DayActivity[] {
  const out: DayActivity[] = [];
  const kcal = (perKgH: number, minutes: number) => Math.round((perKgH * weightKg * minutes) / 60 / 5) * 5;
  for (const e of events) {
    if (e.date !== date || e.status === "skipped") continue;
    const minutes = e.start_min != null && e.end_min != null ? e.end_min - e.start_min : 60;
    if (e.type === "match") out.push({ label: e.title, minutes, kcal: Math.round((MATCH_KCAL_PER_KG * weightKg) / 5) * 5 });
    else if (e.type === "workout") {
      const k = e.payload.rower ? "endurance" : e.payload.template ?? "muscle";
      out.push({ label: e.title, minutes, kcal: kcal(NET_KCAL_PER_KG_H[k] ?? 3, minutes) });
    } else if (e.type === "basket") out.push({ label: e.title, minutes, kcal: kcal(NET_KCAL_PER_KG_H[e.payload.mode ?? "shoot"] ?? 3.5, minutes) });
    else if (e.type === "test") out.push({ label: e.title, minutes, kcal: kcal(NET_KCAL_PER_KG_H.test, minutes) });
    else if (e.type === "club") out.push({ label: e.title, minutes, kcal: kcal(NET_KCAL_PER_KG_H.club, minutes) });
  }
  // Entraînement club : d'après NoteFlow ce jour-là (créneau « Basket »), sinon la semaine type
  const nf = slots.filter((s) => s.on_date === date && s.label?.startsWith("NoteFlow"));
  const clubs = nf.length
    ? nf.filter((s) => /basket|entra[iî]nement|club/i.test(s.label ?? "") && !/trajet|retour/i.test(s.label ?? ""))
    : slots.filter((s) => s.kind === "club" && !s.on_date && s.weekday === weekdayOf(date));
  if (!out.some((a) => /club/i.test(a.label))) {
    for (const c of clubs) out.push({ label: "Entraînement club", minutes: c.end_min - c.start_min, kcal: kcal(NET_KCAL_PER_KG_H.club, c.end_min - c.start_min) });
  }
  return out;
}
// Glucides selon la charge (g/kg/j)
const CARBS_MIN: Record<DayType, number> = { repos: 4.5, entrainement: 6, match: 7 };
const CARBS_MAX = 8;
/** Protéines (g/kg/j) : plus les jours d'entraînement ou de match (prise après la séance). */
export const PROTEIN_G_PER_KG: Record<DayType, number> = { repos: 1.6, entrainement: 1.8, match: 1.8 };

export interface Targets { calories: number; protein_g: number; carbs_g: number; fat_g: number; carbsPerKg: number }

/** Base d'une journée sans sport (kcal). */
export const baseKcal = (bmr: number) => Math.round((bmr * REST_PAL) / 10) * 10;

/** Objectifs du jour : base + coût de chaque activité ; la charge (repos, entraînement, match) règle le minimum de glucides. */
export function targetsFor(day: DayType, weightKg: number, bmr: number, activities: DayActivity[] = []): Targets {
  const calories = Math.round((baseKcal(bmr) + activities.reduce((n, a) => n + a.kcal, 0)) / 10) * 10;
  const protein_g = Math.round(weightKg * PROTEIN_G_PER_KG[day]);
  let fat_g = Math.round((calories * 0.3) / 9); // environ 30 % de l'énergie
  const rest = (calories - protein_g * 4 - fat_g * 9) / 4;
  const carbs_g = Math.round(Math.min(weightKg * CARBS_MAX, Math.max(rest, weightKg * CARBS_MIN[day])));
  // Glucides au plafond : le reste de l'énergie va aux lipides (32 % au plus pour ce profil, repère 25 à 35 %)
  if (carbs_g < rest) fat_g = Math.round((calories - protein_g * 4 - carbs_g * 4) / 9);
  return { calories, protein_g, carbs_g, fat_g, carbsPerKg: Math.round((carbs_g / weightKg) * 10) / 10 };
}

/** Type de journée d'après le calendrier : un match l'emporte, puis toute séance prévue ou faite. */
export function dayTypeOf(events: CalEvent[], date: string, activities: DayActivity[] = []): DayType {
  const today = events.filter((e) => e.date === date && e.status !== "skipped");
  if (today.some((e) => e.type === "match")) return "match";
  if (activities.length) return "entrainement";
  if (today.some((e) => e.type === "workout" || e.type === "basket" || e.type === "club" || e.type === "test")) return "entrainement";
  return "repos";
}

/** Repas le plus probable à cette heure. */
export function mealAt(d = new Date()): MealType {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return "petit-dej";
  if (h < 14.5) return "dejeuner";
  if (h < 18) return "gouter";
  return "diner";
}

export interface Per100 { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export interface Food {
  name: string; quantity?: number; unit?: string; calories: number; protein_g: number; carbs_g: number; fat_g: number;
  /** Valeurs pour 100 g (CIQUAL), pour recalculer exactement quand on corrige les grammes. */
  per100?: Per100;
  /** Ingrédient invisible mais probable (huile de cuisson, sauce…). */
  hidden?: boolean;
}
export interface MealRow {
  id: string; eaten_at: string; meal_type: MealType; name: string; foods: Food[];
  calories: number; protein_g: number; carbs_g: number; fat_g: number; source: "scan" | "cantine" | "suggestion" | "manuel";
}
export interface Analysis { dish: string; confidence?: string; portion_estimate?: string; foods: Food[]; calories: number; protein_g: number; carbs_g: number; fat_g: number; notes?: string }
export interface Suggestion {
  dish: string; emoji?: string; ingredients: string[]; have?: string[]; missing?: string[]; portion_estimate?: string;
  calories: number; protein_g: number; carbs_g: number; fat_g: number; prep_min?: number; why?: string; recipe?: string;
}
export interface MenuDay { date: string; entree?: string[]; plat?: string[]; accompagnement?: string[]; laitage?: string[]; dessert?: string[] }

/** Change la quantité d'un aliment : calories et macros recalculées depuis les valeurs pour 100 g, sinon à la proportion. */
export function rescale(f: Food, quantity: number): Food {
  const r = (x: number) => Math.round(x * 10) / 10;
  if (f.per100) {
    const k = quantity / 100;
    return { ...f, quantity, calories: Math.round(f.per100.kcal * k), protein_g: r(f.per100.protein_g * k), carbs_g: r(f.per100.carbs_g * k), fat_g: r(f.per100.fat_g * k) };
  }
  const k = f.quantity && f.quantity > 0 ? quantity / f.quantity : 1;
  return { ...f, quantity, calories: Math.round(f.calories * k), protein_g: r(f.protein_g * k), carbs_g: r(f.carbs_g * k), fat_g: r(f.fat_g * k) };
}

export function sumMeals(meals: Pick<MealRow, "calories" | "protein_g" | "carbs_g" | "fat_g">[]) {
  const s = (k: "calories" | "protein_g" | "carbs_g" | "fat_g") => meals.reduce((t, m) => t + Number(m[k] || 0), 0);
  return { calories: Math.round(s("calories")), protein_g: Math.round(s("protein_g")), carbs_g: Math.round(s("carbs_g")), fat_g: Math.round(s("fat_g")) };
}

export const menuItems = (d: MenuDay | undefined) => (d ? [...(d.entree ?? []), ...(d.plat ?? []), ...(d.accompagnement ?? []), ...(d.laitage ?? []), ...(d.dessert ?? [])] : []);

export class NutritionError extends Error {
  constructor(message: string, public noAiKey = false, public needLink = false) { super(message); }
}

export async function nutrition<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("nutrition", { body });
  if (error) {
    let payload: any = null;
    try { payload = await (error as any).context.json(); } catch { /* pas de corps */ }
    throw new NutritionError(payload?.error ?? "Le service nutrition ne répond pas. Réessaie dans un instant.", !!payload?.noAiKey, !!payload?.needLink);
  }
  if (data?.error && !data?.days) throw new NutritionError(data.error, !!data.noAiKey, !!data.needLink);
  return data as T;
}

/** Photo choisie → JPEG compressé (côté max 1024 px) pour l'IA. */
export async function fileToDataUrl(file: File, maxSide = 1024, quality = 0.82): Promise<string> {
  const raw = await new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(new Error("read")); r.readAsDataURL(file); });
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("decode")); i.src = raw; });
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const ctx = c.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } catch {
    return raw; // HEIC illisible par le navigateur : on envoie l'original
  }
}

/** Début et fin (ISO) d'un jour local. */
export function dayRange(date: string) {
  const start = new Date(date + "T00:00:00");
  const end = new Date(start.getTime() + 864e5);
  return { from: start.toISOString(), to: end.toISOString() };
}

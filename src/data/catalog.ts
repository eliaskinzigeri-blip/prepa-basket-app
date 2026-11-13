import type { Experience, Level, Position } from "../lib/types";

export const POSITIONS: { id: Position; label: string }[] = [
  { id: "meneur", label: "Meneur" },
  { id: "arriere", label: "Arrière" },
  { id: "ailier", label: "Ailier" },
  { id: "ailier_fort", label: "Ailier fort" },
  { id: "pivot", label: "Pivot" },
];
export const EXPERIENCES: { id: Experience; label: string }[] = [
  { id: "lt1", label: "Moins d'1 an" },
  { id: "1-3", label: "1 à 3 ans" },
  { id: "3-5", label: "3 à 5 ans" },
  { id: "gt5", label: "Plus de 5 ans" },
];
export const LEVELS: { id: Level; label: string }[] = [
  { id: "loisir", label: "Loisir" },
  { id: "departemental", label: "Départemental" },
  { id: "regional", label: "Régional" },
  { id: "national", label: "National" },
];

export type Domain = "shoot" | "dribble" | "physique";
export const SKILLS: { id: string; label: string; short: string; domain: Domain; template?: string; games?: string[] }[] = [
  { id: "shoot_ext", label: "Shoot extérieur", short: "Shoot ext.", domain: "shoot", games: ["cinq_spots", "tour_du_monde"] },
  { id: "mi_distance", label: "Tir à mi-distance", short: "Mi-distance", domain: "shoot", games: ["cinq_spots_mi", "tir_libre"] },
  { id: "lancers", label: "Lancers francs", short: "Lancers", domain: "shoot", games: ["lancers_francs", "tir_libre"] },
  { id: "main_faible", label: "Ambidextrie (main faible)", short: "Ambidextre", domain: "dribble", games: ["main_faible", "crossover", "reflexes"] },
  { id: "vitesse", label: "Vitesse", short: "Vitesse", domain: "physique", template: "vitesse" },
  { id: "detente", label: "Détente", short: "Détente", domain: "physique", template: "detente" },
  { id: "muscle", label: "Prise de muscle", short: "Muscle", domain: "physique", template: "muscle" },
  { id: "endurance", label: "Endurance", short: "Endurance", domain: "physique", template: "endurance" },
  { id: "force", label: "Force", short: "Force", domain: "physique", template: "force" },
  { id: "defense", label: "Défense", short: "Défense", domain: "physique", template: "appuis" },
  { id: "finition", label: "Finition au cercle", short: "Finition", domain: "shoot", games: ["finition", "tir_libre"] },
];
export const skill = (id: string) => SKILLS.find((s) => s.id === id);

export const WORKOUT_PLACES = [
  { id: "basicfit", label: "Basic-Fit" },
  { id: "salle", label: "Autre salle de sport" },
  { id: "maison", label: "Maison" },
];
export const HOME_EQUIPMENT = [
  { id: "halteres", label: "Haltères" },
  { id: "kettlebell", label: "Kettlebell" },
  { id: "kettlebell_x2", label: "2 kettlebells" },
  { id: "elastiques", label: "Élastiques" },
  { id: "barre_traction", label: "Barre de traction" },
  { id: "banc", label: "Banc" },
  { id: "rameur", label: "Rameur Domyos" },
  { id: "corde", label: "Corde à sauter" },
  { id: "plots", label: "Plots" },
  { id: "box", label: "Box de saut" },
  { id: "medecine_ball", label: "Médecine-ball" },
  { id: "swiss_ball", label: "Swiss ball" },
  { id: "rouleau", label: "Rouleau de massage" },
];
// Matériel standard d'un club Basic-Fit (US17) : machines et poids libres.
export const GYM_EQUIPMENT = ["machines", "barre", "halteres", "kettlebell", "kettlebell_x2", "elastiques", "barre_traction", "banc", "box", "corde", "medecine_ball", "swiss_ball", "rouleau"];

// Familles d'exercices, pour la bibliothèque.
export const FAMILIES = [
  { id: "pliometrie", label: "Pliométrie" },
  { id: "explosivite", label: "Explosivité" },
  { id: "force", label: "Renfo bas du corps" },
  { id: "haut", label: "Renfo haut du corps" },
  { id: "gainage", label: "Gainage" },
  { id: "appuis", label: "Appuis & vitesse" },
  { id: "endurance", label: "Cardio & endurance" },
  { id: "prevention", label: "Prévention" },
  { id: "mobilite", label: "Mobilité & étirements" },
];

// Séances workout : un schéma de mouvement par ligne ; l'exercice exact dépend du matériel du lieu et du niveau.
// style : façon de doser (power = peu de reps, explosives ; hyper = 8-12 reps pour le muscle ; force ; endu = circuit).
export type DoseStyle = "power" | "hyper" | "force" | "endu" | "light";
export const TEMPLATES: Record<string, { title: string; patterns: string[]; heavyLegs: boolean; style?: DoseStyle }> = {
  // objectifs : dunk / détente, prise de muscle, vitesse
  detente: { title: "Détente · dunk", patterns: ["saut", "puissance", "saut", "squat", "hanche", "mollet", "ischios", "gainage"], heavyLegs: true, style: "power" },
  muscle: { title: "Prise de muscle", patterns: ["squat", "poussee", "tirage", "fente", "epaules", "hanche", "tirage", "gainage"], heavyLegs: true, style: "hyper" },
  vitesse: { title: "Vitesse · accélérations", patterns: ["puissance", "lateral", "saut", "ischios", "hanche", "mollet", "gainage", "mobilite"], heavyLegs: true, style: "power" },
  explosivite: { title: "Workout explosivité", patterns: ["saut", "puissance", "lateral", "hanche", "squat", "mollet", "gainage", "mobilite"], heavyLegs: true, style: "power" },
  force: { title: "Force & prévention", patterns: ["squat", "fente", "hanche", "ischios", "mollet", "gainage", "tirage", "mobilite"], heavyLegs: true, style: "force" },
  appuis: { title: "Appuis & défense", patterns: ["lateral", "cheville", "fente", "lateral", "mollet", "lateral_core", "gainage", "mobilite"], heavyLegs: true, style: "power" },
  endurance: { title: "Endurance basket", patterns: ["cardio", "cheville", "fente", "cardio", "gainage", "lateral_core", "mollet", "mobilite"], heavyLegs: true, style: "endu" },
  haut: { title: "Haut du corps · gainage", patterns: ["poussee", "tirage", "epaules", "gainage", "lateral_core", "antirotation", "mobilite", "tirage"], heavyLegs: false, style: "hyper" },
  recup: { title: "Récupération légère", patterns: ["mobilite", "ischios", "gainage", "lateral_core", "mollet"], heavyLegs: false, style: "light" },
};

export interface Game {
  id: string;
  mode: "dribble" | "shoot";
  name: string;
  minutes: number;
  desc: string;
}
export const GAMES: Game[] = [
  { id: "ambi", mode: "dribble", name: "Test main faible", minutes: 2, desc: "Dribble sur place : 20 s main faible, puis 20 s main forte. L'app compare tes deux mains." },
  { id: "reflexes", mode: "dribble", name: "Réflexes", minutes: 3, desc: "Des cibles apparaissent au hasard : touche-les avec le ballon le plus vite possible." },
  { id: "main_faible", mode: "dribble", name: "Main faible", minutes: 3, desc: "Seules les touches avec ta main faible comptent." },
  { id: "crossover", mode: "dribble", name: "Crossover chrono", minutes: 2, desc: "Alterne gauche et droite : 20 crossovers le plus vite possible." },
  { id: "sequence", mode: "dribble", name: "Séquence", minutes: 3, desc: "Mémorise l'ordre des cibles, puis reproduis-le au dribble." },
  { id: "cinq_spots", mode: "shoot", name: "5 spots × 10 tirs", minutes: 15, desc: "10 tirs à 3 points depuis chaque spot : coins, ailes, axe." },
  { id: "cinq_spots_mi", mode: "shoot", name: "5 spots mi-distance", minutes: 15, desc: "10 tirs à mi-distance depuis 5 positions." },
  { id: "tour_du_monde", mode: "shoot", name: "Tour du monde", minutes: 10, desc: "Avance d'un spot à chaque tir réussi, du coin gauche au coin droit." },
  { id: "lancers_francs", mode: "shoot", name: "Lancers francs", minutes: 10, desc: "Séries de 10 lancers : vise le plus long enchaînement réussi." },
  { id: "finition", mode: "shoot", name: "Finition au cercle", minutes: 10, desc: "10 finitions main faible (double-pas côté main faible, Mikan), puis 10 main forte : l'app compare les deux mains." },
  { id: "tir_libre", mode: "shoot", name: "Shoot libre", minutes: 10, desc: "Tire d'où tu veux : chaque tir est compté et analysé." },
];
export const game = (id: string) => GAMES.find((g) => g.id === id);

export interface TestDef {
  id: string;
  name: string;
  unit: string;
  better: "higher" | "lower";
  digits: number;
  kind: "pose-jump" | "pose-broad" | "lines";
  setup: string[];
}
export const TESTS: TestDef[] = [
  { id: "vertical", name: "Détente verticale", unit: "cm", better: "higher", digits: 0, kind: "pose-jump",
    setup: ["Pose le téléphone au sol contre un mur, à 3 m de toi, en mode portrait.", "Tout ton corps doit être visible, de la tête aux pieds.", "Saute bras libres, réception sur place."] },
  { id: "broad", name: "Saut en longueur sans élan", unit: "cm", better: "higher", digits: 0, kind: "pose-broad",
    setup: ["Filme de côté, à 4 m, en mode paysage.", "Pieds derrière une ligne, tout le saut doit rester dans le cadre.", "Reste immobile 2 s à la réception."] },
  { id: "sprint10", name: "Sprint 10 m", unit: "s", better: "lower", digits: 2, kind: "lines",
    setup: ["Place deux plots à 10 m l'un de l'autre.", "Pose le téléphone de côté, à 7 m du milieu, en paysage : les deux plots doivent être visibles.", "Aligne les deux lignes à l'écran sur les plots."] },
  { id: "sprint20", name: "Sprint 20 m", unit: "s", better: "lower", digits: 2, kind: "lines",
    setup: ["Place deux plots à 20 m l'un de l'autre.", "Pose le téléphone de côté, à 12 m du milieu, en paysage (grand-angle si possible).", "Aligne les deux lignes à l'écran sur les plots."] },
  { id: "agility", name: "Agilité (lane agility)", unit: "s", better: "lower", digits: 2, kind: "lines",
    setup: ["Parcours autour de la raquette : sprint, pas chassés, course arrière, pas chassés.", "Le téléphone filme la ligne de départ, qui est aussi la ligne d'arrivée.", "Aligne la ligne gauche à l'écran sur le départ."] },
];
export const test = (id: string) => TESTS.find((t) => t.id === id);

// Vacances scolaires 2026-2027 (data.education.gouv.fr) : [premier jour, jour de reprise[.
export const HOLIDAYS: Record<"A" | "B" | "C", [string, string][]> = {
  A: [["2026-10-17", "2026-11-02"], ["2026-12-19", "2027-01-04"], ["2027-02-13", "2027-03-01"], ["2027-04-10", "2027-04-26"], ["2027-05-07", "2027-05-08"], ["2027-07-03", "2027-09-01"]],
  B: [["2026-10-17", "2026-11-02"], ["2026-12-19", "2027-01-04"], ["2027-02-20", "2027-03-08"], ["2027-04-17", "2027-05-03"], ["2027-05-07", "2027-05-08"], ["2027-07-03", "2027-09-01"]],
  C: [["2026-10-17", "2026-11-02"], ["2026-12-19", "2027-01-04"], ["2027-02-06", "2027-02-22"], ["2027-04-03", "2027-04-19"], ["2027-05-07", "2027-05-08"], ["2027-07-03", "2027-09-01"]],
};
export function isHoliday(zone: "A" | "B" | "C" | null, date: string): boolean {
  if (!zone) return false;
  return HOLIDAYS[zone].some(([a, b]) => date >= a && date < b);
}

export const CATEGORY_LABEL: Record<string, string> = {
  workout: "Workout", basket: "Basket", club: "Entraînement club", match: "Match", rest: "Repos", test: "Tests", class: "Cours",
};

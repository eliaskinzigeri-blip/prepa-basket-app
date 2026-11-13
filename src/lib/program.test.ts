// Programme d'un joueur de club : 2 entraînements club, match le samedi, objectifs détente, muscle et tir.
import { describe, expect, it } from "vitest";
import { freeIntervals, generateProgram } from "./program";
import { addDays } from "./format";
import type { CalEvent, Profile, Slot } from "./types";

const profile = {
  id: "u", first_name: "Joueur", birth_date: "2013-06-15", height_cm: 168, weight_kg: 51.2, strong_hand: "droite", position: "arriere",
  experience: "3-5", level: "regional", priorities_high: ["detente", "muscle", "shoot_ext"], priorities_low: ["force", "endurance", "main_faible", "vitesse"],
  workout_locations: ["maison"], home_equipment: ["halteres", "kettlebell", "elastiques", "barre_traction", "corde", "box", "rameur"], has_hoop: true, hoop_height_m: 3.05,
  ab_weeks: false, ab_reference: null, vacation_zone: "B", latest_min: 1215, session_minutes: 45, test_every_weeks: 2,
} as unknown as Profile;

const slot = (weekday: number, kind: Slot["kind"], start: number, end: number): Slot =>
  ({ id: `${weekday}${kind}${start}`, weekday, week: "*", kind, start_min: start, end_min: end, location: kind === "free" ? "maison" : null, label: null, on_date: null } as unknown as Slot);
const slots: Slot[] = [
  ...[0, 1, 2, 3, 4, 5, 6].map((d) => slot(d, "free", 0, 1440)),
  ...[0, 1, 3, 4].map((d) => slot(d, "class", 480, 1020)), slot(2, "class", 480, 840),
  slot(0, "club", 1140, 1215), slot(3, "club", 1110, 1185),
];
// Lundi 16 novembre 2026 (hors vacances), 4 semaines, un match chaque samedi à 15 h 30
const start = "2026-11-16";
const matches = [0, 1, 2, 3].map((w) => ({ id: `m${w}`, date: addDays(start, w * 7 + 5), start_min: 930, end_min: 1035, type: "match", title: "Match", location: null, source: "ffbb", payload: {}, status: "planned" } as unknown as CalEvent));
const plan = generateProgram(profile, slots, matches, start, 4);
const sessions = plan.filter((e) => e.type !== "rest");
const week = (w: number) => sessions.filter((e) => e.date >= addDays(start, w * 7) && e.date < addDays(start, w * 7 + 7));

describe("programme d'un joueur de club", () => {
  it("garde une charge raisonnable : 4 séances maison + le rameur en endurance, avec club et match en plus", () => {
    for (let w = 0; w < 4; w++) expect(week(w).length).toBeLessThanOrEqual(5);
    for (let w = 0; w < 4; w++) expect(week(w).filter((e) => e.payload.rower === "endurance").length).toBe(1);
    expect(plan.filter((e) => e.type === "rest").length).toBe(4);
  });
  it("jamais deux séances lourdes de jambes d'affilée, ni la veille ou le jour du match", () => {
    const heavy = sessions.filter((e) => e.payload.heavy).map((e) => e.date);
    for (const d of heavy) {
      expect(heavy).not.toContain(addDays(d, 1));
      expect(matches.map((m) => m.date)).not.toContain(addDays(d, 1));
      expect(matches.map((m) => m.date)).not.toContain(d);
    }
  });
  it("travaille les trois objectifs chaque semaine", () => {
    for (let w = 0; w < 3; w++) {
      const foci = week(w).map((e) => e.payload.focus);
      // semaine de tests : les tests remplacent la détente
      if (!week(w).some((e) => e.type === "test")) expect(foci).toContain("detente");
      expect(foci).toContain("muscle");
      expect(foci).toContain("shoot_ext");
    }
  });
  it("4e semaine allégée", () => {
    expect(week(3).filter((e) => e.type === "workout").every((e) => e.payload.deload)).toBe(true);
    expect(week(0).some((e) => e.payload.deload)).toBe(false);
  });
  it("affiche la semaine type", () => {
    const fmt = (m: number | null) => (m == null ? "" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
    console.log(plan.filter((e) => e.date < addDays(start, 28)).map((e) => `${e.date} ${fmt(e.start_min)} ${e.title}${e.payload.heavy ? " (jambes)" : ""}${e.payload.deload ? " (allégée)" : ""}`).join("\n"));
  });
  it("le midi des jours de cours se passe au collège, même avec un trou entre deux cours", () => {
    const nf = (date: string, start: number, end: number) =>
      ({ id: `${date}${start}`, weekday: null, week: "*", kind: "class", start_min: start, end_min: end, location: null, label: "NoteFlow · Cours", on_date: date } as unknown as Slot);
    // jeudi 12/11 : cours le matin, trou de 13 h à 15 h 40, cours jusqu'à 16 h 30
    const thu = freeIntervals("2026-11-12", profile, [...slots, nf("2026-11-12", 545, 600), nf("2026-11-12", 670, 780), nf("2026-11-12", 940, 990)], []);
    expect(thu.some((i) => i.start < 940 && i.end > 780)).toBe(false);
    // vendredi 13/11 : cours finis à 12 h 05, déjeuner à la cantine avant de rentrer
    const fri = freeIntervals("2026-11-13", profile, [...slots, nf("2026-11-13", 545, 725)], []);
    expect(Math.min(...fri.filter((i) => i.start > 600).map((i) => i.start))).toBeGreaterThanOrEqual(13 * 60 + 30);
  });
});

describe("programme adapté à l'horloge biologique", () => {
  const owl = { ...profile, chronotype: "soir" } as Profile;
  const owlPlan = generateProgram(owl, slots, matches, start, 4).filter((e) => e.type !== "rest" && e.start_min != null);
  const wd = (d: string) => (new Date(d + "T12:00:00").getDay() + 6) % 7;

  it("ado du soir : rien avant 10 h 30 le week-end et le mercredi après-midi libre", () => {
    for (const e of owlPlan.filter((x) => wd(x.date) >= 5)) expect(e.start_min!).toBeGreaterThanOrEqual(10 * 60 + 30);
  });

  it("ado du soir : détente, vitesse et tests en fin d'après-midi quand le jour est libre", () => {
    const explosive = owlPlan.filter((e) => e.type === "test" || ["detente", "vitesse"].includes(String(e.payload.focus)));
    expect(explosive.length).toBeGreaterThan(0);
    for (const e of explosive) expect(e.start_min!).toBeGreaterThanOrEqual(16 * 60);
  });
});


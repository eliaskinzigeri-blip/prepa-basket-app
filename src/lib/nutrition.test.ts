// @vitest-environment jsdom
// Objectifs nutrition du jour d'un ado basketteur.
import { describe, expect, it } from "vitest";
import { activitiesOf, dayTypeOf, menuItems, sumMeals, targetsFor } from "./nutrition";
import type { CalEvent, Slot } from "./types";

const ev = (type: CalEvent["type"], status: CalEvent["status"] = "planned"): CalEvent =>
  ({ id: type, date: "2026-11-09", start_min: null, end_min: null, type, title: type, location: null, source: "program", payload: {} as CalEvent["payload"], status });

describe("objectifs nutrition", () => {
  it("51,2 kg, métabolisme 1 660 kcal : base sans sport + coût de chaque activité, protéines 1,6 g/kg sans sport, 1,8 g/kg avec", () => {
    const W = 51.2, B = 1660;
    const s = (date: string, start: number, end: number, type: CalEvent["type"], payload: Partial<CalEvent["payload"]> = {}): CalEvent =>
      ({ id: `${date}${start}`, date, start_min: start, end_min: end, type, title: type, location: null, source: "program", payload: payload as CalEvent["payload"], status: "planned" });
    const club = (weekday: number): Slot => ({ kind: "club", week: "*", weekday, on_date: null, start_min: 1110, end_min: 1185, location: null, label: "Entraînement club" });
    const day = (events: CalEvent[], date: string, slots: Slot[] = []) => {
      const acts = activitiesOf(events, slots, date, W);
      return { acts, t: targetsFor(dayTypeOf(events, date, acts), W, B, acts) };
    };
    // Dimanche sans sport : la base seule
    const repos = day([], "2026-11-15");
    expect(repos.t.calories).toBe(2410);
    // Mardi : 1 h de musculation du haut du corps, peu de dépense (repos entre les séries)
    const muscu = day([s("2026-11-10", 990, 1050, "workout", { template: "haut" })], "2026-11-10");
    // Mercredi : 1 h de détente (sauts) : plus que la musculation
    const detente = day([s("2026-11-11", 540, 600, "workout", { template: "detente" })], "2026-11-11");
    // Jeudi : 30 min de rameur en endurance + 75 min de club (semaine type)
    const cardio = day([s("2026-11-19", 1035, 1065, "workout", { template: "endurance", rower: "endurance" })], "2026-11-19", [club(3)]);
    const rameur = cardio.acts.find((a) => /rameur|workout/.test(a.label))!;
    const clubAct = cardio.acts.find((a) => a.label === "Entraînement club")!;
    // Samedi : match
    const match = day([s("2026-11-14", 930, 1035, "match")], "2026-11-14");
    expect(muscu.acts[0].kcal).toBeLessThan(detente.acts[0].kcal);
    // minute par minute, le rameur en endurance dépense au moins autant que le club, et plus que la détente
    expect(rameur.kcal / rameur.minutes).toBeGreaterThanOrEqual(clubAct.kcal / clubAct.minutes);
    expect(rameur.kcal / rameur.minutes).toBeGreaterThan(detente.acts[0].kcal / detente.acts[0].minutes);
    expect(muscu.t.calories).toBe(2570);
    expect(detente.t.calories).toBe(2640);
    expect(cardio.t.calories).toBe(2960);
    expect(match.t.calories).toBe(2770);
    for (const t of [repos.t, muscu.t, detente.t, cardio.t, match.t]) {
      expect(t.protein_g).toBe(t === repos.t ? 82 : 92);
      expect(t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9).toBeGreaterThanOrEqual(t.calories - 10);
      expect(t.carbsPerKg).toBeGreaterThanOrEqual(4.5);
      expect(t.carbsPerKg).toBeLessThanOrEqual(8);
    }
  });
  it("type de journée d'après le calendrier", () => {
    expect(dayTypeOf([], "2026-11-09")).toBe("repos");
    expect(dayTypeOf([ev("workout")], "2026-11-09")).toBe("entrainement");
    expect(dayTypeOf([ev("workout"), ev("match")], "2026-11-09")).toBe("match");
    expect(dayTypeOf([ev("workout", "skipped")], "2026-11-09")).toBe("repos");
  });
  it("additionne les repas et met le menu à plat", () => {
    expect(sumMeals([{ calories: 600, protein_g: 30.4, carbs_g: 70, fat_g: 20 }, { calories: 400, protein_g: 20, carbs_g: 50, fat_g: 10 }])).toEqual({ calories: 1000, protein_g: 50, carbs_g: 120, fat_g: 30 });
    expect(menuItems({ date: "2026-11-09", entree: ["Nems"], plat: ["Steak haché"], dessert: ["Fruit"] })).toEqual(["Nems", "Steak haché", "Fruit"]);
  });
});

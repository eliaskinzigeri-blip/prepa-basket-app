import { describe, expect, it } from "vitest";
import { generateProgram } from "../program";
import type { Profile, Slot } from "../types";
import { ageOf, needsParentConsent, rowerOffer, rowerPlan, type RowerKind } from "./plans";

const profile = (over: Partial<Profile> = {}) => ({
  id: "u", first_name: "N", birth_date: "2013-03-01", home_equipment: ["rameur"], workout_locations: ["maison"], priorities_high: ["endurance"], priorities_low: ["force"],
  session_minutes: 45, latest_min: 21 * 60, vacation_zone: null, ab_weeks: false, ab_reference: null, test_every_weeks: 4, has_hoop: false, ...over,
}) as unknown as Profile;
const free: Slot = { kind: "free", week: "*", weekday: 0, on_date: null, start_min: 17 * 60, end_min: 20 * 60, location: "maison", label: null };
const slots = (location: Slot["location"] = "maison", club = false): Slot[] => [
  ...[0, 1, 2, 3, 4, 5].map((weekday) => ({ ...free, weekday, location })),
  ...(club ? [{ ...free, kind: "club" as const, weekday: 1, start_min: 21 * 60 - 60, end_min: 21 * 60, location: null }] : []),
];
const MONDAY = "2026-11-09";

describe("séances au rameur", () => {
  it("respecte 22 coups par minute, sans jamais de Z4 ni Z5", () => {
    for (const kind of ["endurance", "warmup", "recup", "test"] as RowerKind[]) {
      for (const iv of rowerPlan(kind).intervals) {
        expect(iv.spm[0]).toBeGreaterThanOrEqual(22);
        expect(["seuil", "intense"]).not.toContain(iv.zone);
      }
    }
  });
  it("endurance de 20 à 30 min, en Z2 facile", () => {
    for (const m of [30, 45, 60, 90]) {
      const p = rowerPlan("endurance", m);
      expect(p.seconds / 60).toBeGreaterThanOrEqual(20);
      expect(p.seconds / 60).toBeLessThanOrEqual(30);
      expect(p.intervals.find((i) => i.work)?.zone).toBe("ut2");
      expect(p.intervals.find((i) => i.work)?.spm).toEqual([22, 24]);
    }
  });
  it("échauffement de 5 min au plus, résistance 2 à 3", () => {
    const p = rowerPlan("warmup");
    expect(p.seconds).toBeLessThanOrEqual(300);
    expect(p.intervals[0].resistance).toBeLessThanOrEqual(3);
    expect(p.intervals[0].spm).toEqual([22, 24]);
  });
  it("récupération de 10 à 15 min, test de 20 min", () => {
    expect(rowerPlan("recup").seconds / 60).toBeGreaterThanOrEqual(10);
    expect(rowerPlan("recup").seconds / 60).toBeLessThanOrEqual(15);
    expect(rowerPlan("test").intervals.find((i) => i.isTest)?.seconds).toBe(1200);
  });
});

describe("règles d'âge", () => {
  it("demande l'accord d'un parent avant 15 ans, et reste prudent si l'âge est inconnu", () => {
    expect(needsParentConsent(13)).toBe(true);
    expect(needsParentConsent(15)).toBe(false);
    expect(ageOf({ birth_date: null })).toBe(13);
  });
});

describe("proposition dans une séance", () => {
  const e = (template: string, location = "maison") => ({ type: "workout" as const, location, payload: { template } });
  const p = profile();
  it("rien sans rameur coché, ni hors de la maison", () => {
    expect(rowerOffer(e("muscle"), profile({ home_equipment: [] }))).toBeNull();
    expect(rowerOffer(e("muscle", "salle"), p)).toBeNull();
  });
  it("seulement un échauffement facile pour la détente, la vitesse, l'explosivité et les appuis", () => {
    for (const t of ["detente", "vitesse", "explosivite", "appuis", "muscle", "haut"]) expect(rowerOffer(e(t), p)?.kind).toBe("warmup");
    expect(rowerOffer(e("recup"), p)?.kind).toBe("recup");
  });
});

describe("séance partiellement faite", () => {
  it("compte pour moitié dans la progression, même si elle était facile", async () => {
    const { progressionOf } = await import("../progression");
    const ev = (payload: Record<string, unknown>) => ({ type: "workout", status: "done", payload }) as never;
    const full = progressionOf(profile(), Array.from({ length: 10 }, () => ev({ template: "haut" })), [], []);
    const half = progressionOf(profile(), Array.from({ length: 10 }, () => ev({ template: "haut", partial: true, easy: 2 })), [], []);
    const none = progressionOf(profile(), [], [], []);
    expect(full.stage).toBeGreaterThan(none.stage);
    expect(half.toNext).toBeGreaterThan(0);
    expect(levelOf(half)).toBeLessThan(levelOf(full));
    expect(levelOf(half)).toBeGreaterThan(levelOf(none));
  });
});
const levelOf = (p: { stage: number; step: number }) => (p.stage - 1) * 4 + p.step;

describe("programme", () => {
  const rowers = (p: Profile, s: Slot[]) => generateProgram(p, s, [], MONDAY, 1).filter((x) => x.payload.rower);
  it("place l'endurance au rameur à la maison, en 20 à 30 min", () => {
    const list = rowers(profile(), slots());
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const r of list) {
      expect(r.location).toBe("maison");
      expect((r.end_min ?? 0) - (r.start_min ?? 0)).toBeLessThanOrEqual(30);
    }
  });
  it("une seule séance par semaine avec du club, deux au plus sinon", () => {
    expect(rowers(profile(), slots("maison", true)).length).toBeLessThanOrEqual(1);
    expect(rowers(profile(), slots()).length).toBeLessThanOrEqual(2);
  });
  it("aucune sans rameur coché, ni à la salle, ni pour un autre objectif", () => {
    expect(rowers(profile({ home_equipment: [] }), slots())).toEqual([]);
    expect(rowers(profile({ workout_locations: ["basicfit"] }), slots("salle"))).toEqual([]);
    expect(rowers(profile({ priorities_high: ["detente"], priorities_low: ["vitesse"] }), slots())).toEqual([]);
  });
});

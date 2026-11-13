import { describe, expect, it } from "vitest";
import { addDays } from "./format";
import { bedtimeFor, chronotypeOf, clockOf, hrvStatus, readinessFor, redStreak, weekStats, type HrvPoint, type SleepLog } from "./sleep";

const night = (date: string, bed: number, wake: number, free = false, quality: number | null = 4): SleepLog => ({ date, bed_min: bed, wake_min: wake, quality, free_day: free });
// Lundi 2 novembre 2026 → dimanche 8
const D = (i: number) => addDays("2026-11-02", i);
const hrvAt = (day: string, value: number, hour = 7): HrvPoint => ({ value, measured_at: new Date(`${day}T${String(hour).padStart(2, "0")}:05:00`).toISOString() });

describe("journal de sommeil", () => {
  it("semaine : durée moyenne, dette par rapport aux 9 h, écart de lever", () => {
    const logs = [
      ...[0, 1, 2, 3, 4].map((i) => night(D(i), -75, 420)), // 22 h 45 → 7 h : 8 h 15
      night(D(5), -30, 600, true), night(D(6), -15, 630, true), // week-end : 10 h 30 et 10 h 45
    ];
    const s = weekStats(logs, D(6));
    expect(s.nights).toBe(7);
    expect(s.debtMin).toBe(5 * 45); // 45 min de moins chaque soir de semaine, rien le week-end
    expect(s.wakeGapMin).toBe(195); // lever 10 h 15 en moyenne contre 7 h
  });

  it("heure de coucher : 9 h de sommeil + 15 min pour s'endormir", () => {
    expect(clockOf(bedtimeFor(420))).toBe("21 h 45");
    expect(clockOf(bedtimeFor(405))).toBe("21 h 30");
  });
});

describe("chronotype (MCTQ)", () => {
  it("il faut au moins 4 nuits de jours libres", () => {
    expect(chronotypeOf([night(D(5), 0, 600, true)], D(6)).type).toBeNull();
  });

  it("ado du soir : milieu de nuit tardif, corrigé du sommeil rattrapé", () => {
    const logs: SleepLog[] = [];
    for (const w of [0, 7]) {
      for (const i of [0, 1, 2, 3, 4]) logs.push(night(D(w + i), -60, 420)); // 23 h → 7 h : 8 h
      logs.push(night(D(w + 5), 30, 660, true), night(D(w + 6), 30, 660, true)); // 0 h 30 → 11 h : 10 h 30
    }
    const c = chronotypeOf(logs, D(13));
    // MSF = 5 h 45 ; SDf 10 h 30, SDw 8 h, SDweek 8 h 43 → MSFsc = 5 h 45 − 54 min = 4 h 51 : intermédiaire, à la limite du soir
    expect(c.type).toBe("intermediaire");
    if (c.type) expect(clockOf(c.msfsc)).toBe("4 h 51");
  });

  it("couche-tard même corrigé : plutôt du soir ; lève-tôt : plutôt du matin", () => {
    const late = [0, 1, 2, 3].map((i) => night(D(i), 90, 690, true)); // 1 h 30 → 11 h 30
    expect(chronotypeOf(late, D(3)).type).toBe("soir");
    const early = [0, 1, 2, 3].map((i) => night(D(i), -150, 330, true)); // 21 h 30 → 5 h 30
    expect(chronotypeOf(early, D(3)).type).toBe("matin");
  });
});

describe("forme du matin", () => {
  // 7 matins de référence réalistes (la VFC varie de 5 à 10 % d'un jour à l'autre) : moyenne ≈ 59,5 ms,
  // zone normale ≈ 57 à 62 ms, forte baisse sous ≈ 54,6 ms
  const base = [55, 63, 58, 66, 60, 52, 64].map((v, i) => hrvAt(D(i), v));
  const day = D(7);

  it("zone normale : moyenne des jours précédents ± 0,5 écart-type, rien avant 7 jours", () => {
    expect(hrvStatus([...base.slice(0, 6), hrvAt(day, 40)], day)).toBeNull();
    const h = hrvStatus([...base, hrvAt(day, 60)], day)!;
    expect([h.low, h.high]).toEqual([57, 62]);
    expect(h.drop || h.trendLow).toBe(false);
  });

  it("une seule mesure un peu basse ne compte pas ; une forte baisse, si", () => {
    expect(readinessFor(day, [], [...base, hrvAt(day, 56)]).level).toBe("vert");
    expect(readinessFor(day, [], [...base, hrvAt(day, 50)]).level).toBe("orange");
  });

  it("seule la première mesure du jour (celle du réveil) compte", () => {
    expect(hrvStatus([...base, hrvAt(day, 50, 7), hrvAt(day, 70, 18)], day)!.today).toBe(50);
  });

  it("tendance : 3 matins sous la zone normale en une semaine → orange, même sans forte baisse", () => {
    // 14 matins de référence, puis 3 matins à 55-56 ms (sous la zone normale, sans forte baisse)
    const ref = [...base, ...[55, 63, 58, 66, 60, 52, 64].map((v, i) => hrvAt(D(7 + i), v))];
    const tired = [...ref, hrvAt(D(21), 55), hrvAt(D(22), 55), hrvAt(D(23), 56)];
    const h = hrvStatus(tired, D(23))!;
    expect(h.drop).toBe(false);
    expect(h.trendLow).toBe(true);
    expect(readinessFor(D(23), [], tired).level).toBe("orange");
  });

  it("vert : bonne nuit et VFC dans la zone normale", () => {
    expect(readinessFor(day, [night(day, -75, 450)], [...base, hrvAt(day, 61)]).level).toBe("vert");
  });

  it("orange : nuit de moins de 8 h, ou mauvaise note", () => {
    expect(readinessFor(day, [night(day, -30, 420)], []).level).toBe("orange"); // 7 h 30
    expect(readinessFor(day, [night(day, -75, 450, false, 2)], []).level).toBe("orange");
  });

  it("rouge : moins de 6 h 30, ou forte baisse après une mauvaise nuit, ou deux matins de suite", () => {
    expect(readinessFor(day, [night(day, 60, 420)], []).level).toBe("rouge"); // 6 h
    expect(readinessFor(day, [night(day, -20, 420)], [...base, hrvAt(day, 50)]).level).toBe("rouge");
    const two = [...base, hrvAt(day, 50), hrvAt(D(8), 50)];
    expect(readinessFor(D(8), [night(D(8), -75, 450)], two).level).toBe("rouge");
    expect(redStreak(D(8), [night(D(8), -75, 450)], two)).toBe(1);
  });

  it("sans journal ni mesure : pas d'avis", () => {
    expect(readinessFor(day, [], base).level).toBeNull();
  });
});

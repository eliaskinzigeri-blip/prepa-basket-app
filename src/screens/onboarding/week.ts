// Conversion entre la saisie « semaine type » de l'onboarding et les créneaux stockés.
import type { Place, Slot } from "../../lib/types";

export interface DayClass { start: number; end: number }
export interface Week {
  ab: boolean;
  classes: { A: (DayClass | null)[]; B: (DayClass | null)[] }; // lundi → samedi
  clubs: { weekday: number; start: number; end: number }[];
  places: Place[]; // lieu possible par jour, lundi → dimanche
}

export const emptyWeek = (): Week => ({
  ab: false,
  classes: {
    A: [0, 1, 2, 3, 4, 5].map((d) => (d === 5 ? null : d === 2 ? { start: 8 * 60, end: 12 * 60 } : { start: 8 * 60, end: 17 * 60 })),
    B: [0, 1, 2, 3, 4, 5].map((d) => (d === 5 ? null : d === 2 ? { start: 8 * 60, end: 12 * 60 } : { start: 8 * 60, end: 17 * 60 })),
  },
  clubs: [],
  places: ["maison", "maison", "maison", "maison", "maison", "terrain", "maison"],
});

export function slotsToWeek(slots: Slot[], ab: boolean): Week {
  const w = emptyWeek();
  w.ab = ab;
  const cls = slots.filter((s) => s.kind === "class" && s.weekday != null);
  if (cls.length) {
    w.classes = { A: [null, null, null, null, null, null], B: [null, null, null, null, null, null] };
    for (const s of cls) {
      if (s.weekday! > 5) continue;
      const v = { start: s.start_min, end: s.end_min };
      if (s.week === "*" || s.week === "A") w.classes.A[s.weekday!] = v;
      if (s.week === "*" || s.week === "B") w.classes.B[s.weekday!] = v;
    }
  }
  w.clubs = slots.filter((s) => s.kind === "club" && s.weekday != null).map((s) => ({ weekday: s.weekday!, start: s.start_min, end: s.end_min }));
  for (const s of slots) if (s.kind === "free" && s.weekday != null && s.location) w.places[s.weekday] = s.location;
  return w;
}

export function weekToSlots(w: Week): Slot[] {
  const rows: Slot[] = [];
  const base = { on_date: null, location: null, label: null } as const;
  for (let d = 0; d < 6; d++) {
    const a = w.classes.A[d];
    const b = w.ab ? w.classes.B[d] : a;
    const same = a && b && a.start === b.start && a.end === b.end;
    if (same || (!w.ab && a)) rows.push({ ...base, kind: "class", week: "*", weekday: d, start_min: a!.start, end_min: a!.end, label: "Cours" });
    else {
      if (a) rows.push({ ...base, kind: "class", week: "A", weekday: d, start_min: a.start, end_min: a.end, label: "Cours" });
      if (b) rows.push({ ...base, kind: "class", week: "B", weekday: d, start_min: b.start, end_min: b.end, label: "Cours" });
    }
  }
  for (const c of w.clubs) rows.push({ ...base, kind: "club", week: "*", weekday: c.weekday, start_min: c.start, end_min: c.end, label: "Entraînement club" });
  w.places.forEach((p, d) => rows.push({ ...base, kind: "free", week: "*", weekday: d, start_min: 0, end_min: 1440, location: p, label: null }));
  return rows;
}

export const toMin = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

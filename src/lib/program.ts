// Génération du programme : place chaque séance dans un créneau libre précis,
// en respectant cours, entraînements club, matchs, heure limite et jour de repos.
import { TEMPLATES, isHoliday, skill } from "../data/catalog";
import { addDays, diffDays, weekday } from "./format";
import { hasRower, rowerPlan } from "./rower/plans";
import type { CalEvent, EventPayload, Place, Profile, Slot } from "./types";

export const WARMUP_MIN = 15;
const BUFFER = 15; // trajet / transition autour des cours et entraînements
const DAY_START = 9 * 60;
const SCHOOL_DAY_START = 7 * 60;
const LUNCH_END = 13 * 60 + 30; // fin du déjeuner à la cantine
// Horloge biologique (journal de sommeil, MCTQ) : un ado « du soir » est peu performant le matin.
const dayStart = (p: Pick<Profile, "chronotype" | "chronotype_enabled">) => (p.chronotype_enabled === false ? DAY_START : p.chronotype === "soir" ? 10 * 60 + 30 : p.chronotype === "intermediaire" ? 9 * 60 + 30 : DAY_START);
// Force, vitesse et adresse culminent en fin d'après-midi : la détente, la vitesse et les tests y vont en priorité.
const EXPLOSIVE = new Set(["detente", "vitesse", "explosivite", "appuis"]);
const PEAK = 17 * 60;

export interface Interval {
  start: number;
  end: number;
  location: Place;
}
export type NewEvent = Omit<CalEvent, "id">;

/** Semaine A ou B pour une date, à partir de la semaine de référence (A). */
export function weekType(p: Pick<Profile, "ab_weeks" | "ab_reference">, date: string): "A" | "B" {
  if (!p.ab_weeks || !p.ab_reference) return "A";
  const w = Math.floor(diffDays(date, p.ab_reference) / 7);
  return ((w % 2) + 2) % 2 === 0 ? "A" : "B";
}

/** Jour envoyé par NoteFlow (vrais cours de Pronote, trajets, repas) : le créneau « Cours » de la semaine type ne compte plus. */
const fromNoteflow = (slots: Slot[], date: string) => slots.some((s) => s.on_date === date && s.label?.startsWith("NoteFlow"));

function slotApplies(s: Slot, date: string, wt: "A" | "B") {
  if (s.on_date) return s.on_date === date;
  return s.weekday === weekday(date) && (s.week === "*" || s.week === wt);
}

/** Occupations d'une journée (cours, club, créneaux bloqués, matchs, autres séances). */
export function busyOn(date: string, profile: Profile, slots: Slot[], events: Pick<CalEvent, "date" | "start_min" | "end_min" | "type" | "id">[], ignoreId?: string, holiday = false) {
  const wt = weekType(profile, date);
  const busy: { start: number; end: number; kind: string }[] = [];
  const nf = fromNoteflow(slots, date);
  for (const s of slots) {
    if (s.kind === "free" || !slotApplies(s, date, wt)) continue;
    if (nf && s.kind === "class" && !s.on_date) continue;
    if (s.kind === "class" && holiday) continue;
    busy.push({ start: s.start_min - BUFFER, end: s.end_min + BUFFER, kind: s.kind });
  }
  for (const e of events) {
    if (e.date !== date || e.start_min == null || e.id === ignoreId || e.type === "rest") continue;
    const pad = e.type === "match" ? 60 : BUFFER;
    busy.push({ start: e.start_min - pad, end: (e.end_min ?? e.start_min + 90) + BUFFER, kind: e.type });
  }
  return busy.sort((a, b) => a.start - b.start);
}

/** Créneaux libres d'une journée, avec le lieu possible (US5). */
export function freeIntervals(date: string, profile: Profile, slots: Slot[], events: Pick<CalEvent, "date" | "start_min" | "end_min" | "type" | "id">[], ignoreId?: string): Interval[] {
  const holiday = isHoliday(profile.vacation_zone, date);
  const wt = weekType(profile, date);
  const busy = busyOn(date, profile, slots, events, ignoreId, holiday);
  const declared = slots.filter((s) => s.kind === "free" && slotApplies(s, date, wt));
  const nf = fromNoteflow(slots, date);
  const classes = holiday ? [] : slots.filter((s) => s.kind === "class" && slotApplies(s, date, wt) && !(nf && !s.on_date));
  const hasClass = classes.length > 0;
  // Les jours de cours, l'élève reste au collège entre deux cours et y déjeune : le trou de midi n'est jamais du
  // temps à la maison, même avec une journée déclarée libre. Cours finis le matin : il mange à la cantine avant de rentrer.
  if (hasClass) {
    const first = Math.min(...classes.map((s) => s.start_min));
    const last = Math.max(...classes.map((s) => s.end_min));
    const end = last >= 11 * 60 + 30 && last < LUNCH_END ? LUNCH_END : last;
    // Avant les cours : pas de séance (préparation, trajet) ; on commence la journée au premier cours.
    busy.push({ start: 0, end: end + BUFFER, kind: "class" });
    void first;
    busy.sort((a, b) => a.start - b.start);
  }
  // Sans créneau déclaré pour ce jour : toute la journée hors cours, à la maison.
  const base: Interval[] = declared.length && !holiday
    ? declared.map((s) => ({ start: s.start_min, end: s.end_min, location: (s.location ?? "maison") as Place }))
    : [{ start: hasClass ? SCHOOL_DAY_START : dayStart(profile), end: profile.latest_min, location: (declared[0]?.location ?? "maison") as Place }];
  const out: Interval[] = [];
  for (const b of base) {
    let cur = Math.max(b.start, hasClass ? SCHOOL_DAY_START : dayStart(profile));
    const end = Math.min(b.end, profile.latest_min);
    for (const o of busy) {
      if (o.end <= cur || o.start >= end) continue;
      if (o.start > cur) out.push({ start: cur, end: o.start, location: b.location });
      cur = Math.max(cur, o.end);
    }
    if (end > cur) out.push({ start: cur, end, location: b.location });
  }
  // Pas de séance déjà passée aujourd'hui.
  return out.filter((i) => i.end - i.start >= 10).map((i) => ({ ...i, start: roundUp(i.start) })).filter((i) => i.end > i.start);
}

const roundUp = (m: number) => Math.ceil(m / 15) * 15;

/** Séance lourde pour les jambes (ou test athlétique). */
export const isHeavySession = (e: Pick<CalEvent, "type" | "payload">) =>
  e.type === "test" || (e.type === "workout" && (!!e.payload.heavy || !!TEMPLATES[e.payload.template ?? ""]?.heavyLegs));

/** Jour interdit à une séance lourde de jambes : entraînement club ce jour-là, match ce jour-là ou le lendemain. */
export function heavyForbidden(date: string, profile: Profile, slots: Slot[], events: Pick<CalEvent, "date" | "type">[]): boolean {
  const club = slots.some((s) => s.kind === "club" && slotApplies(s, date, weekType(profile, date)))
    || slots.some((s) => s.on_date === date && /basket|entra[iî]nement|club/i.test(s.label ?? "") && s.label?.startsWith("NoteFlow"));
  const match = events.some((e) => e.type === "match" && (e.date === date || e.date === addDays(date, 1)));
  return club || match;
}

/**
 * Répartition 75 / 15 / 10 : chaque séance reçoit un axe, au plus grand déficit. Avec peu de séances (club et match
 * en plus), les objectifs prioritaires passent d'abord ; les axes secondaires sont déjà travaillés au club.
 */
export function focusSequence(high: string[], low: string[], n: number): string[] {
  const weights = new Map<string, number>();
  high.forEach((s) => weights.set(s, (high.length ? 0.75 : 0) / high.length));
  low.forEach((s) => weights.set(s, (weights.get(s) ?? 0) + 0.15 / Math.max(low.length, 1)));
  weights.set("general", 0.1 + (low.length ? 0 : 0.15) + (high.length ? 0 : 0.75));
  const given = new Map<string, number>();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let best = "general";
    let bestGap = -Infinity;
    for (const [k, w] of weights) {
      const gap = w * (i + 1) - (given.get(k) ?? 0);
      if (gap > bestGap) [best, bestGap] = [k, gap];
    }
    given.set(best, (given.get(best) ?? 0) + 1);
    out.push(best);
  }
  return out;
}

interface Plan {
  type: "workout" | "basket" | "test";
  title: string;
  minutes: number;
  heavy: boolean;
  needs: Place[] | null; // lieux possibles ; null = partout
  payload: EventPayload;
}

function planFor(focus: string, p: Profile, minutes: number, generalIdx: number): Plan {
  const s = skill(focus);
  const shootPlaces: Place[] = p.has_hoop ? ["terrain", "maison"] : ["terrain"];
  if (s?.domain === "shoot") {
    return { type: "basket", title: s.label, minutes, heavy: false, needs: shootPlaces, payload: { mode: "shoot", focus, games: s.games } };
  }
  if (s?.domain === "dribble") {
    // ambidextrie avec un panier : main faible au dribble, puis finition main faible près du cercle
    if (focus === "main_faible" && p.has_hoop) {
      return { type: "basket", title: s.label, minutes: Math.min(minutes, 40), heavy: false, needs: shootPlaces, payload: { mode: "dribble", focus, games: ["main_faible", "crossover", "finition"] } };
    }
    return { type: "basket", title: s.label, minutes: Math.min(minutes, 30), heavy: false, needs: null, payload: { mode: "dribble", focus, games: s.games } };
  }
  const template = s?.template ?? (["haut", "force", "explosivite"][generalIdx % 3]);
  const t = TEMPLATES[template];
  const workoutPlaces: Place[] = p.workout_locations.some((l) => l !== "maison") ? ["salle", "maison"] : ["maison", "salle"];
  return { type: "workout", title: t.title, minutes, heavy: t.heavyLegs, needs: workoutPlaces, payload: { template, focus } };
}

const placeOk = (needs: Place[] | null, loc: Place, p: Profile) => {
  if (!needs) return true;
  if (!needs.includes(loc)) return false;
  if (loc === "salle") return p.workout_locations.some((l) => l !== "maison");
  return true;
};

/**
 * Génère `weeks` semaines à partir du lundi `start`.
 * `fixed` = événements déjà connus (matchs FFBB, matchs manuels) pour adapter le programme (US16).
 */
export function generateProgram(profile: Profile, slots: Slot[], fixed: CalEvent[], start: string, weeks = 4, fromDate = start): NewEvent[] {
  const out: NewEvent[] = [];
  const matchDays = new Set(fixed.filter((e) => e.type === "match").map((e) => e.date));
  const clubDays = (d: string) => slots.some((s) => s.kind === "club" && slotApplies(s, d, weekType(profile, d)));
  let generalIdx = 0;

  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, w * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d >= fromDate);
    if (!days.length) continue;
    const holidayWeek = days.filter((d) => isHoliday(profile.vacation_zone, d)).length >= 4;
    const minutes = holidayWeek ? Math.min(profile.session_minutes + 15, 90) : profile.session_minutes;
    const placed: NewEvent[] = [];
    // Le basket et le club comptent déjà comme cardio : une séance de rameur par semaine si le joueur a du club, deux au plus sinon.
    const clubWeek = holidayWeek ? 0 : days.filter(clubDays).length;
    const matchWeek = days.filter((d) => matchDays.has(d)).length;
    // Charge totale raisonnable pour un ado : un jour de repos, et les séances club et matchs comptent dans la semaine.
    const base = ({ 30: 6, 45: 5, 60: 5, 90: 4 } as const)[profile.session_minutes] ?? 5;
    const target = Math.min(base + (holidayWeek ? 1 : 0), Math.max(3, 6 - clubWeek - matchWeek + 1), days.length - 1);
    // Bloc de 4 semaines : 3 semaines où la charge monte, puis une semaine allégée pour assimiler (surcompensation).
    const deload = !holidayWeek && ((Math.floor(diffDays(monday, start) / 7) % 4) === 3);
    let rowerLeft = !hasRower(profile) ? 0 : clubWeek ? 1 : 2;
    const context = () => [...fixed, ...placed.map((e, i) => ({ ...e, id: `n${i}` }))] as CalEvent[];

    // Jour de repos : le jour sans match ni club le plus chargé (en cours), dimanche en priorité.
    const restCandidates = days.filter((d) => !matchDays.has(d) && !clubDays(d));
    const rest = restCandidates.sort((a, b) => score(b) - score(a))[0];
    function score(d: string) {
      const free = freeIntervals(d, profile, slots, fixed).reduce((n, i) => n + i.end - i.start, 0);
      return (weekday(d) === 6 ? 1000 : 0) - free;
    }
    if (rest) placed.push({ date: rest, start_min: null, end_min: null, type: "rest", title: "Repos", location: null, source: "program", payload: {}, status: "planned" });

    // Tests athlétiques toutes les N semaines (4 par défaut, réglable), jamais la veille ni le jour d'un match.
    const plans: Plan[] = [];
    // Cycle des tests ancré sur la première semaine complète du programme.
    const anchor = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => d >= fromDate).length >= 3 ? start : addDays(start, 7);
    // Tests en fin de cycle (la semaine allégée tous les 4) : on les passe reposé, et ils mesurent le cycle écoulé.
    const every = profile.test_every_weeks || 4;
    const testWeek = diffDays(monday, anchor) >= 0 && (Math.floor(diffDays(monday, anchor) / 7) + 1) % every === 0;
    if (testWeek) plans.push({ type: "test", title: "Tests athlétiques", minutes: 45, heavy: true, needs: ["terrain", "salle", "maison"], payload: { note: "Les tests de tes objectifs" } });
    const foci = focusSequence(profile.priorities_high, profile.priorities_low, target - plans.length);
    for (const f of foci) plans.push(planFor(f === "general" ? "" : f, profile, minutes, f === "general" ? generalIdx++ : 0));
    // Semaine chargée (club + match) : une seule séance lourde de jambes. La prise de muscle passe au haut du corps,
    // les jambes travaillent déjà en détente, au club et en match.
    const maxHeavy = clubWeek + matchWeek >= 2 ? 1 : 2;
    let heavyCount = 0;
    for (let k = 0; k < plans.length; k++) {
      const pl = plans[k];
      if (!pl.heavy) continue;
      if (++heavyCount <= maxHeavy || pl.type !== "workout") continue;
      // Semaine de tests : les sauts des tests remplacent la séance de détente
      if (testWeek && (pl.payload.focus === "detente" || pl.payload.focus === "vitesse")) { plans.splice(k--, 1); continue; }
      plans[k] = pl.payload.focus === "muscle"
        ? { ...pl, title: "Prise de muscle · haut du corps", heavy: false, payload: { ...pl.payload, template: "haut" } }
        : { ...pl, ...planFor("", profile, minutes, 0), payload: { ...planFor("", profile, minutes, 0).payload, focus: pl.payload.focus } };
    }
    // Pas deux séances de haut du corps dans la semaine : la seconde devient une 2e séance de l'objectif de tir.
    const shootGoal = profile.priorities_high.find((f) => skill(f)?.domain === "shoot");
    const hauts = plans.filter((pl) => pl.payload.template === "haut");
    if (hauts.length > 1 && shootGoal) {
      const k = plans.indexOf(hauts.find((pl) => pl.payload.focus !== "muscle") ?? hauts[1]);
      plans[k] = planFor(shootGoal, profile, minutes, 0);
    }

    // Cardio pour faire baisser la FC au repos : une séance de rameur en endurance (zone 2, 30 min) par semaine, en plus,
    // si le joueur a un rameur et l'endurance dans ses priorités. Facile et sans jambes lourdes : elle ne prend rien à la prise de muscle ni à la croissance.
    const wantsCardio = [...profile.priorities_high, ...profile.priorities_low].includes("endurance");
    if (hasRower(profile) && wantsCardio && !plans.some((pl) => pl.payload.template === "endurance")) {
      plans.push({ type: "workout", title: "Endurance · rameur", minutes: 30, heavy: false, needs: ["maison"], payload: { template: "endurance", focus: "endurance" } });
    }

    // Les séances jambes lourdes d'abord : ce sont les plus contraintes.
    plans.sort((a, b) => Number(b.heavy) - Number(a.heavy) || b.minutes - a.minutes);
    // Repli : une séance sans créneau compatible (lieu, durée) devient du dribble, faisable partout.
    const fallback = (p: Plan): Plan | null => (p.type === "basket" && p.payload.mode === "dribble") || p.type === "test" ? null
      : { type: "basket", title: "Dribble · réflexes", minutes: Math.min(p.minutes, 30), heavy: false, needs: null, payload: { mode: "dribble", focus: p.payload.focus, games: ["reflexes", "sequence", "crossover"] } };
    for (const plan of plans) {
      const need = plan.minutes + (plan.type === "basket" && plan.payload.mode === "dribble" ? 0 : WARMUP_MIN);
      let best: { d: string; i: Interval; cost: number } | null = null;
      for (const d of days) {
        if (d === rest) continue;
        if (placed.some((e) => e.date === d && e.type !== "rest")) continue;
        const isMatch = matchDays.has(d);
        const eve = matchDays.has(addDays(d, 1));
        const after = matchDays.has(addDays(d, -1));
        if (plan.heavy && (isMatch || eve || clubDays(d))) continue;
        // Jour de match : rien d'autre que le match
        if (isMatch) continue;
        // Jambes : 48 h entre deux séances lourdes (récupération musculaire et tendons en croissance)
        const heavyNear = (x: string) => placed.some((e) => e.date === x && e.payload.heavy)
          || fixed.some((e) => e.date === x && e.status !== "skipped" && isHeavySession(e));
        if (plan.heavy && (heavyNear(addDays(d, -1)) || heavyNear(addDays(d, 1)))) continue;
        // Même axe deux jours de suite : à éviter
        const sameNear = placed.some((e) => (e.date === addDays(d, -1) || e.date === addDays(d, 1)) && e.payload.focus === plan.payload.focus && !!plan.payload.focus);
        for (const i of freeIntervals(d, profile, slots, context())) {
          if (i.end - i.start < need || !placeOk(plan.needs, i.location, profile)) continue;
          // Détente, vitesse, tests : en fin d'après-midi si le créneau le permet (chronotype du soir ou intermédiaire)
          const explosive = plan.type === "test" || EXPLOSIVE.has(String(plan.payload.focus ?? ""));
          const late = explosive && profile.chronotype_enabled !== false && (profile.chronotype === "soir" || profile.chronotype === "intermediaire");
          const st = late ? Math.max(i.start, Math.min(PEAK, Math.floor((i.end - need) / 15) * 15)) : i.start;
          // Préférences : éviter les jours de club pour le lourd, la fin de soirée, le lendemain de match, le matin pour un ado du soir.
          const cost = (clubDays(d) ? (plan.heavy ? 50 : 15) : 0) + (clubDays(addDays(d, 1)) && plan.heavy ? 20 : 0) + (sameNear ? 35 : 0) + (after ? 40 : 0) + Math.max(0, st - 18 * 60) / 10 + (isMatch ? 30 : 0) + (st < 8 * 60 ? 80 : 0)
            + (late && st < 16 * 60 ? (profile.chronotype === "soir" ? 30 : 12) : 0);
          if (!best || cost < best.cost) best = { d, i: { ...i, start: st }, cost };
        }
      }
      if (!best) {
        const fb = fallback(plan);
        if (fb) plans.push(fb);
        continue;
      }
      const startMin = best.i.start;
      // Endurance à la maison : au rameur, si le joueur en a un. Séance de 20 à 30 min, sans échauffement à part.
      const onRower = rowerLeft > 0 && plan.payload.template === "endurance" && best.i.location === "maison";
      if (onRower) rowerLeft--;
      placed.push({
        date: best.d,
        start_min: startMin,
        end_min: startMin + (onRower ? Math.round(rowerPlan("endurance", profile.session_minutes).seconds / 60) : need),
        type: plan.type,
        title: onRower ? "Endurance · rameur" : plan.title,
        location: best.i.location,
        source: "program",
        payload: { ...plan.payload, ...(onRower ? { rower: "endurance" as const } : {}), holiday: holidayWeek || undefined,
          heavy: plan.heavy || undefined, deload: (deload && plan.type === "workout") || undefined },
        status: "planned",
      });
    }

    // Lendemain de match : récupération légère si le jour est libre (US16).
    for (const d of days) {
      if (!matchDays.has(addDays(d, -1)) || placed.some((e) => e.date === d && e.type !== "rest")) continue;
      const i = freeIntervals(d, profile, slots, context()).find((x) => x.end - x.start >= 20);
      if (!i) continue;
      const restIdx = placed.findIndex((e) => e.date === d && e.type === "rest");
      if (restIdx >= 0) continue; // le repos reste un vrai repos
      placed.push({ date: d, start_min: i.start, end_min: i.start + 20, type: "workout", title: "Récupération légère", location: "maison", source: "program", payload: { template: "recup" }, status: "planned" });
    }
    out.push(...placed);
  }
  return out;
}

/** Après un imprévu ou un déplacement : nouveau créneau le plus proche, même jour d'abord (US6). */
export function relocate(ev: CalEvent, profile: Profile, slots: Slot[], events: CalEvent[]): { date: string; start_min: number; end_min: number } | null {
  const len = (ev.end_min ?? 0) - (ev.start_min ?? 0) || profile.session_minutes + WARMUP_MIN;
  for (let k = 0; k < 7; k++) {
    for (const d of k === 0 ? [ev.date] : [addDays(ev.date, k), addDays(ev.date, -k)]) {
      if (d < ev.date && k > 0) continue; // on ne replace pas dans le passé
      if (events.some((e) => e.date === d && e.type === "rest")) continue;
      if (events.some((e) => e.id !== ev.id && e.date === d && (e.type === "workout" || e.type === "basket" || e.type === "test"))) continue;
      if (isHeavySession(ev) && heavyForbidden(d, profile, slots, events)) continue;
      // Créneau le plus proche de l'heure prévue, en évitant l'avant-8h.
      const target = ev.start_min ?? 17 * 60;
      const options = freeIntervals(d, profile, slots, events, ev.id).filter((x) => x.end - x.start >= len)
        .map((x) => ({ x, start: Math.min(Math.max(x.start, roundUp(target)), x.end - len) }))
        .sort((a, b) => Number(a.start < 8 * 60) - Number(b.start < 8 * 60) || Math.abs(a.start - target) - Math.abs(b.start - target));
      const i = options[0];
      if (i) return { date: d, start_min: i.start, end_min: i.start + len };
    }
  }
  return null;
}


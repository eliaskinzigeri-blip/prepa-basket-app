// Accès aux données Supabase + file d'attente hors ligne pour les résultats de séance (PRD : hors ligne).
import { supabase } from "./supabase";
import { heart, summarize } from "./heart";
import type { CalEvent, Profile, SessionRow, Slot } from "./types";
import { generateProgram, type NewEvent } from "./program";
import { addDays, mondayOf, today } from "./format";

export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(patch: Partial<Profile>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Session expirée, reconnecte-toi.");
  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) throw error;
}

export async function fetchSlots(): Promise<Slot[]> {
  const { data, error } = await supabase.from("schedule_slots").select("*").order("start_min");
  if (error) throw error;
  return data as Slot[];
}

export async function replaceSlots(kinds: Slot["kind"][], rows: Slot[]) {
  const del = await supabase.from("schedule_slots").delete().in("kind", kinds).is("on_date", null);
  if (del.error) throw del.error;
  if (!rows.length) return;
  const { error } = await supabase.from("schedule_slots").insert(rows.map(({ id: _id, ...r }) => r));
  if (error) throw error;
}

export async function fetchEvents(from: string, to: string): Promise<CalEvent[]> {
  const { data, error } = await supabase.from("events").select("*").gte("date", from).lte("date", to).order("date").order("start_min", { nullsFirst: true });
  if (error) throw error;
  return data as CalEvent[];
}

export async function ffbb<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ffbb", { body });
  if (error) {
    let msg = "Le service FFBB ne répond pas. Réessaie plus tard ou ajoute ton match à la main.";
    try { msg = (await (error as any).context.json()).error ?? msg; } catch { /* message par défaut */ }
    throw new Error(msg);
  }
  return data as T;
}

/**
 * (Re)génère le programme : supprime les séances futures non faites puis place les nouvelles.
 * `from` = premier jour régénéré (US14 : à partir de la semaine suivante).
 */
export async function regenerateProgram(profile: Profile, from = today(), weeks = 5) {
  const start = mondayOf(from);
  const to = addDays(start, weeks * 7 - 1);
  const [slots, existing] = await Promise.all([fetchSlots(), fetchEvents(start, to)]);
  const fixed = existing.filter((e) => e.source !== "program");
  const del = await supabase.from("events").delete().eq("source", "program").eq("status", "planned").gte("date", from);
  if (del.error) throw del.error;
  const keep = existing.filter((e) => e.source === "program" && (e.status !== "planned" || e.date < from));
  const rows: NewEvent[] = generateProgram(profile, slots, [...fixed, ...keep], start, weeks, from)
    // pas de 2e séance un jour qui en a déjà une (faite, ou ajoutée / déplacée à la main)
    .filter((e) => !keep.some((k) => k.date === e.date && k.type !== "rest")
      && !(e.type !== "rest" && fixed.some((x) => x.date === e.date && (x.type === "workout" || x.type === "basket" || x.type === "test"))));
  if (rows.length) {
    const { error } = await supabase.from("events").insert(rows);
    if (error) throw error;
  }
  return rows;
}

// ——— Résultats de séance, avec file hors ligne ———
const OUTBOX = "pb.outbox.v1";
interface Pending {
  session: Omit<SessionRow, "id"> & { id: string };
  sets?: { exercise_id: string; set_index: number; load_kg: number | null; reps: number | null }[];
  measurements?: { kind: string; value: number; source: string }[];
  eventDone?: string | null;
  /** Champs ajoutés au payload de l'événement terminé (ex. exercices jugés trop faciles). */
  eventPayload?: Record<string, unknown> | null;
}

function readOutbox(): Pending[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"); } catch { return []; }
}
function writeOutbox(list: Pending[]) {
  try { localStorage.setItem(OUTBOX, JSON.stringify(list)); } catch { /* stockage plein ou bloqué */ }
}
export const pendingCount = () => readOutbox().length;

async function push(p: Pending) {
  const s = await supabase.from("sessions").upsert(p.session);
  if (s.error) throw s.error;
  if (p.sets?.length) {
    const r = await supabase.from("set_logs").insert(p.sets.map((x) => ({ ...x, session_id: p.session.id })));
    if (r.error) throw r.error;
  }
  if (p.measurements?.length) {
    const r = await supabase.from("measurements").insert(p.measurements.map((m) => ({ ...m, measured_at: p.session.started_at })));
    if (r.error) throw r.error;
  }
  if (p.eventDone) await supabase.from("events").update({ status: "done", ...(p.eventPayload ? { payload: p.eventPayload } : {}) }).eq("id", p.eventDone);
}

export async function saveSession(p: Pending): Promise<"saved" | "queued"> {
  // Ceinture cardio portée pendant la séance : on joint la FC (moyenne, max, temps par zone, courbe)
  if (!p.session.results?.heart && heart.samples.length) {
    const from = Date.parse(p.session.started_at);
    const to = p.session.duration_s ? from + p.session.duration_s * 1000 + 5000 : Date.now();
    const sum = summarize(heart.between(from, to), heart.age);
    if (sum) p = { ...p, session: { ...p.session, results: { ...p.session.results, heart: sum } } };
  }
  try {
    if (!navigator.onLine) throw new Error("hors ligne");
    await push(p);
    return "saved";
  } catch {
    writeOutbox([...readOutbox(), p]);
    return "queued";
  }
}

export async function flushOutbox() {
  const list = readOutbox();
  if (!list.length || !navigator.onLine) return 0;
  const left: Pending[] = [];
  for (const p of list) {
    try { await push(p); } catch { left.push(p); }
  }
  writeOutbox(left);
  return list.length - left.length;
}

export async function updateFeeling(sessionId: string, feeling: number) {
  await supabase.from("sessions").update({ feeling }).eq("id", sessionId);
}

/** Records : renvoie les records battus (US9 : récap avec records battus). */
export async function checkRecords(candidates: { key: string; value: number; better: "higher" | "lower"; label: string; unit?: string }[]) {
  if (!candidates.length) return [];
  const { data } = await supabase.from("records").select("key,value").in("key", candidates.map((c) => c.key));
  const prev = new Map((data ?? []).map((r) => [r.key, Number(r.value)]));
  // Première mesure : elle devient la référence, sans être annoncée comme record battu.
  const firsts = candidates.filter((c) => !prev.has(c.key) && c.value > 0);
  const beaten = candidates.filter((c) => {
    const old = prev.get(c.key);
    return old != null && (c.better === "higher" ? c.value > old : c.value < old);
  });
  const rows = [...firsts, ...beaten];
  if (rows.length) {
    await supabase.from("records").upsert(rows.map((b) => ({ key: b.key, value: b.value, better: b.better, achieved_at: new Date().toISOString() })));
  }
  return beaten.map((b) => ({ ...b, old: prev.get(b.key)! }));
}

export async function getRecord(key: string): Promise<number | null> {
  const { data } = await supabase.from("records").select("value").eq("key", key).maybeSingle();
  return data ? Number(data.value) : null;
}

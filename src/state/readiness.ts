// Forme du jour (sommeil + VFC du matin) et ce qu'elle change aux séances.
// 🟠 : séance allégée (une série de moins, sans lest) ; 🔴 : la séance lourde laisse la place à une récupération.
// Le joueur peut toujours garder la séance normale (choix gardé sur le téléphone, pour la journée).
import { useCallback, useMemo, useState } from "react";
import { isHeavySession } from "../lib/program";
import { readinessFor, redStreak, type ReadinessResult } from "../lib/sleep";
import { today } from "../lib/format";
import type { CalEvent } from "../lib/types";
import { useApp } from "./app";

const KEY = (d: string) => `pb.ready.keep.${d}`;
const read = (d: string) => { try { return localStorage.getItem(KEY(d)) === "1"; } catch { return false; } };

export function useReadiness(day = today()): ReadinessResult & { keep: boolean; setKeep: (v: boolean) => void; streak: number } {
  const app = useApp();
  // Le questionnaire de sommeil a été retiré : la forme du jour ne dépend plus que de la VFC du matin
  const sleepLogs = useMemo(() => [] as typeof app.sleepLogs, []);
  const measurements = app.measurements;
  const hrv = useMemo(() => (measurements ?? []).filter((m) => m.kind === "hrv").map((m) => ({ value: Number(m.value), measured_at: m.measured_at })), [measurements]);
  const r = useMemo(() => readinessFor(day, sleepLogs, hrv), [day, sleepLogs, hrv]);
  const streak = useMemo(() => (r.level === "rouge" ? redStreak(day, sleepLogs, hrv) : 0), [r.level, day, sleepLogs, hrv]);
  const [keep, setKeepState] = useState(() => read(day));
  const setKeep = useCallback((v: boolean) => {
    try { if (v) localStorage.setItem(KEY(day), "1"); else localStorage.removeItem(KEY(day)); } catch { /* stockage indisponible */ }
    setKeepState(v);
  }, [day]);
  return { ...r, keep, setKeep, streak };
}

/** Effet de la forme sur une séance : allégée, ou à remplacer par une récupération (séance lourde, jour rouge). */
export function adaptation(e: Pick<CalEvent, "date" | "type" | "payload" | "status">, level: ReadinessResult["level"], keep: boolean): "normal" | "light" | "recup" {
  if (keep || e.status !== "planned" || e.date !== today() || !level || level === "vert") return "normal";
  // Le tir et le dribble fatiguent peu : jamais réduits. Le club et les matchs ne sont jamais touchés.
  if (e.type !== "workout" && e.type !== "test") return "normal";
  if (e.payload.template === "recup") return "normal";
  if (level === "rouge" && isHeavySession(e)) return "recup";
  return e.type === "workout" ? "light" : "normal";
}

/** Séance du jour allégée par la forme du matin (même effet qu'une semaine allégée). */
export function useLight(e: Pick<CalEvent, "date" | "type" | "payload" | "status"> | null | undefined): boolean {
  const r = useReadiness(e?.date ?? today());
  return !!e && adaptation(e, r.level, r.keep) !== "normal";
}

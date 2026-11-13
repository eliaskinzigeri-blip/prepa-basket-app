import { useEffect, useReducer, useSyncExternalStore } from "react";
import type { Exercise } from "./types";

// Séance en cours, gardée sur le téléphone : elle survit au changement d'écran, à la sortie de l'app et à sa fermeture.
// Le repos est une heure de fin, pas un décompte : il continue de passer même quand l'app est en arrière-plan.
export interface SetLog { exercise_id: string; set_index: number; load_kg: number | null; reps: number | null }
export interface ActiveWorkout {
  userId: string;
  path: string;
  template: string;
  location: string;
  list: Exercise[];
  idx: number;
  setNo: number;
  load: number;
  reps: number;
  logs: SetLog[];
  lestOn: string[];
  startedAt: string;
  restEnd: number | null;
  restTotal: number;
  paused: boolean;
  pausedLeft: number | null; // ms de repos restantes pendant une pause
  updatedAt: number;
}

const KEY = "pb.activeWorkout";
const MAX_IDLE = 12 * 3600 * 1000; // sans activité pendant 12 h, la séance est considérée comme abandonnée
const listeners = new Set<() => void>();

function load(): ActiveWorkout | null {
  try {
    const raw = localStorage.getItem(KEY);
    const a = raw ? (JSON.parse(raw) as ActiveWorkout) : null;
    if (a && Date.now() - a.updatedAt > MAX_IDLE) { localStorage.removeItem(KEY); return null; }
    return a;
  } catch {
    return null;
  }
}

let current = load();

function publish(a: ActiveWorkout | null) {
  current = a;
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch { /* stockage indisponible : la séance reste en mémoire tant que l'app est ouverte */ }
  listeners.forEach((l) => l());
}

export const getActiveWorkout = () => current;
export const saveActiveWorkout = (a: Omit<ActiveWorkout, "updatedAt">) => publish({ ...a, updatedAt: Date.now() });
export const clearActiveWorkout = () => publish(null);
export const endActiveRest = () => { if (current) publish({ ...current, restEnd: null, pausedLeft: null, updatedAt: Date.now() }); };
export const samePath = (a: ActiveWorkout, pathname: string) => a.path.split("?")[0] === pathname;

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Séance en cours du compte connecté. */
export function useActiveWorkout(userId: string | undefined) {
  const a = useSyncExternalStore(subscribe, getActiveWorkout);
  return a && a.userId === userId ? a : null;
}

export function restLeft(end: number | null, frozen: number | null, now = Date.now()) {
  if (end == null) return null;
  return Math.max(0, Math.ceil((frozen ?? end - now) / 1000));
}

/** Secondes de repos restantes, recalculées à chaque seconde et dès le retour dans l'app. */
export function useRestLeft(end: number | null, frozen: number | null) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (end == null || frozen != null) return;
    let last = restLeft(end, frozen);
    const check = () => { const v = restLeft(end, frozen); if (v !== last) { last = v; tick(); } };
    const timer = setInterval(check, 250);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", check); window.removeEventListener("pageshow", check); };
  }, [end, frozen]);
  return restLeft(end, frozen);
}

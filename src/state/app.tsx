import { progressionOf, type Progression } from "../lib/progression";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { fetchEvents, fetchProfile, fetchSlots, ffbb, flushOutbox, regenerateProgram } from "../lib/data";
import { addDays, nowMin, today } from "../lib/format";
import { heart } from "../lib/heart";
import type { CalEvent, Goal, Measurement, Profile, Slot } from "../lib/types";
import { chronotypeOf, type SleepLog } from "../lib/sleep";
import { isNative, scheduleLocal } from "../native";
import { buildReminders } from "../native/reminders";

interface AppState {
  session: Session | null;
  authReady: boolean;
  profile: Profile | null;
  slots: Slot[];
  events: CalEvent[];
  measurements: Measurement[];
  goals: Goal[];
  sleepLogs: SleepLog[];
  loading: boolean;
  error: string | null;
  syncing: string | null;
  reload: () => Promise<void>;
  reloadEvents: () => Promise<void>;
  reloadGoals: () => Promise<void>;
  reloadSleep: () => Promise<void>;
  setProfile: (p: Profile) => void;
}

const Ctx = createContext<AppState | null>(null);
export const RANGE_BACK = 120;
export const RANGE_AHEAD = 70;

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sleepLogs, setSleepLogs] = useState<SleepLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  // Zones cardio de la ceinture : calculées avec l'âge du joueur
  useEffect(() => {
    if (profile?.birth_date) heart.age = Math.floor((Date.now() - Date.parse(profile.birth_date)) / 3.15576e10);
  }, [profile?.birth_date]);
  const userId = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const reloadEvents = useCallback(async () => {
    const t = today();
    setEvents(await fetchEvents(addDays(t, -RANGE_BACK), addDays(t, RANGE_AHEAD)));
  }, []);

  const reloadGoals = useCallback(async () => {
    const { data } = await supabase.from("goals").select("*").eq("archived", false).order("created_at");
    setGoals((data ?? []) as Goal[]);
  }, []);

  const reloadSleep = useCallback(async () => {
    const { data } = await supabase.from("sleep_logs").select("date, bed_min, wake_min, quality, free_day").gte("date", addDays(today(), -90)).order("date");
    setSleepLogs((data ?? []) as SleepLog[]);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = today();
      const [p, s, e, m, g, sl] = await Promise.all([
        fetchProfile(),
        fetchSlots(),
        fetchEvents(addDays(t, -RANGE_BACK), addDays(t, RANGE_AHEAD)),
        supabase.from("measurements").select("*").order("measured_at", { ascending: false }).limit(500),
        supabase.from("goals").select("*").eq("archived", false).order("created_at"),
        supabase.from("sleep_logs").select("date, bed_min, wake_min, quality, free_day").gte("date", addDays(t, -90)).order("date"),
      ]);
      setSleepLogs((sl.data ?? []) as SleepLog[]);
      setProfile(p);
      setSlots(s);
      setEvents(e);
      setMeasurements((m.data ?? []) as Measurement[]);
      setGoals((g.data ?? []) as Goal[]);
    } catch (err) {
      setError(navigator.onLine ? "Impossible de charger tes données. Réessaie." : "Hors ligne : tes données s'afficheront au retour du réseau.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    reload();
    flushOutbox();
    const onOnline = () => { flushOutbox().then((n) => { if (n) reload(); }); };
    window.addEventListener("online", onOnline);
    // Temps réel : mesures TrackFit (< 1 min), matchs FFBB, profil.
    const ch = supabase
      .channel(`u-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "measurements", filter: `user_id=eq.${userId}` }, (pl) =>
        setMeasurements((list) => [pl.new as Measurement, ...list]))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, (pl) =>
        setProfile(pl.new as Profile))
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `user_id=eq.${userId}` }, () => {
        reloadEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "goals", filter: `user_id=eq.${userId}` }, () => {
        reloadGoals();
      })
      .subscribe();
    return () => {
      window.removeEventListener("online", onOnline);
      supabase.removeChannel(ch);
    };
  }, [userId, reload, reloadEvents, reloadGoals]);

  // Connecteur FFBB : mise à jour au moins une fois par jour, puis adaptation du programme.
  const syncedOnce = useRef(false);
  useEffect(() => {
    if (!profile?.onboarded_at || !profile.ffbb_team || syncedOnce.current || !navigator.onLine) return;
    const last = profile.ffbb_synced_at ? Date.parse(profile.ffbb_synced_at) : 0;
    if (Date.now() - last < 20 * 3600 * 1000) return;
    syncedOnce.current = true;
    setSyncing("Synchro FFBB…");
    const before = events.filter((e) => e.type === "match").map((e) => `${e.date}${e.start_min}`).sort().join();
    ffbb({ action: "sync" })
      .then(async () => {
        const t = today();
        const fresh = await fetchEvents(addDays(t, -RANGE_BACK), addDays(t, RANGE_AHEAD));
        const after = fresh.filter((e) => e.type === "match").map((e) => `${e.date}${e.start_min}`).sort().join();
        if (after !== before) await regenerateProgram(profile, addDays(t, 1));
        await reloadEvents();
      })
      .catch(() => { /* l'écran Profil affiche la date de dernière synchro */ })
      .finally(() => setSyncing(null));
  }, [profile, events, reloadEvents]);

  // Chronotype : recalculé avec le journal de sommeil, enregistré dans le profil (le programme s'en sert)
  useEffect(() => {
    if (!profile || !sleepLogs.length || profile.chronotype_enabled === false) return;
    const c = chronotypeOf(sleepLogs, today());
    if (!c.type || (c.type === profile.chronotype && c.msfsc === profile.chronotype_msf)) return;
    const patch = { chronotype: c.type, chronotype_msf: c.msfsc };
    supabase.from("profiles").update(patch).eq("id", profile.id).then(({ error }) => { if (!error) setProfile({ ...profile, ...patch }); });
  }, [profile, sleepLogs]);

  // App iPhone native : rappels programmés sur le téléphone pour les 7 prochains jours (recalculés à chaque changement)
  useEffect(() => {
    if (!profile || !isNative()) return;
    const free = sleepLogs.filter((l) => l.free_day).map((l) => l.wake_min).sort((a, b) => a - b);
    const t = window.setTimeout(() => { scheduleLocal(buildReminders(profile, events, today(), free.length >= 2 ? free[Math.floor(free.length / 2)] : 630)).catch(() => undefined); }, 1500);
    return () => clearTimeout(t);
  }, [profile, events, sleepLogs]);

  // Rappel 30 min avant chaque séance et match du jour (notifications locales).
  useEffect(() => {
    if (!profile || isNative() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // Notifications Firebase actives sur ce téléphone : le serveur envoie déjà les rappels, même app fermée
    try { if (localStorage.getItem("pb.push.token")) return; } catch { /* stockage indisponible */ }
    const t = today();
    const timers = events
      .filter((e) => e.date === t && e.start_min != null && e.status === "planned")
      .filter((e) => (e.type === "match" ? profile.notif_match : profile.notif_session && e.type !== "club"))
      .map((e) => {
        const delay = (e.start_min! - 30 - nowMin()) * 60000;
        if (delay < 0) return 0;
        return window.setTimeout(() => {
          new Notification(e.type === "match" ? `Match dans 30 min : ${e.title}` : `Ta séance commence dans 30 min`, {
            body: e.type === "match" ? e.location ?? "" : e.title,
            icon: "/icon.svg",
          });
        }, delay);
      });
    return () => timers.forEach((id) => id && clearTimeout(id));
  }, [events, profile]);

  const value = useMemo<AppState>(
    () => ({ session, authReady, profile, slots, events, measurements, goals, sleepLogs, loading, error, syncing, reload, reloadEvents, reloadGoals, reloadSleep, setProfile }),
    [session, authReady, profile, slots, events, measurements, goals, sleepLogs, loading, error, syncing, reload, reloadEvents, reloadGoals, reloadSleep],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp hors AppProvider");
  return v;
}

/** Dernière valeur d'une mesure, et la précédente pour la variation. */
export function latest(ms: Measurement[], kind: string): { value: number | null; prev: number | null; at: string | null; source: string | null } {
  const list = ms.filter((m) => m.kind === kind).sort((a, b) => b.measured_at.localeCompare(a.measured_at));
  return { value: list[0] ? Number(list[0].value) : null, prev: list[1] ? Number(list[1].value) : null, at: list[0]?.measured_at ?? null, source: list[0]?.source ?? null };
}

/** Niveau d'entraînement du joueur (exercices débloqués et volume), recalculé quand il s'entraîne ou progresse. */
export function useProgression(): Progression {
  const { profile, events, goals, measurements } = useApp();
  return useMemo(() => progressionOf(profile!, events, goals, measurements), [profile, events, goals, measurements]);
}

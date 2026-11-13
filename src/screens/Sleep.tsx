// Sommeil : carte du matin (noter sa nuit en 10 s), carte du soir (heure de coucher), écran de suivi et chronotype.
import { useEffect, useMemo, useState } from "react";
import { routineTimes, type RoutineTimes } from "../lib/push";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { BackButton, BottomNav, Chip, Notice } from "../components/ui";
import { ReadyDot } from "../components/Readiness";
import { isHoliday } from "../data/catalog";
import { supabase } from "../lib/supabase";
import { updateProfile } from "../lib/data";
import { addDays, dayLabel, iso, nowMin, today, weekday } from "../lib/format";
import {
  CHRONO_LABEL, SLEEP_TARGET, bedtimeFor, chronotypeOf, clockOf, duration, hoursOf, hrvCalibration, hrvStatus, weekStats, type SleepLog,
} from "../lib/sleep";
import { useApp } from "../state/app";
import { useReadiness } from "../state/readiness";

const toInput = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const fromInput = (v: string) => { const [h, m] = v.split(":").map(Number); return h * 60 + (m || 0); };
/** Coucher saisi « 22:30 » → minutes depuis minuit du jour du réveil (la veille si après midi). */
const bedFromInput = (v: string) => { const m = fromInput(v); return m >= 12 * 60 ? m - 1440 : m; };
const QUALITY = ["Très mauvaise", "Mauvaise", "Moyenne", "Bonne", "Très bonne"];

/** Heures de la routine NoteFlow pour ce jour (coucher du soir, lever du lendemain), gardées 10 min. */
const routineCache = new Map<string, { at: number; v: RoutineTimes | null }>();
function useRoutine(day: string): RoutineTimes | null {
  const [v, setV] = useState<RoutineTimes | null>(() => routineCache.get(day)?.v ?? null);
  useEffect(() => {
    const c = routineCache.get(day);
    if (c && Date.now() - c.at < 600_000) { setV(c.v); return; }
    let alive = true;
    routineTimes(day).then((r) => { routineCache.set(day, { at: Date.now(), v: r }); if (alive) setV(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [day]);
  return v;
}
/** Sommeil prévu par la routine : du coucher de ce soir au lever de demain. */
const plannedSleep = (r: RoutineTimes | null) => (r?.bed != null && r.nextWake != null ? r.nextWake + 1440 - r.bed : null);

/** Jour de cours : du lundi au vendredi, hors vacances scolaires. */
export const schoolDay = (d: string, zone: "A" | "B" | "C" | null) => weekday(d) < 5 && !isHoliday(zone, d);

/** Formulaire d'une nuit (accueil le matin, ou correction d'un jour oublié). */
export function SleepForm({ date, onSaved }: { date: string; onSaved?: () => void }) {
  const { profile, sleepLogs, reloadSleep, session } = useApp();
  const existing = sleepLogs.find((l) => l.date === date);
  const last = [...sleepLogs].reverse().find((l) => l.date < date);
  const freeDefault = !schoolDay(date, profile?.vacation_zone ?? null);
  const [bed, setBed] = useState(toInput(existing?.bed_min ?? last?.bed_min ?? bedtimeFor(profile?.wake_school_min ?? 420)));
  const [wake, setWake] = useState(toInput(existing?.wake_min ?? (freeDefault ? (last?.free_day ? last.wake_min : 600) : profile?.wake_school_min ?? 420)));
  const [quality, setQuality] = useState<number>(existing?.quality ?? 4);
  const [free, setFree] = useState(existing?.free_day ?? freeDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dur = fromInput(wake) - bedFromInput(bed);

  async function save() {
    if (dur <= 0 || dur > 16 * 60) { setError("Vérifie les heures : la nuit doit durer entre quelques minutes et 16 h."); return; }
    setBusy(true); setError(null);
    const { error: e } = await supabase.from("sleep_logs").upsert({
      user_id: session!.user.id, date, bed_min: bedFromInput(bed), wake_min: fromInput(wake), quality, free_day: free,
    }, { onConflict: "user_id,date" });
    setBusy(false);
    if (e) { setError("La nuit n'a pas pu être enregistrée. Vérifie ta connexion."); return; }
    await reloadSleep();
    onSaved?.();
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="grid2">
        <label className="col" style={{ gap: 4 }}><span className="lbl">Couché à</span><input className="input pb-num" type="time" value={bed} onChange={(e) => setBed(e.target.value)} /></label>
        <label className="col" style={{ gap: 4 }}><span className="lbl">Levé à</span><input className="input pb-num" type="time" value={wake} onChange={(e) => setWake(e.target.value)} /></label>
      </div>
      <span className="pb-subtle" style={{ fontSize: 12 }}>« Couché » : l'heure où tu as éteint pour dormir, pas celle où tu t'es mis au lit avec ton téléphone.</span>
      <div>
        <span className="lbl">Ta nuit</span>
        <div className="pb-chips chips-wrap" style={{ marginTop: 6 }} role="group" aria-label="Note de ta nuit">
          {QUALITY.map((q, i) => <Chip key={q} active={quality === i + 1} onClick={() => setQuality(i + 1)}>{i + 1} · {q}</Chip>)}
        </div>
      </div>
      <label className="row" style={{ gap: 10, fontSize: 14 }}>
        <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} style={{ width: 22, height: 22 }} />
        Réveil sans réveil-matin (week-end, vacances)
      </label>
      {dur > 0 ? <span className="pb-muted pb-num" style={{ fontSize: 14 }}>Nuit de {hoursOf(dur)}{dur < SLEEP_TARGET ? ` · ${hoursOf(SLEEP_TARGET - dur)} de moins que l'objectif de 9 h` : " · objectif de 9 h atteint"}</span> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button className="pb-btn primary" disabled={busy} onClick={save}><Icon name="check" size="sm" />{existing ? "Corriger ma nuit" : "Enregistrer ma nuit"}</button>
    </div>
  );
}

/** Accueil : le matin, noter sa nuit (et mesurer sa VFC un jour de séance) ; le soir, l'heure de coucher. */
export function SleepCard() {
  const { profile, sleepLogs, events, measurements } = useApp();
  const t = today();
  const r = useReadiness(t);
  const [open, setOpen] = useState(false);
  const routine = useRoutine(t);
  if (!profile) return null;
  const logged = sleepLogs.some((l) => l.date === t);
  const now = nowMin();
  const sessionToday = events.some((e) => e.date === t && e.status === "planned" && (e.type === "workout" || e.type === "test"));
  const hrvToday = measurements.some((m) => m.kind === "hrv" && iso(new Date(m.measured_at)) === t);
  const tomorrowSchool = schoolDay(addDays(t, 1), profile.vacation_zone);
  const bed = bedtimeFor(profile.wake_school_min);

  // Soir : heure de coucher de la routine NoteFlow (et le sommeil qu'elle laisse), sinon 9 h avant le réveil des cours
  const planned = plannedSleep(routine);
  if (now >= 19 * 60 && routine?.bed != null) {
    return (
      <Link to="/sommeil" className="pb-glass pb-li" style={{ marginTop: 14, borderRadius: 20 }}>
        <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--primary-bright)" }}><Icon name="timer" size="sm" /></div>
        <div className="t">Au lit à {clockOf(routine.bed)}<small>{planned != null ? `${hoursOf(planned)} de sommeil avant ton réveil de ${clockOf(routine.nextWake!)}` : "D'après ta routine NoteFlow"}{planned != null && planned < SLEEP_TARGET ? " : moins que les 9 h conseillées" : ""}. Pose les écrans 30 min avant.</small></div>
        <Icon name="right" size="sm" className="pb-muted" />
      </Link>
    );
  }
  if (now >= 19 * 60 && tomorrowSchool && profile.notif_bedtime !== false) {
    return (
      <Link to="/sommeil" className="pb-glass pb-li" style={{ marginTop: 14, borderRadius: 20 }}>
        <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--primary-bright)" }}><Icon name="timer" size="sm" /></div>
        <div className="t">Au lit à {clockOf(bed)}<small>Pour 9 h de sommeil avant ton réveil de {clockOf(profile.wake_school_min)}. Pose les écrans 30 min avant.</small></div>
        <Icon name="right" size="sm" className="pb-muted" />
      </Link>
    );
  }
  if (now >= 15 * 60) return null;

  if (logged && !open) {
    const n = sleepLogs.find((l) => l.date === t)!;
    return (
      <div className="pb-glass" style={{ marginTop: 14, padding: 12, display: "grid", gap: 8 }}>
        <div className="row between">
          <Link to="/sommeil" style={{ color: "inherit", textDecoration: "none" }}><b>Ta nuit : {hoursOf(duration(n))}</b></Link>
          {r.level ? <ReadyDot level={r.level} /> : null}
        </div>
        {!hrvToday && now < 12 * 60 ? <Link to="/test/fc-repos?court=1" className="pb-btn"><Icon name="heart" size="sm" />Mesurer ma VFC (3 min, allongé)</Link> : null}
        <button className="pb-link pb-subtle" style={{ fontSize: 13, justifySelf: "start" }} onClick={() => setOpen(true)}>Corriger ma nuit</button>
      </div>
    );
  }
  return (
    <section className="pb-glass" style={{ marginTop: 14, padding: 14, display: "grid", gap: 10 }} aria-label="Ta nuit">
      <div className="row between"><b>Comment as-tu dormi ?</b><Link to="/sommeil" className="pb-subtle" style={{ fontSize: 13 }}>Mon sommeil</Link></div>
      {!hrvToday && now < 12 * 60 ? (
        <Link to="/test/fc-repos?court=1" className="pb-btn"><Icon name="heart" size="sm" />{sessionToday ? "Avant de te lever : mesure ta VFC (3 min), ta séance s'y adapte" : "Avant de te lever : mesure ta VFC (3 min)"}</Link>
      ) : null}
      <SleepForm date={t} onSaved={() => setOpen(false)} />
    </section>
  );
}

export default function SleepScreen() {
  const { profile, sleepLogs, setProfile, reloadSleep, measurements } = useApp();
  const t = today();
  const [edit, setEdit] = useState<string | null>(null);
  const routine = useRoutine(t);
  const planned = plannedSleep(routine);
  const stats = useMemo(() => weekStats(sleepLogs, t), [sleepLogs, t]);
  const chrono = useMemo(() => chronotypeOf(sleepLogs, t), [sleepLogs, t]);
  const hrvPoints = useMemo(() => measurements.filter((m) => m.kind === "hrv").map((m) => ({ value: Number(m.value), measured_at: m.measured_at })), [measurements]);
  const hrv = useMemo(() => hrvStatus(hrvPoints, t), [hrvPoints, t]);
  const calib = useMemo(() => hrvCalibration(hrvPoints, t), [hrvPoints, t]);
  if (!profile) return null;
  const history = Array.from({ length: 14 }, (_, i) => addDays(t, -i));

  async function setWake(v: string) {
    const m = fromInput(v);
    if (!(m >= 300 && m <= 600)) return;
    setProfile({ ...profile!, wake_school_min: m });
    await updateProfile({ wake_school_min: m });
  }
  async function remove(date: string) {
    await supabase.from("sleep_logs").delete().eq("date", date);
    await reloadSleep();
  }

  return (
    <main className="pb-page screen">
      <div className="hdr"><BackButton to="/" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Sommeil</h1>
      <p className="lead">Dormir 9 h (8 à 10 h à ton âge) aide ta croissance et ton basket : sprint, adresse, réaction.</p>

      <div className="grid3" style={{ marginTop: 16 }}>
        <div className="pb-glass" style={{ padding: 12, textAlign: "center" }}><b className="pb-num" style={{ fontSize: 20 }}>{stats.avgMin != null ? hoursOf(stats.avgMin) : "—"}</b><br /><span className="pb-muted" style={{ fontSize: 12 }}>par nuit (7 j)</span></div>
        <div className="pb-glass" style={{ padding: 12, textAlign: "center" }}><b className="pb-num" style={{ fontSize: 20 }}>{stats.nights ? hoursOf(stats.debtMin) : "—"}</b><br /><span className="pb-muted" style={{ fontSize: 12 }}>de retard sur 9 h</span></div>
        <div className="pb-glass" style={{ padding: 12, textAlign: "center" }}><b className="pb-num" style={{ fontSize: 20 }}>{stats.wakeGapMin != null ? hoursOf(stats.wakeGapMin) : "—"}</b><br /><span className="pb-muted" style={{ fontSize: 12 }}>écart de lever</span></div>
      </div>
      {stats.wakeGapMin != null && stats.wakeGapMin > 120 ? <div style={{ marginTop: 10 }}><Notice>Tu te lèves {hoursOf(stats.wakeGapMin)} plus tard le week-end : c'est comme un décalage horaire chaque lundi. Essaie de garder moins de 2 h d'écart.</Notice></div> : null}

      <div className="lbl section">VFC du matin</div>
      <div className="pb-glass" style={{ padding: 14, display: "grid", gap: 8 }}>
        {hrv ? (
          <>
            <div className="row between"><span>Ce matin</span><b className="pb-num" style={{ fontSize: 20 }}>{hrv.today} ms</b></div>
            <div className="row between"><span>Moyenne des 7 derniers jours</span><b className="pb-num">{hrv.week} ms</b></div>
            <div className="row between"><span>Ta zone normale</span><b className="pb-num">{hrv.low} à {hrv.high} ms</b></div>
            <span className="pb-muted" style={{ fontSize: 14 }}>{hrv.drop ? "Forte baisse ce matin (fatigue, stress ou début de maladie) : séance allégée." : hrv.trendLow ? "En baisse depuis plusieurs jours : la fatigue s'installe, séance allégée." : "Dans ta zone normale."}</span>
          </>
        ) : (
          <span className="pb-muted" style={{ fontSize: 14 }}>{calib > 0 ? `Encore ${calib} matin${calib > 1 ? "s" : ""} de mesure pour connaître ta zone normale.` : "Pas encore de mesure ce matin."}</span>
        )}
        <span className="pb-subtle" style={{ fontSize: 12 }}>
          Ta zone normale, c'est ta moyenne des 30 derniers jours, à plus ou moins un demi-écart-type. Seule la tendance sur 7 jours, ou une forte baisse d'un coup, change ta séance : un matin un peu bas ne veut rien dire.
          Pour que ce soit fiable : mesure-toi chaque matin au réveil, allongé, dans la même position.
        </span>
        <Link to="/test/fc-repos?court=1" className="pb-btn"><Icon name="heart" size="sm" />Mesurer ma VFC (3 min)</Link>
      </div>

      {profile.chronotype_enabled !== false ? <>
      <div className="lbl section">Ton horloge biologique</div>
      <div className="pb-glass" style={{ padding: 14, display: "grid", gap: 6 }}>
        {chrono.type ? (
          <>
            <b style={{ fontSize: 18 }}>{CHRONO_LABEL[chrono.type]}</b>
            <span className="pb-muted" style={{ fontSize: 14 }}>Milieu de tes nuits les jours libres : {clockOf(chrono.msfsc)} (corrigé du sommeil rattrapé), sur {chrono.freeNights} nuits.</span>
            <span className="pb-subtle" style={{ fontSize: 13 }}>
              {chrono.type === "soir" ? "Ton programme place la détente et les tests en fin d'après-midi, et rien avant 10 h 30 le week-end."
                : chrono.type === "intermediaire" ? "Ton programme privilégie la fin d'après-midi pour la détente et les tests, et commence à 9 h 30 le week-end."
                : "Tu es efficace tôt : ton programme peut commencer dès 9 h le week-end."}
              {" "}À l'adolescence, l'horloge se décale vers le soir : c'est biologique.
            </span>
          </>
        ) : (
          <span className="pb-muted" style={{ fontSize: 14 }}>En cours de calcul : il faut 4 nuits de jours libres (sans réveil-matin) dans ton journal. Tu en as {chrono.freeNights}.</span>
        )}
        <button className="pb-link pb-subtle" style={{ fontSize: 13, justifySelf: "start" }} onClick={async () => { setProfile({ ...profile!, chronotype_enabled: false, chronotype: null }); await updateProfile({ chronotype_enabled: false, chronotype: null, chronotype_msf: null }); }}>Ne pas adapter mon programme à mon horloge</button>
      </div>
      </> : null}

      <div className="lbl section">Heure de coucher</div>
      <div className="pb-glass" style={{ padding: 14, display: "grid", gap: 10 }}>
        <label className="row between" style={{ gap: 10 }}>
          <span>Réveil les jours de cours</span>
          <input className="input pb-num" type="time" style={{ width: 120 }} defaultValue={toInput(profile.wake_school_min)} min="05:00" max="10:00" onBlur={(e) => setWake(e.target.value)} />
        </label>
        {routine?.bed != null ? (
          <>
            <span className="pb-muted" style={{ fontSize: 14 }}>
              Ce soir, ta routine NoteFlow te couche à <b>{clockOf(routine.bed)}</b>{planned != null ? <> : <b>{hoursOf(planned)}</b> de sommeil avant ton réveil de {clockOf(routine.nextWake!)}.</> : "."}
            </span>
            {planned != null && planned < SLEEP_TARGET ? <Notice>C'est {hoursOf(SLEEP_TARGET - planned)} de moins que les 9 h conseillées à ton âge. Augmente la durée de sommeil dans les réglages de ta routine NoteFlow : l'heure de coucher suivra.</Notice> : null}
          </>
        ) : (
          <span className="pb-muted" style={{ fontSize: 14 }}>Au lit à <b>{clockOf(bedtimeFor(profile.wake_school_min))}</b> : 9 h de sommeil et 15 min pour t'endormir.</span>
        )}
        <span className="pb-subtle" style={{ fontSize: 12 }}>Le rappel « mesure ta VFC » part à ton heure de lever prévue par ta routine NoteFlow. Sans routine ce jour-là, il part à ce réveil les jours de cours, et à ton lever habituel des jours sans réveil-matin.</span>
      </div>

      <div className="lbl section">Mes nuits</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {history.map((d) => {
          const l = sleepLogs.find((x) => x.date === d) as SleepLog | undefined;
          if (edit === d) return <div key={d} style={{ padding: 14 }}><b style={{ fontSize: 14 }}>{dayLabel(d)}</b><div style={{ marginTop: 8 }}><SleepForm date={d} onSaved={() => setEdit(null)} /></div></div>;
          return (
            <div key={d} className="pb-li">
              <div className="t">{dayLabel(d)}<small>{l ? `${clockOf(l.bed_min)} → ${clockOf(l.wake_min)} · ${hoursOf(duration(l))}${l.quality ? ` · ${l.quality}/5` : ""}${l.free_day ? " · sans réveil" : ""}` : "Pas notée"}</small></div>
              {l || d >= addDays(t, -2) ? <button className="pb-btn sm" onClick={() => setEdit(d)}>{l ? "Corriger" : "Noter"}</button> : null}
              {l ? <button className="pb-icon-btn sm" aria-label={`Supprimer la nuit du ${dayLabel(d)}`} onClick={() => remove(d)}><Icon name="trash" /></button> : null}
            </div>
          );
        })}
      </div>
      <BottomNav />
    </main>
  );
}

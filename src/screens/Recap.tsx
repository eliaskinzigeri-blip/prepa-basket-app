import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { BottomAction, Notice, Spinner, Stat } from "../components/ui";
import { supabase } from "../lib/supabase";
import { updateFeeling } from "../lib/data";
import { chrono, num } from "../lib/format";
import { useApp } from "../state/app";
import type { SessionRow } from "../lib/types";
import { ZONES, ageOf, hrAt, isJunior, zonePace, refFrom20Min, type ZoneId } from "../lib/rower/plans";
import { ZONE_LABELS, type HeartSummary } from "../lib/heart";

/** FC de la séance (ceinture cardio) : moyenne, maximum et temps passé dans chaque zone. */
function HeartRecap({ h }: { h: HeartSummary }) {
  const total = h.zones.reduce((a, b) => a + b, 0) || 1;
  const colors = ["var(--ink-muted)", "var(--success)", "var(--cat-basket)", "var(--heat)", "var(--danger)"];
  return (
    <>
      <div className="lbl section">Ton cœur pendant la séance</div>
      <div className="grid3"><Stat k="Moyenne" v={`${h.avg} bpm`} center /><Stat k="Max" v={`${h.max} bpm`} center /><Stat k="FC max estimée" v={`${h.hrMax}`} center /></div>
      <div className="pb-glass" style={{ padding: "12px 14px", marginTop: 10, display: "grid", gap: 8 }}>
        {h.zones.map((sec, i) => sec ? (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "118px 1fr 52px", gap: 8, alignItems: "center", fontSize: 13 }}>
            <span>{ZONE_LABELS[i]}</span>
            <span className="nu-bar" aria-hidden="true"><span style={{ width: `${(sec / total) * 100}%`, background: colors[i] }} /></span>
            <span className="pb-num pb-muted" style={{ textAlign: "right" }}>{Math.round(sec / 60)} min</span>
          </div>
        ) : null)}
      </div>
    </>
  );
}

interface Rec { key: string; label: string; value: number; old: number; unit?: string }

function RowerZones({ test, demo, age }: { test: { paceSec: number; distanceM: number; complete: boolean }; demo: boolean; age: number }) {
  const ref = refFrom20Min(test.paceSec);
  // Pas d'intensité maximale avant 16 ans : on ne l'affiche pas.
  const zones: ZoneId[] = isJunior(age) ? ["ut2", "ut1", "seuil"] : ["ut2", "ut1", "seuil", "intense"];
  return (
    <>
      <div className="lbl section">Tes zones au rameur</div>
      {!test.complete ? <Notice>Test arrêté avant la fin : tes allures ne changent pas. Refais-le sur les 20 minutes.</Notice> : null}
      <p className="pb-muted pb-num" style={{ margin: "8px 2px" }}>{chrono(Math.round(test.paceSec))} /500 m sur {num(test.distanceM)} m.{test.complete && !demo ? " Tes prochaines séances utilisent ces allures." : ""}</p>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {zones.map((z) => (
          <div key={z} className="pb-li">
            <div className="t">{ZONES[z].short} · {ZONES[z].name}<small>{ZONES[z].talk} · {hrAt(ZONES[z].hr[0], age)}–{hrAt(ZONES[z].hr[1], age)} bpm</small></div>
            <b className="pb-num">{zonePace(z, ref).map((v) => chrono(v)).join("–")}</b>
          </div>
        ))}
      </div>
      <p className="pb-subtle" style={{ fontSize: 13, margin: "8px 2px 0" }}>Ce test ne remplace pas le test navette, qui reste la mesure de ton cardio. Les chiffres viennent de la machine : compare-les entre tes séances, pas avec un autre rameur.</p>
    </>
  );
}

export default function Recap() {
  const { sessionId } = useParams();
  const loc = useLocation() as { state?: { session?: SessionRow; queued?: boolean } };
  const nav = useNavigate();
  const { events, reloadEvents, profile } = useApp();
  const [s, setS] = useState<SessionRow | null>(loc.state?.session ?? null);
  const [feeling, setFeeling] = useState<number | null>(null);

  useEffect(() => {
    reloadEvents();
    if (s) return;
    supabase.from("sessions").select("*").eq("id", sessionId!).maybeSingle().then(({ data }) => setS(data as SessionRow));
  }, [sessionId, s, reloadEvents]);

  if (!s) return <main className="pb-page screen no-nav"><Spinner /></main>;
  const r = s.results ?? {};
  const records: Rec[] = r.records ?? [];
  const mins = Math.round((s.duration_s ?? 0) / 60);
  const rower = Boolean(r.rower);
  const stats: [string, string][] =
    rower ? [["Distance", `${num(r.distanceM ?? 0)} m`], ["Allure moy.", r.avgPaceSec ? chrono(r.avgPaceSec) : "—"], ["Cœur moy.", r.hrAvg ? `${r.hrAvg} bpm` : "—"]]
    : s.kind === "workout" ? [["Séries", r.plannedSets ? `${r.sets ?? 0}/${r.plannedSets}` : String(r.sets ?? 0)], ["Exos", String(r.exercises ?? 0)], ["Volume", `${num(r.volume ?? 0)} kg`]]
    : s.kind === "shoot" ? [["Tirs", `${r.made ?? 0}/${r.attempts ?? 0}`], ["Réussite", `${num(r.pct ?? 0)} %`], ["Angle moy.", `${num(r.avgAngle ?? 0)}°`]]
    : s.kind === "dribble" ? [["Score", num(r.score ?? 0)], ["Dribbles", num(r.dribbles ?? 0)], ["Cibles", `${r.hits ?? 0}/${r.targets ?? 0}`]]
    : [["Meilleur", `${num(r.best ?? 0, r.digits ?? 0)} ${r.unit ?? ""}`], ["Essais", String(r.trials?.length ?? 0)], ["Test", r.testName ?? ""]];

  function pick(n: number) {
    setFeeling(n);
    updateFeeling(s!.id, n).catch(() => undefined);
    // le ressenti règle aussi la vitesse de progression (facile : on monte plus vite ; très dur : plus lentement)
    const ev = events.find((e) => e.id === s!.event_id);
    if (ev && s!.kind === "workout" && !s!.results?.rower) supabase.from("events").update({ payload: { ...ev.payload, feel: n } }).eq("id", ev.id).then(() => reloadEvents());
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 140 }}>
      <div style={{ display: "grid", justifyItems: "center", textAlign: "center", marginTop: 20 }}>
        <div style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", background: r.partial ? "var(--heat)" : "var(--success)", color: "var(--bg-950)" }}>
          <Icon name={r.partial ? "pause" : "check"} size="lg" style={{ strokeWidth: 2.6 }} />
        </div>
        <h1 className="t" style={{ margin: "16px 0 4px" }}>{s.kind === "test" ? "Test terminé" : r.partial ? "Séance partiellement faite" : "Séance terminée"}</h1>
        <p className="lead">{s.title} · {mins ? `${mins} min` : chrono(s.duration_s ?? 0)}</p>
      </div>
      {loc.state?.queued ? <div style={{ marginTop: 14 }}><Notice>Hors ligne : tes résultats sont gardés sur le téléphone et seront synchronisés au retour du réseau.</Notice></div> : null}
      <div className="grid3" style={{ marginTop: 22 }}>{stats.map(([k, v]) => <Stat key={k} k={k} v={v} center />)}</div>

      {r.heart ? <HeartRecap h={r.heart as HeartSummary} /> : null}

      {s.kind === "shoot" ? <Link to={`/shoot/${s.id}`} className="pb-btn lg block" style={{ marginTop: 12 }}><Icon name="target" size="sm" />Voir l'analyse du shoot</Link> : null}

      {rower && r.demo ? <div style={{ marginTop: 14 }}><Notice>Rameur simulé : ces chiffres sont des exemples, ils ne sont pas enregistrés.</Notice></div> : null}
      {rower && r.inTargetPct != null ? <p className="pb-muted" style={{ margin: "12px 2px 0" }}>{r.inTargetPct} % du temps dans la cible.</p> : null}
      {rower && r.test ? <RowerZones test={r.test} demo={Boolean(r.demo)} age={ageOf(profile)} /> : null}

      <div className="lbl section">Records battus</div>
      {records.length ? (
        <div className="pb-glass" style={{ padding: "4px 0" }}>
          {records.map((x) => (
            <div key={x.key} className="pb-li">
              <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--heat)" }}><Icon name="trophy" /></div>
              <div className="t">{x.label}<small>Ancien : {num(x.old, x.old % 1 ? 1 : 0)}{x.unit ? ` ${x.unit}` : ""}</small></div>
              <b className="pb-num" style={{ fontSize: 20 }}>{num(x.value, x.value % 1 ? 1 : 0)}</b>
            </div>
          ))}
        </div>
      ) : <p className="pb-muted" style={{ margin: 0 }}>Pas de record cette fois. Chaque séance compte.</p>}

      <div className="lbl section">Ton ressenti</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }} role="radiogroup" aria-label="Ressenti de 1 (très dur) à 5 (facile)">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={feeling === n} className={`pb-btn${feeling === n ? " primary" : ""}`} style={{ padding: 0, height: 56, fontSize: 18 }} onClick={() => pick(n)}>{n}</button>
        ))}
      </div>
      <div className="row between" style={{ marginTop: 6, fontSize: 12 }}><span className="pb-subtle">Très dur</span><span className="pb-subtle">Facile</span></div>
      {s.kind === "workout" && !rower ? <p className="pb-subtle" style={{ margin: "8px 0 0", fontSize: 12 }}>Si c'était facile, tes séances deviendront plus dures plus vite ; si c'était très dur, elles monteront plus doucement.</p> : null}
      <BottomAction><button className="pb-btn primary lg block" onClick={() => nav("/", { replace: true })}>Terminer</button></BottomAction>
    </main>
  );
}

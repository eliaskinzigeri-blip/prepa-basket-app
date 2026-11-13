import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, latest } from "../state/app";
import { Icon } from "../components/Icon";
import { LineChart } from "../components/LineChart";
import { BottomNav, Chip, Delta } from "../components/ui";
import { supabase } from "../lib/supabase";
import { addDays, mondayOf, num, today } from "../lib/format";
import { skill, TESTS } from "../data/catalog";
import { INDICATORS, isoWeek, series, SKILL_INDICATOR, weekly } from "../lib/indicators";
import type { SessionRow } from "../lib/types";
import { hasRower } from "../lib/rower/plans";

type Period = "4w" | "3m" | "all";
// Séances gardées entre deux visites de l'onglet : pas de graphique vide le temps de la requête.
let cached: SessionRow[] = [];

export default function Progress() {
  const { profile, events, measurements, sleepLogs } = useApp();
  const [period, setPeriod] = useState<Period>("4w");
  const [sessions, setSessions] = useState<SessionRow[]>(cached);
  const t = today();
  const from = period === "4w" ? addDays(mondayOf(t), -21) : period === "3m" ? addDays(mondayOf(t), -84) : (profile?.onboarded_at?.slice(0, 10) ?? addDays(t, -84));

  useEffect(() => {
    supabase.from("sessions").select("id,kind,title,started_at,duration_s,results,event_id,feeling").gte("started_at", addDays(mondayOf(t), -400)).order("started_at")
      .then(({ data }) => { if (data) { cached = data as SessionRow[]; setSessions(cached); } });
  }, [t]);

  // La charge soulevée est un indicateur calculé à partir des séances workout.
  const allSeries = useMemo(() => {
    const vol = sessions.filter((s) => s.kind === "workout" && !s.results?.rower).map((s) => ({ value: Number(s.results?.volume ?? 0), at: s.started_at.slice(0, 10) }));
    const sleep = sleepLogs.map((l) => ({ value: (l.wake_min - l.bed_min) / 60, at: l.date }));
    return (kind: string) => (kind === "volume" ? vol : kind === "sleep" ? sleep : series(measurements, kind));
  }, [sessions, measurements, sleepLogs]);

  // une priorité sans indicateur connu est ignorée plutôt que de faire planter l'écran
  const priorities = (profile?.priorities_high ?? []).flatMap((s) => { const sk = skill(s), ind = INDICATORS[SKILL_INDICATOR[s]]; return sk && ind ? [{ skill: sk, ind }] : []; });
  const choices = [...new Set([...priorities.map((p) => p.ind.kind), "shoot_pct", "weight", "volume", "vertical", "sprint10", "rhr", "hrv", "sleep", ...(hasRower(profile) ? ["rower_pace20"] : [])])];
  const [chart, setChart] = useState<string>(choices[0]);
  const ind = INDICATORS[chart];
  const points = weekly(allSeries(chart), from, t).map((p) => ({ label: `S${isoWeek(p.week)}`, value: p.value }));

  // Bilan de la semaine
  const mon = mondayOf(t);
  const week = (d0: string) => {
    const d1 = addDays(d0, 7);
    const planned = events.filter((e) => e.date >= d0 && e.date < d1 && ["workout", "basket", "test"].includes(e.type) && e.date <= t);
    // une séance partiellement faite compte pour moitié
    const done = planned.reduce((n, e) => n + (e.status !== "done" ? 0 : e.payload.partial ? 0.5 : 1), 0);
    const s = sessions.filter((x) => x.started_at.slice(0, 10) >= d0 && x.started_at.slice(0, 10) < d1);
    const vol = s.filter((x) => x.kind === "workout").reduce((n, x) => n + Number(x.results?.volume ?? 0), 0);
    const shots = s.filter((x) => x.kind === "shoot");
    const att = shots.reduce((n, x) => n + Number(x.results?.attempts ?? 0), 0);
    const made = shots.reduce((n, x) => n + Number(x.results?.made ?? 0), 0);
    const rows = s.filter((x) => x.results?.rower && !x.results?.demo);
    return { done, planned: planned.length, vol, pct: att ? (made / att) * 100 : null, sessions: s.length, rowMin: Math.round(rows.reduce((n, x) => n + Number(x.results?.rowingSec ?? 0), 0) / 60) };
  };
  const cur = week(mon), prev = week(addDays(mon, -7));
  const weight = latest(measurements, "weight");

  return (
    <main className="pb-page screen">
      <div className="hdr" style={{ marginTop: 4 }}>
        <h1 className="t">Progrès</h1><span className="sp" />
        <Link to="/mesures" className="pb-icon-btn" aria-label="Mesures corporelles"><Icon name="scale" /></Link>
      </div>
      <div className="pb-chips" style={{ margin: "14px 0" }}>
        <Chip active={period === "4w"} onClick={() => setPeriod("4w")}>4 semaines</Chip>
        <Chip active={period === "3m"} onClick={() => setPeriod("3m")}>3 mois</Chip>
        <Chip active={period === "all"} onClick={() => setPeriod("all")}>Depuis le début</Chip>
      </div>

      <div className="lbl" style={{ marginBottom: 10 }}>Tes priorités fortes</div>
      <div className="grid2">
        {priorities.map(({ skill: s, ind: i }) => {
          const list = allSeries(i.kind).filter((x) => x.at >= from).sort((a, b) => a.at.localeCompare(b.at));
          const v = i.kind === "volume" ? list.reduce((n, x) => n + x.value, 0) : list.at(-1)?.value ?? null;
          const first = i.kind === "volume" ? null : list[0]?.value ?? null;
          return (
            <button key={s.id} className="pb-glass pb-stat" style={{ borderColor: "rgba(140,123,255,.45)", textAlign: "left", color: "inherit" }} onClick={() => setChart(i.kind)} aria-pressed={chart === i.kind}>
              <span className="k">{s.label}</span>
              <span className="v">{v != null ? num(v, i.digits) : "—"}<small>{i.unit}</small></span>
              {v != null && first != null && list.length > 1 ? <span style={{ justifySelf: "start" }}><Delta diff={v - first} better={i.better} digits={i.digits} unit={i.unit === "%" ? "pts" : ""} /></span>
                : <span className="pb-subtle" style={{ fontSize: 12 }}>{list.length ? i.kind === "volume" ? "sur la période" : "1 mesure" : "à mesurer"}</span>}
            </button>
          );
        })}
      </div>

      <div className="pb-glass" style={{ marginTop: 12, padding: 14 }}>
        <div className="row between"><h3 className="s" style={{ fontSize: 16 }}>{ind.label}</h3><span className="pill-sm">Hebdo</span></div>
        <LineChart points={points} unit={ind.unit} digits={ind.digits} ariaLabel={`Évolution : ${ind.label}`} />
        <div className="pb-chips" style={{ marginTop: 10 }}>
          {choices.map((k) => <button key={k} type="button" className={`pb-chip${k === chart ? " active" : ""}`} style={{ height: 34, fontSize: 13 }} onClick={() => setChart(k)} aria-pressed={k === chart}>{INDICATORS[k].label}</button>)}
        </div>
      </div>

      <div className="lbl section">Bilan de la semaine</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <div className="pb-li"><div className="t">Séances faites<small>prévues jusqu'à aujourd'hui</small></div><b className="pb-num">{num(cur.done, cur.done % 1 ? 1 : 0)}/{cur.planned}</b><Delta diff={cur.done - prev.done} /></div>
        <div className="pb-li"><div className="t">Volume soulevé</div><b className="pb-num">{num(cur.vol)} kg</b><Delta diff={prev.vol ? cur.vol - prev.vol : null} /></div>
        {hasRower(profile) ? <div className="pb-li"><div className="t">Rameur</div><b className="pb-num">{cur.rowMin} min</b><Delta diff={cur.rowMin - prev.rowMin} /></div> : null}
        <Link to="/shoot/historique" className="pb-li" style={{ color: "inherit", textDecoration: "none" }}><div className="t">% au shoot<small>Analyses et replays de tes sessions</small></div><b className="pb-num">{cur.pct != null ? `${num(cur.pct)} %` : "—"}</b><Delta diff={cur.pct != null && prev.pct != null ? cur.pct - prev.pct : null} unit="pts" /><Icon name="right" size="sm" className="pb-muted" /></Link>
        <div className="pb-li"><div className="t">Poids{weight.source === "trackfit" ? " (TrackFit)" : ""}</div><b className="pb-num">{weight.value != null ? `${num(weight.value, 1)} kg` : "—"}</b><Delta diff={weight.value != null && weight.prev != null ? weight.value - weight.prev : null} digits={1} /></div>
      </div>

      <div className="lbl section">Bilan du mois · tests</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {TESTS.map((x) => {
          const l = latest(measurements, x.id);
          return (
            <div key={x.id} className="pb-li">
              <div className="t">{x.name}</div>
              <b className="pb-num">{l.value != null ? `${num(l.value, x.digits)} ${x.unit}` : "—"}</b>
              <Delta diff={l.value != null && l.prev != null ? l.value - l.prev : null} better={x.better} digits={x.digits} />
            </div>
          );
        })}
        <Link to="/tests" className="pb-li"><Icon name="bolt" className="pb-muted" /><div className="t">Passer les tests maintenant</div><Icon name="right" size="sm" className="pb-muted" /></Link>
      </div>
      <BottomNav />
    </main>
  );
}

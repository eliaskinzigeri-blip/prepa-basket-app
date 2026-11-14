import { samePath, useActiveWorkout } from "../lib/activeWorkout";
import { useLight, useReadiness } from "../state/readiness";
import { ReadyDot } from "../components/Readiness";
import { VfcCard } from "./Sleep";
import { STAGE_LABEL, levelIndex } from "../lib/progression";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, latest, useProgression } from "../state/app";
import { Icon } from "../components/Icon";
import { BottomNav, Delta, IconButton, Notice, Sheet, Stat } from "../components/ui";
import { supabase } from "../lib/supabase";
import { addDays, dayLabel, DAYS_SHORT, mondayOf, nowMin, num, parse, range, today, weekday } from "../lib/format";
import { GAMES, TEMPLATES, test as testDef } from "../data/catalog";
import { exercisesFor } from "../lib/exercises";
import { isPartial, PLACE_LABEL, startPath } from "../lib/nav";
import { WARMUP_MIN } from "../lib/program";
import { forecast, goalTitle, monthsLabel, testsFor } from "../lib/goals";
import type { CalEvent } from "../lib/types";

const SESSION_TYPES = new Set(["workout", "basket", "test"]);

export function Home() {
  const { profile, events, measurements, error, syncing } = useApp();
  const nav = useNavigate();
  const [sessionDays, setSessionDays] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const [notifAsked, setNotifAsked] = useState(typeof Notification === "undefined" || Notification.permission !== "default");
  const t = today();

  useEffect(() => {
    supabase.from("sessions").select("started_at").gte("started_at", addDays(t, -90)).then(({ data }) => {
      setSessionDays(new Set((data ?? []).map((s) => s.started_at.slice(0, 10))));
    });
  }, [t]);

  // Séance du jour : la prochaine séance prévue aujourd'hui, sinon la prochaine à venir.
  const hero = useMemo(() => {
    const upcoming = events.filter((e) => SESSION_TYPES.has(e.type) && e.status === "planned" && e.date >= t)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.start_min ?? 0) - (b.start_min ?? 0));
    return upcoming.find((e) => e.date === t && (e.end_min ?? 1440) > nowMin()) ?? upcoming.find((e) => e.date === t) ?? upcoming[0] ?? null;
  }, [events, t]);
  const nextMatch = events.filter((e) => e.type === "match" && e.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];

  // Série de jours actifs : jour avec une séance faite, ou repos prévu ; aujourd'hui ne casse pas la série.
  const streak = useMemo(() => {
    const active = (d: string) => sessionDays.has(d) || events.some((e) => e.date === d && (e.status === "done" || e.type === "rest"));
    let n = 0;
    let d = active(t) ? t : addDays(t, -1);
    while (active(d) && n < 365) { n++; d = addDays(d, -1); }
    return n;
  }, [events, sessionDays, t]);

  const weight = latest(measurements, "weight");
  const lastTest = measurements.filter((m) => ["vertical", "broad", "sprint10", "sprint20", "agility"].includes(m.kind)).sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0];
  const testInfo = lastTest ? testDef(lastTest.kind) : null;
  const testPrev = lastTest ? latest(measurements, lastTest.kind).prev : null;
  const mon = mondayOf(t);
  const shootWeek = avg(measurements.filter((m) => m.kind === "shoot_pct" && m.measured_at.slice(0, 10) >= mon).map((m) => m.value));
  const shootPrev = avg(measurements.filter((m) => m.kind === "shoot_pct" && m.measured_at.slice(0, 10) >= addDays(mon, -7) && m.measured_at.slice(0, 10) < mon).map((m) => m.value));

  if (!profile) return null;
  return (
    <main className="pb-page screen">
      <div className="hdr" style={{ marginTop: 4 }}>
        <Link to="/profil" className="pb-greet" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="pb-avatar">{(profile.first_name ?? "?")[0]?.toUpperCase()}</div>
          <div><small>Salut</small><b>{profile.first_name}</b></div>
        </Link>
        <span className="sp" />
        <Link to="/progres" className="pb-icon-btn" aria-label={`Série de ${streak} jours actifs`} style={{ color: streak ? "var(--cat-basket)" : "var(--ink)" }}><Icon name="flame" /></Link>
        <IconButton icon="bell" label={notifAsked ? "Rappels activés" : "Activer les rappels de séance"} dot={!notifAsked}
          onClick={() => { if (typeof Notification !== "undefined") Notification.requestPermission().then(() => setNotifAsked(true)); }} />
      </div>

      {syncing ? <div style={{ marginTop: 12 }}><Notice>{syncing}</Notice></div> : null}
      {error ? <div style={{ marginTop: 12 }}><Notice tone="error">{error}</Notice></div> : null}

      <div className="grid2" style={{ marginTop: 18 }}>
        <QuickTile icon="ball" title="Jeu de dribble" sub="Lancer" onClick={() => setPicker(true)} />
        {profile.has_hoop ? <QuickTile icon="hoop" title="Session shoot" sub="Panier maison" onClick={() => nav("/shoot")} />
          : <QuickTile icon="hoop" title="Session shoot" sub="Sur un terrain" onClick={() => nav("/shoot")} />}
      </div>
      <Link to="/shoot/historique" className="pb-btn block" style={{ marginTop: 10 }}><Icon name="play" size="sm" />Mes sessions de shoot : analyses et replays</Link>
      <Link to="/pesee" className="pb-btn block" style={{ marginTop: 10 }}><Icon name="scale" size="sm" />Me peser avec ma balance</Link>

      <VfcCard />

      {hero ? <HeroCard e={hero} onStart={() => nav(startPath(hero))} /> : (
        <div className="pb-glass hero empty" style={{ marginTop: 14 }}>
          <Icon name="cal" size="lg" className="pb-muted" />
          <b>Aucune séance prévue</b>
          <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Ton programme se régénère depuis le Profil.</p>
        </div>
      )}

      <GoalsCard />

      <div className="row between" style={{ margin: "18px 2px 10px" }}>
        <h3 className="s">Chiffres clés</h3>
        <span className="pill-sm" style={{ color: "var(--cat-basket)" }}><Icon name="flame" size="sm" style={{ width: 14, height: 14 }} />{streak} jour{streak > 1 ? "s" : ""}</span>
      </div>
      <div className="grid3">
        <Link to="/mesures" style={{ color: "inherit", textDecoration: "none" }}>
          <Stat k="Poids" v={num(weight.value ?? profile.weight_kg, 1)} unit="kg" delta={<Delta diff={weight.prev != null && weight.value != null ? weight.value - weight.prev : null} digits={1} better="higher" />} style={{ height: "100%" }} />
        </Link>
        <Stat k={testInfo ? testInfo.name.split(" ")[0] : "Dernier test"} v={lastTest ? num(lastTest.value, testInfo?.digits ?? 0) : "—"} unit={testInfo?.unit}
          delta={<Delta diff={lastTest && testPrev != null ? lastTest.value - testPrev : null} digits={testInfo?.digits ?? 0} better={testInfo?.better} />} />
        <Stat k="Shoot sem." v={shootWeek != null ? num(shootWeek) : "—"} unit={shootWeek != null ? "%" : undefined}
          delta={<Delta diff={shootWeek != null && shootPrev != null ? shootWeek - shootPrev : null} />} />
      </div>

      {nextMatch ? (
        <Link to={`/evenement/${nextMatch.id}`} className="pb-glass" style={{ marginTop: 12, padding: 8, display: "block", color: "inherit", textDecoration: "none" }}>
          <div className="pb-row" style={{ padding: 0 }}>
            <div className="pb-tile" style={{ background: "var(--cat-match)", color: "var(--bg-950)", border: 0, fontWeight: 700 }}>
              <span style={{ fontSize: 11 }}>{DAYS_SHORT[weekday(nextMatch.date)].toUpperCase()}</span>
              <b className="pb-num" style={{ fontSize: 18, color: "var(--bg-950)" }}>{parse(nextMatch.date).getDate()}</b>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}><h4>{nextMatch.title}</h4><p>{range(nextMatch.start_min, null)} · {nextMatch.payload.home ? "Domicile" : "Extérieur"}{nextMatch.payload.team ? ` · ${nextMatch.payload.team.split(" · ")[0]}` : ""}</p></div>
            <Icon name="right" className="pb-muted" style={{ marginRight: 8 }} />
          </div>
        </Link>
      ) : null}

      {picker ? (
        <Sheet title="Jeu de dribble" onClose={() => setPicker(false)}>
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            {GAMES.filter((g) => g.mode === "dribble").map((g) => (
              <button key={g.id} className="pb-li" onClick={() => nav(`/dribble/${g.id}`)}>
                <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--cat-basket)" }}><Icon name="target" size="sm" /></div>
                <div className="t">{g.name}<small>{g.desc}</small></div>
                <Icon name="right" size="sm" className="pb-muted" />
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
      <BottomNav />
    </main>
  );
}

function avg(list: number[]) {
  return list.length ? list.reduce((a, b) => a + Number(b), 0) / list.length : null;
}

function QuickTile({ icon, title, sub, onClick }: { icon: "ball" | "hoop"; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="pb-glass" style={{ padding: 8, borderRadius: 20, textAlign: "left", color: "inherit" }} onClick={onClick}>
      <div className="pb-row" style={{ padding: 0 }}>
        <div className="pb-tile" style={{ width: 48, height: 48, color: "var(--cat-basket)" }}><Icon name={icon} /></div>
        <div><h4 style={{ fontSize: 15 }}>{title}</h4><p>{sub}</p></div>
      </div>
    </button>
  );
}

function HeroCard({ e, onStart }: { e: CalEvent; onStart: () => void }) {
  const { profile, goals, session } = useApp();
  const active = useActiveWorkout(session?.user.id);
  const running = active && samePath(active, `/seance/${e.id}`);
  const prog = useProgression();
  const light = useLight(e);
  const ready = useReadiness(e.date);
  const t = today();
  const minutes = (e.end_min ?? 0) - (e.start_min ?? 0);
  let stats: [string, string][] = [];
  let count = "";
  if (e.type === "workout") {
    const list = exercisesFor(e.payload.template ?? "haut", e.location, profile!, minutes - WARMUP_MIN, e.id, { ...prog, deload: e.payload.deload || light });
    stats = [["EXOS", String(list.length)], ["SÉRIES", String(list.reduce((n, x) => n + x.sets, 0))], ["DURÉE", `${minutes} min`]];
    count = `${TEMPLATES[e.payload.template ?? ""]?.title ?? "Workout"} · niveau ${STAGE_LABEL[prog.stage].toLowerCase()} ${levelIndex(prog)}/12${prog.lestKg ? ` · lest ${String(prog.lestKg).replace(".", ",")} kg` : ""}`;
  } else if (e.type === "basket") {
    const games = e.payload.games ?? [];
    stats = e.payload.mode === "shoot" ? [["TIRS", "50"], ["OBJ.", "45 %"], ["DURÉE", `${minutes} min`]] : [["JEUX", String(games.length)], ["CIBLES", "~60"], ["DURÉE", `${minutes} min`]];
    count = `${games.length} jeux`;
  } else {
    const tests = testsFor(goals);
    stats = [["TESTS", String(tests.length || 5)], ["ESSAIS", "3 / test"], ["DURÉE", `${minutes} min`]];
    count = tests.length ? tests.map((x) => x.label).join(", ") : "Sprint, détente, agilité";
  }
  const when = e.date === t ? "Séance du jour" : `Prochaine séance · ${dayLabel(e.date)}`;
  const color = e.type === "workout" ? "122,99,255" : e.type === "basket" ? "255,138,61" : "140,123,255";
  return (
    <div className="pb-glass hero" style={{ marginTop: 14, padding: 6, overflow: "hidden" }}>
      <div style={{ height: 140, borderRadius: 24, position: "relative", overflow: "hidden", background: `radial-gradient(60% 80% at 75% 30%, rgba(${color},.55), transparent 60%), radial-gradient(50% 70% at 20% 90%, rgba(91,60,255,.6), transparent 70%), #101b45` }}>
        <svg viewBox="0 0 200 120" style={{ position: "absolute", right: -6, top: 4, width: 170, opacity: 0.9 }} aria-hidden="true">
          {e.type === "basket" ? (
            <g fill="none" stroke="#ff8a3d" strokeWidth="3"><circle cx="130" cy="58" r="46" /><path d="M84 58h92M130 12v92M98 26c18 18 18 46 0 64M162 26c-18 18-18 46 0 64" /></g>
          ) : (
            <g fill="none" stroke="#8c7bff" strokeWidth="4" strokeLinecap="round"><path d="M96 30v56M80 42v32M164 30v56M180 42v32M96 58h68" /></g>
          )}
        </svg>
        <div style={{ position: "absolute", left: 14, top: 14 }} className="pill-sm"><span className="sw" style={{ background: e.type === "basket" ? "var(--cat-basket)" : "var(--cat-workout)", borderRadius: "50%" }} />{when}</div>
        <div style={{ position: "absolute", left: 16, bottom: 14, right: 16 }}>
          <div className="pb-num" style={{ fontSize: 24, fontWeight: 700, lineHeight: "28px" }}>{e.title}</div>
          <div className="pb-muted" style={{ fontSize: 13, marginTop: 2 }}>{PLACE_LABEL[e.location ?? ""] ?? "—"} · {range(e.start_min, e.end_min)} · {count}</div>
        </div>
      </div>
      <div style={{ padding: "14px 12px 8px" }}>
        <div className="pb-statline">{stats.map(([k, v]) => <span key={k}><em>{k}</em>{v}</span>)}</div>
        <div className="pb-heat" style={{ margin: "12px 0 6px" }}><span style={{ width: e.status === "done" ? (isPartial(e) ? "50%" : "100%") : "0%" }} /></div>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="pb-muted" style={{ fontSize: 12 }}>Échauffement inclus{light ? " · séance allégée (forme du matin)" : ""}</span>
          {e.date === t && ready.level && SESSION_TYPES.has(e.type) ? <Link to={`/evenement/${e.id}`} aria-label="Forme du jour"><ReadyDot level={ready.level} /></Link> : null}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {e.type === "workout" ? <Link to={`/evenement/${e.id}`} className="pb-btn" style={{ flex: 1 }}>Voir les exos</Link> : null}
          <button className="pb-btn primary" style={{ flex: 1 }} onClick={onStart}><Icon name="play" size="sm" />{running ? "Reprendre" : "Commencer"}</button>
        </div>
      </div>
    </div>
  );
}

/** Objectifs : délai estimé des deux premiers, ou invitation à en fixer. */
function GoalsCard() {
  const { goals, measurements, profile } = useApp();
  if (!profile) return null;
  if (!goals.length) {
    return (
      <Link to="/objectifs" className="pb-glass pb-li" style={{ marginTop: 14, borderRadius: 20 }}>
        <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--primary-bright)" }}><Icon name="target" size="sm" /></div>
        <div className="t">Fixe tes objectifs<small>Dunker, 40 % à 3 points, un bon cardio… et en combien de temps</small></div>
        <Icon name="right" size="sm" className="pb-muted" />
      </Link>
    );
  }
  return (
    <Link to="/objectifs" className="pb-glass" style={{ marginTop: 14, padding: "4px 0", display: "block", color: "inherit", textDecoration: "none" }} aria-label="Mes objectifs">
      {goals.slice(0, 2).map((g) => {
        const f = forecast(g, measurements, profile);
        return (
          <div key={g.id} className="pb-li">
            <div className="pb-tile" style={{ width: 40, height: 40, color: f.reached ? "var(--success)" : "var(--primary-bright)" }}><Icon name={f.reached ? "check" : "target"} size="sm" /></div>
            <div className="t">{goalTitle(g)}<small>{f.reached ? "Atteint" : f.months == null ? "Test de départ à passer" : monthsLabel(f.months)}</small></div>
          </div>
        );
      })}
      <div className="pb-li" style={{ minHeight: 44 }}><div className="t" style={{ color: "var(--primary-bright)", fontSize: 14 }}>{goals.length > 2 ? `Voir les ${goals.length} objectifs` : "Voir mes objectifs"}</div><Icon name="right" size="sm" className="pb-muted" /></div>
    </Link>
  );
}

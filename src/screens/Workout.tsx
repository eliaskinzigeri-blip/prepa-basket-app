import { levelIndex } from "../lib/progression";
import { useLight } from "../state/readiness";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApp, useProgression } from "../state/app";
import { Icon } from "../components/Icon";
import { ExerciseAnim } from "../components/ExerciseAnim";
import { BottomAction, IconButton, Notice, Sheet, Stepper } from "../components/ui";
import { alternatives, canLest, exercisesFor, NO_LOAD_GEAR, oneRm, sideHint } from "../lib/exercises";
import { checkRecords, saveSession } from "../lib/data";
import { supabase } from "../lib/supabase";
import { chrono, num } from "../lib/format";
import { TEMPLATES } from "../data/catalog";
import { PLACE_LABEL } from "../lib/nav";
import type { Exercise } from "../lib/types";
import { markWarmed } from "./camera/common";
import { clearActiveWorkout, getActiveWorkout, samePath, saveActiveWorkout, useActiveWorkout, useRestLeft, type SetLog } from "../lib/activeWorkout";

const WARMUP = ["2 min de footing léger ou corde", "Montées de genoux et talons-fesses, 2 × 20 s", "Fentes avec rotation, 8 par côté", "Mobilité chevilles et hanches, 1 min", "3 accélérations progressives"];

// key : passer d'une séance à une autre repart bien de l'état de la nouvelle.
export default function Workout() {
  const { id } = useParams();
  return <WorkoutScreen key={id} />;
}

function WorkoutScreen() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const { events, profile, session: auth } = useApp();
  const prog = useProgression();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const userId = auth?.user.id ?? "";
  // Séance déjà commencée sur cet écran : on reprend exactement où elle en était.
  const [saved] = useState(() => { const a = getActiveWorkout(); return a && a.userId === userId && samePath(a, pathname) ? a : null; });
  const active = useActiveWorkout(userId);
  const other = active && !samePath(active, pathname) ? active : null;
  const event = events.find((e) => e.id === id) ?? null;
  const template = saved?.template ?? event?.payload.template ?? qs.get("template") ?? "haut";
  const location = saved?.location ?? event?.location ?? qs.get("lieu") ?? "maison";
  const minutes = event ? (event.end_min ?? 0) - (event.start_min ?? 0) - 15 : profile!.session_minutes;
  // Forme du matin : séance allégée si nuit courte ou VFC basse (même effet qu'une semaine allégée)
  const light = useLight(event);
  const [list, setList] = useState<Exercise[]>(() => saved?.list ?? exercisesFor(template, location, profile!, minutes, event?.id ?? "", { ...prog, deload: event?.payload.deload || light }));
  // Échauffement déjà fait au rameur : on passe directement aux exercices.
  const [warm, setWarm] = useState(Boolean(saved) || qs.get("echauffe") === "rameur");
  const [checked, setChecked] = useState<boolean[]>(WARMUP.map(() => false));
  const [idx, setIdx] = useState(saved?.idx ?? 0);
  const [setNo, setSetNo] = useState(saved?.setNo ?? 1);
  const [load, setLoad] = useState(saved?.load ?? 0);
  const [reps, setReps] = useState(saved?.reps ?? list[0]?.reps ?? list[0]?.seconds ?? 10);
  const [logs, setLogs] = useState<SetLog[]>(saved?.logs ?? []);
  // Repos : heure de fin (il continue de passer quand l'app est fermée) ; en pause, le temps restant est figé.
  const [restEnd, setRestEnd] = useState<number | null>(saved?.restEnd ?? null);
  const [restTotal, setRestTotal] = useState(saved?.restTotal ?? 60);
  const [paused, setPaused] = useState(saved?.paused ?? false);
  const [pausedLeft, setPausedLeft] = useState<number | null>(saved?.pausedLeft ?? null);
  const rest = useRestLeft(restEnd, pausedLeft);
  const startRest = (sec: number) => { setRestTotal(sec); setRestEnd(Date.now() + sec * 1000); setPausedLeft(paused ? sec * 1000 : null); };
  const skipRest = () => { setRestEnd(null); setPausedLeft(null); };
  const togglePause = () => {
    if (paused) { if (pausedLeft != null) setRestEnd(Date.now() + pausedLeft); setPausedLeft(null); }
    else if (restEnd != null) setPausedLeft(Math.max(0, restEnd - Date.now()));
    setPaused(!paused);
  };
  const [swap, setSwap] = useState(false);
  const [quit, setQuit] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastLoads = useRef<Map<string, number>>(new Map());
  const startedAt = useRef(saved?.startedAt ?? new Date().toISOString());
  const ended = useRef(false);
  const ex = list[idx];
  // Exercices au poids du corps : le joueur peut se lester à tout moment s'il trouve ça trop facile.
  const [lestOn, setLestOn] = useState<Set<string>>(() => new Set(saved?.lestOn));
  const bodyweight = (e: Exercise) => e.equipment.every((x) => NO_LOAD_GEAR.has(x));
  const lested = (e: Exercise) => Boolean(e.lest) || lestOn.has(e.id) || (bodyweight(e) && (lastLoads.current.get(e.id) ?? 0) > 0);
  const firstLest = Math.max(1, Math.round((profile?.weight_kg ?? 60) * 0.05 * 2) / 2); // 5 % du poids du corps

  // Dernières charges utilisées : la saisie part de là (2 taps max par série).
  useEffect(() => {
    supabase.from("set_logs").select("exercise_id, load_kg, created_at").in("exercise_id", list.map((e) => e.id)).order("created_at", { ascending: false }).limit(200)
      .then(({ data }) => {
        for (const r of data ?? []) if (!lastLoads.current.has(r.exercise_id) && r.load_kg != null) lastLoads.current.set(r.exercise_id, Number(r.load_kg));
        // séance reprise : la charge saisie reste celle du joueur
        if (list !== saved?.list) setLoad(lastLoads.current.get(list[idx]?.id) ?? list[idx]?.lest ?? 0);
      });
  }, [list]);

  // Photos de l'exercice suivant chargées à l'avance : elles s'affichent tout de suite au changement.
  useEffect(() => {
    const next = list[idx + 1];
    if (!next?.photo) return;
    for (const k of [0, 1]) { const img = new Image(); img.src = `/exercises/${next.photo}-${k}.webp`; }
  }, [list, idx]);

  // Minuteur de repos, lancé automatiquement après chaque série.
  useEffect(() => {
    if (rest !== 0 || paused) return;
    setRestEnd(null);
    navigator.vibrate?.([120, 60, 120]);
  }, [rest, paused]);

  // La séance existe dès l'échauffement fait : on la garde à chaque changement.
  useEffect(() => {
    if (!warm || ended.current) return;
    saveActiveWorkout({ userId, path: pathname + search, template, location, list, idx, setNo, load, reps, logs, lestOn: [...lestOn], startedAt: startedAt.current, restEnd, restTotal, paused, pausedLeft });
  }, [warm, list, idx, setNo, load, reps, logs, lestOn, restEnd, restTotal, paused, pausedLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) nav(-1);
    else nav("/", { replace: true });
  };
  const discard = () => { ended.current = true; clearActiveWorkout(); leave(); };

  const prevSet = logs.filter((l) => l.exercise_id === ex?.id).at(-1);
  const totalSets = useMemo(() => list.reduce((n, e) => n + e.sets, 0), [list]);

  function selectExercise(i: number) {
    setIdx(i);
    setSetNo(1);
    const e = list[i];
    setLoad(lastLoads.current.get(e.id) ?? e.lest ?? 0);
    setReps(e.reps ?? e.seconds ?? 10);
  }

  async function validate() {
    const log: SetLog = { exercise_id: ex.id, set_index: setNo, load_kg: bodyweight(ex) ? (lested(ex) && load > 0 ? load : null) : load, reps };
    const all = [...logs, log];
    setLogs(all);
    if (setNo < ex.sets) {
      setSetNo(setNo + 1);
      startRest(ex.rest);
    } else if (idx < list.length - 1) {
      selectExercise(idx + 1);
      startRest(ex.rest);
    } else {
      await finish(all);
    }
  }

  // partial : séance arrêtée avant la fin, enregistrée sans être comptée comme faite en entier
  async function finish(all: SetLog[], partial = false) {
    setSaving(true);
    const sessionId = crypto.randomUUID();
    const volume = all.reduce((n, l) => n + (l.load_kg ?? 0) * (l.reps ?? 0), 0);
    const best = new Map<string, { value: number; label: string; unit: string }>();
    for (const l of all) {
      const e = list.find((x) => x.id === l.exercise_id)!;
      const value = l.load_kg ? Math.round(oneRm(l.load_kg, l.reps ?? 0) * 10) / 10 : l.reps ?? 0;
      const cur = best.get(e.id);
      if (!cur || value > cur.value) best.set(e.id, { value, label: e.name, unit: l.load_kg ? "kg (1RM estimé)" : e.seconds ? "s" : "reps" });
    }
    const records = await checkRecords([...best].map(([k, v]) => ({ key: `ex:${k}`, value: v.value, better: "higher" as const, label: v.label, unit: v.unit }))).catch(() => []);
    const session = {
      id: sessionId, event_id: event?.id ?? null, kind: "workout" as const, title: TEMPLATES[template]?.title ?? "Workout", started_at: startedAt.current,
      duration_s: Math.round((Date.now() - Date.parse(startedAt.current)) / 1000),
      results: { exercises: list.length, sets: all.length, volume: Math.round(volume), location, records, ...(partial ? { partial: true, plannedSets: totalSets } : {}) }, feeling: null,
    };
    // exercices au poids du corps lestés par le joueur lui-même : la séance était trop facile, le niveau monte plus vite
    const easy = list.filter((e) => !e.lest && bodyweight(e) && all.some((l) => l.exercise_id === e.id && (l.load_kg ?? 0) > 0)).length;
    const extra = { ...(easy ? { easy } : {}), ...(partial ? { partial: true } : {}) };
    const status = await saveSession({ session, sets: all, eventDone: event?.id ?? null, eventPayload: event && (easy || partial) ? { ...event.payload, ...extra } : null });
    ended.current = true;
    clearActiveWorkout();
    nav(`/recap/${sessionId}`, { replace: true, state: { session, queued: status === "queued" } });
  }

  if (!ex) return <main className="pb-page screen no-nav"><Notice tone="error">Aucun exercice possible avec le matériel de ce lieu. Ajoute du matériel dans Profil › Lieux & matériel.</Notice></main>;

  if (other) {
    return (
      <main className="pb-page screen no-nav" style={{ display: "grid", alignContent: "center", gap: 14 }}>
        <h1 className="t">Une séance est déjà en cours</h1>
        <p className="lead">{other.logs.length ? `Tu as validé ${other.logs.length} série${other.logs.length > 1 ? "s" : ""} dans ${TEMPLATES[other.template]?.title ?? "cette séance"}. Si tu l'abandonnes, ${other.logs.length > 1 ? "elles ne seront pas enregistrées" : "elle ne sera pas enregistrée"}.` : `Tu as commencé ${TEMPLATES[other.template]?.title ?? "une autre séance"}, sans valider de série pour l'instant.`}</p>
        <Link className="pb-btn primary lg block" to={other.path} replace>Reprendre la séance en cours</Link>
        <button className="pb-btn lg block" onClick={clearActiveWorkout}>Abandonner et commencer celle-ci</button>
      </main>
    );
  }

  if (!warm) {
    return (
      <main className="pb-page screen no-nav">
        <div className="hdr"><IconButton icon="x" label="Quitter" onClick={leave} /><div style={{ flex: 1, textAlign: "center" }}><div className="pb-subtle" style={{ fontSize: 13 }}>{TEMPLATES[template]?.title} · {PLACE_LABEL[location] ?? location}</div><b style={{ fontSize: 15 }}>Échauffement</b></div><span style={{ width: 52 }} /></div>
        <h1 className="t" style={{ margin: "24px 0 6px" }}>Échauffe-toi d'abord</h1>
        <p className="lead" style={{ marginBottom: 18 }}>10 minutes pour préparer chevilles, genoux et hanches. Obligatoire avant chaque séance.</p>
        <div className="pb-glass" style={{ padding: "4px 0" }}>
          {WARMUP.map((w, i) => (
            <button key={w} className="pb-li" onClick={() => setChecked((c) => c.map((x, k) => (k === i ? !x : x)))} aria-pressed={checked[i]}>
              <span className="check-row"><span className="dotc" style={checked[i] ? { background: "var(--success)", color: "var(--bg-950)" } : undefined}>{checked[i] ? <Icon name="check" size="sm" /> : null}</span></span>
              <span className="t">{w}</span>
            </button>
          ))}
        </div>
        <BottomAction><button className="pb-btn primary lg block" disabled={!checked.every(Boolean)} onClick={() => { markWarmed(); setWarm(true); }}>Échauffement fait</button></BottomAction>
      </main>
    );
  }

  const isTime = ex.seconds != null;
  const doneSets = logs.length;
  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 130 }}>
      <div className="hdr">
        <IconButton icon="home" label="Aller à l'accueil, la séance continue" onClick={() => nav("/")} />
        <div style={{ flex: 1, textAlign: "center" }}><div className="pb-subtle" style={{ fontSize: 13 }}>{TEMPLATES[template]?.title} · {PLACE_LABEL[location] ?? location} · palier {levelIndex(prog)}/12</div><b style={{ fontSize: 15 }}>Exercice {idx + 1} / {list.length}</b></div>
        <IconButton icon={paused ? "play" : "pause"} label={paused ? "Reprendre" : "Pause"} onClick={togglePause} />
      </div>
      <div className="pb-steps" style={{ margin: "14px 0" }} aria-label={`${doneSets} séries faites sur ${totalSets}`}>
        {list.map((e, i) => <i key={e.id} className={i < idx ? "on" : i === idx ? "cur" : ""} />)}
      </div>
      <div className="pb-glass hero" style={{ height: 220, position: "relative", overflow: "hidden", background: "radial-gradient(70% 70% at 50% 60%, rgba(122,99,255,.35), transparent 70%),var(--glass-100)" }}>
        <ExerciseAnim pattern={ex.pattern} photo={ex.photo} name={ex.name} anim={ex.anim} video={ex.video} />
        <Link to={`/exercice/${ex.id}?lieu=${location}`} className="pill-sm" style={{ position: "absolute", left: 14, top: 14, color: "inherit", textDecoration: "none", height: 32 }}><Icon name="info" size="sm" style={{ width: 14, height: 14 }} />Consignes</Link>
        <button className="pill-sm" style={{ position: "absolute", right: 14, top: 14, height: 32 }} onClick={() => setSwap(true)}><Icon name="swap" size="sm" style={{ width: 14, height: 14 }} />Remplacer</button>
      </div>
      <div style={{ margin: "16px 2px 4px", display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 6 }}><h1 className="t" style={{ fontSize: 24, margin: 0 }}>{ex.name}</h1><span className="pill-sm">{ex.muscles}</span></div>
      <p className="pb-muted" style={{ margin: "0 2px 14px", fontSize: 14 }}>{ex.sets} séries × {isTime ? `${ex.seconds} s` : `${ex.reps} reps`}{ex.side ? " par côté" : ""} · repos {ex.rest} s</p>
      {ex.side ? <Notice>{sideHint(ex)}</Notice> : null}
      {ex.lest ? <Notice>Niveau max dépassé : fais cet exercice avec un lest de {num(ex.lest, 1)} kg (gilet lesté, ou sac à dos avec des bouteilles d'eau ou des livres, bien serré).</Notice> : null}
      <div className="pb-glass" style={{ padding: 14 }}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <span className="lbl">Série {setNo} / {ex.sets}</span>
          <span className="pb-subtle" style={{ fontSize: 12 }}>{prevSet ? `Série ${prevSet.set_index} : ${prevSet.load_kg ? `${num(prevSet.load_kg, 1)} kg × ` : ""}${prevSet.reps}${isTime ? " s" : ""} ✓` : lastLoads.current.has(ex.id) ? `Dernière fois : ${num(lastLoads.current.get(ex.id)!, 1)} kg` : ""}</span>
        </div>
        <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
          {!bodyweight(ex) || lested(ex) ? <Stepper label={bodyweight(ex) ? "Lest" : "Charge"} value={load} unit="kg" step={ex.equipment.includes("barre") || ex.equipment.includes("machines") ? 2.5 : 1} digits={load % 1 ? 1 : 0} max={400} onChange={setLoad} /> : null}
          <Stepper label={(isTime ? "Durée" : "Répétitions") + (ex.side ? " par côté" : "")} value={reps} unit={isTime ? "s" : "reps"} step={isTime ? 5 : 1} max={300} onChange={setReps} />
        </div>
        {canLest(ex) && !ex.lest ? (lested(ex)
          ? <button className="pb-btn block" style={{ marginTop: 12 }} onClick={() => { setLestOn((s) => { const n = new Set(s); n.delete(ex.id); return n; }); lastLoads.current.delete(ex.id); setLoad(0); }}>Retirer le lest</button>
          : <button className="pb-btn block" style={{ marginTop: 12 }} onClick={() => { setLestOn((s) => new Set(s).add(ex.id)); setLoad(firstLest); }}><Icon name="plus" size="sm" />Trop facile ? Ajoute un lest</button>) : null}
        {lestOn.has(ex.id) && !ex.lest ? <p className="pb-muted" style={{ margin: "10px 0 0", fontSize: 13 }}>Commence avec {num(firstLest, 1)} kg (gilet lesté ou sac à dos bien serré), puis monte petit à petit. Ton lest sera repris à la prochaine séance.</p> : null}
      </div>
      {rest != null ? (
        <div className="pb-glass" style={{ marginTop: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 14 }} role="timer" aria-live="off">
          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r="24" stroke="rgba(255,255,255,.14)" strokeWidth="6" fill="none" />
            <circle cx="28" cy="28" r="24" stroke="var(--heat)" strokeWidth="6" fill="none" strokeDasharray="150.8" strokeDashoffset={150.8 * (1 - rest / Math.max(1, restTotal))} strokeLinecap="round" transform="rotate(-90 28 28)" />
          </svg>
          <div style={{ flex: 1 }}><div className="lbl">Repos auto{paused ? " · en pause" : ""}</div><b className="pb-num" style={{ fontSize: 26 }}>{chrono(rest)}</b></div>
          <button className="pb-btn" onClick={skipRest}>Passer</button>
        </div>
      ) : null}
      <div style={{ textAlign: "center", marginTop: 8 }}><button className="link" onClick={() => setQuit(true)}>Quitter la séance</button></div>
      <BottomAction>
        <button className="pb-btn primary lg block" onClick={validate} disabled={saving || rest != null}>
          <Icon name="check" size="sm" />{saving ? "Enregistrement…" : rest != null ? "Repos en cours" : "Valider la série"}
        </button>
      </BottomAction>
      {swap ? (
        <Sheet title="Remplacer l'exercice" onClose={() => setSwap(false)}>
          <p className="pb-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>Même muscle, avec le matériel disponible ici.</p>
          {alternatives(ex, location, profile!).length ? (
            <div className="pb-glass" style={{ padding: "4px 0" }}>
              {alternatives(ex, location, profile!).map((a) => (
                <button key={a.id} className="pb-li" onClick={() => { setList((l) => l.map((x, i) => (i === idx ? a : x))); setSetNo(1); setLoad(lastLoads.current.get(a.id) ?? 0); setReps(a.reps ?? a.seconds ?? 10); setSwap(false); }}>
                  <div className="t">{a.name}<small>{a.muscles}</small></div><Icon name="swap" size="sm" className="pb-muted" />
                </button>
              ))}
            </div>
          ) : <Notice>Pas d'équivalent avec ton matériel.</Notice>}
        </Sheet>
      ) : null}
      {quit ? (
        <Sheet title="Quitter la séance ?" onClose={() => setQuit(false)}>
          <p className="pb-muted" style={{ marginTop: 0 }}>{logs.length ? `Tu as validé ${logs.length} série${logs.length > 1 ? "s" : ""} sur ${totalSets}. Tu peux les garder : la séance sera marquée partiellement faite.` : "Rien n'a encore été enregistré : la séance reste prévue."}</p>
          <div className="col" style={{ gap: 8 }}>
            <button className="pb-btn primary lg block" onClick={() => setQuit(false)}>Continuer la séance</button>
            {logs.length ? <button className="pb-btn lg block" disabled={saving} onClick={() => finish(logs, true)}>{saving ? "Enregistrement…" : "Arrêter : partiellement faite"}</button> : null}
            <button className="pb-btn lg block" onClick={discard}>{logs.length ? "Quitter sans enregistrer" : "Quitter"}</button>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}

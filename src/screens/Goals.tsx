// Objectifs (dunker, % au tir, sprint, cardio, physique…) : ils choisissent les tests du mois,
import { AMBI_TIPS } from "../lib/ambi";
// orientent le programme et reçoivent une estimation du temps nécessaire, recalculée à chaque test.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, latest } from "../state/app";
import { Icon } from "../components/Icon";
import { BackButton, Chip, Notice, Sheet } from "../components/ui";
import { addDays, num, today } from "../lib/format";
import { regenerateProgram, updateProfile } from "../lib/data";
import { supabase } from "../lib/supabase";
import {
  CARDIO_LEVELS, dunkTarget, forecast, GOAL_KINDS, goalTitle, metricOf, monthsLabel, PHYSIQUE_METRICS, prioritiesFor, reachOf, SHOOT_ZONES,
} from "../lib/goals";
import type { Goal, GoalKind } from "../lib/types";

const dateLabel = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

export default function Goals() {
  const { goals, measurements, profile, events, reloadGoals, reload } = useApp();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextTest = events.filter((e) => e.type === "test" && e.status === "planned" && e.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];

  // Les objectifs décident des priorités ; le programme est refait à partir de demain.
  async function applyToProgram(list: Goal[]) {
    const pr = prioritiesFor(list, profile!);
    if (!pr) return;
    await updateProfile(pr);
    await regenerateProgram({ ...profile!, ...pr }, addDays(today(), 1)).catch(() => undefined);
    await reload();
  }

  async function remove(g: Goal) {
    setBusy(true);
    await supabase.from("goals").update({ archived: true }).eq("id", g.id);
    await reloadGoals();
    await applyToProgram(goals.filter((x) => x.id !== g.id));
    setBusy(false);
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 140 }}>
      <div className="hdr"><BackButton /><h1 className="t" style={{ fontSize: 22 }}>Mes objectifs</h1></div>
      <p className="lead" style={{ margin: "4px 0 16px" }}>Tes objectifs choisissent les tests de chaque mois et l'orientation de ton programme. Après chaque test, l'estimation se recalcule avec ta vraie progression.</p>

      {goals.length ? goals.map((g) => <GoalCard key={g.id} goal={g} onRemove={() => remove(g)} busy={busy} />) : (
        <div className="pb-glass" style={{ padding: 18 }}>
          <b>Aucun objectif pour l'instant.</b>
          <p className="pb-muted" style={{ margin: "6px 0 0" }}>Fixe un ou plusieurs objectifs : dunker, 40 % à 3 points, 100 m en 13 s, un bon cardio…</p>
        </div>
      )}

      {goals.length && nextTest ? (
        <p className="pb-subtle" style={{ fontSize: 13, marginTop: 12 }}>Prochaine session de tests : {new Date(nextTest.date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}.</p>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="bottom-action">
        <button className="pb-btn primary lg block" onClick={() => setAdding(true)}><Icon name="plus" size="sm" />Ajouter un objectif</button>
      </div>
      {adding ? (
        <AddGoal onClose={() => setAdding(false)} onSaved={async (g) => {
          setAdding(false);
          setBusy(true);
          setError(null);
          try {
            await reloadGoals();
            await applyToProgram([...goals, g]);
          } catch { setError("L'objectif est enregistré, mais le programme n'a pas pu être mis à jour. Réessaie plus tard."); }
          setBusy(false);
        }} existingKinds={goals.map((g) => g.kind)} measurements={measurements} />
      ) : null}
    </main>
  );
}

function GoalCard({ goal, onRemove, busy }: { goal: Goal; onRemove: () => void; busy: boolean }) {
  const { measurements, profile } = useApp();
  const m = metricOf(goal);
  const f = useMemo(() => forecast(goal, measurements, profile!), [goal, measurements, profile]);
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="pb-glass" style={{ padding: 16, marginBottom: 12 }} aria-label={goalTitle(goal)}>
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <div className="pb-tile" style={{ width: 40, height: 40, color: f.reached ? "var(--success)" : "var(--primary-bright)" }}>
          <Icon name={f.reached ? "check" : GOAL_KINDS.find((k) => k.id === goal.kind)!.icon} size="sm" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="t" style={{ fontSize: 17, margin: 0 }}>{goalTitle(goal)}</h2>
          <p className="pb-muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            {m.label} : {f.current != null ? `${num(f.current, m.digits)} ${m.unit}` : "pas encore mesuré"} → {num(f.target, m.digits)} {m.unit}
            {goal.kind === "dunk" ? ` (allonge ${reachOf(profile!)} cm)` : ""}
          </p>
        </div>
        <button className="pb-icon-btn" aria-label={`Retirer l'objectif ${goalTitle(goal)}`} onClick={() => setConfirm(true)} disabled={busy}><Icon name="trash" size="sm" /></button>
      </div>

      {f.current != null ? <div className="goal-bar" style={{ ["--p" as string]: String(f.progress), marginTop: 12 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f.progress * 100)} aria-label="Avancée vers l'objectif" /> : null}

      <p style={{ margin: "12px 0 0", fontSize: 15 }}>
        {f.reached ? <b>Objectif atteint, bravo !</b>
          : f.months == null ? <>Passe le test de départ pour savoir en combien de temps tu peux l'atteindre.</>
          : <>Au rythme {f.basis === "progression" ? "de ta progression" : "estimé pour ton âge et ton niveau"} : <b>{monthsLabel(f.months)}</b>, vers {dateLabel(f.date!)}.</>}
      </p>
      {f.stalled ? <p className="pb-subtle" style={{ fontSize: 13, margin: "6px 0 0" }}>Tes derniers tests stagnent : le programme met l'accent dessus, garde la régularité.</p> : null}
      {goal.kind === "dunk" && !profile?.reach_cm ? <p className="pb-subtle" style={{ fontSize: 13, margin: "6px 0 0" }}>Allonge estimée d'après ta taille. Mesure-la (debout, bras tendu contre un mur) pour un calcul exact.</p> : null}

      {goal.kind === "dribble" ? (
        <details style={{ marginTop: 12 }}>
          <summary className="link" style={{ cursor: "pointer", fontSize: 14 }}>Comment devenir ambidextre</summary>
          <ul className="pb-muted" style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6, fontSize: 14, lineHeight: "20px" }}>
            {AMBI_TIPS.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </details>
      ) : null}

      <Link to={m.test.to} className="pb-btn block" style={{ marginTop: 12 }}><Icon name={m.test.id === "pesee" ? "scale" : "timer"} size="sm" />{f.current == null ? "Passer le test de départ" : m.test.label}</Link>

      {confirm ? (
        <Sheet title="Retirer cet objectif ?" onClose={() => setConfirm(false)}>
          <p className="pb-muted">« {goalTitle(goal)} » ne guidera plus tes tests ni ton programme. Tes mesures restent dans ton historique.</p>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => setConfirm(false)}>Garder</button>
            <button className="pb-btn primary lg" style={{ flex: 1 }} onClick={() => { setConfirm(false); onRemove(); }}>Retirer</button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}

function AddGoal({ onClose, onSaved, existingKinds, measurements }: {
  onClose: () => void; onSaved: (g: Goal) => void; existingKinds: GoalKind[]; measurements: ReturnType<typeof useApp>["measurements"];
}) {
  const { profile } = useApp();
  const [kind, setKind] = useState<GoalKind | null>(null);
  const [hands, setHands] = useState("une");
  const [reach, setReach] = useState(reachOf(profile!));
  const [zone, setZone] = useState<string>("3pts");
  const [pct, setPct] = useState(40);
  const [distance, setDistance] = useState(100);
  const [time, setTime] = useState(13.5);
  const [vma, setVma] = useState(14.5);
  const [metric, setMetric] = useState<string>("fat_pct");
  const [value, setValue] = useState(12);
  const [cm, setCm] = useState(60);
  const [rate, setRate] = useState(90);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(k: GoalKind) {
    setKind(k);
    if (k === "physique") pickMetric("fat_pct");
  }
  function pickMetric(id: string) {
    setMetric(id);
    const cur = latest(measurements, id).value;
    setValue(cur != null ? Math.round((id === "weight" ? cur - 3 : id === "fat_pct" ? cur - 2 : cur + 2) * 10) / 10 : id === "weight" ? 75 : id === "fat_pct" ? 12 : 35);
  }

  async function save() {
    if (!kind) return;
    setSaving(true);
    setError(null);
    let params: Record<string, string | number> = {};
    let target = 0;
    if (kind === "dunk") { params = { hands }; target = dunkTarget({ reach_cm: reach, height_cm: profile!.height_cm }, hands); }
    if (kind === "vertical") target = cm;
    if (kind === "shoot") { params = { zone }; target = pct; }
    if (kind === "sprint") { params = { distance }; target = time; }
    if (kind === "cardio") target = vma;
    if (kind === "physique") {
      const cur = latest(measurements, metric).value;
      params = { metric, direction: cur != null && value < cur ? "baisser" : metric === "fat_pct" ? "baisser" : "monter" };
      target = value;
    }
    if (kind === "dribble") target = rate;
    try {
      if (kind === "dunk" && reach !== reachOf(profile!)) await updateProfile({ reach_cm: reach });
      const m = metricOf({ kind, params });
      const base = latest(measurements, m.kind).value;
      const { data, error: e } = await supabase.from("goals").insert({ kind, params, target, baseline: base }).select().single();
      if (e) throw e;
      onSaved(data as Goal);
    } catch {
      setError("L'objectif n'a pas pu être enregistré. Vérifie ta connexion et réessaie.");
      setSaving(false);
    }
  }

  const dunkCm = kind === "dunk" ? dunkTarget({ reach_cm: reach, height_cm: profile!.height_cm }, hands) : 0;
  const sprintKmh = (distance / time) * 3.6;

  return (
    <Sheet title={kind ? GOAL_KINDS.find((k) => k.id === kind)!.label : "Nouvel objectif"} onClose={onClose}>
      {!kind ? (
        <div className="col" style={{ gap: 8 }}>
          {GOAL_KINDS.map((k) => (
            <button key={k.id} className="pb-li pb-glass" style={{ borderRadius: 14 }} onClick={() => choose(k.id)}>
              <Icon name={k.icon} className="pb-muted" />
              <div className="t">{k.label}<small>{existingKinds.includes(k.id) && k.id !== "shoot" && k.id !== "sprint" && k.id !== "physique" ? "Déjà un objectif de ce type" : k.hint}</small></div>
              <Icon name="right" size="sm" className="pb-muted" />
            </button>
          ))}
        </div>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {kind === "dunk" ? (
            <>
              <div className="pb-chips" role="group" aria-label="Dunk">
                <Chip active={hands === "une"} onClick={() => setHands("une")}>À une main</Chip>
                <Chip active={hands === "deux"} onClick={() => setHands("deux")}>À deux mains</Chip>
              </div>
              <NumField label="Allonge debout, bras tendu" value={reach} unit="cm" min={170} max={300} onChange={setReach} />
              <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Mesure-la debout contre un mur, bras tendu le plus haut possible, pieds à plat. Sans mesure, on l'estime à 1,33 × ta taille.</p>
              <Notice>Cercle à 3,05 m : il te faut environ <b>{dunkCm} cm</b> de détente au test sur place (un saut avec élan monte environ 12 % plus haut).</Notice>
            </>
          ) : null}
          {kind === "vertical" ? <NumField label="Détente visée (saut sur place)" value={cm} unit="cm" min={20} max={110} onChange={setCm} /> : null}
          {kind === "shoot" ? (
            <>
              <div className="pb-chips wrap" role="group" aria-label="Zone de tir">
                {SHOOT_ZONES.map((z) => <Chip key={z.id} active={zone === z.id} onClick={() => setZone(z.id)}>{z.label}</Chip>)}
              </div>
              <NumField label="Pourcentage visé" value={pct} unit="%" min={10} max={100} onChange={setPct} />
              <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Mesuré chaque mois par une séance de tir filmée ({zone === "lf" ? "séries de lancers" : "5 spots × 10 tirs"}).</p>
            </>
          ) : null}
          {kind === "sprint" ? (
            <>
              <NumField label="Distance" value={distance} unit="m" step={5} min={5} max={400} onChange={setDistance} />
              <NumField label="Temps visé" value={time} unit="s" step={0.1} digits={1} min={1} max={90} onChange={setTime} />
              <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Soit {num(sprintKmh, 1)} km/h de moyenne. {distance === 10 || distance === 20 ? "Mesuré par la caméra." : "Chronométré par un partenaire ou saisi à la main."}</p>
            </>
          ) : null}
          {kind === "cardio" ? (
            <>
              <div className="col" style={{ gap: 8 }}>
                {CARDIO_LEVELS.map((c) => (
                  <Chip key={c.vma} active={vma === c.vma} onClick={() => setVma(c.vma)}>{c.label} · VMA {num(c.vma, 1)} km/h ({c.hint})</Chip>
                ))}
              </div>
              <NumField label="Ou une VMA précise" value={vma} unit="km/h" step={0.5} digits={1} min={10} max={21} onChange={setVma} />
              <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Mesurée chaque mois par le test navette (allers-retours de 20 m avec bips).</p>
            </>
          ) : null}
          {kind === "physique" ? (
            <>
              <div className="pb-chips wrap" role="group" aria-label="Mesure">
                {PHYSIQUE_METRICS.map((x) => <Chip key={x.id} active={metric === x.id} onClick={() => pickMetric(x.id)}>{x.label}</Chip>)}
              </div>
              {(() => {
                const x = PHYSIQUE_METRICS.find((y) => y.id === metric)!;
                const cur = latest(measurements, metric).value;
                return (
                  <>
                    <NumField label={`${x.label} visé${x.id === "fat_pct" ? "e" : ""}`} value={value} unit={x.unit} step={x.id === "fat_pct" ? 0.5 : 1} digits={1} min={x.id === "fat_pct" ? 5 : 30} max={x.id === "fat_pct" ? 40 : 150} onChange={setValue} />
                    <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>{cur != null ? `Actuellement ${num(cur, 1)} ${x.unit}.` : "Pas encore de mesure : pèse-toi (TrackFit ou à la main dans Progrès › Mesures)."}</p>
                  </>
                );
              })()}
            </>
          ) : null}
          {kind === "dribble" ? (
            <>
              <NumField label="Main faible aussi bonne que la forte à" value={rate} unit="%" step={5} digits={0} min={60} max={100} onChange={setRate} />
              <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>On compare tes deux mains au dribble (20 s chacune) et en finition près du cercle (10 essais chacune). 100 % = aussi fort des deux mains.</p>
            </>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="row" style={{ gap: 8 }}>
            <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => setKind(null)}>Retour</button>
            <button className="pb-btn primary lg" style={{ flex: 1.6 }} onClick={save} disabled={saving}>{saving ? "Enregistrement…" : "Fixer cet objectif"}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}


/** Valeur réglable : libellé visible, boutons − / + et saisie directe (virgule acceptée). */
function NumField({ label, value, unit, step = 1, min = 0, max = 999, digits = 0, onChange }: {
  label: string; value: number; unit: string; step?: number; min?: number; max?: number; digits?: number; onChange: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const id = `nf-${label.replace(/\W+/g, "-")}`;
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100);
  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>{label}</label>
      <div className="pb-stepper num-field">
        <button type="button" aria-label={`${label} : moins ${num(step, digits)}`} onClick={() => set(value - step)}>−</button>
        <input id={id} className="input" inputMode="decimal" autoComplete="off" value={text ?? num(value, digits)}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            // valeur prise en compte à chaque frappe : « Fixer cet objectif » juste après la saisie enregistre bien ce qui est tapé
            setText(e.target.value);
            const v = Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""));
            if (e.target.value.trim() && Number.isFinite(v) && v >= min && v <= max) onChange(Math.round(v * 100) / 100);
          }}
          onBlur={() => setText(null)} />
        <span className="pb-muted" style={{ minWidth: 36 }}>{unit}</span>
        <button type="button" className="plus" aria-label={`${label} : plus ${num(step, digits)}`} onClick={() => set(value + step)}>+</button>
      </div>
    </div>
  );
}

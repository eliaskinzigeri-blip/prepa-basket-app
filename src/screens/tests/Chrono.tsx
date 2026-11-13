// Sprint sur la distance choisie dans l'objectif (ex. 100 m) : trop long pour la caméra,
// donc départ donné par l'app (voix + bip) et arrêt par un partenaire, ou temps saisi à la main.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BackButton, BottomAction, Chip, Notice } from "../../components/ui";
import { checkRecords, saveSession } from "../../lib/data";
import { num } from "../../lib/format";
import { beep, speak } from "../../vision/media";

export default function Chrono() {
  const [qs] = useSearchParams();
  const eventId = qs.get("event");
  const d = Math.min(400, Math.max(5, Number(qs.get("d")) || 30));
  const nav = useNavigate();
  const [mode, setMode] = useState<"partenaire" | "saisie">("partenaire");
  const [state, setState] = useState<"idle" | "ready" | "run">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [trials, setTrials] = useState<number[]>([]);
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const goAt = useRef(0);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { cancelAnimationFrame(raf.current); timers.current.forEach(clearTimeout); }, []);

  function go() {
    setState("ready");
    speak("À vos marques");
    // départ aléatoire après « prêts », comme en athlétisme
    const delay = 2600 + Math.random() * 1200;
    timers.current = [
      window.setTimeout(() => speak("Prêts"), 1500),
      window.setTimeout(() => {
        beep(1046, 250, 0.5);
        goAt.current = performance.now();
        setState("run");
        const tick = () => { setElapsed((performance.now() - goAt.current) / 1000); raf.current = requestAnimationFrame(tick); };
        tick();
      }, delay),
    ];
  }

  function finish() {
    cancelAnimationFrame(raf.current);
    const t = (performance.now() - goAt.current) / 1000;
    setTrials((l) => [...l, Math.round(t * 100) / 100]);
    setState("idle");
    setElapsed(t);
  }

  function addTyped() {
    const t = Number(typed.replace(",", "."));
    if (!(t > 0.8 && t < 300)) return;
    setTrials((l) => [...l, Math.round(t * 100) / 100]);
    setTyped("");
  }

  async function save() {
    const best = Math.min(...trials);
    const kind = d === 10 || d === 20 ? `sprint${d}` : `sprint_${d}`;
    const records = await checkRecords([{ key: `test:${kind}`, value: best, better: "lower", label: `Sprint ${d} m`, unit: "s" }]).catch(() => []);
    const status = await saveSession({
      session: { id: crypto.randomUUID(), event_id: eventId, kind: "test", title: `Sprint ${d} m`, started_at: new Date().toISOString(), duration_s: null,
        results: { test: kind, testName: `Sprint ${d} m`, best, unit: "s", digits: 2, trials, timing: mode, records }, feeling: null },
      measurements: [{ kind, value: best, source: "manual" }],
    });
    setSaved(status === "queued" ? "Hors ligne : résultat gardé sur le téléphone." : records.length ? "Nouveau record enregistré." : "Résultat enregistré.");
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 140 }}>
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Sprint {d} m</h1>
      <p className="lead">Trois essais, le meilleur est retenu. Récupère 2 à 3 minutes entre chaque.</p>
      <div className="pb-chips" role="tablist" aria-label="Chronométrage" style={{ marginTop: 14 }}>
        <Chip active={mode === "partenaire"} onClick={() => setMode("partenaire")}>Avec un partenaire</Chip>
        <Chip active={mode === "saisie"} onClick={() => setMode("saisie")}>Saisir mon temps</Chip>
      </div>

      {mode === "partenaire" ? (
        <>
          <p className="pb-muted" style={{ fontSize: 14 }}>Ton partenaire tient le téléphone à la ligne d'arrivée. L'app donne le départ à voix haute (son au maximum) et il appuie sur « Arrivée » quand ton buste passe la ligne.</p>
          <div className="pb-glass" style={{ marginTop: 12, padding: 24, textAlign: "center" }}>
            <div className="pb-num" style={{ fontSize: 64, lineHeight: "72px" }} aria-live="off">{num(elapsed, 2)} s</div>
            {state === "idle" ? <button className="pb-btn primary lg block" style={{ marginTop: 12 }} onClick={go} disabled={trials.length >= 3}>Donner le départ</button>
              : state === "ready" ? <p className="pb-muted" role="status">À vos marques… prêts…</p>
              : <button className="pb-btn primary lg block chrono-stop" style={{ marginTop: 12 }} onClick={finish}>Arrivée</button>}
          </div>
        </>
      ) : (
        <div className="field" style={{ marginTop: 14 }}>
          <label className="lbl" htmlFor="t">Ton temps (secondes)</label>
          <div className="row" style={{ gap: 8 }}>
            <input id="t" className="input" inputMode="decimal" autoComplete="off" placeholder="13,8…" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            <button className="pb-btn" onClick={addTyped} disabled={trials.length >= 3}>Ajouter</button>
          </div>
        </div>
      )}

      {trials.length ? (
        <div className="pb-glass" style={{ marginTop: 14, padding: "4px 0" }}>
          {trials.map((t, i) => <div key={i} className="pb-li"><div className="t">Essai {i + 1}</div><b className="pb-num">{num(t, 2)} s</b></div>)}
        </div>
      ) : null}
      {mode === "partenaire" ? <Notice>Chrono à la main : compte environ ± 0,2 s de précision. Garde la même méthode d'un mois à l'autre.</Notice> : null}
      {saved ? <p role="status" className="pb-subtle">{saved}</p> : null}
      <BottomAction>
        {saved ? <button className="pb-btn primary lg block" onClick={() => nav(-1)}>Terminé</button>
          : <button className="pb-btn primary lg block" disabled={!trials.length} onClick={save}>Enregistrer {trials.length ? `${num(Math.min(...trials), 2)} s` : ""}</button>}
      </BottomAction>
    </main>
  );
}

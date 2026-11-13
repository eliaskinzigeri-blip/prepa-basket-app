// Test navette 20 m (Luc Léger) : l'app joue les bips, le joueur s'arrête quand il ne suit plus.
// Palier 1 à 8,5 km/h, +0,5 km/h par palier d'environ 1 min. VMA = vitesse du dernier palier tenu.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApp } from "../../state/app";
import { BackButton, BottomAction, Notice } from "../../components/ui";
import { checkRecords, saveSession } from "../../lib/data";
import { num } from "../../lib/format";
import { speak } from "../../vision/media";

const LEG = 20; // mètres
const speedOf = (stage: number) => 8.5 + 0.5 * (stage - 1); // km/h
const legTime = (stage: number) => LEG / (speedOf(stage) / 3.6); // s
const legsIn = (stage: number) => Math.max(1, Math.round(60 / legTime(stage)));

/** Plan des bips : instant (s depuis le départ) de chaque fin de longueur, palier et longueur. */
function plan(maxStage = 22) {
  const out: { t: number; stage: number; leg: number; last: boolean }[] = [];
  let t = 0;
  for (let s = 1; s <= maxStage; s++) {
    const n = legsIn(s);
    for (let l = 1; l <= n; l++) { t += legTime(s); out.push({ t, stage: s, leg: l, last: l === n }); }
  }
  return out;
}
const PLAN = plan();

function vo2max(vma: number, age: number | null) {
  // Léger et al. (1988) : formule enfants / ados (6-18 ans) ou adultes.
  return age != null && age < 18 ? 31.025 + 3.238 * vma - 3.248 * age + 0.1536 * age * vma : -24.4 + 6 * vma;
}

export default function Navette() {
  const [qs] = useSearchParams();
  const eventId = qs.get("event");
  const { profile } = useApp();
  const nav = useNavigate();
  const [phase, setPhase] = useState<"setup" | "run" | "done">("setup");
  const [pos, setPos] = useState({ stage: 1, leg: 0, next: 0 });
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ stage: number; legs: number; vma: number; vo2: number; saved: string } | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const t0 = useRef(0);
  const timer = useRef(0);
  const scheduled = useRef(0);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const age = profile?.birth_date ? Math.floor((Date.now() - Date.parse(profile.birth_date)) / 3.15576e10) : null;

  useEffect(() => () => stopAudio(), []);

  function tone(at: number, freq: number, dur = 0.16) {
    const c = audio.current!;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.6, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(c.destination);
    o.start(at); o.stop(at + dur + 0.02);
  }

  async function start() {
    setNote(null);
    audio.current = new AudioContext();
    await audio.current.resume();
    try { wake.current = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* écran : veille possible */ }
    const c = audio.current;
    t0.current = c.currentTime + 5.2;
    speak("Départ dans 5 secondes. Palier 1.");
    for (let i = 0; i < 3; i++) tone(t0.current - 3 + i, 660, 0.12); // 3, 2, 1
    tone(t0.current, 1046, 0.3);
    scheduled.current = 0;
    setPhase("run");
    // Programmation des bips à l'avance sur l'horloge audio (précise), affichage rafraîchi à côté.
    timer.current = window.setInterval(() => {
      const now = c.currentTime - t0.current;
      while (scheduled.current < PLAN.length && PLAN[scheduled.current].t < now + 0.5) {
        const b = PLAN[scheduled.current];
        const at = t0.current + b.t;
        if (b.last) { tone(at, 1046); tone(at + 0.22, 1046); tone(at + 0.44, 1318); } else tone(at, 880);
        if (b.last) window.setTimeout(() => speak(`Palier ${b.stage + 1}`), Math.max(0, (at - c.currentTime) * 1000 + 600));
        scheduled.current++;
      }
      const done = PLAN.findIndex((b) => b.t > now);
      const cur = done < 0 ? PLAN[PLAN.length - 1] : PLAN[done];
      setPos({ stage: cur.stage, leg: cur.leg, next: Math.max(0, cur.t - now) });
    }, 100);
  }

  function stopAudio() {
    window.clearInterval(timer.current);
    audio.current?.close().catch(() => undefined);
    audio.current = null;
    wake.current?.release().catch(() => undefined);
    wake.current = null;
  }

  async function stop() {
    const c = audio.current;
    const now = c ? c.currentTime - t0.current : 0;
    stopAudio();
    const legsDone = PLAN.filter((b) => b.t <= now).length;
    const last = PLAN[legsDone - 1];
    // Palier retenu : celui en cours s'il est au moins à moitié fait, sinon le précédent.
    const curStage = PLAN[Math.min(legsDone, PLAN.length - 1)].stage;
    const inStage = PLAN.slice(0, legsDone).filter((b) => b.stage === curStage).length;
    const stage = !last ? 0 : inStage >= legsIn(curStage) / 2 ? curStage : Math.max(1, curStage - 1);
    if (!stage || now < 30) { setNote("Test arrêté trop tôt : rien n'a été enregistré. Relance-le quand tu es prêt."); setPhase("setup"); return; }
    const vma = speedOf(stage), vo2 = vo2max(vma, age);
    setResult({ stage, legs: legsDone, vma, vo2, saved: "Enregistrement…" });
    setPhase("done");
    const records = await checkRecords([{ key: "test:navette", value: vma, better: "higher", label: "Test navette (VMA)", unit: "km/h" }]).catch(() => []);
    const status = await saveSession({
      session: { id: crypto.randomUUID(), event_id: eventId, kind: "test", title: "Test navette Luc Léger", started_at: new Date().toISOString(), duration_s: Math.round(now),
        results: { test: "navette", testName: "Test navette", best: vma, unit: "km/h", digits: 1, stage, legs: legsDone, vo2max: Math.round(vo2 * 10) / 10, records }, feeling: null },
      measurements: [{ kind: "vma", value: vma, source: "manual" }, { kind: "vo2max", value: Math.round(vo2 * 10) / 10, source: "manual" }],
    });
    setResult((r) => r && { ...r, saved: status === "queued" ? "Hors ligne : résultat gardé sur le téléphone." : records.length ? "Nouveau record enregistré." : "Résultat enregistré." });
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 140 }}>
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Test navette</h1>
      {phase === "setup" ? (
        <>
          <p className="lead">Des allers-retours de 20 m, de plus en plus rapides. Il mesure ton cardio (VMA et VO2max).</p>
          <ol className="pb-glass" style={{ margin: "18px 0 0", padding: "14px 16px 14px 34px", display: "grid", gap: 8, fontSize: 15, lineHeight: "22px" }}>
            <li>Trace deux lignes à 20 m d'écart (plots ou lignes du terrain : une longueur de terrain fait 28 m).</li>
            <li>Monte le son du téléphone et pose-le près de toi. Échauffe-toi 10 minutes avant.</li>
            <li>À chaque bip, tu dois avoir atteint la ligne d'en face. Trois bips = palier suivant, un peu plus vite.</li>
            <li>Arrête-toi quand tu ne peux plus suivre (en retard deux fois de suite), puis appuie sur « J'arrête ».</li>
          </ol>
          {note ? <Notice tone="error">{note}</Notice> : null}
          <Notice>Le test dure de 5 à 15 minutes. Arrête-toi tout de suite en cas de douleur ou de malaise.</Notice>
          <BottomAction><button className="pb-btn primary lg block" onClick={start}>Lancer le test</button></BottomAction>
        </>
      ) : phase === "run" ? (
        <>
          <div className="pb-glass" style={{ marginTop: 18, padding: 24, textAlign: "center" }}>
            <div className="lbl">Palier</div>
            <div className="pb-num" style={{ fontSize: 72, lineHeight: "80px" }}>{pos.stage}</div>
            <div className="pb-muted">{num(speedOf(pos.stage), 1)} km/h · longueur {pos.leg} / {legsIn(pos.stage)}</div>
            <div className="navette-bar" style={{ ["--p" as string]: String(1 - pos.next / legTime(pos.stage)) }} aria-hidden="true" />
          </div>
          <BottomAction><button className="pb-btn primary lg block" onClick={stop}>J'arrête</button></BottomAction>
        </>
      ) : result ? (
        <>
          <div className="pb-glass" style={{ marginTop: 18, padding: 20, display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", textAlign: "center", gap: 8 }}>
            <div><div className="pb-num" style={{ fontSize: 30 }}>{result.stage}</div><div className="pb-muted" style={{ fontSize: 12 }}>palier</div></div>
            <div><div className="pb-num" style={{ fontSize: 30 }}>{num(result.vma, 1)}</div><div className="pb-muted" style={{ fontSize: 12 }}>VMA km/h</div></div>
            <div><div className="pb-num" style={{ fontSize: 30 }}>{num(result.vo2, 0)}</div><div className="pb-muted" style={{ fontSize: 12 }}>VO2max</div></div>
          </div>
          <p className="pb-muted" style={{ marginTop: 12 }}>{result.legs} longueurs de 20 m, soit {num(result.legs * LEG / 1000, 2)} km.</p>
          <p role="status" className="pb-subtle">{result.saved}</p>
          <BottomAction><button className="pb-btn primary lg block" onClick={() => nav(-1)}>Terminé</button></BottomAction>
        </>
      ) : null}
    </main>
  );
}

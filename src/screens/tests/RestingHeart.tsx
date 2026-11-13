// Test de FC au repos à la ceinture cardio : 5 minutes allongé, au réveil (ou 2 min 30 pour la VFC du matin, ?court=1). Les 2 premières minutes servent à se
// calmer ; la FC au repos est la moyenne des 3 dernières, et la variabilité cardiaque (RMSSD) se calcule sur les mêmes.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BackButton, BottomAction, Notice } from "../../components/ui";
import { HeartButton, useHeart } from "../../components/HeartButton";
import { saveSession } from "../../lib/data";
import { heart, restingFrom, rrQuality } from "../../lib/heart";
import { hrvCalibration, hrvStatus } from "../../lib/sleep";
import { today } from "../../lib/format";
import { chrono } from "../../lib/format";
import { useApp } from "../../state/app";

export default function RestingHeart() {
  useHeart();
  const [qs] = useSearchParams();
  // « court » : VFC du matin avant une séance (1 min pour se calmer + 2 min de mesure, valide pour le RMSSD d'après
  // Esco et Flatt 2014) ; sinon le test complet de 5 min
  const short = qs.get("court") === "1";
  const SETTLE = short ? 60 : 120;
  const TOTAL = short ? 180 : 300;
  const eventId = qs.get("event");
  const nav = useNavigate();
  const { measurements } = useApp();
  const [phase, setPhase] = useState<"prep" | "run" | "done">("prep");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ rhr: number; hrv: number | null; artifactPct: number } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const startedAt = useRef(0);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const timer = useRef(0);

  const previous = measurements.filter((m) => m.kind === "rhr").sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0];

  useEffect(() => () => { clearInterval(timer.current); wake.current?.release().catch(() => undefined); }, []);

  async function start() {
    try { wake.current = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* veille possible */ }
    startedAt.current = Date.now();
    setSaved(null);
    setElapsed(0);
    setPhase("run");
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(s);
      if (s >= TOTAL) finish();
    }, 500);
  }

  function finish() {
    clearInterval(timer.current);
    wake.current?.release().catch(() => undefined);
    const from = startedAt.current + SETTLE * 1000;
    const samples = heart.between(from);
    const rhr = restingFrom(samples, TOTAL - SETTLE);
    if (rhr == null) { setPhase("prep"); setSaved(`Pas assez de mesures (${samples.length} secondes sur ${TOTAL - SETTLE}) : la ceinture a perdu le contact. Mouille les électrodes et recommence.`); return; }
    const q = rrQuality(heart.rrBetween(from));
    setResult({ rhr, hrv: q.rmssd, artifactPct: q.artifactPct });
    setPhase("done");
  }

  async function save() {
    if (!result) return;
    const status = await saveSession({
      session: { id: crypto.randomUUID(), event_id: eventId, kind: "test", title: short ? "VFC du matin" : "FC au repos", started_at: new Date(startedAt.current).toISOString(), duration_s: TOTAL,
        results: { test: "rhr", testName: short ? "VFC du matin" : "FC au repos", best: result.rhr, unit: "bpm", digits: 0, trials: [result.rhr], hrv: result.hrv }, feeling: null },
      measurements: [
        { kind: "rhr", value: result.rhr, source: "ceinture" },
        ...(result.hrv != null ? [{ kind: "hrv", value: result.hrv, source: "ceinture" }] : []),
      ],
    });
    setSaved(status === "queued" ? "Hors ligne : résultat gardé sur le téléphone." : "FC au repos enregistrée.");
  }

  const connected = heart.state === "connected";
  const settling = elapsed < SETTLE;
  const diff = result && previous ? result.rhr - Number(previous.value) : null;

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 150 }}>
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>{short ? "VFC du matin" : "FC au repos"}</h1>
      <p className="lead">{short
        ? "3 minutes allongé, juste après le réveil, avant de te lever (passe aux toilettes d'abord si besoin), toujours dans la même position. Ta VFC est comparée à ta zone normale pour adapter la séance du jour."
        : "5 minutes allongé, sans bouger ni parler. À faire le matin au réveil, avant de te lever, toujours dans les mêmes conditions."}</p>

      {phase === "prep" ? (
        <div className="col" style={{ gap: 12, marginTop: 16 }}>
          <HeartButton block hint="Mouille les électrodes de la ceinture et mets-la sous les pectoraux, puis connecte-la." />
          {connected ? <RrCheck /> : null}
          <ol className="pb-muted" style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>
            <li>Reste allongé sur le dos, respire normalement.</li>
            <li>{short ? "La première minute" : "Les 2 premières minutes"}, ton cœur se calme : {short ? "elle ne compte" : "elles ne comptent"} pas.</li>
            <li>{short ? "Les 2 minutes suivantes" : "Les 3 minutes suivantes"} donnent ta FC au repos et ta variabilité cardiaque.</li>
          </ol>
          {saved ? <Notice tone="error">{saved}</Notice> : null}
          {previous ? <p className="pb-subtle" style={{ margin: 0, fontSize: 13 }}>Dernière mesure : {Number(previous.value)} bpm.</p> : null}
        </div>
      ) : null}

      {phase === "run" ? (
        <section className="pb-glass" aria-live="polite" style={{ marginTop: 18, padding: "26px 16px", textAlign: "center", display: "grid", gap: 6 }}>
          <span className="pb-num" style={{ fontSize: 64, lineHeight: "68px", fontWeight: 700, color: "var(--cat-match)" }}>{heart.bpm || "–"}<span style={{ fontSize: 22, marginLeft: 6 }}>bpm</span></span>
          <b style={{ fontSize: 15 }}>{settling ? "Installe-toi, ton cœur se calme" : "Mesure en cours, ne bouge pas"}</b>
          <span className="pb-muted pb-num">{chrono(Math.max(0, TOTAL - elapsed))}</span>
          {!connected ? <Notice tone="error">Ceinture déconnectée : la mesure s'arrête.</Notice> : null}
        </section>
      ) : null}

      {phase === "done" && result ? (
        <section className="pb-glass" style={{ marginTop: 18, padding: "22px 16px", display: "grid", gap: 10 }}>
          <div className="row between"><span>FC au repos</span><b className="pb-num" style={{ fontSize: 28 }}>{result.rhr} bpm</b></div>
          <div className="row between"><span>Variabilité cardiaque (RMSSD)</span><b className="pb-num" style={{ fontSize: 20 }}>{result.hrv != null ? `${result.hrv} ms` : "—"}</b></div>
          {diff != null ? <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>{diff < 0 ? `${-diff} bpm de moins que la dernière fois : ton cœur travaille moins pour le même repos.` : diff > 0 ? `${diff} bpm de plus que la dernière fois. Fatigue, mauvaise nuit ou début de maladie la font monter : regarde la tendance sur plusieurs semaines.` : "Identique à la dernière fois."}</p> : null}
          {result.hrv == null ? <p className="pb-subtle" style={{ margin: 0, fontSize: 13 }}>{result.artifactPct > 5 && result.artifactPct < 100
            ? `${String(result.artifactPct).replace(".", ",")} % de battements parasites (contact de la ceinture, mouvement) : la VFC n'est pas fiable, elle n'est pas enregistrée. Mouille les électrodes, serre un peu la ceinture et recommence sans bouger.`
            : "Ta ceinture n'envoie pas les intervalles entre battements : seule la FC est mesurée."}</p> : <HrvVerdict hrv={result.hrv} />}
        </section>
      ) : null}

      <BottomAction>
        {phase === "prep" ? <button className="pb-btn primary lg block" disabled={!connected} onClick={start}>{short ? "Commencer les 3 minutes" : "Commencer les 5 minutes"}</button>
          : phase === "run" ? <button className="pb-btn lg block" onClick={() => { clearInterval(timer.current); setPhase("prep"); }}>Arrêter</button>
          : saved ? <button className="pb-btn primary lg block" onClick={() => nav(-1)}>Terminé</button>
          : <button className="pb-btn primary lg block" onClick={save}>Enregistrer {result?.rhr} bpm</button>}
      </BottomAction>
    </main>
  );
}

/** Résultat du matin face à ta zone normale (moyenne des 30 jours précédents ± 0,5 écart-type). */
function HrvVerdict({ hrv }: { hrv: number }) {
  const { measurements } = useApp();
  const points = [...measurements.filter((m) => m.kind === "hrv").map((m) => ({ value: Number(m.value), measured_at: m.measured_at })), { value: hrv, measured_at: new Date().toISOString() }];
  const d = today();
  const already = measurements.some((m) => m.kind === "hrv" && new Date(m.measured_at).toDateString() === new Date().toDateString());
  const h = hrvStatus(points, d);
  const left = hrvCalibration(points, d);
  if (!h) return <p className="pb-subtle" style={{ margin: 0, fontSize: 13 }}>Encore {left} matin{left > 1 ? "s" : ""} de mesure pour connaître ta zone normale : ta séance n'est adaptée qu'avec ton sommeil d'ici là.</p>;
  return (
    <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>
      Ta zone normale : {h.low} à {h.high} ms · moyenne des 7 derniers jours : {h.week} ms.{" "}
      {already ? "Seule la première mesure du jour compte pour ta forme." : h.drop ? "Forte baisse ce matin : ta séance sera allégée." : h.trendLow ? "Ta VFC baisse depuis plusieurs jours : ta séance sera allégée." : "Tu es dans ta zone normale."}
    </p>
  );
}

/** Avant de commencer : la ceinture envoie-t-elle les intervalles entre battements (indispensables pour la VFC) ? */
function RrCheck() {
  const recent = heart.rrBetween(Date.now() - 10_000).length;
  const since = heart.between(Date.now() - 10_000).length;
  if (since < 5) return null; // connexion toute fraîche : on attend quelques secondes
  return recent
    ? <p className="pb-subtle" style={{ margin: 0, fontSize: 13 }}>Ta ceinture envoie bien les battements un par un : la VFC pourra être calculée.</p>
    : <Notice>Ta ceinture envoie ta FC mais pas encore les intervalles entre battements, nécessaires à la VFC. Mouille bien les électrodes et attends quelques secondes ; si ce message reste, seule ta FC au repos sera mesurée.</Notice>;
}

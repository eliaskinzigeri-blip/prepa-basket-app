// Séance en direct au rameur et changement de mode vers le banc (d'après RameFit).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { IconButton, Notice, Sheet, Spinner } from "../../components/ui";
import { checkRecords, saveSession } from "../../lib/data";
import { chrono, num } from "../../lib/format";
import { ZONES, ageOf, isJunior, refFrom20Min } from "../../lib/rower/plans";
import { hub, reconnectCurrent, reconnectKnownRower } from "../../lib/rower/rower";
import { activeRow, rememberedDevice, type RowSession, type RowSnapshot } from "../../lib/rower/session";
import { useApp } from "../../state/app";
import { useHub } from "./RowerConnect";

export default function RowerLive() {
  const session = activeRow.session;
  if (!session) return <Navigate to="/" replace />;
  return <Running session={session} />;
}

const TARGET = {
  below: { label: "Accélère", hint: "sous la cible", cls: "low" },
  in: { label: "Dans la cible", hint: "tiens ça", cls: "ok" },
  above: { label: "Ralentis", hint: "trop vite", cls: "high" },
  free: { label: "À ton rythme", hint: "régulier", cls: "" },
};

function Running({ session }: { session: RowSession }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { profile, events, reloadEvents, reload } = useApp();
  const nav = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [transition, setTransition] = useState<string | null>(null);
  const saved = useRef(false);

  // Prévient si le joueur ferme la page : la connexion Bluetooth et la séance s'arrêteraient.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (!snap.finished || saved.current) return;
    saved.current = true;
    void finish();
    async function finish() {
      const sum = session.summary();
      const plan = session.plan;
      const { eventId, next } = session.meta;
      const id = crypto.randomUUID();
      const test = sum.test && sum.test.complete && !sum.demo ? sum.test : null;
      const records = test ? await checkRecords([{ key: "rower:20min", value: test.distanceM, better: "higher", label: "Rameur · 20 min", unit: "m" }]).catch(() => []) : [];
      const row = {
        id, event_id: sum.demo ? null : eventId, kind: "workout" as const, title: plan.title, started_at: session.startedAt, duration_s: sum.durationSec,
        results: { rower: plan.kind, ...sum, test: sum.test, records, exercises: 0, sets: 0, volume: 0 }, feeling: null,
      };
      // Rameur simulé : le bilan s'affiche mais rien n'est compté, ni séance validée, ni allure de référence.
      const ev = sum.partial ? events.find((e) => e.id === eventId) : null;
      const status = sum.demo || sum.rowingSec < 30 ? "saved" : await saveSession({
        session: row,
        eventDone: eventId,
        eventPayload: ev ? { ...ev.payload, partial: true } : null,
        measurements: test ? [{ kind: "rower_pace20", value: Math.round(test.paceSec * 10) / 10, source: "manual" }, { kind: "rower_ref", value: Math.round(refFrom20Min(test.paceSec) * 10) / 10, source: "manual" }] : [],
      });
      activeRow.session = null;
      await (test ? reload() : reloadEvents());
      if (next) {
        if (next.bench) setTransition(next.path);
        else nav(next.path, { replace: true });
        return;
      }
      nav(`/recap/${id}`, { replace: true, state: { session: row, queued: status === "queued" } });
    }
  }, [snap.finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (transition) return <Transition junior={isJunior(ageOf(profile))} onReady={() => nav(transition, { replace: true })} />;
  if (snap.finished) return <main className="pb-page screen no-nav"><Spinner label="Enregistrement…" /></main>;
  return (
    <>
      <Live session={session} snap={snap} onExit={() => setLeaving(true)} />
      {leaving ? (
        <Sheet title="Terminer la séance ?" onClose={() => setLeaving(false)}>
          <p style={{ marginTop: 0 }}>Ce que tu as déjà ramé est gardé dans ton bilan, et la séance sera marquée partiellement faite.</p>
          <div className="row">
            <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => setLeaving(false)}>Continuer</button>
            <button className="pb-btn lg danger" style={{ flex: 1 }} onClick={() => { setLeaving(false); session.finishEarly(); }}>Terminer</button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

function LinkPill({ snap }: { snap: RowSnapshot }) {
  useHub();
  const [trying, setTrying] = useState(false);
  async function retry() {
    setTrying(true);
    if (hub.rower) await reconnectCurrent().catch(() => undefined);
    else {
      const known = rememberedDevice();
      if (known) await reconnectKnownRower(known.id).catch(() => undefined);
    }
    setTrying(false);
  }
  const hasHr = hub.hrState === "connected";
  if (snap.link === "connected") return <span className="pill-sm"><span className="sw" style={{ background: "var(--success)" }} />{hub.rower?.isDemo ? "Simulé" : "Rameur"}{hasHr ? " · FC" : ""}</span>;
  if (snap.link === "searching" || trying) return <span className="pill-sm" role="status"><span className="sw" style={{ background: "var(--heat)" }} />Reconnexion…</span>;
  return <button className="pb-btn" onClick={retry}><Icon name="bluetooth" size="sm" />Reconnecter</button>;
}

function Live({ session, snap, onExit }: { session: RowSession; snap: RowSnapshot; onExit: () => void }) {
  const t = TARGET[snap.status];
  const iv = snap.iv;
  const lost = snap.link !== "connected";
  const total = session.plan.seconds;
  const done = total - snap.totalRemaining;
  return (
    <main className="pb-page screen no-nav rw-live" onDoubleClick={(e) => e.preventDefault()}>
      <div className="hdr">
        <IconButton icon="x" label="Terminer la séance" small onClick={onExit} />
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          <div className="pb-subtle" style={{ fontSize: 13 }}>Bloc {snap.index + 1} / {snap.count}</div>
          <h1 style={{ margin: 0, font: "600 15px/20px var(--font-sans)" }}>{iv.label}</h1>
        </div>
        <LinkPill snap={snap} />
      </div>
      <div className="rw-progress" role="progressbar" aria-label="Avancement de la séance" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(done)}><i style={{ width: `${(done / total) * 100}%` }} /></div>

      {lost ? <Notice tone="error">Connexion coupée : le temps est arrêté. Rame quelques coups pour réveiller la console, puis reconnecte.</Notice> : null}

      <div className="rw-time">
        <div><span className="lbl">Reste</span><b className="pb-num" role="timer">{chrono(Math.ceil(snap.remaining))}</b></div>
        <div style={{ textAlign: "right" }}><span className="lbl">Séance</span><b className="pb-num">{chrono(Math.ceil(snap.totalRemaining))}</b></div>
      </div>

      <div className="rw-pace">
        <span className="lbl">Allure /500 m{snap.target && iv.zone ? ` · ${ZONES[iv.zone].short} · ${chrono(snap.target[0])}–${chrono(snap.target[1])}` : ""}</span>
        <b className="pb-num">{snap.paceSec ? chrono(snap.paceSec) : "–:––"}</b>
      </div>
      <div className={`rw-target ${t.cls}`}><b role="status">{snap.paused ? "En pause" : lost ? "En attente du rameur" : t.label}</b><span aria-hidden="true">{snap.paused || lost ? "" : t.hint}</span></div>

      {snap.hrAlert ? <Notice tone="error">Cœur très haut. Ralentis, et arrête-toi si tu te sens mal.</Notice> : null}
      {snap.lowCadence ? <Notice>Rame à 22 coups par minute au moins, sinon la console peut s'éteindre.</Notice> : null}
      {snap.notice ? <Notice>{snap.notice}</Notice> : null}

      <div className="grid2" style={{ marginTop: 2 }}>
        <div className="pb-glass pb-stat" style={{ padding: 12 }}><span className="k">Cadence</span><span className="v" style={{ fontSize: 26 }}>{snap.spm || "–"}<small>coups/min</small></span><span className="pb-subtle" style={{ fontSize: 12 }}>cible {iv.spm[0]}–{iv.spm[1]}</span></div>
        <div className="pb-glass pb-stat" style={{ padding: 12 }}><span className="k">Cœur</span><span className="v" style={{ fontSize: 26 }}>{snap.hr || "–"}<small>{snap.hr ? "bpm" : ""}</small></span><span className="pb-subtle" style={{ fontSize: 12 }}>{snap.hr ? " " : "sans ceinture"}</span></div>
      </div>

      <div className="pb-glass rw-res">
        <div><span className="lbl">{snap.coach ? "Règle la molette sur" : "Résistance"}</span><b className="pb-num">{num(snap.level)}<small> / 15</small></b></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="pb-btn" aria-label="Résistance moins un" disabled={snap.level <= 1} onClick={() => session.nudge(-1)}>−1</button>
          <button className="pb-btn" aria-label="Résistance plus un" disabled={snap.level >= 8} onClick={() => session.nudge(1)}>+1</button>
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginTop: "auto", paddingTop: 10 }}>
        <button className="pb-btn primary lg" style={{ flex: 1 }} onClick={() => session.togglePause()}><Icon name={snap.paused ? "play" : "pause"} size="sm" />{snap.paused ? "Reprendre" : "Pause"}</button>
        <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => session.skip()}>{snap.index + 1 < snap.count ? "Bloc suivant" : "Terminer"}<Icon name="right" size="sm" /></button>
      </div>
    </main>
  );
}

/** Gestes de la notice Domyos Woodrower (pages sécurité et pliage). */
const FOLD = [
  "Pose la poignée sur son support et retire ton téléphone du support.",
  "Débloque le verrou à grenouillère et ramène la selle vers l'avant.",
  "Avec la poignée arrière, replie le rameur doucement.",
  "Prends ton matériel pour la séance.",
];

function Transition({ junior, onReady }: { junior: boolean; onReady: () => void }) {
  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 30 }}>
      <div className="lbl" style={{ marginTop: 6 }}>Changement de mode</div>
      <h1 className="t" style={{ margin: "10px 0 14px" }}>Replie le rameur en banc</h1>
      <figure className="pb-glass" style={{ margin: 0, padding: 16 }}>
        <svg role="img" aria-label="Schéma : la partie arrière du rameur se rabat sur la partie avant et forme un banc fermé" viewBox="0 0 322 130" style={{ width: "100%", height: "auto", display: "block" }} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 112h298" stroke="rgba(255,255,255,.3)" strokeWidth="1.5" />
          <rect x="52" y="60" width="118" height="46" rx="6" stroke="currentColor" strokeWidth="3" />
          <path d="M52 83h118M64 106v6M158 106v6" stroke="currentColor" strokeWidth="3" />
          <path d="M170 98h124" stroke="rgba(255,255,255,.4)" strokeWidth="3" strokeDasharray="6 7" />
          <path d="M280 80c-50-44-116-58-160-34M128 40l-8 6 10 3" stroke="var(--primary-bright)" strokeWidth="2" />
        </svg>
        <figcaption className="pb-muted" style={{ fontSize: 13, marginTop: 8 }}>La partie arrière se rabat : le rameur devient un banc fermé.</figcaption>
      </figure>
      <ol className="pb-glass" style={{ padding: "4px 0", margin: "12px 0", listStyle: "none" }}>
        {FOLD.map((s, i) => <li key={s} className="pb-li"><b className="pb-num" style={{ width: 22, color: "var(--primary-bright)" }}>{i + 1}</b><div className="t" style={{ fontWeight: 400 }}>{s}</div></li>)}
      </ol>
      <div className="col" style={{ gap: 10 }}>
        {junior ? <Notice>Fais cette manipulation avec un adulte : le rameur pèse plus de 60 kg.</Notice> : null}
        <Notice>Chaussures obligatoires dans tous les modes.</Notice>
      </div>
      <button className="pb-btn primary lg block" style={{ marginTop: 14 }} onClick={onReady}>C'est prêt</button>
    </main>
  );
}

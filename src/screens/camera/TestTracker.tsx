// Tests athlétiques trackés par la caméra (US11) : détente, saut sans élan, sprint 10/20 m, agilité.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { jump3D, visionCaps } from "../../native/vision";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useApp } from "../../state/app";
import { Icon } from "../../components/Icon";
import { IconButton, Notice } from "../../components/ui";
import { test as testDef } from "../../data/catalog";
import { checkRecords, getRecord, saveSession } from "../../lib/data";
import { supabase } from "../../lib/supabase";
import { num } from "../../lib/format";
import { brightness, LM, loadPose } from "../../vision/models";
import { cameraError, countdown, frameLoop, recorder, speak, startCamera, stopCamera } from "../../vision/media";
import { JumpMeter, type JumpFrame } from "../../vision/jump";
import { Check, makeMapper, markWarmed, WarmupGate, warmedRecently } from "./common";

type Phase = "setup" | "calib" | "count" | "trial" | "result" | "done";
interface Trial { value: number | null; blob: Blob | null; reason?: string; info?: string }

export default function TestTracker() {
  const { testId = "vertical" } = useParams();
  const [qs] = useSearchParams();
  const eventId = qs.get("event");
  const def = testDef(testId) ?? testDef("vertical")!;
  const { profile, measurements } = useApp();
  const nav = useNavigate();
  const isPose = def.kind !== "lines";
  const facing: "user" | "environment" = def.kind === "pose-jump" ? "user" : "environment";
  const [phase, setPhase] = useState<Phase>("setup");
  const [warmed, setWarmed] = useState(warmedRecently);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [checks, setChecks] = useState({ light: false, body: false, still: false });
  const [lines, setLines] = useState<[number, number]>([0.2, 0.8]); // positions écran normalisées
  const [count, setCount] = useState<number | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [slowmo, setSlowmo] = useState<number | null>(null);
  const [record, setRecord] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // App iPhone : détente mesurée avec le suivi du corps en 3D d'Apple (ARKit, caméra arrière)
  const [body3d, setBody3d] = useState(false);
  const [native3d, setNative3d] = useState(false);
  useEffect(() => { if (def.kind === "pose-jump") visionCaps().then((c) => setBody3d(c.bodyTracking)); }, [def.kind]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratch = useRef(document.createElement("canvas"));
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoop = useRef<() => void>(() => undefined);
  const S = useRef({
    phase: "setup" as Phase, lastCheck: 0, hips: [] as number[], ankX: [] as number[], pxPerCm: 0, baseHip: 0, startX: 0,
    minHip: Infinity, baseAnk: 0, baseTorso: 0, jump: null as JumpMeter | null, trace: [] as number[][], takeoff: 0, landing: 0, moved: false, stableSince: 0, lastAnk: 0, landX: 0, trialStart: 0, goAt: 0,
    prevGray: null as Uint8ClampedArray | null, energy: [[], []] as number[][], crossed: [0, 0] as number[], prevE: [0, 0], prevT: 0,
  });
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const height = profile?.height_cm ?? 175;

  useEffect(() => {
    getRecord(`test:${def.id}`).then(setRecord);
    return () => { stopLoop.current(); stopCamera(streamRef.current); };
  }, [def.id]);

  async function openCamera() {
    setPhase("calib");
    S.current.phase = "calib";
    setError(null);
    try {
      setLoading("Démarrage de la caméra…");
      streamRef.current = await startCamera(videoRef.current!, facing);
      setLoading(isPose ? "Chargement du suivi du corps…" : null);
      const pose = isPose ? await loadPose() : null;
      setLoading(null);
      let last = 0;
      stopLoop.current = frameLoop(videoRef.current!, (now) => {
        const v = videoRef.current, c = canvasRef.current;
        if (!v || !c || v.readyState < 2) return;
        const ts = performance.now();
        if (ts - last < 10) return;
        last = ts;
        const W = (c.width = c.clientWidth * devicePixelRatio) / devicePixelRatio;
        const H = (c.height = c.clientHeight * devicePixelRatio) / devicePixelRatio;
        const ctx = c.getContext("2d")!;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const m = makeMapper(v, W, H, facing === "user");
        if (pose) poseFrame(pose.detectForVideo(v, ts).landmarks[0] ?? null, v, ctx, m, ts, now);
        else linesFrame(v, ctx, W, H, ts, now);
      });
    } catch (e) {
      setLoading(null);
      setError(cameraError(e));
    }
  }

  // ——— Détente et saut en longueur : suivi du corps (pose) ———
  function poseFrame(l: NormalizedLandmark[] | null, v: HTMLVideoElement, ctx: CanvasRenderingContext2D, m: ReturnType<typeof makeMapper>, ts: number, now: number) {
    const st = S.current;
    const vh = v.videoHeight, vw = v.videoWidth;
    if (l) drawBody(ctx, m, l);
    const vis = (i: number) => (l?.[i]?.visibility ?? 0) > 0.5;
    const full = Boolean(l) && vis(LM.nose) && vis(LM.lAnkle) && vis(LM.rAnkle);
    const hip = l ? ((l[LM.lHip].y + l[LM.rHip].y) / 2) * vh : 0;
    const ankX = l ? ((l[LM.lHeel].x + l[LM.rHeel].x) / 2) * vw : 0;
    // point le plus bas des pieds (talons et orteils) et longueur du buste, pour la détente
    const frame = (): JumpFrame => ({
      t: ts, hip,
      foot: Math.max(l![LM.lHeel].y, l![LM.rHeel].y, l![LM.lToe].y, l![LM.rToe].y) * vh,
      torso: Math.hypot(((l![LM.lShoulder].x + l![LM.rShoulder].x - l![LM.lHip].x - l![LM.rHip].x) / 2) * vw, ((l![LM.lShoulder].y + l![LM.rShoulder].y) / 2) * vh - hip),
    });
    if (st.phase === "calib" || st.phase === "result") {
      if (full) { st.hips.push(hip); st.ankX.push(ankX); if (st.hips.length > 30) { st.hips.shift(); st.ankX.shift(); } }
      const spread = st.hips.length >= 20 ? Math.max(...st.hips) - Math.min(...st.hips) : 999;
      const still = full && spread < vh * 0.012;
      if (still && l) {
        const top = l[LM.nose].y * vh, foot = Math.max(l[LM.lAnkle].y, l[LM.rAnkle].y) * vh;
        // nez → chevilles ≈ 89 % de la taille : échelle px/cm à partir de la taille du profil.
        st.pxPerCm = def.kind === "pose-broad" ? Math.abs(foot - top) / (height * 0.89) : (foot - top) / (height * 0.89);
        st.baseHip = [...st.hips].sort((a, b) => a - b)[Math.floor(st.hips.length / 2)];
        st.baseAnk = foot;
        if (def.kind === "pose-jump") { const f = frame(); st.baseAnk = f.foot; st.baseTorso = f.torso; }
        st.startX = [...st.ankX].sort((a, b) => a - b)[Math.floor(st.ankX.length / 2)];
      }
      if (Math.floor(now / 250) !== st.lastCheck) {
        st.lastCheck = Math.floor(now / 250);
        setChecks({ light: brightness(v, scratch.current) > 55, body: full, still });
      }
      return;
    }
    // diagnostic : chaque image du compte à rebours et de l'essai (temps, pieds, hanches, buste, visibilité des pieds)
    if ((st.phase === "count" || st.phase === "trial") && l && def.kind === "pose-jump" && st.trace.length < 600) {
      const f = frame();
      const footVis = Math.min(...[LM.lHeel, LM.rHeel, LM.lToe, LM.rToe, LM.lAnkle, LM.rAnkle].map((i) => l[i].visibility ?? 0));
      st.trace.push([Math.round(ts), Math.round(f.foot), Math.round(f.hip), Math.round(f.torso), Math.round(footVis * 100), st.phase === "trial" ? 1 : 0, full ? 1 : 0]);
    }
    if (st.phase === "count" && l && full && def.kind === "pose-jump") st.jump?.settle(frame());
    if (st.phase !== "trial" || !l) return;
    const t = ts - st.goAt;
    if (def.kind === "pose-jump") {
      const res = st.jump?.push(frame());
      if (res) endTrial(res.cm, res.reason, res.info);
    } else {
      const disp = Math.min(Math.abs(l[LM.lHeel].x * vw - st.startX), Math.abs(l[LM.rHeel].x * vw - st.startX));
      if (disp > st.pxPerCm * 30) st.moved = true;
      if (st.moved && Math.abs(ankX - st.lastAnk) < vw * 0.004) { if (!st.stableSince) st.stableSince = ts; } else st.stableSince = 0;
      st.lastAnk = ankX;
      if (st.moved && st.stableSince && ts - st.stableSince > 600) {
        const d = disp / st.pxPerCm - height * 0.15; // talon → talon, moins la longueur du pied
        endTrial(Math.round(Math.max(0, d)));
      } else if (t > 6000) endTrial(null);
    }
  }

  // ——— Sprint et agilité : passage des lignes par différence d'images ———
  function linesFrame(v: HTMLVideoElement, ctx: CanvasRenderingContext2D, W: number, H: number, ts: number, now: number) {
    const st = S.current;
    const [a, b] = linesRef.current;
    const single = def.id === "agility";
    ctx.lineWidth = 3;
    [a, ...(single ? [] : [b])].forEach((x, i) => {
      ctx.strokeStyle = i === 0 ? "#3ddc97" : "#f3e9d2";
      ctx.beginPath(); ctx.moveTo(x * W, 0); ctx.lineTo(x * W, H); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = "600 13px Inter"; ctx.fillText(i === 0 ? (single ? "Départ / arrivée" : "Départ") : "Arrivée", x * W + 6, 90);
    });
    // énergie de mouvement dans une bande étroite autour de chaque ligne (image réduite 160 px)
    const GW = 160, GH = Math.round((160 * v.videoHeight) / v.videoWidth) || 90;
    const sc = scratch.current; sc.width = GW; sc.height = GH;
    const g = sc.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(v, 0, 0, GW, GH);
    const d = g.getImageData(0, 0, GW, GH).data;
    const gray = new Uint8ClampedArray(GW * GH);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) gray[p] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    const m = makeMapper(v, W, H, false);
    const energies = [a, b].map((x) => {
      if (!st.prevGray) return 0;
      const cx = Math.round(m.nx(x * W) * GW), half = 2;
      let e = 0;
      for (let y = Math.round(GH * 0.15); y < GH * 0.95; y++) for (let k = cx - half; k <= cx + half; k++) if (k >= 0 && k < GW) e += Math.abs(gray[y * GW + k] - st.prevGray[y * GW + k]);
      return e / (GH * (2 * half + 1));
    });
    st.prevGray = gray;
    if ((st.phase === "calib" || st.phase === "result") && Math.floor(now / 250) !== st.lastCheck) {
      st.lastCheck = Math.floor(now / 250);
      setChecks({ light: brightness(v, sc) > 55, body: true, still: Math.max(...energies) < 6 });
    }
    if (st.phase === "count") { st.energy.forEach((list, i) => { list.push(energies[i]); if (list.length > 60) list.shift(); }); }
    if (st.phase === "trial") {
      const thr = st.energy.map((list) => { const mean = list.reduce((s, x) => s + x, 0) / Math.max(1, list.length); const sd = Math.sqrt(list.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, list.length)); return Math.max(6, mean + 5 * sd); });
      const cross = (i: number) => {
        // interpolation entre deux images pour viser le centième
        const k = (thr[i] - st.prevE[i]) / Math.max(0.001, energies[i] - st.prevE[i]);
        return st.prevT + Math.min(1, Math.max(0, k)) * (ts - st.prevT);
      };
      if (!st.crossed[0] && energies[0] > thr[0]) st.crossed[0] = cross(0);
      if (single) {
        // agilité : le joueur repart de la ligne, puis la franchit à nouveau au retour (≥ 4 s plus tard)
        if (st.crossed[0] && !st.crossed[1] && ts - st.crossed[0] > 4000 && energies[0] > thr[0]) st.crossed[1] = cross(0);
      } else if (st.crossed[0] && !st.crossed[1] && energies[1] > thr[1]) st.crossed[1] = cross(1);
      st.prevE = energies; st.prevT = ts;
      if (st.crossed[1]) endTrial(Math.round((st.crossed[1] - st.crossed[0]) / 10) / 100);
      else if (ts - st.goAt > 15000) endTrial(null);
    } else { st.prevE = energies; st.prevT = ts; }
  }

  async function startTrial() {
    const st = S.current;
    setChecks({ light: false, body: false, still: false });
    st.trace = [];
    Object.assign(st, { phase: "count", goAt: 0, minHip: Infinity, takeoff: 0, landing: 0, moved: false, stableSince: 0, energy: [[], []], crossed: [0, 0] });
    setPhase("count");
    const rec = recorder(streamRef.current!);
    (st as { rec?: ReturnType<typeof recorder> }).rec = rec;
    const words = def.kind === "lines" ? ["À vos marques", "Prêt"] : ["3", "2", "1"];
    if (def.kind === "pose-jump") st.jump = new JumpMeter(st.pxPerCm);
    st.goAt = await countdown(setCount, words, def.kind === "lines" ? "Partez !" : "Saute !");
    setTimeout(() => setCount(null), 600);
    st.jump?.begin(performance.now(), { foot: st.baseAnk, torso: st.baseTorso, hip: st.baseHip });
    st.phase = "trial";
    setPhase("trial");
  }

  async function endTrial(value: number | null, reason?: string, info?: string) {
    const st = S.current;
    if (st.phase !== "trial") return;
    st.phase = "result";
    if (def.kind === "pose-jump") {
      const v = videoRef.current;
      supabase.from("debug_traces").insert({ kind: "jump", data: { value, reason: reason ?? null, info: info ?? null, goAt: Math.round(st.goAt), pxPerCm: st.pxPerCm, baseFoot: st.baseAnk, baseHip: st.baseHip, baseTorso: st.baseTorso,
        vw: v?.videoWidth, vh: v?.videoHeight, height, cols: ["t", "foot", "hip", "torso", "footVis", "trial", "full"], frames: st.trace } }).then(() => undefined, () => undefined);
    }
    const blob = await (st as { rec?: ReturnType<typeof recorder> }).rec?.stop() ?? null;
    speak(value == null ? `Essai non mesuré. ${reason ?? ""}` : `${num(value, def.digits)} ${def.unit === "s" ? "secondes" : "centimètres"}`);
    setTrials((list) => [...list, { value, blob, reason, info }]);
    setPhase("result");
  }

  const valid = trials.map((t) => t.value).filter((v): v is number => v != null);
  const best = valid.length ? (def.better === "higher" ? Math.max(...valid) : Math.min(...valid)) : null;
  const prev = measurements.filter((x) => x.kind === def.id).sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0]?.value ?? null;
  const last = trials.at(-1);

  async function run3D() {
    const r = await jump3D(3).catch((e: Error) => { setError(e.message); return null; });
    if (!r || r.cancelled) return;
    setNative3d(true);
    supabase.from("debug_traces").insert({ kind: "jump3d", data: { trials: r.trials, reasons: r.reasons, statureM: r.statureM, height } }).then(() => undefined, () => undefined);
    setTrials(r.trials.map((value, i) => ({ value, blob: null, reason: value == null ? r.reasons[i] || "Essai non mesuré" : undefined })));
    S.current.phase = "result";
    setPhase("result");
  }

  async function finish() {
    setPhase("done");
    stopLoop.current();
    stopCamera(streamRef.current);
    if (best == null) return setSaved("Aucun essai mesuré : rien n'a été enregistré.");
    const records = await checkRecords([{ key: `test:${def.id}`, value: best, better: def.better, label: def.name, unit: def.unit }]).catch(() => []);
    const id = crypto.randomUUID();
    const status = await saveSession({
      session: { id, event_id: eventId, kind: "test", title: def.name, started_at: new Date().toISOString(), duration_s: null,
        results: { test: def.id, testName: def.name, best, unit: def.unit, digits: def.digits, trials: trials.map((t) => t.value), records, ...(native3d ? { method: "arkit3d" } : {}) }, feeling: null },
      measurements: [{ kind: def.id, value: best, source: "camera" }],
    });
    setSaved(status === "queued" ? "Hors ligne : résultat gardé sur le téléphone." : records.length ? "Nouveau record enregistré." : "Résultat enregistré.");
  }

  function dragLine(e: RPointerEvent<HTMLDivElement>) {
    if (phase !== "calib" || def.kind !== "lines") return;
    const b = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width;
    const i = def.id === "agility" || Math.abs(x - lines[0]) < Math.abs(x - lines[1]) ? 0 : 1;
    setLines((l) => (i === 0 ? [x, l[1]] : [l[0], x]));
  }

  const ready = checks.light && checks.body && checks.still;
  // Mains libres : le joueur est loin du téléphone. Dès qu'il est en place et immobile 2 s, l'essai part tout seul ;
  // après le 3e essai, le test se valide tout seul.
  const autoStart = (phase === "calib" || (phase === "result" && trials.length < 3)) && ready && slowmo == null;
  useEffect(() => {
    if (!autoStart) return;
    const id = window.setTimeout(startTrial, phase === "result" ? 3000 : 2000);
    return () => window.clearTimeout(id);
  }, [autoStart, phase, trials.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== "result" || trials.length < 3 || slowmo != null) return;
    const id = window.setTimeout(() => { finish(); speak(best != null ? `Test terminé. Meilleur essai : ${num(best, def.digits)} ${def.unit === "s" ? "secondes" : "centimètres"}` : "Test terminé"); }, 3000);
    return () => window.clearTimeout(id);
  }, [phase, trials.length, slowmo]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cam-screen pb-cam">
      <video ref={videoRef} className={facing === "user" ? "mirror" : ""} playsInline muted aria-hidden="true" />
      <canvas ref={canvasRef} className="overlay" aria-hidden="true" />
      <div style={{ position: "absolute", inset: 0, zIndex: 3 }} onPointerDown={dragLine} onPointerMove={(e) => e.buttons && dragLine(e)} aria-hidden="true" />
      <div className="cam-top">
        <IconButton icon="x" label="Quitter le test" onClick={() => nav(-1)} style={{ background: "var(--camera-scrim)" }} />
        <div className="pb-hud" style={{ flex: 1 }}>
          <Icon name={def.kind === "lines" ? "timer" : "bolt"} style={{ color: "var(--primary-bright)" }} />
          <div><b style={{ fontSize: 15 }}>{def.name}</b><div className="pb-muted" style={{ fontSize: 12 }}>Essai {Math.min(trials.length + (phase === "result" || phase === "done" ? 0 : 1), 3)} / 3{record != null ? ` · record ${num(record, def.digits)} ${def.unit}` : ""}</div></div>
        </div>
      </div>
      {count != null ? <div className="cam-center"><span className="countdown" aria-live="assertive" style={{ fontSize: count ? 120 : 64 }}>{count || (def.kind === "lines" ? "Partez !" : "Saute !")}</span></div> : null}
      {loading ? <div className="cam-center"><div className="pb-hud"><span className="spinner" />{loading}</div></div> : null}
      {slowmo != null && trials[slowmo]?.blob ? <SlowMo blob={trials[slowmo].blob!} label={`${num(trials[slowmo].value, def.digits)} ${def.unit}`} onClose={() => setSlowmo(null)} /> : null}

      <div className="cam-bottom">
        {phase === "setup" ? (
          <div className="pb-glass hero" style={{ padding: 16, background: "rgba(13,27,77,.94)" }}>
            <h1 className="t" style={{ fontSize: 22 }}>Mise en place</h1>
            <ol style={{ margin: "8px 0 12px", paddingLeft: 20, display: "grid", gap: 6, fontSize: 14, lineHeight: "20px" }}>{def.setup.map((s) => <li key={s}>{s}</li>)}</ol>
            {!profile?.height_cm && isPose ? <Notice tone="error">Renseigne ta taille dans ton profil : elle sert à calculer la mesure.</Notice> : null}
            {warmed ? (
              <div className="col" style={{ gap: 8 }}>
                {body3d ? <button className="pb-btn primary lg block" onClick={run3D}><Icon name="bolt" size="sm" />Mesurer en 3D (suivi du corps Apple)</button> : null}
                {body3d ? <span className="pb-muted" style={{ fontSize: 12 }}>Plus précis : pose le téléphone face à toi, écran vers le mur, à 3 m. Une voix te guide pour les 3 essais.</span> : null}
                {error && body3d ? <Notice tone="error">{error}</Notice> : null}
                <button className={`pb-btn lg block${body3d ? "" : " primary"}`} onClick={openCamera}><Icon name="video" size="sm" />{body3d ? "Mesurer avec la caméra avant" : "Calibrer la caméra"}</button>
              </div>
            ) : <WarmupGate onDone={() => { markWarmed(); setWarmed(true); if (!body3d) openCamera(); }} />}
          </div>
        ) : null}
        {phase === "calib" ? (
          <div className="pb-glass" style={{ padding: 16, background: "rgba(13,27,77,.88)" }}>
            <b style={{ fontSize: 16 }}>Calibrage</b>
            <div className="col" style={{ gap: 10, marginTop: 10 }}>
              <Check ok={checks.light} label="Lumière suffisante" hint="évite le contre-jour" />
              {isPose ? <Check ok={checks.body} label="Tout ton corps est visible" hint="recule ou recadre" /> : <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Fais glisser {def.id === "agility" ? "la ligne" : "les lignes"} sur {def.id === "agility" ? "le plot de départ" : "les plots de départ et d'arrivée"}.</p>}
              <Check ok={checks.still} label={isPose ? "Immobile, bien droit" : "Personne dans les zones de passage"} hint={isPose ? "ne bouge plus 1 s" : "dégage les lignes"} />
            </div>
            {error ? <div style={{ marginTop: 12 }} className="col"><Notice tone="error">{error}</Notice><button className="pb-btn" onClick={() => { stopLoop.current(); stopCamera(streamRef.current); openCamera(); }}>Réessayer</button></div> : null}
            <p className="pb-muted" role="status" style={{ margin: "12px 0 0", fontSize: 13 }}>{ready ? "C'est bon, ne bouge plus : l'essai démarre tout seul." : "Mets-toi en place : l'essai démarre tout seul, pas besoin de revenir au téléphone."}</p>
            <button className="pb-btn primary lg block cam-btn" style={{ marginTop: 10 }} disabled={!ready} onClick={startTrial}>Lancer l'essai 1</button>
          </div>
        ) : null}
        {phase === "trial" ? <div className="pb-hud" style={{ justifyContent: "center" }}><span className="spinner" />Mesure en cours…</div> : null}
        {phase === "result" || phase === "done" ? (
          <div className="pb-glass hero" style={{ background: "rgba(13,27,77,.94)" }}>
            <div style={{ padding: 16, textAlign: "center" }}>
              <div className="lbl">{phase === "done" ? "Meilleur essai" : "Résultat"}</div>
              <div className="pb-num" style={{ fontSize: 56, fontWeight: 600, letterSpacing: "-.02em", lineHeight: "64px" }}>
                {(phase === "done" ? best : last?.value) != null ? num((phase === "done" ? best : last?.value)!, def.digits) : "—"}<span style={{ fontSize: 22, color: "var(--ink-muted)" }}> {def.unit}</span>
              </div>
              {phase === "result" && last?.value == null ? <p className="pb-muted" style={{ margin: 0, fontSize: 13 }}>{last?.reason ?? "Essai non mesuré : reste bien dans le cadre."}{last?.info ? <><br /><span className="pb-subtle" style={{ fontSize: 11 }}>{last.info}</span></> : null}</p> : null}
              {best != null && prev != null ? <DeltaInline diff={best - prev} better={def.better} digits={def.digits} unit={def.unit} isRecord={record == null || (def.better === "higher" ? best > record : best < record)} /> : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, padding: "0 16px 14px" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="pb-glass inset" style={{ padding: 10, textAlign: "center", borderRadius: 14, borderColor: trials[i]?.value != null && trials[i].value === best ? "var(--primary-bright)" : undefined }}>
                  <div className="pb-subtle" style={{ fontSize: 12 }}>Essai {i + 1}</div><b className={`pb-num${trials[i]?.value == null ? " pb-subtle" : ""}`}>{trials[i]?.value != null ? num(trials[i].value!, def.digits) : "—"}</b>
                </div>
              ))}
            </div>
            {phase === "result" ? <p className="pb-muted" role="status" style={{ textAlign: "center", fontSize: 13, margin: "0 16px 12px" }}>{trials.length < 3 ? (ready ? "Essai suivant dans un instant…" : "Reviens en place et ne bouge plus : l'essai suivant part tout seul.") : "Validation automatique…"}</p> : null}
            {phase === "done" && trials.some((x) => x.value == null) ? (
              <ul className="pb-muted" style={{ margin: "0 16px 12px", paddingLeft: 18, fontSize: 12, display: "grid", gap: 4 }}>
                {trials.map((x, i) => x.value == null ? <li key={i}>Essai {i + 1} : {x.reason ?? "non mesuré"}{x.info ? ` (${x.info})` : ""}</li> : null)}
              </ul>
            ) : null}
            {saved ? <p className="pb-muted" style={{ textAlign: "center", fontSize: 13, margin: "0 16px 12px" }}>{saved}</p> : null}
            <div style={{ display: "flex", gap: 10, padding: "0 16px 16px" }}>
              {phase === "result" && last?.blob ? <button className="pb-btn" style={{ flex: 1 }} onClick={() => setSlowmo(trials.length - 1)}><Icon name="play" size="sm" />Ralenti</button> : null}
              {phase === "result" ? (trials.length < 3
                ? <button className="pb-btn primary" style={{ flex: 1.4 }} onClick={startTrial}>Essai suivant</button>
                : <button className="pb-btn primary" style={{ flex: 1.4 }} onClick={finish}>Valider le test</button>)
                : <button className="pb-btn primary lg block" onClick={() => nav(`/tests${eventId ? `?event=${eventId}` : ""}`, { replace: true })}>Test suivant</button>}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeltaInline({ diff, better, digits, unit, isRecord }: { diff: number; better: "higher" | "lower"; digits: number; unit: string; isRecord: boolean }) {
  const progress = better === "higher" ? diff > 0 : diff < 0;
  if (Math.abs(diff) < Math.pow(10, -digits) / 2) return <span className="pb-muted" style={{ fontSize: 13 }}>Identique à ta dernière mesure</span>;
  return <span className={`pb-delta ${progress ? "up" : "down"}`}>{diff > 0 ? "▲" : "▼"} {num(Math.abs(diff), digits)} {unit}{isRecord && progress ? " · record" : ""}</span>;
}

function SlowMo({ blob, label, onClose }: { blob: Blob; label: string; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [url] = useState(() => URL.createObjectURL(blob));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="cam-screen" style={{ zIndex: 30 }} role="dialog" aria-modal="true" aria-label="Ralenti de l'essai">
      <video ref={ref} src={url} autoPlay playsInline muted loop style={{ objectFit: "contain" }} onLoadedData={() => { if (ref.current) ref.current.playbackRate = 0.25; }} />
      <div className="cam-top"><button className="pb-icon-btn" aria-label="Fermer le ralenti" onClick={onClose} style={{ background: "var(--camera-scrim)" }}><Icon name="x" /></button><div className="pb-hud">Ralenti ×0,25</div></div>
      <div className="cam-center"><span className="pb-num" style={{ fontSize: 56, fontWeight: 700, color: "var(--heat)", textShadow: "0 4px 24px rgba(0,0,0,.7)", alignSelf: "end", marginBottom: 120 }}>{label}</span></div>
    </div>
  );
}

function drawBody(ctx: CanvasRenderingContext2D, m: ReturnType<typeof makeMapper>, l: NormalizedLandmark[]) {
  const seg = [[LM.lShoulder, LM.rShoulder], [LM.lShoulder, LM.lHip], [LM.rShoulder, LM.rHip], [LM.lHip, LM.rHip], [LM.lHip, 25], [25, LM.lAnkle], [LM.rHip, 26], [26, LM.rAnkle], [LM.lShoulder, LM.lElbow], [LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow], [LM.rElbow, LM.rWrist]];
  ctx.strokeStyle = "#3ddc97"; ctx.lineWidth = 3; ctx.lineCap = "round";
  for (const [a, b] of seg) { ctx.beginPath(); ctx.moveTo(m.x(l[a].x), m.y(l[a].y)); ctx.lineTo(m.x(l[b].x), m.y(l[b].y)); ctx.stroke(); }
  ctx.fillStyle = "#fff";
  for (const i of [LM.nose, LM.lHip, LM.rHip, LM.lAnkle, LM.rAnkle]) { ctx.beginPath(); ctx.arc(m.x(l[i].x), m.y(l[i].y), 5, 0, Math.PI * 2); ctx.fill(); }
}

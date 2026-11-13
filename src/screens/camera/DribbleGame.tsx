// Jeux de dribble interactifs (US8) : la caméra suit le ballon et les mains, des cibles s'affichent à toucher.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { supabase } from "../../lib/supabase";
import { withAmbiIndex } from "../../lib/ambi";
import { useApp } from "../../state/app";
import { Icon } from "../../components/Icon";
import { Chip, IconButton, Notice, Toggle } from "../../components/ui";
import { game as gameDef } from "../../data/catalog";
import { checkRecords, getRecord, saveSession } from "../../lib/data";
import { chrono, num } from "../../lib/format";
import { bounceCounter, brightness, LM } from "../../vision/models";
import { startVision, type TeachResult } from "../../vision/engine";
import { cameraError, countdown, frameLoop, hitSound, missSound, speak, startCamera, stopCamera } from "../../vision/media";
import { Check, makeMapper, markWarmed, WarmupGate, warmedRecently, type Mapper } from "./common";

type Phase = "setup" | "calib" | "count" | "play" | "done";
type Spot = "G" | "D" | "B" | "J";
interface Target { spot: Spot; x: number; y: number; born: number; life: number; hit?: number }
const SPOT_LABEL: Record<Spot, string> = { G: "G", D: "D", B: "↓", J: "∩" };
const SPOT_NAME: Record<Spot, string> = { G: "gauche", D: "droite", B: "en bas", J: "entre les jambes" };
const DURATION: Record<string, number> = { reflexes: 45, main_faible: 45, crossover: 60, sequence: 90, ambi: 40 };
const HOLD_MS = 3000; // immobile ce temps-là, tout calibré : la partie se lance toute seule
const AMBI_HALF = 20; // test main faible : 20 s main faible, puis 20 s main forte

export default function DribbleGame() {
  const { game: gameId = "reflexes" } = useParams();
  const [qs] = useSearchParams();
  const eventId = qs.get("event");
  const def = gameDef(gameId) ?? gameDef("reflexes")!;
  const { profile, events, measurements } = useApp();
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>("setup");
  const [home, setHome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [checks, setChecks] = useState({ light: false, body: false, ball: false });
  const [hold, setHold] = useState<number | null>(null); // secondes restantes avant le lancement automatique
  const [count, setCount] = useState<number | null>(null);
  const [hud, setHud] = useState({ score: 0, time: 0, dribbles: 0, rate: 0, hits: 0, targets: 0, left: 0, right: 0 });
  const [record, setRecord] = useState<number | null>(null);
  const [result, setResult] = useState<{ score: number; records: { label: string }[]; saved: string } | null>(null);
  const [mute, setMute] = useState(false);
  const [warmed, setWarmed] = useState(warmedRecently);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratch = useRef(document.createElement("canvas"));
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoop = useRef<() => void>(() => undefined);
  // toucher le ballon à l'écran pendant le calibrage : apprend sa couleur quand le modèle ne le trouve pas
  const teachRef = useRef<((sx: number, sy: number) => TeachResult) | null>(null);
  const [taught, setTaught] = useState<TeachResult | null>(null);
  // Paysage conseillé : plus de largeur à l'image, les cibles sur les côtés sont plus écartées
  const [landscape, setLandscape] = useState(() => window.matchMedia("(orientation: landscape)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const on = () => setLandscape(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const rotateHint = !landscape ? <Notice>Tourne ton téléphone à l'horizontale : tu auras plus de place pour dribbler sur les côtés.</Notice> : null;
  const g = useRef(newGameState());
  const lower = def.id === "crossover";
  const weak: "left" | "right" = profile?.strong_hand === "gauche" ? "right" : "left";
  const handName = (h: "left" | "right") => (h === "left" ? "gauche" : "droite");
  const ambi = def.id === "ambi";
  const [ambiRes, setAmbiRes] = useState<{ weak: number; strong: number; ratio: number } | null>(null);

  useEffect(() => {
    getRecord(`dribble:${def.id}`).then(setRecord);
    return () => { stopLoop.current(); stopCamera(streamRef.current); };
  }, [def.id]);

  // Difficulté adaptée aux scores précédents : cibles plus rapides quand le record monte.
  const level = record == null ? 1 : lower ? Math.min(8, Math.max(1, Math.round((40 - record) / 4))) : Math.min(8, 1 + Math.floor(record / 500));

  async function openCamera() {
    setPhase("calib");
    setError(null);
    try {
      setLoading("Démarrage de la caméra…");
      streamRef.current = await startCamera(videoRef.current!, "user");
      setLoading("Chargement du suivi ballon et mains…");
      // modèles dans un worker, ballon suivi à chaque image : l'affichage n'attend jamais le modèle
      const vision = await startVision({ ball: true, pose: true });
      setLoading(null);
      const seen: boolean[] = [];
      let last = 0;
      const calibStart = performance.now();
      // lancement automatique : le centre des hanches ne doit pas s'éloigner de ce repère pendant HOLD_MS
      let anchor: { x: number; y: number; t: number } | null = null;
      let lightOk = false;
      let reported = false;
      const stopFrames = frameLoop(videoRef.current!, (now) => {
        const v = videoRef.current, c = canvasRef.current;
        if (!v || !c || v.readyState < 2) return;
        const ts = performance.now();
        if (ts - last < 12) return; // ≤ 80 analyses/s
        last = ts;
        const W = (c.width = c.clientWidth * devicePixelRatio) / devicePixelRatio;
        const H = (c.height = c.clientHeight * devicePixelRatio) / devicePixelRatio;
        const m = makeMapper(v, W, H, true);
        const { ball, pose: lms } = vision.frame(v, ts);
        const ctx = c.getContext("2d")!;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, W, H);
        drawSkeleton(ctx, m, lms);
        if (ball) drawBall(ctx, m, ball.x, ball.y, ball.r);
        const st = g.current;
        if (st.phase === "calib") {
          seen.push(Boolean(ball && !ball.predicted));
          if (seen.length > 20) seen.shift();
          const vis = (i: number) => (lms?.[i]?.visibility ?? 0) > 0.5;
          const bodyOk = Boolean(lms) && vis(LM.nose) && (vis(LM.lAnkle) || vis(LM.rAnkle));
          const ready = bodyOk && seen.filter(Boolean).length >= 6 && lightOk;
          if (ready && lms) {
            const hx = (lms[LM.lHip].x + lms[LM.rHip].x) / 2, hy = (lms[LM.lHip].y + lms[LM.rHip].y) / 2;
            if (!anchor || Math.hypot(hx - anchor.x, hy - anchor.y) > 0.03) anchor = { x: hx, y: hy, t: ts };
            const left = HOLD_MS - (ts - anchor.t);
            if (left <= 0) { anchor = null; setHold(null); startRef.current(); return; }
            const secs = Math.ceil(left / 1000);
            setHold((h) => (h === secs ? h : secs));
          } else if (anchor) { anchor = null; setHold(null); }
          if (Math.floor(now / 250) !== st.lastCheck) {
            st.lastCheck = Math.floor(now / 250);
            lightOk = brightness(v, scratch.current) > 55; // lu 4 fois par seconde : lire les pixels coûte
            setChecks({ light: lightOk, body: bodyOk, ball: seen.filter(Boolean).length >= 6 });
            // diagnostic : 15 s de calibrage sans ballon → on enregistre ce que voit le détecteur
            if (!reported && ts - calibStart > 15000 && !seen.some(Boolean)) {
              reported = true;
              supabase.from("debug_traces").insert({ kind: "ball", data: { ...vision.stats(), ua: navigator.userAgent, vw: v.videoWidth, vh: v.videoHeight, body: Boolean(lms) } }).then(() => undefined, () => undefined);
            }
          }
        } else if (st.phase === "play") {
          stepRef.current(st, ctx, m, ball ? { x: m.x(ball.x), y: m.y(ball.y), r: m.len(ball.r), predicted: ball.predicted } : null, lms, W, H, ts);
        }
      });
      stopLoop.current = () => { stopFrames(); vision.close(); teachRef.current = null; };
      teachRef.current = (sx, sy) => {
        const v = videoRef.current, c = canvasRef.current;
        if (!v || !c) return "fail";
        const b = c.getBoundingClientRect();
        const m = makeMapper(v, b.width, b.height, true);
        return vision.teach(v, m.nx(sx - b.left), m.ny(sy - b.top));
      };
      g.current.phase = "calib";
    } catch (e) {
      setLoading(null);
      setError(cameraError(e));
    }
  }

  async function start() {
    if (g.current.phase !== "calib") return; // déjà lancé (bouton et lancement automatique)
    setHold(null);
    setPhase("count");
    g.current = { ...newGameState(), phase: "count" };
    await countdown(setCount, ["3", "2", "1"], "Go !");
    setCount(null);
    g.current.phase = "play";
    g.current.t0 = performance.now();
    if (ambi) speak(`Main ${handName(weak)} seulement`);
    setPhase("play");
  }

  const startRef = useRef(start);
  startRef.current = start;

  // ——— Logique de jeu, appelée à chaque image ———
  function step(st: GameState, ctx: CanvasRenderingContext2D, m: Mapper, ball: { x: number; y: number; r: number; predicted?: boolean } | null, lms: NormalizedLandmark[] | null, W: number, H: number, ts: number) {
    const elapsed = (ts - st.t0) / 1000;
    const body = bodyFrame(m, lms, W, H, home);
    const sound = !mute;

    // Comptage des dribbles : rebond = point bas, puis remontée franche du ballon (hystérésis).
    // Une position seulement prolongée (ballon caché) ne compte pas.
    if (ball && !ball.predicted) {
      st.amp = Math.max(H * 0.035, ball.r * 0.8);
      const edge = st.bounce(ball.y);
      if (edge === "bottom") st.dribbles++;
      // Main qui contrôle le ballon : le poignet le plus proche quand le ballon est en haut.
      if (lms && edge === "top") {
        const dl = dist(ball, { x: m.x(lms[LM.lWrist].x), y: m.y(lms[LM.lWrist].y) });
        const dr = dist(ball, { x: m.x(lms[LM.rWrist].x), y: m.y(lms[LM.rWrist].y) });
        st.hand = dl < dr ? "left" : "right";
        if (st.hand === "left") st.left++; else st.right++;
      }
    }

    // Test main faible : pas de cibles, on compte les dribbles de chaque main (main faible d'abord)
    if (ambi) {
      if (st.weakDribbles == null && elapsed >= AMBI_HALF) {
        st.weakDribbles = st.dribbles;
        if (sound) hitSound();
        speak(`Main ${handName(weak === "left" ? "right" : "left")} maintenant`);
      }
    }
    // Cibles
    const life = Math.max(0.9, 2.6 - 0.2 * (level - 1)) * (def.id === "sequence" ? 3 : 1);
    if (!ambi && !st.target && !st.showing) {
      const spot = nextSpot(st, def.id);
      const p = body.spots[spot];
      st.target = { spot, x: p.x, y: p.y, born: ts, life: def.id === "crossover" ? 99 : life };
      st.targets++;
    }
    if (st.showing) drawSequence(ctx, st, body, ts);
    const tg = st.target;
    if (tg && !st.showing) {
      const p = body.spots[tg.spot];
      tg.x = p.x; tg.y = p.y; // la cible suit le joueur
      const R = 32;
      // le ballon va vite : on teste tout le trajet depuis l'image précédente, pas seulement sa position actuelle
      const prevBall = st.lastBall;
      const touching = ball && (prevBall && ts - prevBall.ts < 200 ? segDist(tg, prevBall, ball) : dist(ball, tg)) < R + ball.r * 0.9;
      const handOk = def.id !== "main_faible" || st.hand === weak;
      if (touching && handOk && !tg.hit) {
        tg.hit = ts;
        st.hits++;
        st.score += def.id === "crossover" ? 0 : 100 + Math.round(Math.max(0, 1 - (ts - tg.born) / (tg.life * 1000)) * 60);
        if (sound) hitSound();
        if (def.id === "sequence") st.seqPos++;
      } else if (!tg.hit && (ts - tg.born) / 1000 > tg.life) {
        if (sound) missSound();
        if (def.id === "sequence") st.seqFail = true;
        st.target = null;
      }
      drawTarget(ctx, tg, R, ts);
      if (tg.hit && ts - tg.hit > 180) st.target = null;
    }

    if (ball) st.lastBall = { x: ball.x, y: ball.y, ts };

    // Fin de partie
    const over = elapsed >= DURATION[def.id] || (def.id === "crossover" && st.hits >= 20) || (def.id === "sequence" && st.seqFail);
    if (def.id === "sequence" && st.seqPos >= st.seq.length && !st.showing) {
      st.score = Math.max(st.score, st.seq.length * 100);
      st.seq.push(randomSpot());
      st.seqPos = 0;
      st.showing = ts;
      st.target = null;
    }
    if (Math.floor(ts / 100) !== st.lastHud || over) {
      st.lastHud = Math.floor(ts / 100);
      setHud({ score: def.id === "crossover" ? Math.round(elapsed * 100) / 100 : st.score, time: elapsed, dribbles: st.dribbles, rate: st.dribbles / Math.max(1, elapsed), hits: st.hits, targets: st.targets, left: st.left, right: st.right });
    }
    if (over && st.phase === "play") {
      st.phase = "done";
      finish(elapsed);
    }
  }

  const stepRef = useRef(step);
  stepRef.current = step;

  async function finish(elapsed: number) {
    const st = g.current;
    setPhase("done");
    const weakDr = st.weakDribbles ?? st.dribbles;
    const ambiRates = { weak: Math.round((weakDr / AMBI_HALF) * 10) / 10, strong: Math.round(((st.dribbles - weakDr) / Math.max(1, elapsed - AMBI_HALF)) * 10) / 10 };
    const ambiRatio = ambiRates.strong ? Math.min(100, Math.round((ambiRates.weak / ambiRates.strong) * 100)) : 0;
    if (ambi) setAmbiRes({ ...ambiRates, ratio: ambiRatio });
    const score = ambi ? ambiRatio : def.id === "crossover" ? (st.hits >= 20 ? Math.round(elapsed * 100) / 100 : 0) : def.id === "sequence" ? Math.max(0, st.seq.length - 1) : st.score;
    const rate = st.dribbles / Math.max(1, elapsed);
    const weakCount = weak === "left" ? st.left : st.right;
    const weakRate = (st.dribbles * (weakCount / Math.max(1, st.left + st.right))) / Math.max(1, elapsed);
    speak(ambi ? `Main faible : ${ambiRatio} pour cent de ta main forte` : def.id === "crossover" ? (score ? `${num(score, 1)} secondes` : "Temps écoulé") : `Score ${score}`);
    const records = await checkRecords([
      ...(score && !ambi ? [{ key: `dribble:${def.id}`, value: score, better: lower ? ("lower" as const) : ("higher" as const), label: `${def.name}`, unit: lower ? "s" : def.id === "sequence" ? "cibles" : "pts" }] : []),
      { key: "dribble_rate", value: Math.round(rate * 10) / 10, better: "higher", label: "Dribbles par seconde", unit: "dr/s" },
    ]).catch(() => []);
    const id = crypto.randomUUID();
    const event = eventId ? events.find((e) => e.id === eventId) : null;
    const lastGame = event ? (event.payload.games ?? []).at(-1) === def.id : false;
    const session = {
      id, event_id: eventId, kind: "dribble" as const, title: `Dribble · ${def.name}`, started_at: new Date(Date.now() - elapsed * 1000).toISOString(), duration_s: Math.round(elapsed),
      results: { game: def.id, score, dribbles: st.dribbles, rate: Math.round(rate * 10) / 10, hits: st.hits, targets: st.targets, left: st.left, right: st.right, level, home, records }, feeling: null,
    };
    const status = await saveSession({
      session,
      measurements: ambi
        ? withAmbiIndex(measurements, [{ kind: "dribble_rate", value: Math.round(rate * 10) / 10, source: "camera" }, { kind: "weak_dribble_rate", value: ambiRates.weak, source: "camera" }, { kind: "strong_dribble_rate", value: ambiRates.strong, source: "camera" }])
        : [{ kind: "dribble_rate", value: Math.round(rate * 10) / 10, source: "camera" }, { kind: "weak_dribble_rate", value: Math.round(weakRate * 10) / 10, source: "camera" }],
      eventDone: lastGame ? eventId : null,
    });
    setResult({ score, records, saved: status === "queued" ? "Hors ligne : résultat gardé sur le téléphone." : "" });
    stopLoop.current();
    stopCamera(streamRef.current);
  }

  const total = hud.left + hud.right || 1;
  const nextGame = eventId ? (() => { const list = events.find((e) => e.id === eventId)?.payload.games ?? []; return list[list.indexOf(def.id) + 1]; })() : undefined;

  return (
    <div className="cam-screen pb-cam">
      <video ref={videoRef} className="mirror" playsInline muted aria-hidden="true" />
      <canvas ref={canvasRef} className="overlay" aria-hidden="true" />
      {phase === "calib" ? <div style={{ position: "absolute", inset: 0, zIndex: 2 }} aria-hidden="true" onPointerDown={(e) => { const res = teachRef.current?.(e.clientX, e.clientY); if (res) setTaught(res); }} /> : null}
      <div className="cam-top">
        <IconButton icon="x" label="Quitter le jeu" onClick={() => nav(-1)} style={{ background: "var(--camera-scrim)" }} />
        <div className="pb-hud" style={{ flex: 1, justifyContent: "space-between" }}>
          <div><div className="lbl" style={{ fontSize: 10 }}>{lower ? "Temps" : "Score"}</div><b className="pb-num" style={{ fontSize: 24 }}>{lower ? num(hud.score, 1) : num(hud.score)}</b></div>
          <div style={{ textAlign: "center" }}><div className="lbl" style={{ fontSize: 10 }}>{ambi ? `Main ${handName(hud.time >= AMBI_HALF ? (weak === "left" ? "right" : "left") : weak)}` : `${def.name} · Niv. ${level}`}</div><b className="pb-num" style={{ fontSize: 24 }}>{chrono(Math.max(0, DURATION[def.id] - hud.time))}</b></div>
          {landscape && (phase === "play" || phase === "count") ? (
            <div style={{ textAlign: "center" }}><div className="lbl" style={{ fontSize: 10 }}>Dribbles · cibles · main G</div><b className="pb-num" style={{ fontSize: 18 }}>{hud.dribbles} · {hud.hits}/{hud.targets} · {Math.round((hud.left / total) * 100)} %</b></div>
          ) : null}
          <div style={{ textAlign: "right" }}><div className="lbl" style={{ fontSize: 10 }}>Record</div><b className="pb-num" style={{ fontSize: 24, color: "var(--heat)" }}>{record == null ? "—" : num(record, lower ? 1 : 0)}</b></div>
        </div>
      </div>
      {phase === "play" ? (
        <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top) + 88px)", left: 0, right: 0, textAlign: "center", zIndex: 5 }}>
          <button className="pill-sm" style={{ background: "var(--camera-scrim)", height: 32 }} onClick={() => setMute(!mute)} aria-pressed={!mute}>
            <Icon name={mute ? "mute" : "volume"} size="sm" style={{ width: 14, height: 14, color: mute ? "var(--ink-muted)" : "var(--success)" }} />{mute ? "Son coupé" : "Son activé"}
          </button>
        </div>
      ) : null}
      {count != null ? <div className="cam-center"><span className="countdown" aria-live="assertive">{count || "Go"}</span></div> : null}
      {loading ? <div className="cam-center"><div className="pb-hud"><span className="spinner" />{loading}</div></div> : null}

      <div className="cam-bottom">
        {phase === "setup" ? (
          <div className="pb-glass hero" style={{ padding: 16, background: "rgba(13,27,77,.92)" }}>
            <h1 className="t" style={{ fontSize: 22 }}>{def.name}</h1>
            {rotateHint}
            <p className="lead" style={{ margin: "4px 0 12px" }}>{def.desc}{def.id === "main_faible" ? ` Ta main faible : ${weak === "left" ? "gauche" : "droite"}.` : ""}</p>
            <div className="pb-li" style={{ padding: 0, minHeight: 48 }}>
              <Icon name="house" className="pb-muted" /><div className="t">Mode maison<small>Petit espace 2 × 2 m, dribble bas, peu de bruit</small></div>
              <Toggle on={home} onChange={setHome} label="Mode maison" />
            </div>
            <div style={{ marginTop: 12 }}>
              {warmed ? <button className="pb-btn primary lg block" onClick={openCamera}><Icon name="video" size="sm" />Calibrer la caméra</button>
                : <WarmupGate onDone={() => { markWarmed(); setWarmed(true); openCamera(); }} />}
            </div>
          </div>
        ) : null}
        {phase === "calib" ? (
          <div className="pb-glass" style={{ padding: 16, background: "rgba(13,27,77,.85)" }}>
            <b style={{ fontSize: 16 }}>Calibrage</b>
            {rotateHint}
            <p className="pb-muted" style={{ margin: "4px 0 12px", fontSize: 14 }}>Pose le téléphone au sol ou sur un trépied, à {home ? "1,5" : "2–3"} m, écran vers toi.</p>
            <div className="col" style={{ gap: 10 }}>
              <Check ok={checks.light} label="Lumière suffisante" hint="rapproche-toi d'une lumière" />
              <Check ok={checks.body} label="Tout ton corps est visible" hint="recule d'un pas" />
              <Check ok={checks.ball} label="Ballon détecté" hint={taught === "ok" || taught === "dark" ? "dribble devant toi" : "touche-le à l'écran"} />
            </div>
            {!checks.ball || taught !== "ok" ? <p role="status" style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600 }}>
              {taught === "ok" ? "Couleur du ballon apprise : dribble devant toi." : taught === "dark" ? "Ton ballon est trop sombre à l'image : allume plus de lumière, pose le téléphone plus haut, puis touche-le à nouveau." : taught === "fail" ? "Couleur pas reconnue : touche bien le milieu du ballon, dans un endroit éclairé." : "Touche ton ballon à l'écran pour que l'app apprenne sa couleur."}
            </p> : null}
            {error ? <div style={{ marginTop: 12 }} className="col"><Notice tone="error">{error}</Notice><button className="pb-btn" onClick={() => { stopLoop.current(); stopCamera(streamRef.current); openCamera(); }}>Réessayer</button></div> : null}
            <p className="pb-muted" role="status" style={{ margin: "10px 0 0", fontSize: 14, fontWeight: hold != null ? 600 : 400 }}>
              {hold != null ? `Ne bouge plus : ça démarre dans ${hold} s` : "Tout est au vert et tu restes immobile 3 s : la partie démarre toute seule."}
            </p>
            <button className="pb-btn primary lg block cam-btn" style={{ marginTop: 10 }} disabled={!(checks.light && checks.body && checks.ball)} onClick={start}>Commencer</button>
          </div>
        ) : null}
        {(phase === "play" || phase === "count") && !landscape ? (
          <div className="pb-glass">
            <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, textAlign: "center" }}>
              <div><b className="pb-num" style={{ fontSize: 22 }}>{hud.dribbles}</b><div className="pb-muted" style={{ fontSize: 12 }}>dribbles</div></div>
              <div><b className="pb-num" style={{ fontSize: 22 }}>{num(hud.rate, 1)}</b><div className="pb-muted" style={{ fontSize: 12 }}>dribbles/s</div></div>
              <div><b className="pb-num" style={{ fontSize: 22 }}>{hud.hits}/{hud.targets}</b><div className="pb-muted" style={{ fontSize: 12 }}>cibles</div></div>
            </div>
            <div style={{ padding: "0 16px 14px" }}>
              <div className="row between" style={{ font: "600 12px var(--font-sans)", marginBottom: 6 }}><span>Main G {Math.round((hud.left / total) * 100)} %</span><span className="pb-muted">Main D {Math.round((hud.right / total) * 100)} %</span></div>
              <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", gap: 3 }}><span style={{ flex: hud.left || 1, background: "var(--primary-bright)" }} /><span style={{ flex: hud.right || 1, background: "rgba(255,255,255,.25)" }} /></div>
            </div>
          </div>
        ) : null}
        {phase === "done" ? (
          <div className="pb-glass hero" style={{ padding: 16, textAlign: "center", background: "rgba(13,27,77,.92)" }}>
            <div className="lbl">{ambi ? "Main faible / main forte" : lower ? "Temps" : def.id === "sequence" ? "Plus longue séquence" : "Score"}</div>
            <div className="pb-num" style={{ fontSize: 56, fontWeight: 600, lineHeight: "64px" }}>{result ? (ambi ? `${result.score} %` : lower ? (result.score ? `${num(result.score, 2)} s` : "—") : num(result.score)) : "…"}</div>
            {ambi && ambiRes ? <p className="pb-muted" style={{ margin: "4px 0 0", fontSize: 14 }}>Main {handName(weak)} : {num(ambiRes.weak, 1)} dribbles/s · main {handName(weak === "left" ? "right" : "left")} : {num(ambiRes.strong, 1)} dribbles/s</p> : null}
            {result?.records.some((r) => r.label === def.name) ? <span className="pb-delta up">▲ Nouveau record</span> : record != null ? <span className="pb-muted" style={{ fontSize: 13 }}>Record : {num(record, lower ? 2 : 0)}</span> : null}
            <div className="grid3" style={{ marginTop: 14 }}>
              <div><b className="pb-num">{hud.dribbles}</b><div className="pb-muted" style={{ fontSize: 12 }}>dribbles</div></div>
              <div><b className="pb-num">{num(hud.rate, 1)}</b><div className="pb-muted" style={{ fontSize: 12 }}>dribbles/s</div></div>
              <div><b className="pb-num">{hud.hits}/{hud.targets}</b><div className="pb-muted" style={{ fontSize: 12 }}>cibles</div></div>
            </div>
            {result?.saved ? <p className="pb-muted" style={{ fontSize: 13 }}>{result.saved}</p> : null}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => { g.current = newGameState(); setResult(null); setChecks({ light: false, body: false, ball: false }); setPhase("setup"); getRecord(`dribble:${def.id}`).then(setRecord); }}>Rejouer</button>
              {ambi && qs.get("suite") === "finition" ? <button className="pb-btn primary lg" style={{ flex: 1.4 }} onClick={() => nav(`/shoot?jeu=finition${eventId ? `&event=${eventId}` : ""}`, { replace: true })}>Test de finition</button>
                : nextGame ? <button className="pb-btn primary lg" style={{ flex: 1.4 }} onClick={() => nav(gameDef(nextGame)?.mode === "shoot" ? `/shoot?event=${eventId}&jeu=${nextGame}` : `/dribble/${nextGame}?event=${eventId}`, { replace: true })}>Jeu suivant</button>
                : <button className="pb-btn primary lg" style={{ flex: 1.4 }} onClick={() => nav("/", { replace: true })}>Terminer</button>}
            </div>
          </div>
        ) : null}
      </div>
      {phase === "setup" ? (
        <div className="pb-chips cam-game-chips">
          {(["reflexes", "main_faible", "crossover", "sequence", "ambi"] as const).map((id) => (
            <Chip key={id} active={id === def.id} onClick={() => nav(`/dribble/${id}${eventId ? `?event=${eventId}` : ""}`, { replace: true })}>{gameDef(id)!.name}</Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ——— État de partie (refs : mis à jour à chaque image sans re-rendu) ———
interface GameState {
  phase: Phase | "calib"; t0: number; score: number; dribbles: number; hits: number; targets: number; left: number; right: number;
  hand: "left" | "right" | null; amp: number; bounce: (y: number) => "bottom" | "top" | null; target: Target | null; lastHud: number; lastCheck: number; lastSpot: Spot | null;
  seq: Spot[]; seqPos: number; seqFail: boolean; showing: number;
  lastBall: { x: number; y: number; ts: number } | null;
  weakDribbles: number | null; // test main faible : dribbles faits pendant la première moitié
}
function newGameState(): GameState {
  const st: GameState = { phase: "setup", t0: 0, score: 0, dribbles: 0, hits: 0, targets: 0, left: 0, right: 0, hand: null, amp: 20, bounce: () => null, target: null, lastHud: 0, lastCheck: 0, lastSpot: null,
    seq: [randomSpot(), randomSpot()], seqPos: 0, seqFail: false, showing: 0, lastBall: null, weakDribbles: null };
  st.bounce = bounceCounter(() => st.amp);
  return st;
}
const SPOTS: Spot[] = ["G", "D", "B", "J"];
function randomSpot(): Spot { return SPOTS[Math.floor(Math.random() * SPOTS.length)]; }
function nextSpot(st: GameState, id: string): Spot {
  if (id === "crossover") return (st.lastSpot = st.lastSpot === "G" ? "D" : "G");
  if (id === "sequence") return st.seq[st.seqPos] ?? "G";
  let s: Spot;
  do s = randomSpot(); while (s === st.lastSpot);
  return (st.lastSpot = s);
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Distance d'un point p au segment [a, b] : le ballon a pu traverser la cible entre deux images. */
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
}

function bodyFrame(m: Mapper, lms: NormalizedLandmark[] | null, W: number, H: number, home: boolean) {
  // en paysage, l'image est large : cibles latérales plus loin du corps (dribbles plus longs)
  const k = (home ? 0.75 : 1) * (W > H * 1.2 ? 1.55 : 1);
  let hx = W / 2, hy = H * 0.55, ay = H * 0.85, sw = W * 0.18;
  if (lms) {
    hx = (m.x(lms[LM.lHip].x) + m.x(lms[LM.rHip].x)) / 2;
    hy = (m.y(lms[LM.lHip].y) + m.y(lms[LM.rHip].y)) / 2;
    ay = Math.max(m.y(lms[LM.lAnkle].y), m.y(lms[LM.rAnkle].y));
    sw = Math.max(40, Math.abs(m.x(lms[LM.lShoulder].x) - m.x(lms[LM.rShoulder].x)));
  }
  const mid = home ? hy * 0.3 + ay * 0.7 : (hy + ay) / 2;
  const clampX = (x: number) => Math.min(W - 40, Math.max(40, x));
  const clampY = (y: number) => Math.min(H - 44, Math.max(110, y));
  return {
    spots: {
      G: { x: clampX(hx - 1.5 * sw * k), y: clampY(mid) },
      D: { x: clampX(hx + 1.5 * sw * k), y: clampY(mid) },
      B: { x: clampX(hx + 0.9 * sw * k), y: clampY(ay - (ay - hy) * 0.12) },
      J: { x: hx, y: clampY(hy * 0.3 + ay * 0.7) },
    } as Record<Spot, { x: number; y: number }>,
  };
}

function drawTarget(ctx: CanvasRenderingContext2D, t: Target, R: number, ts: number) {
  const hit = Boolean(t.hit);
  const color = hit ? "#3ddc97" : "#8c7bff";
  const pulse = hit ? 1.15 : 1 + 0.04 * Math.sin(ts / 120);
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.fillStyle = hit ? "rgba(61,220,151,.2)" : "rgba(140,123,255,.18)";
  ctx.beginPath(); ctx.arc(0, 0, R + 8, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  // Temps restant
  if (!hit && t.life < 50) {
    const left = Math.max(0, 1 - (ts - t.born) / (t.life * 1000));
    ctx.strokeStyle = "rgba(243,233,210,.9)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R + 8, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  ctx.font = "700 18px 'Inter Display', Inter, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(hit ? "✓" : SPOT_LABEL[t.spot], 0, 1);
  ctx.restore();
}

function drawSequence(ctx: CanvasRenderingContext2D, st: GameState, body: ReturnType<typeof bodyFrame>, ts: number) {
  const step = 700;
  const i = Math.floor((ts - st.showing) / step);
  if (i >= st.seq.length) {
    st.showing = 0;
    speak("À toi");
    return;
  }
  const spot = st.seq[i];
  const p = body.spots[spot];
  drawTarget(ctx, { spot, x: p.x, y: p.y, born: ts, life: 99 }, 32, ts);
  ctx.fillStyle = "#f3e9d2";
  ctx.font = "600 14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${i + 1} · ${SPOT_NAME[spot]}`, p.x, p.y - 50);
}

function drawBall(ctx: CanvasRenderingContext2D, m: Mapper, x: number, y: number, r: number) {
  const R = Math.max(14, m.len(r));
  ctx.strokeStyle = "#f3e9d2"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
  ctx.strokeRect(m.x(x) - R, m.y(y) - R, R * 2, R * 2);
  ctx.setLineDash([]);
}

function drawSkeleton(ctx: CanvasRenderingContext2D, m: Mapper, l: NormalizedLandmark[] | null) {
  if (!l) return;
  const seg = [[LM.lShoulder, LM.rShoulder], [LM.lShoulder, LM.lElbow], [LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow], [LM.rElbow, LM.rWrist], [LM.lShoulder, LM.lHip], [LM.rShoulder, LM.rHip], [LM.lHip, LM.rHip]];
  ctx.strokeStyle = "rgba(140,123,255,.9)"; ctx.lineWidth = 2;
  for (const [a, b] of seg) {
    ctx.beginPath(); ctx.moveTo(m.x(l[a].x), m.y(l[a].y)); ctx.lineTo(m.x(l[b].x), m.y(l[b].y)); ctx.stroke();
  }
  ctx.fillStyle = "#8c7bff";
  for (const i of [LM.lWrist, LM.rWrist]) { ctx.beginPath(); ctx.arc(m.x(l[i].x), m.y(l[i].y), 6, 0, Math.PI * 2); ctx.fill(); }
}

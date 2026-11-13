// Session de shoot filmée (US15) : téléphone sur trépied, de côté, cercle et joueur dans le cadre.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useApp } from "../../state/app";
import { Icon } from "../../components/Icon";
import { Chip, IconButton, Notice, Stepper } from "../../components/ui";
import { game as gameDef } from "../../data/catalog";
import { checkRecords, saveSession, updateProfile } from "../../lib/data";
import { num } from "../../lib/format";
import { brightness, LM } from "../../vision/models";
import { startVision, type Vision } from "../../vision/engine";
import { cameraError, frameLoop, hitSound, missSound, recorder, saveVideo, speak, startCamera, stopCamera } from "../../vision/media";
import { withAmbiIndex } from "../../lib/ambi";
import { advice, SPOT_ANGLE, SPOT_NAME, ShotTracker, type Shot } from "../../vision/shot";
import { Check, makeMapper, markWarmed, WarmupGate, warmedRecently } from "./common";
import { clothesSig, PeopleTracker, type Seen } from "../../vision/people";
import { describeFace, loadFaces } from "../../vision/faces";
import { MultiShot } from "../../vision/multiShot";
import { ME, recognize, rememberPerson, type PlayerResult } from "../../lib/people";
import { GroupReview, identity, useKnownNames, type Card } from "./ShootGroup";

type Phase = "setup" | "calib" | "play" | "done";
const RIM_M = 0.45;
const FIVE = ["coin_g", "aile_g", "axe", "aile_d", "coin_d"];
const WORLD = ["coin_g", "aile_g", "axe", "aile_d", "coin_d", "aile_d", "axe"];

export default function ShootSession() {
  const [qs] = useSearchParams();
  const eventId = qs.get("event");
  // à plusieurs : tir libre seulement (les jeux à spots ou à objectif se jouent seul)
  const group = qs.get("groupe") === "1";
  const gameId = group ? "tir_libre" : qs.get("jeu") ?? "tir_libre";
  const def = gameDef(gameId) ?? gameDef("tir_libre")!;
  const { profile, events, setProfile, measurements, session: auth } = useApp();
  const userId = auth?.user.id ?? "";
  const names = useKnownNames(userId);
  const [cards, setCards] = useState<Card[]>([]);
  const [facesState, setFacesState] = useState<"off" | "loading" | "ready" | "failed">("off");
  const [seenCount, setSeenCount] = useState(0);
  // finition : 10 essais main faible d'abord (on apprend mieux en commençant par elle), puis 10 main forte
  const finish = def.id === "finition";
  const weakName = profile?.strong_hand === "gauche" ? "droite" : "gauche";
  const strongName = weakName === "gauche" ? "droite" : "gauche";
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>("setup");
  const [warmed, setWarmed] = useState(warmedRecently);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [rim, setRim] = useState<{ x: number; y: number } | null>(null); // écran, px
  const [rimSize, setRimSize] = useState(36); // rayon écran, px
  const [hoopH, setHoopH] = useState(profile?.hoop_height_m ?? 3.05);
  const [checks, setChecks] = useState({ light: false, ball: false });
  const [shots, setShots] = useState<Shot[]>([]);
  const [spotIdx, setSpotIdx] = useState(0);
  const [made, setMade] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratch = useRef(document.createElement("canvas"));
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoop = useRef<() => void>(() => undefined);
  const live = useRef({ phase: "setup" as Phase, tracker: null as ShotTracker | null, rec: null as ReturnType<typeof recorder> | null, startedAt: 0,
    hip0: [] as number[], wristBall: [] as { t: number; d: number; y: number }[], dipT: 0, hipMin: 1, elbowAtRel: null as number | null, lastCheck: 0, seen: [] as boolean[], vision: null as Vision | null,
    // à plusieurs : suivi de chaque joueur, joueur de chaque tir, visage en cours d'analyse
    people: group ? new PeopleTracker() : null, shotTracks: [] as (number | null)[], lastPeople: 0, lastFace: 0, faceBusy: false, faceReady: false,
    current: [] as { id: number; lms: NormalizedLandmark[] }[], names: new Map<number, string>(), multi: null as MultiShot | null });
  const rimRef = useRef<{ x: number; y: number; r: number } | null>(null);
  const spotRef = useRef(0);
  const shotsRef = useRef<Shot[]>([]);

  useEffect(() => () => { stopLoop.current(); stopCamera(streamRef.current); }, []);
  useEffect(() => { rimRef.current = rim ? { ...rim, r: rimSize } : null; }, [rim, rimSize]);

  const spots = def.id === "cinq_spots" || def.id === "cinq_spots_mi" ? FIVE : def.id === "tour_du_monde" ? WORLD : def.id === "lancers_francs" ? ["lf"] : ["libre"];
  const currentSpot = spots[Math.min(spotIdx, spots.length - 1)];
  const target = def.id.startsWith("cinq_spots") ? 50 : def.id === "lancers_francs" ? 20 : def.id === "finition" ? 20 : def.id === "tour_du_monde" ? null : null;

  async function openCamera() {
    setPhase("calib");
    live.current.phase = "calib";
    setError(null);
    try {
      setLoading("Démarrage de la caméra…");
      streamRef.current = await startCamera(videoRef.current!, "environment");
      setLoading("Chargement du suivi ballon et corps…");
      // modèles dans un worker, ballon suivi à chaque image : l'affichage n'attend jamais le modèle
      const vision = await startVision({ ball: false, pose: true, motion: true, people: group ? 4 : 1 });
      if (group) {
        setFacesState("loading");
        loadFaces().then(() => { live.current.faceReady = true; setFacesState("ready"); }).catch(() => setFacesState("failed"));
      }
      live.current.vision = vision;
      setLoading(null);
      let last = 0;
      const stopFrames = frameLoop(videoRef.current!, (now) => {
        const v = videoRef.current, c = canvasRef.current;
        if (!v || !c || v.readyState < 2) return;
        const ts = performance.now();
        if (ts - last < 12) return;
        last = ts;
        const W = (c.width = c.clientWidth * devicePixelRatio) / devicePixelRatio;
        const H = (c.height = c.clientHeight * devicePixelRatio) / devicePixelRatio;
        const m = makeMapper(v, W, H, false);
        const ctx = c.getContext("2d")!;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const frame = vision.frame(v, ts);
        const { ball } = frame;
        const L = live.current;
        if (L.people) trackPeople(v, ts, ctx, m);
        // à plusieurs : la gestuelle se mesure sur le joueur qui a le ballon
        const lms = L.people && ball ? nearestTo(vision.people(), ball.x, ball.y) ?? frame.pose : frame.pose;
        const r = rimRef.current;
        if (r) drawRim(ctx, r.x, r.y, r.r);
        if (ball) {
          ctx.strokeStyle = "#f3e9d2"; ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
          const R = Math.max(10, m.len(ball.r));
          ctx.strokeRect(m.x(ball.x) - R, m.y(ball.y) - R, 2 * R, 2 * R); ctx.setLineDash([]);
        }
        if (L.phase === "calib") {
          L.seen.push(Boolean(ball && !ball.predicted)); if (L.seen.length > 20) L.seen.shift();
          if (Math.floor(now / 250) !== L.lastCheck) {
            L.lastCheck = Math.floor(now / 250);
            // un ballon vu une fois suffit : le voyant ne doit pas s'éteindre quand il retombe ou sort du cadre
            const seenBall = L.seen.filter(Boolean).length >= 4;
            setChecks((c) => ({ light: brightness(v, scratch.current) > 55, ball: c.ball || seenBall }));
          }
          return;
        }
        if (L.phase !== "play" || !L.tracker) return;
        const vw = v.videoWidth, vh = v.videoHeight;
        const t = ts - (L.rec?.startedAt ?? L.startedAt);
        // l'analyse du tir n'utilise que des positions mesurées, jamais prolongées
        // la tête est ronde et bouge aussi : ce qui passe sur le visage n'est pas le ballon
        const onFace = ball && lms && (lms[LM.nose]?.visibility ?? 0) > 0.5 && Math.hypot((ball.x - lms[LM.nose].x) * vw, (ball.y - lms[LM.nose].y) * vh) < 0.08 * vw;
        const bp = ball && !ball.predicted && !onFace ? { t, x: ball.x * vw, y: ball.y * vh, r: ball.r * vw } : null;
        const ctxInfo = gesture(L, lms, bp, t, vw, vh, L.tracker.pxPerM);
        // trajectoires en cours (une par ballon en l'air)
        const flights = L.multi ? L.multi.flights() : L.tracker.inFlight ? [L.tracker.pts.slice(L.tracker.releaseIdx)] : [];
        for (const f of flights) {
          ctx.strokeStyle = "#8c7bff"; ctx.lineWidth = 3; ctx.beginPath();
          f.forEach((q, i) => (i ? ctx.lineTo(m.x(q.x / vw), m.y(q.y / vh)) : ctx.moveTo(m.x(q.x / vw), m.y(q.y / vh))));
          ctx.stroke();
        }
        const shotCtx = { spot: spots[spotRef.current] ?? "libre", ...ctxInfo, net: L.vision?.netMotion() ?? 0, t };
        let done: NonNullable<ReturnType<ShotTracker["push"]>>[];
        if (L.multi) {
          // autres ballons : ceux qui passent sur un visage sont des têtes, pas des ballons
          const heads = (L.vision?.people() ?? []).map((p) => p[LM.nose]).filter((n) => (n?.visibility ?? 0) > 0.5);
          const others = (L.vision?.balls() ?? []).filter((k) => !heads.some((n) => Math.hypot((k.x - n.x) * vw, (k.y - n.y) * vh) < 0.08 * vw))
            .map((k) => ({ id: k.id, x: k.x * vw, y: k.y * vh, r: k.r * vw }));
          done = L.multi.push(t, bp, others, shotCtx);
        } else {
          const one = L.tracker.push(bp, shotCtx);
          done = one ? [one] : [];
        }
        for (const res of done) {
          // à plusieurs : le tireur est celui qui avait le ballon en main au lâcher
          if (L.people) L.shotTracks.push(L.people.shooterAt(res.releasePt.t + (L.rec?.startedAt ?? L.startedAt), res.releasePt.x / vw, res.releasePt.y / vh));
          onShotRef.current(res);
        }
      });
      stopLoop.current = () => { stopFrames(); vision.close(); };
    } catch (e) {
      setLoading(null);
      setError(cameraError(e));
    }
  }

  /** Suit chaque joueur (10 fois par seconde) et cherche de temps en temps un visage net à photographier. */
  function trackPeople(v: HTMLVideoElement, ts: number, ctx: CanvasRenderingContext2D, m: ReturnType<typeof makeMapper>) {
    const L = live.current;
    const P = L.people!;
    if (ts - L.lastPeople >= 100) {
      L.lastPeople = ts;
      const all = L.vision?.people() ?? [];
      const seen: Seen[] = [];
      const kept: NormalizedLandmark[][] = [];
      for (const lms of all) {
        const vis = lms.filter((p) => (p.visibility ?? 0) > 0.5);
        if (vis.length < 6) continue;
        const box = { x0: Math.min(...vis.map((p) => p.x)), y0: Math.min(...vis.map((p) => p.y)), x1: Math.max(...vis.map((p) => p.x)), y1: Math.max(...vis.map((p) => p.y)) };
        const wrists = [lms[LM.lWrist], lms[LM.rWrist]].filter((p) => (p.visibility ?? 0) > 0.5).map((p) => ({ x: p.x, y: p.y }));
        seen.push({ box, wrists, sig: torsoSig(v, lms, scratch.current) });
        kept.push(lms);
      }
      const ids = P.update(ts, seen);
      L.current = ids.map((id, i) => ({ id, lms: kept[i] }));
      setSeenCount(L.current.length);
    }
    // prénom au-dessus des joueurs reconnus
    ctx.font = "600 14px Inter, sans-serif"; ctx.textAlign = "center";
    for (const c of L.current) {
      const name = L.names.get(c.id);
      const nose = c.lms[LM.nose];
      if (!name || !nose) continue;
      const w = ctx.measureText(name).width + 14;
      ctx.fillStyle = "rgba(13,27,77,.75)"; ctx.fillRect(m.x(nose.x) - w / 2, m.y(nose.y) - 52, w, 22);
      ctx.fillStyle = "#fff"; ctx.fillText(name, m.x(nose.x), m.y(nose.y) - 36);
    }
    if (!L.faceReady || L.faceBusy || ts - L.lastFace < 350) return;
    // le plus grand visage, en priorité chez ceux qui n'ont pas encore de photo nette
    const vw = v.videoWidth, vh = v.videoHeight;
    const heads = L.current.map((c) => {
      const [n, le, re, ls, rs] = [LM.nose, 7, 8, LM.lShoulder, LM.rShoulder].map((i) => c.lms[i]);
      const ear = (le.visibility ?? 0) > 0.3 && (re.visibility ?? 0) > 0.3 ? Math.hypot((le.x - re.x) * vw, (le.y - re.y) * vh) : 0;
      const size = Math.max(ear, Math.hypot((ls.x - rs.x) * vw, (ls.y - rs.y) * vh) * 0.45);
      const best = P.tracks.find((k) => k.id === c.id)?.faces[0]?.quality ?? 0;
      return { id: c.id, x: n.x * vw, y: n.y * vh, size, score: size * (best > 0.5 ? 0.3 : 1), ok: (n.visibility ?? 0) > 0.5 && size >= 28 };
    }).filter((h) => h.ok).sort((a, b) => b.score - a.score);
    const h = heads[0];
    if (!h) return;
    L.lastFace = ts;
    L.faceBusy = true;
    const side = h.size * 2.8;
    const out = Math.round(Math.min(256, Math.max(160, side)));
    const crop = document.createElement("canvas");
    crop.width = crop.height = out;
    crop.getContext("2d")!.drawImage(v, h.x - side / 2, h.y - side / 2, side, side, 0, 0, out, out);
    describeFace(crop).then((f) => {
      if (!f || !L.people) return;
      L.people.addFace(h.id, f);
      const known = recognize(userId, [f.descriptor]);
      if (known) L.names.set(h.id, known.person.key === ME ? "Toi" : known.person.name);
    }).catch(() => undefined).finally(() => { L.faceBusy = false; });
  }

  function startPlay() {
    const v = videoRef.current!, c = canvasRef.current!;
    const m = makeMapper(v, c.clientWidth, c.clientHeight, false);
    const r = rimRef.current!;
    const vw = v.videoWidth, vh = v.videoHeight;
    const rimV = { x: m.nx(r.x) * vw, y: m.ny(r.y) * vh, r: (m.nx(r.x + r.r) - m.nx(r.x)) * vw };
    const pxPerM = (2 * rimV.r) / RIM_M;
    live.current.tracker = new ShotTracker(rimV, pxPerM, hoopH, vw, vh);
    // à plusieurs : plusieurs ballons peuvent voler en même temps, chacun a son compteur
    live.current.multi = group ? new MultiShot(rimV, pxPerM, hoopH, vw, vh) : null;
    live.current.vision?.setRim(rimV.x / vw, rimV.y / vh, rimV.r / vw);
    live.current.rec = recorder(streamRef.current!);
    live.current.startedAt = live.current.rec.startedAt;
    live.current.phase = "play";
    if (hoopH !== profile?.hoop_height_m) updateProfile({ hoop_height_m: hoopH }).then(() => profile && setProfile({ ...profile, hoop_height_m: hoopH })).catch(() => undefined);
    setPhase("play");
    speak(finish ? `10 finitions main ${weakName}` : spots.length > 1 ? `Premier spot : ${SPOT_NAME[spots[0]]}` : "C'est parti");
  }

  function onShot(r: NonNullable<ReturnType<ShotTracker["push"]>>) {
    const spot = spots[spotRef.current] ?? "libre";
    const a = ((SPOT_ANGLE[spot] ?? 0) * Math.PI) / 180;
    const d = spot === "lf" ? 4.6 : r.distance;
    const shot: Shot = { ...r, spot, courtX: Math.sin(a) * d, courtY: Math.cos(a) * d };
    shotsRef.current = [...shotsRef.current, shot];
    setShots(shotsRef.current);
    setAttempts((n) => n + 1);
    if (r.made) { setMade((n) => n + 1); hitSound(); } else missSound();
    // Progression des spots selon le jeu
    const n = shotsRef.current.length;
    if (def.id.startsWith("cinq_spots") && n % 10 === 0 && spotRef.current < 4) advanceSpot();
    if (def.id === "tour_du_monde" && r.made) {
      if (spotRef.current >= WORLD.length - 1) finishSession();
      else advanceSpot();
    }
    if (finish && n === 10) speak(`Main ${strongName} maintenant`);
    if (target && n >= target) finishSession();
  }
  const onShotRef = useRef(onShot);
  onShotRef.current = onShot;

  function advanceSpot() {
    spotRef.current++;
    setSpotIdx(spotRef.current);
    speak(`Spot suivant : ${SPOT_NAME[spots[spotRef.current]]}`);
  }

  async function finishSession() {
    if (live.current.phase !== "play") return;
    live.current.phase = "done";
    setPhase("done");
    const blob = await live.current.rec?.stop();
    stopLoop.current();
    stopCamera(streamRef.current);
    (live.current as { blob?: Blob }).blob = blob;
    if (live.current.people) {
      const list = shotsRef.current;
      setCards(live.current.people.people(live.current.shotTracks).map((p) => {
        const known = recognize(userId, p.descriptors);
        return {
          photo: p.face?.photo ?? null, descriptors: p.descriptors, shots: p.shots, made: p.shots.filter((i) => list[i]?.made).length, attempts: p.shots.length,
          guess: known ? { key: known.person.key, name: known.person.key === ME ? "Moi" : known.person.name } : null, guessOk: null,
          answer: null, name: "", consent: Boolean(known && known.person.descriptors.length),
        };
      }));
    }
  }

  const soloMade = made, soloAttempts = attempts;
  async function save() {
    setSaving(true);
    let list = shotsRef.current;
    // à plusieurs : chaque tir est rangé au nom de son joueur ; seules tes stats à toi comptent pour tes records
    let players: PlayerResult[] | null = null;
    let made = soloMade, attempts = soloAttempts;
    if (group) {
      const byKey = new Map<string, PlayerResult>();
      const who: string[] = [];
      const known = new Map(names);
      for (const c of cards) {
        let id = identity(c, known)!;
        if (id.key.startsWith("new:")) id = { key: crypto.randomUUID(), name: id.name };
        const name = id.key === ME ? profile?.first_name || "Moi" : id.name;
        const cur = byKey.get(id.key) ?? { key: id.key, name, made: 0, attempts: 0, pct: 0 };
        cur.made += c.made; cur.attempts += c.attempts;
        byKey.set(id.key, cur);
        for (const i of c.shots) who[i] = id.key;
        // visage gardé sur le téléphone : toujours pour toi, pour les autres seulement s'ils sont d'accord
        const faces = c.descriptors.length && (id.key === ME || c.consent) ? { descriptors: c.descriptors, photo: c.photo } : null;
        rememberPerson(userId, { key: id.key, name, faces });
        // les cartes suivantes au même prénom rejoignent cette personne
        if (id.key !== ME) known.set(id.key, name);
      }
      players = [...byKey.values()].map((p) => ({ ...p, pct: p.attempts ? Math.round((p.made / p.attempts) * 100) : 0 }));
      list = list.map((s, i) => ({ ...s, who: who[i] ?? null }));
      const me = players.find((p) => p.key === ME);
      made = me?.made ?? 0; attempts = me?.attempts ?? 0;
    }
    const pct = attempts ? Math.round((made / attempts) * 100) : 0;
    const avg = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
    let streak = 0, best = 0;
    const mine = group ? list.filter((s) => (s as Shot & { who?: string | null }).who === ME) : list;
    for (const s of mine) { streak = s.made ? streak + 1 : 0; best = Math.max(best, streak); }
    const duration = Math.round((performance.now() - live.current.startedAt) / 1000);
    const cands = [
      { key: "shoot:pct", value: pct, better: "higher" as const, label: "Réussite au shoot", unit: "%" },
      ...(def.id === "lancers_francs" ? [{ key: "shoot:lf_streak", value: best, better: "higher" as const, label: "Lancers francs d'affilée" }] : []),
      ...(def.id === "tour_du_monde" && spotRef.current >= WORLD.length - 1 ? [{ key: "shoot:tour", value: duration, better: "lower" as const, label: "Tour du monde", unit: "s" }] : []),
    ];
    const records = attempts >= 10 ? await checkRecords(cands).catch(() => []) : [];
    const id = crypto.randomUUID();
    const blob = (live.current as { blob?: Blob }).blob;
    if (blob?.size) await saveVideo(`shoot:${id}`, blob);
    const event = eventId ? events.find((e) => e.id === eventId) : null;
    const lastGame = event ? (event.payload.games ?? []).at(-1) === def.id : false;
    const measured = mine.filter((s) => s.measured !== false);
    const session = {
      id, event_id: eventId, kind: "shoot" as const, title: `Shoot · ${def.name}`, started_at: new Date(Date.now() - duration * 1000).toISOString(), duration_s: duration,
      results: {
        game: def.id, made, attempts, pct, best_streak: best, corrected: made !== mine.filter((s) => s.made).length || attempts !== mine.length,
        ...(players ? { players, group: true } : {}),
        // moyennes sur les seuls tirs vus depuis le lâcher : les autres n'ont pas de mesure fiable
        avgAngle: measured.length ? Math.round(avg(measured.map((s) => s.angle))) : null, avgDistance: measured.length ? Math.round(avg(measured.map((s) => s.distance)) * 10) / 10 : null,
        shots: list.map(({ path, ...s }) => ({ ...s, path })), advice: advice(mine), hasVideo: Boolean(blob?.size), records,
      },
      feeling: null,
    };
    const meas = attempts ? [{ kind: "shoot_pct", value: pct, source: "camera" }] : [];
    const kind = ({ cinq_spots: "shoot_ext_pct", tour_du_monde: "shoot_ext_pct", cinq_spots_mi: "mid_pct", lancers_francs: "ft_pct", finition: "finish_pct" } as Record<string, string>)[def.id];
    if (kind && attempts) meas.push({ kind, value: pct, source: "camera" });
    let all = meas;
    if (finish && list.length > 10) {
      const p = (l: Shot[]) => Math.round((l.filter((s) => s.made).length / Math.max(1, l.length)) * 100);
      all = withAmbiIndex(measurements, [...meas, { kind: "weak_finish_pct", value: p(list.slice(0, 10)), source: "camera" }, { kind: "strong_finish_pct", value: p(list.slice(10)), source: "camera" }]);
    }
    const status = await saveSession({ session, measurements: all, eventDone: lastGame ? eventId : null });
    nav(`/recap/${id}`, { replace: true, state: { session, queued: status === "queued" } });
  }

  function placeRim(e: RPointerEvent<HTMLDivElement>) {
    if (phase !== "calib") return;
    const b = e.currentTarget.getBoundingClientRect();
    setRim({ x: e.clientX - b.left, y: e.clientY - b.top });
  }

  const pct = attempts ? Math.round((made / attempts) * 100) : 0;
  const lastShot = shots.at(-1);
  const ok = checks.light && checks.ball && rim;
  return (
    <div className="cam-screen pb-cam">
      <video ref={videoRef} playsInline muted aria-hidden="true" />
      <canvas ref={canvasRef} className="overlay" aria-hidden="true" />
      <div style={{ position: "absolute", inset: 0, zIndex: 3 }} onPointerDown={placeRim} aria-hidden="true" />
      <div className="cam-top">
        <IconButton icon="x" label="Quitter la session" onClick={() => (phase === "play" ? finishSession() : nav(-1))} style={{ background: "var(--camera-scrim)" }} />
        <div className="pb-hud" style={{ flex: 1, justifyContent: "space-between" }}>
          <div><div className="lbl" style={{ fontSize: 10 }}>Réussis</div><b className="pb-num" style={{ fontSize: 24 }}>{made}/{attempts}</b></div>
          <div style={{ textAlign: "center" }}><div className="lbl" style={{ fontSize: 10 }}>{def.name}</div><b className="pb-num" style={{ fontSize: 24 }}>{pct} %</b></div>
          <div style={{ textAlign: "right" }}><div className="lbl" style={{ fontSize: 10 }}>{finish ? "Main" : "Spot"}</div><b style={{ fontSize: 14 }}>{finish ? (attempts < 10 ? `${weakName} (faible)` : strongName) : SPOT_NAME[currentSpot]}</b></div>
        </div>
      </div>
      {loading ? <div className="cam-center"><div className="pb-hud"><span className="spinner" />{loading}</div></div> : null}

      <div className="cam-bottom">
        {phase === "setup" ? (
          <div className="pb-glass hero" style={{ padding: 16, background: "rgba(13,27,77,.92)" }}>
            <h1 className="t" style={{ fontSize: 22 }}>{def.name}</h1>
            <p className="lead" style={{ margin: "4px 0 12px" }}>{def.desc}</p>
            <div className="pb-chips" style={{ marginBottom: 10 }} role="group" aria-label="Seul ou à plusieurs">
              <Chip active={!group} pressed={!group} icon="user" onClick={() => nav(`/shoot?jeu=${gameId}${eventId ? `&event=${eventId}` : ""}`, { replace: true })}>Solo</Chip>
              <Chip active={group} pressed={group} icon="ball" onClick={() => nav(`/shoot?groupe=1${eventId ? `&event=${eventId}` : ""}`, { replace: true })}>À plusieurs</Chip>
            </div>
            {!group ? (
              <div className="pb-chips" style={{ marginBottom: 12 }}>
                {["tir_libre", "cinq_spots", "tour_du_monde", "lancers_francs"].map((id) => (
                  <Chip key={id} active={id === def.id} onClick={() => nav(`/shoot?jeu=${id}${eventId ? `&event=${eventId}` : ""}`, { replace: true })}>{gameDef(id)!.name}</Chip>
                ))}
              </div>
            ) : null}
            {group
              ? <Notice>Tir libre à plusieurs : chaque tir est compté pour celui qui lâche le ballon. Pour une photo nette, passez chacun face à la caméra, à 2 m environ, avant de tirer. Photos et visages restent sur ton téléphone.</Notice>
              : <Notice>Trépied de côté, à 4–6 m, en paysage : le cercle et toi devez rester dans le cadre. La vidéo reste sur ton téléphone.</Notice>}
            <button className="link" style={{ marginTop: 8, fontSize: 13 }} onClick={() => nav("/shoot/historique")}>Revoir mes sessions de shoot</button>
            <div style={{ marginTop: 12 }}>
              {warmed ? <button className="pb-btn primary lg block" onClick={openCamera}><Icon name="video" size="sm" />Calibrer la caméra</button>
                : <WarmupGate onDone={() => { markWarmed(); setWarmed(true); openCamera(); }} />}
            </div>
          </div>
        ) : null}
        {phase === "calib" ? (
          <div className="pb-glass" style={{ padding: 16, background: "rgba(13,27,77,.88)" }}>
            <b style={{ fontSize: 16 }}>Calibrage du panier</b>
            <p className="pb-muted" style={{ margin: "4px 0 10px", fontSize: 14 }}>{rim ? "Ajuste la taille du cercle violet sur l'arceau." : "Touche le cercle du panier à l'écran."}</p>
            <div className="col" style={{ gap: 10 }}>
              <Check ok={Boolean(rim)} label="Cercle repéré" hint="touche l'arceau" />
              <Check ok={checks.ball} label="Ballon détecté" hint="lance-le en l'air devant la caméra" />
              <Check ok={checks.light} label="Lumière suffisante" hint="filme dos à la lumière" />
            </div>
            {group ? <p className="pb-muted" role="status" style={{ margin: "10px 0 0", fontSize: 13 }}>{facesState === "loading" ? "Chargement de la reconnaissance des visages…" : facesState === "failed" ? "Reconnaissance des visages indisponible : les tirs seront quand même comptés par joueur, sans photo." : `Joueurs dans le cadre : ${seenCount}. Passez chacun face à la caméra pour la photo.`}</p> : null}
            {rim ? (
              <div className="row between" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
                <Stepper label="Taille du cercle" value={rimSize} unit="px" step={2} min={8} max={120} onChange={setRimSize} />
                <Stepper label="Hauteur du panier" value={hoopH} unit="m" step={0.05} min={2} max={3.5} digits={2} onChange={setHoopH} />
              </div>
            ) : null}
            {error ? <div style={{ marginTop: 12 }} className="col"><Notice tone="error">{error}</Notice><button className="pb-btn" onClick={() => { stopLoop.current(); stopCamera(streamRef.current); openCamera(); }}>Réessayer</button></div> : null}
            <button className="pb-btn primary lg block cam-btn" style={{ marginTop: 14 }} disabled={!ok} onClick={startPlay}>Commencer</button>
          </div>
        ) : null}
        {phase === "play" ? (
          <div className="pb-glass" style={{ padding: "14px 16px" }}>
            <div className="grid3" style={{ textAlign: "center" }}>
              <div><b className="pb-num" style={{ fontSize: 22 }}>{lastShot && lastShot.measured !== false ? `${lastShot.angle}°` : "—"}</b><div className="pb-muted" style={{ fontSize: 12 }}>angle</div></div>
              <div><b className="pb-num" style={{ fontSize: 22 }}>{lastShot && lastShot.measured !== false ? num(lastShot.speed, 1) : "—"}</b><div className="pb-muted" style={{ fontSize: 12 }}>m/s</div></div>
              <div><b className="pb-num" style={{ fontSize: 22 }}>{lastShot && lastShot.measured !== false ? num(lastShot.distance, 1) : "—"}</b><div className="pb-muted" style={{ fontSize: 12 }}>m</div></div>
            </div>
            {group ? <p className="pb-muted" role="status" style={{ margin: "10px 0 0", fontSize: 13, textAlign: "center" }}>Joueurs dans le cadre : {seenCount}</p> : null}
            <button className="pb-btn lg block" style={{ marginTop: 12 }} onClick={finishSession}>Terminer la session</button>
          </div>
        ) : null}
        {phase === "done" && group ? (
          <GroupReview cards={cards} names={names} saving={saving} onSave={save} onChange={(i, c) => setCards((l) => l.map((x, k) => (k === i ? { ...x, ...c } : x)))} />
        ) : null}
        {phase === "done" && !group ? (
          <div className="pb-glass hero" style={{ padding: 16, background: "rgba(13,27,77,.94)" }}>
            <b style={{ fontSize: 16 }}>Vérifie le comptage</b>
            <p className="pb-muted" style={{ margin: "4px 0 12px", fontSize: 14 }}>La caméra a compté {shots.filter((s) => s.made).length} réussis sur {shots.length}. Corrige si besoin.</p>
            <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
              <Stepper label="Réussis" value={made} unit="réussis" max={attempts} onChange={setMade} />
              <Stepper label="Tentés" value={attempts} unit="tentés" min={made} onChange={setAttempts} />
            </div>
            <button className="pb-btn primary lg block" style={{ marginTop: 14 }} disabled={saving} onClick={save}>{saving ? "Enregistrement…" : "Valider et voir l'analyse"}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function drawRim(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.strokeStyle = "#8c7bff"; ctx.lineWidth = 3; ctx.shadowColor = "#8c7bff"; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Gestuelle : temps de déclenchement, saut (cm), angle du coude au lâcher. */
function gesture(L: { hip0: number[]; wristBall: { t: number; d: number; y: number }[]; dipT: number; hipMin: number; elbowAtRel: number | null }, lms: NormalizedLandmark[] | null, bp: { t: number; x: number; y: number } | null, t: number, vw: number, vh: number, pxPerM: number) {
  if (!lms || !bp) return { releaseMs: null, jumpCm: null, elbow: null };
  const hipY = ((lms[LM.lHip].y + lms[LM.rHip].y) / 2) * vh;
  const lw = { x: lms[LM.lWrist].x * vw, y: lms[LM.lWrist].y * vh };
  const rw = { x: lms[LM.rWrist].x * vw, y: lms[LM.rWrist].y * vh };
  const right = Math.hypot(bp.x - rw.x, bp.y - rw.y) < Math.hypot(bp.x - lw.x, bp.y - lw.y);
  const d = Math.min(Math.hypot(bp.x - rw.x, bp.y - rw.y), Math.hypot(bp.x - lw.x, bp.y - lw.y));
  L.wristBall.push({ t, d, y: bp.y });
  while (L.wristBall.length && t - L.wristBall[0].t > 2500) L.wristBall.shift();
  L.hip0.push(hipY);
  if (L.hip0.length > 90) L.hip0.shift();
  const base = [...L.hip0].sort((a, b) => a - b)[Math.floor(L.hip0.length * 0.7)] ?? hipY;
  // Point bas (dip) : ballon tenu et au plus bas sur les 1,5 dernières secondes.
  const held = L.wristBall.filter((q) => q.d < 0.08 * vw && t - q.t < 1500);
  const dip = held.reduce((a, q) => (q.y > (a?.y ?? -1) ? q : a), held[0]);
  const s = right ? [LM.rShoulder, LM.rElbow, LM.rWrist] : [LM.lShoulder, LM.lElbow, LM.lWrist];
  const [A, B, C] = s.map((i) => ({ x: lms[i].x * vw, y: lms[i].y * vh }));
  const ang = Math.abs((Math.atan2(A.y - B.y, A.x - B.x) - Math.atan2(C.y - B.y, C.x - B.x)) * 180 / Math.PI);
  const elbow = Math.round(ang > 180 ? 360 - ang : ang);
  const releaseMs = dip ? Math.round(t - dip.t) : null;
  const jumpCm = Math.max(0, Math.round(((base - Math.min(...L.hip0.slice(-30))) / pxPerM) * 100));
  return { releaseMs: releaseMs && releaseMs < 2000 ? releaseMs : null, jumpCm: jumpCm < 120 ? jumpCm : null, elbow };
}

/** Squelette dont un poignet est le plus près du point (x, y), en part de l'image. */
function nearestTo(people: NormalizedLandmark[][], x: number, y: number): NormalizedLandmark[] | null {
  let best: { p: NormalizedLandmark[]; d: number } | null = null;
  for (const p of people) {
    const d = Math.min(...[p[LM.lWrist], p[LM.rWrist]].map((w) => Math.hypot(w.x - x, w.y - y)));
    if (!best || d < best.d) best = { p, d };
  }
  return best?.p ?? null;
}

/** Couleurs du maillot et du short : entre les épaules et les genoux, en petit. */
function torsoSig(v: HTMLVideoElement, lms: NormalizedLandmark[], c: HTMLCanvasElement): number[] | null {
  const pts = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].map((i) => lms[i]);
  if (pts.some((p) => (p.visibility ?? 0) < 0.4)) return null;
  const vw = v.videoWidth, vh = v.videoHeight;
  const x0 = Math.min(...pts.map((p) => p.x)) * vw, x1 = Math.max(...pts.map((p) => p.x)) * vw;
  const y0 = Math.min(...pts.map((p) => p.y)) * vh, y1 = Math.max(...pts.map((p) => p.y)) * vh;
  const w = Math.max(8, x1 - x0), h = Math.max(8, (y1 - y0) * 1.4);
  c.width = 12; c.height = 16;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(v, x0 - w * 0.1, y0, w * 1.2, h, 0, 0, 12, 16);
  return clothesSig(ctx.getImageData(0, 0, 12, 16).data);
}

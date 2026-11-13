import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { BackButton, BottomAction, Chip, Notice, Spinner, Stat } from "../components/ui";
import { supabase } from "../lib/supabase";
import { dayLabel, iso, num } from "../lib/format";
import { loadVideo } from "../vision/media";
import { zoneOf, type Shot } from "../vision/shot";
import type { SessionRow } from "../lib/types";
import { ME, type PlayerResult } from "../lib/people";
import { appleTrajectories, compareShots, shotArcs, visionCaps } from "../native/vision";

const PXM = 20; // pixels par mètre sur le schéma
const ZONES: Record<string, [number, number]> = { coin_g: [40, 40], coin_d: [290, 40], aile_g: [70, 175], aile_d: [262, 175], axe: [165, 232], raquette: [165, 100] };

export default function ShootAnalysis() {
  const { sessionId } = useParams();
  const loc = useLocation() as { state?: { session?: SessionRow } };
  const [s, setS] = useState<SessionRow | null>(loc.state?.session ?? null);
  const [tab, setTab] = useState<"chart" | "shots" | "gesture">("chart");
  const [replay, setReplay] = useState<number | null>(null);
  // session à plusieurs : tirs d'un seul joueur (null : tout le monde)
  const [who, setWho] = useState<string | null>(null);

  useEffect(() => {
    if (s) return;
    supabase.from("sessions").select("*").eq("id", sessionId!).maybeSingle().then(({ data }) => setS(data as SessionRow));
  }, [sessionId, s]);
  if (!s) return <main className="pb-page screen no-nav"><Spinner /></main>;

  const r = s.results;
  const players: PlayerResult[] = r.players ?? [];
  const shots: Shot[] = ((r.shots ?? []) as (Shot & { who?: string | null })[]).filter((x) => !who || x.who === who);
  const sel = players.find((p) => p.key === who);
  const total = { made: sel ? sel.made : players.length ? players.reduce((n, p) => n + p.made, 0) : r.made, attempts: sel ? sel.attempts : players.length ? players.reduce((n, p) => n + p.attempts, 0) : r.attempts };
  const avg = (l: (number | null)[]) => { const v = l.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // à plusieurs : moyennes recalculées sur les tirs affichés (vus depuis le lâcher)
  const seenShots = shots.filter((x) => x.measured !== false);
  const mAngle = avg(seenShots.map((x) => x.angle)), mDist = avg(seenShots.map((x) => x.distance));
  const byZone = new Map<string, { m: number; n: number }>();
  for (const sh of shots) {
    const z = zoneOf(sh.courtX, sh.courtY);
    const cur = byZone.get(z) ?? { m: 0, n: 0 };
    byZone.set(z, { m: cur.m + (sh.made ? 1 : 0), n: cur.n + 1 });
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 140 }}>
      <div className="hdr"><BackButton /><div style={{ flex: 1, paddingLeft: 6 }}><b style={{ fontSize: 17 }}>Analyse du shoot</b><div className="pb-subtle" style={{ fontSize: 13 }}>{dayLabel(iso(new Date(s.started_at)))} · {total.attempts} tirs{players.length > 1 ? ` · ${players.length} joueurs` : ""}</div></div></div>
      {players.length ? (
        <>
          <div className="lbl section" style={{ marginTop: 14 }}>Joueurs</div>
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            {players.map((p) => (
              <Link key={p.key} to={`/shoot/joueur/${p.key}`} className="pb-li" style={{ color: "inherit", textDecoration: "none" }}>
                <Icon name="user" className="pb-muted" />
                <div className="t">{p.key === ME ? "Toi" : p.name}<small>{p.made}/{p.attempts} · voir ses séries</small></div>
                <b className="pb-num">{p.pct} %</b>
              </Link>
            ))}
          </div>
          <div className="pb-chips" style={{ marginTop: 12 }} role="group" aria-label="Tirs de quel joueur">
            <Chip active={!who} pressed={!who} onClick={() => setWho(null)}>Tout le monde</Chip>
            {players.map((p) => <Chip key={p.key} active={who === p.key} pressed={who === p.key} onClick={() => { setWho(p.key); setReplay(null); }}>{p.key === ME ? "Toi" : p.name}</Chip>)}
          </div>
        </>
      ) : null}
      <div className="pb-chips" style={{ margin: "14px 0 12px" }}>
        <Chip active={tab === "chart"} onClick={() => setTab("chart")}>Shot chart</Chip>
        <Chip active={tab === "shots"} onClick={() => setTab("shots")}>Par tir</Chip>
        <Chip active={tab === "gesture"} onClick={() => setTab("gesture")}>Gestuelle</Chip>
      </div>

      {tab === "chart" ? (
        <div className="pb-glass hero" style={{ padding: 12 }}>
          <svg viewBox="0 0 330 250" style={{ width: "100%", display: "block" }} role="img" aria-label={`Carte des tirs : ${total.made} réussis sur ${total.attempts}`}>
            <g fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5">
              <rect x="1" y="1" width="328" height="248" rx="14" /><rect x="115" y="1" width="100" height="120" /><circle cx="165" cy="121" r="36" />
              <path d="M28 1v70a137 137 0 0 0 274 0V1" />
            </g>
            <circle cx="165" cy="22" r="8" fill="none" stroke="var(--cat-basket)" strokeWidth="2.5" /><path d="M150 12h30" stroke="#fff" strokeWidth="2.5" />
            <g fontFamily="Inter Display, Inter" fontWeight="600" fontSize="15" fill="#fff" textAnchor="middle">
              {[...byZone].map(([z, v]) => <text key={z} x={ZONES[z][0]} y={ZONES[z][1]}>{Math.round((v.m / v.n) * 100)}%</text>)}
            </g>
            {shots.map((sh, i) => {
              const x = Math.min(320, Math.max(10, 165 + sh.courtX * PXM)), y = Math.min(240, Math.max(10, 22 + sh.courtY * PXM + (i % 3) * 3));
              return sh.made ? <circle key={i} cx={x} cy={y} r="5" fill="var(--success)" /> : <path key={i} d={`M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8`} stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round" />;
            })}
          </svg>
          <div className="row" style={{ justifyContent: "center", gap: 16, marginTop: 8, font: "500 12px var(--font-sans)" }}>
            <span className="row" style={{ gap: 6 }}><span className="sw" style={{ background: "var(--success)", borderRadius: "50%" }} />Réussi</span>
            <span className="row" style={{ gap: 6, color: "var(--danger)" }}>✕ <span className="pb-muted">Raté</span></span>
          </div>
        </div>
      ) : tab === "shots" ? (
        <div className="pb-glass" style={{ padding: "4px 0" }}>
          {shots.length ? shots.map((sh, i) => (
            <button key={i} className="pb-li" onClick={() => r.hasVideo && setReplay(i)} disabled={!r.hasVideo}>
              <span className="pill-sm" style={{ color: sh.made ? "var(--success)" : "var(--danger)", minWidth: 40, justifyContent: "center" }}>{sh.made ? "✓" : "✕"} {i + 1}</span>
              <div className="t">{sh.measured === false ? "Départ du tir non vu" : <>{sh.angle}° · {num(sh.speed, 1)} m/s · {num(sh.distance, 1)} m</>}<small>Hauteur max {num(sh.apex, 1)} m{sh.made ? "" : sh.short ? " · court" : " · long"}</small></div>
              {r.hasVideo ? <Icon name="play" size="sm" className="pb-muted" /> : null}
            </button>
          )) : <p className="pb-muted" style={{ padding: 16, margin: 0 }}>Aucun tir détecté.</p>}
        </div>
      ) : (
        <div className="grid2">
          <Stat k="Déclenchement" v={avg(shots.map((x) => x.releaseMs)) != null ? num(avg(shots.map((x) => x.releaseMs))) : "—"} unit="ms" />
          <Stat k="Saut moyen" v={avg(shots.map((x) => x.jumpCm)) != null ? num(avg(shots.map((x) => x.jumpCm))) : "—"} unit="cm" />
          <Stat k="Angle du coude" v={avg(shots.map((x) => x.elbow)) != null ? num(avg(shots.map((x) => x.elbow))) : "—"} unit="°" />
          <Stat k="Hauteur max" v={num(avg(shots.map((x) => x.apex)) ?? 0, 1)} unit="m" />
        </div>
      )}

      <div className="grid3" style={{ marginTop: 12 }}>
        <Stat k="Réussite" v={total.made} unit={`/${total.attempts}`} />
        <Stat k="Angle moy." v={players.length ? (mAngle != null ? Math.round(mAngle) : "—") : r.avgAngle ?? "—"} unit="°" />
        <Stat k="Distance" v={players.length ? (mDist != null ? num(mDist, 1) : "—") : r.avgDistance != null ? num(r.avgDistance, 1) : "—"} unit="m" />
      </div>
      {(r.advice ?? []).length ? (
        <div className="pb-glass" style={{ marginTop: 12, padding: 14, borderColor: "rgba(140,123,255,.45)", background: "var(--primary-soft)" }}>
          <div className="row" style={{ marginBottom: 6 }}><Icon name="bolt" size="sm" style={{ color: "var(--primary-bright)" }} /><b style={{ fontSize: 15 }}>Conseil</b></div>
          {(r.advice as string[]).map((a) => <p key={a} style={{ margin: "0 0 4px", fontSize: 14, lineHeight: "21px" }}>{a}</p>)}
        </div>
      ) : null}
      {r.corrected ? <p className="pb-subtle" style={{ fontSize: 12 }}>Comptage corrigé à la main : {r.made}/{r.attempts}.</p> : null}
      {r.hasVideo ? <AppleCheck sessionId={s.id} shots={(r.shots ?? []) as Shot[]} /> : null}
      {r.hasVideo ? (
        <BottomAction><button className="pb-btn lg block" onClick={() => setReplay(0)}><Icon name="play" size="sm" />Revoir les tirs avec trajectoire</button></BottomAction>
      ) : <div style={{ marginTop: 12 }}><Notice>Les vidéos de cette session ne sont pas sur ce téléphone.</Notice></div>}
      {replay != null ? <Replay sessionId={s.id} shots={shots} index={replay} onIndex={setReplay} onClose={() => setReplay(null)} /> : null}
    </main>
  );
}

function Replay({ sessionId, shots, index, onIndex, onClose }: { sessionId: string; shots: Shot[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const sh = shots[index];

  useEffect(() => {
    let u: string | null = null;
    loadVideo(`shoot:${sessionId}`).then((b) => { if (!b) return setMissing(true); u = URL.createObjectURL(b); setUrl(u); });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [sessionId]);

  useEffect(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !url || !sh) return;
    v.currentTime = sh.t0 / 1000;
    v.playbackRate = 0.5;
    v.play().catch(() => undefined);
    let raf = 0;
    const draw = () => {
      const W = (c.width = c.clientWidth), H = (c.height = c.clientHeight);
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);
      const vw = v.videoWidth || 1, vh = v.videoHeight || 1;
      const s = Math.min(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
      const k = Math.min(1, Math.max(0, (v.currentTime * 1000 - (sh.t0 + 1200)) / Math.max(1, sh.t1 - sh.t0 - 1200)));
      const pts = sh.path.slice(0, Math.max(2, Math.ceil(sh.path.length * k)));
      ctx.strokeStyle = sh.made ? "#3ddc97" : "#ff6b81"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * vw * s, oy + y * vh * s) : ctx.moveTo(ox + x * vw * s, oy + y * vh * s)));
      ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "600 16px 'Inter Display', Inter";
      ctx.fillText(sh.measured === false ? `${sh.made ? "Réussi" : "Raté"} · départ du tir non vu` : `${sh.made ? "Réussi" : "Raté"} · ${sh.angle}° · ${num(sh.speed, 1)} m/s · ${num(sh.distance, 1)} m`, 16, H - 20);
      if (v.currentTime * 1000 > sh.t1) v.pause();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [url, sh]);

  return (
    <div className="cam-screen" role="dialog" aria-modal="true" aria-label="Replay des tirs">
      {missing ? <div className="cam-center"><Notice>Vidéo introuvable sur ce téléphone.</Notice></div> : null}
      <video ref={videoRef} src={url ?? undefined} playsInline muted style={{ objectFit: "contain" }} />
      <canvas ref={canvasRef} className="overlay" aria-hidden="true" />
      <div className="cam-top"><button className="pb-icon-btn" aria-label="Fermer le replay" onClick={onClose} style={{ background: "var(--camera-scrim)" }}><Icon name="x" /></button>
        <div className="pb-hud" style={{ flex: 1 }}><b>Tir {index + 1} / {shots.length}</b><span className="pb-muted">ralenti ×0,5</span></div></div>
      <div className="cam-bottom row">
        <button className="pb-btn lg" style={{ flex: 1 }} disabled={index === 0} onClick={() => onIndex(index - 1)}><Icon name="left" size="sm" />Précédent</button>
        <button className="pb-btn primary lg" style={{ flex: 1 }} disabled={index >= shots.length - 1} onClick={() => onIndex(index + 1)}>Suivant<Icon name="right" size="sm" /></button>
      </div>
    </div>
  );
}

/** App iPhone : deuxième avis sur le comptage, par la détection de trajectoires d'Apple (Vision), en essai.
 *  L'analyse actuelle reste celle qui compte tant que celle d'Apple n'a pas fait 100 % sur les 17 tirs de référence. */
function AppleCheck({ sessionId, shots }: { sessionId: string; shots: Shot[] }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [res, setRes] = useState<ReturnType<typeof compareShots> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { visionCaps().then((c) => setOk(c.trajectories)); }, []);
  if (!ok) return null;
  async function run() {
    setErr(null); setBusy(0);
    try {
      const video = await loadVideo(`shoot:${sessionId}`);
      if (!video) throw new Error("La vidéo de cette session n'est plus sur ce téléphone.");
      const out = await appleTrajectories(video, setBusy);
      const cmp = compareShots(shotArcs(out.trajectories), shots);
      setRes(cmp);
      supabase.from("debug_traces").insert({ kind: "apple_traj", data: { sessionId, shots: shots.map((x) => [x.t0, x.t1, x.made]), cmp, frames: out.frames,
        trajectories: out.trajectories.map((t) => ({ t0: t.t0, t1: t.t1, c: t.confidence, k: t.coeffs, n: t.points.length })) } }).then(() => undefined, () => undefined);
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }
  return (
    <div className="pb-glass" style={{ marginTop: 12, padding: 14, display: "grid", gap: 8 }}>
      <b style={{ fontSize: 15 }}>Deuxième avis : détection Apple (essai)</b>
      <span className="pb-muted" style={{ fontSize: 13 }}>Apple repère les trajectoires du ballon dans ta vidéo. On compare avec les tirs comptés par l'app, pour voir laquelle est la plus fiable.</span>
      {res ? (
        <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
          <span>Arcs de tir vus par Apple : <b className="pb-num">{res.arcs}</b> (l'app a compté {shots.length} tirs)</span>
          <span>Tirs de l'app retrouvés par Apple : <b className="pb-num">{res.matched}/{shots.length}</b></span>
          {res.extra ? <span>Arcs vus par Apple sans tir compté par l'app : <b className="pb-num">{res.extra}</b> (tir oublié par l'app, ou passe et dribble haut)</span> : null}
        </div>
      ) : null}
      {err ? <Notice tone="error">{err}</Notice> : null}
      <button className="pb-btn" disabled={busy != null} onClick={run}>{busy != null ? `Analyse en cours… ${Math.round(busy * 100)} %` : res ? "Relancer l'analyse Apple" : "Lancer l'analyse Apple"}</button>
    </div>
  );
}

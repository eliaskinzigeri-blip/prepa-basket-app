// Module natif PrepaVision (app iPhone) : sauts mesurés avec le suivi du corps en 3D d'ARKit, et trajectoires du
// ballon détectées par Vision dans la vidéo d'une session de shoot. Sans effet dans le navigateur.
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { LM } from "../vision/models";
import { isNative } from "./index";

export interface Trajectory { t0: number; t1: number; confidence: number; coeffs: [number, number, number]; points: [number, number][] }
interface PrepaVisionPlugin {
  capabilities(): Promise<{ bodyTracking: boolean; trajectories: boolean; liveVision: boolean }>;
  startLive(): Promise<void>;
  stopLive(): Promise<void>;
  addListener(e: "liveFrame", fn: (f: LiveFrame) => void): Promise<PluginListenerHandle>;
  jump3D(o: { trials: number }): Promise<{ cancelled: boolean; trials: (number | null)[]; reasons: string[]; statureM: number }>;
  beginFile(o: { ext: string }): Promise<{ ok: boolean }>;
  appendFile(o: { data: string }): Promise<void>;
  analyzeTrajectories(): Promise<{ frames: number; duration: number; trajectories: Trajectory[] }>;
}

const PrepaVision = registerPlugin<PrepaVisionPlugin>("PrepaVision");

type Caps = { bodyTracking: boolean; trajectories: boolean; liveVision: boolean };
const NONE: Caps = { bodyTracking: false, trajectories: false, liveVision: false };
let caps: Promise<Caps> | null = null;
export function visionCaps(): Promise<Caps> {
  if (!isNative()) return Promise.resolve(NONE);
  return (caps ??= PrepaVision.capabilities().then((c) => ({ ...NONE, ...c })).catch(() => NONE));
}

// ---------- suivi en direct (jeux de dribble) ----------

interface LiveFrame {
  t: number; w: number; h: number; light: number;
  objs?: { l: string; c: number }[];
  ball: { x: number; y: number; r: number; score: number; predicted: boolean } | null;
  pose: Record<string, [number, number, number]> | null;
}
type Landmark = { x: number; y: number; z: number; visibility: number };
const KNEES: Record<string, number> = { lKnee: 25, rKnee: 26 };

/** Caméra avant native derrière la page, ballon (YOLOv3) et corps (Vision) à chaque image, au format de la vision web. */
export async function startNativeLive() {
  let last: LiveFrame | null = null;
  let frames = 0, balls = 0, tracked = 0;
  // diagnostic : ce que le modèle reconnaît (étiquette → nombre et meilleure confiance)
  const labels: Record<string, { n: number; max: number }> = {};
  const handle = await PrepaVision.addListener("liveFrame", (f) => {
    last = f; frames++;
    if (f.ball) { if (f.ball.predicted) tracked++; else balls++; }
    for (const o of f.objs ?? []) { const e = (labels[o.l] ??= { n: 0, max: 0 }); e.n++; e.max = Math.max(e.max, Math.round(o.c * 100) / 100); }
  });
  document.documentElement.classList.add("native-cam");
  try { await PrepaVision.startLive(); } catch (e) { handle.remove(); document.documentElement.classList.remove("native-cam"); throw e; }
  // « vidéo » vue par le reste du jeu : seulement ses dimensions (pour placer les points à l'écran)
  const video = { videoWidth: 720, videoHeight: 1280, readyState: 4 } as unknown as HTMLVideoElement;
  const pose = (p: LiveFrame["pose"]): Landmark[] | null => {
    if (!p) return null;
    const out: Landmark[] = Array.from({ length: 33 }, () => ({ x: Number.NaN, y: Number.NaN, z: 0, visibility: 0 }));
    for (const [k, v] of Object.entries(p)) {
      const i = (LM as Record<string, number>)[k] ?? KNEES[k];
      if (i != null) out[i] = { x: v[0], y: v[1], z: 0, visibility: v[2] };
    }
    return out;
  };
  return {
    video,
    frame() {
      const f = last;
      if (!f) return { ball: null, pose: null, light: 0 };
      (video as unknown as { videoWidth: number; videoHeight: number }).videoWidth = f.w;
      (video as unknown as { videoWidth: number; videoHeight: number }).videoHeight = f.h;
      return { ball: f.ball, pose: pose(f.pose), light: f.light };
    },
    stats: () => ({ native: true, v: 2, frames, balls, tracked, labels }),
    close() {
      handle.remove();
      PrepaVision.stopLive().catch(() => undefined);
      document.documentElement.classList.remove("native-cam");
    },
  };
}

export const jump3D = (trials = 3) => PrepaVision.jump3D({ trials });

/** Envoie la vidéo au module natif par morceaux (le pont Capacitor ne transporte que du texte), puis l'analyse. */
export async function appleTrajectories(video: Blob, onProgress?: (p: number) => void) {
  await PrepaVision.beginFile({ ext: /mp4|quicktime/.test(video.type) ? "mp4" : "webm" });
  const CHUNK = 1_500_000;
  for (let i = 0; i < video.size; i += CHUNK) {
    const buf = new Uint8Array(await video.slice(i, i + CHUNK).arrayBuffer());
    let bin = "";
    for (let j = 0; j < buf.length; j += 0x8000) bin += String.fromCharCode(...buf.subarray(j, j + 0x8000));
    await PrepaVision.appendFile({ data: btoa(bin) });
    onProgress?.(Math.min(1, (i + CHUNK) / video.size) * 0.5);
  }
  onProgress?.(0.5);
  const r = await PrepaVision.analyzeTrajectories();
  onProgress?.(1);
  return r;
}

/** Arcs de tir : trajectoires assez longues, en cloche (concaves vers le bas dans le repère de Vision). */
export function shotArcs(list: Trajectory[]) {
  return list.filter((t) => t.t1 - t.t0 >= 0.25 && t.points.length >= 6 && t.coeffs[0] < 0);
}

/** Comparaison avec les tirs comptés par l'app (fenêtres en ms depuis le début de la vidéo). */
export function compareShots(arcs: Trajectory[], shots: { t0: number; t1: number }[]) {
  const near = (a: Trajectory, s: { t0: number; t1: number }) => a.t0 * 1000 <= s.t1 + 600 && a.t1 * 1000 >= s.t0 - 600;
  const matched = shots.filter((s) => arcs.some((a) => near(a, s))).length;
  const extra = arcs.filter((a) => !shots.some((s) => near(a, s))).length;
  return { arcs: arcs.length, matched, missedByApple: shots.length - matched, extra };
}

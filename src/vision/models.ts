// Modèles de vision chargés à la demande, exécutés sur le téléphone (PRD : aucune vidéo envoyée).
// Ballon : voir engine.ts (modèle dans un worker + suivi couleur). Ici : corps pour les tests physiques.
import type { PoseLandmarker } from "@mediapipe/tasks-vision";

export const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
export const DETECTOR = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
export const POSE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

let vision: Promise<typeof import("@mediapipe/tasks-vision")> | null = null;
let fileset: Promise<unknown> | null = null;
let pose: Promise<PoseLandmarker> | null = null;

function lib() {
  vision ??= import("@mediapipe/tasks-vision");
  return vision;
}
async function files() {
  const v = await lib();
  fileset ??= v.FilesetResolver.forVisionTasks(WASM);
  return fileset as ReturnType<typeof v.FilesetResolver.forVisionTasks>;
}

async function withGpuFallback<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try {
    return await make("GPU");
  } catch {
    return make("CPU");
  }
}

export function loadPose(): Promise<PoseLandmarker> {
  pose ??= (async () => {
    const v = await lib();
    const fs = await files();
    return withGpuFallback((delegate) =>
      v.PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: POSE, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    );
  })();
  return pose;
}

export interface Ball { x: number; y: number; r: number; score: number } // coordonnées normalisées 0–1

/**
 * Compteur de dribbles avec hystérésis : un rebond = descente puis remontée du ballon
 * d'au moins `minAmp` (en pixels), sur une position lissée. Évite de compter le tremblement.
 */
export function bounceCounter(minAmp: () => number) {
  let ys: number | null = null;
  let dir: "down" | "up" | null = null;
  let extreme = 0, start = 0;
  return (y: number): "bottom" | "top" | null => {
    ys = ys == null ? y : ys * 0.4 + y * 0.6;
    const amp = minAmp();
    // sens de départ fixé par le premier mouvement franc, sans compter de rebond
    if (dir == null) {
      if (!start) start = ys;
      if (Math.abs(ys - start) > amp) { dir = ys > start ? "down" : "up"; extreme = ys; }
      return null;
    }
    if (dir === "down") {
      if (ys > extreme) extreme = ys;
      else if (extreme - ys > amp) { dir = "up"; extreme = ys; return "bottom"; }
    } else {
      if (ys < extreme) extreme = ys;
      else if (ys - extreme > amp) { dir = "down"; extreme = ys; return "top"; }
    }
    return null;
  };
}

/** Luminosité moyenne 0–255, pour prévenir quand la lumière est insuffisante. */
export function brightness(video: HTMLVideoElement, c: HTMLCanvasElement): number {
  c.width = 32;
  c.height = 24;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, 32, 24);
  const d = ctx.getImageData(0, 0, 32, 24).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 4);
}

export const LM = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 };

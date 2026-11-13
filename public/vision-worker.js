// Worker de vision : exécute les modèles MediaPipe (ballon, corps) hors du fil d'affichage.
// Worker classique : MediaPipe charge son moteur avec importScripts, absent des workers « module ».
/* global importScripts, OffscreenCanvas */
var module = { exports: {} };
var exports = module.exports;
importScripts("/mediapipe/vision_bundle.js");
const { FilesetResolver, ObjectDetector, PoseLandmarker } = module.exports;

let det = null;
let pose = null;
let fileset = null;
let detOpts = null;
// diagnostic : moteur utilisé et nombre de ballons trouvés
const stats = { detDelegate: null, poseDelegate: null, frames: 0, detections: 0 };

async function create(make, prefer, key) {
  if (prefer === "CPU") { stats[key] = "CPU"; return make("CPU"); }
  try {
    const m = await make("GPU");
    stats[key] = "GPU";
    return m;
  } catch {
    stats[key] = "CPU";
    return make("CPU");
  }
}

const makeDetector = (delegate) => ObjectDetector.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: detOpts.model, delegate },
  canvas: new OffscreenCanvas(1, 1),
  runningMode: "VIDEO",
  scoreThreshold: 0.2,
  maxResults: 3,
  categoryAllowlist: ["sports ball"],
});

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      const fs = (fileset = await FilesetResolver.forVisionTasks(msg.wasm));
      // création l'une après l'autre : deux contextes GPU créés en même temps peuvent se bloquer
      if (msg.ball) {
        detOpts = { model: msg.ballModel };
        // iPhone / iPad : le détecteur sur GPU dans un worker ne renvoie aucun ballon ; le CPU, si.
        det = await create(makeDetector, msg.ballDelegate, "detDelegate");
      }
      if (msg.pose) {
        pose = await create((delegate) => PoseLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: msg.poseModel, delegate },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          // à plusieurs : un squelette par joueur dans le cadre
          numPoses: msg.numPoses || 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }), "GPU", "poseDelegate");
      }
      self.postMessage({ type: "ready", stats });
      return;
    }
    if (msg.type === "detectorCPU") {
      // aucun ballon trouvé sur GPU alors que le corps est suivi : on bascule le détecteur sur CPU
      if (det && stats.detDelegate !== "CPU") { det.close(); det = await makeDetector("CPU"); stats.detDelegate = "CPU"; }
      return;
    }
    if (msg.type === "frame") {
      const { bmp, ts, id } = msg;
      const w = bmp.width, h = bmp.height;
      let balls = [];
      if (det) {
        balls = det.detectForVideo(bmp, ts).detections.map((d) => {
          const b = d.boundingBox;
          return { x: (b.originX + b.width / 2) / w, y: (b.originY + b.height / 2) / h, r: Math.max(b.width, b.height) / 2 / w, score: d.categories[0]?.score ?? 0 };
        }).sort((a, b) => b.score - a.score);
        stats.frames++;
        stats.detections += balls.length ? 1 : 0;
      }
      const all = pose ? pose.detectForVideo(bmp, ts).landmarks : undefined;
      const landmarks = all ? all[0] ?? null : undefined;
      bmp.close();
      self.postMessage({ type: "frame", id, ts, balls, landmarks, people: all && all.length > 1 ? all : undefined, stats });
    }
  } catch (err) {
    if (msg.bmp) msg.bmp.close();
    self.postMessage({ type: "error", id: msg.id, message: String(err) });
  }
};

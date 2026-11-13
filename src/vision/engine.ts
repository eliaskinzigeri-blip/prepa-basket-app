// Moteur de vision à faible latence.
// - Les modèles MediaPipe (ballon, corps) tournent dans un worker : le fil d'affichage n'est jamais bloqué.
//   Une image n'est envoyée que si le worker est libre : pas de file d'attente, donc pas de retard qui s'accumule.
// - Entre deux détections, le ballon est suivi à chaque image dans une petite zone autour de sa position prédite.
//   Un candidat doit avoir la couleur calibrée ; il est ensuite noté sur sa rondeur, ses lignes, son mouvement,
//   sa taille par rapport au joueur, et il perd des points s'il est sur le visage ou un membre (même teinte que le ballon).
// - Chaque détection, arrivée avec un temps de retard, est comparée à la trajectoire suivie au même instant :
//   elle confirme le suivi, ou le recale s'il s'est égaré.
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { DETECTOR, POSE, WASM, type Ball } from "./models";
import { MotionBall } from "./motionBall";

export interface TrackedBall extends Ball {
  /** Position extrapolée (ballon caché un court instant) : à afficher, mais pas à mesurer. */
  predicted?: boolean;
}

export type TeachResult = "ok" | "dark" | "fail";

export interface Vision {
  /** À appeler à chaque image de la caméra. */
  frame(video: HTMLVideoElement, ts: number): { ball: TrackedBall | null; pose: NormalizedLandmark[] | null };
  close(): void;
  /** Diagnostic : moteur du détecteur, images analysées, images avec un ballon trouvé. */
  stats(): { detDelegate: string | null; frames: number; detections: number };
  /** Le joueur touche son ballon à l'écran (coordonnées vidéo 0–1) : on apprend sa couleur. « dark » : apprise, mais trop sombre ou terne pour le distinguer de la pièce. */
  teach(video: HTMLVideoElement, x: number, y: number): TeachResult;
  /** Suivi par le mouvement : cercle du panier (x, y en part de l'image, r en part de la largeur). Donne la taille du ballon et la place du filet. */
  setRim(x: number, y: number, r: number): void;
  /** Part du filet qui bouge à la dernière image. */
  netMotion(): number;
  /** Tous les squelettes de la dernière analyse (session à plusieurs). */
  people(): NormalizedLandmark[][];
  /** Tous les objets ronds en mouvement à la dernière image, avec l'id de leur piste (plusieurs ballons), en part de l'image. */
  balls(): { id: number; x: number; y: number; r: number }[];
}

const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Un seul worker gardé entre deux parties : sur iPhone, recréer les modèles (WASM + GPU) à chaque partie
// peut bloquer le chargement de la 2e partie. Il est fermé après 2 min sans servir.
let shared: { key: string; worker: Worker; ready: Promise<void>; kill: number } | null = null;

function getWorker(opts: { ball: boolean; pose: boolean; people?: number }): { worker: Worker; ready: Promise<void> } {
  const key = `${opts.ball}-${opts.pose}-${opts.people ?? 1}`;
  if (shared && shared.key === key) { clearTimeout(shared.kill); return shared; }
  if (shared) { shared.worker.terminate(); shared = null; }
  const worker = new Worker("/vision-worker.js");
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Le suivi caméra met trop de temps à démarrer. Ferme l'app et rouvre-la.")), 45000);
    worker.onmessage = (e) => { clearTimeout(timer); if (e.data.type === "ready") resolve(); else reject(new Error(e.data.message)); };
    worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || "Le suivi caméra n'a pas pu démarrer.")); };
    worker.postMessage({ type: "init", wasm: WASM, ball: opts.ball, pose: opts.pose, ballModel: DETECTOR, poseModel: POSE, numPoses: opts.people ?? 1, ballDelegate: IOS ? "CPU" : "GPU" });
  });
  shared = { key, worker, ready, kill: 0 };
  return shared;
}

/** motion : le ballon est suivi par son mouvement, sans modèle ni couleur (téléphone posé, ballon lancé). */
/** people : nombre de joueurs suivis en même temps (session à plusieurs), 1 par défaut. */
export async function startVision(opts: { ball: boolean; pose: boolean; motion?: boolean; people?: number }): Promise<Vision> {
  const { worker, ready } = getWorker(opts);
  try {
    await ready;
  } catch (e) {
    worker.terminate();
    if (shared?.worker === worker) shared = null;
    throw e;
  }
  let closed = false;

  const tracker = opts.ball ? new BallTracker() : null;
  const motion = opts.motion ? new MotionBall() : null;
  let pose: NormalizedLandmark[] | null = null;
  let people: NormalizedLandmark[][] = [];
  let motionSize = { w: 1, h: 1 };
  let busy = false;
  let id = 0;
  // image envoyée au worker, gardée en petit pour apprendre la couleur du ballon détecté
  const sent = new Map<number, ImageData>();
  let stats = { detDelegate: null as string | null, frames: 0, detections: 0 };
  let switched = false;

  worker.onmessage = (e) => {
    if (closed) return;
    const m = e.data;
    if (m.type !== "frame" && m.type !== "error") return;
    busy = false;
    const small = sent.get(m.id);
    sent.delete(m.id);
    if (m.type === "error") return;
    if (m.landmarks !== undefined) { pose = m.landmarks; people = m.people ?? (m.landmarks ? [m.landmarks] : []); }
    if (m.stats) stats = m.stats;
    // filet de sécurité : 150 images sans aucun ballon alors que le corps est suivi → détecteur sur CPU
    if (!switched && stats.detDelegate === "GPU" && stats.frames > 150 && stats.detections === 0 && pose) { switched = true; worker.postMessage({ type: "detectorCPU" }); }
    if (tracker) tracker.onDetection(m.ts, m.balls as Ball[], small ?? null);
  };

  const grabCanvas = document.createElement("canvas");
  return {
    frame(video, ts) {
      if (closed) return { ball: null, pose: null };
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        const frameId = ++id;
        // petite image gardée : elle vérifie que ce que le modèle a vu a bien la couleur du ballon
        if (tracker) sent.set(frameId, grab(grabCanvas, video, 0, 0, video.videoWidth, video.videoHeight, SMALL));
        createImageBitmap(video)
          .then((bmp) => worker.postMessage({ type: "frame", id: frameId, ts, bmp }, [bmp]))
          .catch(() => { busy = false; sent.delete(frameId); });
      }
      if (motion && video.readyState >= 2 && video.videoWidth) {
        const img = grab(grabCanvas, video, 0, 0, video.videoWidth, video.videoHeight, MOTION_W);
        const hit = motion.push(img, ts);
        motionSize = { w: img.width, h: img.height };
        return { ball: hit ? { x: hit.x / img.width, y: hit.y / img.height, r: hit.r / img.width, score: 0.6 } : null, pose };
      }
      return { ball: tracker ? tracker.update(video, ts, pose) : null, pose };
    },
    stats: () => stats,
    teach: (video, x, y) => tracker?.teach(video, x, y) ?? "fail",
    // la borne basse reste petite : le cercle réglé à la main est souvent trop grand
    setRim(x, y, r) { motion?.setRim(x, y, r); },
    netMotion: () => motion?.net ?? 0,
    people: () => people,
    balls: () => (motion ? motion.live.map((k) => ({ id: k.id, x: k.x / motionSize.w, y: k.y / motionSize.h, r: k.r / motionSize.w })) : []),
    close() {
      closed = true;
      sent.clear();
      worker.onmessage = null;
      if (shared?.worker === worker) shared.kill = window.setTimeout(() => { worker.terminate(); if (shared?.worker === worker) shared = null; }, 120000);
      else worker.terminate();
    },
  };
}

// ——— Suivi du ballon ———

interface Hue { center: number; width: number; minSat: number; taught?: boolean }
/** Disque contenu dans une tache de la couleur du ballon. round : part de l'anneau autour du disque qui n'a pas cette couleur (1 = disque isolé). */
interface Blob { x: number; y: number; r: number; round: number; lines: number }
type Pose = NormalizedLandmark[] | null;

const MOTION_W = 320; // largeur de l'image analysée pour le suivi par le mouvement
const SMALL = 128; // largeur de l'image entière analysée
const ROI = 96; // côté de la zone de recherche analysée
const MIN_TRACK = 0.12; // note minimale pour continuer à suivre
const MIN_ACQUIRE = 0.4; // note minimale pour accrocher un ballon perdu
const MIN_RIVAL = 0.5; // note minimale pour abandonner le suivi au profit d'un meilleur candidat

// Couleur du ballon gardée d'une partie à l'autre. « 2 » : les anciennes valeurs pouvaient venir d'une fausse détection.
const HUE_KEY = "pb.ballHue2";
function loadHue(): Hue | null {
  try { const h = JSON.parse(localStorage.getItem(HUE_KEY) ?? "null"); return h && typeof h.center === "number" ? h : null; } catch { return null; }
}
function saveHue(h: Hue) {
  try { localStorage.setItem(HUE_KEY, JSON.stringify(h)); } catch { /* stockage bloqué */ }
}

// Ce qui a bougé récemment, sur la petite image : le ballon bouge presque tout le temps, le décor non.
class MotionMap {
  private prev: Uint8Array | null = null;
  private map = new Uint8Array(0);
  private W = 1;
  private moved = 0;

  push(img: ImageData) {
    const { width: W, data: d } = img;
    const N = W * img.height;
    const fresh = !this.prev || this.prev.length !== N;
    if (fresh) { this.prev = new Uint8Array(N); this.map = new Uint8Array(N); this.W = W; }
    const prev = this.prev!, map = this.map;
    let moved = 0;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      map[p] = !fresh && Math.abs(l - prev[p]) > 16 ? 255 : (map[p] * 218) >> 8; // s'efface en 0,4 s environ
      prev[p] = l;
      if (map[p] > 128) moved++;
    }
    this.moved = moved / N;
  }

  /** 0,35 (immobile) à 1 (en mouvement). Si presque toute l'image bouge, c'est la caméra : l'indice ne vaut rien. */
  factor(x: number, y: number, r: number) {
    if (!this.prev || this.moved > 0.5) return 1;
    const W = this.W, H = this.map.length / W;
    const R = Math.max(1, r);
    let sum = 0, n = 0;
    for (let v = Math.max(0, Math.floor(y - R)); v <= Math.min(H - 1, y + R); v++) {
      for (let u = Math.max(0, Math.floor(x - R)); u <= Math.min(W - 1, x + R); u++) { sum += this.map[v * W + u]; n++; }
    }
    return 0.35 + 0.65 * Math.min(1, (n ? sum / n / 255 : 0) / 0.3);
  }
}

/** Lignes d'une autre couleur à l'intérieur du disque. */
const hasLines = (b: Blob) => b.lines >= 0.03 && b.lines <= 0.3;

// Membres : souvent de la même teinte qu'un ballon orange (peau), et ils bougent aussi.
const LIMBS = [[11, 13], [12, 14], [13, 15], [14, 16], [23, 25], [24, 26], [25, 27], [26, 28]];

class BallTracker {
  private hue: Hue | null = loadHue();
  private anchor = this.hue?.taught ? this.hue.center : null; // couleur calibrée par le joueur : elle ne dérive pas
  private savedAt = 0;
  // état en pixels de la vidéo : position, vitesse (px/ms), rayon
  private x = 0; private y = 0; private vx = 0; private vy = 0; private r = 0;
  private seenAt = -Infinity; // dernière mesure
  private widen = false; // recherche élargie après un recalage
  private misses = 0;
  private conflicts = 0;
  private rival = 0; // images de suite où un autre candidat est nettement meilleur que l'objet suivi
  private quality = 0;
  private pending: { x: number; y: number; n: number } | null = null;
  private history: { t: number; x: number; y: number }[] = [];
  private canvas = document.createElement("canvas");
  private smallCanvas = document.createElement("canvas");
  private motion = new MotionMap();
  private pose: Pose = null;
  private count = 0;
  private W = 1; private H = 1;
  private now = 0;

  update(video: HTMLVideoElement, ts: number, pose: Pose = null): TrackedBall | null {
    this.W = video.videoWidth; this.H = video.videoHeight;
    this.now = ts;
    this.pose = pose;
    const age = ts - this.seenAt;
    const active = age < 350;
    if (!this.hue) return active && age < 150 ? this.out(ts, true) : null;

    // petite image : mouvement à chaque scan, et recherche dans toute l'image
    const n = ++this.count;
    const small = !active || n % 2 === 0 ? grab(this.smallCanvas, video, 0, 0, this.W, this.H, SMALL) : null;
    if (small) this.motion.push(small);

    let found: (Blob & { q: number }) | null = null;
    if (active) {
      // zone de recherche : autour de la position prédite, assez grande pour le déplacement possible
      const dt = Math.min(age, 120);
      const px = this.x + this.vx * dt, py = this.y + this.vy * dt;
      const speed = Math.hypot(this.vx, this.vy) * dt;
      const half = Math.min(Math.max(this.W, this.H) / 2, this.r * (this.widen ? 7 : 3.5) + speed * 0.6 + 12);
      const sx = Math.max(0, px - half), sy = Math.max(0, py - half);
      const sw = Math.min(this.W, px + half) - sx, sh = Math.min(this.H, py + half) - sy;
      if (sw > 4 && sh > 4) {
        const k = ROI / Math.max(sw, sh);
        const img = grab(this.canvas, video, sx, sy, sw, sh, Math.round(sw * k));
        // limite physique : le ballon ne se téléporte pas (sauf juste après un recalage, position approximative)
        const reach = this.widen ? Infinity : this.r * (1 + (dt / 33) * 0.9) + speed * 0.5;
        found = this.follow(blobs(img, this.hue).map((b) => ({ ...b, x: sx + b.x / k, y: sy + b.y / k, r: b.r / k })), px, py, reach);
      }
      // un autre candidat, nettement meilleur et plusieurs images de suite : on s'était accroché au mauvais objet
      if (small && n % 4 === 0) {
        // le meilleur candidat ailleurs que sur l'objet suivi
        const seen = this.rivalOf(small, found ?? { x: this.x, y: this.y, r: this.r });
        // sur la petite image les lignes ne se voient pas : on revoit le candidat à la même échelle que l'objet suivi
        const other = seen ? this.closer(video, seen) : null;
        const keepsLines = found && hasLines(found) && other && !hasLines(other);
        const margin = other && hasLines(other) && !(found && hasLines(found)) ? 0.9 : 1.25;
        if (other && !keepsLines && other.q >= MIN_RIVAL && other.q > (found ? found.q : this.quality) * margin) {
          // des lignes face à un objet qui n'en a pas : preuve forte, inutile d'attendre autant
          if (++this.rival >= (margin < 1 ? 3 : 4)) {
            found = other;
            this.vx = 0; this.vy = 0; this.r = other.r; this.seenAt = -Infinity;
            this.rival = 0;
          }
        } else this.rival = Math.max(0, this.rival - 1); // un raté n'efface pas tout : le ballon passe souvent devant la main ou le sol
      }
    } else if (small) {
      // ballon perdu : on cherche dans toute l'image, et il faut le revoir au même endroit avant d'y croire
      const c = this.bestAnywhere(small);
      if (c && c.q >= MIN_ACQUIRE) {
        const near = this.pending && Math.hypot(c.x - this.pending.x, c.y - this.pending.y) < c.r * 4;
        this.pending = { x: c.x, y: c.y, n: near ? this.pending!.n + 1 : 1 };
        if (this.pending.n >= 2) found = c;
      } else this.pending = null;
    }

    if (found) {
      const seen = ts - this.seenAt;
      if (seen < 200 && seen > 0) {
        // vitesse lissée, position brute : aucun retard ajouté à l'affichage
        this.vx = 0.5 * this.vx + 0.5 * (found.x - this.x) / seen;
        this.vy = 0.5 * this.vy + 0.5 * (found.y - this.y) / seen;
      } else { this.vx = 0; this.vy = 0; }
      this.x = found.x; this.y = found.y;
      if (!this.r || found.round >= 0.7) this.r = this.r ? 0.7 * this.r + 0.3 * found.r : found.r;
      this.quality = this.quality ? 0.8 * this.quality + 0.2 * found.q : found.q;
      this.seenAt = ts;
      this.widen = false;
      this.pending = null;
      this.history.push({ t: ts, x: this.x, y: this.y });
      while (this.history.length && this.history[0].t < ts - 1500) this.history.shift();
      return this.out(ts, false);
    }
    // caché un court instant (main, flou) : on prolonge la trajectoire
    return active && age < 130 ? this.out(ts, true) : null;
  }

  get knowsColor() { return this.hue !== null; }

  /** Note d'un candidat (coordonnées vidéo), de 0 (ce n'est pas le ballon) à environ 1,35. */
  private rate(b: Blob): number {
    const k = SMALL / this.W;
    const [lo, hi] = this.sizeRange();
    if (b.r < lo || b.r > hi) return 0;
    let q = b.round * b.round * this.motion.factor(b.x * k, b.y * k, b.r * k);
    if (hasLines(b)) q *= 1.35;
    return q * this.bodyFactor(b);
  }

  /** Taille possible : celle du ballon suivi, sinon d'après le joueur (ballon ≈ 24 cm, buste ≈ 50 cm), sinon large. */
  private sizeRange(): [number, number] {
    if (this.r > 0 && this.now - this.seenAt < 2000) return [this.r * 0.6, this.r * 1.5];
    const t = this.torso();
    if (t) return [t * 0.11, t * 0.45];
    return [this.W * 0.012, this.W * 0.2];
  }

  private torso() {
    const p = this.pose;
    if (!p || p.length < 25) return 0;
    const sx = (p[11].x + p[12].x) / 2, sy = (p[11].y + p[12].y) / 2, hx = (p[23].x + p[24].x) / 2, hy = (p[23].y + p[24].y) / 2;
    return Math.hypot((sx - hx) * this.W, (sy - hy) * this.H);
  }

  private bodyFactor(b: Blob) {
    const p = this.pose;
    const t = this.torso();
    if (!p || !t) return 1;
    const X = (i: number) => p[i].x * this.W, Y = (i: number) => p[i].y * this.H;
    if (Math.hypot(b.x - X(0), b.y - Y(0)) < t * 0.32) return 0.15; // visage
    for (const [a, c] of LIMBS) {
      const ax = X(a), ay = Y(a), dx = X(c) - ax, dy = Y(c) - ay;
      // la main et le pied (fin du segment) restent exclus : c'est là que passe le ballon
      const u = Math.min(0.75, Math.max(0, ((b.x - ax) * dx + (b.y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(b.x - ax - u * dx, b.y - ay - u * dy) < t * 0.1) return 0.5;
    }
    return 1;
  }

  /** En suivi : meilleure note, corrigée par la proximité de la position prédite et la taille. */
  private follow(list: Blob[], px: number, py: number, reach: number) {
    let best: (Blob & { q: number }) | null = null, bestScore = 0;
    for (const b of list) {
      const q = this.rate(b);
      if (q < MIN_TRACK || Math.hypot(b.x - px, b.y - py) > reach) continue;
      const jump = Math.hypot(b.x - px, b.y - py) / (this.r || 1);
      const size = this.r ? Math.min(b.r, this.r) / Math.max(b.r, this.r) : 1;
      const score = (q * (0.3 + 0.7 * size)) / (1 + (jump * jump) / 6);
      if (score > bestScore) { bestScore = score; best = { ...b, q }; }
    }
    return best;
  }

  private rivalOf(small: ImageData, cur: { x: number; y: number; r: number }) {
    const k = SMALL / this.W;
    let best: (Blob & { q: number }) | null = null;
    for (const raw of blobs(small, this.hue!)) {
      const b = { ...raw, x: raw.x / k, y: raw.y / k, r: raw.r / k };
      if (Math.hypot(b.x - cur.x, b.y - cur.y) <= Math.max(b.r, cur.r) * 2.5) continue;
      const q = this.rate(b);
      if (q > (best?.q ?? 0)) best = { ...b, q };
    }
    return best;
  }

  private bestAnywhere(small: ImageData) {
    const k = SMALL / this.W;
    let best: (Blob & { q: number }) | null = null, top = 0;
    const recent = this.r > 0 && this.now - this.seenAt < 800;
    for (const raw of blobs(small, this.hue!)) {
      const b = { ...raw, x: raw.x / k, y: raw.y / k, r: raw.r / k };
      const q = this.rate(b);
      if (q < MIN_TRACK) continue;
      // perte courte : le ballon ne peut pas être loin de sa dernière position
      const d = Math.hypot(b.x - this.x, b.y - this.y) / this.r;
      if (recent && d > 6) continue;
      const score = recent ? q / (1 + (d / 6) ** 2) : q;
      if (score > top) { top = score; best = { ...b, q }; }
    }
    return best;
  }

  /** Revoit un candidat de près (lignes visibles), avec la même résolution relative que le suivi. */
  private closer(video: HTMLVideoElement, c: Blob & { q: number }) {
    const half = c.r * 3.5 + 12;
    const sx = Math.max(0, c.x - half), sy = Math.max(0, c.y - half);
    const sw = Math.min(this.W, c.x + half) - sx, sh = Math.min(this.H, c.y + half) - sy;
    if (sw <= 4 || sh <= 4) return c;
    const k = ROI / Math.max(sw, sh);
    const img = grab(this.canvas, video, sx, sy, sw, sh, Math.round(sw * k));
    let best: (Blob & { q: number }) | null = null;
    for (const raw of blobs(img, this.hue!)) {
      const b = { ...raw, x: sx + raw.x / k, y: sy + raw.y / k, r: raw.r / k };
      if (Math.hypot(b.x - c.x, b.y - c.y) > c.r * 1.5) continue;
      const q = this.rate(b);
      if (q > (best?.q ?? 0)) best = { ...b, q };
    }
    return best;
  }

  teach(video: HTMLVideoElement, nx: number, ny: number): TeachResult {
    this.W = video.videoWidth; this.H = video.videoHeight;
    // image recadrée autour du doigt : un ballon loin y occupe assez de pixels
    const half = this.W * 0.16;
    const px = nx * this.W, py = ny * this.H;
    const sx = Math.max(0, px - half), sy = Math.max(0, py - half);
    const sw = Math.min(this.W, px + half) - sx, sh = Math.min(this.H, py + half) - sy;
    const k = ROI / Math.max(sw, sh);
    const img = grab(this.canvas, video, sx, sy, sw, sh, Math.round(sw * k));
    const tx = (px - sx) * k, ty = (py - sy) * k;
    // rayon supposé : ballon à 2-3 m ou tenu près de la caméra, on essaie du plus petit au plus grand
    for (const r of [0.012, 0.025, 0.05, 0.09]) {
      const learned = learnHue(img, tx / img.width, ty / img.height, (r * this.W * k) / img.width);
      if (!learned) continue;
      const hue: Hue = { ...learned, taught: true };
      this.hue = hue;
      this.anchor = hue.center;
      saveHue(hue);
      // la tache touchée par le joueur, quelle que soit sa note
      let found: Blob | null = null, bestD = Infinity;
      for (const c of blobs(img, hue)) {
        const d = Math.hypot(c.x - tx, c.y - ty) - c.r;
        if (d < bestD) { bestD = d; found = c; }
      }
      this.x = found ? sx + found.x / k : px; this.y = found ? sy + found.y / k : py;
      this.r = found ? found.r / k : r * this.W;
      this.vx = 0; this.vy = 0; this.seenAt = this.now; this.widen = true;
      this.quality = 0; this.rival = 0; this.pending = null;
      return looksDark(img, tx, ty, r * this.W * k) ? "dark" : "ok";
    }
    return "fail";
  }

  onDetection(ts: number, balls: Ball[], small: ImageData | null) {
    if (!balls.length) return;
    const past = this.history.length ? this.history.reduce((a, b) => (Math.abs(b.t - ts) < Math.abs(a.t - ts) ? b : a)) : null;
    const usable = past && Math.abs(past.t - ts) < 80 ? past : null;
    // plusieurs ballons possibles : on garde celui qui prolonge le suivi, sinon le plus sûr
    const toPx = (b: Ball) => ({ x: b.x * this.W, y: b.y * this.H, r: b.r * this.W, score: b.score });
    const cands = balls.map(toPx);
    const det = usable ? cands.reduce((a, b) => (Math.hypot(b.x - usable.x, b.y - usable.y) < Math.hypot(a.x - usable.x, a.y - usable.y) ? b : a)) : cands[0];
    const agrees = Boolean(usable && Math.hypot(det.x - usable.x, det.y - usable.y) < Math.max(det.r, this.r) * 2.5);

    const learned = small && learnHue(small, det.x / this.W, det.y / this.H, det.r / this.W);
    if (learned) this.adjustHue(learned, det.score, agrees, ts);
    if (agrees) { this.misses = 0; this.r = 0.5 * this.r + 0.5 * det.r; return; }

    // le modèle se trompe parfois (seuil bas) : sans la couleur du ballon, ce n'est pas lui
    if (this.hue && (!small || hueShare(small, det.x / this.W, det.y / this.H, det.r / this.W, this.hue) < 0.25)) return;
    if (this.bodyFactor({ x: det.x, y: det.y, r: det.r, round: 1, lines: 0 }) < 0.3) return;
    // suivi en bon état : seule une détection sûre d'elle et meilleure que lui peut le déplacer
    const healthy = this.now - this.seenAt < 200 && this.quality >= 0.6;
    const k = SMALL / this.W;
    const moving = this.motion.factor(det.x * k, det.y * k, det.r * k);
    if (healthy && (det.score < 0.6 || moving < 0.6)) return;
    this.misses++;
    // suivi perdu, ou en désaccord deux fois de suite : on recale sur le modèle
    if (!usable || this.now - this.seenAt > 200 || this.misses >= 2) {
      this.x = det.x; this.y = det.y; this.vx = 0; this.vy = 0; this.r = det.r;
      this.seenAt = this.now - Math.min(100, Math.max(0, this.now - ts)); // la détection date un peu
      this.widen = true;
      this.misses = 0;
      this.history = [{ t: ts, x: det.x, y: det.y }];
    }
  }

  /** Suit les changements de lumière, sans jamais laisser une fausse détection changer la couleur du ballon. */
  private adjustHue(learned: Hue, score: number, agrees: boolean, ts: number) {
    if (!this.hue) { if (score >= 0.3) { this.hue = learned; saveHue(learned); } return; }
    const close = Math.abs(angle(learned.center - this.hue.center)) < 25;
    if (close && (agrees || score >= 0.5)) {
      if (this.anchor != null && Math.abs(angle(learned.center - this.anchor)) > 15) return;
      this.conflicts = 0;
      this.hue = { ...blend(this.hue, learned), taught: this.hue.taught };
      if (ts - this.savedAt > 5000) { this.savedAt = ts; saveHue(this.hue); }
    } else if (!close && !this.hue.taught && score >= 0.6 && ++this.conflicts >= 3) {
      // couleur apprise toute seule, et le modèle voit un ballon d'une autre couleur avec assurance : autre ballon
      this.conflicts = 0;
      this.hue = learned;
      saveHue(learned);
    }
  }

  private out(ts: number, predicted: boolean): TrackedBall {
    const dt = predicted ? Math.min(ts - this.seenAt, 130) : 0;
    return { x: (this.x + this.vx * dt) / this.W, y: (this.y + this.vy * dt) / this.H, r: this.r / this.W, score: predicted ? 0.2 : 0.6, predicted };
  }
}

function grab(c: HTMLCanvasElement, video: HTMLVideoElement, sx: number, sy: number, sw: number, sh: number, outW: number): ImageData {
  const W = Math.max(8, outW), H = Math.max(8, Math.round((outW * sh) / sw));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

const angle = (a: number) => ((a + 540) % 360) - 180;

/** Teinte, saturation, valeur (0–360, 0–1, 0–1). */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max / 255];
}

/** Couleur du ballon vu par le modèle : moyenne circulaire des teintes saturées au centre de sa boîte. */
function learnHue(img: ImageData, bx: number, by: number, br: number): Hue | null {
  const { width: W, height: H, data: d } = img;
  const cx = bx * W, cy = by * H, r = Math.max(1.5, br * W * 0.65);
  let sx = 0, sy = 0, n = 0;
  const samples: { s: number; v: number }[] = [];
  const hues: number[] = [];
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(H, cy + r); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * W + x) * 4;
      const [h, s, v] = hsv(d[i], d[i + 1], d[i + 2]);
      if (s < 0.25 || v < 0.15) continue;
      sx += Math.cos((h * Math.PI) / 180); sy += Math.sin((h * Math.PI) / 180); n++;
      samples.push({ s, v }); hues.push(h);
    }
  }
  if (n < 6) return null; // ballon blanc, gris ou trop sombre : la couleur ne sert à rien
  const R = Math.hypot(sx, sy) / n; // 1 = teinte très homogène
  if (R < 0.75) return null;
  const center = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const spread = Math.sqrt(hues.reduce((a, h) => a + angle(h - center) ** 2, 0) / n);
  // les pixels sombres sont des lignes ou de l'ombre, mélangés au fond : ils ne disent rien de la saturation du ballon
  const top = samples.reduce((a, b) => Math.max(a, b.v), 0);
  const sats = samples.filter((x) => x.v >= top * 0.55).map((x) => x.s).sort((a, b) => a - b);
  return { center, width: Math.min(24, Math.max(10, spread * 2.2)), minSat: Math.max(0.22, sats[sats.length >> 1] * 0.82) }; // assez strict pour écarter la peau et le parquet, moins saturés qu'un ballon
}

/** Ballon sombre ou terne à l'image : sa couleur se confond avec une pièce mal éclairée. */
function looksDark(img: ImageData, cx: number, cy: number, r: number) {
  const { width: W, height: H, data: d } = img;
  const sats: number[] = [], vals: number[] = [];
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, cy + r); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * W + x) * 4;
      const [, s, v] = hsv(d[i], d[i + 1], d[i + 2]);
      sats.push(s); vals.push(v);
    }
  }
  if (!vals.length) return false;
  sats.sort((a, b) => a - b); vals.sort((a, b) => a - b);
  return sats[sats.length >> 1] < 0.45 || vals[vals.length >> 1] < 0.35;
}

function blend(a: Hue, b: Hue): Hue {
  return { center: (a.center + 0.3 * angle(b.center - a.center) + 360) % 360, width: 0.7 * a.width + 0.3 * b.width, minSat: 0.7 * a.minSat + 0.3 * b.minSat };
}

/** Part des pixels d'un disque (coordonnées 0–1) qui ont la couleur du ballon. */
function hueShare(img: ImageData, bx: number, by: number, br: number, hue: Hue) {
  const { width: W, height: H, data: d } = img;
  const cx = bx * W, cy = by * H, r = Math.max(1.5, br * W * 0.8);
  let hit = 0, n = 0;
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(H, cy + r); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * W + x) * 4;
      const [h, s, v] = hsv(d[i], d[i + 1], d[i + 2]);
      n++;
      if (v > 0.18 && s >= hue.minSat && Math.abs(angle(h - hue.center)) <= hue.width) hit++;
    }
  }
  return n ? hit / n : 0;
}

/**
 * Taches de la couleur du ballon. Le masque est fermé pour refermer les lignes du ballon. Chaque tache est résumée par
 * le plus grand disque qu'elle contient (carte de distance) : un bras collé au ballon ne décale ni son centre ni son rayon.
 */
function blobs(img: ImageData, hue: Hue): Blob[] {
  const { width: W, height: H, data: d } = img;
  const N = W * H;
  const raw = new Uint8Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (max < 46) continue;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    const delta = max - min;
    if (delta < max * hue.minSat) continue;
    const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    if (Math.abs(angle(h * 60 - hue.center)) <= hue.width) raw[p] = 1;
  }
  const mask = morph(morph(raw, W, H, true), W, H, false);

  // distance de chaque pixel au bord de sa tache (3 = un pixel)
  const dist = new Uint16Array(N);
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      if (!mask[p]) continue;
      if (x === 0 || y === 0) { dist[p] = 3; continue; }
      dist[p] = Math.min(dist[p - 1] + 3, dist[p - W] + 3, dist[p - W - 1] + 4, x < W - 1 ? dist[p - W + 1] + 4 : 3);
    }
  }
  for (let y = H - 1, p = N - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--, p--) {
      if (!mask[p]) continue;
      if (x === W - 1 || y === H - 1) { dist[p] = 3; continue; }
      dist[p] = Math.min(dist[p], dist[p + 1] + 3, dist[p + W] + 3, dist[p + W + 1] + 4, x > 0 ? dist[p + W - 1] + 4 : 3);
    }
  }

  const label = new Uint8Array(N);
  const stack: number[] = [];
  const out: Blob[] = [];
  for (let start = 0; start < N; start++) {
    if (!mask[start] || label[start]) continue;
    const pixels: number[] = [];
    let peak = 0;
    stack.push(start);
    label[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      pixels.push(p);
      if (dist[p] > peak) peak = dist[p];
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - W] && !label[p - W]) { label[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && mask[p + W] && !label[p + W]) { label[p + W] = 1; stack.push(p + W); }
    }
    if (pixels.length < 8) continue;
    // une tache peut souder le ballon au sol ou à une main : on garde ses disques principaux, pas seulement le plus grand
    const chosen: { x: number; y: number; d: number }[] = [];
    for (let k = 0; k < 3; k++) {
      let top = 0, at = -1;
      for (const p of pixels) {
        if (dist[p] <= top) continue;
        const x = p % W, y = (p / W) | 0;
        if (chosen.some((c) => Math.hypot(c.x - x, c.y - y) < (c.d / 3) * 1.2)) continue;
        top = dist[p]; at = p;
      }
      if (at < 0 || top < peak * 0.5) break;
      // centre : moyenne des points les plus profonds autour du sommet, plus stable d'une image à l'autre
      const ax = at % W, ay = (at / W) | 0, near = (top / 3) * 0.4 + 1;
      let cx = 0, cy = 0, m = 0;
      for (const p of pixels) {
        const x = p % W, y = (p / W) | 0;
        if (dist[p] >= top * 0.85 && Math.abs(x - ax) <= near && Math.abs(y - ay) <= near) { cx += x; cy += y; m++; }
      }
      chosen.push({ x: cx / m, y: cy / m, d: top });
    }
    for (const c of chosen) {
      const r = c.d / 3 + 0.5;
      if (r < 2) continue;
      const round = ringFree(mask, W, H, c.x, c.y, r);
      if (round < 0.3) continue; // mur, parquet : la couleur continue tout autour du disque
      out.push({ x: c.x, y: c.y, r, round, lines: lineShare(img, raw, c.x, c.y, r) });
    }
  }
  return out;
}

/** Part de l'anneau juste autour du disque qui n'a pas la couleur du ballon (les pixels hors image ne comptent pas). */
function ringFree(mask: Uint8Array, W: number, H: number, cx: number, cy: number, r: number) {
  let free = 0, n = 0;
  for (const k of [1.25, 1.5]) {
    for (let a = 0; a < 24; a++) {
      const x = Math.round(cx + Math.cos((a * Math.PI) / 12) * r * k), y = Math.round(cy + Math.sin((a * Math.PI) / 12) * r * k);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      n++;
      if (!mask[y * W + x]) free++;
    }
  }
  return n ? free / n : 1;
}

/** Part du disque occupée par des traits nettement plus sombres que la couleur du ballon. */
function lineShare(img: ImageData, raw: Uint8Array, cx: number, cy: number, r: number) {
  const { width: W, height: H, data: d } = img;
  const R = r * 0.85;
  const dark: number[] = [];
  let sum = 0, n = 0, total = 0;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, cy + R); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, cx + R); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      const p = y * W + x, i = p * 4;
      const v = Math.max(d[i], d[i + 1], d[i + 2]);
      total++;
      if (raw[p]) { sum += v; n++; } else dark.push(v);
    }
  }
  if (!n) return 0;
  const limit = (sum / n) * 0.6;
  let lines = 0;
  for (const v of dark) if (v < limit) lines++;
  return lines / total;
}

/** Érosion (dilate = false) ou dilatation 3 × 3, séparable. */
function morph(m: Uint8Array, W: number, H: number, dilate: boolean): Uint8Array {
  const t = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      const a = x > 0 ? m[p - 1] : 0, b = m[p], c = x < W - 1 ? m[p + 1] : 0;
      t[p] = dilate ? a | b | c : a & b & c;
    }
  }
  for (let p = 0; p < m.length; p++) {
    const a = p >= W ? t[p - W] : 0, b = t[p], c = p + W < m.length ? t[p + W] : 0;
    out[p] = dilate ? a | b | c : a & b & c;
  }
  return out;
}

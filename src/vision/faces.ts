// Reconnaissance des visages pour le shoot à plusieurs, entièrement sur le téléphone :
// ni photo ni signature de visage n'est envoyée sur un serveur.
// Bibliothèque chargée seulement en session à plusieurs (elle pèse plusieurs Mo).
type FaceApi = typeof import("@vladmandic/face-api");

const MODELS = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";
let api: Promise<FaceApi> | null = null;

export function loadFaces(): Promise<FaceApi> {
  api ??= (async () => {
    const f = await import("@vladmandic/face-api");
    await (f.tf as unknown as { ready: () => Promise<void> }).ready();
    await Promise.all([
      f.nets.tinyFaceDetector.loadFromUri(MODELS),
      f.nets.faceLandmark68TinyNet.loadFromUri(MODELS),
      f.nets.faceRecognitionNet.loadFromUri(MODELS),
    ]);
    return f;
  })();
  api.catch(() => { api = null; });
  return api;
}

export interface FaceShot {
  descriptor: number[];
  /** Photo du visage (JPEG, 160 px), gardée sur le téléphone. */
  photo: string;
  /** Plus c'est grand, plus la photo est nette, grande et de face. */
  quality: number;
}

/**
 * Cherche un visage dans une image découpée autour de la tête.
 * Renvoie sa signature (128 nombres) et une photo nette, ou null si aucun visage net n'est trouvé.
 */
export async function describeFace(crop: HTMLCanvasElement): Promise<FaceShot | null> {
  const f = await loadFaces();
  const hit = await f.detectSingleFace(crop, new f.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })).withFaceLandmarks(true).withFaceDescriptor();
  if (!hit) return null;
  const b = hit.detection.box;
  if (b.width < 36) return null; // trop petit pour être reconnu ensuite
  const sharp = sharpness(crop, b);
  if (sharp < 6) return null; // flou de bougé
  // de face : le nez est à mi-chemin entre les deux yeux
  const pts = hit.landmarks.positions;
  const eyeL = pts[36], eyeR = pts[45], nose = pts[30];
  const frontal = 1 - Math.min(1, Math.abs((nose.x - eyeL.x) - (eyeR.x - nose.x)) / Math.max(1, eyeR.x - eyeL.x));
  const out = document.createElement("canvas");
  out.width = out.height = 160;
  const pad = b.width * 0.35;
  out.getContext("2d")!.drawImage(crop, b.x - pad, b.y - pad * 1.3, b.width + 2 * pad, b.height + 2 * pad, 0, 0, 160, 160);
  return {
    descriptor: Array.from(hit.descriptor, (v) => Math.round(v * 1e4) / 1e4),
    photo: out.toDataURL("image/jpeg", 0.82),
    quality: hit.detection.score * Math.min(1, b.width / 120) * Math.min(1, sharp / 25) * (0.4 + 0.6 * frontal),
  };
}

/** Netteté : variance du laplacien sur le visage, en niveaux de gris réduits à 64 px. */
function sharpness(c: HTMLCanvasElement, b: { x: number; y: number; width: number; height: number }): number {
  const n = 64;
  const t = document.createElement("canvas");
  t.width = t.height = n;
  const ctx = t.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, b.x, b.y, b.width, b.height, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let s = 0, s2 = 0, k = 0;
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = y * n + x;
    const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - n] - g[i + n];
    s += l; s2 += l * l; k++;
  }
  return Math.sqrt(s2 / k - (s / k) ** 2);
}

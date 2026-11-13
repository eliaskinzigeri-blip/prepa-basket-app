// Caméra, sons, voix et vidéos locales (IndexedDB : les vidéos restent sur le téléphone).

export async function startCamera(video: HTMLVideoElement, facing: "user" | "environment"): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("La caméra n'est pas disponible sur cet appareil ou ce navigateur.");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, min: 30 } },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "Accès à la caméra refusé. Autorise la caméra dans les réglages du navigateur.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Aucune caméra compatible trouvée.";
  return (e as Error)?.message || "Impossible de démarrer la caméra.";
}

let ctx: AudioContext | null = null;
export function beep(freq = 880, ms = 120, vol = 0.25) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = "sine";
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + ms / 1000);
  } catch { /* son indisponible */ }
}
export const hitSound = () => { beep(988, 90); setTimeout(() => beep(1318, 120), 80); };
export const missSound = () => beep(220, 180, 0.2);

export function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* voix indisponible */ }
}

/** Compte à rebours vocal ; renvoie l'instant précis du « go ». */
export async function countdown(onTick: (n: number | null) => void, words = ["3", "2", "1"], go = "Partez !"): Promise<number> {
  for (const w of words) {
    onTick(Number(w) || null);
    speak(w);
    beep(660, 120);
    await new Promise((r) => setTimeout(r, 1000));
  }
  onTick(0);
  speak(go);
  beep(1320, 250, 0.35);
  return performance.now();
}

// ——— Enregistrement local des essais et des sessions de shoot ———
export function recorder(stream: MediaStream) {
  const mime = ["video/webm;codecs=vp9", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const out = {
    startedAt: performance.now(),
    stop: () => new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
      if (rec.state !== "inactive") rec.stop();
      else resolve(new Blob(chunks));
    }),
  };
  // la vidéo ne commence qu'ici, parfois bien après l'appel à start : le replay se cale sur cet instant
  rec.onstart = () => { out.startedAt = performance.now(); };
  rec.start(1000);
  return out;
}

const DB = "pb-videos";
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("v");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveVideo(key: string, blob: Blob) {
  try {
    const d = await db();
    await new Promise((res, rej) => { const tx = d.transaction("v", "readwrite"); tx.objectStore("v").put(blob, key); tx.oncomplete = res; tx.onerror = rej; });
  } catch { /* stockage indisponible : pas de replay */ }
}
export async function loadVideo(key: string): Promise<Blob | null> {
  try {
    const d = await db();
    return await new Promise((res) => { const r = d.transaction("v").objectStore("v").get(key); r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); });
  } catch { return null; }
}
export async function clearVideos() {
  try { indexedDB.deleteDatabase(DB); } catch { /* rien */ }
}

/** Boucle image par image (requestVideoFrameCallback si dispo, pour coller aux 30–60 i/s de la caméra). */
export function frameLoop(video: HTMLVideoElement, fn: (now: number) => void): () => void {
  let stop = false;
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number) => void) => number };
  if (v.requestVideoFrameCallback) {
    const tick = (now: number) => { if (stop) return; fn(now); v.requestVideoFrameCallback!(tick); };
    v.requestVideoFrameCallback(tick);
  } else {
    const tick = (now: number) => { if (stop) return; fn(now); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  return () => { stop = true; };
}

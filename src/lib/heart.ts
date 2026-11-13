// Ceinture cardio Bluetooth (service standard Heart Rate 0x180D : Polar, Garmin, Coospo, Decathlon…).
// Une seule connexion pour toute l'app : la fréquence cardiaque est gardée seconde par seconde tant que la page
// est ouverte, et chaque séance enregistrée reçoit son résumé (moyenne, maximum, temps dans chaque zone).
// Sur iPhone, Web Bluetooth vient de l'extension Safari beacio, comme pour le rameur et la balance.

const HR_SERVICE = 0x180d;
const HR_MEASUREMENT = 0x2a37;
const KEY = "pb.hr.v1";
const KEEP_MS = 4 * 3600e3; // 4 h de mesures en mémoire
const KEEP_RR_MS = 15 * 60e3;

export type HeartState = "disconnected" | "searching" | "connected";
export interface HeartSample { t: number; bpm: number }

/** Trame Heart Rate Measurement : FC (8 ou 16 bits), énergie dépensée éventuelle, intervalles RR (1/1024 s). */
export function parseHeart(dv: DataView): { bpm: number; rr: number[] } {
  const flags = dv.getUint8(0);
  let i = 1;
  const bpm = flags & 1 ? dv.getUint16(i, true) : dv.getUint8(i);
  i += flags & 1 ? 2 : 1;
  if (flags & 8) i += 2;
  const rr: number[] = [];
  if (flags & 16) for (; i + 1 < dv.byteLength; i += 2) rr.push(Math.round((dv.getUint16(i, true) / 1024) * 1000));
  return { bpm, rr };
}

async function bluetoothReady(): Promise<boolean> {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if ("bluetooth" in navigator) return true;
  if (ios) {
    try { await import("@beacio/core/auto"); } catch { return false; }
  }
  return "bluetooth" in navigator;
}

export class HeartError extends Error {
  constructor(public code: "unsupported" | "cancelled" | "failed") { super(code); }
}

export const heartErrorText = (code: HeartError["code"]) =>
  code === "cancelled" ? null
    : code === "unsupported" ? "Ce navigateur ne gère pas le Bluetooth. Sur iPhone, ouvre Prépa Basket dans Safari avec l'extension beacio, comme pour le rameur."
    : "La connexion à la ceinture a échoué. Mouille les électrodes, mets la ceinture, puis réessaie.";

class Heart {
  state: HeartState = "disconnected";
  /** Âge du joueur, pour les zones (réglé au chargement du profil). */
  age = 13;
  name = "";
  bpm = 0;
  samples: HeartSample[] = [];
  rr: { t: number; ms: number }[] = [];
  private device: BluetoothDevice | null = null;
  private listeners = new Set<() => void>();
  private lastSample = 0;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit() { this.listeners.forEach((f) => f()); }

  /** Ceinture déjà choisie une fois : on la retrouve sans fenêtre de choix (si le navigateur le permet). */
  knownName(): string | null {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "null")?.name ?? null; } catch { return null; }
  }

  async connect(pick = true): Promise<void> {
    if (!(await bluetoothReady())) throw new HeartError("unsupported");
    let device: BluetoothDevice | null = null;
    try {
      const known = JSON.parse(localStorage.getItem(KEY) ?? "null")?.id;
      const list = known && navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices() : [];
      device = list.find((d) => d.id === known) ?? null;
    } catch { /* pas de mémoire des appareils */ }
    if (!device) {
      if (!pick) throw new HeartError("failed");
      try {
        device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SERVICE] }] });
      } catch (e) {
        throw new HeartError((e as DOMException).name === "NotFoundError" ? "cancelled" : "failed");
      }
    }
    this.state = "searching";
    this.emit();
    try {
      const server = await device.gatt!.connect();
      const ch = await (await server.getPrimaryService(HR_SERVICE)).getCharacteristic(HR_MEASUREMENT);
      ch.addEventListener("characteristicvaluechanged", (e) => this.onValue((e.target as BluetoothRemoteGATTCharacteristic).value!));
      await ch.startNotifications();
      if (this.device !== device) device.addEventListener("gattserverdisconnected", () => { this.state = "disconnected"; this.bpm = 0; this.emit(); });
      this.device = device;
      this.name = device.name ?? "Ceinture cardio";
      this.state = "connected";
      try { localStorage.setItem(KEY, JSON.stringify({ id: device.id, name: this.name })); } catch { /* stockage bloqué */ }
      this.emit();
    } catch {
      this.state = "disconnected";
      this.emit();
      throw new HeartError("failed");
    }
  }

  disconnect() {
    this.device?.gatt?.disconnect();
    this.state = "disconnected";
    this.bpm = 0;
    this.emit();
  }

  private onValue(dv: DataView) {
    const { bpm, rr } = parseHeart(dv);
    const now = Date.now();
    if (bpm < 25 || bpm > 240) return; // contact perdu
    this.bpm = bpm;
    // une valeur par seconde au plus
    if (now - this.lastSample >= 950) {
      this.samples.push({ t: now, bpm });
      this.lastSample = now;
      if (this.samples.length % 300 === 0) this.samples = this.samples.filter((s) => s.t > now - KEEP_MS);
    }
    for (const ms of rr) this.rr.push({ t: now, ms });
    if (this.rr.length > 2000) this.rr = this.rr.filter((x) => x.t > now - KEEP_RR_MS);
    this.emit();
  }

  between(from: number, to = Date.now()) {
    return this.samples.filter((s) => s.t >= from && s.t <= to);
  }
  rrBetween(from: number, to = Date.now()) {
    return this.rr.filter((x) => x.t >= from && x.t <= to).map((x) => x.ms);
  }
}

export const heart = new Heart();

// ——— Zones et résumés ———

/** FC max estimée chez les jeunes (Tanaka) ; les zones sont des % de cette FC max. */
export const hrMaxFor = (age: number) => Math.round(208 - 0.7 * age);
export const ZONE_BOUNDS = [0.6, 0.7, 0.8, 0.9]; // Z1 < 60 % ≤ Z2 < 70 % ≤ Z3 < 80 % ≤ Z4 < 90 % ≤ Z5
export const ZONE_LABELS = ["Z1 · très léger", "Z2 · endurance", "Z3 · soutenu", "Z4 · seuil", "Z5 · intense"];

export interface HeartSummary { avg: number; max: number; min: number; zones: number[]; series: number[]; hrMax: number }

/** Résumé d'une séance : au moins une minute de mesures. `series` : une valeur toutes les 15 s, pour la courbe. */
export function summarize(samples: HeartSample[], age: number): HeartSummary | null {
  if (samples.length < 60) return null;
  const max = hrMaxFor(age);
  const zones = [0, 0, 0, 0, 0];
  for (const s of samples) zones[ZONE_BOUNDS.filter((b) => s.bpm >= b * max).length]++;
  const bpms = samples.map((s) => s.bpm);
  const series: number[] = [];
  for (let i = 0; i < samples.length; i += 15) {
    const chunk = bpms.slice(i, i + 15);
    series.push(Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length));
  }
  return {
    avg: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
    max: Math.max(...bpms), min: Math.min(...bpms), zones, series: series.slice(0, 480), hrMax: max,
  };
}

/**
 * Nettoyage des intervalles RR (méthode de Kubios, seuil « moyen ») : un battement est un artefact s'il sort de
 * 300 à 2 000 ms ou s'il s'écarte de plus de 20 % de la médiane de ses 10 voisins (battement manqué, en trop,
 * extrasystole, contact perdu). Les écarts successifs ne sont calculés qu'entre deux battements valides qui se suivent
 * vraiment : un artefact retiré ne crée pas de faux écart.
 */
export function rrQuality(rr: number[]): { rmssd: number | null; beats: number; artifactPct: number } {
  const inRange = rr.map((x) => x >= 300 && x <= 2000);
  const valid = rr.map((x, i) => {
    if (!inRange[i]) return false;
    const around: number[] = [];
    for (let j = Math.max(0, i - 5); j <= Math.min(rr.length - 1, i + 5); j++) if (j !== i && inRange[j]) around.push(rr[j]);
    if (around.length < 4) return true;
    const med = [...around].sort((a, b) => a - b)[Math.floor(around.length / 2)];
    return Math.abs(x - med) / med <= 0.2;
  });
  let sum = 0, n = 0;
  for (let i = 1; i < rr.length; i++) if (valid[i] && valid[i - 1]) { sum += (rr[i] - rr[i - 1]) ** 2; n++; }
  const bad = valid.filter((v) => !v).length;
  const artifactPct = rr.length ? Math.round((bad / rr.length) * 1000) / 10 : 100;
  // Au moins 60 écarts propres (≈ 1 min) et pas plus de 5 % d'artefacts, sinon la valeur n'est pas fiable
  return { rmssd: n >= 60 && artifactPct <= 5 ? Math.round(Math.sqrt(sum / n) * 10) / 10 : null, beats: rr.length, artifactPct };
}

/** RMSSD (ms) d'une mesure au repos, ou null si elle n'est pas fiable. */
export function rmssd(rr: number[]): number | null {
  return rrQuality(rr).rmssd;
}

/** FC au repos d'une mesure : moyenne de la fenêtre de mesure (après l'installation). Il faut au moins 75 % des
 *  secondes de la fenêtre : la ceinture envoie environ une valeur par seconde, il en manque toujours quelques-unes. */
export function restingFrom(samples: HeartSample[], windowSeconds = 180): number | null {
  if (samples.length < Math.max(45, Math.floor(windowSeconds * 0.75))) return null;
  const v = samples.map((s) => s.bpm);
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
}

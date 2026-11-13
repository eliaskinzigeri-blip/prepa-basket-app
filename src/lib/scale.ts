// Balance FitTrack Dara en Bluetooth, lue directement par l'app (sur iPhone, grâce à l'extension beacio comme le rameur).
// Protocole de la Dara 2.0 (famille eLink « MGB ») d'après le relevé publié par le projet openScale :
//   service 0xFFB0, 0xFFB1 = commandes (app → balance), 0xFFB2 = mesures (balance → app).
//   Trames de 8 octets : AC 02 b2 b3 b4 b5 canal somme, somme = (b2 + b3 + b4 + b5 + canal) & 0xFF.
//   Canal 0xCE : poids en direct · 0xCA : poids stabilisé · 0xCB : composition corporelle « AC 02 FE <indice> <hi> <lo> CB ».
//   Indices : 0 poids, 2 masse grasse %, 5 masse maigre kg, 8 eau %, 7 os kg (÷10), 6 métabolisme de base kcal (entier). Puis « 01 00 … » sur 20 octets = fin.
//   L'indice 5 est la masse musculaire « molle » (tout sauf graisse et os : muscles, organes, eau), pas les muscles seuls.
//   L'app FitTrack affiche le muscle squelettique : sur une pesée réelle, 25,1 kg pour un indice 5 de 45,7 kg (55 %),
//   rapport habituel muscle squelettique / masse maigre chez un ado. C'est ce chiffre qu'on garde comme masse musculaire.
// Repli : balances Bluetooth standard (Weight Scale 0x181D, Body Composition 0x181B).
import { ensureBluetooth, isIOS } from "./rower/rower";

const DARA = 0xffb0, DARA_CMD = 0xffb1, DARA_DATA = 0xffb2;
const WEIGHT_SVC = 0x181d, WEIGHT_MEAS = 0x2a9d, BODY_SVC = 0x181b, BODY_MEAS = 0x2a9c;
const GRACE_MS = 10_000; // après un poids stable, on attend la composition corporelle au plus ce temps
const STABLE_FRAMES = 4;
const SKELETAL_RATIO = 25.1 / 45.7; // calé sur la même pesée lue par l'app FitTrack

export interface Weighing { weight: number; fat_pct?: number; muscle_kg?: number; lean_kg?: number; water_pct?: number; bone_kg?: number; bmr?: number }
export interface ScaleUser { male: boolean; age: number; heightCm: number }
export type ScaleState = "idle" | "waiting" | "connected" | "measuring" | "done" | "error";

export const hex = (d: DataView | Uint8Array) => {
  const u = d instanceof Uint8Array ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join(" ");
};
export const checksum = (b: ArrayLike<number>) => (b[2] + b[3] + b[4] + b[5] + b[6]) & 0xff;

/** Trame de commande de la Dara : AC 02 b2 b3 b4 b5 CC somme. */
export function daraCommand(b2: number, b3: number, b4: number, b5: number): Uint8Array {
  const f = new Uint8Array([0xac, 0x02, b2 & 0xff, b3 & 0xff, b4 & 0xff, b5 & 0xff, 0xcc, 0]);
  f[7] = checksum(f);
  return f;
}

/** Séquence d'accueil : réveil, profil (sexe, âge, taille), date, heure, unité kg. */
export function daraHello(u: ScaleUser, now = new Date()): Uint8Array[] {
  return [
    daraCommand(0xf7, 0, 0, 0),
    daraCommand(0xfa, 0, 0, 0),
    daraCommand(0xfb, u.male ? 1 : 2, Math.max(0, Math.min(99, u.age)), Math.max(0, Math.min(255, Math.round(u.heightCm)))),
    daraCommand(0xfd, now.getFullYear() - 2000, now.getMonth() + 1, now.getDate()),
    daraCommand(0xfc, now.getHours(), now.getMinutes(), now.getSeconds()),
    daraCommand(0xfe, 6, 0, 0),
  ];
}

/**
 * Décodeur : on lui donne chaque notification, il suit le poids en direct et sait quand la pesée est finie.
 * Sans dépendance au Bluetooth, pour pouvoir le tester sur des trames enregistrées.
 */
export class WeighingDecoder {
  live = 0; // kg, poids affiché en direct
  stable = false;
  result: Weighing | null = null; // pesée terminée
  private parts: Partial<Weighing> = {};
  private lastDeci = -1;
  private same = 0;
  stableAt: number | null = null;

  /** Trame de la Dara (caractéristique 0xFFB2). Renvoie true si la pesée vient de se terminer. */
  dara(u: Uint8Array, t: number): boolean {
    if (this.result) return false;
    if (u.length >= 20 && u[0] === 0x01 && u[1] === 0x00) return this.finish();
    if (u.length < 8 || u[0] !== 0xac) return false;
    const be = (i: number) => (u[i] << 8) | u[i + 1];
    if (u.length >= 20 && u[2] === 0xff) {
      [12, 14, 16, 18].forEach((off, idx) => this.index(idx, be(off)));
      this.markStable(t);
      return false;
    }
    if (u.length === 8 && checksum(u) !== u[7]) return false;
    const chan = u[6];
    if (chan === 0xce || chan === 0xca) {
      const deci = be(2);
      if (deci <= 0 || deci >= 3000) return false; // 0 = balance vide ; au-delà de 300 kg = bruit
      this.live = deci / 10;
      this.same = deci === this.lastDeci ? this.same + 1 : 1;
      this.lastDeci = deci;
      if (chan === 0xca || this.same >= STABLE_FRAMES) this.markStable(t);
    } else if (chan === 0xcb && u[2] === 0xfe) {
      if (u[3] === 0xfc) return this.finish(); // marqueur de fin
      this.index(u[3], be(4));
    }
    return false;
  }

  /** Balance standard : Weight Measurement (0x2A9D). La mesure indiquée est déjà la mesure finale. */
  standardWeight(d: DataView, t: number): boolean {
    if (this.result || d.byteLength < 3) return false;
    const imperial = d.getUint8(0) & 1;
    const raw = d.getUint16(1, true);
    if (raw === 0xffff) return false;
    this.live = Math.round((imperial ? raw * 0.01 * 0.45359237 : raw * 0.005) * 10) / 10;
    this.parts.weight = this.live;
    this.markStable(t);
    return false;
  }

  /** Balance standard : Body Composition Measurement (0x2A9C), on garde la masse grasse. */
  standardBody(d: DataView): void {
    if (d.byteLength < 4) return;
    const fat = d.getUint16(2, true) / 10;
    if (fat > 0 && fat < 70) this.parts.fat_pct = fat;
  }

  /** À appeler régulièrement : clôt la pesée si la composition corporelle n'arrive pas. */
  tick(t: number): boolean {
    if (!this.result && this.stableAt != null && t - this.stableAt >= GRACE_MS) return this.finish();
    return false;
  }

  /** Coupure : si un poids stable a été vu, on le garde. */
  disconnected(): boolean {
    return !this.result && this.stableAt != null ? this.finish() : false;
  }

  private markStable(t: number) {
    this.stable = true;
    if (this.stableAt == null) this.stableAt = t;
  }

  private index(idx: number, v: number) {
    const x = v / 10;
    if (idx === 0 && x > 0) this.parts.weight = x;
    else if (idx === 2 && x > 0 && x < 70) this.parts.fat_pct = x;
    else if (idx === 5 && x > 5) this.parts.lean_kg = x;
    else if (idx === 6 && v >= 500 && v <= 4000) this.parts.bmr = v; // métabolisme de base en kcal/jour, entier (pas ÷10)
    else if (idx === 7 && x > 0) this.parts.bone_kg = x;
    else if (idx === 8 && x > 0 && x < 90) this.parts.water_pct = x;
  }

  private finish(): boolean {
    const weight = this.parts.weight ?? this.live;
    if (!(weight >= 20 && weight <= 250)) return false;
    const p = { ...this.parts };
    if (p.lean_kg != null && p.muscle_kg == null) p.muscle_kg = Math.round(p.lean_kg * SKELETAL_RATIO * 10) / 10;
    this.result = { ...p, weight: Math.round(weight * 10) / 10 };
    return true;
  }
}

// ---------- Connexion ----------

const KNOWN_KEY = "pb.scale.v1";
export function knownScale(): { id: string; name: string } | null {
  try { return JSON.parse(localStorage.getItem(KNOWN_KEY) ?? "null"); } catch { return null; }
}
function rememberScale(d: { id: string; name: string }) {
  try { localStorage.setItem(KNOWN_KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ }
}

export interface ScaleEvents {
  onState(s: ScaleState, detail?: string): void;
  onLive(kg: number, stable: boolean): void;
  onDone(w: Weighing): void;
  onLog(line: string): void;
}

export type ScaleError = "unsupported" | "cancelled" | "failed";
export class ScaleFail extends Error { constructor(public code: ScaleError) { super(code); } }

/** Liste du navigateur : à appeler dans un geste de l'utilisateur. */
export async function pickScale(): Promise<BluetoothDevice> {
  if (!(await ensureBluetooth())) throw new ScaleFail("unsupported");
  try {
    const d = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "FitTrack" }, { namePrefix: "Dara" }, { services: [DARA] }, { services: [WEIGHT_SVC] }, { services: [BODY_SVC] }],
      optionalServices: [DARA, WEIGHT_SVC, BODY_SVC],
    });
    rememberScale({ id: d.id, name: d.name ?? "Balance" });
    return d;
  } catch (e) {
    throw new ScaleFail((e as DOMException).name === "NotFoundError" ? "cancelled" : "failed");
  }
}

/** Balance déjà choisie une fois : retrouvée sans liste quand le navigateur le permet. */
export async function findKnownScale(): Promise<BluetoothDevice | null> {
  const k = knownScale();
  if (!k || !(await ensureBluetooth()) || !navigator.bluetooth.getDevices) return null;
  try { return (await navigator.bluetooth.getDevices()).find((d) => d.id === k.id) ?? null; } catch { return null; }
}

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, wait(ms).then(() => { throw new Error("délai dépassé"); })]) as Promise<T>;

/**
 * Attend la balance (elle ne s'allume que quand on monte dessus), s'y connecte, lit la pesée.
 * Tourne jusqu'à une pesée terminée ou stop(). Une balance éteinte fait juste échouer la connexion : on réessaie.
 */
export class ScaleSession {
  private stopped = false;
  private dec = new WeighingDecoder();
  readonly device: BluetoothDevice;
  private clock: ReturnType<typeof setInterval> | null = null;

  constructor(device: BluetoothDevice, private user: ScaleUser, private ev: ScaleEvents) {
    this.device = device;
  }

  get name() { return this.device.name ?? "Balance"; }

  async run() {
    this.ev.onState("waiting");
    let tries = 0;
    while (!this.stopped && !this.dec.result) {
      try {
        await this.measureOnce();
      } catch (e) {
        tries++;
        if (tries === 1 || tries % 10 === 0) this.ev.onLog(`Connexion impossible (${(e as Error).message}), nouvel essai`);
      }
      if (this.dec.result || this.stopped) break;
      this.ev.onState("waiting");
      await wait(1500);
    }
  }

  stop() {
    this.stopped = true;
    if (this.clock) clearInterval(this.clock);
    try { this.device.gatt?.disconnect(); } catch { /* déjà coupé */ }
  }

  private async measureOnce() {
    const server = await timeout(this.device.gatt!.connect(), 8000);
    this.ev.onLog(`Connecté à ${this.name}`);
    const finished = new Promise<void>((resolve) => {
      const done = () => {
        if (this.clock) clearInterval(this.clock);
        this.clock = null;
        this.device.removeEventListener("gattserverdisconnected", onDrop);
        resolve();
      };
      const finish = () => {
        this.ev.onDone(this.dec.result!);
        this.ev.onState("done");
        done();
        try { this.device.gatt?.disconnect(); } catch { /* rien */ }
      };
      const onDrop = () => {
        this.ev.onLog("Balance déconnectée");
        if (this.dec.disconnected()) finish(); else done();
      };
      this.device.addEventListener("gattserverdisconnected", onDrop);
      this.clock = setInterval(() => { if (this.dec.tick(Date.now())) finish(); }, 500);
      this.onFinish = finish;
    });

    let dara: BluetoothRemoteGATTService | null = null;
    try { dara = await server.getPrimaryService(DARA); } catch { /* pas une Dara */ }
    if (dara) {
      const data = await dara.getCharacteristic(DARA_DATA);
      data.addEventListener("characteristicvaluechanged", (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        this.ev.onLog(`← ${hex(v)}`);
        const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        const ended = this.dec.dara(u, Date.now());
        this.live();
        if (ended) this.onFinish?.();
      });
      await data.startNotifications();
      const cmd = await dara.getCharacteristic(DARA_CMD);
      for (const f of daraHello(this.user)) {
        this.ev.onLog(`→ ${hex(f)}`);
        const buf = f.slice().buffer as ArrayBuffer;
        await (cmd.properties.writeWithoutResponse && cmd.writeValueWithoutResponse ? cmd.writeValueWithoutResponse(buf) : cmd.writeValue(buf)).catch((e) => this.ev.onLog(`Écriture refusée : ${(e as Error).message}`));
        await wait(80);
      }
    } else {
      const svc = await server.getPrimaryService(WEIGHT_SVC).catch(() => null);
      if (!svc) {
        this.ev.onLog("Ni service FitTrack (0xFFB0) ni service balance standard (0x181D)");
        this.ev.onState("error", "unknown-scale");
        this.stopped = true;
        server.disconnect();
        return;
      }
      const ch = await svc.getCharacteristic(WEIGHT_MEAS);
      ch.addEventListener("characteristicvaluechanged", (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        this.ev.onLog(`← ${hex(v)}`);
        this.dec.standardWeight(v, Date.now());
        this.live();
      });
      await ch.startNotifications();
      const body = await server.getPrimaryService(BODY_SVC).then((s) => s.getCharacteristic(BODY_MEAS)).catch(() => null);
      if (body) {
        body.addEventListener("characteristicvaluechanged", (e) => this.dec.standardBody((e.target as BluetoothRemoteGATTCharacteristic).value!));
        await body.startNotifications().catch(() => undefined);
      }
    }
    this.ev.onState("connected");
    await finished;
  }

  private onFinish: (() => void) | null = null;

  private live() {
    if (this.dec.live > 0) {
      this.ev.onState("measuring");
      this.ev.onLive(this.dec.live, this.dec.stable);
    }
  }
}

export function scaleErrorText(code: ScaleError): string | null {
  if (code === "cancelled") return null;
  if (code === "unsupported") return isIOS()
    ? "Sur iPhone, active l'extension beacio pour Safari (comme pour le rameur), puis rouvre cette page."
    : "Ce navigateur ne gère pas le Bluetooth. Ouvre Prépa Basket dans Chrome ou Edge.";
  return "La connexion à la balance a échoué. Ferme l'app FitTrack, puis réessaie.";
}

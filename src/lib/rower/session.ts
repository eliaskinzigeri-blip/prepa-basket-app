// Déroulé d'une séance au rameur (d'après le moteur de RameFit, partie rameur seulement).
import { clampLevel } from "./ftms";
import { SimRower, hub } from "./rower";
import { hrMax, hrAt, ZONES, zonePace, type RowerPlan, type RowInterval } from "./plans";

export type TargetStatus = "below" | "in" | "above" | "free";

export interface RowSnapshot {
  index: number;
  count: number;
  iv: RowInterval;
  elapsed: number;
  remaining: number;
  totalRemaining: number;
  paused: boolean;
  /** Connexion coupée : le temps s'arrête, rien n'est compté. */
  link: "connected" | "searching" | "disconnected";
  finished: boolean;
  paceSec: number;
  spm: number;
  hr: number;
  level: number;
  coach: boolean;
  status: TargetStatus;
  target: [number, number] | null;
  lowCadence: boolean;
  hrAlert: boolean;
  notice: string | null;
}

export interface RowSummary {
  durationSec: number;
  rowingSec: number;
  distanceM: number;
  avgPaceSec: number;
  avgWatts: number;
  hrAvg: number;
  hrPeak: number;
  inTargetPct: number | null;
  demo: boolean;
  /** Arrêtée avant la fin du plan. */
  partial: boolean;
  /** Test : allure tenue sur les 20 min, si le test est allé au bout. */
  test: { paceSec: number; distanceM: number; complete: boolean } | null;
}

export interface RowMeta { eventId: string | null; next: { path: string; bench: boolean } | null }

const devSpeed = () => (import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("x")) || 1 : 1);
const MAX_LEVEL = 8; // on ne pousse pas la résistance au-delà : ces séances doivent rester faciles

export class RowSession {
  private listeners = new Set<() => void>();
  private snap!: RowSnapshot;
  private idx = 0;
  private elapsed = 0;
  private manualPause = false;
  private finished = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTs = 0;
  private wake: WakeLockSentinel | null = null;
  private speed = devSpeed();
  readonly startedAt = new Date().toISOString();

  private desired = 3;
  private offset = 0;
  private commanded: number | null = null;
  private rampBusy = false;
  private lastRamp = 0;
  private lastDistance: number | null = null;
  private smoothed = 0;
  private lowCadSec = 0;
  private hrHigh = 0;
  private hrAlertSec = 0;
  private notice: { text: string; until: number } | null = null;

  private rowing = 0;
  private distance = 0;
  private wattSum = 0;
  private wattSec = 0;
  private hrSum = 0;
  private hrSec = 0;
  private hrPeak = 0;
  private inTarget = 0;
  private targetSec = 0;
  private testSec = 0;
  private testDist = 0;
  private demoUsed = false;
  private stoppedEarly = false;

  constructor(readonly plan: RowerPlan, readonly age: number, readonly ref: number, readonly meta: RowMeta) {
    this.enter();
    this.publish();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;

  start() {
    if (this.timer) return;
    this.lastTs = performance.now();
    this.timer = setInterval(() => this.tick(), 250);
    void this.keepAwake();
    document.addEventListener("visibilitychange", this.onVisible);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onVisible);
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
    this.aimSim(false);
    try { speechSynthesis?.cancel?.(); } catch { /* synthèse vocale absente */ }
  }

  private onVisible = () => { if (document.visibilityState === "visible" && !this.finished) void this.keepAwake(); };
  private async keepAwake() { try { this.wake = await navigator.wakeLock?.request("screen"); } catch { /* refusé : la séance continue */ } }

  togglePause() {
    this.manualPause = !this.manualPause;
    this.aimSim(!this.manualPause);
    this.say(this.manualPause ? "Pause." : "On reprend.");
    this.publish();
  }
  skip() { this.advance(); }
  // arrêtée avant la fin du plan : la séance sera « partiellement faite »
  finishEarly() { this.stoppedEarly = this.elapsed < this.plan.seconds * 0.95; this.finish(); }
  nudge(delta: number) {
    const next = Math.min(MAX_LEVEL, clampLevel(this.desired + delta));
    this.offset += next - this.desired;
    this.desired = next;
    this.publish();
  }

  summary(): RowSummary {
    const test = this.plan.kind === "test" && this.testDist > 0
      ? { paceSec: this.testSec / (this.testDist / 500), distanceM: Math.round(this.testDist), complete: this.testSec >= 20 * 60 * 0.95 }
      : null;
    return {
      durationSec: Math.round(this.rowing),
      rowingSec: Math.round(this.rowing),
      distanceM: Math.round(this.distance),
      avgPaceSec: this.distance > 0 ? Math.round(this.rowing / (this.distance / 500)) : 0,
      avgWatts: this.wattSec ? Math.round(this.wattSum / this.wattSec) : 0,
      hrAvg: this.hrSec ? Math.round(this.hrSum / this.hrSec) : 0,
      hrPeak: Math.round(this.hrPeak),
      inTargetPct: this.targetSec ? Math.round((this.inTarget / this.targetSec) * 100) : null,
      demo: this.demoUsed || Boolean(hub.rower?.isDemo),
      partial: this.stoppedEarly,
      test,
    };
  }

  private get iv() { return this.plan.intervals[this.idx]; }

  private enter() {
    this.elapsed = 0;
    const iv = this.iv;
    this.desired = Math.min(MAX_LEVEL, clampLevel(iv.resistance + this.offset));
    this.aimSim(true);
    this.hrHigh = 0;
    this.say(`${iv.label}. Résistance ${this.desired}. Cadence ${iv.spm[0]} à ${iv.spm[1]}.`);
  }

  private advance() {
    if (this.idx >= this.plan.intervals.length - 1) return this.finish();
    this.idx++;
    this.enter();
    this.publish();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    this.say("Séance terminée.");
    this.publish();
  }

  private aimSim(active: boolean) {
    const r = hub.rower;
    if (!(r instanceof SimRower)) return;
    this.demoUsed = true;
    const t = this.targetOf(this.iv);
    r.aim = { active, spm: Math.round((this.iv.spm[0] + this.iv.spm[1]) / 2), paceSec: t ? Math.round((t[0] + t[1]) / 2) : this.iv.isTest ? this.ref * 1.05 : this.ref * 1.25 };
  }

  private targetOf(iv: RowInterval) { return iv.zone ? zonePace(iv.zone, this.ref) : null; }

  private tick() {
    const now = performance.now();
    const dt = ((now - this.lastTs) / 1000) * this.speed;
    this.lastTs = now;
    if (this.finished) return;
    const r = hub.rower;
    // Connexion perdue : on arrête le temps plutôt que de compter une séance sans mesure.
    if (this.manualPause || r?.state !== "connected") { this.lastDistance = null; return this.publish(); }

    const s = r.sample;
    const moving = s.spm > 0;
    if (moving) {
      this.elapsed += dt;
      this.rowing += dt;
    }
    if (this.lastDistance !== null) {
      const delta = Math.max(0, s.distanceM - this.lastDistance);
      this.distance += delta;
      if (this.iv.isTest) this.testDist += delta;
    }
    this.lastDistance = s.distanceM;
    if (this.iv.isTest && moving) this.testSec += dt;
    if (s.paceSec > 0 && s.paceSec < 900) this.smoothed = this.smoothed ? this.smoothed + (s.paceSec - this.smoothed) * 0.3 : s.paceSec;
    else if (!moving) this.smoothed = 0;
    if (s.watts > 0) { this.wattSum += s.watts * dt; this.wattSec += dt; }
    const hr = this.hr();
    if (hr > 0) { this.hrSum += hr * dt; this.hrSec += dt; this.hrPeak = Math.max(this.hrPeak, hr); }
    this.lowCadSec = moving && s.spm < 22 ? this.lowCadSec + dt : 0;

    const status = this.statusOf(s.spm);
    if (this.iv.zone) { this.targetSec += dt; if (status === "in") this.inTarget += dt; }

    // Sécurité : au-delà de 95 % de la FC max, on conseille de s'arrêter.
    this.hrAlertSec = hr >= hrMax(this.age) * 0.95 ? this.hrAlertSec + dt : 0;
    if (this.iv.zone && hr > 0) {
      this.hrHigh = hr > hrAt(ZONES[this.iv.zone].hr[1], this.age) ? this.hrHigh + dt : 0;
      if (this.hrHigh > 30) {
        this.hrHigh = -60;
        this.nudge(-1);
        this.setNotice("Ton cœur monte au-dessus de la zone : résistance -1.");
      }
    }
    this.driveResistance();
    if (this.elapsed >= this.iv.seconds) this.advance();
    else this.publish();
  }

  private hr() { return hub.hrState === "connected" && hub.hrValue > 0 ? hub.hrValue : hub.rower?.sample.hr ?? 0; }

  private statusOf(spm: number): TargetStatus {
    const t = this.targetOf(this.iv);
    if (this.iv.isTest) return "free";
    if (t) {
      if (!this.smoothed) return "below";
      if (this.smoothed < t[0]) return "above";
      if (this.smoothed > t[1]) return "below";
      return "in";
    }
    if (spm < this.iv.spm[0]) return "below";
    if (spm > this.iv.spm[1]) return "above";
    return "in";
  }

  /** Résistance douce : un niveau par seconde au plus, une commande à la fois. */
  private driveResistance() {
    const r = hub.rower;
    if (!r || r.state !== "connected") { this.commanded = null; return; }
    if (r.sample.level !== null && this.commanded === null) this.commanded = r.sample.level;
    if (r.control !== "control" || this.rampBusy || this.desired === this.commanded) return;
    const now = performance.now();
    if (now - this.lastRamp < 1000) return;
    const from = this.commanded ?? this.desired;
    const next = from === this.desired ? from : from + Math.sign(this.desired - from);
    this.rampBusy = true;
    this.lastRamp = now;
    void r.setLevel(next).then((res) => {
      this.rampBusy = false;
      if (res === "ok") this.commanded = next;
    });
  }

  private setNotice(text: string) {
    this.notice = { text, until: performance.now() + 6000 };
    this.say(text);
  }

  private say(text: string) {
    try {
      if (!("speechSynthesis" in window) || this.speed > 1) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "fr-FR";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* synthèse vocale absente */ }
  }

  private publish() {
    const r = hub.rower;
    const iv = this.iv;
    const later = this.plan.intervals.slice(this.idx + 1).reduce((n, i) => n + i.seconds, 0);
    const remaining = Math.max(0, iv.seconds - this.elapsed);
    const up = r?.state === "connected";
    this.snap = {
      index: this.idx,
      count: this.plan.intervals.length,
      iv,
      elapsed: this.elapsed,
      remaining,
      totalRemaining: remaining + later,
      paused: this.manualPause,
      link: r?.state ?? "disconnected",
      finished: this.finished,
      paceSec: up ? Math.round(this.smoothed) : 0,
      spm: up ? Math.round(r!.sample.spm) : 0,
      hr: this.hr(),
      level: this.desired,
      coach: r?.control !== "control",
      status: this.statusOf(up ? r!.sample.spm : 0),
      target: this.targetOf(iv),
      lowCadence: this.lowCadSec > 8,
      hrAlert: this.hrAlertSec > 20,
      notice: this.notice && this.notice.until > performance.now() ? this.notice.text : null,
    };
    this.listeners.forEach((l) => l());
  }
}

const DEVICE_KEY = "pb.rower.device";
/** Dernier rameur connecté sur ce téléphone, pour la reconnexion rapide. */
export function rememberedDevice(): { id: string; name: string } | null {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null"); } catch { return null; }
}
export function rememberDevice(d: { id: string; name: string }) {
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); } catch { /* stockage bloqué */ }
}

/** Séance en cours : elle continue si le joueur change d'écran (la connexion Bluetooth vit ici aussi). */
export const activeRow: { session: RowSession | null } = { session: null };

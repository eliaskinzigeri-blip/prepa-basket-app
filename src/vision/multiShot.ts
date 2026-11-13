// Shoot à plusieurs : plusieurs ballons peuvent être en l'air en même temps.
// Ballon principal : exactement le compteur du solo (même choix du ballon, même ShotTracker), réglé sur les 17 tirs.
// Autres ballons : un compteur par ballon suivi, avec des preuves plus strictes (lâcher vu sous le cercle, vol vers le panier),
// pour ne pas compter une main, une tête ou un ballon qu'on se passe. Un même ballon n'est jamais compté deux fois.
import { ShotTracker, type Rim, type Pt } from "./shot";

export interface BallSeen { id: number; x: number; y: number; r: number } // pixels vidéo
type Ctx = Parameters<ShotTracker["push"]>[1];
type Result = NonNullable<ReturnType<ShotTracker["push"]>>;

interface Slot { tracker: ShotTracker; ballId: number; last: Pt | null; vx: number; vy: number; seen: number; hist: Pt[] }

const ADOPT_MS = 900; // un ballon caché moins longtemps que ça garde son compteur
const DROP_MS = 4000; // compteur sans ballon depuis ce temps, et pas en plein tir : on le retire
const MAX_SLOTS = 8; // garde-fou : au-delà, ce sont des mains, des têtes ou des pieds qui bougent
const HIST_MS = 6000;

export class MultiShot {
  slots: Slot[] = [];
  readonly main: ShotTracker;
  private mainHist: Pt[] = [];
  constructor(private rim: Rim, private pxPerM: number, private hoopH: number, private vw: number, private vh: number) {
    this.main = new ShotTracker(rim, pxPerM, hoopH, vw, vh);
  }

  /**
   * Une image. main : le ballon choisi comme en solo (ou null) ; balls : tous les objets ronds en mouvement, avec l'id de leur piste.
   * Renvoie les tirs terminés à cette image.
   */
  push(t: number, main: Omit<BallSeen, "id"> | null, balls: BallSeen[], ctx: Ctx): Result[] {
    const out: Result[] = [];
    const mp = main ? { t, x: main.x, y: main.y, r: main.r } : null;
    if (mp) { this.mainHist.push(mp); while (this.mainHist.length && t - this.mainHist[0].t > HIST_MS) this.mainHist.shift(); }
    const m = this.main.push(mp, ctx);
    if (m) out.push(m);

    const fed = new Set<Slot>();
    // un même ballon peut sortir en deux taches (le filet, une main devant) : une seule compte, celle déjà en plein tir d'abord
    const rank = (b: BallSeen) => {
      const s = this.slots.find((x) => x.ballId === b.id);
      return (s?.tracker.inFlight ? 2 : s ? 1 : 0) * 1000 + b.r;
    };
    const kept: BallSeen[] = [];
    for (const b of [...balls].sort((a, c) => rank(c) - rank(a))) {
      if (!kept.some((k) => Math.hypot(k.x - b.x, k.y - b.y) < 2.5 * Math.max(k.r, b.r))) kept.push(b);
    }
    const known = kept.filter((b) => this.slots.some((s) => s.ballId === b.id));
    const fresh = kept.filter((b) => !known.includes(b));
    for (const b of [...known, ...fresh]) {
      let slot: Slot | null | undefined = this.slots.find((s) => s.ballId === b.id && !fed.has(s));
      if (!slot) slot = this.adopt(t, b, fed);
      if (!slot) {
        if (this.slots.length >= MAX_SLOTS) this.dropOldest();
        slot = { tracker: new ShotTracker(this.rim, this.pxPerM, this.hoopH, this.vw, this.vh), ballId: b.id, last: null, vx: 0, vy: 0, seen: t, hist: [] };
        this.slots.push(slot);
      }
      slot.ballId = b.id;
      fed.add(slot);
      const p = { t, x: b.x, y: b.y, r: b.r };
      if (slot.last && t > slot.last.t) {
        const dt = t - slot.last.t;
        slot.vx = 0.5 * slot.vx + 0.5 * ((p.x - slot.last.x) / dt);
        slot.vy = 0.5 * slot.vy + 0.5 * ((p.y - slot.last.y) / dt);
      }
      slot.last = p;
      slot.seen = t;
      slot.hist.push(p);
      while (slot.hist.length && t - slot.hist[0].t > HIST_MS) slot.hist.shift();
      const r = slot.tracker.push(p, ctx);
      if (r && this.extra(r, slot)) out.push(r);
    }
    // le temps passe aussi pour les ballons qu'on ne voit pas (filet, attente du rebond)
    for (const s of this.slots) {
      if (fed.has(s)) continue;
      const r = s.tracker.push(null, ctx);
      if (r && this.extra(r, s)) out.push(r);
    }
    this.slots = this.slots.filter((s) => s.tracker.inFlight || t - s.seen < DROP_MS);
    return out;
  }

  /** Tir d'un autre ballon que le principal : on ne le garde que sur preuves, et s'il n'est pas le ballon principal lui-même. */
  private extra(r: Result, s: Slot): boolean {
    const rim = this.rim, rel = r.releasePt;
    const end = r.t1 - 600;
    const flight = s.hist.filter((q) => q.t >= rel.t && q.t <= end);
    if (!r.measured || flight.length < 6) return false; // lâcher vu sous le cercle, vol suivi
    if (end - rel.t < 700) return false; // un vrai tir monte puis redescend : pas un éclair
    const top = Math.min(...flight.map((q) => q.y));
    if (top > rim.y - 2 * (rel.r ?? rim.r * 0.5)) return false; // nettement au-dessus du cercle
    const last = flight.at(-1)!;
    if (Math.abs(last.x - rim.x) > Math.max(Math.abs(rel.x - rim.x) * 0.8, 3 * rim.r)) return false; // vole vers le panier
    // même ballon que le principal : il a suivi le même chemin au même moment
    const near = (q: Pt) => this.mainHist.some((h) => Math.abs(h.t - q.t) < 40 && Math.hypot(h.x - q.x, h.y - q.y) < 3 * (q.r ?? rim.r * 0.5));
    return flight.filter(near).length < flight.length * 0.3;
  }

  /** Nouvelle piste : est-ce un ballon déjà suivi, perdu un instant ? Le plus proche de là où on l'attendait. */
  private adopt(t: number, b: BallSeen, fed: Set<Slot>): Slot | null {
    let best: { s: Slot; d: number } | null = null;
    for (const s of this.slots) {
      if (fed.has(s) || !s.last) continue;
      const dt = t - s.last.t;
      if (dt <= 0 || dt > ADOPT_MS) continue;
      const px = s.last.x + s.vx * dt, py = s.last.y + s.vy * dt;
      const d = Math.hypot(b.x - px, b.y - py);
      // la gravité courbe la trajectoire : marge qui grandit avec le temps passé caché
      const allow = 3 * Math.max(b.r, s.last.r ?? b.r) + (dt / 1000) * 6 * this.pxPerM;
      if (d < allow && (!best || d < best.d)) best = { s, d };
    }
    return best?.s ?? null;
  }

  private dropOldest() {
    const idle = this.slots.filter((s) => !s.tracker.inFlight).sort((a, b) => a.seen - b.seen);
    const victim = idle[0] ?? [...this.slots].sort((a, b) => a.seen - b.seen)[0];
    this.slots = this.slots.filter((s) => s !== victim);
  }

  /** Ballons en plein tir, pour dessiner leur trajectoire. */
  flights(): Pt[][] {
    return [this.main, ...this.slots.map((s) => s.tracker)].filter((k) => k.inFlight).map((k) => k.pts.slice(k.releaseIdx));
  }
}

// Analyse du shoot : détection tir réussi / raté à partir de la trajectoire du ballon et du cercle,
// puis angle de sortie, force, distance, hauteur max. Logique réécrite (pas de code repris du dépôt sans licence).

export interface Pt { t: number; x: number; y: number; r?: number } // pixels vidéo, t en ms (horloge d'enregistrement)
export interface Rim { x: number; y: number; r: number } // pixels vidéo
export interface Shot {
  made: boolean;
  measured?: boolean; // false : le départ du tir n'a pas été vu
  short: boolean; // raté court (avant le cercle)
  angle: number; // ° de sortie
  speed: number; // m/s
  distance: number; // m
  apex: number; // m au-dessus du sol
  releaseMs: number | null; // temps de déclenchement
  jumpCm: number | null;
  elbow: number | null; // ° angle du coude au déclenchement
  spot: string;
  courtX: number; courtY: number; // position sur le terrain (m), panier en (0,0)
  t0: number; t1: number; // fenêtre vidéo (ms depuis le début de l'enregistrement)
  path: [number, number][]; // trajectoire normalisée 0–1 pour le replay
}

export const SPOT_ANGLE: Record<string, number> = { coin_g: -88, aile_g: -45, axe: 0, aile_d: 45, coin_d: 88, lf: 0, libre: 0 };
export const SPOT_NAME: Record<string, string> = { coin_g: "coin gauche", aile_g: "aile gauche", axe: "axe", aile_d: "aile droite", coin_d: "coin droit", lf: "ligne des lancers francs", libre: "tir libre" };

export function zoneOf(x: number, y: number): string {
  const d = Math.hypot(x, y);
  const a = (Math.atan2(x, y) * 180) / Math.PI;
  if (d < 2.6) return "raquette";
  if (Math.abs(a) > 62) return a < 0 ? "coin_g" : "coin_d";
  if (Math.abs(a) > 22) return a < 0 ? "aile_g" : "aile_d";
  return "axe";
}

/** Régression linéaire simple : pente par ms. */
function slope(pts: Pt[], key: "x" | "y") {
  const n = pts.length;
  const mt = pts.reduce((s, p) => s + p.t, 0) / n;
  const mv = pts.reduce((s, p) => s + p[key], 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.t - mt) * (p[key] - mv); den += (p.t - mt) ** 2; }
  return den ? num / den : 0;
}

/** Ajustement parabolique y = a + b·t + c·t² : renvoie la vitesse verticale à l instant tAt (px/ms). */
function initialSlopeQuadratic(pts: Pt[], tAt = pts[0].t) {
  const t0 = pts[0].t;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (const p of pts) {
    const t = p.t - t0;
    s0++; s1 += t; s2 += t * t; s3 += t ** 3; s4 += t ** 4;
    y0 += p.y; y1 += p.y * t; y2 += p.y * t * t;
  }
  // Résolution du système normal 3×3 (Cramer)
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const A = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const D = det(A);
  if (Math.abs(D) < 1e-9) return slope(pts, "y");
  const b = det([[s0, y0, s2], [s1, y1, s3], [s2, y2, s4]]) / D;
  const c = det([[s0, s1, y0], [s1, s2, y1], [s2, s3, y2]]) / D;
  return b + 2 * c * (tAt - t0);
}

const NET_MS = 800; // ballon caché par le filet : au-delà, on ne sait plus par où il est passé
const ENTER_MS = 700; // temps laissé au ballon pour rebondir, et au filet pour montrer qu'il bouge
const NET_AFTER_MS = 400; // on ne regarde le filet qu'une fois le ballon forcément parti : lui aussi fait bouger cette zone
const NET_MOVING = 0.08; // part du filet qui bouge pour dire qu'il bouge à cette image
const NET_SHARE = 0.8; // part des images où il doit bouger : presque toutes sur un vrai panier
const GAP_MS = 350; // au-delà, deux positions ne sont plus considérées comme un même mouvement
const MAX_SPEED = 10; // m/s, vitesse d'un ballon autour du panier, marge comprise
const BALL_M = 0.24;
const BALL_PER_RIM = 0.5; // un ballon (24 cm) fait environ la moitié d'un cercle (45 cm), et la tache détectée est un peu plus petite que lui
const NEAR = 1.2; // au-delà de ce multiple du rayon, le ballon est passé à côté sans discussion

export class ShotTracker {
  pts: Pt[] = [];
  inFlight = false;
  flightStart = 0;
  releaseIdx = 0;
  lastSeen = 0;
  private netLog: { t: number; v: number }[] = [];
  private entered: number | null = null; // instant où le ballon est arrivé dans le cercle, en attendant de savoir s'il passe
  private restUntil = 0; // juste après un tir, le ballon qui rebondit ou retombe ne compte pas pour un nouveau tir
  constructor(public rim: Rim, public pxPerM: number, public rimHeightM: number, public vw: number, public vh: number) {}

  private netMoved(from: number) {
    const v = this.netLog.filter((n) => n.t >= from + NET_AFTER_MS && n.t <= from + ENTER_MS);
    if (!v.length) return false;
    return v.filter((n) => n.v >= NET_MOVING).length / v.length >= NET_SHARE;
  }

  /** Rayon du ballon d'après les dernières positions (0 si inconnu). */
  private ballSize() {
    // sur tout le vol : le ballon paraît plus petit quand le filet le cache en partie
    const from = this.inFlight ? this.pts.slice(this.releaseIdx) : this.pts.slice(-8);
    const r = from.map((q) => q.r ?? 0).filter(Boolean).sort((a, b) => a - b);
    return r.length ? r[r.length >> 1] : this.rim.r * BALL_PER_RIM;
  }

  /** Passage assez près du cercle pour que le filet ait son mot à dire. Large : le cercle réglé à la main peut être imprécis, le filet tranche. */
  private nearRim() {
    return Math.max(this.rim.r, this.ballSize() / BALL_PER_RIM) * NEAR;
  }

  /** Ajoute une position du ballon (ou null s'il n'est pas vu). Renvoie un tir terminé le cas échéant. */
  push(point: Pt | null, ctx: { spot: string; releaseMs: number | null; jumpCm: number | null; elbow: number | null; net?: number; t?: number }): Omit<Shot, "spot" | "courtX" | "courtY"> & { releasePt: Pt } | null {
    let p = point;
    const { rim } = this;
    // ctx.t : le temps passe même quand le ballon n'est pas vu
    const now = ctx.t ?? p?.t ?? (this.pts.at(-1)?.t ?? 0);
    if (ctx.net != null) {
      this.netLog.push({ t: now, v: ctx.net });
      if (this.netLog.length > 120) this.netLog.shift();
    }
    // un ballon ne se téléporte pas : un autre objet qui bouge ailleurs ne doit pas se mêler au vol
    const before0 = this.pts.at(-1);
    if (p && before0 && Math.hypot(p.x - before0.x, p.y - before0.y) > this.ballSize() * 2 + ((p.t - before0.t) / 1000) * MAX_SPEED * ((2 * this.ballSize()) / BALL_M)) {
      if (!this.inFlight) this.pts = [];
      else p = null;
    }
    if (p) {
      this.pts.push(p);
      this.lastSeen = p.t;
      while (this.pts.length && p.t - this.pts[0].t > 4000) { this.pts.shift(); if (this.releaseIdx > 0) this.releaseIdx--; }
    }
    // téléphone posé au sol : vu d'en bas, le ballon ne dépasse le cercle que de peu à l'image
    const aboveRim = p && p.y < rim.y - this.ballSize();
    if (!this.inFlight) {
      // Départ du tir : le ballon passe au-dessus du cercle en montant.
      if (aboveRim && this.pts.length >= 4 && p!.t >= this.restUntil) {
        const prev = this.pts[this.pts.length - 2];
        const before = this.pts[this.pts.length - 3];
        // trois positions de suite qui montent : un point isolé en hauteur n'est pas un tir
        // et qui montent vraiment : un feuillage qui tremble reste sur place
        if (p!.y < prev.y && prev.y < before.y && p!.t - before.t < 300 && before.y - p!.y > this.ballSize() * 0.5) {
          this.inFlight = true;
          this.flightStart = p!.t;
          // Point de lâcher : début de la montée continue.
          let i = this.pts.length - 1;
          while (i > 0 && this.pts[i - 1].y > this.pts[i].y - 1 && this.pts[i].t - this.pts[i - 1].t < GAP_MS && p!.t - this.pts[i - 1].t < 1500) i--;
          this.releaseIdx = i;
        }
      }
      // ballon sorti par le haut de l'image pendant la montée : il réapparaît en tombant, haut au-dessus du cercle
      if (p && !this.inFlight && this.pts.length >= 5 && p.t >= this.restUntil) {
        const f = this.pts.slice(-5);
        const falling = f.every((q, i) => !i || (q.y > f[i - 1].y && q.t - f[i - 1].t < GAP_MS));
        if (falling && f[0].y < rim.y - this.ballSize() * 3 && p.y < rim.y) {
          this.inFlight = true;
          this.flightStart = p.t;
          this.releaseIdx = this.pts.length - 5;
        }
      }
      return null;
    }
    // En vol : on attend le passage du plan du cercle en descendant.
    const last = this.pts.at(-1)!;
    const prev = this.pts.at(-2);
    let made: boolean | null = null;
    let short = false;
    const rel0 = this.pts[this.releaseIdx];
    const missSide = (x: number) => Math.sign(x - rim.x) === Math.sign(rel0.x - rim.x);
    if (this.entered != null) {
      // le ballon est arrivé dans le cercle : il reste à voir s'il y est vraiment passé
      const size = this.ballSize();
      if (p && p.y < rim.y - size) {
        // il remonte : il a touché le cercle ou la planche. Le tir continue.
        this.entered = null;
        this.flightStart = p.t;
      } else if (now - this.entered > ENTER_MS) {
        // le critère qui ne trompe pas : un panier fait bouger le filet bien après le passage du ballon, un ballon passé devant non
        made = this.netMoved(this.entered);
        short = !made && missSide(last.x);
      }
    } else if (p && prev && prev.y < rim.y && p.y >= rim.y) {
      // première position sous le cercle, même si le ballon a été caché par le filet entre-temps
      const k = (rim.y - prev.y) / (p.y - prev.y || 1);
      const xCross = prev.x + (p.x - prev.x) * k;
      if (p.t - prev.t < NET_MS && Math.abs(xCross - rim.x) < this.nearRim()) this.entered = p.t;
      else { made = false; short = missSide(xCross); }
    } else if (now - this.flightStart > 2500 || (!p && now - this.lastSeen > 1200) || now - this.lastSeen > 1500) {
      // jamais vu retomber, ou vu trop peu de temps : une tête ou une main passée haut, pas un tir
      const seenFlight = this.pts.slice(this.releaseIdx);
      const top = Math.min(...seenFlight.map((q) => q.y));
      if (seenFlight.length < 6 || last.y < top + rim.r) { this.inFlight = false; this.entered = null; this.pts = []; return null; }
      made = false;
      const rel = this.pts[this.releaseIdx];
      short = Math.abs(last.x - rim.x) > rim.r && Math.sign(last.x - rim.x) === Math.sign(rel.x - rim.x);
    }
    if (made == null) return null;

    const flight = this.pts.slice(this.releaseIdx);
    const rel = flight[0] ?? last;
    // Les premières images mêlent encore le geste : on ajuste la parabole sur le vol libre, évalué au lâcher.
    const free = flight.length >= 10 ? flight.slice(3, 16) : flight;
    const vx = free.length >= 2 ? slope(free, "x") : 0; // px/ms
    const vy = free.length >= 4 ? initialSlopeQuadratic(free, rel.t) : free.length >= 2 ? slope(free, "y") : 0;
    const angle = Math.round((Math.atan2(-vy, Math.abs(vx)) * 180) / Math.PI);
    const speed = (Math.hypot(vx, vy) * 1000) / this.pxPerM;
    const distance = Math.abs(rel.x - rim.x) / this.pxPerM;
    const groundY = rim.y + this.rimHeightM * this.pxPerM;
    const apex = (groundY - Math.min(...flight.map((q) => q.y))) / this.pxPerM;
    const step = Math.max(1, Math.floor(flight.length / 24));
    const path = flight.filter((_, i) => i % step === 0).map((q) => [q.x / this.vw, q.y / this.vh] as [number, number]);
    const out = {
      measured: rel.y > rim.y, // lâcher vu sous le cercle : sinon angle, force et distance ne veulent rien dire
      made, short, angle: Math.max(0, Math.min(89, angle)), speed: Math.round(speed * 10) / 10, distance: Math.round(distance * 10) / 10,
      apex: Math.round(apex * 100) / 100, releaseMs: ctx.releaseMs, jumpCm: ctx.jumpCm, elbow: ctx.elbow,
      t0: Math.max(0, rel.t - 1200), t1: last.t + 600, path, releasePt: rel,
    };
    this.inFlight = false;
    this.entered = null;
    this.pts = [];
    this.restUntil = last.t + 1000;
    return out;
  }
}

/** Conseils à partir des tirs ratés, appuyés sur un chiffre mesuré. */
export function advice(shots: Shot[]): string[] {
  // seuls les tirs vus depuis le lâcher disent quelque chose du geste
  const seen = shots.filter((s) => s.measured !== false);
  const miss = seen.filter((s) => !s.made);
  const made = seen.filter((s) => s.made);
  const out: string[] = [];
  if (!seen.length) return out;
  const avg = (l: number[]) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length);
  const missAngle = Math.round(avg(miss.map((s) => s.angle)));
  if (miss.length >= 3 && missAngle < 43) out.push(`Tes tirs ratés sortent à ${missAngle}° : vise 45–50°.`);
  if (miss.length >= 3 && missAngle > 58) out.push(`Tes tirs ratés sortent à ${missAngle}°, trop en cloche : vise 45–50°.`);
  const far = miss.filter((s) => s.distance >= 5.5);
  const farShort = far.filter((s) => s.short).length;
  if (far.length >= 2 && farShort / far.length >= 0.6) out.push(`À ${Math.round(avg(far.map((s) => s.distance)))} m tu manques de force : plie plus les jambes.`);
  const longMiss = miss.filter((s) => !s.short).length;
  if (miss.length >= 4 && longMiss / miss.length > 0.65) out.push("La plupart de tes ratés sont longs : relâche le poignet et garde le même saut.");
  const rel = shots.map((s) => s.releaseMs).filter((v): v is number => v != null);
  if (rel.length >= 3 && avg(rel) > 750) out.push(`Ton déclenchement prend ${Math.round(avg(rel))} ms : vise moins de 600 ms pour tirer avant le contre.`);
  const elb = shots.map((s) => s.elbow).filter((v): v is number => v != null);
  if (elb.length >= 3 && Math.abs(avg(elb) - 90) > 20) out.push(`Ton coude est à ${Math.round(avg(elb))}° au déclenchement : cherche un angle proche de 90°, coude sous le ballon.`);
  if (!out.length && made.length) out.push(`Bonne régularité : tes tirs réussis sortent à ${Math.round(avg(made.map((s) => s.angle)))}°. Garde ce geste.`);
  return out;
}

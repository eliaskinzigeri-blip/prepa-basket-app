// Mesure d'un saut vertical sur place à partir des repères du corps (coordonnées en pixels vidéo).
// Méthode principale : temps de vol des pieds (h = g·t²/8), qui ne dépend pas de l'échelle de l'image.
// La montée des hanches sert seulement de contrôle : si les deux méthodes divergent, l'essai est refusé.

export interface JumpFrame {
  t: number; // ms
  foot: number; // y du point le plus bas des pieds (talons et orteils)
  hip: number; // y du milieu des hanches
  torso: number; // longueur épaules → hanches, pour vérifier que le joueur ne s'est pas rapproché
}
export type JumpResult = ({ cm: number; reason?: undefined } | { cm: null; reason: string }) & { info: string };

const G = 9.81;
const LIFT = 3; // cm : seuil de décollage / d'atterrissage des pieds
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

export class JumpMeter {
  private ground: number[] = [];
  private torsos: number[] = [];
  private hips: number[] = [];
  // diagnostic affiché sous un essai refusé : montée max des pieds et des hanches, images par seconde
  private maxLift = 0;
  private maxRise = 0;
  private frames = 0;
  private win: JumpFrame[] = [];
  private base = { foot: 0, torso: 0, hip: 0 };
  private prev: { t: number; lift: number; hip: number } | null = null;
  private takeoff = 0;
  private hipTake = 0;
  private minHip = Infinity;
  private start = 0;

  private pxPerCm: number;
  constructor(pxPerCm: number) { this.pxPerCm = pxPerCm; }

  /** Pendant le compte à rebours : position debout de référence (le joueur a pu bouger depuis le calibrage). */
  settle(f: JumpFrame) {
    this.ground.push(f.foot);
    this.torsos.push(f.torso);
    this.hips.push(f.hip);
    if (this.ground.length > 20) { this.ground.shift(); this.torsos.shift(); this.hips.shift(); }
  }

  begin(t: number, fallback: { foot: number; torso: number; hip: number }) {
    this.base = this.ground.length >= 5 ? { foot: median(this.ground), torso: median(this.torsos), hip: median(this.hips) } : fallback;
    this.start = t;
  }

  /** Une image pendant l'essai. Renvoie le résultat dès qu'il est connu, sinon null. */
  push(f: JumpFrame): JumpResult | null {
    const r = this.step(f);
    return r && { ...r, info: `pieds +${Math.round(this.maxLift)} cm · hanches +${Math.round(this.maxRise)} cm · ${Math.round(this.frames / Math.max(0.5, (f.t - this.start) / 1000))} i/s` };
  }

  private step(f: JumpFrame): ({ cm: number; reason?: undefined } | { cm: null; reason: string }) | null {
    this.frames++;
    // médiane sur 3 images : une image où le suivi décroche ne fait pas un saut
    this.win.push(f);
    if (this.win.length > 3) this.win.shift();
    if (this.win.length < 3) return null;
    // valeur de l'image si elle colle à la médiane (pas de retard), sinon la médiane
    const clean = (k: "foot" | "hip" | "torso", tol: number) => { const md = median(this.win.map((x) => x[k])); return Math.abs(f[k] - md) < tol ? f[k] : md; };
    const tol = 30 * this.pxPerCm;
    const foot = clean("foot", tol), hip = clean("hip", tol), torso = clean("torso", tol);
    const t = f.t;
    const lift = (this.base.foot - foot) / this.pxPerCm;
    const prev = this.prev;
    this.prev = { t, lift, hip };
    this.maxLift = Math.max(this.maxLift, lift);
    this.maxRise = Math.max(this.maxRise, (this.base.hip - hip) / this.pxPerCm);
    // bras levés pendant le saut : les épaules montent, le buste « s'allonge » un peu ; seul un gros écart compte
    const scale = torso / this.base.torso;
    if (this.takeoff && (scale < 0.7 || scale > 1.4)) return { cm: null, reason: "Tu t'es rapproché ou éloigné du téléphone pendant le saut : saute bien sur place." };
    // instant où les pieds passent le seuil, interpolé entre deux images
    const cross = () => (prev ? prev.t + ((LIFT - prev.lift) / (lift - prev.lift || 1)) * (t - prev.t) : t);

    if (!this.takeoff) {
      if (prev && lift > LIFT && prev.lift <= LIFT) {
        this.takeoff = cross();
        this.hipTake = prev.hip + ((this.takeoff - prev.t) / (t - prev.t || 1)) * (hip - prev.hip);
      } else if (t - this.start > 4500) {
        // pieds mal suivis (hors du cadre ou cachés) mais hanches bien montées : mesure par les hanches
        // (debout → sommet, moins ~5 cm de montée sur la pointe des pieds avant le décollage)
        if (this.maxRise > 12 && this.maxRise < 100) return { cm: Math.round(this.maxRise - 5) };
        return { cm: null, reason: this.maxRise > 5 ? "Pieds non suivis : recule pour que tes pieds soient bien dans le cadre." : "Aucun saut détecté : saute juste après le signal, pieds bien visibles." };
      }
      return null;
    }
    this.minHip = Math.min(this.minHip, hip);
    if (lift < LIFT && prev && prev.lift >= LIFT) {
      const air = (cross() - this.takeoff) / 1000;
      if (air < 0.12) { this.takeoff = 0; this.minHip = Infinity; return null; } // simple tremblement
      // les pieds passent le seuil un peu après le décollage et un peu avant l'atterrissage : on rajoute ce temps
      const v0 = (G * air) / 2;
      const flight = air + (2 * LIFT) / 100 / v0;
      const cm = ((G * flight * flight) / 8) * 100;
      const hips = (this.hipTake - this.minHip) / this.pxPerCm;
      if (cm > 100 || flight > 0.95) return { cm: null, reason: "Mesure impossible (plus d'1 m) : le suivi a décroché. Recommence, bien éclairé et en entier dans le cadre." };
      if (hips > 3 && (hips / cm < 0.4 || hips / cm > 2.5)) return { cm: null, reason: "Mesure incohérente : reste en entier dans le cadre et saute sans avancer." };
      return { cm: Math.round(cm) };
    }
    if (t - this.takeoff > 1200) {
      const hips = (this.hipTake - this.minHip) / this.pxPerCm;
      if (hips > 8 && hips < 100) return { cm: Math.round(hips) }; // atterrissage manqué : la montée des hanches suffit
      return { cm: null, reason: "Atterrissage non vu : tes pieds doivent rester dans le cadre." };
    }
    return null;
  }
}

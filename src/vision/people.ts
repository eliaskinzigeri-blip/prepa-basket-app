// Shoot à plusieurs : suit chaque joueur dans le cadre, attribue chaque tir à celui qui a lâché le ballon,
// garde la photo de visage la plus nette de chacun, puis regroupe les morceaux de suivi d'une même personne.
// Logique pure (pas de caméra ici) : testée dans people.test.ts.
import type { FaceShot } from "./faces";

export interface Seen {
  /** Boîte du corps, en part de l'image (0–1). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Poignets visibles, en part de l'image. */
  wrists: { x: number; y: number }[];
  /** Couleurs des habits (histogramme normalisé), pour reconnaître le joueur quand il revient dans le cadre. */
  sig: number[] | null;
}

export interface Track {
  id: number;
  first: number;
  last: number;
  box: Seen["box"];
  sig: number[] | null;
  sigN: number;
  history: { t: number; wrists: Seen["wrists"]; box: Seen["box"] }[];
  faces: FaceShot[];
}

export interface Person {
  /** Morceaux de suivi regroupés. */
  tracks: number[];
  /** Index des tirs (dans l'ordre de la session). */
  shots: number[];
  face: FaceShot | null;
  descriptors: number[][];
}

const LOST_MS = 1500; // au-delà, un joueur sorti du cadre devient un nouveau morceau de suivi
const HISTORY_MS = 4000;
const SAME_FACE = 0.5; // distance entre signatures de visage : en dessous, même personne
const SAME_CLOTHES = 0.86;

const cx = (b: Seen["box"]) => (b.x0 + b.x1) / 2;
const cy = (b: Seen["box"]) => (b.y0 + b.y1) / 2;
const hgt = (b: Seen["box"]) => Math.max(0.05, b.y1 - b.y0);

export function faceDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}
/** Plus petite distance entre deux listes de signatures de visage. */
export function minFaceDistance(a: number[][], b: number[][]): number {
  let best = Infinity;
  for (const x of a) for (const y of b) best = Math.min(best, faceDistance(x, y));
  return best;
}
export function cosine(a: number[], b: number[]): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

export class PeopleTracker {
  tracks: Track[] = [];
  private nextId = 1;

  /** Joueurs vus à cette image (t en ms). Renvoie l'id du suivi de chacun, dans le même ordre. */
  update(t: number, seen: Seen[]): number[] {
    const alive = this.tracks.filter((k) => t - k.last < LOST_MS);
    // coût : distance des centres rapportée à la taille du joueur, plus la différence d'habits
    const pairs: { i: number; k: Track; c: number }[] = [];
    seen.forEach((s, i) => {
      for (const k of alive) {
        const d = Math.hypot(cx(s.box) - cx(k.box), cy(s.box) - cy(k.box)) / hgt(k.box);
        const dt = Math.max(1, (t - k.last) / 100);
        if (d > 0.6 * dt + 0.3) continue;
        const clothes = s.sig && k.sig ? 1 - cosine(s.sig, k.sig) : 0;
        pairs.push({ i, k, c: d + clothes * 2 });
      }
    });
    pairs.sort((a, b) => a.c - b.c);
    const out: number[] = new Array(seen.length).fill(0);
    const used = new Set<number>();
    for (const p of pairs) {
      if (out[p.i] || used.has(p.k.id)) continue;
      out[p.i] = p.k.id;
      used.add(p.k.id);
      this.touch(p.k, t, seen[p.i]);
    }
    seen.forEach((s, i) => {
      if (out[i]) return;
      const k: Track = { id: this.nextId++, first: t, last: t, box: s.box, sig: s.sig ? [...s.sig] : null, sigN: s.sig ? 1 : 0, history: [], faces: [] };
      this.touch(k, t, s);
      this.tracks.push(k);
      out[i] = k.id;
    });
    return out;
  }

  private touch(k: Track, t: number, s: Seen) {
    k.last = t;
    k.box = s.box;
    if (s.sig) {
      // moyenne glissante des couleurs : un reflet ou un bras devant le maillot ne change pas tout
      if (!k.sig) { k.sig = [...s.sig]; k.sigN = 1; }
      else { const w = Math.min(0.2, 1 / (k.sigN + 1)); k.sig = k.sig.map((v, j) => v * (1 - w) + s.sig![j] * w); k.sigN++; }
    }
    k.history.push({ t, wrists: s.wrists, box: s.box });
    while (k.history.length && t - k.history[0].t > HISTORY_MS) k.history.shift();
  }

  /** Photo de visage trouvée pour un suivi : on garde les plus nettes. */
  addFace(id: number, f: FaceShot) {
    const k = this.tracks.find((x) => x.id === id);
    if (!k) return;
    k.faces.push(f);
    k.faces.sort((a, b) => b.quality - a.quality);
    k.faces.length = Math.min(k.faces.length, 5);
  }

  /**
   * Qui a tiré ? Le joueur dont un poignet était le plus près du ballon au lâcher (t, x, y en part de l'image).
   * À défaut de poignet visible, celui dont le corps était le plus près. null si personne n'était dans le cadre.
   */
  shooterAt(t: number, x: number, y: number): number | null {
    let best: { id: number; d: number } | null = null;
    for (const k of this.tracks) {
      for (const h of k.history) {
        if (Math.abs(h.t - t) > 300) continue;
        const scale = hgt(h.box);
        const dw = h.wrists.length ? Math.min(...h.wrists.map((w) => Math.hypot(w.x - x, w.y - y))) / scale : Infinity;
        const inside = x >= h.box.x0 && x <= h.box.x1 && y >= h.box.y0 - 0.3 * scale && y <= h.box.y1;
        const db = inside ? 0.5 : 0.5 + Math.hypot(x - cx(h.box), y - cy(h.box)) / scale;
        const d = Math.min(dw, db) + Math.abs(h.t - t) / 3000;
        if (!best || d < best.d) best = { id: k.id, d };
      }
    }
    return best && best.d < 2 ? best.id : null;
  }

  /**
   * Regroupe les morceaux de suivi d'une même personne : même visage, ou mêmes habits sans jamais avoir été
   * dans le cadre en même temps. Ne garde que les personnes qui ont tiré (shotTracks : suivi de chaque tir).
   */
  people(shotTracks: (number | null)[]): Person[] {
    const parent = new Map<number, number>(this.tracks.map((k) => [k.id, k.id]));
    const find = (a: number): number => { while (parent.get(a) !== a) a = parent.get(a)!; return a; };
    const members = (root: number) => this.tracks.filter((k) => find(k.id) === root);
    const overlap = (a: Track[], b: Track[]) => a.some((x) => b.some((y) => x.first < y.last - 200 && y.first < x.last - 200));
    const faces = (g: Track[]) => g.flatMap((k) => k.faces.map((f) => f.descriptor));
    const sigOf = (g: Track[]) => {
      const withSig = g.filter((k) => k.sig);
      if (!withSig.length) return null;
      return withSig[0].sig!.map((_, j) => withSig.reduce((s, k) => s + k.sig![j] * k.sigN, 0) / withSig.reduce((s, k) => s + k.sigN, 0));
    };
    // 1) même visage (le plus sûr), 2) mêmes habits, en évitant deux personnes vues ensemble
    for (const pass of ["face", "clothes"] as const) {
      let merged = true;
      while (merged) {
        merged = false;
        const roots = [...new Set(this.tracks.map((k) => find(k.id)))];
        let best: { a: number; b: number; score: number } | null = null;
        for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
          const A = members(roots[i]), B = members(roots[j]);
          if (overlap(A, B)) continue;
          const fa = faces(A), fb = faces(B);
          let score = -Infinity;
          if (pass === "face") {
            if (fa.length && fb.length) { const d = minFaceDistance(fa, fb); if (d < SAME_FACE) score = 1 - d; }
          } else {
            // deux visages nets et différents : jamais la même personne, même avec des habits proches
            if (fa.length && fb.length && minFaceDistance(fa, fb) >= SAME_FACE) continue;
            const sa = sigOf(A), sb = sigOf(B);
            if (sa && sb) { const c = cosine(sa, sb); if (c >= SAME_CLOTHES) score = c; }
          }
          if (score > (best?.score ?? -Infinity)) best = { a: roots[i], b: roots[j], score };
        }
        if (best) { parent.set(find(best.b), find(best.a)); merged = true; }
      }
    }
    const byRoot = new Map<number, Person>();
    shotTracks.forEach((id, i) => {
      if (id == null || !parent.has(id)) return;
      const root = find(id);
      if (!byRoot.has(root)) {
        const g = members(root);
        const all = g.flatMap((k) => k.faces).sort((a, b) => b.quality - a.quality);
        byRoot.set(root, { tracks: g.map((k) => k.id), shots: [], face: all[0] ?? null, descriptors: all.slice(0, 5).map((f) => f.descriptor) });
      }
      byRoot.get(root)!.shots.push(i);
    });
    // tirs sans joueur repéré : rattachés à la personne qui a le plus tiré (souvent le seul joueur visible)
    const list = [...byRoot.values()].sort((a, b) => b.shots.length - a.shots.length);
    const orphans = shotTracks.map((id, i) => (id == null || !parent.has(id) ? i : -1)).filter((i) => i >= 0);
    if (orphans.length) {
      if (list.length) { list[0].shots.push(...orphans); list[0].shots.sort((a, b) => a - b); }
      else list.push({ tracks: [], shots: orphans, face: null, descriptors: [] });
    }
    return list;
  }
}

/** Couleurs des habits : histogramme de teinte (12 cases pondérées par la saturation) + clair / moyen / sombre. */
export function clothesSig(px: Uint8ClampedArray): number[] | null {
  const h = new Array(15).fill(0);
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    const sat = mx ? c / mx : 0;
    if (sat > 0.25 && mx > 0.15) {
      let hue = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      if (hue < 0) hue += 6;
      h[Math.floor((hue / 6) * 12) % 12] += sat;
    } else h[12 + (mx > 0.66 ? 0 : mx > 0.3 ? 1 : 2)] += 0.6;
    n++;
  }
  return n ? h.map((v) => v / n) : null;
}

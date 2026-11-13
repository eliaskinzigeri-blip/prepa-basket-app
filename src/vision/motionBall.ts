// Suivi du ballon en vol par le mouvement, sans sa couleur : téléphone posé, seul ce qui bouge se détache du décor.
// Marche avec un ballon gris ou terne, tant qu'il est le seul petit objet rond qui se déplace. Fait pour le shoot.

export interface MotionHit { x: number; y: number; r: number }

const LEARN = 12; // images pour apprendre le décor
const BALL_TO_RIM = 2.4; // cercle / tache du ballon telle que détectée, un peu plus petite que le vrai ballon
const DIFF = 54; // écart minimal avec le décor (somme des écarts R + V + B)

interface Track extends MotionHit { t: number; vx: number; vy: number; len: number; id: number }

export class MotionBall {
  private bg: Float32Array | null = null;
  private frames = 0;
  private width = 1;
  private tracks: Track[] = [];
  private nextId = 0;
  private current = 0;
  /** Cercle du panier (x, y en part de l'image, r en part de la largeur) : pour savoir si le filet bouge. */
  rim: { x: number; y: number; r: number } | null = null;
  /** Part des pixels du filet qui bougent à la dernière image. */
  net = 0;
  /** Tous les objets ronds en mouvement à la dernière image (plusieurs ballons possibles), coordonnées de l'image. */
  live: (MotionHit & { id: number })[] = [];
  /** Le cercle réglé à la main est souvent imprécis : la taille cherchée n'en dépend que dans des limites raisonnables. */
  setRim(x: number, y: number, r: number) {
    this.rim = { x, y, r };
    this.rimR = r;
  }
  private rimR = 0;
  private sizes: number[] = []; // tailles du ballon vu en vol, en part de la largeur

  /** Nouvelle image : renvoie le ballon s'il est en mouvement, dans les coordonnées de l'image. */
  push(img: ImageData, t: number): MotionHit | null {
    this.live = [];
    const { width: W, height: H, data: d } = img;
    this.width = W;
    const N = W * H;
    if (!this.bg || this.bg.length !== N * 3) { this.bg = new Float32Array(N * 3); this.frames = 0; }
    const bg = this.bg;
    if (this.frames < LEARN) {
      const a = 1 / (this.frames + 1);
      for (let p = 0, i = 0; p < N; p++, i += 4) for (let c = 0; c < 3; c++) bg[p * 3 + c] += (d[i + c] - bg[p * 3 + c]) * a;
      this.frames++;
      return null;
    }
    const raw = new Uint8Array(N);
    let moved = 0;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      const q = p * 3;
      const e = Math.abs(d[i] - bg[q]) + Math.abs(d[i + 1] - bg[q + 1]) + Math.abs(d[i + 2] - bg[q + 2]);
      const on = e > DIFF;
      if (on) { raw[p] = 1; moved++; }
      // le décor suit la lumière. Ce qui reste différent plus d'une seconde finit absorbé (exposition qui change, objet posé) ;
      // un ballon en vol ne reste jamais assez longtemps sur un même pixel pour l'être.
      const k = on ? 0.03 : 0.04;
      bg[q] += (d[i] - bg[q]) * k; bg[q + 1] += (d[i + 1] - bg[q + 1]) * k; bg[q + 2] += (d[i + 2] - bg[q + 2]) * k;
    }
    this.net = this.rim ? netShare(raw, W, H, this.rim, this.netRadius()) : 0;
    // presque toute l'image a changé : le téléphone a bougé, on réapprend le décor
    // quelque chose de grand bouge (le joueur tout près du téléphone) : ce n'est pas le moment de chercher un ballon
    if (moved > N * 0.1 && moved <= N * 0.25) { this.tracks = []; return null; }
    if (moved > N * 0.25) { this.frames = 0; this.tracks = []; return null; }
    return this.pick(components(open(raw, W, H), W, H, this.searchSize(W)), t, H);
  }

  /**
   * La main du joueur bouge en même temps que le ballon : chaque objet a sa propre piste, pour qu'elle ne vole pas la sienne.
   * On garde la piste suivie tant qu'elle vit, et on n'en change que pour un objet nettement plus haut.
   */
  /** Rayons possibles du ballon : assez de marge pour un cercle mal réglé, sans laisser passer un corps entier. */
  private searchSize(W: number): [number, number] {
    if (!this.rimR) return [W * 0.008, W * 0.08];
    return [W * 0.006, W * Math.min(0.05, Math.max(0.035, this.rimR * 0.9))];
  }

  /** Rayon du cercle pour regarder le filet (part de la largeur) : d'après le ballon mesuré, s'il est plus petit que le réglage. */
  private netRadius() {
    if (this.sizes.length < 10) return this.rimR;
    const s = [...this.sizes].sort((a, b) => a - b);
    return Math.min(this.rimR, s[s.length >> 1] * BALL_TO_RIM);
  }

  private pick(list: MotionHit[], t: number, H: number): MotionHit | null {
    const free = new Set(list);
    this.tracks = this.tracks.filter((k) => t - k.t < 300);
    // les pistes les plus longues choisissent d'abord
    for (const k of [...this.tracks].sort((x, y) => y.len - x.len)) {
      const dt = t - k.t;
      if (dt <= 0) continue;
      const px = k.x + k.vx * dt, py = k.y + k.vy * dt;
      let best: MotionHit | null = null, bd = k.r * 3 + Math.hypot(k.vx, k.vy) * dt * 0.8;
      for (const c of free) {
        const dist = Math.hypot(c.x - px, c.y - py);
        if (dist < bd) { bd = dist; best = c; }
      }
      if (!best) continue;
      free.delete(best);
      const first = k.len === 1;
      const vx = (best.x - k.x) / dt, vy = (best.y - k.y) / dt;
      k.vx = first ? vx : 0.5 * k.vx + 0.5 * vx;
      k.vy = first ? vy : 0.5 * k.vy + 0.5 * vy;
      k.x = best.x; k.y = best.y; k.r = best.r; k.t = t; k.len++;
    }
    for (const c of free) this.tracks.push({ ...c, t, vx: 0, vy: 0, len: 1, id: ++this.nextId });
    // une piste doit avoir duré et s'être déplacée avant d'y croire
    const live = this.tracks.filter((k) => k.t === t && k.len >= 3 && Math.hypot(k.vx, k.vy) >= (k.r / 33) * 0.25);
    // à plusieurs : tous les objets en mouvement, chacun avec sa piste (le choix d'un seul ballon ci-dessous reste celui du solo)
    this.live = live.map((k) => ({ id: k.id, x: k.x, y: k.y, r: k.r }));
    const cur = this.tracks.find((k) => k.id === this.current && t - k.t < 150);
    // le ballon qui retombe passe sous la main du joueur : on ne le lâche pas pour elle
    const falling = cur && cur.vy > 0;
    let top: Track | null = cur && live.includes(cur) ? cur : null;
    for (const k of live) {
      if (k === top) continue;
      // en l'air, le ballon est plus haut que tout ce qui bouge d'autre
      const faster = top && Math.hypot(k.vx, k.vy) > Math.hypot(top.vx, top.vy);
      if (!top ? !cur : (!falling || faster) && k.y < top.y - H * 0.15) top = k;
    }
    if (top) this.current = top.id;
    if (!top) return null;
    this.sizes.push(top.r / this.width);
    if (this.sizes.length > 60) this.sizes.shift();
    return { x: top.x, y: top.y, r: top.r };
  }
}

/** Sous le cercle, là où pend le filet. */
function netShare(mask: Uint8Array, W: number, H: number, rim: { x: number; y: number }, radius: number) {
  const r = radius * W, cx = rim.x * W, cy = rim.y * H;
  let hit = 0, n = 0;
  for (let y = Math.max(0, Math.round(cy + r * 0.2)); y <= Math.min(H - 1, Math.round(cy + r * 1.3)); y++) {
    for (let x = Math.max(0, Math.round(cx - r * 0.7)); x <= Math.min(W - 1, Math.round(cx + r * 0.7)); x++) { hit += mask[y * W + x]; n++; }
  }
  return n ? hit / n : 0;
}

/** Efface ce qui est trop fin pour être un ballon (bruit, feuilles, bords). */
function open(m: Uint8Array, W: number, H: number) {
  const pass = (src: Uint8Array, all: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        const n = src[p] + src[p - 1] + src[p + 1] + src[p - W] + src[p + W];
        out[p] = all ? (n === 5 ? 1 : 0) : n > 0 ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(m, true), false);
}

/** Taches de la bonne taille et de forme ronde, de la plus ronde à la moins ronde. */
function components(mask: Uint8Array, W: number, H: number, size: [number, number]): MotionHit[] {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const out: (MotionHit & { fill: number })[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let area = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < mask.length && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const r = Math.sqrt(area / Math.PI);
    if (r < size[0] || r > size[1]) continue;
    if (Math.max(w, h) / Math.min(w, h) > 2) continue; // un bras, une jambe
    const fill = area / (w * h);
    if (fill < 0.55) continue; // un disque remplit 78 % de son cadre
    out.push({ x: sx / area, y: sy / area, r, fill });
  }
  return out.sort((a, b) => b.fill - a.fill);
}

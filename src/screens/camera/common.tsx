import { useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";

export const WARMUP_ITEMS = ["2 min de footing ou corde à sauter", "Montées de genoux, talons-fesses, pas chassés", "Mobilité chevilles, genoux, hanches", "3 accélérations ou sauts progressifs"];

/** Échauffement obligatoire avant chaque séance et avant les tests sprint / détente (PRD : sécurité). */
export function WarmupGate({ onDone, children }: { onDone: () => void; children?: ReactNode }) {
  const [c, setC] = useState(WARMUP_ITEMS.map(() => false));
  return (
    <div className="col">
      <span className="lbl">Échauffement obligatoire</span>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {WARMUP_ITEMS.map((w, i) => (
          <button key={w} className="pb-li" aria-pressed={c[i]} onClick={() => setC((x) => x.map((v, k) => (k === i ? !v : v)))}>
            <span className={`check-row${c[i] ? " ok" : ""}`}><span className="dotc">{c[i] ? <Icon name="check" size="sm" /> : null}</span></span>
            <span className="t">{w}</span>
          </button>
        ))}
      </div>
      {children}
      <button className="pb-btn primary lg block" disabled={!c.every(Boolean)} onClick={onDone}>Échauffement fait</button>
    </div>
  );
}

export function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className={`check-row${ok ? " ok" : ""}`} role="status">
      <span className="dotc">{ok ? <Icon name="check" size="sm" /> : <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}</span>
      <span>{label}{!ok && hint ? <span className="pb-muted"> · {hint}</span> : null}</span>
    </div>
  );
}

/** Correspondance coordonnées vidéo normalisées → pixels écran (object-fit: cover, miroir éventuel). */
export function makeMapper(video: HTMLVideoElement, W: number, H: number, mirror: boolean) {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return {
    x: (nx: number) => { const px = ox + nx * vw * s; return mirror ? W - px : px; },
    y: (ny: number) => oy + ny * vh * s,
    len: (n: number) => n * vw * s,
    // inverse (pour les zones tapées à l'écran)
    nx: (px: number) => ((mirror ? W - px : px) - ox) / (vw * s),
    ny: (py: number) => (py - oy) / (vh * s),
  };
}
export type Mapper = ReturnType<typeof makeMapper>;

// L'échauffement reste valable 90 min (enchaînement de plusieurs jeux dans la même séance).
const WARM_KEY = "pb.warmedAt";
export function warmedRecently(): boolean {
  try { return Date.now() - Number(sessionStorage.getItem(WARM_KEY) ?? 0) < 90 * 60 * 1000; } catch { return false; }
}
export function markWarmed() {
  try { sessionStorage.setItem(WARM_KEY, String(Date.now())); } catch { /* stockage bloqué */ }
}

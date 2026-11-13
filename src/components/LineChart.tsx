import { memo } from "react";
import { num } from "../lib/format";

interface Point { label: string; value: number | null }

/** Courbe d'évolution (design system : trait primary-bright, dernier point mis en avant). */
export const LineChart = memo(function LineChart({ points, unit, digits = 0, ariaLabel }: { points: Point[]; unit: string; digits?: number; ariaLabel: string }) {
  const W = 320, H = 150, L = 34, R = 14, T = 20, B = 22;
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (vals.length === 0) return <p className="pb-muted" style={{ margin: "16px 0", fontSize: 14 }}>Pas encore de mesure sur cette période.</p>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15;
  lo -= pad; hi += pad;
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = points.map((p, i) => (p.value == null ? null : ([x(i), y(p.value)] as const))).filter(Boolean) as (readonly [number, number])[];
  const line = pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");
  const last = pts.at(-1)!;
  const lastVal = vals.at(-1)!;
  const grid = [hi - pad, (hi + lo) / 2, lo + pad];
  const every = Math.max(1, Math.ceil(points.length / 6));
  const tip = `${num(lastVal, digits)}${unit === "%" ? " %" : ` ${unit}`}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: "100%", display: "block", marginTop: 10 }} role="img" aria-label={`${ariaLabel} : dernière valeur ${tip}`}>
      <g stroke="rgba(255,255,255,.08)">{grid.map((g) => <path key={g} d={`M${L} ${y(g).toFixed(1)}H${W}`} />)}</g>
      <g fontSize="10" fill="#8592b8">
        {grid.map((g) => <text key={g} x="0" y={y(g) + 3}>{num(g, digits)}</text>)}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1 ? <text key={i} x={x(i)} y={H - 4} textAnchor="middle">{p.label}</text> : null))}
      </g>
      {pts.length > 1 ? <path d={`${line}V${H - B}H${pts[0][0].toFixed(1)}Z`} fill="rgba(140,123,255,.15)" /> : null}
      <path d={line} fill="none" stroke="var(--primary-bright)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <g fill="var(--primary-bright)">{pts.slice(0, -1).map(([a, b], i) => <circle key={i} cx={a} cy={b} r="3.5" />)}</g>
      <circle cx={last[0]} cy={last[1]} r="6" fill="#fff" stroke="var(--primary-bright)" strokeWidth="3" />
      <g transform={`translate(${Math.min(W - 66, Math.max(L, last[0] - 31))} ${Math.max(0, last[1] - 34)})`}>
        <rect width="62" height="22" rx="11" fill="#fff" />
        <text x="31" y="15" textAnchor="middle" fontFamily="Inter Display" fontWeight="600" fontSize="12" fill="#081233">{tip}</text>
      </g>
    </svg>
  );
});

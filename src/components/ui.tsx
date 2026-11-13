import { memo, useEffect, useRef, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import { num } from "../lib/format";

export function IconButton({ icon, label, onClick, small, dot, style }: { icon: IconName; label: string; onClick?: () => void; small?: boolean; dot?: boolean; style?: React.CSSProperties }) {
  return (
    <button type="button" className={`pb-icon-btn${small ? " sm" : ""}`} aria-label={label} onClick={onClick} style={style}>
      <Icon name={icon} />
      {dot ? <span className="dot" /> : null}
    </button>
  );
}

export function BackButton({ to, label = "Retour" }: { to?: string; label?: string }) {
  const nav = useNavigate();
  return <IconButton icon="left" label={label} small onClick={() => (to ? nav(to) : nav(-1))} />;
}

export function Chip({ active, soft, onClick, children, swatch, icon, disabled, pressed }: {
  active?: boolean; soft?: boolean; onClick?: () => void; children: ReactNode; swatch?: string; icon?: IconName; disabled?: boolean; pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pb-chip${active ? " active" : ""}${soft ? " soft" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed ?? (onClick ? Boolean(active || soft) : undefined)}
    >
      {swatch ? <span className="sw" style={{ background: swatch }} /> : null}
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </button>
  );
}

export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div className="pb-steps" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} aria-label={`Étape ${current} sur ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i + 1 < current ? "on" : i + 1 === current ? "cur" : ""} />
      ))}
    </div>
  );
}

export function Stepper({ value, unit, step = 1, min = 0, max = 999, digits = 0, onChange, label }: {
  value: number; unit: string; step?: number; min?: number; max?: number; digits?: number; onChange: (v: number) => void; label: string;
}) {
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100);
  return (
    <div className="pb-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`${label} : moins ${num(step, digits)}`} onClick={() => set(value - step)}>−</button>
      <output aria-live="polite">{num(value, digits)}<small>{unit}</small></output>
      <button type="button" className="plus" aria-label={`${label} : plus ${num(step, digits)}`} onClick={() => set(value + step)}>+</button>
    </div>
  );
}

/** Variation : la couleur suit le progrès, pas le signe ; toujours avec la flèche. */
export function Delta({ diff, better = "higher", digits = 0, unit = "" }: { diff: number | null; better?: "higher" | "lower"; digits?: number; unit?: string }) {
  if (diff == null || Math.abs(diff) < Math.pow(10, -digits) / 2) return null;
  const progress = better === "higher" ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? "▲" : "▼";
  return (
    <span className={`pb-delta ${progress ? "up" : "down"}`}>
      <span aria-hidden="true">{arrow}</span>
      <span className="sr-only">{progress ? "progrès de" : "recul de"}</span> {num(Math.abs(diff), digits)}{unit ? ` ${unit}` : ""}
    </span>
  );
}

export function Stat({ k, v, unit, delta, center, style }: { k: string; v: ReactNode; unit?: string; delta?: ReactNode; center?: boolean; style?: React.CSSProperties }) {
  return (
    <div className="pb-glass pb-stat" style={{ padding: 12, textAlign: center ? "center" : undefined, ...style }}>
      <span className="k">{k}</span>
      <span className="v" style={{ fontSize: 22 }}>{v}{unit ? <small>{unit}</small> : null}</span>
      {delta}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pb-toggle${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

const TABS: { to: string; icon: IconName; label: string }[] = [
  { to: "/", icon: "home", label: "Accueil" },
  { to: "/calendrier", icon: "cal", label: "Calendrier" },
  { to: "/nutrition", icon: "food", label: "Nutrition" },
  { to: "/progres", icon: "chart", label: "Progrès" },
  { to: "/profil", icon: "user", label: "Profil" },
];

export const BottomNav = memo(function BottomNav() {
  return (
    <div className="navwrap">
      <nav className="pb-nav" aria-label="Navigation principale">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => (isActive ? "on" : "")} aria-label={t.label}>
            {({ isActive }) => (
              <>
                <Icon name={t.icon} size={isActive ? "sm" : undefined} />
                {isActive ? <span>{t.label}</span> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
});

export function BottomAction({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="fade" aria-hidden="true" />
      <div className="bottom-action">{children}</div>
    </>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "error" ? "info" : tone === "ok" ? "check" : "info"} size="sm" />
      <span>{children}</span>
    </div>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="pb-muted">{label}</span>
    </div>
  );
}

export const CAT_COLOR: Record<string, string> = {
  workout: "var(--cat-workout)", basket: "var(--cat-basket)", club: "var(--cat-club)", match: "var(--cat-match)",
  rest: "var(--cat-rest)", test: "var(--primary-bright)", class: "rgba(255,255,255,.25)",
};

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Focus dans la feuille à l'ouverture, retour au déclencheur à la fermeture, Échap pour fermer.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className="sheet pb-glass" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3 className="s">{title}</h3>
          <IconButton icon="x" label="Fermer" small onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

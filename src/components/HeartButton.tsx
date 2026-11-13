// Connexion de la ceinture cardio, réutilisable (détail de séance, test de FC au repos, réglages).
import { useState, useSyncExternalStore } from "react";
import { Icon } from "./Icon";
import { heart, heartErrorText, HeartError } from "../lib/heart";

export function useHeart() {
  return useSyncExternalStore((f) => heart.subscribe(f), () => `${heart.state}|${heart.bpm}`);
}

export function HeartButton({ block = false, hint }: { block?: boolean; hint?: string }) {
  useHeart();
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setError(null);
    try { await heart.connect(); } catch (e) { setError(heartErrorText((e as HeartError).code ?? "failed")); }
  }
  const connected = heart.state === "connected";
  return (
    <div className="col" style={{ gap: 6 }}>
      {connected ? (
        <div className={`pb-btn${block ? " block" : ""}`} role="status" aria-live="polite" style={{ cursor: "default", color: "var(--cat-match)" }}>
          <Icon name="heart" size="sm" /><span className="pb-num">{heart.bpm || "–"}</span><span className="pb-muted" style={{ fontWeight: 500 }}>bpm · {heart.name}</span>
        </div>
      ) : (
        <button className={`pb-btn${block ? " block" : ""}`} onClick={connect} disabled={heart.state === "searching"}>
          <Icon name="heart" size="sm" />{heart.state === "searching" ? "Connexion…" : heart.knownName() ? `Connecter ${heart.knownName()}` : "Connecter ma ceinture cardio"}
        </button>
      )}
      {error ? <p className="pb-subtle" role="alert" style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>{error}</p>
        : !connected && hint ? <p className="pb-subtle" style={{ margin: 0, fontSize: 13 }}>{hint}</p> : null}
    </div>
  );
}

import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Notice } from "../components/ui";

export function Splash({ welcome, error, onRetry }: { welcome?: boolean; error?: string; onRetry?: () => void }) {
  return (
    <main className="pb-page screen no-nav" style={{ display: "grid", alignContent: "center", justifyItems: "center", textAlign: "center", gap: 18 }}>
      <div style={{ width: 96, height: 96, borderRadius: 30, display: "grid", placeItems: "center", background: "var(--primary)", boxShadow: "var(--shadow-glow), var(--shadow-inner)" }}>
        <Icon name="ball" size="lg" style={{ width: 46, height: 46 }} />
      </div>
      <h1 style={{ margin: 0, font: "700 34px/40px var(--font-display)", letterSpacing: "-.02em" }}>Prépa Basket</h1>
      {welcome ? (
        <>
          <p className="lead" style={{ maxWidth: 300 }}>Ton programme physique et basket, placé dans ta semaine et mesuré par la caméra.</p>
          <div className="bottom-action" style={{ flexDirection: "column" }}>
            <Link className="pb-btn primary lg block" to="/inscription">Créer mon compte</Link>
            <Link className="pb-btn lg block" to="/connexion">J'ai déjà un compte</Link>
          </div>
        </>
      ) : error ? (
        <div className="col" style={{ width: "100%", maxWidth: 360 }}>
          <Notice tone="error">{error}</Notice>
          {onRetry ? <button className="pb-btn primary lg" onClick={onRetry}>Réessayer</button> : null}
        </div>
      ) : (
        <span className="spinner" role="status" aria-label="Chargement" />
      )}
    </main>
  );
}

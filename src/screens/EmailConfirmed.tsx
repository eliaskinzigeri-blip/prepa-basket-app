import { Link } from "react-router-dom";
import { AUTH_HASH } from "../lib/supabase";

// Page d'arrivée du lien reçu par email. Supabase ajoute « #error=… » quand le lien
// est expiré ou déjà utilisé ; sinon la session est déjà ouverte par supabase-js.
const params = new URLSearchParams(AUTH_HASH.replace(/^#/, ""));
const failure = params.get("error_code") ?? params.get("error");

export function EmailConfirmed({ signedIn }: { signedIn: boolean }) {
  const ok = !failure;
  return (
    <main className="pb-page screen no-nav confirm" style={{ display: "grid", alignContent: "center", justifyItems: "center", textAlign: "center", gap: 18 }}>
      <div className={`confirm-badge ${ok ? "ok" : "ko"}`} aria-hidden="true">
        <svg viewBox="0 0 52 52" width="64" height="64">
          {ok ? <path className="confirm-tick" d="M14 27l8 8 16-17" /> : <path className="confirm-tick" d="M26 14v15M26 37v1" />}
        </svg>
      </div>
      <h1 className="t" style={{ margin: 0 }}>{ok ? "Email confirmé" : "Lien plus valable"}</h1>
      <p className="lead" style={{ maxWidth: 300, margin: 0 }}>
        {ok
          ? "Ton compte est activé. Il reste à répondre à quelques questions pour construire ton programme."
          : failure === "otp_expired"
            ? "Ce lien a expiré ou a déjà servi. Si tu l'as déjà ouvert, ton compte est sans doute actif : connecte-toi."
            : "Ce lien n'a pas pu être vérifié. Connecte-toi, ou recrée ton compte pour recevoir un nouveau lien."}
      </p>
      <div className="bottom-action" style={{ flexDirection: "column" }}>
        {ok && signedIn ? (
          <Link className="pb-btn primary lg block" to="/" replace>Construire mon programme</Link>
        ) : (
          <Link className="pb-btn primary lg block" to="/connexion" replace>Me connecter</Link>
        )}
      </div>
    </main>
  );
}

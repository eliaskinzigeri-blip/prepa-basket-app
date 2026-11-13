import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { BackButton, Notice } from "../components/ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function frenchError(msg: string): string {
  if (/already registered|already exists/i.test(msg)) return "Un compte existe déjà avec cet email. Connecte-toi.";
  if (/invalid login credentials/i.test(msg)) return "Email ou mot de passe incorrect.";
  if (/email not confirmed/i.test(msg)) return "Confirme ton email avec le lien reçu, puis connecte-toi.";
  if (/email address .* is invalid/i.test(msg)) return "Cette adresse email n'est pas acceptée. Utilise une autre adresse.";
  if (/rate limit/i.test(msg)) return "Trop de tentatives. Attends une minute et réessaie.";
  if (/provider is not enabled|unsupported provider/i.test(msg)) return "Cette connexion n'est pas encore activée. Utilise ton email.";
  if (/fetch|network/i.test(msg)) return "Pas de connexion internet. Vérifie ton réseau et réessaie.";
  return "L'inscription a échoué. Vérifie tes informations et réessaie.";
}

export function Auth({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const signup = mode === "signup";

  const emailErr = touched && !EMAIL.test(email) ? "Saisis un email valide, par exemple prenom@mail.fr." : null;
  const pwdErr = touched && password.length < 8 ? "Le mot de passe doit faire au moins 8 caractères." : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL.test(email)) return document.getElementById("email")?.focus();
    if (password.length < 8) return document.getElementById("pwd")?.focus();
    setBusy(true);
    setError(null);
    const { data, error } = signup
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/email-confirme` } })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(frenchError(error.message));
    if (signup && !data.session) setSent(true);
  }

  async function oauth(provider: "google" | "apple") {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    if (error) setError(frenchError(error.message));
  }

  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton to="/" /></div>
      <h1 className="t" style={{ margin: "20px 0 6px" }}>{signup ? "Crée ton compte" : "Content de te revoir"}</h1>
      <p className="lead" style={{ marginBottom: 24 }}>{signup ? "Ton programme est prêt en moins de 3 minutes." : "Connecte-toi pour retrouver ton programme."}</p>

      {sent ? (
        <Notice tone="ok">Compte créé. Ouvre le lien envoyé à {email} pour l'activer, puis reviens ici.</Notice>
      ) : (
        <>
          <div className="col">
            <button type="button" className="pb-btn lg block" onClick={() => oauth("apple")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4 1-1.4 1.3-2.7 1.4-2.8-.1 0-2.6-1-2.6-4.2zM13.9 5c.7-.8 1.1-1.9 1-3-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.9-1.4z" /></svg>
              Continuer avec Apple
            </button>
            <button type="button" className="pb-btn lg block" onClick={() => oauth("google")}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" /><path fill="#fff" opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" /><path fill="#fff" opacity=".6" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z" /><path fill="#fff" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" /></svg>
              Continuer avec Google
            </button>
          </div>
          <div className="row" style={{ margin: "22px 0", color: "var(--ink-subtle)", fontSize: 13 }}>
            <span style={{ flex: 1, height: 1, background: "var(--stroke-100)" }} />ou avec ton email<span style={{ flex: 1, height: 1, background: "var(--stroke-100)" }} />
          </div>
          <form className="col" onSubmit={submit} noValidate>
            <div className="field">
              <label className="lbl" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" inputMode="email" spellCheck={false} value={email}
                onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(emailErr)} aria-describedby="email-err" placeholder="prenom@mail.fr…" />
              {emailErr ? <p id="email-err" className="err">{emailErr}</p> : null}
            </div>
            <div className="field">
              <label className="lbl" htmlFor="pwd">Mot de passe</label>
              <input id="pwd" className="input" type="password" autoComplete={signup ? "new-password" : "current-password"} value={password}
                onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(pwdErr)} aria-describedby="pwd-err" placeholder="8 caractères minimum…" />
              {pwdErr ? <p id="pwd-err" className="err">{pwdErr}</p> : null}
            </div>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <button className="pb-btn primary lg block" type="submit" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? "Un instant…" : signup ? "Créer mon compte" : "Me connecter"}
            </button>
          </form>
          <p style={{ textAlign: "center", marginTop: 16 }} className="pb-muted">
            {signup ? "Déjà inscrit ? " : "Pas encore de compte ? "}
            <Link className="link" to={signup ? "/connexion" : "/inscription"}>{signup ? "Me connecter" : "Créer un compte"}</Link>
          </p>
        </>
      )}
    </main>
  );
}

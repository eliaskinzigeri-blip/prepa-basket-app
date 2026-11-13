import { Component, type ReactNode } from "react";

// Filet de sécurité : si un écran plante (ou qu'un morceau de l'app n'a pas pu se charger après une mise à jour),
// on affiche un message avec un bouton au lieu d'un écran vide.
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    // changer d'écran efface l'erreur
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    // fichier d'une ancienne version introuvable : un rechargement récupère la nouvelle
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(this.state.error.message);
    return (
      <main className="pb-page screen" style={{ display: "grid", alignContent: "center", gap: 14, textAlign: "center" }}>
        <h1 className="t" style={{ fontSize: 22 }}>{stale ? "Nouvelle version disponible" : "Cet écran n'a pas pu s'afficher"}</h1>
        <p className="lead">{stale ? "Recharge l'app pour l'utiliser." : "Réessaie. Si ça recommence, reviens à l'accueil."}</p>
        <button className="pb-btn primary lg block" onClick={() => (stale ? window.location.reload() : this.setState({ error: null }))}>{stale ? "Recharger" : "Réessayer"}</button>
        {!stale ? <button className="pb-btn lg block" onClick={() => window.location.assign("/")}>Retour à l'accueil</button> : null}
      </main>
    );
  }
}

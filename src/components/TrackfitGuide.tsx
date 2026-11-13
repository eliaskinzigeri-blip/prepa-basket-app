import { useState } from "react";
import { Icon } from "./Icon";
import { TRACKFIT_URL } from "../lib/supabase";

// La balance FitTrack n'a pas d'API publique : ses pesées passent par Apple Santé,
// qu'un Raccourci iPhone relit puis envoie à Prépa Basket à chaque fermeture de l'app FitTrack.
export function TrackfitGuide({ token }: { token: string }) {
  const url = `${TRACKFIT_URL}?token=${token}`;
  const [copied, setCopied] = useState(false);
  const [os, setOs] = useState<"ios" | "android">(/android/i.test(navigator.userAgent) ? "android" : "ios");

  return (
    <div className="col">
      <span className="lbl">Ton lien personnel</span>
      <code style={{ fontSize: 12, wordBreak: "break-all", padding: 12, borderRadius: 12, background: "var(--glass-200)" }} translate="no">{url}</code>
      <button className="pb-btn" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
        <Icon name={copied ? "check" : "edit"} size="sm" />{copied ? "Lien copié" : "Copier le lien"}
      </button>

      <div className="pb-chips" role="tablist" aria-label="Téléphone">
        <button role="tab" aria-selected={os === "ios"} className={`pb-chip${os === "ios" ? " active" : ""}`} onClick={() => setOs("ios")}>iPhone</button>
        <button role="tab" aria-selected={os === "android"} className={`pb-chip${os === "android" ? " active" : ""}`} onClick={() => setOs("android")}>Android</button>
      </div>

      {os === "ios" ? (
        <ol className="pb-glass" style={{ margin: 0, padding: "14px 16px 14px 34px", display: "grid", gap: 10, fontSize: 14, lineHeight: "21px" }}>
          <li>Dans l'app <b translate="no">FitTrack</b> : Profil › Connected Apps › Apple Santé. Autorise le poids, la masse grasse, la masse maigre et la fréquence cardiaque au repos.</li>
          <li>Ouvre l'app <b>Raccourcis</b> › Automatisation › Nouvelle automatisation › <b>App</b>. Choisis <span translate="no">FitTrack</span>, coche « Est fermée » et « Exécuter immédiatement ».</li>
          <li>Ajoute 4 actions <b>Rechercher des échantillons de santé</b> : Poids, Masse grasse, Masse maigre, Fréquence cardiaque au repos. Pour chacune : trier par date de début, plus récent d'abord, limite 1.</li>
          <li>Ajoute <b>Obtenir le contenu de l'URL</b> : colle ton lien, méthode POST, corps de requête JSON avec les clés <code translate="no">weight_kg</code>, <code translate="no">fat_pct</code>, <code translate="no">muscle_kg</code>, <code translate="no">rhr</code> (chacune = l'échantillon correspondant) et <code translate="no">measured_at</code> = date de début du poids.</li>
          <li>Pèse-toi, ferme l'app FitTrack : la pesée arrive ici en quelques secondes.</li>
        </ol>
      ) : (
        <div className="pb-glass" style={{ padding: 14, fontSize: 14, lineHeight: "21px" }}>
          <p style={{ margin: "0 0 8px" }}>Sur Android, FitTrack envoie tes pesées vers Health Connect ou Samsung Health, qui ne sont pas lisibles depuis une app web.</p>
          <p style={{ margin: 0 }}>Une application d'automatisation (Tasker, MacroDroid) peut envoyer la pesée à ton lien avec les mêmes clés que sur iPhone. Sinon, saisis ton poids à la main dans Progrès › Mesures.</p>
        </div>
      )}
      <p className="pb-subtle" style={{ fontSize: 12, margin: 0 }}>Format accepté : JSON, nombres avec virgule ou point, unités tolérées (« 72,4 kg »). Les envois en double sont ignorés.</p>
    </div>
  );
}

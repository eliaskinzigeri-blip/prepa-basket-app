import { Link, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useApp } from "../state/app";
import { ExerciseAnim } from "../components/ExerciseAnim";
import { BackButton, Notice } from "../components/ui";
import { alternatives, dose, exercise } from "../lib/exercises";
import { HOME_EQUIPMENT } from "../data/catalog";
// Consignes (≈ 100 Ko) : importées ici, elles ne partent qu'avec cet écran chargé à la demande.
import STEPS from "../data/exercise-steps.json";

const EQ_LABEL: Record<string, string> = { machines: "Machine", barre: "Barre", ...Object.fromEntries(HOME_EQUIPMENT.map((e) => [e.id, e.label])) };

export default function ExerciseDetail() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const { profile } = useApp();
  const ex = exercise(id ?? "");
  if (!ex) return <main className="pb-page screen no-nav"><div className="hdr"><BackButton /></div><Notice>Exercice introuvable.</Notice></main>;
  const alts = alternatives(ex, qs.get("lieu"), profile!);
  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton /></div>
      <div className="pb-glass hero" style={{ height: 220, position: "relative", overflow: "hidden", marginTop: 8, background: "radial-gradient(70% 70% at 50% 60%, rgba(122,99,255,.35), transparent 70%),var(--glass-100)" }}>
        <ExerciseAnim pattern={ex.pattern} photo={ex.photo} name={ex.name} anim={ex.anim} video={ex.video} />
      </div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>{ex.name}</h1>
      <div className="wrap"><span className="pill-sm">{ex.muscles}</span><span className="pill-sm">{dose(ex)}</span><span className="pill-sm">Repos {ex.rest} s</span>
        {ex.equipment.map((e) => <span key={e} className="pill-sm">{EQ_LABEL[e] ?? e}</span>)}</div>
      <div className="lbl section">Consignes</div>
      <ol className="pb-glass" style={{ margin: 0, padding: "14px 16px 14px 34px", display: "grid", gap: 8, fontSize: 15, lineHeight: "22px" }}>
        {((STEPS as Record<string, string[]>)[ex.id] ?? []).map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="lbl section">Alternatives avec ton matériel</div>
      {alts.length ? (
        <div className="pb-glass" style={{ padding: "4px 0" }}>
          {alts.slice(0, 8).map((a) => (
            <Link key={a.id} to={`/exercice/${a.id}${qs.get("lieu") ? `?lieu=${qs.get("lieu")}` : ""}`} replace className="pb-li">
              <div className="t">{a.name}<small>{a.muscles} · {dose(a)}</small></div>
              <Icon name="right" size="sm" className="pb-muted" />
            </Link>
          ))}
        </div>
      ) : <p className="pb-muted">Aucune alternative avec le matériel de ce lieu.</p>}
      <p className="pb-subtle" style={{ fontSize: 12, marginTop: 20 }}>
        {/^\d+$/.test(ex.id) ? "Consignes issues du jeu de données exercises-dataset (licence MIT)." : "Consignes traduites de free-exercise-db (domaine public)."}
        {ex.photo ? " Photos : free-exercise-db (domaine public)." : ""}
      </p>
    </main>
  );
}

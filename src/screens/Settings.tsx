// Paramètres (US14) : chaque section réutilise le formulaire de l'onboarding.
import { useState, type ComponentType } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../state/app";
import { Icon } from "../components/Icon";
import { BackButton, BottomAction, Notice, Sheet } from "../components/ui";
import { ffbb, regenerateProgram, replaceSlots, updateProfile } from "../lib/data";
import { supabase } from "../lib/supabase";
import { TrackfitGuide } from "../components/TrackfitGuide";
import { addDays, ago, mondayOf, today } from "../lib/format";
import { clearVideos } from "../vision/media";
import { profileErrors, StepBasket, StepFfbb, StepPlaces, StepPriorities, StepProfile, StepWeek, type Draft, type StepProps } from "./onboarding/steps";
import { slotsToWeek, weekToSlots } from "./onboarding/week";

interface Section { title: string; lead: string; Comp: ComponentType<StepProps>; valid: (d: Draft) => boolean; keys: string[]; regenerate: boolean }
const SECTIONS: Record<string, Section> = {
  joueur: { title: "Profil joueur", lead: "Prénom, âge, taille, poids, main forte.", Comp: StepProfile, valid: (d) => !Object.keys(profileErrors(d)).length, keys: ["first_name", "birth_date", "height_cm", "weight_kg", "strong_hand"], regenerate: false },
  basket: { title: "Poste & niveau", lead: "Ton programme se régénère à partir de la semaine prochaine.", Comp: StepBasket, valid: (d) => Boolean(d.position && d.experience && d.level), keys: ["position", "experience", "level"], regenerate: true },
  priorites: { title: "Priorités", lead: "Ton programme se régénère à partir de la semaine prochaine.", Comp: StepPriorities, valid: (d) => (d.priorities_high?.length ?? 0) >= 1 && (d.priorities_low?.length ?? 0) >= 1, keys: ["priorities_high", "priorities_low"], regenerate: true },
  lieux: { title: "Lieux & matériel", lead: "Les séances suivantes s'adaptent à ton matériel.", Comp: StepPlaces, valid: (d) => (d.workout_locations?.length ?? 0) >= 1, keys: ["workout_locations", "home_equipment", "has_hoop"], regenerate: true },
  semaine: { title: "Emploi du temps", lead: "Cours, entraînements club, lieux, heure limite, vacances, durée.", Comp: StepWeek, valid: () => true, keys: ["latest_min", "vacation_zone", "session_minutes"], regenerate: true },
  tests: { title: "Fréquence des tests", lead: "Tes sessions de tests sont replacées dans ton calendrier à partir de demain.", Comp: StepTests, valid: (d) => (d.test_every_weeks ?? 0) >= 2, keys: ["test_every_weeks"], regenerate: true },
  ffbb: { title: "Club FFBB", lead: "Change de club ou d'équipe en cours de saison.", Comp: StepFfbb, valid: () => true, keys: ["ffbb_club", "ffbb_team"], regenerate: true },
};

export default function Settings() {
  const { section = "" } = useParams();
  if (section === "trackfit") return <TrackfitSettings />;
  if (section === "compte") return <AccountSettings />;
  if (section === "notifications") return <Navigate to="/profil#notifications" replace />;
  const def = SECTIONS[section];
  if (!def) return <Navigate to="/profil" replace />;
  return <SectionEditor key={section} def={def} section={section} />;
}

function SectionEditor({ def, section }: { def: Section; section: string }) {
  const { profile, slots, setProfile, reload } = useApp();
  const nav = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => ({ ...profile!, week: slotsToWeek(slots, profile!.ab_weeks) }));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!def.valid(draft)) return setShowErrors(true);
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of def.keys) patch[k] = (draft as Record<string, unknown>)[k] ?? null;
      if (section === "semaine") {
        patch.ab_weeks = draft.week.ab;
        patch.ab_reference = draft.week.ab ? profile!.ab_reference ?? mondayOf(today()) : null;
        await replaceSlots(["class", "club", "free"], weekToSlots(draft.week));
      }
      if (section === "lieux" || section === "priorites") for (const k of def.keys) if (Array.isArray(profile![k as keyof typeof profile])) patch[k] = patch[k] ?? [];
      await updateProfile(patch);
      const next = { ...profile!, ...patch } as typeof profile & object;
      setProfile(next);
      if (section === "ffbb") {
        await supabase.from("events").delete().eq("source", "ffbb").gte("date", today());
        if (draft.ffbb_team) await ffbb({ action: "sync" }).catch(() => undefined);
      }
      // Profil, poste, priorités : régénération à partir de la semaine suivante ; emploi du temps, lieux et club : dès demain.
      if (def.regenerate) await regenerateProgram(next, ["basket", "priorites"].includes(section) ? addDays(mondayOf(today()), 7) : addDays(today(), 1));
      await reload();
      nav("/profil", { replace: true });
    } catch (e) {
      console.error(e);
      setError("L'enregistrement a échoué. Vérifie ta connexion et réessaie.");
    } finally {
      setBusy(false);
    }
  }

  const Comp = def.Comp;
  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 160 }}>
      <div className="hdr"><BackButton to="/profil" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>{def.title}</h1>
      <p className="lead" style={{ marginBottom: 20 }}>{def.lead}</p>
      <Comp draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} showErrors={showErrors} />
      {error ? <div style={{ marginTop: 14 }}><Notice tone="error">{error}</Notice></div> : null}
      <BottomAction><button className="pb-btn primary lg block" disabled={busy} onClick={save}>{busy ? "Mise à jour du programme…" : "Enregistrer"}</button></BottomAction>
    </main>
  );
}

function TrackfitSettings() {
  const { profile, setProfile } = useApp();
  const p = profile!;
  const [consent, setConsent] = useState(false);

  async function connect() {
    const patch = { trackfit_connected: true, trackfit_consent_at: new Date().toISOString() };
    await updateProfile(patch);
    setProfile({ ...p, ...patch });
  }
  async function disconnect() {
    const patch = { trackfit_connected: false, trackfit_consent_at: null };
    await updateProfile(patch);
    setProfile({ ...p, ...patch });
  }
  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton to="/profil" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>TrackFit</h1>
      <p className="lead" style={{ marginBottom: 18 }}>Poids, masse grasse, masse musculaire et fréquence cardiaque au repos, mis à jour en moins d'une minute.</p>
      <Link to="/pesee" className="pb-btn primary lg block" style={{ marginBottom: 14 }}><Icon name="scale" size="sm" />Me peser directement en Bluetooth</Link>
      <p className="pb-subtle" style={{ fontSize: 13, margin: "0 2px 14px" }}>Le plus simple : l'app lit la balance elle-même, sans raccourci. Le raccourci ci-dessous ne sert que si tu préfères passer par l'app FitTrack.</p>
      {p.trackfit_connected ? (
        <div className="col">
          <Notice tone="ok">Connecté · dernière synchro {ago(p.trackfit_synced_at)}.</Notice>
          <TrackfitGuide token={p.trackfit_token} />
          <button className="pb-btn lg danger" onClick={disconnect}>Déconnecter TrackFit</button>
          <p className="pb-subtle" style={{ fontSize: 13, margin: 0 }}>Une fois déconnecté, tu saisis ton poids à la main dans Progrès › Mesures.</p>
        </div>
      ) : (
        <div className="col">
          <label className="pb-glass" style={{ padding: 16, display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2, accentColor: "var(--primary)" }} />
            <span style={{ fontSize: 14, lineHeight: "21px" }}>J'accepte que Prépa Basket reçoive mes données corporelles depuis TrackFit pour suivre ma progression. Elles ne sont jamais partagées.</span>
          </label>
          <button className="pb-btn primary lg" disabled={!consent} onClick={connect}>Connecter TrackFit</button>
        </div>
      )}
    </main>
  );
}

function AccountSettings() {
  const { session } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) { setBusy(false); return setError("La suppression a échoué. Réessaie."); }
    await clearVideos();
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* rien */ }
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton to="/profil" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Compte & confidentialité</h1>
      <p className="lead" style={{ marginBottom: 18 }}>{session?.user.email}</p>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <div className="pb-li"><Icon name="camera" className="pb-muted" /><div className="t">Vidéos<small>Stockées uniquement sur ce téléphone, jamais envoyées</small></div></div>
        <button className="pb-li" onClick={() => supabase.auth.signOut().then(() => window.location.assign("/"))}><Icon name="logout" className="pb-muted" /><div className="t">Se déconnecter</div></button>
        <button className="pb-li" onClick={() => setConfirm(true)}><Icon name="trash" style={{ color: "var(--danger)" }} /><div className="t" style={{ color: "var(--danger)" }}>Supprimer mon compte<small>Toutes tes données sont effacées</small></div></button>
      </div>
      <p className="pb-subtle" style={{ fontSize: 12, marginTop: 20 }}>Exercices : textes du jeu de données exercises-dataset (MIT). Suivi caméra : MediaPipe (Apache 2.0). Calendriers FFBB via ffbb-data-client (projet tiers, non officiel).</p>
      {confirm ? (
        <Sheet title="Supprimer ton compte ?" onClose={() => setConfirm(false)}>
          <p style={{ marginTop: 0 }}>Profil, programme, séances, mesures et vidéos de ce téléphone seront supprimés définitivement.</p>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => setConfirm(false)}>Garder mon compte</button>
            <button className="pb-btn primary lg danger" style={{ flex: 1, background: "var(--danger)", color: "var(--bg-950)" }} disabled={busy} onClick={remove}>{busy ? "Suppression…" : "Supprimer"}</button>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}


// Fréquence des sessions de tests : plus rapprochées pour suivre un objectif de près, plus espacées en pleine saison.
const TEST_FREQUENCIES = [
  { weeks: 2, hint: "Suivi serré d'un objectif proche" },
  { weeks: 3, hint: "Bon compromis en préparation" },
  { weeks: 4, hint: "Recommandé : le temps de progresser entre deux tests" },
  { weeks: 6, hint: "Saison chargée, beaucoup de matchs" },
  { weeks: 8, hint: "Entretien, peu de temps" },
];

function StepTests({ draft, set }: StepProps) {
  const every = draft.test_every_weeks ?? 4;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="col" role="radiogroup" aria-label="Une session de tests toutes les" style={{ gap: 8 }}>
        {TEST_FREQUENCIES.map((f) => (
          <button key={f.weeks} type="button" role="radio" aria-checked={every === f.weeks} className={`pb-li pb-glass${every === f.weeks ? " active" : ""}`} style={{ borderRadius: 14 }} onClick={() => set({ test_every_weeks: f.weeks })}>
            <div className="t">Toutes les {f.weeks} semaines<small>{f.hint}</small></div>
            {every === f.weeks ? <Icon name="check" size="sm" style={{ color: "var(--success)" }} /> : null}
          </button>
        ))}
      </div>
      <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Les tests suivent tes objectifs. Plus ils sont rapprochés, plus vite l'estimation du délai s'appuie sur ta vraie progression ; en dessous de 3 semaines, les écarts entre deux tests sont souvent plus petits que la précision de la mesure.</p>
    </div>
  );
}

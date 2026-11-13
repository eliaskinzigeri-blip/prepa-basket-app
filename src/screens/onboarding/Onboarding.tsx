import { useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp, latest } from "../../state/app";
import { BackButton, BottomAction, Notice, Steps } from "../../components/ui";
import { replaceSlots, updateProfile } from "../../lib/data";
import { supabase } from "../../lib/supabase";
import { mondayOf, today } from "../../lib/format";
import { profileErrors, StepBasket, StepFfbb, StepPlaces, StepPriorities, StepProfile, StepTrackfit, StepWeek, type Draft, type StepProps } from "./steps";
import { slotsToWeek, weekToSlots } from "./week";

interface StepDef { title: string; lead: string; Comp: ComponentType<StepProps>; valid: (d: Draft) => boolean; skippable?: boolean }

export const STEPS: StepDef[] = [
  { title: "Faisons connaissance", lead: "Ton programme s'adapte à ton corps.", Comp: StepProfile, valid: (d) => Object.keys(profileErrors(d)).length === 0 },
  { title: "Ton jeu", lead: "Pour te donner des exercices à ta portée.", Comp: StepBasket, valid: (d) => Boolean(d.position && d.experience && d.level) },
  { title: "Ton club FFBB", lead: "Tes matchs officiels s'ajoutent tout seuls à ton calendrier.", Comp: StepFfbb, valid: (d) => Boolean(d.ffbb_club && d.ffbb_team), skippable: true },
  { title: "Qu'est-ce que tu veux travailler ?", lead: "Ton programme met le paquet sur tes priorités fortes.", Comp: StepPriorities, valid: (d) => (d.priorities_high?.length ?? 0) >= 1 && (d.priorities_low?.length ?? 0) >= 1 },
  { title: "Où tu t'entraînes", lead: "Tu ne reçois que des exercices que tu peux vraiment faire.", Comp: StepPlaces, valid: (d) => (d.workout_locations?.length ?? 0) >= 1 },
  { title: "Ta semaine type", lead: "On place tes séances seulement là où tu es libre.", Comp: StepWeek, valid: () => true },
  { title: "Connecte TrackFit", lead: "Ton poids se met à jour tout seul.", Comp: StepTrackfit, valid: (d) => Boolean(d.trackfit_connected), skippable: true },
];

const PROFILE_KEYS = ["first_name", "birth_date", "height_cm", "weight_kg", "strong_hand", "position", "experience", "level", "ffbb_club", "ffbb_team", "priorities_high", "priorities_low",
  "workout_locations", "home_equipment", "has_hoop", "vacation_zone", "latest_min", "session_minutes", "trackfit_connected", "trackfit_consent_at"] as const;

export default function Onboarding() {
  const { profile, slots, measurements, setProfile, reload } = useApp();
  const nav = useNavigate();
  const step = Math.min(Math.max(Number(useParams().step) || 1, 1), STEPS.length);
  const tf = latest(measurements, "weight");
  const [draft, setDraft] = useState<Draft>(() => ({
    ...profile!,
    weight_kg: profile!.weight_kg ?? (profile!.trackfit_connected && tf.value != null ? tf.value : null),
    week: slotsToWeek(slots, profile!.ab_weeks),
  }));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = STEPS[step - 1];

  async function next(skip = false) {
    if (!skip && !def.valid(draft)) return setShowErrors(true);
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = { onboarding_step: step + 1 };
      for (const k of PROFILE_KEYS) patch[k] = draft[k] ?? null;
      for (const k of ["priorities_high", "priorities_low", "workout_locations", "home_equipment"] as const) patch[k] = draft[k] ?? [];
      patch.has_hoop = Boolean(draft.has_hoop);
      patch.trackfit_connected = Boolean(draft.trackfit_connected);
      patch.latest_min = draft.latest_min ?? 1260;
      patch.session_minutes = draft.session_minutes ?? 45;
      if (skip && step === 3) Object.assign(patch, { ffbb_club: null, ffbb_team: null });
      if (skip && step === 7) Object.assign(patch, { trackfit_connected: false, trackfit_consent_at: null });
      if (step === 6) {
        patch.ab_weeks = draft.week.ab;
        patch.ab_reference = draft.week.ab ? mondayOf(today()) : null;
        await replaceSlots(["class", "club", "free"], weekToSlots(draft.week));
      }
      await updateProfile(patch as never);
      // La pesée saisie devient la première mesure (pour suivre la variation).
      if (step === 1 && draft.weight_kg && draft.weight_kg !== profile!.weight_kg) {
        await supabase.from("measurements").insert({ kind: "weight", value: draft.weight_kg, source: "manual" });
      }
      setProfile({ ...profile!, ...(patch as object) });
      setShowErrors(false);
      if (step === STEPS.length) {
        await reload();
        nav("/programme");
      } else nav(`/onboarding/${step + 1}`);
    } catch (e) {
      setError(navigator.onLine ? "L'enregistrement a échoué. Réessaie." : "Pas de réseau : reconnecte-toi pour continuer.");
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const Comp = def.Comp;
  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 170 }}>
      <div className="row" style={{ marginTop: 4 }}>
        {step > 1 ? <BackButton to={`/onboarding/${step - 1}`} /> : <span style={{ width: 44 }} />}
        <div style={{ flex: 1, margin: "0 8px" }}><Steps total={STEPS.length} current={step} /></div>
        <span className="pb-subtle" style={{ font: "500 13px var(--font-sans)" }}>{step}/{STEPS.length}</span>
      </div>
      <h1 className="t" style={{ margin: "28px 0 6px" }}>{def.title}</h1>
      <p className="lead" style={{ marginBottom: 22 }}>{def.lead}</p>
      <Comp draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} showErrors={showErrors} trackfitWeight={profile!.trackfit_connected ? tf.value : null} />
      {error ? <div style={{ marginTop: 16 }}><Notice tone="error">{error}</Notice></div> : null}
      <BottomAction>
        {def.skippable ? <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => next(true)} disabled={busy}>Passer</button> : null}
        <button className="pb-btn primary lg" style={{ flex: 2 }} onClick={() => next()} disabled={busy}>
          {busy ? "Enregistrement…" : step === 7 && draft.trackfit_connected ? "Connecter" : "Continuer"}
        </button>
      </BottomAction>
    </main>
  );
}

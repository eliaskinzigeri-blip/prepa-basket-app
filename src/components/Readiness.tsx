// Bandeau « forme du jour » sur une séance : allégée (🟠) ou récupération à la place (🔴), toujours réversible.
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { addDays, dayLabel, range, today as todayIso } from "../lib/format";
import { relocate } from "../lib/program";
import { READINESS_LABEL } from "../lib/sleep";
import type { CalEvent } from "../lib/types";
import { useApp } from "../state/app";
import { adaptation, useReadiness } from "../state/readiness";
import { Notice } from "./ui";

export const READY_COLOR = { vert: "var(--success)", orange: "var(--cat-basket)", rouge: "var(--danger, #ff5a6a)" } as const;

/** Pastille de forme : point de couleur + libellé. */
export function ReadyDot({ level }: { level: "vert" | "orange" | "rouge" }) {
  return <span className="pill-sm"><span className="sw" style={{ background: READY_COLOR[level], borderRadius: "50%" }} />{READINESS_LABEL[level]}</span>;
}

export function ReadinessBanner({ e }: { e: CalEvent }) {
  const { profile, slots, events, reloadEvents, session } = useApp();
  const r = useReadiness(e.date);
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const effect = adaptation(e, r.level, false);
  const today = e.date === todayIso() && e.status === "planned";
  if (!today || !r.level || (e.type === "club" || e.type === "match")) return null;
  const why = r.reasons.length ? ` : ${r.reasons.join(", ")}` : "";

  if (r.level === "vert" || effect === "normal") {
    if (r.level !== "vert") return null; // séance non concernée (tir, dribble…)
    return <div style={{ marginTop: 14 }}><Notice tone="ok">En forme{why}. Séance normale.</Notice></div>;
  }

  if (r.keep) {
    return (
      <div style={{ marginTop: 14 }}>
        <Notice>Tu as choisi de garder la séance normale malgré la fatigue. Écoute ton corps : arrête-toi si tu forces.{" "}
          <button className="pb-link" onClick={() => r.setKeep(false)}>Revenir à la séance adaptée</button></Notice>
      </div>
    );
  }

  // Rouge, séance lourde : la séance part au prochain jour libre qui respecte les règles, une récupération la remplace
  async function swap() {
    setBusy(true);
    const spot = relocate({ ...e, date: addDays(e.date, 1) }, profile!, slots, events);
    const start = e.start_min ?? 17 * 60;
    if (spot) await supabase.from("events").update({ date: spot.date, start_min: spot.start_min, end_min: spot.end_min }).eq("id", e.id);
    else await supabase.from("events").update({ status: "skipped" }).eq("id", e.id);
    await supabase.from("events").insert({
      user_id: session!.user.id, date: e.date, start_min: start, end_min: start + 20, type: "workout", title: "Récupération légère",
      location: e.location ?? "maison", source: "program", status: "planned", payload: { template: "recup", note: `À la place de « ${e.title} » (pas récupéré)` },
    });
    setMoved(spot ? `${dayLabel(spot.date)} · ${range(spot.start_min, spot.end_min)}` : "annulée (aucun créneau libre cette semaine)");
    await reloadEvents();
    setBusy(false);
  }

  return (
    <div className="pb-glass" style={{ marginTop: 14, padding: 14, display: "grid", gap: 10, borderLeft: `4px solid ${READY_COLOR[r.level]}` }} role="status">
      <div className="row between"><b>Forme du jour</b><ReadyDot level={r.level} /></div>
      <p style={{ margin: 0, fontSize: 14 }}>
        {effect === "light"
          ? `Séance allégée${why}. Une série de moins sur chaque exercice et pas de lest : tu gardes le geste sans creuser la fatigue.`
          : `Pas récupéré${why}. Une grosse séance de jambes aujourd'hui fatiguerait plus qu'elle ne ferait progresser.`}
      </p>
      {r.streak >= 3 ? <Notice tone="error">{r.streak} jours de suite dans le rouge : c'est peut-être un début de maladie ou une période trop chargée. Repose-toi et parles-en à tes parents ou à ton coach.</Notice> : null}
      {moved ? <Notice tone="ok">Récupération légère de 20 min ajoutée aujourd'hui. « {e.title} » est déplacée : {moved}.</Notice> : null}
      {effect === "recup" && !moved ? (
        <button className="pb-btn primary" disabled={busy} onClick={swap}>Faire une récupération de 20 min à la place et décaler la séance</button>
      ) : null}
      {!moved ? <button className="pb-btn" onClick={() => r.setKeep(true)}>Je me sens bien, je garde la séance normale</button> : null}
      <Link to="/sommeil" className="pb-subtle" style={{ fontSize: 13 }}>Voir ma nuit et ma VFC</Link>
    </div>
  );
}

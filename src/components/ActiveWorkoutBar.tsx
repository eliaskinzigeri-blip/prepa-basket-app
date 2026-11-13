import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "./Icon";
import { chrono } from "../lib/format";
import { endActiveRest, useActiveWorkout, useRestLeft, type ActiveWorkout } from "../lib/activeWorkout";
import { useApp } from "../state/app";

// Écrans où la bande gênerait : la séance elle-même, les vues caméra, l'inscription.
const HIDDEN = ["/seance/", "/dribble/", "/shoot", "/test/", "/onboarding", "/programme", "/recap/", "/rameur/seance"];

export function ActiveWorkoutBar() {
  const { session } = useApp();
  const { pathname } = useLocation();
  const active = useActiveWorkout(session?.user.id);
  if (!active || HIDDEN.some((p) => pathname.startsWith(p))) return null;
  return <Bar a={active} />;
}

function Bar({ a }: { a: ActiveWorkout }) {
  const left = useRestLeft(a.restEnd, a.pausedLeft);
  const ex = a.list[a.idx];
  const progress = `${ex?.name ?? "Séance en cours"} · série ${a.setNo}/${ex?.sets ?? 1}`;

  // Repos terminé sur un autre écran : même signal que dans la séance.
  useEffect(() => {
    if (left !== 0 || a.paused) return;
    navigator.vibrate?.([120, 60, 120]);
    endActiveRest();
  }, [left, a.paused]);

  const resting = left != null && left > 0;
  return (
    <Link to={a.path} className={`wo-bar${resting ? " resting" : ""}`} aria-label={resting ? `Repos, ${left} secondes restantes. Revenir à la séance.` : `${progress}. Revenir à la séance.`}>
      {resting ? <span className="wo-bar-fill" style={{ width: `${(left / Math.max(1, a.restTotal)) * 100}%` }} aria-hidden="true" /> : null}
      <Icon name={resting ? "timer" : "dumbbell"} size="sm" />
      {resting ? (
        <span className="wo-bar-txt"><b className="pb-num">Repos {chrono(left)}{a.paused ? " · en pause" : ""}</b><small>Ensuite : {progress}</small></span>
      ) : (
        <span className="wo-bar-txt"><b>{ex?.name ?? "Séance en cours"}</b><small>Série {a.setNo}/{ex?.sets ?? 1} · à toi de jouer</small></span>
      )}
      <Icon name="right" size="sm" />
    </Link>
  );
}

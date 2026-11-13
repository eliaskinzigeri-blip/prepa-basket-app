import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/app";
import { Icon } from "../components/Icon";
import { BottomAction, CAT_COLOR, Notice, Spinner } from "../components/ui";
import { ffbb, regenerateProgram, updateProfile } from "../lib/data";
import { addDays, DAYS_SHORT, longDate, range, today, weekday } from "../lib/format";
import { LEVELS, POSITIONS, skill } from "../data/catalog";
import type { CalEvent } from "../lib/types";

const PLACE: Record<string, string> = { maison: "Maison", salle: "Salle", terrain: "Terrain" };

export default function ProgramReady() {
  const { profile, events, reloadEvents, setProfile } = useApp();
  const nav = useNavigate();
  const [state, setState] = useState<"working" | "ready" | "error">("working");
  const [ffbbWarn, setFfbbWarn] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !profile) return;
    started.current = true;
    (async () => {
      try {
        if (profile.ffbb_team) {
          await ffbb({ action: "sync" }).catch((e) => setFfbbWarn(e.message));
        }
        await regenerateProgram(profile, today(), 5);
        await reloadEvents();
        setState("ready");
      } catch (e) {
        console.error(e);
        setState("error");
      }
    })();
  }, [profile, reloadEvents]);

  const t = today();
  const week = events.filter((e) => e.date >= t && e.date <= addDays(t, 6) && e.type !== "club").sort((a, b) => a.date.localeCompare(b.date) || (a.start_min ?? 0) - (b.start_min ?? 0));
  const count = (type: string) => week.filter((e) => e.type === type).length;
  const p = profile!;
  const focus = p.priorities_high.map((s) => skill(s)?.label.toLowerCase()).join(" et ");

  async function go() {
    const at = new Date().toISOString();
    await updateProfile({ onboarded_at: at });
    setProfile({ ...p, onboarded_at: at });
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
    nav("/", { replace: true });
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 160 }}>
      <div style={{ margin: "18px 0 0", display: "grid", justifyItems: "center", textAlign: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: 28, display: "grid", placeItems: "center", background: "var(--primary)", boxShadow: "var(--shadow-glow), var(--shadow-inner)" }}>
          <Icon name="ball" size="lg" style={{ width: 40, height: 40 }} />
        </div>
        <h1 className="t" style={{ margin: "18px 0 6px" }}>{state === "ready" ? `Ta semaine est prête, ${p.first_name}` : "On prépare ta semaine…"}</h1>
        <p className="lead" style={{ maxWidth: 300 }}>
          Programme {POSITIONS.find((x) => x.id === p.position)?.label} · {LEVELS.find((x) => x.id === p.level)?.label} · axé {focus}.
        </p>
      </div>
      {state === "working" ? <Spinner label="Placement des séances dans tes créneaux libres…" /> : null}
      {state === "error" ? <div style={{ marginTop: 20 }}><Notice tone="error">La génération a échoué. Vérifie ta connexion et réessaie.</Notice></div> : null}
      {ffbbWarn ? <div style={{ marginTop: 16 }}><Notice>{ffbbWarn}</Notice></div> : null}
      {state === "ready" ? (
        <>
          <div className="grid4" style={{ margin: "22px 0 18px" }}>
            {(["workout", "basket", "match", "rest"] as const).map((k) => (
              <div key={k} className="pb-glass" style={{ padding: "12px 6px", textAlign: "center", borderRadius: 18 }}>
                <b className="pb-num" style={{ fontSize: 24, color: CAT_COLOR[k] }}>{count(k)}</b>
                <div className="pb-muted" style={{ fontSize: 12, marginTop: 2 }}>{{ workout: "Workout", basket: "Basket", match: "Match", rest: "Repos" }[k]}</div>
              </div>
            ))}
          </div>
          <div className="lbl" style={{ marginBottom: 10 }}>Tes 7 prochains jours, dès {longDate(t).toLowerCase()}</div>
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            {week.map((e) => <WeekRow key={e.id} e={e} />)}
          </div>
        </>
      ) : null}
      <BottomAction>
        <button className="pb-btn primary lg block" disabled={state !== "ready"} onClick={go}>C'est parti</button>
      </BottomAction>
    </main>
  );
}

function WeekRow({ e }: { e: CalEvent }) {
  const isMatch = e.type === "match";
  const sub = isMatch
    ? `${range(e.start_min, null)} · ${e.payload.home ? "domicile" : "extérieur"}`
    : e.type === "rest" ? "Récupération complète"
    : `${PLACE[e.location ?? ""] ?? ""} · ${range(e.start_min, e.end_min)}`;
  return (
    <div className="pb-li">
      <span className="pill-sm" style={{ width: 46, justifyContent: "center", ...(isMatch ? { background: "var(--cat-match)", color: "var(--bg-950)", borderColor: "transparent" } : {}) }}>{DAYS_SHORT[weekday(e.date)]}</span>
      <div className="t">{e.title}<small>{sub}</small></div>
      <span className="sw" style={{ background: CAT_COLOR[e.type] }} aria-hidden="true" />
    </div>
  );
}

import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, latest } from "../state/app";
import { Icon } from "../components/Icon";
import { BackButton, BottomAction, Delta } from "../components/ui";
import { TESTS } from "../data/catalog";
import { hasRower } from "../lib/rower/plans";
import { goalTitle, metricOf, testsFor } from "../lib/goals";
import { num, today } from "../lib/format";
import { supabase } from "../lib/supabase";

export default function TestsHub() {
  const [qs] = useSearchParams();
  const eventId = qs.get("event");
  const { measurements, goals, profile, reloadEvents } = useApp();
  const every = profile?.test_every_weeks ?? 4;
  const mine = testsFor(goals);
  const withEvent = (to: string) => (eventId ? `${to}${to.includes("?") ? "&" : "?"}event=${eventId}` : to);
  const nav = useNavigate();
  const t = today();

  async function done() {
    if (eventId) await supabase.from("events").update({ status: "done" }).eq("id", eventId);
    await reloadEvents();
    nav("/", { replace: true });
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 140 }}>
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Tests athlétiques</h1>
      <p className="lead">{mine.length ? "Ces tests suivent tes objectifs. 3 essais par test, le meilleur est retenu." : "La caméra mesure tout : pas de chrono ni de mètre. 3 essais par test, le meilleur est retenu."}</p>
      {mine.length ? (
        <>
          <div className="lbl section">Pour tes objectifs</div>
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            {mine.map((x) => {
              const g = goals.find((y) => metricOf(y).test.id === x.id)!;
              const m = metricOf(g);
              const l = latest(measurements, m.kind);
              const doneToday = l.at?.slice(0, 10) === t;
              return (
                <Link key={x.id} to={withEvent(x.to)} className="pb-li">
                  <div className="pb-tile" style={{ width: 44, height: 44, color: doneToday ? "var(--success)" : "var(--primary-bright)" }}><Icon name={doneToday ? "check" : "target"} size="sm" /></div>
                  <div className="t">{x.label}<small>{goals.filter((y) => metricOf(y).test.id === x.id).map(goalTitle).join(" · ")}{l.value != null ? ` · dernier : ${num(l.value, m.digits)} ${m.unit}` : ""}</small></div>
                  <Icon name="right" size="sm" className="pb-muted" />
                </Link>
              );
            })}
          </div>
          <div className="lbl section">Autres tests</div>
        </>
      ) : (
        <Link to="/objectifs" className="pb-glass pb-li" style={{ marginTop: 14, borderRadius: 16 }}>
          <Icon name="target" className="pb-muted" /><div className="t">Fixe tes objectifs<small>Les tests du mois seront choisis pour eux</small></div><Icon name="right" size="sm" className="pb-muted" />
        </Link>
      )}
      <div className="pb-glass" style={{ padding: "4px 0", marginTop: mine.length ? 0 : 18 }}>
        {TESTS.filter((x) => !mine.some((y) => y.id === x.id || y.to === `/test/${x.id}`)).map((x) => {
          const l = latest(measurements, x.id);
          const doneToday = l.at?.slice(0, 10) === t;
          return (
            <Link key={x.id} to={`/test/${x.id}${eventId ? `?event=${eventId}` : ""}`} className="pb-li">
              <div className="pb-tile" style={{ width: 44, height: 44, color: doneToday ? "var(--success)" : "var(--primary-bright)" }}><Icon name={doneToday ? "check" : x.kind === "lines" ? "timer" : "bolt"} size="sm" /></div>
              <div className="t">{x.name}<small>{l.value != null ? `Dernier : ${num(l.value, x.digits)} ${x.unit}` : "Jamais mesuré"}</small></div>
              <Delta diff={l.value != null && l.prev != null ? l.value - l.prev : null} better={x.better} digits={x.digits} />
              <Icon name="right" size="sm" className="pb-muted" />
            </Link>
          );
        })}
      </div>
      <div className="lbl section">Cœur</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {(() => {
          const l = latest(measurements, "rhr");
          return (
            <Link to={`/test/fc-repos${eventId ? `?event=${eventId}` : ""}`} className="pb-li">
              <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--cat-match)" }}><Icon name="heart" size="sm" /></div>
              <div className="t">FC au repos<small>{l.value != null ? `Dernière : ${num(l.value)} bpm · le matin au réveil, 5 min` : "Le matin au réveil, 5 min avec la ceinture"}</small></div>
              <Delta diff={l.value != null && l.prev != null ? l.value - l.prev : null} better="lower" digits={0} />
              <Icon name="right" size="sm" className="pb-muted" />
            </Link>
          );
        })()}
      </div>
      {hasRower(profile) ? (
        <>
          <div className="lbl section">Rameur</div>
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            <Link to="/rameur/test" className="pb-li">
              <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--primary-bright)" }}><Icon name="rower" size="sm" /></div>
              <div className="t">Test de niveau 20 min<small>Cale tes allures au rameur. Ne remplace pas le test navette.</small></div>
              <Icon name="right" size="sm" className="pb-muted" />
            </Link>
          </div>
        </>
      ) : null}
      <p className="pb-subtle" style={{ fontSize: 13, marginTop: 12 }}>Une session de tests est prévue toutes les {every} semaines dans ton calendrier (réglable dans Profil › Fréquence des tests). Après chaque test, le délai de tes objectifs se recalcule.</p>
      <BottomAction><button className="pb-btn primary lg block" onClick={done}>{eventId ? "Terminer la session de tests" : "Retour à l'accueil"}</button></BottomAction>
    </main>
  );
}

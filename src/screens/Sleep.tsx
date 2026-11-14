// VFC du matin : carte d'accueil (mesurer avant de se lever, puis la forme du jour) et écran de suivi (valeur du matin,
// tendance sur 7 jours, zone normale, historique). Le questionnaire de sommeil a été retiré : seule la VFC compte.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { BackButton, BottomNav } from "../components/ui";
import { ReadyDot } from "../components/Readiness";
import { dayLabel, iso, nowMin, today } from "../lib/format";
import { hrvCalibration, hrvStatus } from "../lib/sleep";
import { useApp } from "../state/app";
import { useReadiness } from "../state/readiness";

const hrvPoints = (ms: { kind: string; value: number; measured_at: string }[]) =>
  ms.filter((m) => m.kind === "hrv").map((m) => ({ value: Number(m.value), measured_at: m.measured_at }));

/** Accueil, le matin : mesurer sa VFC avant de se lever ; une fois mesurée, la valeur et la forme du jour. */
export function VfcCard() {
  const { measurements, events } = useApp();
  const t = today();
  const r = useReadiness(t);
  const points = useMemo(() => hrvPoints(measurements), [measurements]);
  const h = useMemo(() => hrvStatus(points, t), [points, t]);
  const measured = points.some((p) => iso(new Date(p.measured_at)) === t);
  const sessionToday = events.some((e) => e.date === t && e.status === "planned" && (e.type === "workout" || e.type === "test"));

  if (measured) {
    return (
      <Link to="/sommeil" className="pb-glass pb-li" style={{ marginTop: 14, borderRadius: 20 }}>
        <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--cat-match)" }}><Icon name="heart" size="sm" /></div>
        <div className="t">VFC ce matin : {h ? `${h.today} ms` : "mesurée"}<small>{h ? `Zone normale ${h.low} à ${h.high} ms` : `Encore ${hrvCalibration(points, t)} matin(s) pour connaître ta zone normale`}</small></div>
        {r.level ? <ReadyDot level={r.level} /> : <Icon name="right" size="sm" className="pb-muted" />}
      </Link>
    );
  }
  if (nowMin() >= 12 * 60) return null;
  return (
    <Link to="/test/fc-repos?court=1" className="pb-glass pb-li" style={{ marginTop: 14, borderRadius: 20 }}>
      <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--cat-match)" }}><Icon name="heart" size="sm" /></div>
      <div className="t">Avant de te lever : mesure ta VFC<small>3 min allongé avec ta ceinture{sessionToday ? " : ta séance du jour s'y adapte" : ""}</small></div>
      <Icon name="right" size="sm" className="pb-muted" />
    </Link>
  );
}

export default function VfcScreen() {
  const { measurements } = useApp();
  const t = today();
  const points = useMemo(() => hrvPoints(measurements), [measurements]);
  const h = useMemo(() => hrvStatus(points, t), [points, t]);
  const calib = useMemo(() => hrvCalibration(points, t), [points, t]);
  // une valeur par jour (la première, celle du réveil), 14 derniers jours
  const history = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const p of [...points].sort((a, b) => a.measured_at.localeCompare(b.measured_at))) {
      const d = iso(new Date(p.measured_at));
      if (!byDay.has(d)) byDay.set(d, p.value);
    }
    return [...byDay].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  }, [points]);

  return (
    <main className="pb-page screen">
      <div className="hdr"><BackButton to="/" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>VFC du matin</h1>
      <p className="lead">La variabilité de ta fréquence cardiaque montre si ton corps a récupéré. Ta séance du jour s'adapte à ta forme.</p>

      <div className="pb-glass" style={{ marginTop: 16, padding: 14, display: "grid", gap: 8 }}>
        {h ? (
          <>
            <div className="row between"><span>Ce matin</span><b className="pb-num" style={{ fontSize: 20 }}>{h.today} ms</b></div>
            <div className="row between"><span>Moyenne des 7 derniers jours</span><b className="pb-num">{h.week} ms</b></div>
            <div className="row between"><span>Ta zone normale</span><b className="pb-num">{h.low} à {h.high} ms</b></div>
            <span className="pb-muted" style={{ fontSize: 14 }}>{h.drop ? "Forte baisse ce matin (fatigue, stress ou début de maladie) : séance allégée." : h.trendLow ? "En baisse depuis plusieurs jours : la fatigue s'installe, séance allégée." : "Dans ta zone normale : séance normale."}</span>
          </>
        ) : (
          <span className="pb-muted" style={{ fontSize: 14 }}>{calib > 0 ? `Encore ${calib} matin${calib > 1 ? "s" : ""} de mesure pour connaître ta zone normale.` : "Pas encore de mesure ce matin."}</span>
        )}
        <span className="pb-subtle" style={{ fontSize: 12 }}>
          Ta zone normale, c'est ta moyenne des 30 derniers jours, à plus ou moins un demi-écart-type. Seule la tendance sur 7 jours, ou une forte baisse d'un coup, change ta séance : un matin un peu bas ne veut rien dire.
          Pour que ce soit fiable : mesure-toi chaque matin au réveil, allongé, dans la même position.
        </span>
        <Link to="/test/fc-repos?court=1" className="pb-btn"><Icon name="heart" size="sm" />Mesurer ma VFC (3 min)</Link>
      </div>

      <div className="lbl section">Mes matins</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {history.length ? history.map(([d, v]) => (
          <div key={d} className="pb-li"><div className="t">{dayLabel(d)}</div><b className="pb-num">{Math.round(v)} ms</b></div>
        )) : <p className="pb-muted" style={{ padding: 16, margin: 0 }}>Aucune mesure pour l'instant.</p>}
      </div>
      <BottomNav />
    </main>
  );
}

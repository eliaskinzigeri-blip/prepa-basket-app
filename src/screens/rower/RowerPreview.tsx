// Aperçu d'une séance au rameur, et présentation du test de niveau (d'après RameFit).
import { useState } from "react";
import { useLight } from "../../state/readiness";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { BackButton, BottomAction, Notice, Sheet, Toggle } from "../../components/ui";
import { chrono } from "../../lib/format";
import { exercisesFor } from "../../lib/exercises";
import { DEFAULT_REF, ZONES, ageOf, needsParentConsent, rowerPlan, zonePace, type RowerKind, type RowInterval } from "../../lib/rower/plans";
import { hub, startDemo } from "../../lib/rower/rower";
import { RowSession, activeRow, type RowMeta } from "../../lib/rower/session";
import { latest, useApp, useProgression } from "../../state/app";
import { connectAny, errorText, useHub } from "./RowerConnect";

const KINDS: RowerKind[] = ["endurance", "warmup", "recup", "test"];

function detail(iv: RowInterval, ref: number) {
  const min = `${Math.round(iv.seconds / 60)} min`;
  const zone = iv.zone ? ` · ${ZONES[iv.zone].short}, effort ${ZONES[iv.zone].effort}/10 · ${zonePace(iv.zone, ref).map((s) => chrono(s)).join("–")} /500 m` : iv.isTest ? " · soutenu et régulier jusqu'au bout" : " · très facile";
  return `${min}${zone} · ${iv.spm[0]}–${iv.spm[1]} coups/min · résistance ${iv.resistance}`;
}

export default function RowerPreview() {
  useHub();
  const { kind = "" } = useParams();
  const [qs] = useSearchParams();
  const nav = useNavigate();
  const { profile, events, measurements } = useApp();
  const prog = useProgression();
  const [ask, setAsk] = useState(false);
  const [adult, setAdult] = useState(false);
  const [shoes, setShoes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventId = qs.get("event");
  const event = events.find((e) => e.id === eventId) ?? null;
  const light = useLight(event);

  if (!KINDS.includes(kind as RowerKind)) return <main className="pb-page screen no-nav"><div className="hdr"><BackButton /></div><Notice>Cette séance n'existe pas.</Notice></main>;

  const age = ageOf(profile);
  const junior15 = needsParentConsent(age);
  const plan = rowerPlan(kind as RowerKind, profile?.session_minutes);
  const refM = latest(measurements, "rower_ref").value;
  const ref = refM ?? DEFAULT_REF;
  const running = activeRow.session && !activeRow.session.getSnapshot().finished ? activeRow.session : null;
  const ready = shoes && (!junior15 || adult);

  function launch() {
    // Échauffement : la suite est la séance prévue, sur le banc replié si un exercice en a besoin.
    let next: RowMeta["next"] = null;
    if (kind === "warmup" && event) {
      const minutes = (event.end_min ?? 0) - (event.start_min ?? 0) - 15;
      const list = exercisesFor(event.payload.template ?? "haut", event.location, profile!, minutes, event.id, { ...prog, deload: event.payload.deload || light });
      next = { path: `/seance/${event.id}?echauffe=rameur`, bench: list.some((e) => e.equipment.includes("banc")) };
    }
    const s = new RowSession(plan, age, ref, { eventId: kind === "warmup" ? null : eventId, next });
    activeRow.session = s;
    s.start();
    nav("/rameur/seance", { replace: true });
  }

  function start() {
    if (running) return nav("/rameur/seance", { replace: true });
    if (hub.rower?.state !== "connected") return setAsk(true);
    launch();
  }

  async function connect() {
    setError(null);
    try { await connectAny(); setAsk(false); launch(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 130 }}>
      <div className="hdr"><BackButton /><span className="sp" /><span className="pill-sm">{Math.round(plan.seconds / 60)} min</span></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>{plan.title}</h1>
      <p className="lead">{plan.lead}</p>

      <div className="lbl section">Le déroulé</div>
      <ol className="pb-glass" style={{ padding: "4px 0", margin: 0, listStyle: "none" }}>
        {plan.intervals.map((iv) => <li key={iv.label} className="pb-li"><div className="t">{iv.label}<small className="pb-num">{detail(iv, ref)}</small></div></li>)}
      </ol>
      {plan.intervals.some((i) => i.zone) && refM == null ? <p className="pb-muted" style={{ margin: "8px 2px 0", fontSize: 13 }}>Allures indicatives : <Link to="/rameur/test">fais le test de 20 min</Link> pour les caler sur toi. En attendant, fie-toi au souffle : tu dois pouvoir parler.</p> : null}

      <div className="lbl section">Avant de ramer</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <div className="pb-li"><Icon name="check" className="pb-muted" /><div className="t">J'ai mis mes chaussures<small>Obligatoires d'après la notice, dans tous les modes.</small></div><Toggle on={shoes} onChange={setShoes} label="J'ai mis mes chaussures" /></div>
        {junior15 ? <div className="pb-li"><Icon name="user" className="pb-muted" /><div className="t">Un adulte est là et mes parents sont d'accord<small>Obligatoire avant 15 ans.</small></div><Toggle on={adult} onChange={setAdult} label="Un adulte est là et mes parents sont d'accord" /></div> : null}
      </div>
      <div style={{ marginTop: 10 }} className="col">
        <Notice>Rame à 22 coups par minute au moins : en dessous, la console peut s'éteindre.</Notice>
        {junior15 ? <Notice>Montre la notice à tes parents : un pictogramme de sécurité y barre la présence d'un enfant près du rameur, et aucun âge n'est indiqué. C'est à eux de décider.</Notice> : null}
      </div>

      <details className="pb-glass" style={{ marginTop: 12, padding: "12px 14px" }}>
        <summary style={{ fontWeight: 600 }}>Technique de rame</summary>
        <ul className="pb-muted" style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 14, display: "grid", gap: 6 }}>
          <li><b>Attaque :</b> jambes fléchies, tibias verticaux, bras tendus, dos droit.</li>
          <li><b>Poussée :</b> jambes, puis buste, puis bras.</li>
          <li><b>Finish :</b> buste légèrement en arrière, poignée sous la poitrine.</li>
          <li><b>Retour :</b> bras, buste, jambes, deux fois plus lent que le tirage.</li>
        </ul>
      </details>
      <details className="pb-glass" style={{ marginTop: 10, padding: "12px 14px" }}>
        <summary style={{ fontWeight: 600 }}>Quand t'arrêter</summary>
        <ul className="pb-muted" style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 14, display: "grid", gap: 6 }}>
          <li>Douleur dans la poitrine, essoufflement anormal, palpitations, vertiges ou nausées : arrête tout de suite et préviens un adulte.</li>
          <li>Douleur vive dans une articulation : arrête l'exercice.</li>
          <li>Mal au bas du dos : vérifie ta technique, le dos s'arrondit sûrement.</li>
        </ul>
      </details>

      <BottomAction><button className="pb-btn primary lg block" disabled={!ready && !running} onClick={start}><Icon name="play" size="sm" />{running ? "Reprendre la séance" : ready ? "Lancer la séance" : junior15 ? "Coche les deux points ci-dessus" : "Mets tes chaussures"}</button></BottomAction>

      {ask ? (
        <Sheet title="Rameur non connecté" onClose={() => setAsk(false)}>
          <p className="pb-muted" style={{ marginTop: 0, fontSize: 14 }}>Rame quelques coups pour réveiller la console, puis connecte-le.</p>
          {error ? <div style={{ marginBottom: 10 }}><Notice tone="error">{error}</Notice></div> : null}
          <div className="col" style={{ gap: 10 }}>
            <button className="pb-btn primary lg block" onClick={connect}>Connecter</button>
            <button className="pb-btn lg block" onClick={() => { startDemo(); setAsk(false); launch(); }}>Rameur simulé (rien n'est compté)</button>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}

export function RowerTestIntro() {
  const { measurements } = useApp();
  const last = latest(measurements, "rower_pace20");
  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 130 }}>
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Test de niveau au rameur</h1>
      <p className="lead">20 minutes à une allure soutenue que tu peux tenir jusqu'au bout. Il cale tes allures au rameur sur toi.</p>
      <div className="col" style={{ gap: 10, marginTop: 16 }}>
        <Notice>Ce test ne remplace pas le test navette, qui reste la mesure de ton objectif cardio.</Notice>
        <Notice>Pars moins vite que tu ne le crois, et arrête-toi en cas de douleur ou de malaise. 5 min d'échauffement sont prévues. Pas de test sur 2 000 m avant 16 ans.</Notice>
      </div>
      {last.value != null ? <p className="pb-muted pb-num" style={{ margin: "14px 2px 0" }}>Dernier test : {chrono(Math.round(last.value))} /500 m</p> : null}
      <BottomAction><Link className="pb-btn primary lg block" to="/rameur/apercu/test" replace><Icon name="play" size="sm" />Préparer le test</Link></BottomAction>
    </main>
  );
}

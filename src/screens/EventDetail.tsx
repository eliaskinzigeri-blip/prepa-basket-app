import { samePath, useActiveWorkout } from "../lib/activeWorkout";
import { useLight } from "../state/readiness";
import { ReadinessBanner } from "../components/Readiness";
import { STAGE_LABEL, levelIndex } from "../lib/progression";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp, useProgression } from "../state/app";
import { Icon } from "../components/Icon";
import { BackButton, BottomAction, CAT_COLOR, Chip, Notice, Sheet } from "../components/ui";
import { supabase } from "../lib/supabase";
import { addDays, ago, DAYS_SHORT, longDate, range, today, weekday } from "../lib/format";
import { CATEGORY_LABEL, game, TEMPLATES } from "../data/catalog";
import { dose, exercisesFor } from "../lib/exercises";
import { isPartial, PLACE_LABEL, startPath } from "../lib/nav";
import type { CalEvent } from "../lib/types";
import { freeIntervals, WARMUP_MIN } from "../lib/program";
import { HeartButton } from "../components/HeartButton";
import { testsFor } from "../lib/goals";
import { rowerOffer, rowerPlan, ZONES } from "../lib/rower/plans";

function initials(name: string) {
  const words = name.replace(/[^\p{L}\s-]/gu, " ").split(/[\s-]+/).filter((w) => w.length > 1 && !/^(de|du|des|la|le|les|et|bc|bb)$/i.test(w));
  return (words.slice(0, 3).map((w) => w[0]).join("") || name.slice(0, 3)).toUpperCase();
}

export default function EventDetail() {
  const { id } = useParams();
  const { events } = useApp();
  const e = events.find((x) => x.id === id);
  if (!e) return <main className="pb-page screen no-nav"><div className="hdr"><BackButton /></div><Notice>Cet événement n'existe plus.</Notice></main>;
  return e.type === "match" ? <MatchDetail e={e} /> : <SessionDetail e={e} />;
}

function MatchDetail({ e }: { e: CalEvent }) {
  const { events, profile, reloadEvents } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<"infos" | "autour">("infos");
  const [confirmDel, setConfirmDel] = useState(false);
  const p = e.payload;
  const myClub = profile?.ffbb_club?.name ?? "Mon équipe";
  const left = p.home ? { name: myClub, me: true } : { name: p.opponent ?? "", me: false };
  const right = p.home ? { name: p.opponent ?? "", me: false } : { name: myClub, me: true };
  const scoreL = p.home ? p.us : p.them;
  const scoreR = p.home ? p.them : p.us;
  const hasScore = p.us != null && p.them != null;
  const status = hasScore ? (p.us! > p.them! ? "Victoire · Final" : p.us! < p.them! ? "Défaite · Final" : "Nul · Final") : e.date < today() ? "Score pas encore publié" : "À venir";
  const around = [addDays(e.date, -1), e.date, addDays(e.date, 1)].flatMap((d) => events.filter((x) => x.date === d && x.type !== "club"));
  const mapsUrl = p.address || p.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.venue, p.address].filter(Boolean).join(" "))}` : null;

  async function remove() {
    await supabase.from("events").delete().eq("id", e.id);
    await reloadEvents();
    nav("/calendrier");
  }

  return (
    <main className="pb-page screen full no-nav">
      <div style={{ padding: "calc(env(safe-area-inset-top) + 16px) 20px 18px", borderRadius: "0 0 36px 36px", background: "linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04))", borderBottom: "1px solid var(--stroke-100)" }}>
        <div className="hdr"><BackButton /><span className="sp" /><Link to="/profil/notifications" className="pb-icon-btn" aria-label="Rappels de match"><Icon name="bell" /></Link></div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center", gap: 6, marginTop: 22 }}>
          {[left, null, right].map((side, i) => side ? (
            <div key={i} style={{ textAlign: "center" }}>
              <div className="pb-crest" style={side.me ? { background: "var(--primary)", color: "var(--ink)" } : undefined}>{initials(side.name)}</div>
              <div style={{ font: "600 14px/18px var(--font-sans)", overflowWrap: "anywhere", textWrap: "balance" }}>{side.name}</div>
              <div className="pb-subtle" style={{ fontSize: 12 }}>{side.me ? "Ton équipe" : p.home ? "Visiteur" : "Domicile"}</div>
            </div>
          ) : (
            <div key={i} className="pb-num" style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-.02em", textAlign: "center" }}>
              {hasScore ? <>{scoreL} <span className="pb-subtle">:</span> {scoreR}</> : <span style={{ fontSize: 28 }}>{range(e.start_min, null)}</span>}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <span className="pill-sm" style={{ color: hasScore ? (p.us! >= p.them! ? "var(--success)" : "var(--danger)") : "var(--ink-muted)" }}>
            {hasScore ? <Icon name={p.us! >= p.them! ? "check" : "x"} size="sm" style={{ width: 14, height: 14 }} /> : null}{status}
          </span>
        </div>
      </div>
      <div style={{ padding: "16px 20px 40px" }}>
        <div className="pb-chips" style={{ marginBottom: 14 }}>
          <Chip active={tab === "infos"} onClick={() => setTab("infos")}>Infos</Chip>
          <Chip active={tab === "autour"} onClick={() => setTab("autour")}>Séances autour</Chip>
          {p.team ? <span className="pb-chip" style={{ cursor: "default" }}>{p.team.split(" · ")[0]}</span> : null}
        </div>
        {tab === "infos" ? (
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            <div className="pb-li"><Icon name="cal" className="pb-muted" /><div className="t">{longDate(e.date)}<small>Coup d'envoi {range(e.start_min, null)}{e.start_min ? ` · RDV ${range(e.start_min - 45, null)}` : ""}</small></div></div>
            {mapsUrl ? (
              <a className="pb-li" href={mapsUrl} target="_blank" rel="noreferrer"><Icon name="pin" className="pb-muted" /><div className="t">{p.venue ?? "Salle"}<small>{p.address ?? ""} · {p.home ? "Domicile" : "Extérieur"}</small></div><Icon name="right" size="sm" className="pb-muted" /></a>
            ) : <div className="pb-li"><Icon name="pin" className="pb-muted" /><div className="t">Salle non renseignée<small>{p.home ? "Domicile" : "Extérieur"}</small></div></div>}
            {e.source === "ffbb" ? (
              <div className="pb-li"><Icon name="sync" className="pb-muted" /><div className="t">Synchro FFBB<small>Mis à jour {ago(profile?.ffbb_synced_at ?? null)}</small></div></div>
            ) : (
              <button className="pb-li" onClick={() => setConfirmDel(true)}><Icon name="trash" className="pb-muted" /><div className="t" style={{ color: "var(--danger)" }}>Supprimer ce match<small>Ajouté à la main</small></div></button>
            )}
            {p.competition ? <div className="pb-li"><Icon name="trophy" className="pb-muted" /><div className="t">{p.competition}</div></div> : null}
          </div>
        ) : null}
        <div className="lbl" style={{ margin: "18px 0 10px" }}>Programme adapté</div>
        <div className="col" style={{ gap: 8 }}>
          {around.length ? around.map((x) => {
            const note = x.date < e.date ? "Pas de jambes lourdes la veille" : x.date === e.date ? (x.type === "match" ? "Pas de test sprint / détente" : "Séance légère le jour du match") : "Récupération le lendemain";
            return (
              <Link key={x.id} to={x.type === "match" ? "#" : `/evenement/${x.id}`} className={`pb-ev ${x.type === "match" ? "match" : `c-${x.type === "test" ? "workout" : x.type}`}`}
                style={{ padding: "10px 12px 10px 14px", fontSize: 14, color: x.type === "match" ? "var(--bg-950)" : "var(--ink)", textDecoration: "none" }}>
                {DAYS_SHORT[weekday(x.date)]} · {x.type === "match" ? "Match" : x.title}<small>{note}{x.start_min != null && x.type !== "match" ? ` · ${range(x.start_min, x.end_min)}` : ""}</small>
              </Link>
            );
          }) : <p className="pb-muted" style={{ margin: 0 }}>Aucune séance autour de ce match.</p>}
        </div>
      </div>
      {confirmDel ? (
        <Sheet title="Supprimer ce match ?" onClose={() => setConfirmDel(false)}>
          <p style={{ marginTop: 0 }}>Le match disparaît de ton calendrier.</p>
          <div className="row">
            <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Garder</button>
            <button className="pb-btn lg danger" style={{ flex: 1 }} onClick={remove}>Supprimer</button>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}

function SessionDetail({ e }: { e: CalEvent }) {
  const { profile, slots, events, goals, reloadEvents, session } = useApp();
  const active = useActiveWorkout(session?.user.id);
  const running = Boolean(active && samePath(active, `/seance/${e.id}`));
  const prog = useProgression();
  const nav = useNavigate();
  const [moving, setMoving] = useState(false);
  const len = (e.end_min ?? 0) - (e.start_min ?? 0) || profile!.session_minutes + WARMUP_MIN;
  const heavy = e.type === "test" || (e.type === "workout" && TEMPLATES[e.payload.template ?? ""]?.heavyLegs);
  // Créneaux libres des 7 prochains jours (même règles que le glisser-déposer du calendrier).
  const options = moving ? Array.from({ length: 7 }, (_, k) => addDays(today(), k)).flatMap((d) => {
    if (events.some((x) => x.id !== e.id && x.date === d && ["workout", "basket", "test", "rest"].includes(x.type))) return [];
    if (heavy && events.some((x) => x.type === "match" && (x.date === d || x.date === addDays(d, 1)))) return [];
    return freeIntervals(d, profile!, slots, events, e.id).filter((i) => i.end - i.start >= len).slice(0, 2).map((i) => ({ d, start: i.start, location: i.location }));
  }) : [];
  async function moveTo(d: string, start: number, location: string) {
    await supabase.from("events").update({ date: d, start_min: start, end_min: start + len, location }).eq("id", e.id);
    await reloadEvents();
    setMoving(false);
  }
  const minutes = (e.end_min ?? 0) - (e.start_min ?? 0);
  const offer = rowerOffer(e, profile);
  const rowerSession = e.payload.rower ? rowerPlan(e.payload.rower, profile!.session_minutes) : null;
  const light = useLight(e);
  const list = e.type === "workout" && !rowerSession ? exercisesFor(e.payload.template ?? "haut", e.location, profile!, minutes - WARMUP_MIN, e.id, { ...prog, deload: e.payload.deload || light }) : [];

  async function skip() {
    await supabase.from("events").update({ status: e.status === "skipped" ? "planned" : "skipped" }).eq("id", e.id);
    await reloadEvents();
  }

  return (
    <main className="pb-page screen no-nav" style={e.status === "planned" && !running ? { paddingBottom: 190 } : undefined}>
      <div className="hdr"><BackButton /><span className="sp" /><span className="pill-sm"><span className="sw" style={{ background: CAT_COLOR[e.type] }} />{CATEGORY_LABEL[e.type]}</span></div>
      <h1 className="t" style={{ margin: "20px 0 6px" }}>{e.title}</h1>
      <p className="lead">{longDate(e.date)}{e.start_min != null ? ` · ${range(e.start_min, e.end_min)}` : ""}{e.location ? ` · ${PLACE_LABEL[e.location] ?? e.location}` : ""}</p>
      {e.status === "done" ? <div style={{ marginTop: 14 }}>{isPartial(e) ? <Notice>Séance partiellement faite : tu l'as arrêtée en cours de route.</Notice> : <Notice tone="ok">Séance terminée.</Notice>}</div> : null}
      {e.status === "skipped" ? <div style={{ marginTop: 14 }}><Notice>Séance annulée.</Notice></div> : null}
      {e.payload.deload && e.status === "planned" ? <div style={{ marginTop: 14 }}><Notice>Semaine allégée : une série de moins sur chaque exercice. Ton corps assimile le travail des 3 semaines précédentes, c'est là que tu progresses.</Notice></div> : null}
      <ReadinessBanner e={e} />
      {e.payload.note && e.payload.template === "recup" ? <p className="pb-muted" style={{ margin: "10px 0 0", fontSize: 14 }}>{e.payload.note}</p> : null}
      {e.status === "planned" && e.type !== "rest" && e.type !== "club" ? <div style={{ marginTop: 14 }}><HeartButton hint="Mets ta ceinture avant de commencer : ta FC est enregistrée avec la séance." /></div> : null}
      {e.type === "rest" ? <p className="lead" style={{ marginTop: 16 }}>Jour de repos : laisse tes muscles et tes articulations récupérer. Marche, étirements doux, sommeil.</p> : null}
      {rowerSession ? (
        <>
          <div className="lbl section">Au rameur · {Math.round(rowerSession.seconds / 60)} min</div>
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            {rowerSession.intervals.map((iv) => <div key={iv.label} className="pb-li"><div className="t">{iv.label}<small>{Math.round(iv.seconds / 60)} min{iv.zone ? ` · ${ZONES[iv.zone].short}, facile` : " · très facile"} · {iv.spm[0]}–{iv.spm[1]} coups/min · résistance {iv.resistance}</small></div></div>)}
          </div>
        </>
      ) : null}
      {e.type === "workout" && !rowerSession ? (
        <>
          {offer && e.status === "planned" && !running ? (
            <Link to={`/rameur/apercu/${offer.kind}?event=${e.id}`} className="pb-glass pb-li" style={{ marginTop: 14, borderRadius: 16 }}>
              <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--primary-bright)" }}><Icon name="rower" size="sm" /></div>
              <div className="t">{offer.kind === "recup" ? "Récupérer au rameur" : "S'échauffer au rameur"}<small>{offer.note}</small></div>
              <Icon name="right" size="sm" className="pb-muted" />
            </Link>
          ) : null}
          <div className="lbl section">{TEMPLATES[e.payload.template ?? ""]?.title ?? "Workout"} · {list.length} exercices</div>
          <LevelNote prog={prog} />
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            {list.map((x) => (
              <Link key={x.id} to={`/exercice/${x.id}?lieu=${e.location ?? "maison"}`} className="pb-li">
                <div className="t">{x.name}<small>{dose(x)} · {x.muscles}</small></div><Icon name="right" size="sm" className="pb-muted" />
              </Link>
            ))}
          </div>
        </>
      ) : null}
      {e.type === "basket" ? (
        <>
          <div className="lbl section">{e.payload.mode === "shoot" ? "Jeux de shoot" : "Jeux de dribble"}</div>
          <div className="pb-glass" style={{ padding: "4px 0" }}>
            {(e.payload.games ?? []).map((g) => <div key={g} className="pb-li"><div className="t">{game(g)?.name}<small>{game(g)?.desc}</small></div></div>)}
          </div>
        </>
      ) : null}
      {e.type === "test" ? <p className="lead" style={{ marginTop: 16 }}>{testsFor(goals).length ? `Les tests de tes objectifs : ${testsFor(goals).map((x) => x.label.toLowerCase()).join(", ")}.` : "Sprint 10 m et 20 m, détente verticale, saut en longueur, agilité."} 3 essais par test, le meilleur est retenu.</p> : null}
      {e.type !== "rest" && e.type !== "club" ? (
        <BottomAction>
          {e.status === "planned" && !running ? <button className="pb-btn lg" style={{ flex: 1 }} onClick={() => setMoving(true)}>Déplacer</button> : null}
          {e.status !== "done" && !running ? <button className="pb-btn lg" style={{ flex: 1 }} onClick={skip}>{e.status === "skipped" ? "Rétablir" : "Annuler"}</button> : null}
          {e.status === "planned" ? <button className="pb-btn primary lg" style={{ flex: "1 1 100%" }} onClick={() => nav(startPath(e))}><Icon name="play" size="sm" />{running ? "Reprendre la séance" : "Commencer"}</button> : null}
        </BottomAction>
      ) : null}
      {moving ? (
        <Sheet title="Déplacer la séance" onClose={() => setMoving(false)}>
          <p className="pb-muted" style={{ marginTop: 0, fontSize: 14 }}>Créneaux libres des 7 prochains jours, sans cours ni autre séance.</p>
          {options.length ? (
            <div className="pb-glass" style={{ padding: "4px 0" }}>
              {options.map((o) => (
                <button key={o.d + o.start} className="pb-li" onClick={() => moveTo(o.d, o.start, o.location)}>
                  <div className="t">{longDate(o.d)}<small>{range(o.start, o.start + len)} · {PLACE_LABEL[o.location]}</small></div>
                  <Icon name="right" size="sm" className="pb-muted" />
                </button>
              ))}
            </div>
          ) : <Notice>Aucun créneau libre assez long cette semaine.</Notice>}
        </Sheet>
      ) : null}
    </main>
  );
}

function LevelNote({ prog }: { prog: ReturnType<typeof useProgression> }) {
  return (
    <p className="pb-muted" style={{ margin: "0 2px 10px", fontSize: 13 }}>
      Niveau {STAGE_LABEL[prog.stage].toLowerCase()} · palier {levelIndex(prog)}/12.{" "}
      {prog.lestKg
        ? `Niveau max dépassé : leste-toi de ${String(prog.lestKg).replace(".", ",")} kg (gilet lesté ou sac à dos) sur les exercices au poids du corps.${prog.toNext == null ? " C'est le lest maximum conseillé pour toi." : ` Lest plus lourd dans ${prog.toNext} séance${prog.toNext > 1 ? "s" : ""}.`}`
        : prog.stage === 3 && prog.step === 3
          ? `Dernier palier ! Encore ${prog.toNext} séance${prog.toNext! > 1 ? "s" : ""} et tu passeras aux exercices lestés.`
          : `Encore ${prog.toNext} séance${prog.toNext! > 1 ? "s" : ""} pour passer au palier suivant (plus de volume${prog.step === 3 ? ", puis des exercices plus durs" : ""}).`}
    </p>
  );
}

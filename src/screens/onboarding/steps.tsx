import { useEffect, useState } from "react";
import { EXPERIENCES, HOME_EQUIPMENT, LEVELS, POSITIONS, SKILLS, WORKOUT_PLACES } from "../../data/catalog";
import { Chip, Notice, Spinner, Toggle } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { ffbb } from "../../lib/data";
import { DAYS_SHORT, hm, longDate, num, range } from "../../lib/format";
import type { Place, Profile } from "../../lib/types";
import { toMin, toTime, type Week } from "./week";
import { TrackfitGuide } from "../../components/TrackfitGuide";

export type Draft = Partial<Profile> & { week: Week };
export interface StepProps { draft: Draft; set: (patch: Partial<Draft>) => void; showErrors: boolean; trackfitWeight?: number | null }

// ——— 1. Profil joueur (US2) ———
export function StepProfile({ draft, set, showErrors, trackfitWeight }: StepProps) {
  const e = profileErrors(draft);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="field">
        <label className="lbl" htmlFor="fn">Prénom</label>
        <input id="fn" className="input" autoComplete="given-name" value={draft.first_name ?? ""} onChange={(ev) => set({ first_name: ev.target.value })}
          aria-invalid={showErrors && Boolean(e.first_name)} placeholder="Ton prénom…" />
        {showErrors && e.first_name ? <p className="err">{e.first_name}</p> : null}
      </div>
      <div className="field">
        <label className="lbl" htmlFor="bd">Date de naissance</label>
        <input id="bd" className="input" type="date" autoComplete="bday" value={draft.birth_date ?? ""} max="2016-12-31" min="1960-01-01"
          onChange={(ev) => set({ birth_date: ev.target.value })} aria-invalid={showErrors && Boolean(e.birth_date)} />
        {showErrors && e.birth_date ? <p className="err">{e.birth_date}</p> : null}
      </div>
      <div className="grid2">
        <div className="field">
          <label className="lbl" htmlFor="h">Taille</label>
          <div className="input-unit">
            <input id="h" className="input" inputMode="numeric" value={draft.height_cm ?? ""} placeholder="180…"
              onChange={(ev) => set({ height_cm: Number(ev.target.value.replace(/\D/g, "")) || null })} aria-invalid={showErrors && Boolean(e.height_cm)} />
            <span>cm</span>
          </div>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="w">Poids</label>
          <div className="input-unit">
            <input id="w" className="input" inputMode="decimal" value={draft.weight_kg != null ? String(draft.weight_kg).replace(".", ",") : ""} placeholder="72,4…"
              onChange={(ev) => { const v = parseFloat(ev.target.value.replace(",", ".")); set({ weight_kg: Number.isFinite(v) ? v : null }); }}
              aria-invalid={showErrors && Boolean(e.weight_kg)} />
            <span>kg</span>
          </div>
        </div>
      </div>
      {showErrors && (e.height_cm || e.weight_kg) ? <p className="err">{e.height_cm ?? e.weight_kg}</p> : null}
      {trackfitWeight != null ? <p className="pb-muted" style={{ margin: 0, fontSize: 13 }}>Poids récupéré depuis TrackFit : {num(trackfitWeight, 1)} kg.</p> : null}
      <div className="field">
        <span className="lbl">Main forte</span>
        <div className="grid2">
          {(["droite", "gauche"] as const).map((h) => (
            <Chip key={h} active={draft.strong_hand === h} onClick={() => set({ strong_hand: h })}>{h === "droite" ? "Droite" : "Gauche"}</Chip>
          ))}
        </div>
        {showErrors && e.strong_hand ? <p className="err">{e.strong_hand}</p> : null}
      </div>
    </div>
  );
}
export function profileErrors(d: Draft) {
  const out: Record<string, string> = {};
  if (!d.first_name?.trim()) out.first_name = "Indique ton prénom.";
  if (!d.birth_date) out.birth_date = "Indique ta date de naissance.";
  if (!d.height_cm || d.height_cm < 120 || d.height_cm > 240) out.height_cm = "Indique une taille entre 120 et 240 cm.";
  if (!d.weight_kg || d.weight_kg < 30 || d.weight_kg > 200) out.weight_kg = "Indique un poids entre 30 et 200 kg.";
  if (!d.strong_hand) out.strong_hand = "Choisis ta main forte.";
  return out;
}

// ——— 2. Profil basket (US3) ———
export function StepBasket({ draft, set, showErrors }: StepProps) {
  return (
    <div className="col" style={{ gap: 22 }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="lbl" style={{ marginBottom: 10 }}>Poste</legend>
        <div className="wrap">{POSITIONS.map((p) => <Chip key={p.id} active={draft.position === p.id} onClick={() => set({ position: p.id })}>{p.label}</Chip>)}</div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="lbl" style={{ marginBottom: 10 }}>Depuis combien de temps tu joues</legend>
        <div className="wrap">{EXPERIENCES.map((p) => <Chip key={p.id} active={draft.experience === p.id} onClick={() => set({ experience: p.id })}>{p.label}</Chip>)}</div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="lbl" style={{ marginBottom: 10 }}>Niveau</legend>
        <div className="wrap">{LEVELS.map((p) => <Chip key={p.id} active={draft.level === p.id} onClick={() => set({ level: p.id })}>{p.label}</Chip>)}</div>
      </fieldset>
      {showErrors && !(draft.position && draft.experience && draft.level) ? <p className="err">Choisis ton poste, ton ancienneté et ton niveau.</p> : null}
    </div>
  );
}

// ——— 3. Club FFBB (US16) ———
interface Club { id: string; name: string; city: string }
interface PreviewMatch { external_id: string; date: string; start_min: number | null; opponent: string; home: boolean; venue: string | null }

export function StepFfbb({ draft, set }: StepProps) {
  const [q, setQ] = useState(draft.ffbb_club?.name ?? "");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [teams, setTeams] = useState<{ id: string; label: string }[] | null>(null);
  const [matches, setMatches] = useState<PreviewMatch[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const club = draft.ffbb_club;
  const team = draft.ffbb_team;

  useEffect(() => {
    if (club || q.trim().length < 3) return setClubs([]);
    const t = setTimeout(() => {
      setBusy("Recherche des clubs…");
      setError(null);
      ffbb<{ clubs: Club[] }>({ action: "clubs", q })
        .then((r) => setClubs(r.clubs))
        .catch((e) => setError(e.message))
        .finally(() => setBusy(null));
    }, 350);
    return () => clearTimeout(t);
  }, [q, club]);

  useEffect(() => {
    if (!club) return setTeams(null);
    setBusy("Chargement des équipes engagées…");
    setError(null);
    ffbb<{ teams: { id: string; label: string }[] }>({ action: "teams", clubId: club.id, clubName: club.name })
      .then((r) => setTeams(r.teams))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  }, [club]);

  useEffect(() => {
    if (!club || !team) return setMatches(null);
    setBusy("Récupération des matchs…");
    ffbb<{ matches: PreviewMatch[] }>({ action: "preview", clubId: club.id, clubName: club.name, teamId: team.id, teamLabel: team.label })
      .then((r) => setMatches(r.matches))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  }, [club, team]);

  return (
    <div className="col">
      {!club ? (
        <>
          <div className="field">
            <label className="lbl" htmlFor="club">Ton club</label>
            <div style={{ position: "relative" }}>
              <input id="club" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du club ou ville…" autoComplete="off" style={{ paddingLeft: 44 }} />
              <Icon name="search" size="sm" className="pb-subtle" style={{ position: "absolute", left: 16, top: 19 }} />
            </div>
          </div>
          {clubs.length ? (
            <div className="pb-glass" style={{ padding: "4px 0" }}>
              {clubs.map((c) => (
                <button key={c.id} className="pb-li" onClick={() => { set({ ffbb_club: { id: c.id, name: c.name, city: c.city }, ffbb_team: null }); }}>
                  <div className="t">{c.name}<small>{c.city}</small></div>
                  <Icon name="right" size="sm" className="pb-muted" />
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="pb-glass" style={{ padding: "4px 0" }}>
          <div className="pb-li">
            <div className="pb-tile" style={{ width: 40, height: 40, color: "var(--cat-match)" }}><Icon name="ball" size="sm" /></div>
            <div className="t">{club.name}<small>{club.city}</small></div>
            <button className="link" onClick={() => { set({ ffbb_club: null, ffbb_team: null }); setQ(""); }}>Changer</button>
          </div>
        </div>
      )}
      {club && teams ? (
        teams.length ? (
          <>
            <span className="lbl" style={{ marginTop: 8 }}>Ton équipe</span>
            <div className="wrap">{teams.map((t) => <Chip key={t.id} active={team?.id === t.id} onClick={() => set({ ffbb_team: t })}>{t.label}</Chip>)}</div>
          </>
        ) : <Notice>Aucune équipe trouvée pour ce club cette saison. Tu pourras ajouter tes matchs à la main.</Notice>
      ) : null}
      {matches ? (
        <>
          <span className="lbl" style={{ marginTop: 8 }}>Prochains matchs</span>
          {matches.length ? (
            <div className="pb-glass" style={{ padding: "4px 0" }}>
              {matches.slice(0, 4).map((m) => (
                <div key={m.external_id} className="pb-li">
                  <span className="pill-sm" style={{ background: "var(--cat-match)", color: "var(--bg-950)", borderColor: "transparent" }}>{longDate(m.date).split(" ").slice(0, 2).join(" ")}</span>
                  <div className="t">vs {m.opponent}<small>{hm(m.start_min)} · {m.home ? "Domicile" : "Extérieur"}</small></div>
                </div>
              ))}
            </div>
          ) : <Notice>Pas encore de match publié pour cette équipe. Ils s'ajouteront à la prochaine synchro.</Notice>}
        </>
      ) : null}
      {busy ? <Spinner label={busy} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

// ——— 4. Priorités (US4) ———
export function StepPriorities({ draft, set, showErrors }: StepProps) {
  const high = draft.priorities_high ?? [];
  const low = draft.priorities_low ?? [];
  const toggleHigh = (id: string) => {
    if (high.includes(id)) set({ priorities_high: high.filter((x) => x !== id) });
    else if (high.length < 2) set({ priorities_high: [...high, id], priorities_low: low.filter((x) => x !== id) });
  };
  const toggleLow = (id: string) => {
    if (low.includes(id)) set({ priorities_low: low.filter((x) => x !== id) });
    else if (low.length < 3) set({ priorities_low: [...low, id] });
  };
  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}><span className="lbl">Beaucoup améliorer</span><span className="pill-sm" style={{ color: "var(--primary-bright)" }}>{high.length}/2</span></div>
      <div className="wrap" style={{ marginBottom: 24 }} role="group" aria-label="Beaucoup améliorer (2 maximum)">
        {SKILLS.map((s) => (
          <Chip key={s.id} active={high.includes(s.id)} icon={high.includes(s.id) ? "check" : undefined} onClick={() => toggleHigh(s.id)} disabled={!high.includes(s.id) && high.length >= 2}>{s.label}</Chip>
        ))}
      </div>
      <div className="row between" style={{ marginBottom: 10 }}><span className="lbl">Un peu améliorer</span><span className="pill-sm">{low.length}/3</span></div>
      <div className="wrap" style={{ marginBottom: 26 }} role="group" aria-label="Un peu améliorer (3 maximum)">
        {SKILLS.filter((s) => !high.includes(s.id)).map((s) => (
          <Chip key={s.id} soft={low.includes(s.id)} onClick={() => toggleLow(s.id)} disabled={!low.includes(s.id) && low.length >= 3}>{s.label}</Chip>
        ))}
      </div>
      {showErrors && (high.length < 1 || low.length < 1) ? <p className="err" style={{ marginBottom: 12 }}>Choisis 1 à 2 compétences à beaucoup améliorer et 1 à 3 à un peu améliorer.</p> : null}
      <div className="pb-glass" style={{ padding: 16 }}>
        <div className="row between" style={{ marginBottom: 12 }}><h3 className="s" style={{ fontSize: 15 }}>Répartition du volume</h3><span className="pb-subtle" style={{ fontSize: 13 }}>par semaine</span></div>
        <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", gap: 3 }}>
          <span style={{ flex: 60, background: "var(--primary)" }} /><span style={{ flex: 25, background: "var(--primary-bright)" }} /><span style={{ flex: 15, background: "var(--heat)" }} />
        </div>
        <div className="row between" style={{ marginTop: 10, font: "500 12px var(--font-sans)" }}>
          <span><b className="pb-num" style={{ fontSize: 15 }}>60 %</b> <span className="pb-muted">fortes</span></span>
          <span><b className="pb-num" style={{ fontSize: 15 }}>25 %</b> <span className="pb-muted">légères</span></span>
          <span><b className="pb-num" style={{ fontSize: 15 }}>15 %</b> <span className="pb-muted">entretien</span></span>
        </div>
      </div>
    </div>
  );
}

// ——— 5. Lieux & matériel (US17) ———
export function StepPlaces({ draft, set, showErrors }: StepProps) {
  const locs = draft.workout_locations ?? [];
  const eq = draft.home_equipment ?? [];
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="col" style={{ gap: 22 }}>
      <div>
        <span className="lbl">Où tu fais ton workout</span>
        <div className="wrap" style={{ marginTop: 10 }}>
          {WORKOUT_PLACES.map((p) => <Chip key={p.id} active={locs.includes(p.id)} icon={locs.includes(p.id) ? "check" : undefined} onClick={() => set({ workout_locations: toggle(locs, p.id) })}>{p.label}</Chip>)}
        </div>
        {locs.includes("basicfit") ? <p className="pb-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>À Basic-Fit, on compte sur les machines et les poids libres standard du club.</p> : null}
      </div>
      {locs.includes("maison") ? (
        <div>
          <span className="lbl">Ton matériel à la maison</span>
          <div className="wrap" style={{ marginTop: 10 }}>
            <Chip active={eq.length === 0} onClick={() => set({ home_equipment: [] })}>Rien</Chip>
            {HOME_EQUIPMENT.map((p) => <Chip key={p.id} active={eq.includes(p.id)} onClick={() => set({ home_equipment: toggle(eq, p.id) })}>{p.label}</Chip>)}
          </div>
        </div>
      ) : null}
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <div className="pb-li">
          <Icon name="hoop" className="pb-muted" />
          <div className="t">J'ai un panier chez moi<small>Les sessions de shoot pourront se faire à la maison</small></div>
          <Toggle on={Boolean(draft.has_hoop)} onChange={(v) => set({ has_hoop: v })} label="J'ai un panier chez moi" />
        </div>
      </div>
      {showErrors && !locs.length ? <p className="err">Choisis au moins un lieu.</p> : null}
    </div>
  );
}

// ——— 6. Semaine type (US5) ———
const PLACES: { id: Place; label: string }[] = [{ id: "maison", label: "Maison" }, { id: "salle", label: "Salle" }, { id: "terrain", label: "Terrain" }];

export function StepWeek({ draft, set }: StepProps) {
  const [tab, setTab] = useState<"A" | "B">("A");
  const w = draft.week;
  const setWeek = (patch: Partial<Week>) => set({ week: { ...w, ...patch } });
  const classes = w.ab ? w.classes[tab] : w.classes.A;
  const setClass = (d: number, v: { start: number; end: number } | null) => {
    const next = { ...w.classes, [w.ab ? tab : "A"]: classes.map((c, i) => (i === d ? v : c)) };
    if (!w.ab) next.B = next.A;
    setWeek({ classes: next });
  };
  const latest = draft.latest_min ?? 1260;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="pb-chips">
        <Chip active={!w.ab || tab === "A"} onClick={() => setTab("A")} pressed={!w.ab || tab === "A"}>Semaine A</Chip>
        {w.ab ? <Chip active={tab === "B"} onClick={() => setTab("B")} pressed={tab === "B"}>Semaine B</Chip> : null}
        <Chip icon={w.ab ? "x" : "plus"} onClick={() => { setWeek({ ab: !w.ab, classes: { A: w.classes.A, B: w.classes.A } }); setTab("A"); }} pressed={w.ab}>
          {w.ab ? "Une seule semaine" : "Semaines A / B"}
        </Chip>
      </div>
      {w.ab ? <p className="pb-muted" style={{ margin: 0, fontSize: 13 }}>La semaine en cours compte comme semaine A.</p> : null}

      <WeekPreview classes={classes} clubs={w.clubs} latest={latest} />

      <span className="lbl" style={{ marginTop: 6 }}>Cours, jour par jour</span>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {DAYS_SHORT.slice(0, 6).map((d, i) => {
          const c = classes[i];
          return (
            <div key={d} className="pb-li" style={{ gap: 8 }}>
              <span className="pill-sm" style={{ width: 46, justifyContent: "center" }}>{d}</span>
              {c ? (
                <>
                  <input aria-label={`${d} début des cours`} className="input" type="time" step={900} value={toTime(c.start)} style={{ height: 44, padding: "0 6px", flex: "1 1 0", minWidth: 0, fontSize: 15 }}
                    onChange={(e) => e.target.value && setClass(i, { ...c, start: toMin(e.target.value) })} />
                  <span className="pb-muted">–</span>
                  <input aria-label={`${d} fin des cours`} className="input" type="time" step={900} value={toTime(c.end)} style={{ height: 44, padding: "0 6px", flex: "1 1 0", minWidth: 0, fontSize: 15 }}
                    onChange={(e) => e.target.value && setClass(i, { ...c, end: toMin(e.target.value) })} />
                  <button className="pb-icon-btn sm" aria-label={`Pas cours le ${d}`} onClick={() => setClass(i, null)}><Icon name="x" size="sm" /></button>
                </>
              ) : (
                <>
                  <span className="t pb-muted">Pas cours</span>
                  <button className="link" onClick={() => setClass(i, { start: 8 * 60, end: 17 * 60 })}>Ajouter</button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <span className="lbl" style={{ marginTop: 6 }}>Entraînements club</span>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {w.clubs.map((c, i) => (
          <div key={i} className="pb-li" style={{ gap: 8 }}>
            <select aria-label="Jour de l'entraînement" className="input" value={c.weekday} style={{ height: 44, width: 92, padding: "0 30px 0 10px" }}
              onChange={(e) => setWeek({ clubs: w.clubs.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)) })}>
              {DAYS_SHORT.map((d, k) => <option key={d} value={k}>{d}</option>)}
            </select>
            <input aria-label="Début" className="input" type="time" step={900} value={toTime(c.start)} style={{ height: 44, padding: "0 6px", flex: "1 1 0", minWidth: 0, fontSize: 15 }}
              onChange={(e) => e.target.value && setWeek({ clubs: w.clubs.map((x, j) => (j === i ? { ...x, start: toMin(e.target.value) } : x)) })} />
            <input aria-label="Fin" className="input" type="time" step={900} value={toTime(c.end)} style={{ height: 44, padding: "0 6px", flex: "1 1 0", minWidth: 0, fontSize: 15 }}
              onChange={(e) => e.target.value && setWeek({ clubs: w.clubs.map((x, j) => (j === i ? { ...x, end: toMin(e.target.value) } : x)) })} />
            <button className="pb-icon-btn sm" aria-label="Supprimer l'entraînement" onClick={() => setWeek({ clubs: w.clubs.filter((_, j) => j !== i) })}><Icon name="x" size="sm" /></button>
          </div>
        ))}
        <button className="pb-li" onClick={() => setWeek({ clubs: [...w.clubs, { weekday: 2, start: 18 * 60, end: 19 * 60 + 30 }] })}>
          <Icon name="plus" className="pb-muted" /><span className="t">Ajouter un entraînement</span>
        </button>
      </div>
      <p className="pb-muted" style={{ margin: 0, fontSize: 13 }}>Les matchs arrivent du connecteur FFBB.</p>

      <span className="lbl" style={{ marginTop: 6 }}>Lieu possible en dehors des cours</span>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {DAYS_SHORT.map((d, i) => (
          <div key={d} className="pb-li" style={{ gap: 6 }}>
            <span className="pill-sm" style={{ width: 46, justifyContent: "center" }}>{d}</span>
            <div className="row" style={{ gap: 6, flex: 1, justifyContent: "flex-end" }}>
              {PLACES.map((p) => (
                <button key={p.id} type="button" className={`pb-chip${w.places[i] === p.id ? " active" : ""}`} aria-pressed={w.places[i] === p.id} aria-label={`${d} : ${p.label}`} style={{ height: 36, padding: "0 10px", fontSize: 13 }}
                  onClick={() => setWeek({ places: w.places.map((x, k) => (k === i ? p.id : x)) })}>{p.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid2" style={{ marginTop: 6 }}>
        <label className="pb-glass inset" style={{ padding: "12px 14px", borderRadius: 16 }}>
          <span className="lbl">Zone vacances</span>
          <select className="input" value={draft.vacation_zone ?? ""} onChange={(e) => set({ vacation_zone: (e.target.value || null) as "A" | "B" | "C" | null })}
            style={{ height: 40, marginTop: 6, background: "transparent", border: 0, boxShadow: "none", padding: "0 30px 0 0", font: "600 20px var(--font-display)" }}>
            <option value="">Aucune</option><option value="A">Zone A</option><option value="B">Zone B</option><option value="C">Zone C</option>
          </select>
        </label>
        <label className="pb-glass inset" style={{ padding: "12px 14px", borderRadius: 16 }}>
          <span className="lbl">Heure limite</span>
          <input className="input" type="time" step={900} value={toTime(latest)} onChange={(e) => e.target.value && set({ latest_min: toMin(e.target.value) })}
            style={{ height: 40, marginTop: 6, background: "transparent", border: 0, boxShadow: "none", padding: 0, font: "600 20px var(--font-display)" }} />
        </label>
      </div>
      <span className="lbl" style={{ marginTop: 6 }}>Durée de séance préférée</span>
      <div className="grid4">
        {([30, 45, 60, 90] as const).map((m) => (
          <Chip key={m} active={(draft.session_minutes ?? 45) === m} onClick={() => set({ session_minutes: m })}>{m} min</Chip>
        ))}
      </div>
    </div>
  );
}

function WeekPreview({ classes, clubs, latest }: { classes: ({ start: number; end: number } | null)[]; clubs: Week["clubs"]; latest: number }) {
  const H0 = 8 * 60, H1 = 22 * 60, span = H1 - H0;
  const y = (m: number) => `${((Math.min(Math.max(m, H0), H1) - H0) / span) * 100}%`;
  const h = (a: number, b: number) => `${((Math.min(b, H1) - Math.max(a, H0)) / span) * 100}%`;
  return (
    <div className="pb-glass" style={{ padding: "12px 12px 10px" }} aria-label="Aperçu de ta semaine">
      <div style={{ display: "grid", gridTemplateColumns: "28px repeat(6,minmax(0,1fr))", gap: 4, font: "500 11px var(--font-sans)", color: "var(--ink-subtle)" }}>
        <span />{DAYS_SHORT.slice(0, 6).map((d) => <span key={d} style={{ textAlign: "center" }}>{d}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "28px repeat(6,minmax(0,1fr))", gap: 4, marginTop: 6, height: 200, position: "relative" }}>
        <div style={{ position: "relative" }}>
          {[8, 12, 16, 20].map((hh) => <span key={hh} style={{ position: "absolute", top: y(hh * 60), fontSize: 10, color: "var(--ink-subtle)" }}>{hh}h</span>)}
        </div>
        {DAYS_SHORT.slice(0, 6).map((d, i) => (
          <div key={d} style={{ position: "relative" }}>
            {classes[i] ? <div className="pb-ev class" style={{ position: "absolute", left: 0, right: 0, top: y(classes[i]!.start), height: h(classes[i]!.start, classes[i]!.end), padding: "3px 4px", fontSize: 10 }}>Cours</div> : null}
            {clubs.filter((c) => c.weekday === i).map((c, k) => (
              <div key={k} className="pb-ev c-club" style={{ position: "absolute", left: 0, right: 0, top: y(c.start), height: h(c.start, c.end), padding: "2px 4px", fontSize: 10 }}>Club</div>
            ))}
          </div>
        ))}
        <div style={{ position: "absolute", left: 32, right: 0, top: y(latest), borderTop: "2px dashed var(--danger)", font: "600 10px var(--font-sans)", color: "var(--danger)", paddingTop: 2 }}>
          Heure limite {hm(latest)}
        </div>
      </div>
      {clubs.some((c) => c.weekday === 6) ? <p className="pb-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>+ entraînement le dimanche ({clubs.filter((c) => c.weekday === 6).map((c) => range(c.start, c.end)).join(", ")})</p> : null}
    </div>
  );
}

// ——— 7. TrackFit (US10) ———
export function StepTrackfit({ draft, set }: StepProps) {
  const connected = Boolean(draft.trackfit_connected);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="pb-glass" style={{ padding: 16 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="pb-tile" style={{ width: 48, height: 48, color: "var(--success)" }}><Icon name="scale" /></div>
          <div><b style={{ fontSize: 16 }}>TrackFit</b><div className="pb-muted" style={{ fontSize: 13 }}>Poids, masse grasse, masse musculaire, fréquence cardiaque au repos</div></div>
        </div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: "21px" }}>Chaque nouvelle pesée arrive dans l'app en moins d'une minute. Tu peux déconnecter TrackFit à tout moment et saisir ton poids à la main.</p>
      </div>
      {connected ? (
        <>
          <Notice tone="ok">TrackFit est autorisé. Branche ta balance en 2 minutes (tu peux aussi le faire plus tard dans Profil › TrackFit) :</Notice>
          <TrackfitGuide token={draft.trackfit_token!} />
        </>
      ) : (
        <label className="pb-glass" style={{ padding: 16, display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" style={{ width: 22, height: 22, marginTop: 2, accentColor: "var(--primary)" }}
            onChange={(e) => set({ trackfit_connected: e.target.checked, trackfit_consent_at: e.target.checked ? new Date().toISOString() : null })} />
          <span style={{ fontSize: 14, lineHeight: "21px" }}>J'accepte que Prépa Basket reçoive mes données corporelles depuis TrackFit pour suivre ma progression. Elles ne sont jamais partagées.</span>
        </label>
      )}
    </div>
  );
}

import { useMemo, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApp } from "../state/app";
import { Icon } from "../components/Icon";
import { BottomNav, CAT_COLOR, Chip, IconButton, Notice, Sheet } from "../components/ui";
import { supabase } from "../lib/supabase";
import { addDays, DAYS_SHORT, longDate, mondayOf, monthTitle, parse, range, today, weekday, weekRange, iso } from "../lib/format";
import { freeIntervals, heavyForbidden, isHeavySession, relocate, weekType } from "../lib/program";
import { regenerateProgram } from "../lib/data";
import { isDone, isPartial, PLACE_LABEL, startPath } from "../lib/nav";
import { toMin } from "./onboarding/week";
import type { CalEvent, Slot } from "../lib/types";
import { isHoliday } from "../data/catalog";

const H0 = 8 * 60;
const H1 = 22 * 60;
const PX = 0.42; // pixels par minute → 14 h ≈ 353 px
const SNAP = 15;
const MOVABLE = new Set(["workout", "basket", "test"]);
const CLASS_NAME: Record<string, string> = { workout: "c-workout", basket: "c-basket", club: "c-club", rest: "c-rest", test: "c-workout" };

type View = "week" | "month" | "matches";

export default function Calendar() {
  const { profile, slots, events, reloadEvents, reload } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const t = today();
  const selectedDay = params.get("jour") ?? t;
  const [view, setView] = useState<View>((params.get("vue") as View) ?? "week");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"block" | "match" | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const monday = mondayOf(selectedDay);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const setDay = (d: string) => setParams((p) => { p.set("jour", d); return p; }, { replace: true });
  const flash = (tone: "ok" | "error" | "info", text: string) => { setToast({ tone, text }); setTimeout(() => setToast(null), 3500); };

  const selected = events.find((e) => e.id === selectedId) ?? null;
  const dayEvents = events.filter((e) => e.date === selectedDay && e.type !== "club").sort((a, b) => (a.start_min ?? -1) - (b.start_min ?? -1));

  async function moveEvent(e: CalEvent, date: string, start: number) {
    const len = (e.end_min ?? 0) - (e.start_min ?? 0);
    const others = events.filter((x) => x.id !== e.id);
    const fits = freeIntervals(date, profile!, slots, others, e.id).some((i) => start >= i.start && start + len <= i.end);
    const sameDaySession = others.some((x) => x.date === date && MOVABLE.has(x.type));
    if (!fits || date < t) return flash("error", "Ce créneau n'est pas libre. Choisis une zone en vert.");
    if (sameDaySession && date !== e.date) return flash("error", "Il y a déjà une séance ce jour-là.");
    if (isHeavySession(e) && heavyForbidden(date, profile!, slots, others)) return flash("error", "Pas de séance de jambes ni de test un jour de club, ni la veille ou le jour d'un match.");
    const { error } = await supabase.from("events").update({ date, start_min: start, end_min: start + len }).eq("id", e.id);
    if (error) return flash("error", "Le déplacement a échoué. Réessaie.");
    await reloadEvents();
    flash("ok", `Séance déplacée : ${DAYS_SHORT[weekday(date)]} ${range(start, start + len)}`);
  }

  return (
    <main className="pb-page screen">
      <div className="hdr" style={{ marginTop: 4 }}>
        <h1 className="t">Calendrier</h1><span className="sp" />
        <IconButton icon="plus" label="Ajouter un match à la main" onClick={() => setSheet("match")} />
      </div>
      <div className="pb-chips" style={{ margin: "14px 0" }}>
        <Chip active={view === "week"} onClick={() => setView("week")}>Semaine</Chip>
        <Chip active={view === "month"} onClick={() => setView("month")}>Mois</Chip>
        <Chip active={view === "matches"} swatch="var(--cat-match)" onClick={() => setView("matches")}>Matchs</Chip>
        <Chip icon="lock" onClick={() => setSheet("block")}>Bloquer</Chip>
      </div>
      {toast ? <div className="toast"><Notice tone={toast.tone}>{toast.text}</Notice></div> : null}

      {view === "week" ? (
        <>
          <div className="pb-glass" style={{ padding: 12 }}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <IconButton icon="left" small label="Semaine précédente" onClick={() => setDay(addDays(monday, -7))} />
              <b className="pb-num" style={{ fontSize: 17 }}>{weekRange(monday)}</b>
              <IconButton icon="right" small label="Semaine suivante" onClick={() => setDay(addDays(monday, 7))} />
            </div>
            <div className="pb-days">
              {days.map((d) => {
                const evs = events.filter((e) => e.date === d && e.type !== "club");
                const main = evs.find((e) => e.type === "match") ?? evs.find((e) => MOVABLE.has(e.type)) ?? evs.find((e) => e.type === "rest");
                const sessions = evs.filter((e) => MOVABLE.has(e.type));
                const done = sessions.length > 0 && sessions.every(isDone);
                return (
                  <button key={d} className={`pb-day${d === selectedDay ? " on" : ""}${done ? " done" : ""}`} onClick={() => setDay(d)}
                    aria-pressed={d === selectedDay} aria-label={`${longDate(d)}${done ? ", terminé" : ""}`}>
                    <span>{DAYS_SHORT[weekday(d)]}</span><b>{parse(d).getDate()}</b>
                    <i style={{ background: main ? CAT_COLOR[main.type] : "transparent" }} />
                  </button>
                );
              })}
            </div>
          </div>
          <WeekGrid days={days} selectedDay={selectedDay} selectedId={selectedId}
            onSelect={(e) => { setSelectedId(e.id); setDay(e.date); }} onMove={moveEvent} />
          <Legend />
          <div className="lbl section">{longDate(selectedDay)}{isHoliday(profile!.vacation_zone, selectedDay) ? " · vacances" : ""}</div>
          <div className="col" style={{ gap: 8 }}>
            {dayEvents.length ? dayEvents.map((e) => (
              <DayRow key={e.id} e={e} highlighted={e.id === selectedId} onOpen={() => nav(`/evenement/${e.id}`)} onGo={() => nav(startPath(e))} />
            )) : <p className="pb-muted" style={{ margin: 0 }}>Rien de prévu ce jour-là.</p>}
          </div>
          {selected && MOVABLE.has(selected.type) && selected.status === "planned" ? (
            <p className="pb-subtle" style={{ fontSize: 13, marginTop: 10 }}>Astuce : maintiens une séance dans la grille et fais-la glisser vers un créneau en vert.</p>
          ) : null}
        </>
      ) : view === "month" ? (
        <MonthView month={selectedDay} onPick={(d) => { setDay(d); setView("week"); }} onMonth={(d) => setDay(d)} />
      ) : (
        <MatchList onOpen={(id) => nav(`/evenement/${id}`)} />
      )}

      {sheet === "block" ? <BlockSheet date={selectedDay} onClose={() => setSheet(null)} onDone={async (msg) => { setSheet(null); await reload(); flash("ok", msg); }} /> : null}
      {sheet === "match" ? <MatchSheet date={selectedDay} onClose={() => setSheet(null)} onDone={async (msg) => { setSheet(null); await reloadEvents(); flash("ok", msg); }} /> : null}
      <BottomNav />
    </main>
  );
}

function Legend() {
  const items: [string, string][] = [["Cours", "rgba(255,255,255,.25)"], ["Workout", CAT_COLOR.workout], ["Basket", CAT_COLOR.basket], ["Club", CAT_COLOR.club], ["Match", CAT_COLOR.match], ["Repos", CAT_COLOR.rest]];
  return (
    <div className="wrap" style={{ marginTop: 10, gap: 12, font: "500 12px var(--font-sans)", color: "var(--ink-muted)" }}>
      {items.map(([l, c]) => <span key={l} className="row" style={{ gap: 5 }}><span className="sw" style={{ background: c }} />{l}</span>)}
    </div>
  );
}

function WeekGrid({ days, selectedDay, selectedId, onSelect, onMove }: {
  days: string[]; selectedDay: string; selectedId: string | null; onSelect: (e: CalEvent) => void; onMove: (e: CalEvent, date: string, start: number) => void;
}) {
  const { profile, slots, events } = useApp();
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; date: string; start: number; dy: number; moved: boolean } | null>(null);
  const holdTimer = useRef<number>(0);
  const t = today();
  const height = (H1 - H0) * PX;
  const y = (m: number) => (Math.min(Math.max(m, H0), H1) - H0) * PX;

  const classesByDay = useMemo(() => days.map((d) => {
    const wt = weekType(profile!, d);
    const holiday = isHoliday(profile!.vacation_zone, d);
    // Jour envoyé par NoteFlow : ses vrais cours et trajets remplacent le créneau « Cours » de la semaine type
    const nf = slots.some((s: Slot) => s.on_date === d && s.label?.startsWith("NoteFlow"));
    return slots.filter((s: Slot) => s.kind !== "free" && (s.on_date ? s.on_date === d : s.weekday === weekday(d) && (s.week === "*" || s.week === wt)))
      .filter((s) => !(holiday && s.kind === "class") && !(nf && s.kind === "class" && !s.on_date));
  }), [days, slots, profile]);

  // Zones libres du jour visé pendant le glisser.
  const dragged = drag ? events.find((e) => e.id === drag.id) : null;
  const freeByDay = useMemo(() => (dragged ? days.map((d) => (d < t ? [] : freeIntervals(d, profile!, slots, events, dragged.id))) : null), [dragged, days, profile, slots, events, t]);

  function locate(clientX: number, clientY: number, dy: number) {
    const rect = gridRef.current!.getBoundingClientRect();
    const colW = (rect.width - 34) / 7;
    const col = Math.min(6, Math.max(0, Math.floor((clientX - rect.left - 34) / colW)));
    const min = Math.round(((clientY - rect.top - dy) / PX + H0) / SNAP) * SNAP;
    return { date: days[col], start: Math.max(H0, min) };
  }

  function down(e: RPointerEvent, ev: CalEvent) {
    onSelect(ev);
    if (!MOVABLE.has(ev.type) || ev.status !== "planned") return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const dy = e.clientY - rect.top;
    const pid = e.pointerId;
    holdTimer.current = window.setTimeout(() => {
      try { target.setPointerCapture(pid); } catch { /* pointeur déjà relâché */ }
      navigator.vibrate?.(15);
      setDrag({ id: ev.id, date: ev.date, start: ev.start_min ?? H0, dy, moved: false });
    }, 260);
  }
  function move(e: RPointerEvent) {
    if (!drag) return;
    e.preventDefault();
    const p = locate(e.clientX, e.clientY, drag.dy);
    setDrag({ ...drag, ...p, moved: true });
  }
  function up() {
    clearTimeout(holdTimer.current);
    if (!drag) return;
    const ev = events.find((x) => x.id === drag.id)!;
    setDrag(null);
    if (drag.moved && (drag.date !== ev.date || drag.start !== ev.start_min)) onMove(ev, drag.date, drag.start);
  }

  return (
    <div ref={gridRef} className="cal-grid" style={{ height, marginTop: 12 }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div style={{ position: "relative" }}>
        {[8, 10, 12, 14, 16, 18, 20, 22].map((h) => <span key={h} className="cal-hour" style={{ top: y(h * 60) }}>{h}h</span>)}
      </div>
      {[10, 12, 14, 16, 18, 20].map((h) => <div key={h} className="cal-line" style={{ top: y(h * 60) }} aria-hidden="true" />)}
      {days.map((d, i) => {
        const evs = events.filter((e) => e.date === d);
        const rest = evs.find((e) => e.type === "rest");
        const len = dragged ? (dragged.end_min ?? 0) - (dragged.start_min ?? 0) : 0;
        const fitsHere = drag && freeByDay?.[i].some((f) => drag.date === d && drag.start >= f.start && drag.start + len <= f.end);
        return (
          <div key={d} className={`cal-col${drag && drag.date === d && fitsHere ? " drop-ok" : ""}`} style={{ background: d === selectedDay ? "rgba(255,255,255,.03)" : undefined }}>
            {freeByDay?.[i].map((f, k) => (
              <div key={k} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: y(f.start), height: y(f.end) - y(f.start), background: "rgba(61,220,151,.10)", borderRadius: 8 }} />
            ))}
            {rest ? <div className="pb-ev c-rest" style={{ position: "absolute", inset: 0, opacity: 0.45, padding: 0 }} aria-label="Repos" /> : null}
            {classesByDay[i].map((s, k) => (
              <div key={k} className={`pb-ev ${s.kind === "club" ? "c-club" : "class"}`} style={{ position: "absolute", left: 1, right: 1, top: y(s.start_min), height: Math.max(8, y(s.end_min) - y(s.start_min)), padding: 0 }}
                title={`${s.kind === "club" ? "Entraînement club" : s.kind === "blocked" ? s.label ?? "Bloqué" : "Cours"} ${range(s.start_min, s.end_min)}`} />
            ))}
            {evs.filter((e) => e.start_min != null && e.type !== "rest").map((e) => {
              const isDrag = drag?.id === e.id;
              const start = isDrag ? drag!.start : e.start_min!;
              const end = start + ((e.end_min ?? e.start_min! + 90) - e.start_min!);
              const col = isDrag ? days.indexOf(drag!.date) - i : 0;
              return (
                <button key={e.id} type="button"
                  className={`pb-ev cal-ev ${e.type === "match" ? "match" : CLASS_NAME[e.type] ?? ""}${e.id === selectedId ? " selected" : ""}${isDrag ? " dragging" : ""}${isDone(e) ? " done" : isPartial(e) ? " partial" : ""}`}
                  style={{ top: y(start), height: Math.max(14, y(end) - y(start)), transform: col ? `translateX(calc(${col * 100}% + ${col * 3}px))` : undefined }}
                  onPointerDown={(pe) => down(pe, e)} onPointerUp={up}
                  aria-label={`${e.title}, ${DAYS_SHORT[weekday(e.date)]} ${range(e.start_min, e.end_min)}${isDone(e) ? ", terminée" : isPartial(e) ? ", partiellement faite" : ""}`}>
                  <span className="sr-only">{e.title}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function DayRow({ e, highlighted, onOpen, onGo }: { e: CalEvent; highlighted: boolean; onOpen: () => void; onGo: () => void }) {
  const tile = e.type === "match" ? "trophy" : e.type === "basket" ? "ball" : e.type === "rest" ? "pause" : e.type === "test" ? "bolt" : "dumbbell";
  const sub = e.type === "match"
    ? `${range(e.start_min, null)} · ${e.payload.home ? "Domicile" : "Extérieur"}${e.payload.us != null ? ` · ${e.payload.us}–${e.payload.them}` : ""}`
    : e.type === "rest" ? "Repos complet" : `${range(e.start_min, e.end_min)} · ${PLACE_LABEL[e.location ?? ""] ?? ""}`;
  return (
    <div className="pb-glass" style={{ padding: 8, outline: highlighted ? "2px solid var(--primary-bright)" : undefined }}>
      <div className="pb-row" style={{ padding: 0 }}>
        <button className="pb-tile" style={{ color: CAT_COLOR[e.type], cursor: "pointer" }} onClick={onOpen} aria-label={`Détail : ${e.title}`}>
          <Icon name={tile} />{e.start_min != null ? <span>{range(e.start_min, null)}</span> : null}
        </button>
        <button style={{ flex: 1, minWidth: 0, background: "none", border: 0, textAlign: "left", padding: 0 }} onClick={onOpen} aria-label={`${e.title}, ${sub}`}>
          <h4>{e.title}{isDone(e) ? <span style={{ color: "var(--success)" }}> ✓</span> : isPartial(e) ? <span style={{ color: "var(--heat)", fontWeight: 500, fontSize: 13 }}> · partiellement faite</span> : null}</h4><p>{sub}</p>
        </button>
        {MOVABLE.has(e.type) && e.status === "planned" ? <button className="pb-btn primary" style={{ padding: "0 16px" }} onClick={onGo}>Go</button> : null}
      </div>
    </div>
  );
}

function MonthView({ month, onPick, onMonth }: { month: string; onPick: (d: string) => void; onMonth: (d: string) => void }) {
  const { events } = useApp();
  const first = iso(new Date(parse(month).getFullYear(), parse(month).getMonth(), 1));
  const start = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const m = parse(first).getMonth();
  const t = today();
  return (
    <div className="pb-glass" style={{ padding: 12 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <IconButton icon="left" small label="Mois précédent" onClick={() => onMonth(addDays(first, -1))} />
        <b className="pb-num" style={{ fontSize: 17 }}>{monthTitle(first)}</b>
        <IconButton icon="right" small label="Mois suivant" onClick={() => onMonth(addDays(first, 32))} />
      </div>
      <div className="month-grid" style={{ marginBottom: 6, font: "500 11px var(--font-sans)", color: "var(--ink-subtle)", textAlign: "center" }}>
        {DAYS_SHORT.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="month-grid">
        {cells.map((d) => {
          const evs = events.filter((e) => e.date === d && e.type !== "club");
          const done = evs.some((e) => MOVABLE.has(e.type)) && evs.filter((e) => MOVABLE.has(e.type)).every(isDone);
          return (
            <button key={d} className={`month-day${parse(d).getMonth() !== m ? " out" : ""}${d === t ? " today" : ""}`} onClick={() => onPick(d)} aria-label={`${longDate(d)} : ${evs.map((e) => e.title).join(", ") || "rien"}`}>
              <span>{parse(d).getDate()}{done ? <span style={{ color: "var(--success)" }}> ✓</span> : null}</span>
              <span className="dots">{evs.slice(0, 3).map((e) => <i key={e.id} style={{ background: CAT_COLOR[e.type] }} />)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MatchList({ onOpen }: { onOpen: (id: string) => void }) {
  const { events, profile } = useApp();
  const list = events.filter((e) => e.type === "match").sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return <div className="pb-glass empty"><Icon name="trophy" size="lg" className="pb-muted" /><b>Aucun match</b><p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>{profile?.ffbb_team ? "Ils apparaîtront à la prochaine synchro FFBB." : "Connecte ton club FFBB dans le Profil, ou ajoute un match avec +."}</p></div>;
  return (
    <div className="pb-glass" style={{ padding: "4px 0" }}>
      {list.map((e) => (
        <button key={e.id} className="pb-li" onClick={() => onOpen(e.id)}>
          <span className="pill-sm" style={{ background: "var(--cat-match)", color: "var(--bg-950)", borderColor: "transparent", minWidth: 64, justifyContent: "center" }}>{DAYS_SHORT[weekday(e.date)]} {parse(e.date).getDate()}/{parse(e.date).getMonth() + 1}</span>
          <div className="t">{e.title}<small>{range(e.start_min, null)} · {e.payload.home ? "Domicile" : "Extérieur"}{e.payload.us != null ? ` · ${e.payload.us}–${e.payload.them}` : ""}</small></div>
          <Icon name="right" size="sm" className="pb-muted" />
        </button>
      ))}
    </div>
  );
}

function BlockSheet({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { profile, slots, events } = useApp();
  const [d, setD] = useState(date < today() ? today() : date);
  const [start, setStart] = useState("14:00");
  const [end, setEnd] = useState("16:00");
  const [label, setLabel] = useState("Contrôle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const s = toMin(start), en = toMin(end);
    if (en <= s) return setError("L'heure de fin doit être après l'heure de début.");
    setBusy(true);
    const slot: Slot = { kind: "blocked", week: "*", weekday: null, on_date: d, start_min: s, end_min: en, location: null, label };
    const ins = await supabase.from("schedule_slots").insert(slot);
    if (ins.error) { setBusy(false); return setError("Le blocage a échoué. Réessaie."); }
    // Replace automatiquement les séances qui chevauchent le créneau bloqué.
    const newSlots = [...slots, slot];
    const hit = events.filter((x) => x.date === d && MOVABLE.has(x.type) && x.status === "planned" && x.start_min != null && x.start_min < en && (x.end_min ?? 0) > s);
    const moved: string[] = [];
    let current = events;
    for (const ev of hit) {
      const to = relocate(ev, profile!, newSlots, current);
      if (to) {
        await supabase.from("events").update(to).eq("id", ev.id);
        current = current.map((x) => (x.id === ev.id ? { ...x, ...to } : x));
        moved.push(`${ev.title} → ${DAYS_SHORT[weekday(to.date)]} ${range(to.start_min, to.end_min)}`);
      } else {
        await supabase.from("events").update({ status: "skipped" }).eq("id", ev.id);
        moved.push(`${ev.title} : aucun créneau libre, séance annulée`);
      }
    }
    setBusy(false);
    onDone(moved.length ? `Créneau bloqué. ${moved.join(" · ")}` : "Créneau bloqué. Aucune séance à déplacer.");
  }

  return (
    <Sheet title="Bloquer un créneau" onClose={onClose}>
      <form className="col" onSubmit={submit}>
        <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Contrôle, cours décalé, rendez-vous : la séance prévue est replacée toute seule.</p>
        <div className="field"><label className="lbl" htmlFor="bl-l">Motif</label><input id="bl-l" className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div className="field"><label className="lbl" htmlFor="bl-d">Date</label><input id="bl-d" className="input" type="date" min={today()} value={d} onChange={(e) => setD(e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label className="lbl" htmlFor="bl-s">Début</label><input id="bl-s" className="input" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field"><label className="lbl" htmlFor="bl-e">Fin</label><input id="bl-e" className="input" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <button className="pb-btn primary lg block" disabled={busy}>{busy ? "Replacement…" : "Bloquer et replacer"}</button>
      </form>
    </Sheet>
  );
}

function MatchSheet({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { profile } = useApp();
  const [d, setD] = useState(date);
  const [time, setTime] = useState("15:30");
  const [opponent, setOpponent] = useState("");
  const [home, setHome] = useState(true);
  const [venue, setVenue] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!opponent.trim()) return setError("Indique l'adversaire.");
    setBusy(true);
    const s = toMin(time);
    const { error } = await supabase.from("events").insert({
      date: d, start_min: s, end_min: Math.min(s + 105, 1440), type: "match", title: `vs ${opponent.trim()}`, location: venue || null, source: "manual",
      payload: { opponent: opponent.trim(), home, venue: venue || null, address: address || null },
    });
    if (error) { setBusy(false); return setError("L'ajout a échoué. Réessaie."); }
    // Le programme s'adapte au match (veille, jour J, lendemain).
    const from = addDays(d, -1) > today() ? addDays(d, -1) : today();
    await regenerateProgram(profile!, from).catch(() => undefined);
    setBusy(false);
    onDone("Match ajouté. Les séances autour ont été adaptées.");
  }

  return (
    <Sheet title="Ajouter un match" onClose={onClose}>
      <form className="col" onSubmit={submit}>
        <div className="field"><label className="lbl" htmlFor="m-o">Adversaire</label><input id="m-o" className="input" value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="BC Val-Fleuri…" autoComplete="off" /></div>
        <div className="grid2">
          <div className="field"><label className="lbl" htmlFor="m-d">Date</label><input id="m-d" className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
          <div className="field"><label className="lbl" htmlFor="m-t">Heure</label><input id="m-t" className="input" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
        <div className="grid2"><Chip active={home} onClick={() => setHome(true)}>Domicile</Chip><Chip active={!home} onClick={() => setHome(false)}>Extérieur</Chip></div>
        <div className="field"><label className="lbl" htmlFor="m-v">Salle</label><input id="m-v" className="input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Gymnase des Tilleuls…" /></div>
        <div className="field"><label className="lbl" htmlFor="m-a">Adresse</label><input id="m-a" className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 rue des Écoles…" autoComplete="street-address" /></div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <button className="pb-btn primary lg block" disabled={busy}>{busy ? "Ajout…" : "Ajouter le match"}</button>
      </form>
    </Sheet>
  );
}


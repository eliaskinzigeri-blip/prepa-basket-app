// Nutrition : objectifs du jour, menu de la cantine (PRONOTE), scan IA d'un plat et idées de repas.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { BackButton, BottomAction, BottomNav, Chip, Notice, Spinner } from "../components/ui";
import { useApp, latest } from "../state/app";
import { supabase } from "../lib/supabase";
import { DAYS_SHORT, today, weekday } from "../lib/format";
import { updateProfile } from "../lib/data";
import { ageOn, bmrOf } from "../lib/energy";
import { takenAt } from "../lib/photoMeta";
import {
  MEAL_LABEL, MEAL_ORDER, NutritionError, PROTEIN_G_PER_KG, activitiesOf, baseKcal, dayRange, dayTypeOf, fileToDataUrl, mealAt, rescale, menuItems, nutrition, sumMeals, targetsFor,
  type Analysis, type Food, type MealRow, type MealType, type MenuDay, type Suggestion, type Targets,
} from "../lib/nutrition";

const PRONOTE_ACCOUNT = import.meta.env.VITE_PRONOTE_ACCOUNT ?? ""; // connecteur PRONOTE réservé à ce compte (variable de compilation)
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
// Part de la journée pour chaque repas (pour viser une portion raisonnable dans les idées).
const SHARE: Record<MealType, number> = { "petit-dej": 0.22, dejeuner: 0.32, gouter: 0.14, collation: 0.1, diner: 0.3 };

// ---------- Données partagées ----------

function useTargets(date: string) {
  const { profile, events, slots, measurements } = useApp();
  const weight = latest(measurements, "weight").value ?? profile?.weight_kg ?? 50;
  const age = ageOn(profile?.birth_date ?? null) ?? 13;
  const bmr = latest(measurements, "bmr").value ?? bmrOf(weight, profile?.height_cm ?? 165, age, true) ?? 1600;
  const activities = activitiesOf(events, slots, date, weight);
  const day = dayTypeOf(events, date, activities);
  return { day, weight, bmr, activities, targets: targetsFor(day, weight, bmr, activities) };
}

function useMeals(date: string) {
  const [meals, setMeals] = useState<MealRow[] | null>(null);
  const load = useCallback(async () => {
    const { from, to } = dayRange(date);
    const { data } = await supabase.from("meals").select("*").gte("eaten_at", from).lt("eaten_at", to).order("eaten_at");
    setMeals((data ?? []) as MealRow[]);
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  return { meals, reload: load, setMeals };
}

const menuCache = new Map<string, Promise<{ days: MenuDay[]; title?: string; error?: string }>>();
/** Le joueur mange-t-il à la cantine ce jour-là ? (réglage « Jours de cantine », lundi = 0) */
export const eatsAtCantine = (days: number[] | null | undefined, date: string) => !days?.length || days.includes(weekday(date));

function useSchoolMenu(date: string) {
  const { session, profile } = useApp();
  const allowed = session?.user.id === PRONOTE_ACCOUNT;
  const atCantine = eatsAtCantine(profile?.cantine_days, date);
  const [state, setState] = useState<{ loading: boolean; day?: MenuDay; error?: string; needLink?: boolean; title?: string }>({ loading: allowed && atCantine });
  const load = useCallback((force = false) => {
    if (!allowed) return;
    if (!atCantine) return setState({ loading: false });
    const key = date.slice(0, 10);
    if (force || !menuCache.has(key)) menuCache.set(key, nutrition({ action: "menu", date, force }));
    setState((s) => ({ ...s, loading: true }));
    menuCache.get(key)!
      .then((r) => setState({ loading: false, day: r.days.find((d) => d.date === date), error: r.error, title: r.title }))
      .catch((e: NutritionError) => { menuCache.delete(key); setState({ loading: false, error: e.message, needLink: e.needLink }); });
  }, [allowed, atCantine, date]);
  useEffect(() => { load(); }, [load]);
  return { allowed, atCantine, ...state, reload: () => load(true) };
}

async function saveMeal(m: Omit<MealRow, "id" | "eaten_at"> & { eaten_at?: string }) {
  const { error } = await supabase.from("meals").insert(m);
  if (error) throw new Error("Le repas n'a pas pu être enregistré. Vérifie ta connexion.");
}

// ---------- Écran principal ----------

function Bar({ label, value, target, unit, color }: { label: string; value: number; target: number; unit: string; color: string }) {
  const pct = Math.min(100, (value / Math.max(1, target)) * 100);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="row between" style={{ fontSize: 14 }}><span>{label}</span><span className="pb-num"><b>{fmt(value)}</b> <span className="pb-muted">/ {fmt(target)} {unit}</span></span></div>
      <div className="nu-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.round(value)}><span style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

export default function Nutrition() {
  const date = today();
  const nav = useNavigate();
  const { day, weight, bmr, activities, targets } = useTargets(date);
  const { meals, reload, setMeals } = useMeals(date);
  const menu = useSchoolMenu(date);
  const eaten = sumMeals(meals ?? []);
  const lunchDone = (meals ?? []).some((m) => m.meal_type === "dejeuner");

  async function remove(id: string) {
    setMeals((l) => (l ?? []).filter((m) => m.id !== id));
    const { error } = await supabase.from("meals").delete().eq("id", id);
    if (error) void reload();
  }

  return (
    <main className="pb-page screen">
      <h1 className="t" style={{ margin: "8px 0 4px" }}>Nutrition</h1>
      <p className="lead">Des repères pour grandir et prendre du muscle : mange à ta faim, sans jamais sauter de repas.</p>


      <section className="pb-glass" style={{ marginTop: 12, padding: 16, display: "grid", gap: 14 }} aria-label="Objectifs du jour">
        <div>
          <span className="pb-muted" style={{ fontSize: 13 }}>Énergie aujourd'hui</span>
          <div className="pb-num" style={{ fontSize: 34, fontWeight: 700, lineHeight: "40px" }}>{fmt(eaten.calories)}<span className="pb-muted" style={{ fontSize: 16, fontWeight: 500 }}> / {fmt(targets.calories)} kcal</span></div>
          <div className="nu-bar" style={{ marginTop: 8 }} aria-hidden="true"><span style={{ width: `${Math.min(100, (eaten.calories / targets.calories) * 100)}%`, background: "var(--primary-bright)" }} /></div>
        </div>
        <Bar label="Protéines" value={eaten.protein_g} target={targets.protein_g} unit="g" color="var(--success)" />
        <Bar label="Glucides" value={eaten.carbs_g} target={targets.carbs_g} unit="g" color="var(--cat-basket)" />
        <Bar label="Lipides" value={eaten.fat_g} target={targets.fat_g} unit="g" color="var(--cat-match)" />
        <details>
          <summary className="pb-muted" style={{ fontSize: 13, cursor: "pointer" }}>D'où viennent les {fmt(targets.calories)} kcal</summary>
          <div style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 13 }}>
            <div className="row between"><span>Journée sans sport (collège, trajets, croissance)</span><b className="pb-num">{fmt(baseKcal(bmr))}</b></div>
            {activities.map((a, i) => <div key={i} className="row between"><span>{a.label} · {a.minutes} min</span><b className="pb-num">+{fmt(a.kcal)}</b></div>)}
            {!activities.length ? <span className="pb-subtle">Pas de sport prévu aujourd'hui dans ton calendrier.</span> : null}
          </div>
        </details>
        <p className="pb-subtle" style={{ fontSize: 12, margin: 0 }}>
          {fmt(weight)} kg · protéines {String(PROTEIN_G_PER_KG[day]).replace(".", ",")} g/kg ({day === "repos" ? "jour sans sport" : "jour de sport"}), glucides {String(targets.carbsPerKg).replace(".", ",")} g/kg. Des repères, pas des ordres : si tu as faim, mange.
        </p>
      </section>

      {menu.allowed ? <CantineCard menu={menu} date={date} lunchDone={lunchDone} /> : null}

      <div className="col" style={{ marginTop: 12, gap: 10 }}>
        <button className="pb-btn primary lg block" onClick={() => nav("/nutrition/scan")}><Icon name="camera" size="sm" />Scanner un plat</button>
        <button className="pb-btn lg block" onClick={() => nav("/nutrition/idees")}><Icon name="bolt" size="sm" />Idées de repas</button>
      </div>

      <div className="lbl section">Mes repas du jour</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {meals == null ? <Spinner /> : meals.length ? MEAL_ORDER.flatMap((t) => meals.filter((m) => m.meal_type === t)).map((m) => (
          <div key={m.id} className="pb-li">
            <div className="t">{m.name}<small>{MEAL_LABEL[m.meal_type]} · {fmt(m.calories)} kcal · {fmt(m.protein_g)} g de protéines</small></div>
            <button className="pb-icon-btn sm" aria-label={`Supprimer ${m.name}`} onClick={() => remove(m.id)}><Icon name="trash" /></button>
          </div>
        )) : <p className="pb-muted" style={{ padding: 16, margin: 0 }}>Rien de noté pour l'instant. Scanne ton prochain repas.</p>}
      </div>
      <BottomNav />
    </main>
  );
}

const CATS: [keyof MenuDay, string][] = [["entree", "Entrée"], ["plat", "Plat"], ["accompagnement", "Accompagnement"], ["laitage", "Laitage"], ["dessert", "Dessert"]];

function CantineCard({ menu, date, lunchDone }: { menu: ReturnType<typeof useSchoolMenu>; date: string; lunchDone: boolean }) {
  const nav = useNavigate();
  const label = new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const items = menuItems(menu.day);
  return (
    <section className="pb-glass" style={{ marginTop: 12, padding: 16, display: "grid", gap: 10 }} aria-label="Menu de la cantine">
      <div className="row between">
        <h2 className="s" style={{ fontSize: 17, margin: 0 }}>{menu.atCantine ? "Cantine" : "Déjeuner"} · {label}</h2>
        {menu.atCantine && !menu.loading && !menu.needLink ? <button className="pb-icon-btn sm" aria-label="Recharger le menu depuis PRONOTE" onClick={menu.reload}><Icon name="sync" /></button> : null}
      </div>
      {!menu.atCantine ? (
        <>
          <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Pas de cantine le {new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long" })} : tu manges ailleurs. Scanne ton repas de midi pour le compter.</p>
          {lunchDone ? <Notice tone="ok">Déjeuner noté.</Notice> : <button className="pb-btn primary" onClick={() => nav("/nutrition/scan", { state: { mealType: "dejeuner" } })}><Icon name="camera" size="sm" />Scanner mon déjeuner</button>}
        </>
      ) : menu.loading ? <Spinner label="Lecture du menu sur PRONOTE…" /> : menu.needLink ? (
        <>
          <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>Connecte ton compte PRONOTE pour voir le menu du jour.</p>
          <Link to="/nutrition/pronote" className="pb-btn">Connecter PRONOTE</Link>
        </>
      ) : menu.day ? (
        <>
          <dl style={{ margin: 0, display: "grid", gap: 6 }}>
            {CATS.filter(([k]) => (menu.day![k] as string[] | undefined)?.length).map(([k, l]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "118px 1fr", gap: 8, fontSize: 14 }}>
                <dt className="pb-muted">{l}</dt><dd style={{ margin: 0 }}>{(menu.day![k] as string[]).join(", ")}</dd>
              </div>
            ))}
          </dl>
          {lunchDone ? <Notice tone="ok">Déjeuner noté.</Notice> : (
            <button className="pb-btn primary" onClick={() => nav("/nutrition/scan", { state: { description: `Plateau de cantine de collège : ${items.join(", ")}. Portion standard d'un collégien qui finit son plateau.`, mealType: "dejeuner", source: "cantine", name: `Cantine : ${(menu.day!.plat ?? [items[0]]).join(", ")}` } })}>
              <Icon name="check" size="sm" />J'ai mangé ça à midi
            </button>
          )}
        </>
      ) : <p className="pb-muted" style={{ margin: 0, fontSize: 14 }}>{menu.error ?? "Pas de cantine aujourd'hui."}</p>}
    </section>
  );
}

// ---------- Scan d'un plat ----------

const PORTIONS = [0.5, 1, 1.5, 2];
const MAX_PHOTOS = 3;
const CONFIDENCE: Record<string, string> = { high: "Sûre", medium: "Plutôt sûre", low: "Peu sûre" };

interface Shot { url: string; at: Date | null }
type Place = "maison" | "cantine" | "dehors";
const PLACE_LABEL: Record<Place, string> = { maison: "À la maison", cantine: "Cantine", dehors: "Dehors" };

const dateLabel = (d: Date) => d.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function MealScan() {
  const nav = useNavigate();
  const loc = useLocation();
  const preset = (loc.state ?? {}) as { description?: string; mealType?: MealType; source?: MealRow["source"]; name?: string };
  const [shots, setShots] = useState<Shot[]>([]);
  const [description, setDescription] = useState(preset.description ?? "");
  const [mealType, setMealType] = useState<MealType>(preset.mealType ?? mealAt());
  const [eatenAt, setEatenAt] = useState<Date | null>(null); // date de la photo, si le repas date d'avant
  const [place, setPlace] = useState<Place>(preset.source === "cantine" ? "cantine" : "maison");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [portion, setPortion] = useState(1);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  // Le contexte (repas, heure, lieu) aide l'IA à estimer les portions.
  const analyze = useCallback(async (imgs: string[], desc: string, ctx: { meal: MealType; at: Date | null; place: Place }) => {
    setBusy(true); setError(null);
    try {
      const r = await nutrition<Analysis>({
        action: "analyze_meal", images: imgs.length ? imgs : undefined, description: desc || undefined,
        meal: MEAL_LABEL[ctx.meal], place: ctx.place, taken_at: dateLabel(ctx.at ?? new Date()),
      });
      setResult(r); setFoods(r.foods ?? []); setPortion(1);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }, []);

  // Venu de la carte cantine : l'analyse part toute seule.
  useEffect(() => { if (preset.description && !started.current) { started.current = true; void analyze([], preset.description, { meal: preset.mealType ?? mealAt(), at: null, place: "cantine" }); } }, [analyze, preset.description]);

  async function add(list: FileList | null, fromGallery: boolean) {
    const files = Array.from(list ?? []).slice(0, MAX_PHOTOS - shots.length);
    if (!files.length) return;
    const added = await Promise.all(files.map(async (f) => ({ url: await fileToDataUrl(f, 1280, 0.85), at: fromGallery ? await takenAt(f) : null })));
    const next = [...shots, ...added];
    setShots(next);
    // Photo prise plus tôt (plus de 30 min) : le repas prend sa date et le repas le plus probable à cette heure
    const old = added.map((s) => s.at).find((d): d is Date => !!d && Date.now() - d.getTime() > 30 * 60_000);
    const at = eatenAt ?? old ?? null;
    const meal = old && !eatenAt && !preset.mealType ? mealAt(old) : mealType;
    if (old && !eatenAt) { setEatenAt(old); setMealType(meal); }
    void analyze(next.map((s) => s.url), description.trim(), { meal, at, place });
  }

  function remove(i: number) {
    const next = shots.filter((_, j) => j !== i);
    setShots(next);
    if (!next.length) { setResult(null); setFoods([]); setEatenAt(null); }
  }

  const total = useMemo(() => {
    const s = sumMeals(foods);
    return { calories: s.calories * portion, protein_g: s.protein_g * portion, carbs_g: s.carbs_g * portion, fat_g: s.fat_g * portion };
  }, [foods, portion]);

  async function save() {
    if (!result) return;
    setBusy(true);
    try {
      await saveMeal({
        meal_type: mealType, name: preset.name ?? result.dish, source: preset.source ?? "scan",
        ...(eatenAt ? { eaten_at: eatenAt.toISOString() } : {}),
        foods: foods.map((f) => ({ ...f, quantity: f.quantity ? Math.round(f.quantity * portion) : f.quantity, calories: f.calories * portion, protein_g: f.protein_g * portion, carbs_g: f.carbs_g * portion, fat_g: f.fat_g * portion })),
        calories: Math.round(total.calories), protein_g: Math.round(total.protein_g * 10) / 10, carbs_g: Math.round(total.carbs_g * 10) / 10, fat_g: Math.round(total.fat_g * 10) / 10,
      });
      nav("/nutrition");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const cantine = preset.source === "cantine";
  const full = shots.length >= MAX_PHOTOS;

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 170 }}>
      <div className="hdr"><BackButton to="/nutrition" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>{cantine ? "Repas de la cantine" : "Scanner un plat"}</h1>
      <p className="lead">{cantine ? "L'IA estime ton plateau d'après le menu. Ajuste la portion si besoin." : "Prends ton assiette en photo ou importe-la depuis ta galerie : l'IA reconnaît les aliments et estime leur poids."}</p>

      <div className="pb-chips chips-wrap" style={{ marginTop: 14 }} aria-label="Repas">
        {MEAL_ORDER.map((t) => <Chip key={t} active={mealType === t} onClick={() => setMealType(t)}>{MEAL_LABEL[t]}</Chip>)}
      </div>

      {!cantine ? (
        <div className="col" style={{ gap: 10, marginTop: 14 }}>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void add(e.target.files, false); e.target.value = ""; }} />
          <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void add(e.target.files, true); e.target.value = ""; }} />
          {shots.length ? (
            <ul className="scan-shots" aria-label="Photos du repas">
              {shots.map((s, i) => (
                <li key={i}>
                  <img src={s.url} alt={`Photo ${i + 1} du repas`} />
                  <button className="pb-icon-btn sm" aria-label={`Retirer la photo ${i + 1}`} onClick={() => remove(i)} disabled={busy}><Icon name="x" /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pb-subtle" style={{ fontSize: 13, margin: 0 }}>
              Pour une meilleure estimation : prends l'assiette entière, bien éclairée, avec ta fourchette ou ton couteau posé à côté. Une 2ᵉ photo de biais aide à voir l'épaisseur.
            </p>
          )}
          <div className="grid2">
            <button className="pb-btn lg" onClick={() => cameraRef.current?.click()} disabled={busy || full}><Icon name="camera" size="sm" />{shots.length ? "Autre photo" : "Prendre une photo"}</button>
            <button className="pb-btn lg" onClick={() => galleryRef.current?.click()} disabled={busy || full}><Icon name="image" size="sm" />Importer</button>
          </div>
          {full ? <span className="pb-subtle" style={{ fontSize: 12 }}>{MAX_PHOTOS} photos au maximum.</span> : null}
          {eatenAt ? (
            <Notice tone="info">
              Repas daté du {dateLabel(eatenAt)}, d'après la photo.{" "}
              <button className="pb-link" onClick={() => setEatenAt(null)}>Dater de maintenant</button>
            </Notice>
          ) : null}
          <div className="pb-chips chips-wrap" aria-label="Où as-tu mangé ?">
            {(Object.keys(PLACE_LABEL) as Place[]).map((p) => <Chip key={p} active={place === p} onClick={() => setPlace(p)}>{PLACE_LABEL[p]}</Chip>)}
          </div>
          <label className="lbl" htmlFor="desc">Recette ou précisions (facultatif avec une photo)</label>
          <textarea id="desc" className="input" rows={4} maxLength={1500} style={{ height: "auto", padding: 12 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="150 g de farine, 2 œufs, 200 ml de lait… j'ai tout mangé" />
          <span className="pb-subtle" style={{ fontSize: 12 }}>Les quantités que tu donnes (ou une capture de la recette) comptent plus que la photo : c'est le plus précis. Tu as suivi une idée de repas de l'app ? Son bouton « Je mange ça » enregistre directement ses calories.</span>
          <button className="pb-btn" onClick={() => analyze(shots.map((s) => s.url), description.trim(), { meal: mealType, at: eatenAt, place })} disabled={busy || (!shots.length && description.trim().length < 3)}>{result ? "Réanalyser" : "Analyser"}</button>
        </div>
      ) : null}

      <div className="col" style={{ gap: 10, marginTop: 14 }}>
        {busy ? <Spinner label="L'IA reconnaît les aliments et estime leur poids…" /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>

      {result ? (
        <section className="pb-glass" style={{ marginTop: 14, padding: 16, display: "grid", gap: 12, opacity: busy ? 0.5 : 1 }} aria-live="polite" aria-busy={busy}>
          <div>
            <h2 className="s" style={{ fontSize: 18, margin: 0 }}>{preset.name ?? result.dish}</h2>
            <span className="pb-muted" style={{ fontSize: 13 }}>
              {result.portion_estimate ?? ""}{result.portion_estimate && result.confidence ? " · " : ""}{result.confidence ? `Estimation ${(CONFIDENCE[result.confidence] ?? result.confidence).toLowerCase()}` : ""}
            </span>
          </div>
          <div className="grid2" style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
            {[["kcal", total.calories], ["prot.", total.protein_g], ["gluc.", total.carbs_g], ["lip.", total.fat_g]].map(([k, v]) => (
              <div key={k as string} style={{ textAlign: "center" }}><b className="pb-num" style={{ fontSize: 18 }}>{fmt(v as number)}</b><br /><span className="pb-muted" style={{ fontSize: 12 }}>{k === "kcal" ? "kcal" : `g ${k}`}</span></div>
            ))}
          </div>
          <div>
            <span className="lbl">Portion</span>
            <div className="pb-chips chips-wrap" style={{ marginTop: 6 }}>{PORTIONS.map((p) => <Chip key={p} active={portion === p} onClick={() => setPortion(p)}>× {String(p).replace(".", ",")}</Chip>)}</div>
          </div>
          <div style={{ display: "grid" }}>
            <span className="lbl">Aliments : corrige les grammes si tu les connais</span>
            {foods.map((f, i) => (
              <div key={`${i}-${f.name}`} className="pb-li scan-food" style={{ padding: "8px 0" }}>
                <div className="t" style={{ fontSize: 14, minWidth: 0 }}>{f.name}{f.hidden ? <span className="pb-muted"> (probable)</span> : null}<small>{fmt(f.calories * portion)} kcal · {fmt(f.protein_g * portion)} g prot.</small></div>
                {f.quantity ? (
                  <label className="scan-qty">
                    <input
                      key={f.quantity} className="input pb-num" type="number" inputMode="numeric" min={1} max={2000} step={5}
                      aria-label={`Quantité de ${f.name}`} defaultValue={Math.round(f.quantity)}
                      onBlur={(e) => { const q = Number(e.target.value); if (q > 0 && q !== f.quantity) setFoods((l) => l.map((x, j) => (j === i ? rescale(x, q) : x))); }}
                    />
                    <span className="pb-muted">{f.unit === "ml" ? "ml" : f.unit === "piece" ? "pièce" : "g"}</span>
                  </label>
                ) : null}
                <button className="pb-icon-btn sm" aria-label={`Retirer ${f.name}`} onClick={() => setFoods((l) => l.filter((_, j) => j !== i))}><Icon name="minus" /></button>
              </div>
            ))}
          </div>
          {result.notes ? <p className="pb-subtle" style={{ fontSize: 13, margin: 0 }}>{result.notes}</p> : null}
          <p className="pb-subtle" style={{ fontSize: 12, margin: 0 }}>Estimation de l'IA : sur une photo, elle peut se tromper d'environ 20 à 30 % sur les quantités. Si tu as pesé un aliment, corrige son poids.</p>
        </section>
      ) : null}

      {result ? <BottomAction><button className="pb-btn primary lg block" disabled={busy || !foods.length} onClick={save}><Icon name="check" size="sm" />Ajouter à mes repas</button></BottomAction> : null}
    </main>
  );
}

// ---------- Idées de repas ----------

type Taste = "any" | "sweet" | "savory";

export function MealIdeas() {
  const date = today();
  const { day, targets } = useTargets(date);
  const { meals } = useMeals(date);
  const menu = useSchoolMenu(date);
  const [mealType, setMealType] = useState<MealType>(() => { const m = mealAt(); return m === "dejeuner" ? "diner" : m; });
  const [taste, setTaste] = useState<Taste>("any");
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [prefs, setPrefs] = useState("");
  const [busy, setBusy] = useState<"fridge" | "ideas" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const target: Targets = useMemo(() => {
    const eaten = sumMeals(meals ?? []);
    const part = (k: "calories" | "protein_g" | "carbs_g" | "fat_g") => Math.max(targets[k] * SHARE[mealType], Math.min(targets[k] * 0.45, targets[k] - eaten[k]));
    return { calories: part("calories"), protein_g: part("protein_g"), carbs_g: part("carbs_g"), fat_g: part("fat_g"), carbsPerKg: targets.carbsPerKg };
  }, [meals, targets, mealType]);

  function addIngredient(e?: FormEvent) {
    e?.preventDefault();
    const v = draft.trim();
    if (v && !ingredients.includes(v)) setIngredients((l) => [...l, v]);
    setDraft("");
  }

  async function fridge(f: File | undefined) {
    if (!f) return;
    setBusy("fridge"); setError(null);
    try {
      const r = await nutrition<{ ingredients: { name: string }[] }>({ action: "analyze_fridge", image: await fileToDataUrl(f) });
      setIngredients((l) => [...new Set([...l, ...(r.ingredients ?? []).map((i) => i.name)])]);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  async function propose() {
    setBusy("ideas"); setError(null); setIdeas([]); setOpen(null); setSaved(null);
    try {
      const r = await nutrition<{ suggestions: Suggestion[] }>({
        action: "suggest", mealType, taste, ingredients, prefs, dayType: day, count: 3, target,
        cantine: mealType !== "dejeuner" ? menuItems(menu.day) : [],
      });
      setIdeas(r.suggestions ?? []);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  async function eat(i: number) {
    const s = ideas[i];
    try {
      await saveMeal({ meal_type: mealType, name: s.dish, source: "suggestion", foods: [{ name: s.dish, calories: s.calories, protein_g: s.protein_g, carbs_g: s.carbs_g, fat_g: s.fat_g }], calories: s.calories, protein_g: s.protein_g, carbs_g: s.carbs_g, fat_g: s.fat_g });
      setSaved(i);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 170 }}>
      <div className="hdr"><BackButton to="/nutrition" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Idées de repas</h1>
      <p className="lead">Des plats qui complètent ta journée{menu.day && mealType !== "dejeuner" ? ", en tenant compte de la cantine" : ""}.</p>

      <div className="lbl section">Pour quel repas ?</div>
      <div className="pb-chips chips-wrap">{MEAL_ORDER.map((t) => <Chip key={t} active={mealType === t} onClick={() => setMealType(t)}>{MEAL_LABEL[t]}</Chip>)}</div>
      <div className="pb-chips chips-wrap" style={{ marginTop: 8 }}>
        {([["any", "Peu importe"], ["savory", "Salé"], ["sweet", "Sucré"]] as [Taste, string][]).map(([k, l]) => <Chip key={k} active={taste === k} onClick={() => setTaste(k)}>{l}</Chip>)}
      </div>
      <p className="pb-subtle" style={{ fontSize: 13, margin: "8px 2px 0" }}>Visé pour ce repas : environ {fmt(target.calories)} kcal et {fmt(target.protein_g)} g de protéines.</p>

      <div className="lbl section">Ce que tu as à la maison (facultatif)</div>
      <form className="row" style={{ gap: 8 }} onSubmit={addIngredient}>
        <input className="input" aria-label="Ajouter un ingrédient" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Œufs, riz, poulet…" style={{ flex: 1 }} />
        <button className="pb-btn" disabled={!draft.trim()}>Ajouter</button>
      </form>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fridge(e.target.files?.[0])} />
      <button className="pb-btn block" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()} disabled={busy != null}><Icon name="camera" size="sm" />{busy === "fridge" ? "L'IA regarde ton frigo…" : "Photo du frigo"}</button>
      {ingredients.length ? (
        <div className="pb-chips chips-wrap" style={{ marginTop: 8 }}>
          {ingredients.map((i) => <Chip key={i} active onClick={() => setIngredients((l) => l.filter((x) => x !== i))}>{i} ✕</Chip>)}
        </div>
      ) : null}
      <label className="lbl section" htmlFor="prefs">Envies ou contraintes</label>
      <input id="prefs" className="input" value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="Rapide, sans poisson, végétarien…" />

      <div className="col" style={{ gap: 10, marginTop: 14 }}>
        {busy === "ideas" ? <Spinner label="L'IA prépare des idées…" /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>

      <div className="col" style={{ gap: 12, marginTop: 6 }}>
        {ideas.map((s, i) => (
          <article key={i} className="pb-glass" style={{ padding: 16, display: "grid", gap: 8 }}>
            <h2 className="s" style={{ fontSize: 17, margin: 0 }}>{s.emoji ? `${s.emoji} ` : ""}{s.dish}</h2>
            <span className="pb-num pb-muted" style={{ fontSize: 13 }}>{fmt(s.calories)} kcal · {fmt(s.protein_g)} g prot. · {fmt(s.carbs_g)} g gluc.{s.prep_min ? ` · ${s.prep_min} min` : ""}</span>
            {s.why ? <p style={{ margin: 0, fontSize: 14 }}>{s.why}</p> : null}
            {open === i ? (
              <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{s.ingredients.map((g) => <li key={g}>{g}</li>)}</ul>
                {s.missing?.length ? <p className="pb-muted" style={{ margin: 0 }}>À acheter : {s.missing.join(", ")}</p> : null}
                {s.recipe ? <ol style={{ margin: 0, paddingLeft: 18 }}>{s.recipe.split(" · ").map((st) => <li key={st}>{st}</li>)}</ol> : null}
              </div>
            ) : null}
            <div className="row" style={{ gap: 8 }}>
              <button className="pb-btn" onClick={() => setOpen(open === i ? null : i)}>{open === i ? "Masquer" : "Recette"}</button>
              <button className="pb-btn primary" disabled={saved === i} onClick={() => eat(i)}><Icon name="check" size="sm" />{saved === i ? "Ajouté" : "Je mange ça"}</button>
            </div>
          </article>
        ))}
      </div>

      <BottomAction>
        <button className="pb-btn primary lg block" onClick={propose} disabled={busy != null}><Icon name="bolt" size="sm" />{ideas.length ? "Autres idées" : "Proposer des plats"}</button>
      </BottomAction>
    </main>
  );
}

// ---------- Connexion PRONOTE ----------

/** Jours où le joueur mange à la cantine : les autres jours, il scanne son repas de midi. */
function CantineDays() {
  const { profile, setProfile } = useApp();
  if (!profile) return null;
  const days = profile.cantine_days?.length ? profile.cantine_days : [0, 1, 2, 3, 4];
  async function toggle(d: number) {
    const next = (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]).sort();
    setProfile({ ...profile!, cantine_days: next });
    menuCache.clear();
    await updateProfile({ cantine_days: next }).catch(() => undefined);
  }
  return (
    <>
      <div className="lbl section">Je mange à la cantine le</div>
      <div className="pb-chips chips-wrap" aria-label="Jours de cantine">
        {[0, 1, 2, 3, 4].map((d) => <Chip key={d} active={days.includes(d)} onClick={() => toggle(d)}>{DAYS_SHORT[d]}</Chip>)}
      </div>
      <p className="pb-subtle" style={{ fontSize: 13, margin: "6px 2px 16px" }}>Les autres jours, la carte du midi te propose de scanner ton repas.</p>
    </>
  );
}

export function PronoteLink() {
  const nav = useNavigate();
  const [status, setStatus] = useState<{ linked: boolean; username: string | null; via?: "noteflow" } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { nutrition({ action: "pronote_status" }).then(setStatus).catch((e) => setError(e.message)); }, []);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await nutrition<{ ok?: boolean; needPin?: boolean; error?: string }>({ action: "pronote_connect", username, password, pin: pin || undefined });
      if (r.needPin) { setNeedPin(true); if (r.error) setError(r.error); }
      else { setPassword(""); menuCache.clear(); nav("/nutrition"); }
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }
  async function disconnect() {
    await nutrition({ action: "pronote_disconnect" }).catch(() => undefined);
    menuCache.clear();
    setStatus({ linked: false, username: null });
  }

  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton to="/nutrition" /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>PRONOTE</h1>
      <p className="lead">Pour lire chaque jour le menu de la cantine publié par le collège.</p>
      <CantineDays />
      {status?.via === "noteflow" ? (
        <Notice tone="ok">Connecté par NoteFlow : l'app utilise ta connexion PRONOTE déjà faite dans NoteFlow. Rien à saisir ici.</Notice>
      ) : status?.linked ? (
        <div className="col" style={{ gap: 10, marginTop: 16 }}>
          <Notice tone="ok">Connecté en tant que {status.username}.</Notice>
          <button className="pb-btn lg danger" onClick={disconnect}>Déconnecter PRONOTE</button>
        </div>
      ) : (
        <form className="col" style={{ gap: 10, marginTop: 16 }} onSubmit={connect}>
          <label className="lbl" htmlFor="pu">Identifiant PRONOTE</label>
          <input id="pu" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <label className="lbl" htmlFor="pp">Mot de passe</label>
          <input id="pp" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {needPin ? (
            <>
              <label className="lbl" htmlFor="pin">Code PIN PRONOTE (double authentification)</label>
              <input id="pin" className="input" inputMode="numeric" autoComplete="one-time-code" value={pin} onChange={(e) => setPin(e.target.value)} />
            </>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <button className="pb-btn primary lg" disabled={busy || !username || !password}>{busy ? "Connexion…" : "Connecter"}</button>
          <p className="pb-subtle" style={{ fontSize: 13, margin: 0 }}>Ton mot de passe sert une seule fois et n'est jamais enregistré : l'app garde seulement un jeton de connexion, que tu peux supprimer en te déconnectant.</p>
        </form>
      )}
    </main>
  );
}

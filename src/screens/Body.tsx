import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApp, latest } from "../state/app";
import { Icon } from "../components/Icon";
import { LineChart } from "../components/LineChart";
import { BackButton, Chip, Delta, Notice, Stat } from "../components/ui";
import { supabase } from "../lib/supabase";
import { updateProfile } from "../lib/data";
import { addDays, ago, num, parse, today } from "../lib/format";
import { INDICATORS, series } from "../lib/indicators";

const KINDS = ["weight", "fat_pct", "muscle_kg", "rhr", "bmr"] as const;
// Saisie manuelle : plage plausible et textes de chaque mesure.
const ENTRY: Record<(typeof KINDS)[number], { min: number; max: number; title: string; what: string; hint: string; saved: string }> = {
  weight: { min: 30, max: 200, title: "Ajouter une pesée", what: "un poids", hint: "72,4…", saved: "Poids enregistré." },
  fat_pct: { min: 3, max: 50, title: "Ajouter une masse grasse", what: "une masse grasse", hint: "14,5…", saved: "Masse grasse enregistrée." },
  muscle_kg: { min: 10, max: 120, title: "Ajouter une masse musculaire", what: "une masse musculaire", hint: "23,0…", saved: "Masse musculaire enregistrée." },
  rhr: { min: 30, max: 120, title: "Ajouter une FC au repos", what: "une fréquence cardiaque", hint: "58…", saved: "FC au repos enregistrée." },
  bmr: { min: 800, max: 4000, title: "Ajouter un métabolisme de base", what: "un métabolisme de base", hint: "1450…", saved: "Métabolisme de base enregistré." },
};

export default function Body() {
  const { profile, measurements, setProfile } = useApp();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("weight");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const ind = INDICATORS[kind];
  const entry = ENTRY[kind];
  const list = series(measurements, kind);
  const from = addDays(today(), -90);
  const pts = list.filter((p) => p.at >= from).slice(-16).map((p) => ({ label: `${parse(p.at).getDate()}/${parse(p.at).getMonth() + 1}`, value: p.value }));
  const history = measurements.filter((m) => m.kind === kind).sort((a, b) => b.measured_at.localeCompare(a.measured_at)).slice(0, 20);

  async function add(e: FormEvent) {
    e.preventDefault();
    const v = parseFloat(value.replace(",", "."));
    if (!Number.isFinite(v) || v < entry.min || v > entry.max) return setMsg({ tone: "error", text: `Indique ${entry.what} entre ${entry.min} et ${entry.max} ${ind.unit}.` });
    const { error } = await supabase.from("measurements").insert({ kind, value: v, source: "manual" });
    if (error) return setMsg({ tone: "error", text: "L'enregistrement a échoué. Réessaie." });
    if (kind === "weight") {
      await updateProfile({ weight_kg: v });
      setProfile({ ...profile!, weight_kg: v });
    }
    setValue("");
    setMsg({ tone: "ok", text: entry.saved });
  }

  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton /><h1 className="t" style={{ fontSize: 22 }}>Mesures corporelles</h1></div>
      <div className="pb-glass" style={{ padding: "4px 0", marginTop: 12 }}>
        <div className="pb-li">
          <div className="t">TrackFit<small>{profile?.trackfit_connected ? `Synchro ${ago(profile.trackfit_synced_at)}` : "Non connecté · saisie manuelle"}</small></div>
          <span className="pill-sm" style={{ color: profile?.trackfit_connected ? "var(--success)" : "var(--ink-muted)" }}>{profile?.trackfit_connected ? "Connecté" : "Déconnecté"}</span>
        </div>
      </div>
      <Link to="/pesee" className="pb-btn primary block" style={{ marginTop: 12 }}><Icon name="scale" size="sm" />Me peser avec ma balance</Link>
      <div className="grid2 fill-last" style={{ marginTop: 12 }}>
        {KINDS.map((k) => {
          const l = latest(measurements, k);
          const i = INDICATORS[k];
          return <Stat key={k} k={i.label} v={l.value != null ? num(l.value, i.digits) : "—"} unit={i.unit} delta={<Delta diff={l.value != null && l.prev != null ? l.value - l.prev : null} better={i.better} digits={i.digits} />} />;
        })}
      </div>
      <div className="pb-chips" style={{ margin: "16px 0 0" }}>
        {KINDS.map((k) => <Chip key={k} active={k === kind} onClick={() => { setKind(k); setValue(""); setMsg(null); }}>{INDICATORS[k].label}</Chip>)}
      </div>
      <div className="pb-glass" style={{ marginTop: 12, padding: 14 }}>
        <h3 className="s" style={{ fontSize: 16 }}>{ind.label} · 3 mois</h3>
        <LineChart points={pts} unit={ind.unit} digits={ind.digits} ariaLabel={ind.label} />
      </div>
      {!profile?.trackfit_connected ? (
        <form className="pb-glass" style={{ marginTop: 12, padding: 14, display: "grid", gap: 10 }} onSubmit={add}>
          <label className="lbl" htmlFor="wv">{entry.title}</label>
          <div className="row">
            <div className="input-unit" style={{ flex: 1 }}><input id="wv" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={entry.hint} /><span>{ind.unit}</span></div>
            <button className="pb-btn primary lg">Ajouter</button>
          </div>
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        </form>
      ) : <p className="pb-subtle" style={{ fontSize: 13 }}>Pour saisir tes mesures à la main, déconnecte TrackFit dans <Link className="link" to="/profil/trackfit">Profil › TrackFit</Link>.</p>}
      <div className="lbl section">Historique</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {history.length ? history.map((m) => (
          <div key={m.id} className="pb-li"><div className="t">{num(Number(m.value), ind.digits)} {ind.unit}<small>{new Date(m.measured_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</small></div><span className="pill-sm">{m.source === "trackfit" ? "TrackFit" : m.source === "camera" ? "Caméra" : "Manuel"}</span></div>
        )) : <p className="pb-muted" style={{ padding: 16, margin: 0 }}>Aucune mesure pour l'instant.</p>}
      </div>
    </main>
  );
}

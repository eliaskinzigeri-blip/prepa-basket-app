// Pesée directe : l'app se connecte elle-même à la balance FitTrack en Bluetooth et enregistre la pesée.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { BackButton, BottomAction, Chip, Notice } from "../components/ui";
import { useApp } from "../state/app";
import { supabase } from "../lib/supabase";
import { updateProfile } from "../lib/data";
import { num } from "../lib/format";
import { bmrOf } from "../lib/energy";
import { ScaleFail, ScaleSession, findKnownScale, knownScale, pickScale, scaleErrorText, type ScaleState, type ScaleUser, type Weighing } from "../lib/scale";

const SEX_KEY = "pb.scale.sex";
const readSex = () => { try { return localStorage.getItem(SEX_KEY) !== "f"; } catch { return true; } };

function ageOf(birth: string | null): number {
  if (!birth) return 14;
  const b = new Date(birth), n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
}

const STATE_TEXT: Record<ScaleState, string> = {
  idle: "Balance pas encore choisie",
  waiting: "Monte sur la balance",
  connected: "Balance connectée, reste immobile",
  measuring: "Pesée en cours, reste immobile",
  done: "Pesée enregistrée",
  error: "Problème avec la balance",
};

export default function Scale() {
  const { profile, setProfile } = useApp();
  const [male, setMale] = useState(readSex);
  const [state, setState] = useState<ScaleState>("idle");
  const [live, setLive] = useState<{ kg: number; stable: boolean } | null>(null);
  const [saved, setSaved] = useState<Weighing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const session = useRef<ScaleSession | null>(null);
  const user: ScaleUser = { male, age: ageOf(profile?.birth_date ?? null), heightCm: profile?.height_cm ?? 170 };
  const userRef = useRef(user);
  userRef.current = user;
  const known = knownScale();

  async function save(scaleW: Weighing) {
    const at = new Date().toISOString();
    // Métabolisme : équation validée chez les jeunes sportifs, pas l'algorithme inconnu de la balance.
    const w = { ...scaleW, bmr: bmrOf(scaleW.weight, userRef.current.heightCm, userRef.current.age, userRef.current.male) ?? undefined };
    const rows = [
      { kind: "weight", value: w.weight },
      w.fat_pct != null ? { kind: "fat_pct", value: w.fat_pct } : null,
      w.muscle_kg != null ? { kind: "muscle_kg", value: w.muscle_kg } : null,
      w.bmr != null ? { kind: "bmr", value: w.bmr } : null,
    ].filter(Boolean).map((r) => ({ ...r!, source: "trackfit", measured_at: at }));
    const { error: e } = await supabase.from("measurements").insert(rows);
    if (e) { setError("La pesée n'a pas pu être enregistrée. Vérifie ta connexion, puis repèse-toi."); return; }
    const patch = { weight_kg: w.weight, trackfit_synced_at: at };
    await updateProfile(patch);
    if (profile) setProfile({ ...profile, ...patch });
    setSaved(w as Weighing);
  }

  function start(device: BluetoothDevice) {
    session.current?.stop();
    setSaved(null);
    setLive(null);
    setError(null);
    const s = new ScaleSession(device, userRef.current, {
      onState: (st, detail) => {
        setState(st);
        if (detail === "unknown-scale") setError("Cette balance ne parle pas un langage connu. Copie le journal en bas de page et envoie-le pour qu'on l'ajoute.");
      },
      onLive: (kg, stable) => setLive({ kg, stable }),
      onDone: (w) => { void save(w); },
      onLog: (line) => setLog((l) => [...l.slice(-300), `${new Date().toLocaleTimeString("fr-FR")}  ${line}`]),
    });
    session.current = s;
    void s.run();
  }

  // Balance déjà choisie : l'app l'attend toute seule dès que la page est ouverte.
  useEffect(() => {
    let alive = true;
    void findKnownScale().then((d) => { if (d && alive) start(d); });
    return () => { alive = false; session.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose() {
    setError(null);
    try { start(await pickScale()); } catch (e) { setError(scaleErrorText((e as ScaleFail).code ?? "failed")); }
  }
  function again() {
    const d = session.current?.device;
    if (d) start(d); else void choose();
  }
  function setSex(m: boolean) {
    setMale(m);
    try { localStorage.setItem(SEX_KEY, m ? "m" : "f"); } catch { /* rien */ }
  }

  const running = state === "waiting" || state === "connected" || state === "measuring";
  const shown = saved?.weight ?? live?.kg ?? null;

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 190 }}>
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Me peser</h1>
      <p className="lead">Garde cette page ouverte et monte sur ta balance FitTrack : la pesée arrive toute seule.</p>

      <section className="pb-glass" aria-live="polite" style={{ marginTop: 18, padding: "26px 16px", textAlign: "center", display: "grid", gap: 6 }}>
        <span className="pb-num" style={{ fontSize: 64, lineHeight: "68px", fontWeight: 700, color: saved ? "var(--success)" : live?.stable ? "var(--ink)" : "var(--ink-muted)" }}>
          {shown != null ? num(shown, 1) : "—"}<span style={{ fontSize: 22, fontWeight: 600, marginLeft: 6 }}>kg</span>
        </span>
        <b style={{ fontSize: 15 }}>{STATE_TEXT[state]}</b>
        {saved ? (
          <span className="pb-muted" style={{ fontSize: 14 }}>
            {[saved.fat_pct != null ? `Masse grasse ${num(saved.fat_pct, 1)} %` : null, saved.muscle_kg != null ? `Masse musculaire ${num(saved.muscle_kg, 1)} kg` : null, saved.bmr != null ? `Métabolisme ${num(saved.bmr)} kcal/j` : null].filter(Boolean).join(" · ") || "Poids seul : la balance n'a pas envoyé la composition corporelle."}
          </span>
        ) : running ? <span className="pb-muted" style={{ fontSize: 13 }}>{known?.name ?? "Balance"} · pieds nus pour la masse grasse</span> : null}
      </section>

      <div className="col" style={{ gap: 10, marginTop: 14 }}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="ok">Pesée ajoutée à tes mesures.</Notice> : null}
        {running ? <Notice>Ferme l'app FitTrack si elle est ouverte : la balance ne parle qu'à une app à la fois.</Notice> : null}
      </div>

      <div className="lbl section">Pour le calcul de la masse grasse</div>
      <div className="pb-chips" aria-label="Sexe">
        <Chip active={male} onClick={() => setSex(true)}>Garçon</Chip>
        <Chip active={!male} onClick={() => setSex(false)}>Fille</Chip>
      </div>
      <p className="pb-subtle" style={{ fontSize: 13, margin: "6px 2px 0" }}>
        {user.age} ans · {user.heightCm} cm, d'après ton profil. Ces réglages sont envoyés à la balance à chaque pesée.
      </p>

      <div className="pb-glass" style={{ padding: "4px 0", marginTop: 14 }}>
        <Link to="/mesures" className="pb-li"><Icon name="chart" className="pb-muted" /><div className="t">Mes mesures<small>Historique et courbes</small></div><Icon name="right" size="sm" className="pb-muted" /></Link>
        <button className="pb-li" onClick={choose}><Icon name="bluetooth" className="pb-muted" /><div className="t">{known ? "Changer de balance" : "Choisir ma balance"}<small>{known ? known.name : "Une seule fois : ensuite l'app la retrouve seule"}</small></div><Icon name="right" size="sm" className="pb-muted" /></button>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary className="lbl" style={{ cursor: "pointer" }}>Journal Bluetooth ({log.length} lignes)</summary>
        <button className="pb-btn" style={{ margin: "8px 0" }} onClick={() => navigator.clipboard?.writeText(log.join("\n")).then(() => setCopied(true))}>
          <Icon name={copied ? "check" : "edit"} size="sm" />{copied ? "Journal copié" : "Copier le journal"}
        </button>
        <pre className="pb-glass" style={{ padding: 12, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 260, overflow: "auto", margin: 0 }} translate="no">{log.join("\n") || "Rien pour l'instant."}</pre>
      </details>

      <BottomAction>
        {saved || state === "error" || state === "idle"
          ? <button className="pb-btn primary lg block" onClick={saved ? again : choose}><Icon name="scale" size="sm" />{saved ? "Nouvelle pesée" : known ? "Se reconnecter à la balance" : "Choisir ma balance"}</button>
          : <button className="pb-btn lg block" disabled><Icon name="bluetooth" size="sm" />En attente de la balance…</button>}
      </BottomAction>
    </main>
  );
}

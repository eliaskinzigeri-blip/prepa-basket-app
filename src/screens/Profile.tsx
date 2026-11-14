import { useState } from "react";
import { Link } from "react-router-dom";
import { disablePush, enablePush, pushSupported, savedToken, testPush } from "../lib/push";
import { faceIdAvailable, faceIdEnabled, isNative, setFaceId } from "../native";
import { useEffect } from "react";
import { Notice } from "../components/ui";
import { useApp } from "../state/app";
import { Icon, type IconName } from "../components/Icon";
import { BottomNav, Toggle } from "../components/ui";
import { updateProfile } from "../lib/data";
import { ago } from "../lib/format";
import { EXPERIENCES, HOME_EQUIPMENT, LEVELS, POSITIONS, skill } from "../data/catalog";
import { hasRower } from "../lib/rower/plans";
import { pendingCount } from "../lib/data";

export default function Profile() {
  const { profile, setProfile } = useApp();
  if (!profile) return null;
  const p = profile;
  const set = (patch: Partial<typeof p>) => { setProfile({ ...p, ...patch }); updateProfile(patch).catch(() => setProfile(p)); };
  const places = [p.workout_locations.includes("basicfit") ? "Basic-Fit" : null, p.workout_locations.includes("salle") ? "Salle" : null, p.workout_locations.includes("maison") ? "Maison" : null, p.has_hoop ? "panier" : null].filter(Boolean).join(" · ");
  const pending = pendingCount();

  return (
    <main className="pb-page screen">
      <div className="hdr" style={{ marginTop: 4 }}><h1 className="t">Profil</h1><span className="sp" /><Link to="/profil/compte" className="pb-icon-btn" aria-label="Compte et confidentialité"><Icon name="gear" /></Link></div>
      <Link to="/profil/joueur" className="pb-glass hero" style={{ marginTop: 14, padding: 16, display: "flex", alignItems: "center", gap: 14, color: "inherit", textDecoration: "none" }}>
        <div className="pb-avatar" style={{ width: 64, height: 64, borderRadius: 20, fontSize: 24 }}>{(p.first_name ?? "?")[0]?.toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 18 }}>{p.first_name}</b>
          <div className="pb-muted" style={{ fontSize: 13, marginTop: 2 }}>{POSITIONS.find((x) => x.id === p.position)?.label} · {LEVELS.find((x) => x.id === p.level)?.label} · {EXPERIENCES.find((x) => x.id === p.experience)?.label.toLowerCase()}</div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {p.priorities_high.map((s) => <span key={s} className="pill-sm" style={{ background: "var(--primary-soft)", color: "var(--primary-bright)" }}>{skill(s)?.short}</span>)}
          </div>
        </div>
        <Icon name="edit" size="sm" className="pb-muted" />
      </Link>
      {pending ? <p className="pb-muted" style={{ fontSize: 13 }}>{pending} séance{pending > 1 ? "s" : ""} en attente de synchro (hors ligne).</p> : null}

      <div className="lbl section">Connexions</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <Row to="/profil/trackfit" tile="scale" color="var(--success)" title="TrackFit" sub={p.trackfit_connected ? `Synchro ${ago(p.trackfit_synced_at)}` : "Non connecté"}
          right={<span className="pill-sm" style={{ color: p.trackfit_connected ? "var(--success)" : "var(--ink-muted)" }}>{p.trackfit_connected ? "Connecté" : "Connecter"}</span>} />
        {hasRower(p) ? <Row to="/rameur" tile="rower" color="var(--primary-bright)" title="Rameur" sub="Connexion, test de niveau, diagnostic" /> : null}
        <Row to="/profil/ffbb" tile="ball" color="var(--cat-match)" title="FFBB" sub={p.ffbb_club ? `${p.ffbb_club.name}${p.ffbb_team ? ` · ${p.ffbb_team.label.split(" · ")[0]}` : ""}` : "Non licencié · matchs à la main"} />
      </div>

      <div className="lbl section">Programme</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <Row to="/objectifs" icon="target" title="Mes objectifs" sub="Ils choisissent tes tests et orientent ton programme" />
        <Row to="/sommeil" icon="heart" title="VFC du matin" sub="Ta zone normale et la tendance sur 7 jours" />
        <Row to="/profil/tests" icon="timer" title="Fréquence des tests" sub={`Toutes les ${p.test_every_weeks ?? 4} semaines`} />
        <Row to="/exercices" icon="dumbbell" title="Bibliothèque d'exercices" sub="Pliométrie, renfo, cardio, mobilité…" />
        <Row to="/profil/priorites" icon="target" title="Priorités" sub={p.priorities_high.concat(p.priorities_low).map((s) => skill(s)?.short).join(", ")} />
        <Row to="/profil/lieux" icon="house" title="Lieux & matériel" sub={`${places}${p.home_equipment.length ? ` · ${p.home_equipment.map((e) => HOME_EQUIPMENT.find((h) => h.id === e)?.label).join(", ")}` : ""}`} />
        <Row to="/profil/semaine" icon="cal" title="Emploi du temps" sub={`${p.ab_weeks ? "Semaines A / B" : "Semaine unique"} · limite ${Math.floor(p.latest_min / 60)}h${p.latest_min % 60 ? String(p.latest_min % 60).padStart(2, "0") : ""} · ${p.session_minutes} min`} />
        <Row to="/profil/basket" icon="ball" title="Poste & niveau" sub={`${POSITIONS.find((x) => x.id === p.position)?.label} · ${LEVELS.find((x) => x.id === p.level)?.label}`} />
      </div>

      <div className="lbl section" id="notifications">Notifications</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {isNative() ? <div className="pb-li"><div className="t">Rappels programmés sur ce téléphone<small>Recalculés à chaque ouverture de l'app, pour les 7 prochains jours</small></div></div> : <PushRow />}
        <div className="pb-li"><div className="t">Séance dans 30 min<small>Avec ta forme du jour : normale, allégée ou récupération</small></div><Toggle on={p.notif_session} onChange={(v) => { set({ notif_session: v }); askNotif(v); }} label="Rappel 30 min avant séance" /></div>
        <div className="pb-li"><div className="t">Le matin<small>Mesure ta VFC avant de te lever, à ton heure de lever prévue par NoteFlow</small></div><Toggle on={p.notif_morning ?? true} onChange={(v) => set({ notif_morning: v })} label="Rappels du matin" /></div>
        <div className="pb-li"><div className="t">Rappel de match</div><Toggle on={p.notif_match} onChange={(v) => { set({ notif_match: v }); askNotif(v); }} label="Rappel de match" /></div>
      </div>

      {isNative() ? <><div className="lbl section">Sécurité</div><div className="pb-glass" style={{ padding: "4px 0" }}><FaceIdRow /></div></> : null}

      <div className="lbl section">Caméra</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <div className="pb-li"><Icon name="camera" className="pb-muted" /><div className="t">Analyse sur le téléphone<small>Aucune vidéo n'est envoyée sur un serveur</small></div></div>
        <Row to="/profil/compte" icon="lock" title="Compte & confidentialité" sub="Déconnexion, suppression du compte" />
      </div>
      <p className="pb-subtle" style={{ textAlign: "center", fontSize: 12, margin: "16px 0 0" }}>Version du {new Date(__BUILD__).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</p>
      <BottomNav />
    </main>
  );
}

/** App iPhone : Face ID à l'ouverture et au retour après 5 min. */
function FaceIdRow() {
  const [on, setOn] = useState(faceIdEnabled);
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { faceIdAvailable().then(setOk).catch(() => setOk(false)); }, []);
  return (
    <div className="pb-li">
      <div className="t">Verrouiller avec Face ID<small>{ok === false ? "Face ID n'est pas réglé sur ce téléphone" : "À l'ouverture, et au retour après 5 min"}</small></div>
      <Toggle on={on} label="Verrouiller avec Face ID" onChange={async (v) => { if (ok && (await setFaceId(v))) setOn(v); }} />
    </div>
  );
}

/** Notifications sur ce téléphone (Firebase de NoteFlow), même l'app fermée. */
function PushRow() {
  const [on, setOn] = useState(() => !!savedToken());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  async function run(fn: () => Promise<string | void>) {
    setBusy(true); setError(null); setInfo(null);
    try { const m = await fn(); if (m) setInfo(m); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  const toggle = () => run(async () => {
    if (on) { await disablePush(); setOn(false); return; }
    await enablePush(); setOn(true);
    return await testPush().catch(() => "Notifications activées.");
  });
  return (
    <div style={{ padding: "8px 14px 10px", display: "grid", gap: 8 }}>
      <div className="row between" style={{ gap: 10 }}>
        <div className="t" style={{ fontSize: 15 }}>Notifications sur ce téléphone<small className="pb-muted" style={{ display: "block", fontSize: 13 }}>{on ? "Activées, même l'app fermée" : "Désactivées"}</small></div>
        <div className="row" style={{ gap: 6 }}>
          {on ? <button className="pb-btn sm" disabled={busy} onClick={() => run(testPush)}>Tester</button> : null}
          <button className={`pb-btn sm${on ? "" : " primary"}`} disabled={busy || (!on && !pushSupported())} onClick={toggle}>{busy ? "…" : on ? "Couper" : "Activer"}</button>
        </div>
      </div>
      {info ? <Notice tone="ok">{info}</Notice> : null}
      {!on && !pushSupported() ? <Notice>Sur iPhone, ajoute d'abord Prépa Basket à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvre l'app depuis son icône.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

function askNotif(on: boolean) {
  if (on && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
}

function Row({ to, icon, tile, color, title, sub, right }: { to: string; icon?: IconName; tile?: IconName; color?: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <Link to={to} className="pb-li">
      {tile ? <div className="pb-tile" style={{ width: 40, height: 40, color }}><Icon name={tile} size="sm" /></div> : icon ? <Icon name={icon} className="pb-muted" /> : null}
      <div className="t">{title}{sub ? <small>{sub}</small> : null}</div>
      {right ?? <Icon name="right" size="sm" className="pb-muted" />}
    </Link>
  );
}

// Connexion du rameur et de la ceinture cardio, et diagnostic Bluetooth (d'après RameFit).
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { BackButton, BottomAction, Notice } from "../../components/ui";
import { BleError, connectErrorMessage, connectHeartRate, connectRower, ensureBluetooth, hub, isIOS, reconnectKnownRower, startDemo } from "../../lib/rower/rower";
import { rememberDevice, rememberedDevice } from "../../lib/rower/session";

export const useHub = () => useSyncExternalStore(hub.subscribe, hub.getVersion);
export const errorText = (e: unknown) => connectErrorMessage((e as BleError).code ?? "failed");

/** Rameur connu : reconnexion sans liste quand le navigateur le permet, sinon recherche. */
export async function connectAny() {
  const known = rememberedDevice();
  const quick = known && !hub.rower ? await reconnectKnownRower(known.id).catch(() => null) : null;
  rememberDevice(quick ?? (await connectRower()));
}

export default function RowerConnect() {
  useHub();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [hasBle, setHasBle] = useState(true);
  const [busy, setBusy] = useState(false);
  const r = hub.rower;
  const connected = r?.state === "connected";
  const known = rememberedDevice();

  useEffect(() => { void ensureBluetooth().then(setHasBle); }, []);

  async function search() {
    setError(null);
    setBusy(true);
    try { await connectAny(); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  async function addHr() {
    setError(null);
    try { await connectHeartRate(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 190 }}>
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Connecte ton rameur</h1>
      <p className="lead">Allume la console en ramant quelques coups, puis lance la recherche.</p>

      <div className="pb-glass" style={{ padding: "4px 0", marginTop: 18 }}>
        <button className="pb-li" onClick={connected ? undefined : search} disabled={busy}>
          <div className="pb-tile" style={{ width: 44, height: 44, color: connected ? "var(--success)" : "var(--primary-bright)" }}><Icon name="rower" size="sm" /></div>
          <div className="t">{r?.name ?? known?.name ?? "Domyos Woodrower"}<small>{connected ? (r?.isDemo ? "Rameur simulé : aucune donnée réelle" : r?.control === "control" ? "Résistance pilotée par l'app" : "Lecture seule : tu règles la molette") : known ? "Dernier utilisé" : "Domyos compatible FTMS"}</small></div>
          <b style={{ fontSize: 14, color: connected ? "var(--success)" : undefined }}>{connected ? "Connecté" : busy ? "Recherche…" : "Connecter"}</b>
        </button>
        <button className="pb-li" onClick={hub.hrState === "connected" ? undefined : addHr}>
          <div className="pb-tile" style={{ width: 44, height: 44, color: hub.hrState === "connected" ? "var(--success)" : "var(--cat-match)" }}><Icon name="heart" size="sm" /></div>
          <div className="t">Ceinture cardio<small>{hub.hrState === "connected" ? hub.hrName : "Facultatif · Bluetooth standard"}</small></div>
          <b style={{ fontSize: 14, color: hub.hrState === "connected" ? "var(--success)" : undefined }}>{hub.hrState === "connected" ? "Connectée" : hub.hrState === "searching" ? "Recherche…" : "Ajouter"}</b>
        </button>
      </div>
      <p className="pb-subtle" style={{ fontSize: 13, margin: "8px 2px 0" }}>L'Apple Watch n'est pas lisible depuis un site : il faut une ceinture Bluetooth.</p>

      <div className="col" style={{ gap: 10, marginTop: 14 }}>
        {connected && r?.control === "coach" ? <Notice>Ce rameur ne se laisse pas piloter : l'app t'indiquera le niveau à régler à la molette.</Notice> : null}
        {r?.control === "taken" ? <Notice tone="error">Une autre app pilote le rameur. Ferme Kinomap ou EXR, puis relance la connexion.</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {isIOS() && !hasBle ? <Notice>Sur iPhone, Safari ne parle pas seul au Bluetooth. Installe l'app gratuite beacio depuis l'App Store (iOS 26.2 minimum), active l'extension dans Réglages › Apps › Safari › Extensions, autorise-la sur ce site, puis ouvre Prépa Basket dans Safari.</Notice> : null}
        {!isIOS() && !hasBle ? <Notice>Ce navigateur ne gère pas le Bluetooth. Ouvre Prépa Basket dans Chrome ou Edge, ou essaie le rameur simulé.</Notice> : null}
      </div>

      <div className="pb-glass" style={{ padding: "4px 0", marginTop: 14 }}>
        <Link to="/rameur/test" className="pb-li"><Icon name="timer" className="pb-muted" /><div className="t">Test de niveau 20 min<small>Cale tes allures au rameur</small></div><Icon name="right" size="sm" className="pb-muted" /></Link>
        <Link to="/rameur/diagnostic" className="pb-li"><Icon name="bluetooth" className="pb-muted" /><div className="t">Diagnostic Bluetooth<small>Relever les réponses du rameur</small></div><Icon name="right" size="sm" className="pb-muted" /></Link>
      </div>

      <BottomAction>
        {connected
          ? <button className="pb-btn primary lg block" onClick={() => nav(-1)}>Continuer</button>
          : <button className="pb-btn primary lg block" onClick={search} disabled={!hasBle || busy}><Icon name="bluetooth" size="sm" />{busy ? "Recherche…" : "Lancer la recherche"}</button>}
        {!connected ? <button className="pb-btn lg block" onClick={() => startDemo()}>Essayer avec le rameur simulé</button> : null}
      </BottomAction>
    </main>
  );
}

const LINK_TEXT = { connected: "connecté", searching: "recherche", disconnected: "déconnecté" };
const CONTROL_TEXT = { control: "résistance pilotée", coach: "mode coach", taken: "pris par une autre app", unknown: "en cours de vérification" };

/** Relevé : vérifie ce que le rameur répond vraiment, à copier pour comprendre un problème. */
export function RowerDiagnostic() {
  useHub();
  const [, tick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const r = hub.rower;
  const s = r?.sample;

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function connect() {
    setError(null);
    try { rememberDevice(await connectRower()); } catch (e) { setError(errorText(e)); }
  }
  async function testLevels() {
    if (!r) return;
    setTesting(true);
    for (const level of [5, 6, 7, 6, 5]) {
      const res = await r.setLevel(level);
      hub.trace(`Niveau demandé ${level} : réponse ${res}, niveau lu ${r.sample.level ?? "inconnu"}`);
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    setTesting(false);
  }
  async function copy() {
    await navigator.clipboard.writeText(hub.log.join("\n"));
    setCopied(true);
  }

  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>Diagnostic Bluetooth</h1>
      <p className="lead">Rame quelques coups pendant le relevé, puis copie le résultat.</p>
      <div className="pb-glass" style={{ padding: 14, marginTop: 14, display: "grid", gap: 4 }}>
        <b>{r ? `${r.name} : ${LINK_TEXT[r.state]}` : "Aucun rameur connecté"}</b>
        <span className="pb-muted" style={{ fontSize: 13 }}>Pilotage : {r ? CONTROL_TEXT[r.control] : "—"}</span>
        {s ? <span className="pb-muted pb-num" style={{ fontSize: 13 }}>{s.spm} coups/min · {s.paceSec} s/500 m · {s.watts} W · {s.distanceM} m · FC {s.hr} · niveau {s.level ?? "?"}</span> : null}
      </div>
      {error ? <div style={{ marginTop: 12 }}><Notice tone="error">{error}</Notice></div> : null}
      <div className="col" style={{ gap: 10, marginTop: 12 }}>
        {!r || r.state !== "connected"
          ? <button className="pb-btn primary lg block" onClick={connect}>Connecter le rameur</button>
          : <button className="pb-btn primary lg block" disabled={testing} onClick={testLevels}>{testing ? "Test en cours…" : "Tester la résistance (5, 6, 7, 6, 5)"}</button>}
        {!r ? <button className="pb-btn lg block" onClick={() => startDemo()}>Essayer sur le rameur simulé</button> : null}
      </div>
      <div className="row between" style={{ margin: "18px 2px 8px" }}>
        <span className="lbl">Journal ({hub.log.length} lignes)</span>
        <button className="pb-btn" disabled={!hub.log.length} onClick={copy}>{copied ? "Copié" : "Copier"}</button>
      </div>
      <pre className="pb-glass" tabIndex={0} aria-label="Journal Bluetooth" style={{ padding: 12, margin: 0, maxHeight: 280, overflow: "auto", fontSize: 12, whiteSpace: "pre-wrap" }}>{hub.log.join("\n") || "Le journal se remplit à la connexion."}</pre>
    </main>
  );
}

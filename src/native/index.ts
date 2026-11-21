// Spécificités de l'app iPhone native (Capacitor), sans effet dans le navigateur :
// - Bluetooth natif (ceinture cardio, rameur, balance) à la place de l'extension Safari beacio ;
// - verrouillage par Face ID à l'ouverture et au retour après 5 min (réglable dans le Profil) ;
// - rappels en notifications locales : sans compte développeur payant, iOS refuse les notifications à distance
//   (Firebase) à une app installée avec SideStore ; les notifications programmées sur le téléphone, elles, marchent.
import { Capacitor } from "@capacitor/core";
import { installNativeBluetooth } from "./webBluetooth";

export const isNative = () => Capacitor.isNativePlatform();

const FACE_KEY = "pb.faceid.v1";
export const faceIdEnabled = () => { try { return localStorage.getItem(FACE_KEY) === "1"; } catch { return false; } };

/** Face ID disponible sur ce téléphone (et réglé dans iOS) ? */
export async function faceIdAvailable(): Promise<boolean> {
  if (!isNative()) return false;
  const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
  return (await BiometricAuth.checkBiometry()).isAvailable;
}

/** Demande Face ID ; vrai si c'est bien le propriétaire du téléphone. */
export async function faceId(reason = "Déverrouille Prépa Basket"): Promise<boolean> {
  const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
  try { await BiometricAuth.authenticate({ reason, cancelTitle: "Annuler", allowDeviceCredential: true }); return true; }
  catch { return false; }
}

export async function setFaceId(on: boolean): Promise<boolean> {
  if (on && !(await faceId("Active Face ID pour Prépa Basket"))) return false;
  try { if (on) localStorage.setItem(FACE_KEY, "1"); else localStorage.removeItem(FACE_KEY); } catch { /* stockage indisponible */ }
  return true;
}

/** Écran de verrouillage : couvre l'app jusqu'au déverrouillage par Face ID (ou code du téléphone). */
async function lock() {
  if (document.getElementById("pb-lock")) return;
  const box = document.createElement("div");
  box.id = "pb-lock";
  box.style.cssText = "position:fixed;inset:0;z-index:10000;background:#050a1f;display:grid;place-items:center;gap:16px;color:#fff;font:600 18px system-ui,sans-serif";
  const btn = document.createElement("button");
  btn.textContent = "Déverrouiller avec Face ID";
  btn.style.cssText = "min-height:52px;padding:0 22px;border-radius:16px;border:0;background:#5b3cff;color:#fff;font:inherit";
  box.append(Object.assign(document.createElement("span"), { textContent: "Prépa Basket" }), btn);
  document.body.appendChild(box);
  const tryUnlock = async () => { if (await faceId()) box.remove(); };
  btn.onclick = tryUnlock;
  await tryUnlock();
}

export async function initNative() {
  if (!isNative()) return;
  installNativeBluetooth();
  document.documentElement.classList.add("native");
  if (faceIdEnabled()) lock();
  // Retour dans l'app après plus de 5 min : Face ID à nouveau
  const { App } = await import("@capacitor/app");
  let leftAt = 0;
  App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) leftAt = Date.now();
    else if (faceIdEnabled() && leftAt && Date.now() - leftAt > 5 * 60_000) lock();
  });
  // Liens prepabasket://<page> (raccourci Jarvis, autres apps) : ouvre directement la page demandée,
  // par exemple prepabasket://rameur/apercu/warmup ou prepabasket://evenement/<id>.
  App.addListener("appUrlOpen", ({ url }) => openLink(url));
  openLink((await App.getLaunchUrl())?.url);
}

/** Page interne d'un lien prepabasket://… ; navigation par l'historique, que le routeur suit (popstate). */
function openLink(raw?: string) {
  if (!raw) return;
  let target: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== "prepabasket:") return;
    target = `${`/${u.host}${u.pathname}`.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1")}${u.search}`;
  } catch { return; }
  if (`${location.pathname}${location.search}` === target) return;
  history.pushState({}, "", target);
  dispatchEvent(new PopStateEvent("popstate"));
}

// ---------- rappels locaux ----------

export interface LocalReminder { id: number; at: Date; title: string; body: string; url: string }

/** Remplace tous les rappels programmés par cette liste (les 7 prochains jours). */
export async function scheduleLocal(list: LocalReminder[]): Promise<boolean> {
  if (!isNative()) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  if ((await LocalNotifications.checkPermissions()).display !== "granted" && (await LocalNotifications.requestPermissions()).display !== "granted") return false;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  const future = list.filter((r) => r.at.getTime() > Date.now() + 30_000).slice(0, 60);
  if (future.length) {
    await LocalNotifications.schedule({
      notifications: future.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true }, extra: { url: r.url } })),
    });
  }
  return true;
}

/** Un tap sur une notification locale ouvre la bonne page. */
export async function onLocalTap(go: (url: string) => void) {
  if (!isNative()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  LocalNotifications.addListener("localNotificationActionPerformed", (a) => { const u = a.notification.extra?.url; if (typeof u === "string") go(u); });
}

// Notifications par le Firebase de NoteFlow (projet noteflow-406b0) : ce téléphone reçoit un jeton FCM, enregistré dans
// Prépa Basket ; le serveur (fonction « push ») envoie les rappels par le pont NoteFlow, qui garde la clé du compte de service.
// La configuration web ci-dessous est publique par conception (elle identifie le projet, elle ne donne aucun droit).
import { supabase } from "./supabase";

const FIREBASE = {
  apiKey: "AIzaSyCDdYghjh__qTrLnj6Ws70FdUm4cTG_2Y4",
  authDomain: "noteflow-406b0.firebaseapp.com",
  projectId: "noteflow-406b0",
  messagingSenderId: "960681581532",
  appId: "1:960681581532:web:d3d74a71ea7ffcf1a74d19",
};
const VAPID = "BBt9Urxvr9AzCABcECwZWWcDTbDXFSF3J9YFbhXkJYuJFEADLXc6ZkArhWRENsBdoEJmaHqX5lDF02e4tZfPi44";
const SDK = "https://www.gstatic.com/firebasejs/13.1.0";
const KEY = "pb.push.token";

const IOS_HINT = "Sur iPhone, ajoute d'abord Prépa Basket à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvre l'app depuis son icône.";
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
export const savedToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const remember = (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function messaging(): Promise<{ m: any; msg: any }> {
  const [app, m] = await Promise.all([import(/* @vite-ignore */ `${SDK}/firebase-app.js`), import(/* @vite-ignore */ `${SDK}/firebase-messaging.js`)]);
  const instance = app.getApps()[0] || app.initializeApp(FIREBASE);
  if (!(await m.isSupported())) throw new Error(`Ce navigateur ne reçoit pas les notifications. ${IOS_HINT}`);
  return { m, msg: m.getMessaging(instance) };
}

/** Demande l'autorisation, récupère le jeton de ce téléphone et l'enregistre. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error(`Ce navigateur ne reçoit pas les notifications. ${IOS_HINT}`);
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Autorise les notifications pour Prépa Basket dans les réglages du téléphone, puis réessaie.");
  const { m, msg } = await messaging();
  const reg = await navigator.serviceWorker.ready;
  const token: string = await m.getToken(msg, { vapidKey: VAPID, serviceWorkerRegistration: reg });
  if (!token) throw new Error("Firebase n'a pas fourni de jeton. Réessaie dans un instant.");
  const previous = savedToken();
  if (previous && previous !== token) await supabase.from("push_tokens").delete().eq("token", previous);
  const { error } = await supabase.from("push_tokens").upsert({ token }, { onConflict: "token" });
  if (error) throw new Error("Le téléphone n'a pas pu être enregistré. Vérifie ta connexion.");
  remember(token);
}

/** Envoie tout de suite une notification de test sur les téléphones du joueur. */
export async function testPush(): Promise<string> {
  const { data, error } = await supabase.functions.invoke("push", { body: { test: true } });
  if (error) {
    let msg = "Le serveur n'a pas pu envoyer la notification.";
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* pas de corps */ }
    throw new Error(msg);
  }
  if (!data?.sent) throw new Error(data?.error ?? "Firebase n'a pas accepté la notification. Coupe puis réactive les notifications.");
  return "Notification envoyée : elle arrive dans quelques secondes.";
}

export interface RoutineTimes { day: string; wake?: number; bed?: number; nextWake?: number }
/** Coucher du soir et lever du lendemain prévus par la routine NoteFlow (null si non relié ou injoignable). */
export async function routineTimes(day: string): Promise<RoutineTimes | null> {
  const { data, error } = await supabase.functions.invoke("push", { body: { routine: true, day } });
  return error || !data || data.error ? null : (data as RoutineTimes);
}

/** Coupe les notifications sur ce téléphone. */
export async function disablePush(): Promise<void> {
  const previous = savedToken();
  remember(null);
  if (previous) await supabase.from("push_tokens").delete().eq("token", previous);
  try { const { m, msg } = await messaging(); await m.deleteToken(msg); } catch { /* déjà supprimé */ }
}

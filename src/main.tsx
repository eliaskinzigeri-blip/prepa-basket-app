import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./design-system/tokens.css";
import "./design-system/bundle.css";
import "./app.css";
import { App } from "./App";
import { AppProvider } from "./state/app";
import { registerSW } from "virtual:pwa-register";
import { initNative, isNative } from "./native";

// Nouvelle version disponible : on l'installe seulement quand l'app n'est plus à l'écran (changement d'app,
// écran verrouillé), pour ne jamais recharger la page pendant qu'on navigue.
// Exception : si la nouvelle version arrive dans les premières secondes (app tout juste ouverte), on l'installe tout de suite.
// Jamais pendant une séance, un jeu ou un test : recharger ferait perdre ce qui n'est pas encore enregistré.
const busy = () => ["/seance/", "/dribble/", "/shoot", "/test/"].some((p) => window.location.pathname.startsWith(p));
let pending = false;
const openedAt = performance.now();
// App iPhone native : pas de service worker (les fichiers sont dans l'app), Bluetooth natif et Face ID
void initNative();
const updateSW = isNative() ? (() => Promise.resolve()) as unknown as ReturnType<typeof registerSW> : registerSW({
  immediate: true,
  onNeedRefresh: () => { if (performance.now() - openedAt < 6000 && !busy()) updateSW(true); else pending = true; },
  // Une PWA sur iPhone reste ouverte des jours : on cherche une nouvelle version à chaque retour sur l'app,
  // pour ne pas faire tourner longtemps une ancienne version (programme refait avec d'anciennes règles).
  onRegisteredSW: (_url, reg) => {
    if (!reg) return;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => undefined); });
  },
});
document.addEventListener("visibilitychange", () => { if (document.hidden && pending && !busy()) updateSW(true); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* startTransition : en changeant d'onglet, l'écran actuel reste affiché le temps que le suivant se charge (pas d'écran vide) */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);

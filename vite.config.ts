import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Le worker de vision (public/vision-worker.js) charge MediaPipe avec importScripts :
// on publie la version CommonJS du paquet installé à /mediapipe/vision_bundle.js.
function mediapipeForWorker(): Plugin {
  const path = "/mediapipe/vision_bundle.js";
  const source = () => readFileSync("node_modules/@mediapipe/tasks-vision/vision_bundle.cjs", "utf8");
  return {
    name: "mediapipe-for-worker",
    configureServer(server) {
      server.middlewares.use(path, (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        res.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: path.slice(1), source: source() });
    },
  };
}

export default defineConfig({
  // date de construction, affichée dans Profil : permet de vérifier que le téléphone a la dernière version
  define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    mediapipeForWorker(),
    // Hors ligne (PRD §5) : l'app et les écrans déjà chargés restent disponibles sans réseau.
    VitePWA({
      // Mise à jour sans rechargement sous les yeux du joueur : appliquée quand l'app passe en arrière-plan (src/main.tsx).
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Prépa Basket",
        short_name: "Prépa Basket",
        lang: "fr",
        theme_color: "#16296b",
        background_color: "#050a1f",
        display: "standalone",
        // « any » : le jeu de dribble se joue en paysage (téléphone à l'horizontale)
        orientation: "any",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // Notifications Firebase (rappels de séance, VFC du matin, heure de coucher) : public/push-sw.js
        importScripts: ["/push-sw.js"],
        // reconnaissance des visages (1,3 Mo) : chargée seulement au shoot à plusieurs, pas préchargée pour tout le monde
        globIgnores: ["**/face-api*.js"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith("jsdelivr.net") || url.hostname === "storage.googleapis.com",
            handler: "CacheFirst",
            options: { cacheName: "vision-models", expiration: { maxEntries: 20 } },
          },
          {
            // photos d'exercices : gardées hors ligne une fois vues (≈ 1 Mo au total, pas préchargées)
            urlPattern: ({ url }) => url.pathname.startsWith("/exercises/"),
            handler: "CacheFirst",
            options: { cacheName: "exercise-photos", expiration: { maxEntries: 100 } },
          },
        ],
      },
    }),
  ],
});

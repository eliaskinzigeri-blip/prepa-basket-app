# Prépa Basket

App mobile (PWA) de préparation physique et technique pour joueurs de basket, construite à partir du PRD, du design system et des 13 maquettes du dossier `prepa-basket-design`.

- **Front** : React 18 + Vite + TypeScript, PWA hors ligne (`vite-plugin-pwa`).
- **Back** : Supabase (projet `prepa-basket`, `emlwxdeugtzmbhlixgbb`, région Paris) : auth, base Postgres avec RLS, temps réel, Edge Functions.
- **Caméra** : MediaPipe Tasks Vision, exécuté sur le téléphone. Aucune vidéo n'est envoyée ; les replays restent dans IndexedDB.

**En ligne** : https://prepa-basket.vercel.app (projet Vercel `prepa-basket`, déployé avec `npx vercel deploy --prod`). PageSpeed : 99–100 sur mobile et 100 sur desktop dans les 4 catégories.

## Lancer

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # vérifie les types puis construit dist/
```

`.env` (non commité) : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` (voir `.env.example`).

## Organisation

| Dossier | Contenu |
|---|---|
| `src/design-system/` | tokens, composants `pb-*` et polices du design system (copiés tels quels) |
| `src/lib/program.ts` | générateur de programme : créneaux libres, 60/25/15 %, repos, matchs, tests toutes les 4 semaines, replacement |
| `src/lib/data.ts` | accès Supabase, file hors ligne des séances, records |
| `src/vision/` | modèles (ballon, corps), caméra, sons, voix, analyse des tirs |
| `src/screens/` | écrans : onboarding (7 étapes), accueil, calendrier, séances, caméra, progrès, profil |
| `supabase/functions/` | Edge Functions `ffbb` (connecteur FFBB) et `trackfit` (réception des mesures) |

## Objectifs (`/objectifs`)

Dunker (une ou deux mains), % au tir (3 points, mi-distance, lancers), sprint (distance et temps libres), cardio (VMA), physique (poids, masse grasse, muscle), détente, main faible. Chaque objectif (table `goals`, RLS) :
- choisit son test mensuel : détente (caméra), séance de tir filmée, sprint 10/20 m (caméra) ou chrono partenaire / saisie (autres distances), test navette Luc Léger (`/test/navette`, bips programmés sur l'horloge audio, VMA + VO2max), pesée ;
- passe en priorité du programme (compétence principale de chaque objectif d'abord, anciennes priorités conservées en second plan) ;
- reçoit un délai estimé (`src/lib/goals.ts`) : rythme de départ selon le niveau, puis pente réelle des tests dès 2 mesures sur 3 semaines.

Dunk : détente sur place nécessaire = (305 cm + 15 ou 22 cm − allonge) / 1,12 (gain moyen d'un saut avec élan). Détente mesurée par la montée des hanches et recoupée par le temps de vol (idée reprise de VertMeasure, sans son code, qui n'a pas de licence). jumpstar (GPL-3.0) n'a servi que d'inspiration pour l'orientation des séances.

## Connecteurs

- **FFBB** : la FFBB n'a pas d'API officielle. La fonction `ffbb` passe par l'API publique tierce de `ffbb-data-client` (recherche de clubs, équipes, matchs, salles). Si elle ne répond pas, l'app le dit et propose l'ajout de match à la main. Synchro au moins une fois par jour à l'ouverture de l'app.
- **TrackFit** : son API n'est pas connue (question ouverte du PRD). La fonction `trackfit` reçoit un `POST` JSON (`weight_kg`, `fat_pct`, `muscle_kg`, `rhr`) avec le jeton personnel du joueur (en-tête `x-trackfit-token` ou `?token=`). La mesure apparaît dans l'app en temps réel.

## À configurer dans le dashboard Supabase

- **Google et Apple** : activer les fournisseurs dans Authentication › Providers (identifiants OAuth requis). Les boutons sont déjà dans l'app.
- **Confirmation d'email** : activée par défaut. Pour tenir l'objectif « programme en moins de 3 minutes », la désactiver ou personnaliser l'email.
- **Mots de passe compromis** : activer « Leaked password protection ».

## Licences des ressources

Consignes d'exercices : `exercises-dataset` (MIT, voir `src/data/EXERCISES-LICENSE.txt`). Ses GIF (© Gym visual) ne sont pas utilisés : leur licence ne couvre que ce dépôt. La bibliothèque compte 274 exercices (`/exercices`) : les 44 d'origine et 230 tirés de `yuhonas/free-exercise-db` (domaine public, Unlicense), triés pour le basket, traduits en français et classés (famille, schéma de mouvement, matériel, dosage). Leurs photos départ / arrivée sont converties en WebP 480 px dans `public/exercises/` et enchaînées en fondu ; 3 exercices sans photo gardent une silhouette animée maison. Suivi caméra : MediaPipe (Apache 2.0). La logique de détection des tirs est réécrite (le dépôt `basketball-shot-detection` n'a pas de licence). Ultralytics (AGPL-3.0) n'est pas utilisé : le ballon est détecté par le modèle COCO de MediaPipe et un suivi couleur.

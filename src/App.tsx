import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useApp } from "./state/app";
import { Splash } from "./screens/Splash";
import { Auth } from "./screens/Auth";
import { Home } from "./screens/Home";
import { EmailConfirmed } from "./screens/EmailConfirmed";
import { Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ActiveWorkoutBar } from "./components/ActiveWorkoutBar";

// Écrans secondaires et vues caméra chargés à la demande (MediaPipe ne pèse que là où il sert).
const Onboarding = lazy(() => import("./screens/onboarding/Onboarding"));
const ProgramReady = lazy(() => import("./screens/ProgramReady"));
const loadCalendar = () => import("./screens/Calendar");
const Calendar = lazy(loadCalendar);
const loadEventDetail = () => import("./screens/EventDetail");
const EventDetail = lazy(loadEventDetail);
const loadWorkout = () => import("./screens/Workout");
const Workout = lazy(loadWorkout);
const loadExerciseDetail = () => import("./screens/ExerciseDetail");
const ExerciseDetail = lazy(loadExerciseDetail);
const BasketSession = lazy(() => import("./screens/BasketSession"));
const DribbleGame = lazy(() => import("./screens/camera/DribbleGame"));
const ShootSession = lazy(() => import("./screens/camera/ShootSession"));
const ShootAnalysis = lazy(() => import("./screens/ShootAnalysis"));
const ShootPlayer = lazy(() => import("./screens/ShootPlayer"));
const ShootHistory = lazy(() => import("./screens/ShootHistory"));
const RowerConnect = lazy(() => import("./screens/rower/RowerConnect"));
const RowerDiagnostic = lazy(() => import("./screens/rower/RowerConnect").then((m) => ({ default: m.RowerDiagnostic })));
const RowerPreview = lazy(() => import("./screens/rower/RowerPreview"));
const RowerTestIntro = lazy(() => import("./screens/rower/RowerPreview").then((m) => ({ default: m.RowerTestIntro })));
const RowerLive = lazy(() => import("./screens/rower/RowerLive"));
const Nutrition = lazy(() => import("./screens/Nutrition"));
const MealScan = lazy(() => import("./screens/Nutrition").then((m) => ({ default: m.MealScan })));
const MealIdeas = lazy(() => import("./screens/Nutrition").then((m) => ({ default: m.MealIdeas })));
const PronoteLink = lazy(() => import("./screens/Nutrition").then((m) => ({ default: m.PronoteLink })));
const Scale = lazy(() => import("./screens/Scale"));
const TestTracker = lazy(() => import("./screens/camera/TestTracker"));
const loadTestsHub = () => import("./screens/TestsHub");
const TestsHub = lazy(loadTestsHub);
const Recap = lazy(() => import("./screens/Recap"));
const loadProgress = () => import("./screens/Progress");
const Progress = lazy(loadProgress);
const loadBody = () => import("./screens/Body");
const Body = lazy(loadBody);
const loadProfile = () => import("./screens/Profile");
const Profile = lazy(loadProfile);
const loadSettings = () => import("./screens/Settings");
const Settings = lazy(loadSettings);
const loadLibrary = () => import("./screens/Library");
const Library = lazy(loadLibrary);
const loadGoals = () => import("./screens/Goals");
const Goals = lazy(loadGoals);
const Navette = lazy(() => import("./screens/tests/Navette"));
const Chrono = lazy(() => import("./screens/tests/Chrono"));
const RestingHeart = lazy(() => import("./screens/tests/RestingHeart"));
const SleepScreen = lazy(() => import("./screens/Sleep"));

// Onglets et écrans courants préchargés dès que l'app est au repos : changer d'onglet est instantané.
const PRELOAD = [loadCalendar, loadProgress, loadProfile, loadTestsHub, loadEventDetail, loadWorkout, loadGoals, loadExerciseDetail, loadLibrary, loadBody, loadSettings];

export function App() {
  const { session, authReady, profile, loading, error, reload } = useApp();
  const loc = useLocation();
  const signedIn = Boolean(session && profile);
  useEffect(() => {
    if (!signedIn) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => PRELOAD.forEach((load) => load().catch(() => undefined)));
  }, [signedIn]);

  if (!authReady || (session && !profile && loading)) return <Splash />;
  if (!session) {
    return (
      <Routes>
        <Route path="/connexion" element={<Auth mode="login" />} />
        <Route path="/inscription" element={<Auth mode="signup" />} />
        <Route path="/email-confirme" element={<EmailConfirmed signedIn={false} />} />
        <Route path="*" element={<Splash welcome />} />
      </Routes>
    );
  }
  if (!profile) return <Splash error={error ?? "Profil introuvable."} onRetry={reload} />;

  if (loc.pathname === "/email-confirme") return <EmailConfirmed signedIn />;

  const onboarding = !profile.onboarded_at;
  if (onboarding && !loc.pathname.startsWith("/onboarding") && loc.pathname !== "/programme") {
    return <Navigate to={`/onboarding/${Math.max(1, profile.onboarding_step || 1)}`} replace />;
  }

  return (
    <div className="app">
      <ActiveWorkoutBar />
      <ErrorBoundary resetKey={loc.pathname}>
      <Suspense fallback={<div className="screen"><Spinner /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/onboarding/:step" element={<Onboarding />} />
          <Route path="/programme" element={<ProgramReady />} />
          <Route path="/calendrier" element={<Calendar />} />
          <Route path="/evenement/:id" element={<EventDetail />} />
          <Route path="/seance/:id" element={<Workout />} />
          <Route path="/exercice/:id" element={<ExerciseDetail />} />
          <Route path="/exercices" element={<Library />} />
          <Route path="/basket/:id" element={<BasketSession />} />
          <Route path="/dribble/:game" element={<DribbleGame />} />
          <Route path="/shoot" element={<ShootSession />} />
          <Route path="/shoot/:sessionId" element={<ShootAnalysis />} />
          <Route path="/shoot/joueur/:key" element={<ShootPlayer />} />
          <Route path="/shoot/historique" element={<ShootHistory />} />
          <Route path="/rameur" element={<RowerConnect />} />
          <Route path="/rameur/diagnostic" element={<RowerDiagnostic />} />
          <Route path="/rameur/test" element={<RowerTestIntro />} />
          <Route path="/rameur/apercu/:kind" element={<RowerPreview />} />
          <Route path="/rameur/seance" element={<RowerLive />} />
          <Route path="/tests" element={<TestsHub />} />
          <Route path="/test/navette" element={<Navette />} />
          <Route path="/test/chrono" element={<Chrono />} />
          <Route path="/test/fc-repos" element={<RestingHeart />} />
          <Route path="/sommeil" element={<SleepScreen />} />
          <Route path="/test/:testId" element={<TestTracker />} />
          <Route path="/objectifs" element={<Goals />} />
          <Route path="/recap/:sessionId" element={<Recap />} />
          <Route path="/progres" element={<Progress />} />
          <Route path="/mesures" element={<Body />} />
          <Route path="/pesee" element={<Scale />} />
          <Route path="/nutrition" element={<Nutrition />} />
          <Route path="/nutrition/scan" element={<MealScan />} />
          <Route path="/nutrition/idees" element={<MealIdeas />} />
          <Route path="/nutrition/pronote" element={<PronoteLink />} />
          <Route path="/profil" element={<Profile />} />
          <Route path="/profil/:section" element={<Settings />} />
          <Route path="/connexion" element={<Navigate to="/" replace />} />
          <Route path="/inscription" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

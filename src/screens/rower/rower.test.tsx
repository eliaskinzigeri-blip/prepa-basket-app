// @vitest-environment jsdom
// Les vrais écrans et le vrai moteur, avec le rameur simulé : seules la base et l'état de l'app sont remplacés.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const save = vi.fn(async (_: unknown) => "saved");
const app = {
  profile: { id: "u", birth_date: "2013-03-01", home_equipment: ["rameur", "halteres"], session_minutes: 45, workout_locations: ["maison"], first_name: "N" },
  events: [{ id: "ev1", date: "2026-11-09", start_min: 1020, end_min: 1080, type: "workout", title: "Haut", location: "maison", source: "program", payload: { template: "haut" }, status: "planned" }],
  measurements: [] as { kind: string; value: number; measured_at: string; source: string }[],
  reload: vi.fn(async () => undefined),
  reloadEvents: vi.fn(async () => undefined),
};
vi.mock("../../state/app", () => ({
  useApp: () => app,
  useProgression: () => ({ stage: 1, step: 0, age: 13 }),
  latest: (ms: { kind: string; value: number }[], kind: string) => ({ value: ms.find((m) => m.kind === kind)?.value ?? null, prev: null, at: null, source: null }),
}));
vi.mock("../../lib/data", () => ({ saveSession: (p: unknown) => save(p), checkRecords: async () => [] }));
vi.mock("../../lib/exercises", () => ({ exercisesFor: () => [{ id: "x", equipment: ["banc", "halteres"] }] }));

import RowerConnect, { RowerDiagnostic } from "./RowerConnect";
import RowerLive from "./RowerLive";
import RowerPreview, { RowerTestIntro } from "./RowerPreview";
import { hub, startDemo } from "../../lib/rower/rower";
import { activeRow, RowSession } from "../../lib/rower/session";
import { rowerPlan } from "../../lib/rower/plans";

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; }
function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/rameur" element={<RowerConnect />} />
        <Route path="/rameur/diagnostic" element={<RowerDiagnostic />} />
        <Route path="/rameur/test" element={<RowerTestIntro />} />
        <Route path="/rameur/apercu/:kind" element={<RowerPreview />} />
        <Route path="/rameur/seance" element={<RowerLive />} />
        <Route path="*" element={<p>autre écran</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;
const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => {
  save.mockClear();
  window.scrollTo = () => undefined;
  Object.defineProperty(navigator, "bluetooth", { value: {}, configurable: true });
  if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => "id" });
});
afterEach(() => {
  cleanup();
  hub.rower?.disconnect();
  hub.rower = null;
  activeRow.session = null;
});

describe("connexion", () => {
  it("propose rameur, ceinture, simulé et diagnostic, puis se connecte au simulé", async () => {
    show("/rameur");
    await sleep(0);
    expect(screen.getByText("Ceinture cardio")).toBeTruthy();
    expect(screen.getByText(/Diagnostic Bluetooth/)).toBeTruthy();
    fireEvent.click(screen.getByText("Essayer avec le rameur simulé"));
    await waitFor(() => expect(screen.getByText("Connecté")).toBeTruthy());
    expect(screen.getByText(/aucune donnée réelle/)).toBeTruthy();
  });
  it("le diagnostic affiche le pilotage et le journal", () => {
    startDemo();
    show("/rameur/diagnostic");
    expect(screen.getByText(/résistance pilotée/)).toBeTruthy();
    expect(screen.getByText(/Tester la résistance/)).toBeTruthy();
  });
});

describe("aperçu", () => {
  it("rappelle la technique et le minimum de 22 coups, et bloque sans chaussures ni adulte", () => {
    show("/rameur/apercu/endurance");
    expect(screen.getByText(/22 coups par minute au moins/)).toBeTruthy();
    expect(screen.getByText("Technique de rame")).toBeTruthy();
    expect(screen.getByText(/pictogramme de sécurité/)).toBeTruthy();
    expect((screen.getByText("Coche les deux points ci-dessus").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "J'ai mis mes chaussures" }));
    expect((screen.getByText("Coche les deux points ci-dessus").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: /Un adulte est là/ }));
    expect((screen.getByText("Lancer la séance").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });
  it("sans rameur connecté, demande de connecter et lance le simulé", async () => {
    show("/rameur/apercu/recup");
    fireEvent.click(screen.getByRole("switch", { name: "J'ai mis mes chaussures" }));
    fireEvent.click(screen.getByRole("switch", { name: /Un adulte est là/ }));
    fireEvent.click(screen.getByText("Lancer la séance"));
    expect(screen.getByText("Connecter")).toBeTruthy();
    fireEvent.click(screen.getByText(/Rameur simulé/));
    await waitFor(() => expect(where()).toBe("/rameur/seance"));
    expect(screen.getByText("Allure /500 m", { exact: false })).toBeTruthy();
  });
  it("le test de niveau précise qu'il ne remplace pas le navette et refuse le 2 000 m", () => {
    show("/rameur/test");
    expect(screen.getByText(/ne remplace pas le test navette/)).toBeTruthy();
    expect(screen.getByText(/Pas de test sur 2 000 m avant 16 ans/)).toBeTruthy();
  });
});

function launch(kind: "endurance" | "warmup" | "test", meta: ConstructorParameters<typeof RowSession>[3], speed = 200) {
  startDemo(speed);
  const s = new RowSession(rowerPlan(kind), 13, 155, meta);
  (s as unknown as { speed: number }).speed = speed;
  activeRow.session = s;
  s.start();
  return s;
}

describe("séance en direct", () => {
  it("affiche allure, cadence, temps, cible et résistance, et enchaîne les blocs", async () => {
    const s = launch("endurance", { eventId: null, next: null }, 5);
    show("/rameur/seance");
    await sleep(1200);
    expect(screen.getByText("Cadence")).toBeTruthy();
    expect(screen.getByText("Cœur")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toMatch(/\d:\d\d/);
    expect(s.getSnapshot().spm).toBeGreaterThanOrEqual(22);
    fireEvent.click(screen.getByText("Bloc suivant"));
    await sleep(500);
    expect(s.getSnapshot().index).toBe(1);
    expect(s.getSnapshot().target).not.toBeNull();
    expect(screen.getByText(/Z2/)).toBeTruthy();
  });
  it("arrête le temps en pause et quand la connexion est coupée, et propose de reconnecter", async () => {
    const s = launch("endurance", { eventId: null, next: null }, 5);
    show("/rameur/seance");
    await sleep(800);
    fireEvent.click(screen.getByText("Pause"));
    const paused = s.getSnapshot().elapsed;
    await sleep(600);
    expect(s.getSnapshot().elapsed).toBe(paused);
    expect(screen.getByText("En pause")).toBeTruthy();
    fireEvent.click(screen.getByText("Reprendre"));
    await sleep(600);
    expect(s.getSnapshot().elapsed).toBeGreaterThan(paused);
    act(() => { hub.rower!.state = "disconnected"; hub.emit(); });
    await sleep(300);
    const cut = s.getSnapshot().elapsed;
    await sleep(600);
    expect(s.getSnapshot().elapsed).toBe(cut);
    expect(screen.getByText(/Connexion coupée/)).toBeTruthy();
    expect(screen.getByText("Reconnecter")).toBeTruthy();
    act(() => { hub.rower!.state = "connected"; hub.emit(); });
    await sleep(600);
    expect(s.getSnapshot().elapsed).toBeGreaterThan(cut);
  });
  it("le rameur simulé ne compte jamais : ni séance, ni allure de référence", async () => {
    launch("test", { eventId: "ev1", next: null });
    show("/rameur/seance");
    await waitFor(() => expect(where()).toMatch(/^\/recap\//), { timeout: 15000 });
    expect(save).not.toHaveBeenCalled();
  }, 20000);
});

describe("changement de mode", () => {
  it("après l'échauffement, montre les gestes de pliage et le retrait du téléphone, puis passe à la séance", async () => {
    launch("warmup", { eventId: null, next: { path: "/seance/ev1?echauffe=rameur", bench: true } });
    show("/rameur/seance");
    await waitFor(() => expect(screen.getByText("Replie le rameur en banc")).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText(/retire ton téléphone du support/)).toBeTruthy();
    expect(screen.getByText(/Débloque le verrou à grenouillère/)).toBeTruthy();
    expect(screen.getByText(/avec un adulte/)).toBeTruthy();
    expect(screen.getByText(/Chaussures obligatoires/)).toBeTruthy();
    fireEvent.click(screen.getByText("C'est prêt"));
    await waitFor(() => expect(where()).toBe("/seance/ev1?echauffe=rameur"));
  }, 12000);
  it("sans banc ensuite, pas d'écran de transition", async () => {
    launch("warmup", { eventId: null, next: { path: "/seance/ev1?echauffe=rameur", bench: false } });
    show("/rameur/seance");
    await waitFor(() => expect(where()).toBe("/seance/ev1?echauffe=rameur"), { timeout: 8000 });
    expect(screen.queryByText("Replie le rameur en banc")).toBeNull();
  }, 12000);
});

describe("test sur un vrai rameur", () => {
  it("enregistre l'allure seulement si les 20 min sont faites", async () => {
    const s = launch("test", { eventId: null, next: null });
    Object.defineProperty(hub.rower!, "isDemo", { value: false });
    (s as unknown as { demoUsed: boolean }).demoUsed = false;
    const aim = (s as unknown as { aimSim: (a: boolean) => void });
    aim.aimSim = () => undefined;
    show("/rameur/seance");
    await waitFor(() => expect(where()).toMatch(/^\/recap\//), { timeout: 15000 });
    expect(save).toHaveBeenCalledTimes(1);
    const arg = save.mock.calls[0][0] as { session: { results: { rower: string } }; measurements: { kind: string }[] };
    expect(arg.session.results.rower).toBe("test");
    expect(arg.measurements.map((m) => m.kind).sort()).toEqual(["rower_pace20", "rower_ref"]);
  }, 20000);
  it("arrêtée en plein milieu : enregistrée comme partiellement faite", async () => {
    const s = launch("endurance", { eventId: "ev1", next: null }, 100);
    Object.defineProperty(hub.rower!, "isDemo", { value: false });
    (s as unknown as { demoUsed: boolean }).demoUsed = false;
    (s as unknown as { aimSim: (a: boolean) => void }).aimSim = () => undefined;
    show("/rameur/seance");
    await sleep(1500);
    fireEvent.click(screen.getByLabelText("Terminer la séance"));
    expect(screen.getByText(/partiellement faite/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    await waitFor(() => expect(where()).toMatch(/^\/recap\//), { timeout: 8000 });
    const arg = save.mock.calls[0][0] as { session: { results: { partial: boolean } }; eventDone: string; eventPayload: { partial: boolean; template: string } };
    expect(arg.session.results.partial).toBe(true);
    expect(arg.eventDone).toBe("ev1");
    expect(arg.eventPayload).toMatchObject({ partial: true, template: "haut" });
  }, 15000);
});

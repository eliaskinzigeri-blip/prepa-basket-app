// @vitest-environment jsdom
// Historique, analyse et page d'un joueur au shoot, avec une session à plusieurs au format réellement enregistré.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const shot = (who: string, made: boolean, t0: number) => ({ t0, t1: t0 + 3000, who, made, measured: true, short: false, angle: 50, speed: 3.4, distance: 1.7, apex: 3.4, releaseMs: null, jumpCm: null, elbow: 120, spot: "libre", courtX: 0, courtY: 1.7, path: [[0.5, 0.4], [0.4, 0.1], [0.3, 0.4]], releasePt: { t: t0 + 1200, x: 600, y: 200 } });
const PAPA = "016d7a9d-8541-4101-80a9-c1cd8af0c900";
const group = {
  id: "g1", kind: "shoot", started_at: "2026-11-08T16:12:50Z", duration_s: 410, title: "Shoot · Shoot libre", event_id: null, feeling: null,
  results: { game: "tir_libre", made: 1, attempts: 2, pct: 50, group: true, hasVideo: true, advice: [], records: [], avgAngle: 50, avgDistance: 1.7,
    shots: [shot("me", true, 1000), shot(PAPA, true, 5000), shot("me", false, 9000), shot(PAPA, false, 13000), shot(PAPA, true, 17000)],
    players: [{ key: "me", name: "Léo", made: 1, attempts: 2, pct: 50 }, { key: PAPA, name: "Papa", made: 2, attempts: 3, pct: 67 }] },
};
const solo = { id: "s1", kind: "shoot", started_at: "2026-11-05T16:11:53Z", duration_s: 226, title: "Shoot", event_id: null, feeling: null,
  results: { game: "tir_libre", made: 7, attempts: 17, pct: 41, hasVideo: true, shots: [shot("x", true, 0)], advice: [], records: [] } };
const empty = { ...solo, id: "e1", results: { game: "tir_libre", made: 0, attempts: 0, shots: [] } };
const ALL = [group, solo, empty];

// requête Supabase simulée : filtres eq / contains appliqués pour de vrai
function query() {
  let rows: typeof ALL = ALL;
  const q = {
    select: () => q, order: () => q, limit: () => q, not: () => q,
    eq: (k: string, v: string) => { rows = rows.filter((r) => (r as Record<string, unknown>)[k] === v); return q; },
    contains: (_: string, v: { players: { key: string }[] }) => { rows = rows.filter((r) => ((r.results as { players?: { key: string }[] }).players ?? []).some((p) => p.key === v.players[0].key)); return q; },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (f: (x: { data: unknown; error: null }) => unknown) => Promise.resolve(f({ data: rows, error: null })),
  };
  return q;
}
vi.mock("../lib/supabase", () => ({ supabase: { from: () => query() } }));
vi.mock("../state/app", () => ({ useApp: () => ({ session: { user: { id: "u" } }, profile: { first_name: "Léo" } }) }));
vi.mock("../vision/media", () => ({ loadVideo: async () => null }));

import ShootHistory from "./ShootHistory";
import ShootAnalysis from "./ShootAnalysis";
import ShootPlayer from "./ShootPlayer";

function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/shoot/historique" element={<ShootHistory />} />
        <Route path="/shoot/:sessionId" element={<ShootAnalysis />} />
        <Route path="/shoot/joueur/:key" element={<ShootPlayer />} />
      </Routes>
    </MemoryRouter>,
  );
}
afterEach(cleanup);

describe("retrouver ses shoots après les avoir enregistrés", () => {
  it("l'historique liste les sessions (sans les vides) et mène à l'analyse", async () => {
    show("/shoot/historique");
    await waitFor(() => expect(screen.getByText("Mes sessions de shoot")).toBeTruthy());
    expect(screen.getByText("2 sessions")).toBeTruthy();
    expect(screen.getByText(/toi, Papa · 3\/5/)).toBeTruthy();
    expect(screen.getByText(/Solo · 7\/17/)).toBeTruthy();
    fireEvent.click(screen.getByText(/toi, Papa · 3\/5/));
    await waitFor(() => expect(screen.getByText("Analyse du shoot")).toBeTruthy());
  });
  it("l'analyse d'une session à plusieurs montre les joueurs, filtre les tirs et propose le replay", async () => {
    show("/shoot/g1");
    await waitFor(() => expect(screen.getByText("Analyse du shoot")).toBeTruthy());
    expect(screen.getByText(/5 tirs · 2 joueurs/)).toBeTruthy();
    expect(screen.getByText("Revoir les tirs avec trajectoire")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Papa" }));
    fireEvent.click(screen.getByText("Par tir"));
    expect(screen.getAllByRole("button").filter((b) => /^[✓✕] \d/.test(b.textContent ?? ""))).toHaveLength(3);
    fireEvent.click(screen.getByText("Revoir les tirs avec trajectoire"));
    await waitFor(() => expect(screen.getByText(/Vidéo introuvable sur ce téléphone/)).toBeTruthy());
  });
  it("la page d'un joueur montre son % sur ses séries", async () => {
    show(`/shoot/joueur/${PAPA}`);
    await waitFor(() => expect(screen.getByText("Papa au shoot")).toBeTruthy());
    expect(screen.getAllByText("67 %").length).toBeGreaterThan(0);
    show("/shoot/joueur/me");
    await waitFor(() => expect(screen.getByText(/8 réussis sur 19 tirs/)).toBeTruthy());
  });
});

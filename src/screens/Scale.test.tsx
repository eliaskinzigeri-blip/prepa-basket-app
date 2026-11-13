// @vitest-environment jsdom
// Écran « Me peser » avec une fausse balance FitTrack Dara : connexion seule, poids en direct, pesée enregistrée.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { checksum } from "../lib/scale";

const inserted: unknown[] = [];
vi.mock("../lib/supabase", () => ({ supabase: { from: () => ({ insert: (rows: unknown[]) => { inserted.push(...rows); return Promise.resolve({ error: null }); } }) } }));
vi.mock("../lib/data", () => ({ updateProfile: vi.fn(async () => undefined) }));
const setProfile = vi.fn();
vi.mock("../state/app", () => ({ useApp: () => ({ profile: { birth_date: "2013-03-02", height_cm: 168 }, setProfile }) }));

const frame = (b2: number, b3: number, b4: number, b5: number, chan: number) => {
  const f = new Uint8Array([0xac, 0x02, b2, b3, b4, b5, chan, 0]); f[7] = checksum(f); return f;
};
const kg = (v: number, chan = 0xce) => { const d = Math.round(v * 10); return frame(d >> 8, d & 0xff, 0, 0, chan); };
const idx = (i: number, v: number) => { const d = Math.round(v * 10); return frame(0xfe, i, d >> 8, d & 0xff, 0xcb); };

function fakeScale() {
  const data = new EventTarget() as EventTarget & { value?: DataView; startNotifications: () => Promise<void> };
  data.startNotifications = async () => undefined;
  const written: number[][] = [];
  const cmd = { properties: { writeWithoutResponse: true }, writeValueWithoutResponse: async (b: ArrayBuffer) => { written.push(Array.from(new Uint8Array(b))); } };
  const service = { getCharacteristic: async (u: number) => (u === 0xffb2 ? data : cmd) };
  const device = Object.assign(new EventTarget(), {
    id: "dara-1", name: "FitTrack",
    gatt: { connect: async () => ({ getPrimaryService: async (u: number) => { if (u !== 0xffb0) throw new Error("absent"); return service; }, disconnect: () => undefined }), disconnect: () => undefined },
  });
  const send = (f: Uint8Array) => { data.value = new DataView(f.buffer); data.dispatchEvent(new Event("characteristicvaluechanged")); };
  return { device, send, written };
}

afterEach(() => { cleanup(); localStorage.clear(); });

describe("me peser avec la balance", () => {
  it("retrouve la balance déjà choisie, affiche le poids et enregistre la pesée", async () => {
    const s = fakeScale();
    localStorage.setItem("pb.scale.v1", JSON.stringify({ id: "dara-1", name: "FitTrack" }));
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { getDevices: async () => [s.device] } });
    const { default: Scale } = await import("./Scale");
    render(<MemoryRouter><Scale /></MemoryRouter>);
    await waitFor(() => expect(s.written.length).toBe(6));
    expect(s.written[2].slice(2, 6)).toEqual([0xfb, 1, 13, 168]); // garçon, 13 ans, 168 cm
    act(() => { s.send(kg(50.2)); s.send(kg(52.3)); });
    await waitFor(() => expect(screen.getByText("Pesée en cours, reste immobile")).toBeTruthy());
    expect(screen.getByText("52,3")).toBeTruthy();
    act(() => { s.send(kg(52.3, 0xca)); s.send(idx(0, 52.3)); s.send(idx(2, 14.6)); s.send(idx(5, 44.7)); s.send(idx(7, 2.6)); s.send(frame(0xfe, 6, 1412 >> 8, 1412 & 0xff, 0xcb)); const end = new Uint8Array(20); end[0] = 1; s.send(end); });
    await waitFor(() => expect(screen.getByText("Pesée ajoutée à tes mesures.")).toBeTruthy());
    expect(inserted.map((r) => (r as { kind: string; value: number }).kind + "=" + (r as { value: number }).value)).toEqual(["weight=52.3", "fat_pct=14.6", "muscle_kg=24.6", "bmr=1680"]);
    expect(inserted.every((r) => (r as { source: string }).source === "trackfit")).toBe(true);
    expect(screen.getByText(/Masse grasse 14,6 %/)).toBeTruthy();
  });
});

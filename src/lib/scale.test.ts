// Décodeur de la balance FitTrack Dara, sur des trames au format du protocole relevé.
import { describe, expect, it } from "vitest";
import { WeighingDecoder, checksum, daraCommand, daraHello } from "./scale";

const frame = (b2: number, b3: number, b4: number, b5: number, chan: number) => {
  const f = new Uint8Array([0xac, 0x02, b2, b3, b4, b5, chan, 0]);
  f[7] = checksum(f);
  return f;
};
const live = (kg: number, chan = 0xce) => { const d = Math.round(kg * 10); return frame(d >> 8, d & 0xff, 0, 0, chan); };
const idx = (i: number, v: number) => { const d = Math.round(v * 10); return frame(0xfe, i, d >> 8, d & 0xff, 0xcb); };

describe("balance FitTrack Dara", () => {
  it("construit les commandes avec la bonne somme de contrôle", () => {
    expect(Array.from(daraCommand(0xfe, 6, 0, 0))).toEqual([0xac, 0x02, 0xfe, 0x06, 0x00, 0x00, 0xcc, (0xfe + 6 + 0xcc) & 0xff]);
    const hello = daraHello({ male: true, age: 13, heightCm: 168 }, new Date(2026, 10, 8, 18, 5, 9));
    expect(hello).toHaveLength(6);
    expect(Array.from(hello[2].slice(2, 6))).toEqual([0xfb, 1, 13, 168]);
    expect(Array.from(hello[3].slice(2, 6))).toEqual([0xfd, 26, 11, 8]);
  });
  it("suit le poids en direct puis garde la composition corporelle", () => {
    const d = new WeighingDecoder();
    for (const kg of [0, 20.4, 48.9, 52.1, 52.3]) expect(d.dara(live(kg), 0)).toBe(false);
    expect(d.live).toBe(52.3);
    expect(d.stable).toBe(false);
    d.dara(live(52.3, 0xca), 100);
    expect(d.stable).toBe(true);
    d.dara(idx(0, 52.3), 200); d.dara(idx(2, 14.6), 200); d.dara(idx(5, 44.7), 200); d.dara(idx(7, 2.6), 200); d.dara(idx(8, 58.2), 200);
    const end = new Uint8Array(20); end[0] = 0x01;
    expect(d.dara(end, 300)).toBe(true);
    expect(d.result).toEqual({ weight: 52.3, fat_pct: 14.6, lean_kg: 44.7, bone_kg: 2.6, muscle_kg: 24.6, water_pct: 58.2 });
  });
  it("donne la même masse musculaire que l'app FitTrack sur la pesée du 8/11", () => {
    const d = new WeighingDecoder();
    d.dara(live(51.7, 0xca), 0); d.dara(idx(0, 51.7), 0); d.dara(idx(2, 6.5), 0); d.dara(idx(5, 45.7), 0); d.dara(idx(7, 2.4), 0); d.dara(frame(0xfe, 6, 1412 >> 8, 1412 & 0xff, 0xcb), 0);
    d.dara(frame(0xfe, 0xfc, 0, 0, 0xcb), 0);
    expect(d.result?.muscle_kg).toBe(25.1);
    expect(d.result?.bmr).toBe(1412);
  });
  it("ignore une trame abîmée", () => {
    const d = new WeighingDecoder();
    const bad = live(60); bad[7] ^= 1;
    d.dara(bad, 0);
    expect(d.live).toBe(0);
  });
  it("sans composition corporelle, garde le poids stable après 10 s", () => {
    const d = new WeighingDecoder();
    for (let i = 0; i < 5; i++) d.dara(live(51.8), i * 200);
    expect(d.stable).toBe(true);
    expect(d.tick(5000)).toBe(false);
    expect(d.tick(10_700)).toBe(true);
    expect(d.result).toEqual({ weight: 51.8 });
  });
  it("une coupure avant toute pesée stable n'enregistre rien", () => {
    const d = new WeighingDecoder();
    d.dara(live(30.2), 0);
    expect(d.disconnected()).toBe(false);
    expect(d.result).toBeNull();
  });
  it("lit une balance Bluetooth standard (0x2A9D, kg)", () => {
    const d = new WeighingDecoder();
    const v = new DataView(new ArrayBuffer(3));
    v.setUint8(0, 0); v.setUint16(1, Math.round(52.4 / 0.005), true);
    d.standardWeight(v, 0);
    expect(d.disconnected()).toBe(true);
    expect(d.result?.weight).toBe(52.4);
  });
});

import { bmrIom, bmrOf, bmrReale } from "./energy";
describe("métabolisme de base", () => {
  it("moyenne Reale (jeunes sportifs) et IOM (10-18 ans) : 13 ans, 168 cm, 51,2 kg", () => {
    expect(Math.round(bmrReale(51.2, 168, true))).toBe(1640); // 568,3 + 1411,2 − 340
    expect(Math.round(bmrIom(51.2, 168, 13, true))).toBe(1684); // 68 − 562,9 + 1196,2 + 983,0
    expect(bmrOf(51.2, 168, 13, true)).toBe(1660);
    expect(bmrOf(51.7, 168, 9, true)).toBeNull();
  });
});

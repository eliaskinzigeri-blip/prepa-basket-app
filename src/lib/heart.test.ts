// Ceinture cardio : décodage des trames, zones de séance, FC au repos et variabilité cardiaque.
import { describe, expect, it } from "vitest";
import { hrMaxFor, parseHeart, restingFrom, rmssd, rrQuality, summarize } from "./heart";

const frame = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe("ceinture cardio", () => {
  it("décode la FC sur 8 ou 16 bits et les intervalles RR", () => {
    expect(parseHeart(frame([0x00, 62]))).toEqual({ bpm: 62, rr: [] });
    expect(parseHeart(frame([0x01, 0x2c, 0x01])).bpm).toBe(300);
    // FC 8 bits + énergie dépensée (2 octets) + deux RR de 1024/1024 s et 512/1024 s
    expect(parseHeart(frame([0x18, 60, 0x10, 0x00, 0x00, 0x04, 0x00, 0x02]))).toEqual({ bpm: 60, rr: [1000, 500] });
  });

  it("résume une séance : moyenne, maximum et temps par zone (FC max 13 ans ≈ 199)", () => {
    expect(hrMaxFor(13)).toBe(199);
    const samples = [...Array(120)].map((_, i) => ({ t: i * 1000, bpm: i < 60 ? 110 : 170 }));
    const s = summarize(samples, 13)!;
    expect(s.avg).toBe(140);
    expect(s.max).toBe(170);
    expect(s.zones[0]).toBe(60); // 110 < 60 % de 199
    expect(s.zones[3]).toBe(60); // 170 entre 80 et 90 %
    expect(summarize(samples.slice(0, 30), 13)).toBeNull();
  });

  it("FC au repos et variabilité, sans les battements aberrants", () => {
    expect(restingFrom([...Array(180)].map((_, i) => ({ t: i, bpm: i % 2 ? 58 : 60 })))).toBe(59);
    // mesure du matin : 2 min de fenêtre, la ceinture envoie environ une valeur par seconde (ici 117 sur 120)
    expect(restingFrom([...Array(117)].map((_, i) => ({ t: i, bpm: 62 })), 120)).toBe(62);
    expect(restingFrom([...Array(60)].map((_, i) => ({ t: i, bpm: 62 })), 120)).toBeNull();
    const rr = [...Array(200)].map((_, i) => (i % 2 ? 1000 : 960));
    expect(rmssd(rr)).toBe(40);
    // un artefact (battement manqué : 2 000 ms) ne change pas le résultat
    expect(rmssd([...rr.slice(0, 100), 1990, ...rr.slice(100)])).toBe(40);
    expect(rmssd(rr.slice(0, 20))).toBeNull();
  });
  it("nettoyage façon Kubios : un battement manqué ou en trop ne crée pas de faux écart", () => {
    const rr = [...Array(200)].map((_, i) => 980 + (i % 2 ? 20 : -20)); // RMSSD exact : 40 ms
    // battement manqué (deux intervalles fusionnés) puis battement en trop (un intervalle coupé en deux)
    const noisy = [...rr.slice(0, 50), 1960, ...rr.slice(50, 120), 480, 500, ...rr.slice(120)];
    const q = rrQuality(noisy);
    expect(q.rmssd).toBe(40);
    expect(q.artifactPct).toBeGreaterThan(0);
    // trop d'artefacts (contact perdu) : mesure refusée plutôt que fausse
    const bad = rr.map((x, i) => (i % 12 === 0 ? x * 1.6 : x));
    expect(rrQuality(bad).rmssd).toBeNull();
  });
});


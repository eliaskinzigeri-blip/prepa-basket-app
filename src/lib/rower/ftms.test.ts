import { describe, expect, it } from 'vitest';
import { CP, inferReportScale, parseCpResponse, parseHeartRate, parseResistanceRange, parseRowerData, rawToLevel, resistanceFactor } from './ftms';

const dv = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('parseRowerData', () => {
  it('lit cadence, coups, distance, allure, puissance, résistance, kcal, FC et temps', () => {
    // flags : distance(2) allure(3) puissance(5) résistance(7) énergie(8) FC(9) temps(11)
    const flags = (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 11);
    const f = parseRowerData(dv(
      flags & 0xff, flags >> 8,
      54, 0x10, 0x00,        // 27 cpm, 16 coups
      0x2c, 0x01, 0x00,      // 300 m
      124, 0,                // 2:04
      182, 0,                // 182 W
      100, 0,                // brut 100
      40, 0, 0, 0, 0,        // 40 kcal
      150,                   // 150 bpm
      90, 0,                 // 90 s
    ));
    expect(f).toEqual({ spm: 27, strokes: 16, distanceM: 300, paceSec: 124, watts: 182, resistanceRaw: 100, kcal: 40, hr: 150, elapsedSec: 90 });
  });

  it('ignore cadence et coups quand le bit More Data est à 1', () => {
    const f = parseRowerData(dv(0x21, 0x00, 182, 0));
    expect(f.spm).toBeUndefined();
    expect(f.watts).toBe(182);
  });

  it('saute les champs moyens sans décaler les suivants', () => {
    const flags = (1 << 1) | (1 << 3) | (1 << 4) | (1 << 5);
    const f = parseRowerData(dv(flags & 0xff, flags >> 8, 48, 5, 0, 50, 120, 0, 125, 0, 200, 0));
    expect(f.spm).toBe(24);
    expect(f.paceSec).toBe(120);
    expect(f.watts).toBe(200);
  });
});

describe('résistance', () => {
  it('déduit le facteur de la plage annoncée', () => {
    expect(resistanceFactor(null)).toBe(10);
    expect(resistanceFactor(parseResistanceRange(dv(10, 0, 150, 0, 10, 0)))).toBe(10);
    expect(resistanceFactor({ min: 1, max: 15, increment: 1 })).toBe(1);
  });
  it('convertit dans les deux sens', () => {
    expect(rawToLevel(100, 10)).toBe(10);
    expect(rawToLevel(10, 10)).toBe(1);
    expect(rawToLevel(7, 1)).toBe(7);
    expect(inferReportScale(100, null)).toBe(10);
    expect(inferReportScale(7, null)).toBe(1);
    expect(inferReportScale(10, null)).toBeNull();
    expect(inferReportScale(10, 1)).toBe(1);
    expect([...CP.setResistance(10, 10)]).toEqual([0x04, 100]);
    expect([...CP.setResistance(99, 10)]).toEqual([0x04, 150]);
  });
});

describe('réponses', () => {
  it('reconnaît succès et contrôle refusé', () => {
    expect(parseCpResponse(dv(0x80, 0x04, 0x01))).toEqual({ opcode: 4, result: 'ok' });
    expect(parseCpResponse(dv(0x80, 0x00, 0x05))?.result).toBe('not-permitted');
    expect(parseCpResponse(dv(0x12))).toBeNull();
  });
  it('lit la FC sur 8 et 16 bits', () => {
    expect(parseHeartRate(dv(0, 148))).toBe(148);
    expect(parseHeartRate(dv(1, 44, 1))).toBe(300);
  });
});

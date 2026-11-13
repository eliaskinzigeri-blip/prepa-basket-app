/** Protocole Bluetooth FTMS : fonctions pures, testées sans rameur. */

export const FTMS_SERVICE = 0x1826;
export const ROWER_DATA = 0x2ad1;
export const RESISTANCE_RANGE = 0x2ad6;
export const CONTROL_POINT = 0x2ad9;
export const MACHINE_STATUS = 0x2ada;
export const HR_SERVICE = 0x180d;
export const HR_MEASUREMENT = 0x2a37;

export interface RowerFrame {
  spm?: number;
  strokes?: number;
  distanceM?: number;
  paceSec?: number;
  watts?: number;
  resistanceRaw?: number;
  kcal?: number;
  hr?: number;
  elapsedSec?: number;
}

/** Décode une trame Rower Data (0x2AD1). L'ordre des champs suit celui du bit de flag. */
export function parseRowerData(dv: DataView): RowerFrame {
  const flags = dv.getUint16(0, true);
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const out: RowerFrame = {};
  let i = 2;

  // Bit 0 inversé : 0 signifie que cadence et coups sont présents.
  if (!has(0)) {
    out.spm = dv.getUint8(i) / 2;
    out.strokes = dv.getUint16(i + 1, true);
    i += 3;
  }
  if (has(1)) i += 1; // cadence moyenne
  if (has(2)) {
    out.distanceM = dv.getUint16(i, true) | (dv.getUint8(i + 2) << 16);
    i += 3;
  }
  if (has(3)) {
    out.paceSec = dv.getUint16(i, true);
    i += 2;
  }
  if (has(4)) i += 2; // allure moyenne
  if (has(5)) {
    out.watts = dv.getInt16(i, true);
    i += 2;
  }
  if (has(6)) i += 2; // puissance moyenne
  if (has(7)) {
    out.resistanceRaw = dv.getInt16(i, true);
    i += 2;
  }
  if (has(8)) {
    out.kcal = dv.getUint16(i, true);
    i += 5; // total, par heure, par minute
  }
  if (has(9)) {
    out.hr = dv.getUint8(i);
    i += 1;
  }
  if (has(10)) i += 1; // MET
  if (has(11)) {
    out.elapsedSec = dv.getUint16(i, true);
    i += 2;
  }
  return out;
}

export function parseHeartRate(dv: DataView): number {
  const flags = dv.getUint8(0);
  return flags & 1 ? dv.getUint16(1, true) : dv.getUint8(1);
}

export interface ResistanceRange {
  min: number;
  max: number;
  increment: number;
}

export function parseResistanceRange(dv: DataView): ResistanceRange {
  return { min: dv.getInt16(0, true), max: dv.getInt16(2, true), increment: dv.getUint16(4, true) };
}

/**
 * Facteur entre le niveau affiché (1 à 15) et la valeur envoyée.
 * Le PRD annonce ×10 sur le Woodrower ; on le déduit de la plage annoncée, à défaut ×10.
 */
export function resistanceFactor(range: ResistanceRange | null): number {
  if (!range || range.max <= 0) return 10;
  return range.max > 30 ? 10 : 1;
}

/**
 * Échelle des niveaux relus sur le rameur : 1 à 15 (échelle 1) ou 10 à 150 (échelle 10).
 * Non documentée : on la déduit des valeurs reçues. Seule la valeur 10 reste ambiguë.
 */
export function inferReportScale(raw: number, current: 1 | 10 | null): 1 | 10 | null {
  if (current) return current;
  if (raw > 15) return 10;
  if (raw !== 10 && raw > 0) return 1;
  return null;
}

export function rawToLevel(raw: number, scale: 1 | 10): number {
  return clampLevel(Math.round(raw / scale));
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(15, level));
}

export const CP = {
  requestControl: () => new Uint8Array([0x00]),
  start: () => new Uint8Array([0x07]),
  setResistance: (level: number, factor: number) => new Uint8Array([0x04, clampLevel(level) * factor]),
};

export type CpResult = 'ok' | 'unsupported' | 'invalid' | 'failed' | 'not-permitted' | 'unknown';

/** Décode une réponse du Control Point : 80 <opcode> <résultat>. */
export function parseCpResponse(dv: DataView): { opcode: number; result: CpResult } | null {
  if (dv.byteLength < 3 || dv.getUint8(0) !== 0x80) return null;
  const map: Record<number, CpResult> = { 1: 'ok', 2: 'unsupported', 3: 'invalid', 4: 'failed', 5: 'not-permitted' };
  return { opcode: dv.getUint8(1), result: map[dv.getUint8(2)] ?? 'unknown' };
}

export function toHex(dv: DataView): string {
  const parts: string[] = [];
  for (let i = 0; i < dv.byteLength; i++) parts.push(dv.getUint8(i).toString(16).padStart(2, '0'));
  return parts.join(' ');
}

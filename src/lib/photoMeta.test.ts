// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { exifDate } from "./photoMeta";
import { rescale } from "./nutrition";

/** JPEG minimal avec un bloc EXIF : IFD0 → pointeur ExifIFD → DateTimeOriginal. */
function jpegWithExif(date: string, littleEndian: boolean): ArrayBuffer {
  const tiff: number[] = [];
  const u16 = (n: number) => (littleEndian ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (littleEndian ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  // IFD0 à 8 : une entrée ExifIFD (0x8769, LONG) → 26
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  // ExifIFD à 26 : DateTimeOriginal (ASCII, 20 octets) → 44
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0));
  tiff.push(...Array.from(date).map((c) => c.charCodeAt(0)), 0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2];
  return new Uint8Array(bytes).buffer;
}

describe("date de prise de vue (EXIF)", () => {
  it("lit DateTimeOriginal en little et big endian", () => {
    for (const le of [true, false]) {
      const d = exifDate(jpegWithExif("2026:11:09 12:41:07", le))!;
      expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 9, 12, 41]);
    }
  });
  it("renvoie null sans EXIF ou si ce n'est pas un JPEG", () => {
    expect(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toBeNull();
    expect(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
  });
});

describe("correction des grammes", () => {
  it("les calories et les macros suivent la nouvelle quantité", () => {
    const f = rescale({ name: "Pâtes cuites", quantity: 200, unit: "g", calories: 300, protein_g: 10, carbs_g: 60, fat_g: 2 }, 300);
    expect(f).toMatchObject({ quantity: 300, calories: 450, protein_g: 15, carbs_g: 90, fat_g: 3 });
  });
  it("avec les valeurs CIQUAL pour 100 g, le recalcul est exact", () => {
    const f = rescale({ name: "Riz cuit", quantity: 150, unit: "g", calories: 200, protein_g: 4, carbs_g: 45, fat_g: 0.5, per100: { kcal: 145, protein_g: 2.9, carbs_g: 31, fat_g: 0.6 } }, 250);
    expect(f).toMatchObject({ quantity: 250, calories: 363, protein_g: 7.3, carbs_g: 77.5, fat_g: 1.5 });
  });
});

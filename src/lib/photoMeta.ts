// Date de prise de vue d'une photo importée : EXIF DateTimeOriginal (JPEG), sinon la date du fichier.
// Sert à dater un repas photographié plus tôt et importé depuis la galerie.

/** Lit DateTimeOriginal (0x9003) ou DateTime (0x0132) dans l'EXIF d'un JPEG. Heure locale de l'appareil. */
export function exifDate(buf: ArrayBuffer): Date | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let o = 2;
  while (o + 4 <= v.byteLength) {
    if (v.getUint8(o) !== 0xff) return null;
    const marker = v.getUint8(o + 1);
    const size = v.getUint16(o + 2);
    if (marker === 0xe1 && v.getUint32(o + 4) === 0x45786966) return readTiff(v, o + 10);
    if (marker === 0xda) return null; // début de l'image : pas d'EXIF
    o += 2 + size;
  }
  return null;
}

function readTiff(v: DataView, t: number): Date | null {
  if (t + 8 > v.byteLength) return null;
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p: number) => v.getUint16(p, le);
  const u32 = (p: number) => v.getUint32(p, le);
  const ascii = (p: number, n: number) => { let s = ""; for (let i = 0; i < n && p + i < v.byteLength; i++) { const c = v.getUint8(p + i); if (!c) break; s += String.fromCharCode(c); } return s; };
  const tags = (ifd: number) => {
    const out = new Map<number, string | number>();
    if (ifd + 2 > v.byteLength) return out;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (type === 2) out.set(tag, ascii(count > 4 ? t + u32(e + 8) : e + 8, count));
      else if (type === 4) out.set(tag, u32(e + 8));
    }
    return out;
  };
  const ifd0 = tags(t + u32(t + 4));
  const exifPtr = ifd0.get(0x8769);
  const exif = typeof exifPtr === "number" ? tags(t + exifPtr) : new Map();
  const raw = String(exif.get(0x9003) ?? ifd0.get(0x0132) ?? "");
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date de prise de vue : EXIF si présent, sinon la date de modification du fichier (si elle n'est pas « maintenant »). */
export async function takenAt(file: File): Promise<Date | null> {
  try {
    const d = exifDate(await file.slice(0, 256 * 1024).arrayBuffer());
    if (d) return d;
  } catch { /* fichier illisible */ }
  const lm = file.lastModified ? new Date(file.lastModified) : null;
  return lm && Date.now() - lm.getTime() > 5 * 60_000 ? lm : null;
}

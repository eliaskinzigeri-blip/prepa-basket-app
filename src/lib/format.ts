// Formats à la française (design system : virgule décimale, espace fine, « 17h30 – 18h15 »).
const NNBSP = " ";

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(v)
    .replace(/ /g, NNBSP);
}

export function hm(min: number | null | undefined): string {
  if (min == null) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export function clock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function range(start: number | null, end: number | null): string {
  if (start == null) return "";
  return end == null ? hm(start) : `${hm(start)} – ${hm(end)}`;
}

export function chrono(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const DAYS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const DAYS_LONG = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Dates manipulées en chaînes « AAAA-MM-JJ », en heure locale.
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function today(): string {
  return iso(new Date());
}
/** 0 = lundi … 6 = dimanche */
export function weekday(s: string): number {
  return (parse(s).getDay() + 6) % 7;
}
export function mondayOf(s: string): string {
  return addDays(s, -weekday(s));
}
export function diffDays(a: string, b: string): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000);
}
export function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function dayLabel(s: string): string {
  const d = parse(s);
  return `${DAYS_SHORT[weekday(s)]} ${d.getDate()}`;
}
export function longDate(s: string): string {
  const d = parse(s);
  const w = DAYS_LONG[weekday(s)];
  return `${w[0].toUpperCase()}${w.slice(1)} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}
export function weekRange(monday: string): string {
  const a = parse(monday);
  const b = parse(addDays(monday, 6));
  const left = a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${MONTHS[a.getMonth()]}`;
  return `${left} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}
export function monthTitle(s: string): string {
  const d = parse(s);
  return `${MONTHS_LONG[d.getMonth()][0].toUpperCase()}${MONTHS_LONG[d.getMonth()].slice(1)} ${d.getFullYear()}`;
}

export function ago(isoTs: string | null): string {
  if (!isoTs) return "jamais";
  const s = (Date.now() - Date.parse(isoTs)) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  const d = new Date(isoTs);
  const t = `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
  if (iso(d) === today()) return `aujourd'hui, ${t}`;
  return `le ${d.getDate()} ${MONTHS[d.getMonth()]}, ${t}`;
}

export function age(birth: string | null): number | null {
  if (!birth) return null;
  const b = parse(birth);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

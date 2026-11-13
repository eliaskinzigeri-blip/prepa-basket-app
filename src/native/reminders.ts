// Rappels programmés sur le téléphone (app iPhone native) pour les 7 prochains jours, mêmes règles que la fonction
// serveur « push » : VFC du matin, séance dans 30 min, heure de coucher, match 2 h avant.
import { isHoliday } from "../data/catalog";
import { addDays, parse, today, weekday } from "../lib/format";
import { bedtimeFor, clockOf } from "../lib/sleep";
import type { CalEvent, Profile } from "../lib/types";
import type { LocalReminder } from "./index";

const at = (day: string, min: number) => { const d = parse(day); d.setMinutes(min); return d; };
const schoolDay = (d: string, p: Profile) => weekday(d) < 5 && !isHoliday(p.vacation_zone, d);

export function buildReminders(p: Profile, events: CalEvent[], start = today(), wakeFree = 630): LocalReminder[] {
  const out: LocalReminder[] = [];
  let id = 1;
  for (let k = 0; k < 7; k++) {
    const day = addDays(start, k);
    const planned = events.filter((e) => e.date === day && e.status === "planned");
    if (p.notif_morning !== false) {
      const workout = planned.find((e) => e.type === "test" || (e.type === "workout" && e.payload.template !== "recup"));
      out.push({ id: id++, at: at(day, schoolDay(day, p) ? p.wake_school_min ?? 420 : wakeFree), title: "Avant de te lever : mesure ta VFC",
        body: workout ? `3 min allongé avec ta ceinture cardio. « ${workout.title} » s'adaptera à ta forme. Puis note ta nuit.` : "3 min allongé avec ta ceinture cardio, toujours dans la même position. Puis note ta nuit.",
        url: "/test/fc-repos?court=1" });
    }
    if (p.notif_session !== false) {
      for (const e of planned.filter((x) => ["workout", "basket", "test"].includes(x.type) && x.start_min != null)) {
        out.push({ id: id++, at: at(day, e.start_min! - 30), title: `Dans 30 min : ${e.title}`, body: "Ouvre l'app : ta séance s'adapte à ta forme du jour. Mets ta ceinture cardio.", url: `/evenement/${e.id}` });
      }
    }
    if (p.notif_match !== false) {
      for (const m of planned.filter((x) => x.type === "match" && x.start_min != null)) {
        out.push({ id: id++, at: at(day, m.start_min! - 120), title: `Match à ${clockOf(m.start_min!)}`, body: `${m.title}. Dernier vrai repas maintenant, et bois de l'eau régulièrement.`, url: `/evenement/${m.id}` });
      }
    }
    if (p.notif_bedtime !== false && schoolDay(addDays(day, 1), p)) {
      const bed = bedtimeFor(p.wake_school_min ?? 420) + 1440;
      out.push({ id: id++, at: at(day, bed - 30), title: `Au lit à ${clockOf(bed)}`, body: `Pour dormir 9 h avant ton réveil de ${clockOf(p.wake_school_min ?? 420)}. Pose les écrans maintenant.`, url: "/sommeil" });
    }
  }
  return out;
}

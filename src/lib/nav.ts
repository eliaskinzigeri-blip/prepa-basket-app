import type { CalEvent } from "./types";

/** Écran de démarrage d'un événement du calendrier. */
export function startPath(e: Pick<CalEvent, "id" | "type"> & { payload?: CalEvent["payload"] }): string {
  if (e.payload?.rower) return `/rameur/apercu/${e.payload.rower}?event=${e.id}`;
  if (e.type === "workout") return `/seance/${e.id}`;
  if (e.type === "basket") return `/basket/${e.id}`;
  if (e.type === "test") return `/tests?event=${e.id}`;
  return `/evenement/${e.id}`;
}

/** Faite en entier (une séance arrêtée en cours de route est « partiellement faite »). */
export const isDone = (e: Pick<CalEvent, "status" | "payload">) => e.status === "done" && !e.payload?.partial;
export const isPartial = (e: Pick<CalEvent, "status" | "payload">) => e.status === "done" && Boolean(e.payload?.partial);

export const PLACE_LABEL: Record<string, string> = { maison: "Maison", salle: "Salle", terrain: "Terrain" };

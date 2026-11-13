// Ambidextrie : main faible comparée à la main forte, au dribble et en finition près du cercle.
// Indice = moyenne des ratios main faible / main forte (100 % = aussi bon des deux mains).
// Protocole inspiré des études de Stöckel & Weigelt (dribble chronométré une main puis l'autre) et des tests de lay-ups par côté.
import type { Measurement } from "./types";

const last = (ms: Measurement[], kind: string) =>
  ms.filter((m) => m.kind === kind).reduce<Measurement | null>((a, m) => (!a || m.measured_at > a.measured_at ? m : a), null);

type New = { kind: string; value: number; source: string };

const ratio = (weak: number | null, strong: number | null) => (weak != null && strong ? Math.min(100, (weak / strong) * 100) : null);

/** Ajoute l'indice d'ambidextrie aux mesures qu'on enregistre, avec les dernières valeurs de l'autre test. */
export function withAmbiIndex(ms: Measurement[], fresh: New[]): New[] {
  const get = (k: string) => fresh.find((m) => m.kind === k)?.value ?? (last(ms, k) ? Number(last(ms, k)!.value) : null);
  const parts = [ratio(get("weak_dribble_rate"), get("strong_dribble_rate")), ratio(get("weak_finish_pct"), get("strong_finish_pct"))].filter((x): x is number => x != null);
  if (!parts.length) return fresh;
  return [...fresh, { kind: "ambi_index", value: Math.round(parts.reduce((a, b) => a + b, 0) / parts.length), source: "camera" }];
}

/** Conseils issus de la recherche et des fédérations, affichés avec l'objectif. */
export const AMBI_TIPS = [
  "Commence chaque séance par la main faible : les jeunes qui apprennent un geste d'abord avec elle progressent plus des deux mains.",
  "Dribble main faible seule : sur place (bas, haut, en V), puis en marchant, en courant, et enfin face à un défenseur.",
  "Mikan drill main faible : finis sous le cercle de la main faible uniquement, l'autre main ne touche pas le ballon. Passe à la suite après 5 réussites d'affilée.",
  "Double-pas côté main faible (appuis inversés), puis reverse et finitions avec contact.",
  "En petit match, joue au « main faible seulement » : seule ta main faible a le droit de dribbler.",
  "Utiliser ta main faible dans la vie (brosse à dents…) ne fait pas de mal, mais rien ne prouve que ça aide au basket : le terrain compte d'abord.",
];

export type Position = "meneur" | "arriere" | "ailier" | "ailier_fort" | "pivot";
export type Experience = "lt1" | "1-3" | "3-5" | "gt5";
export type Level = "loisir" | "departemental" | "regional" | "national";
export type Place = "maison" | "salle" | "terrain";
export type EventType = "workout" | "basket" | "club" | "match" | "rest" | "test";

export interface Profile {
  id: string;
  first_name: string | null;
  birth_date: string | null;
  height_cm: number | null;
  /** Allonge debout, bras tendu (cm), pour le calcul du dunk. */
  reach_cm: number | null;
  weight_kg: number | null;
  strong_hand: "droite" | "gauche" | null;
  position: Position | null;
  experience: Experience | null;
  level: Level | null;
  priorities_high: string[];
  priorities_low: string[];
  workout_locations: string[];
  home_equipment: string[];
  has_hoop: boolean;
  hoop_height_m: number;
  ab_weeks: boolean;
  ab_reference: string | null;
  vacation_zone: "A" | "B" | "C" | null;
  latest_min: number;
  session_minutes: 30 | 45 | 60 | 90;
  /** Une session de tests toutes les N semaines (réglable dans le profil). */
  test_every_weeks: number;
  /** Jours où le joueur mange à la cantine (lundi = 0) ; vide ou absent : tous les jours où un menu est publié. */
  cantine_days?: number[] | null;
  ffbb_club: { id: string; name: string; city?: string } | null;
  ffbb_team: { id: string; label: string } | null;
  ffbb_synced_at: string | null;
  trackfit_connected: boolean;
  trackfit_consent_at: string | null;
  trackfit_synced_at: string | null;
  trackfit_token: string;
  notif_session: boolean;
  notif_match: boolean;
  /** Rappels du matin (nuit, VFC) et du soir (heure de coucher). */
  notif_morning: boolean;
  notif_bedtime: boolean;
  /** Heure de lever des jours de cours (minutes), pour l'heure de coucher conseillée. */
  wake_school_min: number;
  /** Horloge biologique (questionnaire MCTQ calculé sur le journal de sommeil), null tant qu'elle est inconnue. */
  chronotype: "matin" | "intermediaire" | "soir" | null;
  chronotype_msf: number | null;
  /** Faux : le chronotype n'est ni calculé ni utilisé par le programme. */
  chronotype_enabled: boolean;
  onboarding_step: number;
  onboarded_at: string | null;
}

export interface Slot {
  id?: string;
  kind: "class" | "club" | "free" | "blocked";
  week: "*" | "A" | "B";
  weekday: number | null; // 0 = lundi
  on_date: string | null;
  start_min: number;
  end_min: number;
  location: Place | null;
  label: string | null;
}

export interface EventPayload {
  // workout
  template?: string;
  focus?: string;
  easy?: number; // exercices que le joueur a lestés de lui-même (trop faciles)
  feel?: number; // ressenti de fin de séance, 1 (très dur) à 5 (facile)
  /** Séance faite au rameur (endurance à la maison). */
  rower?: "endurance";
  /** Séance arrêtée en cours de route : enregistrée, mais pas comptée comme faite en entier. */
  partial?: boolean;
  // basket
  mode?: "dribble" | "shoot";
  games?: string[];
  // match
  opponent?: string;
  home?: boolean;
  venue?: string | null;
  address?: string | null;
  competition?: string | null;
  team?: string;
  us?: number;
  them?: number;
  // contexte
  note?: string;
  holiday?: boolean;
  /** Séance lourde pour les jambes (pour espacer les suivantes). */
  heavy?: boolean;
  /** Semaine allégée du bloc de 4 : volume réduit. */
  deload?: boolean;
}

export interface CalEvent {
  id: string;
  user_id?: string;
  date: string;
  start_min: number | null;
  end_min: number | null;
  type: EventType;
  title: string;
  location: string | null;
  source: "program" | "ffbb" | "manual";
  external_id?: string | null;
  payload: EventPayload;
  status: "planned" | "done" | "skipped";
}

export interface Measurement {
  id: string;
  kind: string;
  value: number;
  source: "manual" | "trackfit" | "camera" | "ceinture";
  measured_at: string;
}

export interface SessionRow {
  id: string;
  event_id: string | null;
  kind: "workout" | "dribble" | "shoot" | "test";
  title: string;
  started_at: string;
  duration_s: number | null;
  results: Record<string, any>;
  feeling: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  equipment: string[];
  quality: string;
  pattern: string;
  heavyLegs: boolean;
  sets: number;
  reps: number | null;
  seconds: number | null;
  rest: number;
  muscles: string;
  /** Photos départ / arrivée (free-exercise-db, domaine public) : /exercises/<photo>-0.webp et -1.webp */
  photo?: string;
  /** Animation maison quand aucune photo ne montre le mouvement (ex. rotation en planche latérale). */
  anim?: string;
  /** Difficulté 1 (débutant) à 3 (avancé) : débloquée selon le niveau du joueur. */
  level: 1 | 2 | 3;
  /** Lest conseillé (kg) quand le joueur a dépassé le niveau max. */
  lest?: number;
  /** Vidéo YouTube de démonstration (à la place des photos quand elles ne montrent pas le mouvement). */
  video?: { id: string; title: string; author: string };
  /** Exercice d'un seul côté : each = toutes les reps d'un côté puis de l'autre ; alt = en alternant. */
  side?: "each" | "alt";
}

export type GoalKind = "dunk" | "vertical" | "shoot" | "sprint" | "cardio" | "physique" | "dribble";
export interface Goal {
  id: string;
  user_id: string;
  kind: GoalKind;
  /** dunk : { hands } · shoot : { zone } · sprint : { distance } · physique : { metric } */
  params: Record<string, string | number>;
  target: number;
  baseline: number | null;
  created_at: string;
  achieved_at: string | null;
  archived: boolean;
}

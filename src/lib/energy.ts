// Métabolisme de base d'un ado sportif : moyenne de deux équations validées par calorimétrie indirecte.
// 1) Reale et al. 2020 (IJSNEM), faite POUR de jeunes sportifs (126 athlètes de 16,5 ± 1,4 ans, masse maigre au DXA) :
//    11,1 × poids + 8,4 × taille (cm) − 340 (garçon) ou − 537 (fille). Erreur moyenne ±114 kcal/j,
//    bien meilleure que les 8 équations publiées testées (Harris-Benedict, Schofield, etc.).
// 2) IOM (Dietary Reference Intakes 2002/2005, 10-18 ans), qui tient compte de l'âge : la mieux classée chez
//    des footballeurs de 13 ans (Łuszczki et al. 2020).
// Reale n'a pas de terme d'âge et a été établie sur des ados un peu plus âgés ; l'IOM n'est pas faite pour les sportifs :
// leur moyenne compense en partie les deux défauts. Harris-Benedict (équation adulte de 1919) sous-estime nettement à cet âge.

/** Âge en années révolues. */
export function ageOn(birth: string | null, at = new Date()): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  return at.getFullYear() - b.getFullYear() - (at < new Date(at.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
}

export function bmrReale(weightKg: number, heightCm: number, male: boolean): number {
  return 11.1 * weightKg + 8.4 * heightCm - (male ? 340 : 537);
}

export function bmrIom(weightKg: number, heightCm: number, age: number, male: boolean): number {
  const h = heightCm / 100;
  return male ? 68 - 43.3 * age + 712 * h + 19.2 * weightKg : 189 - 17.6 * age + 625 * h + 7.9 * weightKg;
}

/** kcal/jour, arrondi à 10. null si une donnée manque ou sort de la plage des équations (10-18 ans). */
export function bmrOf(weightKg: number, heightCm: number, age: number, male: boolean): number | null {
  if (!(weightKg > 20 && heightCm > 100 && age >= 10 && age <= 18)) return null;
  const avg = (bmrReale(weightKg, heightCm, male) + bmrIom(weightKg, heightCm, age, male)) / 2;
  return Math.round(avg / 10) * 10;
}

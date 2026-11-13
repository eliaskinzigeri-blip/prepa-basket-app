// Bibliothèque : tous les exercices de l'app, filtrables par famille, recherche et matériel disponible.
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/app";
import { Icon } from "../components/Icon";
import { BackButton, Chip } from "../components/ui";
import { FAMILIES, GYM_EQUIPMENT } from "../data/catalog";
import { dose, EXERCISES, withImplied } from "../lib/exercises";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const INDEX = EXERCISES.map((e) => ({ e, text: fold(`${e.name} ${e.muscles}`) })).sort((a, b) => a.e.name.localeCompare(b.e.name, "fr"));

export default function Library() {
  const { profile } = useApp();
  const [family, setFamily] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const q = useDeferredValue(fold(query.trim()));

  // matériel du joueur : maison + salle s'il s'entraîne en salle
  const owned = useMemo(() => {
    const set = new Set(profile?.home_equipment ?? []);
    if (profile?.workout_locations.some((l) => l !== "maison")) GYM_EQUIPMENT.forEach((x) => set.add(x));
    return withImplied(set);
  }, [profile]);

  const list = INDEX.filter(({ e, text }) =>
    (!family || e.quality === family) && (!q || text.includes(q)) && (!mine || e.equipment.every((x) => owned.has(x))),
  ).map((x) => x.e);
  const counts = useMemo(() => Object.fromEntries(FAMILIES.map((f) => [f.id, EXERCISES.filter((e) => e.quality === f.id).length])), []);

  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton /><h1 className="t" style={{ fontSize: 22 }}>Exercices</h1></div>
      <p className="lead" style={{ margin: "4px 0 14px" }}>{EXERCISES.length} exercices utiles au basket, avec photos et consignes.</p>
      <label className="field" style={{ marginBottom: 12 }}>
        <span className="sr-only">Rechercher un exercice</span>
        <input className="input" type="search" inputMode="search" autoComplete="off" spellCheck={false} placeholder="Rechercher : squat, mollets, gainage…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="pb-chips" role="group" aria-label="Famille d'exercices">
        <Chip active={!family} onClick={() => setFamily(null)}>Tout</Chip>
        {FAMILIES.filter((f) => counts[f.id]).map((f) => (
          <Chip key={f.id} active={family === f.id} onClick={() => setFamily(family === f.id ? null : f.id)}>{f.label} · {counts[f.id]}</Chip>
        ))}
      </div>
      <div className="pb-chips" style={{ marginTop: 8 }}>
        <Chip active={mine} onClick={() => setMine(!mine)}>{mine ? "✓ " : ""}Avec mon matériel</Chip>
      </div>
      <p className="pb-subtle" aria-live="polite" style={{ fontSize: 13, margin: "14px 0 6px" }}>{list.length} exercice{list.length > 1 ? "s" : ""}</p>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {list.map((e) => (
          <Link key={e.id} to={`/exercice/${e.id}`} className="pb-li lib-row">
            {e.photo ? <img className="lib-thumb" src={`/exercises/${e.photo}-0.webp`} alt="" width={64} height={43} loading="lazy" decoding="async" />
              : <div className="lib-thumb lib-thumb-empty" aria-hidden="true"><Icon name="dumbbell" size="sm" /></div>}
            <div className="t">{e.name}<small>{e.muscles} · {dose(e)}</small></div>
            <Icon name="right" size="sm" className="pb-muted" />
          </Link>
        ))}
        {!list.length ? <p className="pb-muted" style={{ padding: 16, margin: 0 }}>Aucun exercice ne correspond. Essaie un autre mot ou retire un filtre.</p> : null}
      </div>
    </main>
  );
}

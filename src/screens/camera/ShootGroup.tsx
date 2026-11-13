// Fin d'un shoot à plusieurs : chaque joueur repéré, avec sa photo et ses tirs ; on dit qui c'est.
import { useEffect, useId, useState } from "react";
import { Icon } from "../../components/Icon";
import { Notice, Stepper, Toggle } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import { knownPeople, ME, sameName, type PlayerResult } from "../../lib/people";

export interface Card {
  photo: string | null;
  descriptors: number[][];
  shots: number[];
  made: number;
  attempts: number;
  /** Personne reconnue pendant la session. */
  guess: { key: string; name: string } | null;
  /** true : « oui, c'est elle » ; false : « non » ; null : pas encore répondu. */
  guessOk: boolean | null;
  answer: "me" | "other" | null;
  name: string;
  consent: boolean;
}

/** Qui est ce joueur une fois la question répondue (null : pas encore). */
export function identity(c: Card, names: Map<string, string>): { key: string; name: string } | null {
  if (c.guess && c.guessOk) return c.guess;
  if (c.answer === "me") return { key: ME, name: "Moi" };
  if (c.answer === "other" && c.name.trim()) {
    const known = [...names].find(([, n]) => sameName(n, c.name));
    return { key: known?.[0] ?? `new:${c.name.trim().toLocaleLowerCase("fr")}`, name: known?.[1] ?? c.name.trim() };
  }
  return null;
}

/** Noms déjà connus : ceux gardés sur le téléphone et ceux des anciennes sessions à plusieurs. */
export function useKnownNames(userId: string): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(() => new Map(knownPeople(userId).filter((p) => p.key !== ME).map((p) => [p.key, p.name])));
  useEffect(() => {
    supabase.from("sessions").select("results").eq("kind", "shoot").not("results->players", "is", null).order("started_at", { ascending: false }).limit(200)
      .then(({ data }) => {
        const m = new Map(names);
        for (const s of data ?? []) for (const p of (s.results?.players ?? []) as PlayerResult[]) if (p.key !== ME && !m.has(p.key)) m.set(p.key, p.name);
        setNames(m);
      });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  return names;
}

export function GroupReview({ cards, onChange, names, saving, onSave }: {
  cards: Card[]; onChange: (i: number, c: Partial<Card>) => void; names: Map<string, string>; saving: boolean; onSave: () => void;
}) {
  const listId = useId();
  const ready = cards.length > 0 && cards.every((c) => identity(c, names));
  const ids = cards.map((c) => identity(c, names)?.key);
  const merged = ids.some((k, i) => k && ids.indexOf(k) !== i);
  return (
    <div className="pb-glass hero" style={{ padding: 16, background: "rgba(13,27,77,.96)", maxHeight: "78vh", overflowY: "auto" }}>
      <b style={{ fontSize: 16 }}>{cards.length > 1 ? `${cards.length} joueurs repérés` : cards.length ? "1 joueur repéré" : "Aucun tir compté"}</b>
      <p className="pb-muted" style={{ margin: "4px 0 12px", fontSize: 14 }}>Dis qui est qui et corrige le comptage si besoin. La même personne sur deux photos : donne-lui le même nom, ses tirs seront regroupés.</p>
      <datalist id={listId}>{[...new Set(names.values())].map((n) => <option key={n} value={n} />)}</datalist>
      <div className="col" style={{ gap: 12 }}>
        {cards.map((c, i) => {
          const who = identity(c, names);
          const isNew = who && who.key.startsWith("new:");
          return (
            <div key={i} className="pb-glass" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 12, alignItems: "center" }}>
                {c.photo ? <img src={c.photo} alt={who ? `Visage de ${who.name}` : `Visage du joueur ${i + 1}`} width={64} height={64} style={{ borderRadius: "50%", objectFit: "cover", flex: "none" }} />
                  : <span className="pb-tile" style={{ width: 64, height: 64, borderRadius: "50%", flex: "none" }} aria-hidden="true"><Icon name="user" /></span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 16 }}>{who ? (who.key === ME ? "Toi" : who.name) : `Joueur ${i + 1}`}</b>
                  <div className="pb-muted pb-num" style={{ fontSize: 14 }}>{c.made}/{c.attempts} réussis · {c.attempts ? Math.round((c.made / c.attempts) * 100) : 0} %</div>
                  {!c.photo ? <div className="pb-subtle" style={{ fontSize: 12 }}>Pas de photo nette : visage jamais vu de face.</div> : null}
                </div>
              </div>

              {c.guess && c.guessOk == null ? (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 15 }}>Probablement {c.guess.key === ME ? "toi" : c.guess.name} ?</p>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="pb-btn primary" style={{ flex: 1 }} onClick={() => onChange(i, { guessOk: true })}>{c.guess.key === ME ? "Oui, c'est moi" : `Oui, c'est ${c.guess.name}`}</button>
                    <button className="pb-btn" style={{ flex: 1 }} onClick={() => onChange(i, { guessOk: false })}>Non</button>
                  </div>
                </div>
              ) : !who && c.answer == null ? (
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button className="pb-btn primary" style={{ flex: 1 }} onClick={() => onChange(i, { answer: "me" })}>C'est moi</button>
                  <button className="pb-btn" style={{ flex: 1 }} onClick={() => onChange(i, { answer: "other" })}>Une autre personne</button>
                </div>
              ) : null}

              {c.answer === "other" && !(c.guess && c.guessOk) ? (
                <div style={{ marginTop: 10 }}>
                  <label className="lbl" htmlFor={`${listId}-${i}`}>Son prénom</label>
                  <input id={`${listId}-${i}`} className="input" list={listId} value={c.name} autoComplete="off" autoCapitalize="words" placeholder="Prénom…"
                    onChange={(e) => onChange(i, { name: e.target.value })} style={{ width: "100%", marginTop: 4 }} />
                  {who && !isNew ? <p className="pb-subtle" style={{ margin: "6px 0 0", fontSize: 12 }}>Déjà vu dans une ancienne session : ses tirs s'ajoutent à son historique.</p> : null}
                </div>
              ) : null}

              {who && who.key !== ME && c.descriptors.length ? (
                <div className="row between" style={{ marginTop: 10, gap: 10 }}>
                  <span style={{ fontSize: 13, lineHeight: "18px" }}>{who.name} est d'accord pour que son visage reste sur ce téléphone, pour le reconnaître la prochaine fois</span>
                  <Toggle on={c.consent} onChange={(v) => onChange(i, { consent: v })} label={`${who.name} est d'accord pour que son visage soit gardé`} />
                </div>
              ) : null}

              <div className="row between" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                <Stepper label="Réussis" value={c.made} unit="réussis" max={c.attempts} onChange={(v) => onChange(i, { made: v })} />
                <Stepper label="Tentés" value={c.attempts} unit="tentés" min={c.made} onChange={(v) => onChange(i, { attempts: v })} />
              </div>
              {who ? <button className="link" style={{ marginTop: 6, fontSize: 13 }} onClick={() => onChange(i, { guessOk: c.guess ? false : null, answer: null, name: "" })}>Changer</button> : null}
            </div>
          );
        })}
      </div>
      {merged ? <div style={{ marginTop: 12 }}><Notice>Même nom sur plusieurs photos : leurs tirs seront regroupés.</Notice></div> : null}
      <button className="pb-btn primary lg block" style={{ marginTop: 14 }} disabled={saving || !ready} onClick={onSave}>
        {saving ? "Enregistrement…" : ready ? "Valider et voir l'analyse" : "Dis qui est chaque joueur"}
      </button>
    </div>
  );
}

// Toutes tes sessions de shoot : on y retrouve l'analyse et le replay de chacune, même longtemps après.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BackButton, Notice, Spinner } from "../components/ui";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { iso, longDate, num } from "../lib/format";
import { game } from "../data/catalog";
import { knownPeople, ME, type PlayerResult } from "../lib/people";
import { useApp } from "../state/app";
import type { SessionRow } from "../lib/types";

type Row = Pick<SessionRow, "id" | "started_at" | "results">;

export default function ShootHistory() {
  const { session: auth } = useApp();
  const userId = auth?.user.id ?? "";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    supabase.from("sessions").select("id, started_at, results").eq("kind", "shoot").order("started_at", { ascending: false }).limit(200)
      .then(({ data, error: e }) => { if (e) setError(true); setRows((data ?? []) as Row[]); });
  }, []);

  if (!rows) return <main className="pb-page screen no-nav"><Spinner /></main>;
  // sessions sans aucun tir (caméra ouverte puis fermée) : rien à analyser
  const list = rows.filter((s) => (s.results?.shots ?? []).length || s.results?.attempts);
  const people = new Map<string, string>();
  for (const s of list) for (const p of (s.results?.players ?? []) as PlayerResult[]) if (p.key !== ME) people.set(p.key, p.name);
  for (const p of knownPeople(userId)) if (p.key !== ME && people.has(p.key)) people.set(p.key, p.name);

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 40 }}>
      <div className="hdr"><BackButton /><div style={{ flex: 1, paddingLeft: 6 }}><b style={{ fontSize: 17 }}>Mes sessions de shoot</b><div className="pb-subtle" style={{ fontSize: 13 }}>{list.length} session{list.length > 1 ? "s" : ""}</div></div></div>
      {error ? <div style={{ marginTop: 14 }}><Notice tone="error">Impossible de charger tes sessions. Vérifie ta connexion et réessaie.</Notice></div> : null}

      <div className="lbl section">Joueurs</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        <Link to={`/shoot/joueur/${ME}`} className="pb-li" style={{ color: "inherit", textDecoration: "none" }}>
          <Icon name="user" className="pb-muted" /><div className="t">Toi<small>Ton % sur toutes tes séries</small></div><Icon name="right" size="sm" className="pb-muted" />
        </Link>
        {[...people].map(([key, name]) => (
          <Link key={key} to={`/shoot/joueur/${key}`} className="pb-li" style={{ color: "inherit", textDecoration: "none" }}>
            <Icon name="user" className="pb-muted" /><div className="t">{name}<small>Ses séries au shoot à plusieurs</small></div><Icon name="right" size="sm" className="pb-muted" />
          </Link>
        ))}
      </div>

      <div className="lbl section">Sessions</div>
      {list.length ? (
        <div className="pb-glass" style={{ padding: "4px 0" }}>
          {list.map((s) => {
            const r = s.results ?? {};
            const players = (r.players ?? []) as PlayerResult[];
            const made = players.length ? players.reduce((n, p) => n + p.made, 0) : r.made ?? 0;
            const attempts = players.length ? players.reduce((n, p) => n + p.attempts, 0) : r.attempts ?? 0;
            const who = players.length ? players.map((p) => (p.key === ME ? "toi" : p.name)).join(", ") : "Solo";
            return (
              <Link key={s.id} to={`/shoot/${s.id}`} className="pb-li" style={{ color: "inherit", textDecoration: "none" }}>
                <Icon name={r.hasVideo ? "play" : "target"} className="pb-muted" />
                <div className="t">{longDate(iso(new Date(s.started_at)))} · {game(r.game ?? "tir_libre")?.name ?? "Shoot"}<small>{who} · {made}/{attempts}</small></div>
                <b className="pb-num">{attempts ? `${num(Math.round((made / attempts) * 100))} %` : "—"}</b>
              </Link>
            );
          })}
        </div>
      ) : <Notice>Pas encore de session de shoot. Lance-en une depuis l'accueil.</Notice>}
      <p className="pb-subtle" style={{ fontSize: 12, marginTop: 10 }}>Les replays vidéo restent sur le téléphone qui a filmé.</p>
    </main>
  );
}

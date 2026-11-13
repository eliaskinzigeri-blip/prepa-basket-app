// Historique au shoot d'un joueur (toi ou une personne nommée au shoot à plusieurs) : % sur chaque série.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BackButton, Notice, Spinner, Stat } from "../components/ui";
import { LineChart } from "../components/LineChart";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { dayLabel, iso, num } from "../lib/format";
import { useApp } from "../state/app";
import { forgetFace, knownPeople, ME, type PlayerResult } from "../lib/people";
import type { SessionRow } from "../lib/types";

interface Serie { id: string; date: string; made: number; attempts: number; game: string; group: boolean }

export default function ShootPlayer() {
  const { key = ME } = useParams();
  const { session: auth, profile } = useApp();
  const userId = auth?.user.id ?? "";
  const [series, setSeries] = useState<Serie[] | null>(null);
  const [name, setName] = useState<string>(key === ME ? "Toi" : "");
  const [person, setPerson] = useState(() => knownPeople(userId).find((p) => p.key === key) ?? null);

  useEffect(() => {
    // toi : toutes tes sessions de shoot ; les autres : celles où ils ont été nommés
    const q = supabase.from("sessions").select("id, started_at, results").eq("kind", "shoot").order("started_at", { ascending: true }).limit(300);
    (key === ME ? q : q.contains("results", { players: [{ key }] })).then(({ data }) => {
      const list: Serie[] = [];
      for (const s of (data ?? []) as Pick<SessionRow, "id" | "started_at" | "results">[]) {
        const r = s.results ?? {};
        const p = ((r.players ?? []) as PlayerResult[]).find((x) => x.key === key);
        if (p && key !== ME) setName(p.name);
        const made = p ? p.made : key === ME && !r.group ? r.made : null;
        const attempts = p ? p.attempts : key === ME && !r.group ? r.attempts : null;
        if (made == null || !attempts) continue;
        list.push({ id: s.id, date: iso(new Date(s.started_at)), made, attempts, game: r.game ?? "tir_libre", group: Boolean(r.group) });
      }
      setSeries(list);
    });
  }, [key]);

  if (!series) return <main className="pb-page screen no-nav"><Spinner /></main>;
  const made = series.reduce((n, s) => n + s.made, 0), attempts = series.reduce((n, s) => n + s.attempts, 0);
  const last5 = series.slice(-5);
  const recent = last5.reduce((n, s) => n + s.attempts, 0) ? Math.round((last5.reduce((n, s) => n + s.made, 0) / last5.reduce((n, s) => n + s.attempts, 0)) * 100) : null;
  const shown = key === ME ? profile?.first_name || "Toi" : name || person?.name || "Joueur";

  return (
    <main className="pb-page screen no-nav" style={{ paddingBottom: 40 }}>
      <div className="hdr"><BackButton /><div style={{ flex: 1, paddingLeft: 6 }}><b style={{ fontSize: 17 }}>{shown} au shoot</b><div className="pb-subtle" style={{ fontSize: 13 }}>{series.length} série{series.length > 1 ? "s" : ""}</div></div></div>
      <div className="row" style={{ gap: 14, margin: "16px 2px" }}>
        {person?.photo ? <img src={person.photo} alt={`Visage de ${shown}`} width={72} height={72} style={{ borderRadius: "50%", objectFit: "cover" }} />
          : <span className="pb-tile" style={{ width: 72, height: 72, borderRadius: "50%" }} aria-hidden="true"><Icon name="user" /></span>}
        <div><b className="pb-num" style={{ fontSize: 30 }}>{attempts ? Math.round((made / attempts) * 100) : 0} %</b><div className="pb-muted" style={{ fontSize: 14 }}>{made} réussis sur {attempts} tirs, toutes séries</div></div>
      </div>
      <div className="grid3">
        <Stat k="Séries" v={series.length} />
        <Stat k="5 dernières" v={recent ?? "—"} unit={recent != null ? "%" : ""} />
        <Stat k="Meilleure" v={series.length ? Math.max(...series.map((s) => Math.round((s.made / s.attempts) * 100))) : "—"} unit={series.length ? "%" : ""} />
      </div>
      <div className="lbl section">Réussite par série</div>
      <div className="pb-glass" style={{ padding: 12 }}>
        <LineChart points={series.slice(-12).map((s) => ({ label: `${s.date.slice(8)}/${s.date.slice(5, 7)}`, value: Math.round((s.made / s.attempts) * 100) }))} unit="%" ariaLabel={`Réussite de ${shown} par série`} />
      </div>
      <div className="lbl section">Séries</div>
      {series.length ? (
        <div className="pb-glass" style={{ padding: "4px 0" }}>
          {[...series].reverse().map((s) => (
            <Link key={s.id} to={`/shoot/${s.id}`} className="pb-li" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="t">{dayLabel(s.date)}<small>{s.group ? "À plusieurs" : "Solo"} · {s.made}/{s.attempts}</small></div>
              <b className="pb-num">{num(Math.round((s.made / s.attempts) * 100))} %</b>
            </Link>
          ))}
        </div>
      ) : <Notice>Pas encore de série enregistrée.</Notice>}
      {key !== ME && person?.descriptors.length ? (
        <button className="pb-btn block" style={{ marginTop: 16 }} onClick={() => { forgetFace(userId, key); setPerson(knownPeople(userId).find((p) => p.key === key) ?? null); }}>
          <Icon name="trash" size="sm" />Effacer son visage de ce téléphone
        </button>
      ) : null}
      {key !== ME ? <p className="pb-subtle" style={{ fontSize: 12, marginTop: 8 }}>Sa photo et son visage restent sur ce téléphone. Seuls son prénom et ses tirs sont enregistrés avec tes sessions.</p> : null}
    </main>
  );
}

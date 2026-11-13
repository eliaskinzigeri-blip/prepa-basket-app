import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../state/app";
import { Icon } from "../components/Icon";
import { BackButton, BottomAction, Notice } from "../components/ui";
import { game } from "../data/catalog";
import { range } from "../lib/format";
import { PLACE_LABEL } from "../lib/nav";

// Séance basket : la liste des jeux du jour, chacun lancé en vue caméra.
export default function BasketSession() {
  const { id } = useParams();
  const { events, profile } = useApp();
  const nav = useNavigate();
  const e = events.find((x) => x.id === id);
  if (!e) return <main className="pb-page screen no-nav"><div className="hdr"><BackButton /></div><Notice>Séance introuvable.</Notice></main>;
  const shoot = e.payload.mode === "shoot";
  const games = (e.payload.games ?? []).map(game).filter(Boolean);
  // chaque jeu s'ouvre selon son type (une séance d'ambidextrie mélange dribble et finition)
  const open = (g: string) => nav(game(g)?.mode === "shoot" ? `/shoot?event=${e.id}&jeu=${g}` : `/dribble/${g}?event=${e.id}`);
  const homeNoHoop = shoot && e.location === "maison" && !profile?.has_hoop;
  return (
    <main className="pb-page screen no-nav">
      <div className="hdr"><BackButton /></div>
      <h1 className="t" style={{ margin: "18px 0 6px" }}>{e.title}</h1>
      <p className="lead">{PLACE_LABEL[e.location ?? ""] ?? ""} · {range(e.start_min, e.end_min)} · {games.length} jeux</p>
      <div style={{ marginTop: 16 }}>
        <Notice>Pose le téléphone {shoot ? "sur un trépied face au panier" : "au sol ou sur un trépied, à 2–3 m"}. Un écran de calibrage vérifie le cadrage avant de commencer.</Notice>
      </div>
      {homeNoHoop ? <div style={{ marginTop: 10 }}><Notice tone="error">Pas de panier à la maison : fais cette séance sur un terrain.</Notice></div> : null}
      <div className="lbl section">Jeux du jour</div>
      <div className="pb-glass" style={{ padding: "4px 0" }}>
        {games.map((g, i) => (
          <button key={g!.id} className="pb-li" onClick={() => open(g!.id)}>
            <div className="pb-tile" style={{ width: 44, height: 44, color: "var(--cat-basket)" }}><b className="pb-num" style={{ fontSize: 18 }}>{i + 1}</b></div>
            <div className="t">{g!.name}<small>{g!.minutes} min · {g!.desc}</small></div>
            <Icon name="play" size="sm" className="pb-muted" />
          </button>
        ))}
      </div>
      <BottomAction>
        <button className="pb-btn primary lg block" onClick={() => open(games[0]!.id)}><Icon name="video" size="sm" />Lancer le premier jeu</button>
      </BottomAction>
    </main>
  );
}

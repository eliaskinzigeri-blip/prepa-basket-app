import { memo, useState } from "react";

// Les GIF du dataset (© Gym visual) ne sont pas sous licence libre : photos du domaine public ou silhouette maison.
const POSES: Record<string, { anim: string; d: string }> = {
  saut: { anim: "jump", d: "M100 44v42M100 56l-26-16M100 56l26-16M100 86l-22 22 6 30M100 86l22 22-6 30" },
  squat: { anim: "squat", d: "M100 44v42M100 56l-30 10M100 56l30 10M100 86l-22 22 6 30M100 86l22 22-6 30" },
  fente: { anim: "squat", d: "M100 44v42M100 56l-20 22M100 56l20 22M100 86l-30 18 -4 34M100 86l24 26 14 26" },
  plank: { anim: "hold", d: "M40 110h100M140 110l14 26M40 110l-8 28M60 110v28" },
  push: { anim: "push", d: "M50 112l110-14M160 98l8 40M70 110l-6 28M70 110l0 28" },
  pull: { anim: "pull", d: "M60 18h80M100 44v42M100 56l-24-30M100 56l24-30M100 86l-12 30 0 22M100 86l12 30 0 22" },
  lateral: { anim: "slide", d: "M100 44v42M100 56l-26 16M100 56l26 16M100 86l-30 22 -6 30M100 86l30 22 6 30" },
};
const PATTERN_POSE: Record<string, keyof typeof POSES> = {
  saut: "saut", squat: "squat", hanche: "squat", fente: "fente", ischios: "plank", mollet: "saut", mobilite: "squat", cheville: "saut",
  gainage: "plank", lateral_core: "plank", antirotation: "squat", poussee: "push", tirage: "pull", epaules: "pull", lateral: "lateral", cardio: "saut",
};

/**
 * Photos départ / arrivée de free-exercise-db (domaine public), enchaînées en fondu pour montrer le mouvement.
 * Sans photo, silhouette animée selon le schéma de mouvement.
 */
export const ExerciseAnim = memo(function ExerciseAnim({ pattern, photo, name, anim, video }: { pattern: string; photo?: string; name?: string; anim?: string; video?: { id: string; title: string; author: string } }) {
  if (video) return <VideoDemo video={video} />;
  if (anim === "rotation_planche" || anim === "pompe_rotation") return <SidePlankRotation push={anim === "pompe_rotation"} name={name} />;
  if (anim === "clean_kettlebell") return <KettlebellClean name={name} />;
  if (photo) {
    // key : nouvel exercice = nouvelles images et fondu reparti du début (sinon l'arrivée de l'exercice d'avant reste affichée)
    return (
      <div key={photo} className="ex-photos" role="img" aria-label={`${name ?? "Exercice"} : position de départ, puis d'arrivée`}>
        <img src={`/exercises/${photo}-0.webp`} alt="" width={480} height={320} decoding="async" />
        <img className="end" src={`/exercises/${photo}-1.webp`} alt="" width={480} height={320} decoding="async" />
      </div>
    );
  }
  const pose = POSES[PATTERN_POSE[pattern] ?? "squat"];
  const isFlat = pose.anim === "hold" || pose.anim === "push";
  return (
    <div className={`anim-figure anim-${pose.anim}`} aria-hidden="true">
      <svg viewBox="0 0 200 160" width="100%" height="100%" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <g className="body">
          {isFlat ? <circle cx={pose.anim === "push" ? 40 : 30} cy={pose.anim === "push" ? 104 : 100} r="11" fill="#fff" stroke="none" /> : <circle cx="100" cy="30" r="12" fill="#fff" stroke="none" />}
          <path d={pose.d} />
        </g>
        <path d="M30 150h140" stroke="rgba(255,255,255,.25)" strokeWidth="3" />
      </svg>
    </div>
  );
});

// Rotation en planche latérale, vue de profil : planche haute (pompe si push), puis le bras libre monte vers le plafond.
// Aucune photo libre ne montre ce mouvement. Animation SMIL (chemins à même structure), lue aussi par Safari iOS.
const KEY_TIMES = "0;0.15;0.3;0.42;0.55;0.75;0.87;1";
const HIGH = { body: "M30 138L85 118L140 98", head: 88, support: "M140 98L140 118L140 138", free: "M140 98L142 118L144 138" };
const DIP = { body: "M30 138L85 127L140 116", head: 106, support: "M140 116L126 128L140 138", free: "M140 116L128 128L144 138" };
const SIDE = "M140 98L159 92L178 86";
const UP = "M140 98L140 75L140 52";

function SidePlankRotation({ push, name }: { push: boolean; name?: string }) {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const low = push ? DIP : HIGH;
  const frames = (k: "body" | "support" | "free") => [HIGH[k], low[k], HIGH[k], k === "free" ? SIDE : HIGH[k], k === "free" ? UP : HIGH[k], k === "free" ? UP : HIGH[k], k === "free" ? SIDE : HIGH[k], HIGH[k]].join(";");
  const anim = (k: "body" | "support" | "free") =>
    reduced ? null : <animate attributeName="d" dur="4s" repeatCount="indefinite" calcMode="spline" keyTimes={KEY_TIMES} keySplines={Array(7).fill(".45 0 .55 1").join(";")} values={frames(k)} />;
  return (
    <div className="anim-figure anim-static" role="img" aria-label={`${name ?? "Exercice"} : ${push ? "pompe, puis " : "planche haute, puis "}rotation en planche latérale, bras vers le plafond`}>
      <svg viewBox="0 0 200 160" width="100%" height="100%" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d={HIGH.support} stroke="rgba(255,255,255,.55)">{anim("support")}</path>
        <path d={HIGH.body}>{anim("body")}</path>
        <circle cx="157" cy={HIGH.head} r="11" fill="#fff" stroke="none">
          {reduced ? null : <animate attributeName="cy" dur="4s" repeatCount="indefinite" calcMode="spline" keyTimes={KEY_TIMES} keySplines={Array(7).fill(".45 0 .55 1").join(";")} values={[HIGH.head, low.head, HIGH.head, HIGH.head, HIGH.head, HIGH.head, HIGH.head, HIGH.head].join(";")} />}
        </circle>
        <path d={reduced ? UP : HIGH.free} stroke="var(--primary-bright)">{anim("free")}</path>
        <path d="M20 143h160" stroke="rgba(255,255,255,.25)" strokeWidth="3" />
      </svg>
    </div>
  );
}

// Kettlebell clean à un bras, vue de profil : kettlebell entre les pieds (hanches en arrière), extension des hanches,
// réception contre l'épaule (coude collé au buste), puis retour. Les photos libres ne montrent pas la réception.
const CLEAN_TIMES = "0;0.28;0.42;0.72;1";
const SPLINES = Array(4).fill(".45 0 .55 1").join(";");
const CLEAN = {
  //            cheville → genou → hanche → épaule        épaule → coude → main         tête       kettlebell
  hinge: { body: "M100 142L110 118L84 100L126 72", arm: "M126 72L127 92L127 112", head: [140, 62], kb: [127, 121] },
  pull: { body: "M100 142L102 118L98 92L104 56", arm: "M104 56L118 72L124 82", head: [110, 42], kb: [128, 90] },
  rack: { body: "M100 142L100 118L98 90L100 54", arm: "M100 54L110 80L116 60", head: [106, 40], kb: [124, 62] },
};
const cleanSeq = <T,>(k: (p: typeof CLEAN.hinge) => T) => [CLEAN.hinge, CLEAN.pull, CLEAN.rack, CLEAN.rack, CLEAN.hinge].map(k);

function KettlebellClean({ name }: { name?: string }) {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const a = (attr: string, values: (string | number)[]) =>
    reduced ? null : <animate attributeName={attr} dur="3.2s" repeatCount="indefinite" calcMode="spline" keyTimes={CLEAN_TIMES} keySplines={SPLINES} values={values.join(";")} />;
  const end = reduced ? CLEAN.rack : CLEAN.hinge;
  return (
    <div className="anim-figure anim-static" role="img" aria-label={`${name ?? "Exercice"} : kettlebell entre les pieds, extension des hanches, puis réception contre l'épaule`}>
      <svg viewBox="0 0 200 160" width="100%" height="100%" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d={end.body}>{a("d", cleanSeq((p) => p.body))}</path>
        <circle cx={end.head[0]} cy={end.head[1]} r="11" fill="#fff" stroke="none">{a("cx", cleanSeq((p) => p.head[0]))}{a("cy", cleanSeq((p) => p.head[1]))}</circle>
        <path d={end.arm} stroke="var(--primary-bright)">{a("d", cleanSeq((p) => p.arm))}</path>
        <circle cx={end.kb[0]} cy={end.kb[1]} r="8" fill="var(--heat, #ff8a3d)" stroke="none">{a("cx", cleanSeq((p) => p.kb[0]))}{a("cy", cleanSeq((p) => p.kb[1]))}</circle>
        <path d="M40 145h120" stroke="rgba(255,255,255,.25)" strokeWidth="3" />
      </svg>
    </div>
  );
}

// Vidéo YouTube chargée seulement au toucher (miniature d'abord) : rien ne pèse sur la séance tant qu'on ne la lance pas.
function VideoDemo({ video }: { video: { id: string; title: string; author: string } }) {
  const [on, setOn] = useState(false);
  if (on) {
    return (
      <iframe className="ex-video" src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&playsinline=1&rel=0`} title={`${video.title} (${video.author})`}
        allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
    );
  }
  return (
    <button className="ex-video ex-video-cover" onClick={() => setOn(true)} aria-label={`Lire la vidéo : ${video.title}, par ${video.author}`}>
      <img src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" width={480} height={360} loading="lazy" decoding="async" />
      <span className="ex-video-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M8 5v14l11-7z" /></svg></span>
      <span className="ex-video-credit">Vidéo · {video.author}</span>
    </button>
  );
}

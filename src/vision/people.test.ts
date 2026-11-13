// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clothesSig, PeopleTracker, type Seen } from "./people";
import { forgetFace, knownPeople, ME, recognize, rememberPerson } from "../lib/people";
import { identity, type Card } from "../screens/camera/ShootGroup";

const RED = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const BLUE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
const at = (x: number, sig: number[], wrist = true): Seen => ({
  box: { x0: x - 0.06, y0: 0.3, x1: x + 0.06, y1: 0.9 },
  wrists: wrist ? [{ x: x + 0.04, y: 0.45 }] : [],
  sig,
});
const face = (v: number, q = 0.8) => ({ descriptor: Array.from({ length: 128 }, (_, i) => (i === 0 ? v : 0)), photo: `photo-${v}`, quality: q });

describe("qui a tiré", () => {
  it("donne chaque tir au joueur qui tenait le ballon au lâcher", () => {
    const P = new PeopleTracker();
    let ids: number[] = [];
    for (let t = 0; t <= 2000; t += 100) ids = P.update(t, [at(0.25, RED), at(0.7, BLUE)]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(P.shooterAt(1500, 0.29, 0.45)).toBe(ids[0]);
    expect(P.shooterAt(1500, 0.74, 0.44)).toBe(ids[1]);
    // pas de poignet visible : le joueur dont le corps est le plus près
    expect(P.shooterAt(1500, 0.68, 0.6)).toBe(ids[1]);
    // personne dans le cadre à ce moment-là
    expect(P.shooterAt(9000, 0.5, 0.5)).toBeNull();
  });
  it("suit les joueurs qui se croisent grâce à la couleur de leurs habits", () => {
    const P = new PeopleTracker();
    const first = P.update(0, [at(0.4, RED), at(0.6, BLUE)]);
    let ids = first;
    for (let t = 100, k = 0; k < 10; t += 100, k++) ids = P.update(t, [at(0.4 + k * 0.02, RED), at(0.6 - k * 0.02, BLUE)]);
    expect(ids).toEqual(first);
  });
});

describe("regroupement en personnes", () => {
  it("un joueur sorti puis revenu dans le cadre reste une seule personne (même visage)", () => {
    const P = new PeopleTracker();
    const [a] = P.update(0, [at(0.3, RED)]);
    P.addFace(a, face(0.1));
    P.update(500, [at(0.3, RED)]);
    const [b] = P.update(5000, [at(0.7, BLUE)]); // habits différents (veste enlevée) mais même visage
    P.addFace(b, face(0.12));
    P.update(5500, [at(0.7, BLUE)]);
    expect(a).not.toBe(b);
    const people = P.people([a, b, b]);
    expect(people).toHaveLength(1);
    expect(people[0].shots).toEqual([0, 1, 2]);
    expect(people[0].face?.photo).toBe("photo-0.1");
  });
  it("mêmes habits mais jamais vus en même temps : même personne", () => {
    const P = new PeopleTracker();
    const [a] = P.update(0, [at(0.3, RED)]);
    P.update(400, [at(0.3, RED)]);
    const [b] = P.update(4000, [at(0.8, RED)]);
    expect(P.people([a, b])).toHaveLength(1);
  });
  it("deux joueurs vus ensemble ne sont jamais fusionnés, même habillés pareil", () => {
    const P = new PeopleTracker();
    let ids: number[] = [];
    for (let t = 0; t <= 1000; t += 100) ids = P.update(t, [at(0.25, RED), at(0.75, RED)]);
    const people = P.people([ids[0], ids[1], ids[0]]);
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.shots)).toEqual([[0, 2], [1]]);
  });
  it("deux visages différents ne sont pas fusionnés sur les seuls habits", () => {
    const P = new PeopleTracker();
    const [a] = P.update(0, [at(0.3, RED)]);
    P.addFace(a, face(0.1));
    const [b] = P.update(4000, [at(0.3, RED)]);
    P.addFace(b, face(0.9));
    expect(P.people([a, b])).toHaveLength(2);
  });
  it("habits : rouge et bleu sont distingués", () => {
    const px = (r: number, g: number, b: number) => new Uint8ClampedArray(Array.from({ length: 40 }, () => [r, g, b, 255]).flat());
    const red = clothesSig(px(220, 30, 30))!, blue = clothesSig(px(30, 40, 220))!;
    expect(red.indexOf(Math.max(...red))).not.toBe(blue.indexOf(Math.max(...blue)));
  });
});

describe("personnes connues", () => {
  beforeEach(() => localStorage.clear());
  it("reconnaît une personne déjà nommée, mais seulement si son visage a été gardé", () => {
    rememberPerson("u", { key: "leo", name: "Léo", faces: { descriptors: [face(0.1).descriptor], photo: "p" } });
    rememberPerson("u", { key: "sam", name: "Sam", faces: null });
    expect(recognize("u", [face(0.15).descriptor])?.person.name).toBe("Léo");
    expect(recognize("u", [face(0.9).descriptor])).toBeNull();
    forgetFace("u", "leo");
    expect(recognize("u", [face(0.1).descriptor])).toBeNull();
    expect(knownPeople("u").map((p) => p.name)).toEqual(["Léo", "Sam"]);
  });
  it("un prénom déjà connu reprend la même personne, accents et majuscules ignorés", () => {
    const names = new Map([["leo", "Léo"]]);
    const card: Card = { photo: null, descriptors: [], shots: [0], made: 1, attempts: 1, guess: null, guessOk: null, answer: "other", name: " leo ", consent: false };
    expect(identity(card, names)).toEqual({ key: "leo", name: "Léo" });
    expect(identity({ ...card, name: "Inès" }, names)?.key).toBe("new:inès");
    expect(identity({ ...card, answer: "me" }, names)?.key).toBe(ME);
    expect(identity({ ...card, guess: { key: "sam", name: "Sam" }, guessOk: true }, names)?.name).toBe("Sam");
    expect(identity({ ...card, answer: null }, names)).toBeNull();
  });
});

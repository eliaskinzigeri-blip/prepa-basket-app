// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupReview, type Card } from "./ShootGroup";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));
afterEach(cleanup);

const base: Card = { photo: "data:image/jpeg;base64,", descriptors: [[0.1]], shots: [0, 2], made: 1, attempts: 2, guess: null, guessOk: null, answer: null, name: "", consent: false };

function Harness({ start, onSave }: { start: Card[]; onSave: (c: Card[]) => void }) {
  const [cards, setCards] = useState(start);
  return <GroupReview cards={cards} names={new Map([["leo", "Léo"]])} saving={false} onSave={() => onSave(cards)}
    onChange={(i, c) => setCards((l) => l.map((x, k) => (k === i ? { ...x, ...c } : x)))} />;
}

describe("fin du shoot à plusieurs", () => {
  it("montre chaque visage, propose la personne reconnue et demande qui est l'autre", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} start={[{ ...base, guess: { key: "leo", name: "Léo" }, consent: true }, { ...base, shots: [1], made: 1, attempts: 1 }]} />);
    expect(screen.getByText("2 joueurs repérés")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("Probablement Léo ?")).toBeTruthy();
    const save = () => screen.getByRole("button", { name: /Dis qui est chaque joueur|Valider/ }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByText("Oui, c'est Léo"));
    fireEvent.click(screen.getByText("C'est moi"));
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalled();
  });
  it("« Non » : on tape un prénom, et un prénom déjà connu est reconnu", () => {
    render(<Harness onSave={() => undefined} start={[{ ...base, guess: { key: "me", name: "Moi" } }]} />);
    expect(screen.getByText("Probablement toi ?")).toBeTruthy();
    fireEvent.click(screen.getByText("Non"));
    fireEvent.click(screen.getByText("Une autre personne"));
    fireEvent.change(screen.getByLabelText("Son prénom"), { target: { value: "leo" } });
    expect(screen.getByText(/Déjà vu dans une ancienne session/)).toBeTruthy();
    // accord demandé avant de garder son visage
    expect(screen.getByRole("switch", { name: /Léo est d'accord/ }).getAttribute("aria-checked")).toBe("false");
  });
});

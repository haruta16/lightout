import { describe, expect, it } from "vitest";
import { dispatch } from "@lightout/engine";
import {
  compilePuzzleDesign,
  createPuzzleDesign,
  createStandardRegistry,
} from "@lightout/mechanics-standard";
import { solvePuzzle } from "../src";

describe("GF(2) solver", () => {
  it("solves a generated classic board through the public engine API", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = compilePuzzleDesign(createPuzzleDesign({
      size: 5,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 20260715,
    }));
    const solution = solvePuzzle(initialState, ruleset, registry);
    expect(solution.status).toBe("solved");
    let state = initialState;
    for (const anchorEntityId of solution.presses) {
      state = dispatch(state, { type: "activate", anchorEntityId }, ruleset, registry).state;
    }
    expect(state.status).toBe("won");
  });

  it("declines binary actions that do not actually toggle state", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = compilePuzzleDesign(createPuzzleDesign({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 4,
    }));
    const nonToggleRuleset = {
      ...ruleset,
      actions: ruleset.actions.map((action) => action.commandType === "activate"
        ? { ...action, effects: [{ type: "set-channel", params: { channel: "power", value: 1 } }] }
        : action),
    };
    const result = solvePuzzle(initialState, nonToggleRuleset, registry);
    expect(result.status).toBe("unsupported");
    expect(result.presses).toEqual([]);
  });

  it("does not describe an unsolvable board as having a minimal solution", () => {
    const registry = createStandardRegistry();
    const design = createPuzzleDesign({ size: 2, stateCount: 2, defaultInfluence: "diagonal", seed: 1 });
    for (const cell of Object.values(design.cells)) cell.initial = { power: 0 };
    design.cells["n:0:0"]!.initial = { power: 1 };
    const { initialState, ruleset } = compilePuzzleDesign(design);
    const result = solvePuzzle(initialState, ruleset, registry);
    expect(result.status).toBe("unsolvable");
    expect(result.minimal).toBe(false);
  });
});

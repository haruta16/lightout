import { describe, expect, it } from "vitest";
import { dispatch } from "@lightout/engine";
import {
  createExperiment,
  createStandardRegistry,
} from "@lightout/mechanics-standard";
import { solveBinaryToggle } from "../src";

describe("GF(2) solver", () => {
  it("solves a generated classic board through the public engine API", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 5,
      stateCount: 2,
      goalValue: 0,
      influence: "cross",
      boardShape: "full",
      seed: 20260715,
    });
    const solution = solveBinaryToggle(initialState, ruleset, registry);
    expect(solution.status).toBe("solved");
    let state = initialState;
    for (const anchorEntityId of solution.presses) {
      state = dispatch(
        state,
        { type: "activate", anchorEntityId },
        ruleset,
        registry,
      ).state;
    }
    expect(state.status).toBe("won");
  });

  it("declines unsupported multi-state experiments explicitly", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 3,
      goalValue: 0,
      influence: "cross",
      boardShape: "full",
      seed: 1,
    });
    expect(solveBinaryToggle(initialState, ruleset, registry).status).toBe(
      "unsupported",
    );
  });
});

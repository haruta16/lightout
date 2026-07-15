import { describe, expect, it } from "vitest";
import {
  commitHistory,
  createHistory,
  dispatch,
  redoHistory,
  stableStateKey,
  undoHistory,
  validateGameState,
} from "@lightout/engine";
import { createExperiment, createStandardRegistry } from "../src";

describe("headless engine with standard mechanics", () => {
  it("restores a binary state when the same switch is activated twice", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 5,
      stateCount: 2,
      goalValue: 0,
      influence: "cross",
      boardShape: "full",
      seed: 42,
    });
    const anchorEntityId = Object.keys(initialState.entities)[0];
    const before = stableStateKey(initialState);
    const once = dispatch(
      initialState,
      { type: "activate", anchorEntityId },
      ruleset,
      registry,
    );
    const twice = dispatch(
      once.state,
      { type: "activate", anchorEntityId },
      ruleset,
      registry,
    );
    expect(once.accepted).toBe(true);
    expect(stableStateKey(twice.state)).toBe(before);
  });

  it("keeps undo and redo as snapshots independent of render events", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 2,
      goalValue: 0,
      influence: "cross",
      boardShape: "full",
      seed: 9,
    });
    const anchorEntityId = Object.keys(initialState.entities)[0];
    const result = dispatch(
      initialState,
      { type: "activate", anchorEntityId },
      ruleset,
      registry,
    );
    const committed = commitHistory(createHistory(initialState), result.state);
    const undone = undoHistory(committed);
    const redone = redoHistory(undone);
    expect(stableStateKey(undone.present)).toBe(stableStateKey(initialState));
    expect(stableStateKey(redone.present)).toBe(stableStateKey(result.state));
  });

  it("rejects channel values outside the ruleset schema", () => {
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 2,
      goalValue: 0,
      influence: "cross",
      boardShape: "full",
      seed: 3,
    });
    const first = Object.values(initialState.entities)[0];
    expect(first).toBeDefined();
    if (first) first.channels.power = 4;
    expect(validateGameState(initialState, ruleset)).toContain(
      `Entity ${first?.id} has invalid channel value: power`,
    );
  });
});

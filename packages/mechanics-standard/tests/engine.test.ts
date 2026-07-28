import { describe, expect, it } from "vitest";
import {
  applyMutations,
  commitHistory,
  createHistory,
  dispatch,
  evaluateState,
  redoHistory,
  stableEntityStateKey,
  undoHistory,
  validateGameState,
  type GameState,
  type Ruleset,
} from "@lightout/engine";
import {
  compilePuzzleDesign,
  createHexTopology,
  createPuzzleDesign,
  createRectTopology,
  createStandardRegistry,
  createTriangleTopology,
  influenceTargetsForAnchor,
  supportedInfluencesFor,
  type PuzzleDesign,
} from "../src";

function explicitZeroes(design: PuzzleDesign): PuzzleDesign {
  const next = structuredClone(design) as PuzzleDesign;
  for (const cell of Object.values(next.cells)) cell.initial = { power: 0 };
  return next;
}

describe("headless engine with cell-property puzzles", () => {
  it("keeps square, hex, and triangle topology semantics independent of display coordinates", () => {
    const square = createRectTopology({ width: 3, height: 3 });
    const hex = createHexTopology({ width: 3, height: 3 });
    const triangle = createTriangleTopology({ width: 3, height: 3 });

    expect(square.edges.filter((edge) => edge.from === "n:1:1" && edge.relation === "adjacent")).toHaveLength(8);
    expect(square.edges.find((edge) => edge.from === "n:1:1" && edge.relation === "direction:north")?.to).toBe("n:1:0");
    expect(hex.edges.filter((edge) => edge.from === "n:1:1" && edge.relation === "adjacent")).toHaveLength(6);
    expect(triangle.edges.filter((edge) => edge.from === "n:1:1" && edge.relation === "adjacent")).toHaveLength(3);
    expect(supportedInfluencesFor("square")).toEqual(["cross", "diagonal", "king", "neighbors", "row-column"]);
    expect(supportedInfluencesFor("hex")).toEqual(["neighbors"]);
    expect(supportedInfluencesFor("triangle")).toEqual(["neighbors"]);
  });

  it.each([["hex", 7], ["triangle", 4]] as const)("uses the complete %s neighborhood", (geometry, changedCount) => {
    const design = explicitZeroes(createPuzzleDesign({ size: 3, geometry, stateCount: 3, defaultInfluence: "neighbors", seed: 15 }));
    const { initialState, ruleset } = compilePuzzleDesign(design);
    const result = dispatch(initialState, { type: "activate", anchorEntityId: "cell:n:1:1" }, ruleset, createStandardRegistry());
    expect(result.events.filter((event) => event.type === "channel-changed")).toHaveLength(changedCount);
  });

  it("supports a pure switch that changes powered neighbors without owning power", () => {
    const design = explicitZeroes(createPuzzleDesign({ size: 3, stateCount: 2, defaultInfluence: "cross", seed: 1 }));
    design.cells["n:1:1"]!.properties = { hasPower: false, activatable: true };
    design.cells["n:1:1"]!.goal = undefined;
    const { initialState, ruleset } = compilePuzzleDesign(design);
    const anchor = initialState.entities["cell:n:1:1"]!;
    const result = dispatch(initialState, { type: "activate", anchorEntityId: anchor.id }, ruleset, createStandardRegistry());

    expect(anchor.channels).not.toHaveProperty("power");
    expect(result.accepted).toBe(true);
    expect(result.events.filter((event) => event.type === "channel-changed")).toHaveLength(4);
    expect(result.state.entities[anchor.id]?.channels).not.toHaveProperty("power");
  });

  it("rejects a passive lamp as an action anchor while allowing it to be affected", () => {
    const design = explicitZeroes(createPuzzleDesign({ size: 3, stateCount: 2, defaultInfluence: "cross", seed: 1 }));
    design.cells["n:1:1"]!.properties = { hasPower: true, activatable: false };
    const { initialState, ruleset } = compilePuzzleDesign(design);
    const result = dispatch(initialState, { type: "activate", anchorEntityId: "cell:n:1:1" }, ruleset, createStandardRegistry());
    expect(result.accepted).toBe(false);
    expect(result.events).toContainEqual({ type: "command-rejected", reason: "no-valid-targets" });
  });

  it("rejects a cell without power or activation capability", () => {
    const design = createPuzzleDesign({ size: 2, stateCount: 2, defaultInfluence: "cross", seed: 1 });
    design.cells["n:0:0"]!.properties = { hasPower: false, activatable: false };

    expect(() => compilePuzzleDesign(design)).toThrow(
      "Cell n:0:0 must have power or activation capability",
    );
  });

  it("rejects roleless default cell capabilities", () => {
    const design = createPuzzleDesign({ size: 2, stateCount: 2, defaultInfluence: "cross", seed: 1 });
    design.rule.cellDefaults.hasPower = false;
    design.rule.cellDefaults.activatable = false;

    expect(() => compilePuzzleDesign(design)).toThrow(
      "Default cell must have power or activation capability",
    );
  });

  it("removes absent cells from runtime topology and stops row-column rays at the gap", () => {
    const design = explicitZeroes(createPuzzleDesign({ size: 5, stateCount: 2, defaultInfluence: "row-column", seed: 1 }));
    design.cells["n:2:1"]!.properties = { exists: false };
    const { initialState } = compilePuzzleDesign(design);
    const anchor = initialState.entities["cell:n:0:1"]!;
    const targets = influenceTargetsForAnchor(initialState, anchor);

    expect(initialState.board.nodes["n:2:1"]).toBeUndefined();
    expect(initialState.entities["cell:n:2:1"]).toBeUndefined();
    expect(targets).toContain("cell:n:1:1");
    expect(targets).not.toContain("cell:n:3:1");
    expect(targets).not.toContain("cell:n:4:1");
  });

  it("applies per-cell influence only when its property policy is enabled", () => {
    const uniform = explicitZeroes(createPuzzleDesign({ size: 3, stateCount: 2, defaultInfluence: "cross", seed: 1 }));
    uniform.cells["n:1:1"]!.properties = { influenceId: "king" };
    const perCell = structuredClone(uniform) as PuzzleDesign;
    perCell.rule.propertyPolicies.influenceId = "per-cell";

    expect(compilePuzzleDesign(uniform).initialState.entities["cell:n:1:1"]?.properties.influenceId).toBe("cross");
    expect(compilePuzzleDesign(perCell).initialState.entities["cell:n:1:1"]?.properties.influenceId).toBe("king");
  });

  it("evaluates arbitrary partial goal constraints without a sentinel channel", () => {
    const design = explicitZeroes(createPuzzleDesign({ size: 3, stateCount: 3, defaultInfluence: "cross", seed: 5 }));
    for (const cell of Object.values(design.cells)) cell.goal = undefined;
    design.cells["n:0:0"]!.initial = { power: 2 };
    design.cells["n:0:0"]!.goal = { power: { operator: "equals", value: 2 } };
    design.cells["n:1:1"]!.goal = { power: { operator: "equals", value: 0 } };
    design.cells["n:2:2"]!.initial = { power: 1 };
    const { initialState, ruleset } = compilePuzzleDesign(design);

    expect(initialState.entities["cell:n:2:2"]?.properties).not.toHaveProperty("goal");
    expect(evaluateState(initialState, ruleset, createStandardRegistry()).status).toBe("won");
    initialState.entities["cell:n:1:1"]!.channels.power = 1;
    expect(evaluateState(initialState, ruleset, createStandardRegistry()).status).toBe("playing");
  });

  it("restores a binary state when the same standard cell is activated twice", () => {
    const { initialState, ruleset } = compilePuzzleDesign(createPuzzleDesign({ size: 5, stateCount: 2, defaultInfluence: "cross", seed: 42 }));
    const registry = createStandardRegistry();
    const before = stableEntityStateKey(initialState);
    const once = dispatch(initialState, { type: "activate", anchorEntityId: "cell:n:0:0" }, ruleset, registry);
    const twice = dispatch(once.state, { type: "activate", anchorEntityId: "cell:n:0:0" }, ruleset, registry);
    expect(stableEntityStateKey(twice.state)).toBe(before);
  });

  it("keeps undo and redo as bounded runtime snapshots", () => {
    const { initialState, ruleset } = compilePuzzleDesign(createPuzzleDesign({ size: 3, stateCount: 2, defaultInfluence: "cross", seed: 9 }));
    const result = dispatch(initialState, { type: "activate", anchorEntityId: "cell:n:0:0" }, ruleset, createStandardRegistry());
    const committed = commitHistory(createHistory(initialState), result.state);
    expect(stableEntityStateKey(undoHistory(committed).present)).toBe(stableEntityStateKey(initialState));
    expect(stableEntityStateKey(redoHistory(undoHistory(committed)).present)).toBe(stableEntityStateKey(result.state));

    let history = createHistory(initialState);
    for (let turn = 1; turn <= 300; turn += 1) history = commitHistory(history, { ...history.present, turn });
    expect(history.past).toHaveLength(256);
  });

  it("validates static properties and optional state channels separately", () => {
    const { initialState, ruleset } = compilePuzzleDesign(createPuzzleDesign({ size: 3, stateCount: 2, defaultInfluence: "cross", seed: 3 }));
    const first = initialState.entities["cell:n:0:0"]!;
    first.channels.power = 4;
    expect(validateGameState(initialState, ruleset)).toContain(`Entity ${first.id} has invalid channel value: power`);
    first.channels.power = 0;
    first.properties.activatable = "yes";
    expect(validateGameState(initialState, ruleset)).toContain(`Entity ${first.id} has invalid property value: activatable`);
  });

  it("compiles declared custom properties without allowing them to shadow core capabilities", () => {
    const design = createPuzzleDesign({ size: 2, stateCount: 2, defaultInfluence: "cross", seed: 1 });
    design.rule.customPropertyDefinitions.locked = {
      id: "locked",
      label: "锁定",
      valueType: "boolean",
      defaultValue: false,
      affects: ["behavior"],
      editorLayer: "advanced",
    };
    design.cells["n:0:0"]!.properties = { custom: { locked: true } };
    const entity = compilePuzzleDesign(design).initialState.entities["cell:n:0:0"]!;
    expect(entity.properties.locked).toBe(true);
    expect(entity.properties.hasPower).toBe(true);

    design.rule.customPropertyDefinitions.hasPower = {
      id: "hasPower",
      label: "非法覆盖",
      valueType: "boolean",
      defaultValue: false,
      affects: ["behavior"],
      editorLayer: "advanced",
    };
    expect(() => compilePuzzleDesign(design)).toThrow("Invalid custom property definition: hasPower");
  });

  it("validates dangling node references without an entity schema", () => {
    const state: GameState = {
      schemaVersion: 1,
      board: { nodes: {}, edges: [] },
      entities: { cell: { id: "cell", kind: "custom", nodeId: "missing", tags: [], properties: {}, channels: {} } },
      counters: {}, inventory: {}, turn: 0, status: "playing", seed: 0,
    };
    const ruleset: Ruleset = { id: "schema-free", name: "Schema-free", actions: [], goals: [], settleSystems: [] };
    expect(validateGameState(state, ruleset)).toContain("Entity cell references unknown node: missing");
  });

  it("does not emit movement events for a no-op move", () => {
    const { initialState } = compilePuzzleDesign(createPuzzleDesign({ size: 2, stateCount: 2, defaultInfluence: "cross", seed: 1 }));
    const entity = initialState.entities["cell:n:0:0"]!;
    const result = applyMutations(initialState, [{ type: "move-entity", entityId: entity.id, toNodeId: entity.nodeId! }]);
    expect(result.events).toEqual([]);
  });
});

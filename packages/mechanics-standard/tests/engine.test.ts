import { describe, expect, it } from "vitest";
import {
  applyMutations,
  commitHistory,
  createHistory,
  dispatch,
  redoHistory,
  stableStateKey,
  undoHistory,
  validateGameState,
  type GameState,
  type Ruleset,
} from "@lightout/engine";
import {
  createExperiment,
  createHexTopology,
  createRectTopology,
  createTriangleTopology,
  createStandardRegistry,
  supportedInfluencesFor,
} from "../src";

describe("headless engine with standard mechanics", () => {
  it("models square, hex, and triangle neighborhoods independently from rendering", () => {
    const square = createRectTopology({ width: 3, height: 3 });
    const hex = createHexTopology({ width: 3, height: 3 });
    const triangle = createTriangleTopology({ width: 3, height: 3 });
    const squareNeighbors = square.edges.filter(
      (edge) => edge.from === "n:1:1" && edge.relation === "adjacent",
    );
    const hexNeighbors = hex.edges.filter(
      (edge) => edge.from === "n:1:1" && edge.relation === "adjacent",
    );
    const triangleNeighbors = triangle.edges.filter(
      (edge) => edge.from === "n:1:1" && edge.relation === "adjacent",
    );

    expect(squareNeighbors).toHaveLength(8);
    expect(hexNeighbors).toHaveLength(6);
    expect(triangleNeighbors).toHaveLength(3);
    expect(square.nodes["n:1:1"]?.tags).toContain("geometry:square");
    expect(hex.nodes["n:1:1"]?.tags).toContain("geometry:hex");
    expect(triangle.nodes["n:1:1"]?.tags).toContain("geometry:triangle");
    expect(supportedInfluencesFor("square")).toEqual([
      "cross",
      "diagonal",
      "king",
      "neighbors",
      "row-column",
    ]);
    expect(supportedInfluencesFor("hex")).toEqual(["neighbors"]);
    expect(supportedInfluencesFor("triangle")).toEqual(["neighbors"]);
  });

  it("uses all six adjacent hex nodes for the sixfold rule", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 3,
      goalValue: 0,
      influence: "neighbors",
      boardShape: "full",
      geometry: "hex",
      seed: 12,
    });

    const result = dispatch(
      initialState,
      { type: "activate", anchorEntityId: "light:n:1:1" },
      ruleset,
      registry,
    );
    const changed = result.events.filter((event) => event.type === "channel-changed");
    expect(changed).toHaveLength(7);
  });

  it("uses all three edge-adjacent nodes for the triangle rule", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 3,
      goalValue: 0,
      influence: "neighbors",
      boardShape: "full",
      geometry: "triangle",
      seed: 15,
    });

    const result = dispatch(
      initialState,
      { type: "activate", anchorEntityId: "light:n:1:1" },
      ruleset,
      registry,
    );
    const changed = result.events.filter((event) => event.type === "channel-changed");
    expect(changed).toHaveLength(4);
  });

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

  it("validates dangling node references without an entity schema", () => {
    const state: GameState = {
      schemaVersion: 1,
      board: { nodes: {}, edges: [] },
      entities: {
        light: {
          id: "light",
          kind: "custom",
          nodeId: "missing",
          tags: [],
          channels: {},
        },
      },
      counters: {},
      inventory: {},
      turn: 0,
      status: "playing",
      seed: 0,
    };
    const ruleset: Ruleset = {
      id: "schema-free",
      name: "Schema-free ruleset",
      actions: [],
      goals: [],
      settleSystems: [],
    };

    expect(validateGameState(state, ruleset)).toContain(
      "Entity light references unknown node: missing",
    );
  });

  it("does not emit movement events for a no-op move", () => {
    const { initialState } = createExperiment({
      size: 2,
      stateCount: 2,
      goalValue: 0,
      influence: "cross",
      boardShape: "full",
      seed: 1,
    });
    const entity = Object.values(initialState.entities)[0];
    expect(entity?.nodeId).toBeDefined();
    if (!entity?.nodeId) return;

    const result = applyMutations(initialState, [
      { type: "move-entity", entityId: entity.id, toNodeId: entity.nodeId },
    ]);
    expect(result.events).toEqual([]);
    expect(result.state.entities[entity.id]?.nodeId).toBe(entity.nodeId);
  });

  it("keeps entity order stable while gravity settles downward", () => {
    const registry = createStandardRegistry();
    const gravity = registry.systems.get("gravity-down");
    const board = createRectTopology({ width: 1, height: 3 });
    const state: GameState = {
      schemaVersion: 1,
      board,
      entities: {
        top: {
          id: "top",
          kind: "light",
          nodeId: "n:0:0",
          tags: [],
          channels: { power: 0 },
        },
        bottom: {
          id: "bottom",
          kind: "light",
          nodeId: "n:0:1",
          tags: [],
          channels: { power: 1 },
        },
      },
      counters: {},
      inventory: {},
      turn: 0,
      status: "playing",
      seed: 0,
    };

    expect(gravity).toBeDefined();
    expect(
      gravity?.({
        state,
        definition: { type: "gravity-down", params: {} },
        iteration: 0,
      }),
    ).toEqual([
      { type: "move-entity", entityId: "bottom", toNodeId: "n:0:2" },
      { type: "move-entity", entityId: "top", toNodeId: "n:0:1" },
    ]);
  });

  it("never emits an already-completed generated board as playing", () => {
    const { initialState } = createExperiment({
      size: 2,
      stateCount: 2,
      goalValue: 0,
      influence: "diagonal",
      boardShape: "full",
      seed: 2,
    });

    expect(initialState.status).toBe("playing");
    expect(
      Object.values(initialState.entities).some(
        (entity) => entity.channels.power !== 0,
      ),
    ).toBe(true);
  });
});

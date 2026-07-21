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
  createExperiment,
  createHexTopology,
  createRectTopology,
  createStandardRegistry,
  createTriangleTopology,
  influenceTargetsForAnchor,
  supportedInfluencesFor,
} from "../src";

describe("headless engine with standard mechanics", () => {
  it("keeps square, hex, and triangle topologies while removing shape clipping", () => {
    const square = createRectTopology({ width: 3, height: 3 });
    const hex = createHexTopology({ width: 3, height: 3 });
    const triangle = createTriangleTopology({ width: 3, height: 3 });
    const squareNeighbors = square.edges.filter(
      (edge) => edge.from === "n:1:1" && edge.relation === "adjacent",
    );
    const squareOrthogonal = square.edges
      .filter((edge) => edge.from === "n:1:1" && edge.relation === "orthogonal")
      .map((edge) => edge.to)
      .sort();
    const hexNeighbors = hex.edges.filter(
      (edge) => edge.from === "n:1:1" && edge.relation === "adjacent",
    );
    const triangleNeighbors = triangle.edges.filter(
      (edge) => edge.from === "n:1:1" && edge.relation === "adjacent",
    );

    expect(squareNeighbors).toHaveLength(8);
    expect(squareOrthogonal).toEqual(["n:0:1", "n:1:0", "n:1:2", "n:2:1"]);
    expect(hexNeighbors).toHaveLength(6);
    expect(triangleNeighbors).toHaveLength(3);
    expect(Object.keys(square.nodes)).toHaveLength(9);
    expect(Object.keys(hex.nodes)).toHaveLength(9);
    expect(Object.keys(triangle.nodes)).toHaveLength(9);
    expect(square.nodes["n:1:1"]?.tags).toContain("geometry:square");
    expect(hex.nodes["n:1:1"]?.tags).toContain("geometry:hex");
    expect(triangle.nodes["n:1:1"]?.tags).toContain("geometry:triangle");
    expect(supportedInfluencesFor("square")).toEqual(["cross", "diagonal", "king", "neighbors", "row-column"]);
    expect(supportedInfluencesFor("hex")).toEqual(["neighbors"]);
    expect(supportedInfluencesFor("triangle")).toEqual(["neighbors"]);
  });

  it.each([
    ["hex", 7],
    ["triangle", 4],
  ] as const)("uses the complete %s neighborhood", (geometry, changedCount) => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      geometry,
      stateCount: 3,
      defaultInfluence: "neighbors",
      seed: 15,
    });
    const result = dispatch(
      initialState,
      { type: "activate", anchorEntityId: "light:n:1:1" },
      ruleset,
      registry,
    );
    expect(result.events.filter((event) => event.type === "channel-changed")).toHaveLength(changedCount);
  });

  it("lets neighboring cells use different influence mechanics", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 3,
      defaultInfluence: "cross",
      compositeInfluence: true,
      influenceOverrides: { "n:1:1": "king", "n:0:0": "diagonal" },
      seed: 12,
    });

    const center = dispatch(
      initialState,
      { type: "activate", anchorEntityId: "light:n:1:1" },
      ruleset,
      registry,
    );
    const corner = dispatch(
      initialState,
      { type: "activate", anchorEntityId: "light:n:0:0" },
      ruleset,
      registry,
    );
    expect(center.events.filter((event) => event.type === "channel-changed")).toHaveLength(9);
    expect(corner.events.filter((event) => event.type === "channel-changed")).toHaveLength(2);
  });

  it("uses the shared topology resolver for cross and row-column influences", () => {
    const { initialState } = createExperiment({
      size: 4,
      stateCount: 2,
      defaultInfluence: "cross",
      compositeInfluence: true,
      influenceOverrides: { "n:1:1": "row-column" },
      initialValues: {},
      seed: 1,
    });
    const rowColumnAnchor = initialState.entities["light:n:1:1"];
    const crossAnchor = initialState.entities["light:n:2:2"];

    expect(rowColumnAnchor).toBeDefined();
    expect(crossAnchor).toBeDefined();
    if (!rowColumnAnchor || !crossAnchor) return;

    expect(influenceTargetsForAnchor(initialState, rowColumnAnchor)).toHaveLength(7);
    expect(influenceTargetsForAnchor(initialState, crossAnchor)).toHaveLength(5);
  });

  it("ignores per-cell overrides until composite influence is enabled", () => {
    const uniform = createExperiment({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
      influenceOverrides: { "n:1:1": "king" },
      initialValues: {},
      seed: 1,
    });
    const composite = createExperiment({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
      compositeInfluence: true,
      influenceOverrides: { "n:1:1": "king" },
      initialValues: {},
      seed: 1,
    });

    expect(uniform.initialState.entities["light:n:1:1"]?.channels.influence).toBe("cross");
    expect(composite.initialState.entities["light:n:1:1"]?.channels.influence).toBe("king");
  });

  it("evaluates arbitrary and partial per-cell goal constraints", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 3,
      defaultInfluence: "cross",
      initialValues: { "n:0:0": 2, "n:2:2": 1 },
      goalValues: { "n:0:0": 2, "n:1:1": 0 },
      seed: 5,
    });
    expect(initialState.entities["light:n:2:2"]?.channels.goal).toBe(-1);
    expect(evaluateState(initialState, ruleset, registry).status).toBe("won");

    initialState.entities["light:n:1:1"]!.channels.power = 1;
    expect(evaluateState(initialState, ruleset, registry).status).toBe("playing");
  });

  it("restores a binary state when the same switch is activated twice", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 5,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 42,
    });
    const anchorEntityId = Object.keys(initialState.entities)[0];
    const before = stableEntityStateKey(initialState);
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
    expect(stableEntityStateKey(twice.state)).toBe(before);
  });

  it("keeps undo and redo as snapshots independent of render events", () => {
    const registry = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
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
    expect(stableEntityStateKey(undone.present)).toBe(stableEntityStateKey(initialState));
    expect(stableEntityStateKey(redone.present)).toBe(stableEntityStateKey(result.state));
  });

  it("bounds snapshot history during long editor sessions", () => {
    const { initialState } = createExperiment({
      size: 2,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 1,
    });
    let history = createHistory(initialState);
    for (let turn = 1; turn <= 300; turn += 1) {
      history = commitHistory(history, { ...history.present, turn });
    }

    expect(history.past).toHaveLength(256);
  });

  it("rejects channel values outside the ruleset schema", () => {
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
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

  it("validates board identity and edge integrity", () => {
    const state: GameState = {
      schemaVersion: 1,
      board: {
        nodes: {
          a: { id: "different", position: { x: 0, y: 0 }, tags: [] },
        },
        edges: [
          { from: "a", to: "missing", relation: "adjacent" },
          { from: "a", to: "missing", relation: "adjacent" },
        ],
      },
      entities: {},
      counters: {},
      inventory: {},
      turn: 0,
      status: "playing",
      seed: 0,
    };
    const ruleset: Ruleset = {
      id: "invalid-board",
      name: "Invalid board",
      actions: [],
      goals: [],
      settleSystems: [],
    };

    const errors = validateGameState(state, ruleset);
    expect(errors).toContain("Board node key does not match id: a != different");
    expect(errors).toContain("Board edge references unknown target: missing");
    expect(errors).toContain("Board contains a duplicate edge: a -> missing (adjacent)");
  });

  it("does not emit movement events for a no-op move", () => {
    const { initialState } = createExperiment({
      size: 2,
      stateCount: 2,
      defaultInfluence: "cross",
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
    board.nodes["n:0:0"]!.position = { x: 30, y: 20 };
    board.nodes["n:0:1"]!.position = { x: -10, y: 90 };
    board.nodes["n:0:2"]!.position = { x: 7, y: -40 };
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
      defaultInfluence: "diagonal",
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

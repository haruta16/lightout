import type {
  GameEntity,
  GameState,
  JsonValue,
  Ruleset,
} from "@lightout/engine";
import { createRectTopology, type BoardShape } from "./topology";

export type InfluencePattern = "cross" | "diagonal" | "king" | "row-column";

export interface ExperimentConfig {
  size: number;
  stateCount: number;
  goalValue: number;
  influence: InfluencePattern;
  boardShape: BoardShape;
  seed: number;
}

function relationsFor(pattern: InfluencePattern): string[] {
  switch (pattern) {
    case "cross":
      return ["orthogonal"];
    case "diagonal":
      return ["diagonal"];
    case "king":
      return ["orthogonal", "diagonal"];
    case "row-column":
      return ["same-row", "same-column"];
  }
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function affectedEntityIds(
  state: GameState,
  anchor: GameEntity,
  relations: readonly string[],
): string[] {
  if (!anchor.nodeId) return [];
  const nodeIds = new Set([anchor.nodeId]);
  for (const edge of state.board.edges) {
    if (edge.from === anchor.nodeId && relations.includes(edge.relation)) {
      nodeIds.add(edge.to);
    }
  }
  return Object.values(state.entities)
    .filter((entity) => entity.nodeId && nodeIds.has(entity.nodeId))
    .map((entity) => entity.id);
}

export function createExperiment(config: ExperimentConfig): {
  initialState: GameState;
  ruleset: Ruleset;
} {
  const size = Math.max(2, Math.min(12, Math.floor(config.size)));
  const stateCount = Math.max(2, Math.min(7, Math.floor(config.stateCount)));
  const goalValue = ((config.goalValue % stateCount) + stateCount) % stateCount;
  const board = createRectTopology({
    width: size,
    height: size,
    shape: config.boardShape,
  });
  const entities: Record<string, GameEntity> = {};
  for (const node of Object.values(board.nodes)) {
    const id = `light:${node.id}`;
    entities[id] = {
      id,
      kind: "light",
      nodeId: node.id,
      tags: ["interactive", "light"],
      channels: { power: goalValue },
    };
  }
  const initialState: GameState = {
    schemaVersion: 1,
    board,
    entities,
    counters: {},
    inventory: {},
    turn: 0,
    status: "playing",
    seed: config.seed,
  };

  const relations = relationsFor(config.influence);
  const rng = random(config.seed);
  const entityList = Object.values(initialState.entities);
  for (const anchor of entityList) {
    const presses = Math.floor(rng() * stateCount);
    if (presses === 0) continue;
    for (const entityId of affectedEntityIds(initialState, anchor, relations)) {
      const entity = initialState.entities[entityId];
      if (!entity) continue;
      const current = Number(entity.channels.power ?? 0);
      entity.channels.power = (current + presses) % stateCount;
    }
  }
  const generatedGoalState = entityList.every(
    (entity) => entity.channels.power === goalValue,
  );
  if (generatedGoalState && entityList[0]) {
    for (const entityId of affectedEntityIds(initialState, entityList[0], relations)) {
      const entity = initialState.entities[entityId];
      if (entity) entity.channels.power = (Number(entity.channels.power) + 1) % stateCount;
    }
  }

  const metadata: Record<string, JsonValue> = {
    stateCount,
    goalValue,
    influence: config.influence,
    boardShape: config.boardShape,
  };
  const ruleset: Ruleset = {
    id: `experiment:${config.influence}:${stateCount}`,
    name: "Switch Toggling Experiment",
    entityKinds: {
      light: {
        requiredChannels: {
          power: {
            type: "number",
            integer: true,
            min: 0,
            max: stateCount - 1,
          },
        },
        allowAdditionalChannels: false,
      },
    },
    actions: [
      {
        id: "activate-light",
        commandType: "activate",
        selector: {
          type: "graph-neighborhood",
          params: { relations, includeSelf: true, kind: "light" },
        },
        effects: [
          {
            type: "cycle-channel",
            params: { channel: "power", modulo: stateCount, step: 1 },
          },
        ],
      },
      {
        id: "set-light",
        commandType: "set-state",
        selector: { type: "self", params: { kind: "light" } },
        effects: [
          {
            type: "set-channel",
            params: { channel: "power", payloadKey: "value" },
          },
        ],
      },
    ],
    goals: [
      {
        type: "all-channel-equals",
        params: { kind: "light", channel: "power", value: goalValue },
      },
    ],
    settleSystems: [],
    metadata,
  };
  return { initialState, ruleset };
}

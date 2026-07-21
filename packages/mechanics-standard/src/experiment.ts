import type { GameEntity, GameState, JsonValue, Ruleset } from "@lightout/engine";
import {
  influenceTargetsForAnchor,
  isInfluencePattern,
  supportedInfluencesFor,
  type InfluencePattern,
} from "./influence";
import { createBoardTopology, type BoardGeometry } from "./topology";

export interface ExperimentConfig {
  size: number;
  stateCount: number;
  geometry?: BoardGeometry;
  defaultInfluence: InfluencePattern;
  compositeInfluence?: boolean;
  seed: number;
  initialValues?: Record<string, number>;
  goalValues?: Record<string, number | null>;
  influenceOverrides?: Record<string, InfluencePattern>;
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

function normalizedState(value: unknown, stateCount: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? ((value % stateCount) + stateCount) % stateCount
    : fallback;
}

export function createExperiment(config: ExperimentConfig): {
  initialState: GameState;
  ruleset: Ruleset;
} {
  const size = Math.max(2, Math.min(12, Math.floor(config.size)));
  const stateCount = Math.max(2, Math.min(7, Math.floor(config.stateCount)));
  const geometry = config.geometry ?? "square";
  const supportedInfluences = supportedInfluencesFor(geometry);
  const defaultInfluence = isInfluencePattern(config.defaultInfluence) &&
    supportedInfluences.includes(config.defaultInfluence)
    ? config.defaultInfluence
    : supportedInfluences[0] ?? "neighbors";
  const board = createBoardTopology({ width: size, height: size, geometry });
  const entities: Record<string, GameEntity> = {};

  for (const node of Object.values(board.nodes)) {
    const id = `light:${node.id}`;
    const configuredGoal = config.goalValues?.[node.id];
    const goal = config.goalValues && !(node.id in config.goalValues)
      ? -1
      : configuredGoal === null
      ? -1
      : normalizedState(configuredGoal, stateCount, 0);
    const override = config.compositeInfluence
      ? config.influenceOverrides?.[node.id]
      : undefined;
    const influence = isInfluencePattern(override) && supportedInfluences.includes(override)
      ? override
      : defaultInfluence;
    entities[id] = {
      id,
      kind: "light",
      nodeId: node.id,
      tags: ["interactive", "light"],
      channels: { power: goal < 0 ? 0 : goal, goal, influence },
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

  if (config.initialValues) {
    for (const entity of Object.values(initialState.entities)) {
      if (!entity.nodeId) continue;
      entity.channels.power = normalizedState(
        config.initialValues[entity.nodeId],
        stateCount,
        0,
      );
    }
  } else {
    const rng = random(config.seed);
    for (const anchor of Object.values(initialState.entities)) {
      const presses = Math.floor(rng() * stateCount);
      for (const entityId of influenceTargetsForAnchor(initialState, anchor)) {
        const entity = initialState.entities[entityId];
        if (!entity) continue;
        const current = Number(entity.channels.power ?? 0);
        entity.channels.power = (current + presses) % stateCount;
      }
    }
  }

  const constrained = Object.values(initialState.entities).filter(
    (entity) => Number(entity.channels.goal) >= 0,
  );
  const generatedAtGoal = constrained.length > 0 && constrained.every(
    (entity) => entity.channels.power === entity.channels.goal,
  );
  const first = Object.values(initialState.entities)[0];
  if (!config.initialValues && generatedAtGoal && first) {
    for (const entityId of influenceTargetsForAnchor(initialState, first)) {
      const entity = initialState.entities[entityId];
      if (entity) entity.channels.power = (Number(entity.channels.power) + 1) % stateCount;
    }
  }

  const metadata: Record<string, JsonValue> = {
    stateCount,
    defaultInfluence,
    compositeInfluence: config.compositeInfluence === true,
    geometry,
  };
  const ruleset: Ruleset = {
    id: `experiment:heterogeneous:${stateCount}`,
    name: "Switch Toggling Experiment",
    entityKinds: {
      light: {
        requiredChannels: {
          power: { type: "number", integer: true, min: 0, max: stateCount - 1 },
          goal: { type: "number", integer: true, min: -1, max: stateCount - 1 },
          influence: { type: "string", values: ["cross", "diagonal", "king", "neighbors", "row-column"] },
        },
        allowAdditionalChannels: false,
      },
    },
    actions: [
      {
        id: "activate-light",
        commandType: "activate",
        selector: {
          type: "anchor-influence",
          params: { channel: "influence", includeSelf: true, kind: "light" },
        },
        effects: [
          {
            type: "cycle-channel",
            params: { channel: "power", modulo: stateCount, step: 1 },
          },
        ],
      },
    ],
    goals: [
      {
        type: "channels-match",
        params: {
          kind: "light",
          actualChannel: "power",
          targetChannel: "goal",
          ignoreValue: -1,
        },
      },
    ],
    settleSystems: [],
    metadata,
  };
  return { initialState, ruleset };
}

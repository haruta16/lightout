import type { GameEntity, GameState, JsonValue, Ruleset } from "@lightout/engine";
import {
  influenceTargetsForAnchor,
  isInfluencePattern,
  supportedInfluencesFor,
  type InfluencePattern,
} from "./influence";
import { createBoardTopology, formatNodeId, type BoardGeometry } from "./topology";

export type CellPropertyMode = "uniform" | "per-cell";

export interface CellProperties {
  exists: boolean;
  hasPower: boolean;
  activatable: boolean;
  influenceId: InfluencePattern;
  custom: Record<string, JsonValue>;
}

export interface CellGoal {
  power?: { operator: "equals"; value: number };
}

export interface CellDesign {
  properties?: Partial<CellProperties>;
  initial?: { power?: number };
  goal?: CellGoal;
}

export interface CellPropertyDefinition {
  id: string;
  label: string;
  valueType: "boolean" | "number" | "string";
  defaultValue: JsonValue;
  affects: Array<"topology" | "behavior" | "presentation">;
  editorLayer: string;
}

export interface PuzzleDesign {
  schemaVersion: 6;
  board: {
    geometry: BoardGeometry;
    width: number;
    height: number;
  };
  seed: number;
  rule: {
    stateCount: number;
    cellDefaults: CellProperties;
    propertyPolicies: Record<string, CellPropertyMode> & { influenceId: CellPropertyMode };
    customPropertyDefinitions: Record<string, CellPropertyDefinition>;
  };
  cells: Record<string, CellDesign>;
}

export interface PuzzleDesignOptions {
  size: number;
  stateCount: number;
  geometry?: BoardGeometry;
  defaultInfluence: InfluencePattern;
  influenceMode?: CellPropertyMode;
  seed: number;
  cells?: Record<string, CellDesign>;
}

function normalizedState(value: unknown, stateCount: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? ((value % stateCount) + stateCount) % stateCount
    : fallback;
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPuzzleDesign(options: PuzzleDesignOptions): PuzzleDesign {
  const size = Math.max(2, Math.min(12, Math.floor(options.size)));
  const stateCount = Math.max(2, Math.min(7, Math.floor(options.stateCount)));
  const geometry = options.geometry ?? "square";
  const supported = supportedInfluencesFor(geometry);
  const defaultInfluence = supported.includes(options.defaultInfluence)
    ? options.defaultInfluence
    : supported[0] ?? "neighbors";
  const cells: Record<string, CellDesign> = {};
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const id = formatNodeId(x, y);
      const source = options.cells?.[id];
      cells[id] = source
        ? structuredClone(source)
        : { goal: { power: { operator: "equals", value: 0 } } };
    }
  }
  return {
    schemaVersion: 6,
    board: { geometry, width: size, height: size },
    seed: Math.max(0, Math.floor(options.seed)),
    rule: {
      stateCount,
      cellDefaults: {
        exists: true,
        hasPower: true,
        activatable: true,
        influenceId: defaultInfluence,
        custom: {},
      },
      propertyPolicies: { influenceId: options.influenceMode ?? "uniform" },
      customPropertyDefinitions: {},
    },
    cells,
  };
}

export function cellPropertiesFor(design: Readonly<PuzzleDesign>, nodeId: string): CellProperties {
  const defaults = design.rule.cellDefaults;
  const override = design.cells[nodeId]?.properties;
  const declaredDefaults = Object.fromEntries(
    Object.values(design.rule.customPropertyDefinitions).map((definition) => [
      definition.id,
      definition.defaultValue,
    ]),
  );
  const influenceId = design.rule.propertyPolicies.influenceId === "per-cell"
    ? override?.influenceId ?? defaults.influenceId
    : defaults.influenceId;
  return {
    exists: override?.exists ?? defaults.exists,
    hasPower: override?.hasPower ?? defaults.hasPower,
    activatable: override?.activatable ?? defaults.activatable,
    influenceId,
    custom: { ...declaredDefaults, ...defaults.custom, ...override?.custom },
  };
}

function customValueIsValid(value: JsonValue, valueType: CellPropertyDefinition["valueType"]): boolean {
  if (valueType === "boolean") return typeof value === "boolean";
  if (valueType === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string";
}

function validateDesign(design: Readonly<PuzzleDesign>): void {
  const { width, height, geometry } = design.board;
  if (design.schemaVersion !== 6) throw new Error("Unsupported puzzle design schema");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 12 || height > 12) {
    throw new Error("Puzzle dimensions must be integers between 2 and 12");
  }
  if (!Number.isInteger(design.rule.stateCount) || design.rule.stateCount < 2 || design.rule.stateCount > 7) {
    throw new Error("Puzzle state count must be an integer between 2 and 7");
  }
  if (!design.rule.cellDefaults.hasPower && !design.rule.cellDefaults.activatable) {
    throw new Error("Default cell must have power or activation capability");
  }
  const reservedProperties = new Set(["exists", "hasPower", "activatable", "influenceId", "custom"]);
  for (const [propertyId, definition] of Object.entries(design.rule.customPropertyDefinitions)) {
    if (propertyId !== definition.id || reservedProperties.has(propertyId)) {
      throw new Error(`Invalid custom property definition: ${propertyId}`);
    }
    if (!customValueIsValid(definition.defaultValue, definition.valueType)) {
      throw new Error(`Custom property ${propertyId} has an invalid default value`);
    }
  }
  const supported = supportedInfluencesFor(geometry);
  for (const nodeId of Object.keys(design.cells)) {
    const properties = cellPropertiesFor(design, nodeId);
    if (!properties.hasPower && !properties.activatable) {
      throw new Error(`Cell ${nodeId} must have power or activation capability`);
    }
    if (!isInfluencePattern(properties.influenceId) || !supported.includes(properties.influenceId)) {
      throw new Error(`Cell ${nodeId} uses an influence unsupported by ${geometry}`);
    }
    for (const [propertyId, value] of Object.entries(properties.custom)) {
      const definition = design.rule.customPropertyDefinitions[propertyId];
      if (!definition || !customValueIsValid(value, definition.valueType)) {
        throw new Error(`Cell ${nodeId} has invalid custom property: ${propertyId}`);
      }
    }
    const initial = design.cells[nodeId]?.initial?.power;
    const goal = design.cells[nodeId]?.goal?.power?.value;
    for (const [label, value] of [["initial", initial], ["goal", goal]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value >= design.rule.stateCount)) {
        throw new Error(`Cell ${nodeId} has invalid ${label} power`);
      }
    }
  }
}

export function compilePuzzleDesign(design: Readonly<PuzzleDesign>): {
  initialState: GameState;
  ruleset: Ruleset;
} {
  validateDesign(design);
  const { geometry, width, height } = design.board;
  const stateCount = design.rule.stateCount;
  const includedNodeIds = new Set<string>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nodeId = formatNodeId(x, y);
      if (cellPropertiesFor(design, nodeId).exists) includedNodeIds.add(nodeId);
    }
  }
  const board = createBoardTopology({ geometry, width, height, includedNodeIds });
  const entities: Record<string, GameEntity> = {};
  const goalTargets: Record<string, number> = {};
  let hasExplicitInitial = false;

  for (const node of Object.values(board.nodes)) {
    const cell = design.cells[node.id];
    const properties = cellPropertiesFor(design, node.id);
    const id = `cell:${node.id}`;
    const channels: Record<string, number> = {};
    if (properties.hasPower) {
      const initial = cell?.initial?.power;
      if (initial !== undefined) hasExplicitInitial = true;
      channels.power = normalizedState(initial, stateCount, 0);
      const goal = cell?.goal?.power;
      if (goal?.operator === "equals") goalTargets[id] = normalizedState(goal.value, stateCount, 0);
    }
    entities[id] = {
      id,
      kind: "cell",
      nodeId: node.id,
      tags: [
        "cell",
        ...(properties.activatable ? ["activatable"] : []),
        ...(properties.hasPower ? ["state:power"] : []),
      ],
      properties: {
        ...properties.custom,
        activatable: properties.activatable,
        hasPower: properties.hasPower,
        influenceId: properties.influenceId,
      },
      channels,
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
    seed: design.seed,
  };

  if (!hasExplicitInitial) {
    for (const entity of Object.values(initialState.entities)) {
      if (entity.properties.hasPower === true) {
        entity.channels.power = goalTargets[entity.id] ?? 0;
      }
    }
    const rng = random(design.seed);
    for (const anchor of Object.values(initialState.entities).filter(
      (entity) => entity.properties.activatable === true,
    )) {
      const presses = Math.floor(rng() * stateCount);
      for (const entityId of influenceTargetsForAnchor(initialState, anchor)) {
        const entity = initialState.entities[entityId];
        if (!entity || typeof entity.channels.power !== "number") continue;
        entity.channels.power = (entity.channels.power + presses) % stateCount;
      }
    }
  }

  const atGoal = Object.entries(goalTargets).length > 0 && Object.entries(goalTargets).every(
    ([entityId, goal]) => initialState.entities[entityId]?.channels.power === goal,
  );
  if (!hasExplicitInitial && atGoal) {
    const firstAnchor = Object.values(initialState.entities).find(
      (entity) => entity.properties.activatable === true,
    );
    if (firstAnchor) {
      for (const entityId of influenceTargetsForAnchor(initialState, firstAnchor)) {
        const entity = initialState.entities[entityId];
        if (entity && typeof entity.channels.power === "number") {
          entity.channels.power = (entity.channels.power + 1) % stateCount;
        }
      }
    }
  }

  const metadata: Record<string, JsonValue> = {
    stateCount,
    geometry,
  };
  const ruleset: Ruleset = {
    id: `puzzle:cells:${stateCount}`,
    name: "Cell Property Puzzle",
    entityKinds: {
      cell: {
        requiredProperties: {
          activatable: { type: "boolean" },
          hasPower: { type: "boolean" },
          influenceId: { type: "string", values: supportedInfluencesFor(geometry) },
        },
        optionalChannels: {
          power: { type: "number", integer: true, min: 0, max: stateCount - 1 },
        },
        allowAdditionalProperties: true,
        allowAdditionalChannels: false,
      },
    },
    actions: [{
      id: "activate-cell",
      commandType: "activate",
      selector: { type: "anchor-influence", params: {} },
      effects: [{
        type: "cycle-channel",
        params: { channel: "power", modulo: stateCount, step: 1 },
      }],
    }],
    goals: [{
      type: "channel-targets-match",
      params: { channel: "power", targets: goalTargets },
    }],
    settleSystems: [],
    metadata,
  };
  return { initialState, ruleset };
}

import type { GameState } from "@lightout/engine";
import type { BoardGeometry, ExperimentConfig, InfluencePattern } from "@lightout/mechanics-standard";
import {
  BOARD_GEOMETRIES,
  INFLUENCE_PATTERNS,
  isInfluencePattern,
  parseNodeId,
  supportedInfluencesFor,
} from "@lightout/mechanics-standard";

export type WorkspaceMode = "play" | "edit";
export type EditorTool = "inspect" | "paint" | "cycle";
export type EditorSurface = "initial" | "goal" | "influence";
export type Theme = "light" | "dark";

export interface RuleDefinitionConfig {
  stateCount: number;
  defaultInfluence: InfluencePattern;
  compositeInfluence: boolean;
}

export interface LevelDefaults {
  size: number;
  geometry: BoardGeometry;
  seed: number;
  initialValues?: Record<string, number>;
  goalValues?: Record<string, number | null>;
  influenceOverrides?: Record<string, InfluencePattern>;
}

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  definition: RuleDefinitionConfig;
  level: LevelDefaults;
}

interface StoredWorkspace {
  version: 5;
  activeRuleId: string;
  presets: RulePreset[];
}

export interface InitialWorkspace {
  activeRuleId: string;
  presets: RulePreset[];
}

const STORAGE_KEY = "lightout-rule-workspace-v1";
const CURRENT_WORKSPACE_VERSION = 5 as const;

function checkerInfluences(size: number): Record<string, InfluencePattern> {
  const values: Record<string, InfluencePattern> = {};
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % 3 === 1) values[`n:${x}:${y}`] = "diagonal";
      if ((x + y) % 3 === 2) values[`n:${x}:${y}`] = "king";
    }
  }
  return values;
}

function constellationGoals(size: number): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  const center = Math.floor(size / 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      values[`n:${x}:${y}`] = x === center || y === center ? (x + y) % 3 : null;
    }
  }
  return values;
}

export const DEFAULT_RULE_PRESETS: RulePreset[] = [
  {
    id: "classic-cross",
    name: "经典十字联动",
    description: "二态方阵基准规则，每格使用相同的十字影响。",
    definition: { stateCount: 2, defaultInfluence: "cross", compositeInfluence: false },
    level: { size: 5, geometry: "square", seed: 27183 },
  },
  {
    id: "prism-field",
    name: "棱镜场",
    description: "三态八方向传播，用于观察自由度与局面密度。",
    definition: { stateCount: 3, defaultInfluence: "king", compositeInfluence: false },
    level: { size: 6, geometry: "square", seed: 73021 },
  },
  {
    id: "long-coupling",
    name: "纵横耦合",
    description: "四态整行整列影响，形成跨越棋盘的长距离联动。",
    definition: { stateCount: 4, defaultInfluence: "row-column", compositeInfluence: false },
    level: { size: 7, geometry: "square", seed: 44017 },
  },
  {
    id: "heterogeneous-grid",
    name: "异构星图",
    description: "同一方阵混合十字、对角与八方向影响，并使用部分目标约束。",
    definition: { stateCount: 3, defaultInfluence: "cross", compositeInfluence: true },
    level: {
      size: 5,
      geometry: "square",
      seed: 31415,
      goalValues: constellationGoals(5),
      influenceOverrides: checkerInfluences(5),
    },
  },
  {
    id: "diagonal-spectrum",
    name: "对角光谱",
    description: "五态对角影响，用更丰富的按压次数检验线性结构。",
    definition: { stateCount: 5, defaultInfluence: "diagonal", compositeInfluence: false },
    level: { size: 5, geometry: "square", seed: 9907 },
  },
  {
    id: "hex-sixfold",
    name: "六域回响",
    description: "六边形拓扑，每个内部节点沿六个方向联动。",
    definition: { stateCount: 3, defaultInfluence: "neighbors", compositeInfluence: false },
    level: { size: 6, geometry: "hex", seed: 61803 },
  },
  {
    id: "triangle-tripoint",
    name: "三相回路",
    description: "交错三角拓扑，每个内部节点沿三条共边方向联动。",
    definition: { stateCount: 3, defaultInfluence: "neighbors", compositeInfluence: false },
    level: { size: 6, geometry: "triangle", seed: 31415 },
  },
];

function cloneDefaults(): RulePreset[] {
  return structuredClone(DEFAULT_RULE_PRESETS) as RulePreset[];
}

function isNodeIdWithin(value: string, size: number): boolean {
  const coordinate = parseNodeId(value);
  if (!coordinate) return false;
  const { x, y } = coordinate;
  return x >= 0 && y >= 0 && x < size && y < size;
}

function numberMap(
  value: unknown,
  size: number,
  stateCount: number,
  allowNull: boolean,
): Record<string, number | null> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, number | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isNodeIdWithin(key, size)) return undefined;
    if (allowNull && item === null) result[key] = null;
    else if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item < stateCount) {
      result[key] = item;
    } else return undefined;
  }
  return result;
}

function influenceMap(
  value: unknown,
  size: number,
): Record<string, InfluencePattern> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, InfluencePattern> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isNodeIdWithin(key, size) || !isInfluencePattern(item)) return undefined;
    result[key] = item;
  }
  return result;
}

function normalizePreset(value: unknown): RulePreset | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const definition = source.definition as Record<string, unknown> | undefined;
  const level = source.level as Record<string, unknown> | undefined;
  if (!definition || !level) return null;
  const stateCount = definition?.stateCount;
  const size = level?.size;
  const seed = level?.seed;
  const geometry = level.geometry;
  const defaultInfluence = definition.defaultInfluence;
  const compositeInfluence = definition.compositeInfluence;
  if (
    typeof source.id !== "string" || source.id.length === 0 ||
    typeof source.name !== "string" ||
    typeof source.description !== "string" ||
    typeof stateCount !== "number" || !Number.isInteger(stateCount) || stateCount < 2 || stateCount > 5 ||
    typeof size !== "number" || !Number.isInteger(size) || size < 2 || size > 10 ||
    typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 ||
    !BOARD_GEOMETRIES.includes(geometry as BoardGeometry) ||
    !isInfluencePattern(defaultInfluence) ||
    typeof compositeInfluence !== "boolean"
  ) return null;

  const normalizedGeometry = geometry as BoardGeometry;
  const supportedInfluences = supportedInfluencesFor(normalizedGeometry);
  if (compositeInfluence && supportedInfluences.length < 2) return null;
  const normalizedDefaultInfluence = supportedInfluences.includes(defaultInfluence)
    ? defaultInfluence
    : supportedInfluences[0] ?? "neighbors";

  const initialValues = numberMap(level.initialValues, size, stateCount, false);
  const goalValues = numberMap(level.goalValues, size, stateCount, true);
  const rawInfluenceOverrides = influenceMap(level.influenceOverrides, size);
  if (
    (level.initialValues !== undefined && initialValues === undefined) ||
    (level.goalValues !== undefined && goalValues === undefined) ||
    (level.influenceOverrides !== undefined && rawInfluenceOverrides === undefined)
  ) return null;

  const influenceOverrides = rawInfluenceOverrides && Object.fromEntries(
    Object.entries(rawInfluenceOverrides).filter(([, influence]) =>
      supportedInfluences.includes(influence),
    ),
  ) as Record<string, InfluencePattern> | undefined;
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    definition: {
      stateCount,
      defaultInfluence: normalizedDefaultInfluence,
      compositeInfluence,
    },
    level: {
      size,
      geometry: normalizedGeometry,
      seed,
      initialValues: initialValues as Record<string, number> | undefined,
      goalValues,
      influenceOverrides,
    },
  };
}

export function loadWorkspace(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): InitialWorkspace {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("missing workspace");
    const stored = JSON.parse(raw) as { version?: number; activeRuleId?: unknown; presets?: unknown[] };
    if (stored.version !== CURRENT_WORKSPACE_VERSION || !Array.isArray(stored.presets)) {
      throw new Error("invalid workspace");
    }
    const presets: RulePreset[] = [];
    const seenIds = new Set<string>();
    for (const value of stored.presets) {
      const preset = normalizePreset(value);
      if (!preset || seenIds.has(preset.id)) continue;
      presets.push(preset);
      seenIds.add(preset.id);
    }
    if (presets.length === 0) throw new Error("empty workspace");
    const activeRuleId = presets.some((preset) => preset.id === stored.activeRuleId)
      ? (stored.activeRuleId as string)
      : presets[0]!.id;
    return { activeRuleId, presets };
  } catch {
    const presets = cloneDefaults();
    return { activeRuleId: presets[0]!.id, presets };
  }
}

export function saveWorkspace(
  workspace: InitialWorkspace,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): boolean {
  const stored: StoredWorkspace = { version: CURRENT_WORKSPACE_VERSION, ...workspace };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export function loadPreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  storage: Pick<Storage, "getItem"> = window.localStorage,
): T {
  try {
    const value = storage.getItem(key);
    return value !== null && allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePreference(
  key: string,
  value: string,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function toExperimentConfig(preset: RulePreset): ExperimentConfig {
  return {
    size: preset.level.size,
    stateCount: preset.definition.stateCount,
    geometry: preset.level.geometry,
    defaultInfluence: preset.definition.defaultInfluence,
    compositeInfluence: preset.definition.compositeInfluence,
    seed: preset.level.seed,
    initialValues: preset.level.initialValues,
    goalValues: preset.level.goalValues,
    influenceOverrides: preset.definition.compositeInfluence
      ? preset.level.influenceOverrides
      : undefined,
  };
}

export function withLevelDesign(preset: RulePreset, state: Readonly<GameState>): RulePreset {
  const initialValues: Record<string, number> = {};
  const goalValues: Record<string, number | null> = {};
  const influenceOverrides: Record<string, InfluencePattern> = {};
  for (const entity of Object.values(state.entities)) {
    if (!entity.nodeId) continue;
    initialValues[entity.nodeId] = Number(entity.channels.power ?? 0);
    const goal = Number(entity.channels.goal ?? -1);
    goalValues[entity.nodeId] = goal < 0 ? null : goal;
    const influence = entity.channels.influence;
    if (isInfluencePattern(influence) && influence !== preset.definition.defaultInfluence) {
      influenceOverrides[entity.nodeId] = influence;
    }
  }
  return {
    ...preset,
    level: {
      ...preset.level,
      initialValues,
      goalValues,
      influenceOverrides: preset.definition.compositeInfluence
        ? influenceOverrides
        : preset.level.influenceOverrides,
    },
  };
}

export function duplicatePreset(source: RulePreset): RulePreset {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { ...structuredClone(source), id: `${source.id}-copy-${suffix}`, name: `${source.name}副本` };
}

export { INFLUENCE_PATTERNS };

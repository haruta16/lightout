import type {
  BoardShape,
  ExperimentConfig,
  InfluencePattern,
} from "@lightout/mechanics-standard";

export type WorkspaceMode = "play" | "edit";
export type EditorTool = "inspect" | "paint" | "cycle";
export type Theme = "light" | "dark";
export type NodeShape = "circle" | "rounded-square";

export interface RuleDefinitionConfig {
  stateCount: number;
  goalValue: number;
  influence: InfluencePattern;
}

export interface LevelDefaults {
  size: number;
  boardShape: BoardShape;
  seed: number;
}

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  accent: string;
  definition: RuleDefinitionConfig;
  level: LevelDefaults;
}

interface StoredWorkspace {
  version: 1;
  activeRuleId: string;
  presets: RulePreset[];
}

export interface InitialWorkspace {
  activeRuleId: string;
  presets: RulePreset[];
}

const STORAGE_KEY = "lightout-rule-workspace-v1";
const INFLUENCE_PATTERNS: InfluencePattern[] = [
  "cross",
  "diagonal",
  "king",
  "row-column",
];
const BOARD_SHAPES: BoardShape[] = ["full", "diamond", "ring"];

export const DEFAULT_RULE_PRESETS: RulePreset[] = [
  {
    id: "classic-cross",
    name: "经典十字联动",
    description: "最纯粹的二态开关联动，也是所有实验的基准线。",
    accent: "#f1b85b",
    definition: { stateCount: 2, goalValue: 0, influence: "cross" },
    level: { size: 5, boardShape: "full", seed: 27183 },
  },
  {
    id: "prism-field",
    name: "棱镜场",
    description: "三态八方向传播，适合观察自由度与局面密度。",
    accent: "#55d6b5",
    definition: { stateCount: 3, goalValue: 0, influence: "king" },
    level: { size: 6, boardShape: "diamond", seed: 73021 },
  },
  {
    id: "orbital-ring",
    name: "轨道回路",
    description: "四态环形棋盘，以整行整列形成长距离耦合。",
    accent: "#ff7b6e",
    definition: { stateCount: 4, goalValue: 0, influence: "row-column" },
    level: { size: 7, boardShape: "ring", seed: 44017 },
  },
  {
    id: "diagonal-spectrum",
    name: "对角光谱",
    description: "五态对角影响，用更丰富的按压次数检验线性结构。",
    accent: "#93a6ff",
    definition: { stateCount: 5, goalValue: 0, influence: "diagonal" },
    level: { size: 5, boardShape: "full", seed: 9907 },
  },
];

function cloneDefaults(): RulePreset[] {
  return structuredClone(DEFAULT_RULE_PRESETS) as RulePreset[];
}

function isPreset(value: unknown): value is RulePreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<RulePreset>;
  return (
    typeof preset.id === "string" &&
    preset.id.length > 0 &&
    typeof preset.name === "string" &&
    typeof preset.description === "string" &&
    typeof preset.accent === "string" &&
    !!preset.definition &&
    Number.isInteger(preset.definition.stateCount) &&
    preset.definition.stateCount >= 2 &&
    preset.definition.stateCount <= 5 &&
    Number.isInteger(preset.definition.goalValue) &&
    preset.definition.goalValue >= 0 &&
    preset.definition.goalValue < preset.definition.stateCount &&
    INFLUENCE_PATTERNS.includes(preset.definition.influence as InfluencePattern) &&
    !!preset.level &&
    Number.isInteger(preset.level.size) &&
    preset.level.size >= 2 &&
    preset.level.size <= 10 &&
    Number.isInteger(preset.level.seed) &&
    preset.level.seed >= 0 &&
    BOARD_SHAPES.includes(preset.level.boardShape as BoardShape)
  );
}

export function loadWorkspace(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): InitialWorkspace {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("missing workspace");
    const stored = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (
      stored.version !== 1 ||
      !Array.isArray(stored.presets) ||
      stored.presets.length === 0 ||
      !stored.presets.every(isPreset) ||
      new Set(stored.presets.map((preset) => preset.id)).size !== stored.presets.length
    ) {
      throw new Error("invalid workspace");
    }
    const activeRuleId = stored.presets.some(
      (preset) => preset.id === stored.activeRuleId,
    )
      ? (stored.activeRuleId as string)
      : stored.presets[0]!.id;
    return { activeRuleId, presets: stored.presets };
  } catch {
    const presets = cloneDefaults();
    return { activeRuleId: presets[0]!.id, presets };
  }
}

export function saveWorkspace(
  workspace: InitialWorkspace,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): boolean {
  const stored: StoredWorkspace = {
    version: 1,
    activeRuleId: workspace.activeRuleId,
    presets: workspace.presets,
  };
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
    goalValue: Math.max(
      0,
      Math.min(preset.definition.goalValue, preset.definition.stateCount - 1),
    ),
    influence: preset.definition.influence,
    boardShape: preset.level.boardShape,
    seed: preset.level.seed,
  };
}

export function duplicatePreset(source: RulePreset): RulePreset {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    ...structuredClone(source),
    id: `${source.id}-copy-${suffix}`,
    name: `${source.name}副本`,
  };
}

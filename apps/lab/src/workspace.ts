import type {
  BoardGeometry,
  BoardShape,
  ExperimentConfig,
  InfluencePattern,
} from "@lightout/mechanics-standard";
import {
  BOARD_GEOMETRIES,
  INFLUENCE_PATTERNS,
  supportedInfluencesFor,
} from "@lightout/mechanics-standard";

export type WorkspaceMode = "play" | "edit";
export type EditorTool = "inspect" | "paint" | "cycle";
export type Theme = "light" | "dark";
export interface RuleDefinitionConfig {
  stateCount: number;
  goalValue: number;
  influence: InfluencePattern;
}

export interface LevelDefaults {
  size: number;
  boardShape: BoardShape;
  geometry: BoardGeometry;
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
  version: 2;
  activeRuleId: string;
  presets: RulePreset[];
}

export interface InitialWorkspace {
  activeRuleId: string;
  presets: RulePreset[];
}

const STORAGE_KEY = "lightout-rule-workspace-v1";
const BOARD_SHAPES: BoardShape[] = ["full", "diamond", "ring"];
const SHOWCASE_RULE_IDS = ["hex-sixfold", "triangle-tripoint"] as const;

export const DEFAULT_RULE_PRESETS: RulePreset[] = [
  {
    id: "classic-cross",
    name: "经典十字联动",
    description: "最纯粹的二态开关联动，也是所有实验的基准线。",
    accent: "#f1b85b",
    definition: { stateCount: 2, goalValue: 0, influence: "cross" },
    level: { size: 5, boardShape: "full", geometry: "square", seed: 27183 },
  },
  {
    id: "prism-field",
    name: "棱镜场",
    description: "三态八方向传播，适合观察自由度与局面密度。",
    accent: "#55d6b5",
    definition: { stateCount: 3, goalValue: 0, influence: "king" },
    level: { size: 6, boardShape: "diamond", geometry: "square", seed: 73021 },
  },
  {
    id: "orbital-ring",
    name: "轨道回路",
    description: "四态环形棋盘，以整行整列形成长距离耦合。",
    accent: "#ff7b6e",
    definition: { stateCount: 4, goalValue: 0, influence: "row-column" },
    level: { size: 7, boardShape: "ring", geometry: "square", seed: 44017 },
  },
  {
    id: "diagonal-spectrum",
    name: "对角光谱",
    description: "五态对角影响，用更丰富的按压次数检验线性结构。",
    accent: "#93a6ff",
    definition: { stateCount: 5, goalValue: 0, influence: "diagonal" },
    level: { size: 5, boardShape: "full", geometry: "square", seed: 9907 },
  },
  {
    id: "hex-sixfold",
    name: "六域回响",
    description: "六边形拓扑，每个内部节点与周围六个方向联动。",
    accent: "#42cbb4",
    definition: { stateCount: 3, goalValue: 0, influence: "neighbors" },
    level: { size: 6, boardShape: "full", geometry: "hex", seed: 61803 },
  },
  {
    id: "triangle-tripoint",
    name: "三相回路",
    description: "交错三角拓扑，每个内部节点沿三条共边方向联动。",
    accent: "#c58cff",
    definition: { stateCount: 3, goalValue: 0, influence: "neighbors" },
    level: { size: 6, boardShape: "full", geometry: "triangle", seed: 31415 },
  },
];

function cloneDefaults(): RulePreset[] {
  return structuredClone(DEFAULT_RULE_PRESETS) as RulePreset[];
}

function normalizePreset(value: unknown): RulePreset | null {
  if (!value || typeof value !== "object") return null;
  const preset = value as Partial<RulePreset>;
  const valid =
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
    BOARD_SHAPES.includes(preset.level.boardShape as BoardShape) &&
    (preset.level.geometry === undefined ||
      BOARD_GEOMETRIES.includes(preset.level.geometry as BoardGeometry));
  if (!valid) return null;
  const geometry =
    (preset.level?.geometry as BoardGeometry | undefined) ?? "square";
  const influence = preset.definition?.influence as InfluencePattern;
  return {
    ...(preset as RulePreset),
    definition: {
      ...(preset.definition as RuleDefinitionConfig),
      influence: supportedInfluencesFor(geometry).includes(influence)
        ? influence
        : "neighbors",
    },
    level: {
      ...(preset.level as LevelDefaults),
      geometry,
    },
  };
}

export function loadWorkspace(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): InitialWorkspace {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("missing workspace");
    const stored = JSON.parse(raw) as {
      version?: number;
      activeRuleId?: unknown;
      presets?: unknown[];
    };
    const normalizedPresets = Array.isArray(stored.presets)
      ? stored.presets.map(normalizePreset)
      : [];
    if (
      (stored.version !== 1 && stored.version !== 2) ||
      normalizedPresets.length === 0 ||
      normalizedPresets.some((preset) => preset === null)
    ) {
      throw new Error("invalid workspace");
    }
    const presets = normalizedPresets as RulePreset[];
    if (new Set(presets.map((preset) => preset.id)).size !== presets.length) {
      throw new Error("duplicate preset");
    }
    for (const ruleId of SHOWCASE_RULE_IDS) {
      const builtInRule = DEFAULT_RULE_PRESETS.find(
        (preset) => preset.id === ruleId,
      );
      if (builtInRule && !presets.some((preset) => preset.id === builtInRule.id)) {
        presets.push(structuredClone(builtInRule));
      }
    }
    const activeRuleId = presets.some(
      (preset) => preset.id === stored.activeRuleId,
    )
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
  const stored: StoredWorkspace = {
    version: 2,
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
    geometry: preset.level.geometry,
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

import {
  BOARD_GEOMETRIES,
  compilePuzzleDesign,
  createPuzzleDesign,
  formatNodeId,
  parseNodeId,
  supportedInfluencesFor,
  type BoardGeometry,
  type CellDesign,
  type InfluencePattern,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import {
  isPuzzleGenerationRecord,
  type PuzzleGenerationRecord,
} from "@lightout/generator";
import type { CellRole } from "@lightout/mechanics-standard";

export type WorkspaceMode = "play" | "edit";
export type EditorTool = "inspect" | "paint" | "cycle";
export type EditorSurface = "structure" | "role" | "influence" | "initial" | "goal";
export type EditorPaintValue = boolean | CellRole | InfluencePattern | number | null;
export type Theme = "light" | "dark";

export interface PuzzleGame {
  design: PuzzleDesign;
  generation?: PuzzleGenerationRecord;
}

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  game: PuzzleGame;
}

interface StoredWorkspace {
  version: 7;
  activeRuleId: string;
  presets: RulePreset[];
}

export interface InitialWorkspace {
  activeRuleId: string;
  presets: RulePreset[];
}

export interface DesignHistory {
  past: PuzzleDesign[];
  present: PuzzleDesign;
  future: PuzzleDesign[];
}

const STORAGE_KEY = "lightout-rule-workspace-v1";
const CURRENT_WORKSPACE_VERSION = 7 as const;
const HISTORY_LIMIT = 256;

function customizeCells(
  design: PuzzleDesign,
  customize: (nodeId: string, x: number, y: number, cell: CellDesign) => CellDesign,
): PuzzleDesign {
  const next = structuredClone(design) as PuzzleDesign;
  for (let y = 0; y < next.board.height; y += 1) {
    for (let x = 0; x < next.board.width; x += 1) {
      const nodeId = formatNodeId(x, y);
      next.cells[nodeId] = customize(nodeId, x, y, next.cells[nodeId] ?? {});
    }
  }
  return next;
}

function heterogeneousDesign(): PuzzleDesign {
  const base = createPuzzleDesign({
    size: 5,
    stateCount: 3,
    defaultInfluence: "cross",
    influenceMode: "per-cell",
    seed: 31415,
  });
  const center = Math.floor(base.board.width / 2);
  return customizeCells(base, (_nodeId, x, y, cell) => ({
    ...cell,
    properties: {
      ...cell.properties,
      influenceId: (x + y) % 3 === 1 ? "diagonal" : (x + y) % 3 === 2 ? "king" : "cross",
    },
    goal: x === center || y === center
      ? { power: { operator: "equals", value: (x + y) % 3 } }
      : undefined,
  }));
}

export const DEFAULT_RULE_PRESETS: RulePreset[] = [
  {
    id: "classic-cross",
    name: "经典十字联动",
    description: "二态方阵基准规则，每格使用相同的十字影响。",
    game: { design: createPuzzleDesign({ size: 5, stateCount: 2, defaultInfluence: "cross", seed: 27183 }) },
  },
  {
    id: "prism-field",
    name: "棱镜场",
    description: "三态八方向传播，用于观察自由度与局面密度。",
    game: { design: createPuzzleDesign({ size: 6, stateCount: 3, defaultInfluence: "king", seed: 73021 }) },
  },
  {
    id: "long-coupling",
    name: "纵横耦合",
    description: "四态整行整列影响；不存在的格子会阻断传播射线。",
    game: { design: createPuzzleDesign({ size: 7, stateCount: 4, defaultInfluence: "row-column", seed: 44017 }) },
  },
  {
    id: "heterogeneous-grid",
    name: "异构星图",
    description: "同一方阵混合十字、对角与八方向影响，并使用部分目标约束。",
    game: { design: heterogeneousDesign() },
  },
  {
    id: "diagonal-spectrum",
    name: "对角光谱",
    description: "五态对角影响，用更丰富的按压次数检验线性结构。",
    game: { design: createPuzzleDesign({ size: 5, stateCount: 5, defaultInfluence: "diagonal", seed: 9907 }) },
  },
  {
    id: "hex-sixfold",
    name: "六域回响",
    description: "六边形拓扑，每个内部节点沿六个方向联动。",
    game: { design: createPuzzleDesign({ size: 6, geometry: "hex", stateCount: 3, defaultInfluence: "neighbors", seed: 61803 }) },
  },
  {
    id: "triangle-tripoint",
    name: "三相回路",
    description: "交错三角拓扑，每个内部节点沿三条共边方向联动。",
    game: { design: createPuzzleDesign({ size: 6, geometry: "triangle", stateCount: 3, defaultInfluence: "neighbors", seed: 31415 }) },
  },
];

function cloneDefaults(): RulePreset[] {
  return structuredClone(DEFAULT_RULE_PRESETS) as RulePreset[];
}

function normalizePreset(value: unknown): RulePreset | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.id !== "string" || source.id.length === 0 ||
    typeof source.name !== "string" ||
    typeof source.description !== "string" ||
    !source.game || typeof source.game !== "object"
  ) return null;
  const game = source.game as Record<string, unknown>;
  if (!game.design || typeof game.design !== "object") return null;
  const design = structuredClone(game.design) as PuzzleDesign;
  try {
    if (!BOARD_GEOMETRIES.includes(design.board.geometry as BoardGeometry)) return null;
    for (const nodeId of Object.keys(design.cells)) {
      const coordinate = parseNodeId(nodeId);
      if (!coordinate || coordinate.x >= design.board.width || coordinate.y >= design.board.height) return null;
    }
    compilePuzzleDesign(design);
  } catch {
    return null;
  }
  const generation = isPuzzleGenerationRecord(game.generation)
    ? structuredClone(game.generation)
    : undefined;
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    game: {
      design,
      ...(generation ? { generation } : {}),
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

export function resizePuzzleDesign(source: Readonly<PuzzleDesign>, size: number): PuzzleDesign {
  const nextSize = Math.max(2, Math.min(10, Math.floor(size)));
  const next = structuredClone(source) as PuzzleDesign;
  next.board.width = nextSize;
  next.board.height = nextSize;
  const cells: Record<string, CellDesign> = {};
  for (let y = 0; y < nextSize; y += 1) {
    for (let x = 0; x < nextSize; x += 1) {
      const nodeId = formatNodeId(x, y);
      cells[nodeId] = next.cells[nodeId] ?? { goal: { power: { operator: "equals", value: 0 } } };
    }
  }
  next.cells = cells;
  return next;
}

export function changeGeometry(source: Readonly<PuzzleDesign>, geometry: BoardGeometry): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  next.board.geometry = geometry;
  const supported = supportedInfluencesFor(geometry);
  if (!supported.includes(next.rule.cellDefaults.influenceId)) {
    next.rule.cellDefaults.influenceId = supported[0] ?? "neighbors";
  }
  if (supported.length < 2) next.rule.propertyPolicies.influenceId = "uniform";
  for (const cell of Object.values(next.cells)) {
    if (cell.properties?.influenceId && !supported.includes(cell.properties.influenceId)) {
      delete cell.properties.influenceId;
    }
  }
  return next;
}

export function createDesignHistory(design: Readonly<PuzzleDesign>): DesignHistory {
  return { past: [], present: structuredClone(design) as PuzzleDesign, future: [] };
}

export function commitDesignHistory(history: Readonly<DesignHistory>, design: Readonly<PuzzleDesign>): DesignHistory {
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: structuredClone(design) as PuzzleDesign,
    future: [],
  };
}

export function undoDesignHistory(history: Readonly<DesignHistory>): DesignHistory {
  const present = history.past.at(-1);
  if (!present) return structuredClone(history) as DesignHistory;
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  };
}

export function redoDesignHistory(history: Readonly<DesignHistory>): DesignHistory {
  const [present, ...future] = history.future;
  if (!present) return structuredClone(history) as DesignHistory;
  return { past: [...history.past, history.present], present, future };
}

export function duplicatePreset(source: RulePreset): RulePreset {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { ...structuredClone(source), id: `${source.id}-copy-${suffix}`, name: `${source.name}副本` };
}

export function replaceGameInstance(
  source: Readonly<RulePreset>,
  game: Readonly<PuzzleGame>,
): RulePreset {
  return {
    ...structuredClone(source),
    game: structuredClone(game) as PuzzleGame,
  };
}

export type { InfluencePattern, PuzzleDesign };

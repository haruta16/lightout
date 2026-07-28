import type {
  JsonValue,
  MechanicRegistry,
} from "@lightout/engine";
import type {
  BoardGeometry,
  CellRole,
  InfluencePattern,
  PuzzleDesign,
} from "@lightout/mechanics-standard";
import type {
  SolveResult,
  SolverRegistry,
} from "@lightout/solver";

export const GENERATION_LAYERS = [
  "structure",
  "role",
  "influence",
  "goal",
  "initial",
] as const;

export type GenerationLayerId = (typeof GENERATION_LAYERS)[number];
export type GenerationLayerMode = "fixed" | "generate" | "mixed";

export interface GeneratorReference {
  type: string;
  version: number;
  params: Record<string, JsonValue>;
}

export interface GenerationFrame {
  geometry: BoardGeometry;
  width: number;
  height: number;
  stateCount: number;
}

export interface StructureFixedValues {
  frame?: Partial<GenerationFrame>;
  exists: Record<string, boolean>;
}

export interface RoleFixedValues {
  cells: Record<string, CellRole>;
}

export interface InfluenceFixedValues {
  policy?: "uniform" | "per-cell";
  defaultInfluence?: InfluencePattern;
  cells: Record<string, InfluencePattern>;
}

export interface GoalFixedValues {
  cells: Record<string, number | null>;
}

export interface InitialFixedValues {
  cells: Record<string, number>;
}

export interface GenerationLayerDirective<TFixed> {
  mode: GenerationLayerMode;
  generator?: GeneratorReference;
  fixed: TFixed;
}

export interface PuzzleGenerationRequest {
  schemaVersion: 1;
  seed: number;
  baseDesign: PuzzleDesign;
  layers: {
    structure: GenerationLayerDirective<StructureFixedValues>;
    role: GenerationLayerDirective<RoleFixedValues>;
    influence: GenerationLayerDirective<InfluenceFixedValues>;
    goal: GenerationLayerDirective<GoalFixedValues>;
    initial: GenerationLayerDirective<InitialFixedValues>;
  };
  acceptance: GenerationConstraintDefinition[];
  budget: {
    maxAttempts: number;
    maxMilliseconds?: number;
  };
}

export interface GenerationConstraintDefinition {
  type: string;
  params: Record<string, JsonValue>;
}

export interface GenerationConflict {
  code: string;
  path?: string;
  message: string;
}

export interface GenerationMetrics {
  solverStatus: SolveResult["status"];
  solutionLength: number;
  rank: number;
  freeVariables: number;
  minimal: boolean;
  nodeCount: number;
  targetCount: number;
  roleCounts: Record<CellRole, number>;
  influenceCounts: Partial<Record<InfluencePattern, number>>;
}

export interface GenerationReport {
  seed: number;
  attempts: number;
  elapsedMs: number;
  generatorVersions: Record<string, number>;
  metrics: GenerationMetrics;
  warnings: string[];
  conflicts: GenerationConflict[];
}

export interface PuzzleGenerationRecord {
  request: PuzzleGenerationRequest;
  report: GenerationReport;
}

export interface PuzzleGenerationResult {
  status: "generated" | "exhausted" | "invalid-request" | "cancelled";
  design?: PuzzleDesign;
  report: GenerationReport;
}

export interface GenerationProgress {
  attempt: number;
  maxAttempts: number;
  seed: number;
  latestConflicts: GenerationConflict[];
}

export interface GenerationRunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: GenerationProgress) => void;
}

export interface RandomSource {
  next(): number;
  integer(min: number, max: number): number;
  pick<T>(values: readonly T[]): T | undefined;
}

export interface LayerGeneratorContext {
  design: Readonly<PuzzleDesign>;
  request: Readonly<PuzzleGenerationRequest>;
  attempt: number;
  seed: number;
  random: RandomSource;
}

export interface PuzzleLayerGenerator {
  layer: GenerationLayerId;
  type: string;
  version: number;
  generate(context: LayerGeneratorContext): PuzzleDesign;
}

export interface GenerationEvaluationContext {
  design: Readonly<PuzzleDesign>;
  request: Readonly<PuzzleGenerationRequest>;
  definition: Readonly<GenerationConstraintDefinition>;
  solveResult: Readonly<SolveResult>;
  metrics: Readonly<GenerationMetrics>;
}

export interface GenerationEvaluator {
  type: string;
  evaluate(context: GenerationEvaluationContext): GenerationConflict[];
}

export interface GenerationRegistry {
  layerGenerators: Map<string, PuzzleLayerGenerator>;
  evaluators: Map<string, GenerationEvaluator>;
}

export interface GenerationServices {
  mechanics: MechanicRegistry;
  solvers: SolverRegistry;
}

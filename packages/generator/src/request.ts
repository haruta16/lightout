import type { PuzzleDesign } from "@lightout/mechanics-standard";
import type {
  GenerationLayerId,
  GenerationLayerMode,
  PuzzleGenerationRecord,
  PuzzleGenerationRequest,
} from "./types";

const DEFAULT_GENERATORS = {
  structure: { type: "random-structure", version: 1, params: { holeRate: 0.08 } },
  role: { type: "random-roles", version: 1, params: { switchRate: 0.12, lampRate: 0.16 } },
  influence: { type: "random-influences", version: 1, params: {} },
  goal: { type: "random-goal", version: 1, params: { targetRate: 0.72 } },
  initial: { type: "reachable-initial", version: 1, params: {} },
} as const;

export function createGenerationRequest(
  baseDesign: Readonly<PuzzleDesign>,
): PuzzleGenerationRequest {
  const design = structuredClone(baseDesign) as PuzzleDesign;
  return {
    schemaVersion: 1,
    seed: design.seed,
    baseDesign: design,
    layers: {
      structure: {
        mode: "generate",
        generator: structuredClone(DEFAULT_GENERATORS.structure),
        fixed: {
          frame: {
            geometry: design.board.geometry,
            width: design.board.width,
            height: design.board.height,
            stateCount: design.rule.stateCount,
          },
          exists: {},
        },
      },
      role: {
        mode: "generate",
        generator: structuredClone(DEFAULT_GENERATORS.role),
        fixed: { cells: {} },
      },
      influence: {
        mode: "generate",
        generator: structuredClone(DEFAULT_GENERATORS.influence),
        fixed: { cells: {} },
      },
      goal: {
        mode: "generate",
        generator: structuredClone(DEFAULT_GENERATORS.goal),
        fixed: { cells: {} },
      },
      initial: {
        mode: "generate",
        generator: structuredClone(DEFAULT_GENERATORS.initial),
        fixed: { cells: {} },
      },
    },
    acceptance: [{ type: "solvable", params: {} }],
    budget: { maxAttempts: 64 },
  };
}

export function setGenerationLayerMode(
  source: Readonly<PuzzleGenerationRequest>,
  layer: GenerationLayerId,
  mode: GenerationLayerMode,
): PuzzleGenerationRequest {
  const next = structuredClone(source) as PuzzleGenerationRequest;
  next.layers[layer].mode = mode;
  return next;
}

export function isPuzzleGenerationRecord(value: unknown): value is PuzzleGenerationRecord {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (!source.request || typeof source.request !== "object") return false;
  if (!source.report || typeof source.report !== "object") return false;
  const request = source.request as Record<string, unknown>;
  const report = source.report as Record<string, unknown>;
  return (
    request.schemaVersion === 1 &&
    typeof request.seed === "number" &&
    typeof report.seed === "number" &&
    typeof report.attempts === "number"
  );
}

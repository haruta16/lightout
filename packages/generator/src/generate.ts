import {
  BOARD_GEOMETRIES,
  cellPropertiesFor,
  cellRoleFor,
  compilePuzzleDesign,
  formatNodeId,
  propertiesForRole,
  supportedInfluencesFor,
  type CellDesign,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import { solvePuzzle } from "@lightout/solver";
import { createRandom, deriveAttemptSeed } from "./random";
import { layerGeneratorKey } from "./registry";
import type {
  GenerationConflict,
  GenerationLayerId,
  GenerationMetrics,
  GenerationRegistry,
  GenerationReport,
  GenerationRunOptions,
  GenerationServices,
  PuzzleGenerationRequest,
  PuzzleGenerationResult,
} from "./types";

function emptyMetrics(): GenerationMetrics {
  return {
    solverStatus: "unsupported",
    solutionLength: 0,
    rank: 0,
    freeVariables: 0,
    minimal: false,
    nodeCount: 0,
    targetCount: 0,
    roleCounts: { standard: 0, switch: 0, lamp: 0 },
    influenceCounts: {},
  };
}

function report(
  request: Readonly<PuzzleGenerationRequest>,
  startedAt: number,
  attempts: number,
  metrics: GenerationMetrics,
  conflicts: GenerationConflict[],
  generatorVersions: Record<string, number>,
  warnings: string[] = [],
): GenerationReport {
  return {
    seed: request.seed,
    attempts,
    elapsedMs: Date.now() - startedAt,
    generatorVersions,
    metrics,
    warnings,
    conflicts,
  };
}

function requestConflicts(
  request: Readonly<PuzzleGenerationRequest>,
  registry: Readonly<GenerationRegistry>,
): GenerationConflict[] {
  const conflicts: GenerationConflict[] = [];
  if (request.schemaVersion !== 1) {
    conflicts.push({ code: "schema", path: "schemaVersion", message: "Unsupported generation request schema" });
  }
  if (!Number.isFinite(request.seed)) {
    conflicts.push({ code: "seed", path: "seed", message: "Generation seed must be finite" });
  }
  if (!Number.isInteger(request.budget.maxAttempts) || request.budget.maxAttempts < 1) {
    conflicts.push({ code: "budget", path: "budget.maxAttempts", message: "Attempt budget must be a positive integer" });
  } else if (request.budget.maxAttempts > 10_000) {
    conflicts.push({ code: "budget", path: "budget.maxAttempts", message: "Attempt budget cannot exceed 10000" });
  }
  if (
    request.budget.maxMilliseconds !== undefined &&
    (!Number.isFinite(request.budget.maxMilliseconds) || request.budget.maxMilliseconds < 1)
  ) {
    conflicts.push({ code: "budget", path: "budget.maxMilliseconds", message: "Time budget must be a positive number" });
  }
  const fixedFrame = request.layers.structure.fixed.frame;
  const width = fixedFrame?.width ?? request.baseDesign.board.width;
  const height = fixedFrame?.height ?? request.baseDesign.board.height;
  const stateCount = fixedFrame?.stateCount ?? request.baseDesign.rule.stateCount;
  const geometry = fixedFrame?.geometry ?? request.baseDesign.board.geometry;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || width > 12 || height < 2 || height > 12) {
    conflicts.push({ code: "frame", path: "layers.structure.fixed.frame", message: "Generated frame dimensions must be integers between 2 and 12" });
  }
  if (!Number.isInteger(stateCount) || stateCount < 2 || stateCount > 7) {
    conflicts.push({ code: "frame", path: "layers.structure.fixed.frame.stateCount", message: "Generated state count must be an integer between 2 and 7" });
  }
  if (!BOARD_GEOMETRIES.includes(geometry)) {
    conflicts.push({ code: "frame", path: "layers.structure.fixed.frame.geometry", message: "Generated frame uses an unknown topology" });
  }
  for (const layer of Object.keys(request.layers) as GenerationLayerId[]) {
    const directive = request.layers[layer];
    if (directive.mode === "fixed") continue;
    const reference = directive.generator;
    if (!reference) {
      conflicts.push({ code: "generator-missing", path: `layers.${layer}`, message: `${layer} requires a generator` });
      continue;
    }
    const key = layerGeneratorKey(layer, reference.type, reference.version);
    if (!registry.layerGenerators.has(key)) {
      conflicts.push({ code: "generator-unknown", path: `layers.${layer}.generator`, message: `Unknown generator ${key}` });
    }
  }
  for (const [index, definition] of request.acceptance.entries()) {
    if (!registry.evaluators.has(definition.type)) {
      conflicts.push({
        code: "evaluator-unknown",
        path: `acceptance.${index}`,
        message: `Unknown generation evaluator: ${definition.type}`,
      });
    }
  }
  return conflicts;
}

function ensureCellGrid(source: Readonly<PuzzleDesign>): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  const cells: Record<string, CellDesign> = {};
  for (let y = 0; y < next.board.height; y += 1) {
    for (let x = 0; x < next.board.width; x += 1) {
      const nodeId = formatNodeId(x, y);
      cells[nodeId] = next.cells[nodeId] ?? {};
    }
  }
  next.cells = cells;
  const supported = supportedInfluencesFor(next.board.geometry);
  const fallback = supported[0];
  if (fallback && !supported.includes(next.rule.cellDefaults.influenceId)) {
    next.rule.cellDefaults.influenceId = fallback;
  }
  for (const cell of Object.values(next.cells)) {
    const influence = cell.properties?.influenceId;
    if (influence && !supported.includes(influence)) delete cell.properties?.influenceId;
  }
  return next;
}

function applyStructureFixed(
  source: Readonly<PuzzleDesign>,
  request: Readonly<PuzzleGenerationRequest>,
): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  const frame = request.layers.structure.fixed.frame;
  if (frame?.geometry !== undefined) next.board.geometry = frame.geometry;
  if (frame?.width !== undefined) next.board.width = frame.width;
  if (frame?.height !== undefined) next.board.height = frame.height;
  if (frame?.stateCount !== undefined) next.rule.stateCount = frame.stateCount;
  const framed = ensureCellGrid(next);
  for (const [nodeId, exists] of Object.entries(request.layers.structure.fixed.exists)) {
    const cell = framed.cells[nodeId];
    if (!cell) continue;
    cell.properties = { ...cell.properties, exists };
  }
  return framed;
}

function applyRoleFixed(
  source: Readonly<PuzzleDesign>,
  request: Readonly<PuzzleGenerationRequest>,
): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  for (const [nodeId, role] of Object.entries(request.layers.role.fixed.cells)) {
    const cell = next.cells[nodeId];
    if (!cell) continue;
    cell.properties = { ...cell.properties, ...propertiesForRole(role) };
  }
  return next;
}

function applyInfluenceFixed(
  source: Readonly<PuzzleDesign>,
  request: Readonly<PuzzleGenerationRequest>,
): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  const fixed = request.layers.influence.fixed;
  const entries = Object.entries(fixed.cells);
  if (fixed.policy !== undefined) next.rule.propertyPolicies.influenceId = fixed.policy;
  else if (entries.length > 0) next.rule.propertyPolicies.influenceId = "per-cell";
  if (fixed.defaultInfluence !== undefined) {
    next.rule.cellDefaults.influenceId = fixed.defaultInfluence;
  }
  for (const [nodeId, influenceId] of entries) {
    const cell = next.cells[nodeId];
    if (!cell) continue;
    cell.properties = { ...cell.properties, influenceId };
  }
  return next;
}

function applyGoalFixed(
  source: Readonly<PuzzleDesign>,
  request: Readonly<PuzzleGenerationRequest>,
): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  for (const [nodeId, value] of Object.entries(request.layers.goal.fixed.cells)) {
    const cell = next.cells[nodeId];
    if (!cell) continue;
    cell.goal = value === null
      ? undefined
      : { power: { operator: "equals", value } };
  }
  return next;
}

function applyInitialFixed(
  source: Readonly<PuzzleDesign>,
  request: Readonly<PuzzleGenerationRequest>,
): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  for (const [nodeId, value] of Object.entries(request.layers.initial.fixed.cells)) {
    const cell = next.cells[nodeId];
    if (!cell) continue;
    cell.initial = { power: value };
  }
  return next;
}

const fixedAppliers = {
  structure: applyStructureFixed,
  role: applyRoleFixed,
  influence: applyInfluenceFixed,
  goal: applyGoalFixed,
  initial: applyInitialFixed,
} satisfies Record<
  GenerationLayerId,
  (source: Readonly<PuzzleDesign>, request: Readonly<PuzzleGenerationRequest>) => PuzzleDesign
>;

function semanticFixedConflicts(
  design: Readonly<PuzzleDesign>,
  request: Readonly<PuzzleGenerationRequest>,
): GenerationConflict[] {
  const conflicts: GenerationConflict[] = [];
  const fixedNodeMaps: Array<[string, Readonly<Record<string, unknown>>]> = [
    ["structure", request.layers.structure.fixed.exists],
    ["role", request.layers.role.fixed.cells],
    ["influence", request.layers.influence.fixed.cells],
    ["goal", request.layers.goal.fixed.cells],
    ["initial", request.layers.initial.fixed.cells],
  ];
  for (const [layer, values] of fixedNodeMaps) {
    for (const nodeId of Object.keys(values)) {
      if (design.cells[nodeId]) continue;
      conflicts.push({
        code: "fixed-node-missing",
        path: `layers.${layer}.fixed.${nodeId}`,
        message: `${layer} lock references a node outside the generated frame: ${nodeId}`,
      });
    }
  }
  for (const [nodeId, value] of Object.entries(request.layers.goal.fixed.cells)) {
    if (value === null) continue;
    const properties = cellPropertiesFor(design, nodeId);
    if (!properties.exists || !properties.hasPower) {
      conflicts.push({
        code: "goal-lock-incompatible",
        path: `layers.goal.fixed.cells.${nodeId}`,
        message: `Goal lock ${nodeId} requires an existing powered cell`,
      });
    }
  }
  for (const nodeId of Object.keys(request.layers.initial.fixed.cells)) {
    const properties = cellPropertiesFor(design, nodeId);
    if (!properties.exists || !properties.hasPower) {
      conflicts.push({
        code: "initial-lock-incompatible",
        path: `layers.initial.fixed.cells.${nodeId}`,
        message: `Initial lock ${nodeId} requires an existing powered cell`,
      });
    }
  }
  return conflicts;
}

function collectMetrics(
  design: Readonly<PuzzleDesign>,
  solveResult: ReturnType<typeof solvePuzzle>,
): GenerationMetrics {
  const metrics = emptyMetrics();
  metrics.solverStatus = solveResult.status;
  metrics.solutionLength = solveResult.presses.length;
  metrics.rank = solveResult.rank;
  metrics.freeVariables = solveResult.freeVariables;
  metrics.minimal = solveResult.minimal;
  for (const nodeId of Object.keys(design.cells)) {
    const properties = cellPropertiesFor(design, nodeId);
    if (!properties.exists) continue;
    metrics.nodeCount += 1;
    const role = cellRoleFor(properties);
    metrics.roleCounts[role] += 1;
    metrics.influenceCounts[properties.influenceId] =
      (metrics.influenceCounts[properties.influenceId] ?? 0) + 1;
    if (properties.hasPower && design.cells[nodeId]?.goal?.power) metrics.targetCount += 1;
  }
  return metrics;
}

export async function generatePuzzle(
  request: Readonly<PuzzleGenerationRequest>,
  registry: Readonly<GenerationRegistry>,
  services: Readonly<GenerationServices>,
  options: GenerationRunOptions = {},
): Promise<PuzzleGenerationResult> {
  const startedAt = Date.now();
  const invalid = requestConflicts(request, registry);
  if (invalid.length > 0) {
    return {
      status: "invalid-request",
      report: report(request, startedAt, 0, emptyMetrics(), invalid, {}),
    };
  }

  const generatorVersions: Record<string, number> = {};
  let latestMetrics = emptyMetrics();
  let latestConflicts: GenerationConflict[] = [];
  let completedAttempts = 0;
  for (let attempt = 0; attempt < request.budget.maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      return {
        status: "cancelled",
        report: report(
          request,
          startedAt,
          attempt,
          latestMetrics,
          [{ code: "cancelled", message: "Generation was cancelled" }],
          generatorVersions,
        ),
      };
    }
    if (
      request.budget.maxMilliseconds !== undefined &&
      Date.now() - startedAt >= request.budget.maxMilliseconds
    ) break;

    const seed = deriveAttemptSeed(request.seed, attempt);
    const random = createRandom(seed);
    let candidate = structuredClone(request.baseDesign) as PuzzleDesign;
    candidate.seed = seed;
    latestConflicts = [];

    try {
      candidate = applyStructureFixed(candidate, request);
      for (const layer of ["structure", "role", "influence", "goal", "initial"] as const) {
        const directive = request.layers[layer];
        if (directive.mode !== "fixed" && directive.generator) {
          const key = layerGeneratorKey(
            layer,
            directive.generator.type,
            directive.generator.version,
          );
          const generator = registry.layerGenerators.get(key);
          if (!generator) throw new Error(`Unknown generator ${key}`);
          generatorVersions[layer] = generator.version;
          candidate = generator.generate({
            design: candidate,
            request,
            attempt,
            seed,
            random,
          });
        }
        candidate = fixedAppliers[layer](candidate, request);
      }

      latestConflicts.push(...semanticFixedConflicts(candidate, request));
      if (latestConflicts.length === 0) {
        const compiled = compilePuzzleDesign(candidate);
        const solveResult = solvePuzzle(
          compiled.initialState,
          compiled.ruleset,
          services.mechanics,
          services.solvers,
        );
        latestMetrics = collectMetrics(candidate, solveResult);
        for (const definition of request.acceptance) {
          const evaluator = registry.evaluators.get(definition.type);
          if (!evaluator) continue;
          latestConflicts.push(...evaluator.evaluate({
            design: candidate,
            request,
            definition,
            solveResult,
            metrics: latestMetrics,
          }));
        }
      }
    } catch (error) {
      latestConflicts = [{
        code: "candidate-invalid",
        message: error instanceof Error ? error.message : "Candidate generation failed",
      }];
    }

    options.onProgress?.({
      attempt: attempt + 1,
      maxAttempts: request.budget.maxAttempts,
      seed,
      latestConflicts,
    });
    completedAttempts = attempt + 1;
    if (latestConflicts.length === 0) {
      const warnings = latestMetrics.minimal
        ? []
        : ["当前求解器没有保证该参考解为全局最短解。"];
      return {
        status: "generated",
        design: candidate,
        report: report(
          request,
          startedAt,
          attempt + 1,
          latestMetrics,
          [],
          generatorVersions,
          warnings,
        ),
      };
    }
    if ((attempt + 1) % 8 === 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    } else {
      await Promise.resolve();
    }
  }

  return {
    status: "exhausted",
    report: report(
      request,
      startedAt,
      completedAttempts,
      latestMetrics,
      latestConflicts,
      generatorVersions,
    ),
  };
}

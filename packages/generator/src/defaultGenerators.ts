import {
  cellPropertiesFor,
  compilePuzzleDesign,
  formatNodeId,
  propertiesForRole,
  supportedInfluencesFor,
  type CellDesign,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import {
  createGenerationRegistry,
  registerGenerationEvaluator,
  registerLayerGenerator,
} from "./registry";
import type {
  GenerationConflict,
  GenerationRegistry,
  LayerGeneratorContext,
} from "./types";

function numberParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cellIds(design: Readonly<PuzzleDesign>): string[] {
  const ids: string[] = [];
  for (let y = 0; y < design.board.height; y += 1) {
    for (let x = 0; x < design.board.width; x += 1) ids.push(formatNodeId(x, y));
  }
  return ids;
}

function ensureCells(source: Readonly<PuzzleDesign>): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  const cells: Record<string, CellDesign> = {};
  for (const nodeId of cellIds(next)) cells[nodeId] = next.cells[nodeId] ?? {};
  next.cells = cells;
  return next;
}

function structureGenerator(context: LayerGeneratorContext): PuzzleDesign {
  const next = ensureCells(context.design);
  const params = context.request.layers.structure.generator?.params ?? {};
  const holeRate = Math.max(0, Math.min(0.8, numberParam(params, "holeRate", 0.08)));
  const ids = cellIds(next);
  for (const nodeId of ids) {
    const cell = next.cells[nodeId] ?? {};
    cell.properties = {
      ...cell.properties,
      exists: context.random.next() >= holeRate,
    };
    next.cells[nodeId] = cell;
  }
  const center = formatNodeId(
    Math.floor(next.board.width / 2),
    Math.floor(next.board.height / 2),
  );
  const centerCell = next.cells[center] ?? {};
  centerCell.properties = { ...centerCell.properties, exists: true };
  next.cells[center] = centerCell;
  return next;
}

function roleGenerator(context: LayerGeneratorContext): PuzzleDesign {
  const next = structuredClone(context.design) as PuzzleDesign;
  const params = context.request.layers.role.generator?.params ?? {};
  const switchRate = Math.max(0, Math.min(1, numberParam(params, "switchRate", 0.12)));
  const lampRate = Math.max(0, Math.min(1 - switchRate, numberParam(params, "lampRate", 0.16)));
  const existing: string[] = [];
  for (const nodeId of cellIds(next)) {
    const properties = cellPropertiesFor(next, nodeId);
    if (!properties.exists) continue;
    existing.push(nodeId);
    const roll = context.random.next();
    const role = roll < switchRate
      ? "switch"
      : roll < switchRate + lampRate
        ? "lamp"
        : "standard";
    const cell = next.cells[nodeId] ?? {};
    cell.properties = { ...cell.properties, ...propertiesForRole(role) };
    next.cells[nodeId] = cell;
  }
  const anchorId = existing[0];
  if (anchorId) {
    const hasActivation = existing.some((nodeId) => cellPropertiesFor(next, nodeId).activatable);
    const hasPower = existing.some((nodeId) => cellPropertiesFor(next, nodeId).hasPower);
    if (!hasActivation || !hasPower) {
      const cell = next.cells[anchorId] ?? {};
      cell.properties = { ...cell.properties, ...propertiesForRole("standard") };
      next.cells[anchorId] = cell;
    }
  }
  return next;
}

function influenceGenerator(context: LayerGeneratorContext): PuzzleDesign {
  const next = structuredClone(context.design) as PuzzleDesign;
  const supported = supportedInfluencesFor(next.board.geometry);
  const fallback = supported[0];
  if (!fallback) return next;
  next.rule.cellDefaults.influenceId = fallback;
  next.rule.propertyPolicies.influenceId = supported.length > 1 ? "per-cell" : "uniform";
  for (const nodeId of cellIds(next)) {
    const cell = next.cells[nodeId] ?? {};
    cell.properties = {
      ...cell.properties,
      influenceId: context.random.pick(supported) ?? fallback,
    };
    next.cells[nodeId] = cell;
  }
  return next;
}

function goalGenerator(context: LayerGeneratorContext): PuzzleDesign {
  const next = structuredClone(context.design) as PuzzleDesign;
  const params = context.request.layers.goal.generator?.params ?? {};
  const targetRate = Math.max(0.05, Math.min(1, numberParam(params, "targetRate", 0.72)));
  const candidates: string[] = [];
  let targetCount = 0;
  for (const nodeId of cellIds(next)) {
    const cell = next.cells[nodeId] ?? {};
    const properties = cellPropertiesFor(next, nodeId);
    if (!properties.exists || !properties.hasPower) {
      delete cell.goal;
      next.cells[nodeId] = cell;
      continue;
    }
    candidates.push(nodeId);
    if (context.random.next() <= targetRate) {
      cell.goal = {
        power: {
          operator: "equals",
          value: context.random.integer(0, next.rule.stateCount - 1),
        },
      };
      targetCount += 1;
    } else delete cell.goal;
    next.cells[nodeId] = cell;
  }
  const first = candidates[0];
  if (targetCount === 0 && first) {
    const cell = next.cells[first] ?? {};
    cell.goal = { power: { operator: "equals", value: 0 } };
    next.cells[first] = cell;
  }
  return next;
}

function initialGenerator(context: LayerGeneratorContext): PuzzleDesign {
  const next = structuredClone(context.design) as PuzzleDesign;
  next.seed = context.seed;
  for (const cell of Object.values(next.cells)) delete cell.initial;
  const { initialState } = compilePuzzleDesign(next);
  for (const entity of Object.values(initialState.entities)) {
    if (!entity.nodeId || typeof entity.channels.power !== "number") continue;
    const cell = next.cells[entity.nodeId] ?? {};
    cell.initial = { power: entity.channels.power };
    next.cells[entity.nodeId] = cell;
  }
  return next;
}

function conflict(code: string, message: string): GenerationConflict[] {
  return [{ code, message }];
}

export function createDefaultGenerationRegistry(): GenerationRegistry {
  const registry = createGenerationRegistry();
  registerLayerGenerator(registry, {
    layer: "structure",
    type: "random-structure",
    version: 1,
    generate: structureGenerator,
  });
  registerLayerGenerator(registry, {
    layer: "role",
    type: "random-roles",
    version: 1,
    generate: roleGenerator,
  });
  registerLayerGenerator(registry, {
    layer: "influence",
    type: "random-influences",
    version: 1,
    generate: influenceGenerator,
  });
  registerLayerGenerator(registry, {
    layer: "goal",
    type: "random-goal",
    version: 1,
    generate: goalGenerator,
  });
  registerLayerGenerator(registry, {
    layer: "initial",
    type: "reachable-initial",
    version: 1,
    generate: initialGenerator,
  });

  registerGenerationEvaluator(registry, {
    type: "solvable",
    evaluate: ({ solveResult }) => solveResult.status === "solved"
      ? []
      : conflict("not-solvable", solveResult.reason ?? `Solver returned ${solveResult.status}`),
  });
  registerGenerationEvaluator(registry, {
    type: "solution-length",
    evaluate: ({ definition, metrics }) => {
      const min = numberParam(definition.params, "min", 0);
      const max = numberParam(definition.params, "max", Number.POSITIVE_INFINITY);
      return metrics.solutionLength >= min && metrics.solutionLength <= max
        ? []
        : conflict(
            "solution-length",
            `Reference solution length ${metrics.solutionLength} is outside ${min}–${max}`,
          );
    },
  });
  registerGenerationEvaluator(registry, {
    type: "target-count",
    evaluate: ({ definition, metrics }) => {
      const min = numberParam(definition.params, "min", 1);
      const max = numberParam(definition.params, "max", Number.POSITIVE_INFINITY);
      return metrics.targetCount >= min && metrics.targetCount <= max
        ? []
        : conflict("target-count", `Target count ${metrics.targetCount} is outside ${min}–${max}`);
    },
  });
  registerGenerationEvaluator(registry, {
    type: "role-count",
    evaluate: ({ definition, metrics }) => {
      const role = definition.params.role;
      if (role !== "standard" && role !== "switch" && role !== "lamp") {
        return conflict("invalid-role-constraint", "Role count constraint uses an unknown role");
      }
      const min = numberParam(definition.params, "min", 0);
      const max = numberParam(definition.params, "max", Number.POSITIVE_INFINITY);
      const count = metrics.roleCounts[role];
      return count >= min && count <= max
        ? []
        : conflict("role-count", `${role} count ${count} is outside ${min}–${max}`);
    },
  });
  return registry;
}

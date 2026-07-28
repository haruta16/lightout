import { getCommandTargets, type JsonValue } from "@lightout/engine";
import type { SolverContext } from "./types";

export interface AdditiveRuleModel {
  modulus: number;
  anchorEntityIds: string[];
  matrix: number[][];
  target: number[];
}

export type RuleAnalysis =
  | { supported: true; model: AdditiveRuleModel }
  | { supported: false; reason: string };

export function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function paramsOf(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function analyzeAdditiveRule(context: SolverContext): RuleAnalysis {
  const cacheKey = "additive-rule-analysis";
  const cached = context.analysisCache.get(cacheKey);
  if (cached) return cached as RuleAnalysis;

  const finish = (analysis: RuleAnalysis): RuleAnalysis => {
    context.analysisCache.set(cacheKey, analysis);
    return analysis;
  };
  const { state, ruleset, registry } = context;
  const actions = ruleset.actions.filter((action) => action.commandType === "activate");
  if (actions.length !== 1) {
    return finish({ supported: false, reason: "Linear solver requires exactly one activate action" });
  }
  const action = actions[0];
  if (!action) return finish({ supported: false, reason: "Linear solver requires an activate action" });
  if (
    action.selector.type !== "self" &&
    action.selector.type !== "graph-neighborhood" &&
    action.selector.type !== "anchor-influence"
  ) {
    return finish({
      supported: false,
      reason: "Linear solver only supports state-independent standard selectors",
    });
  }
  if (action.effects.length !== 1 || action.effects[0]?.type !== "cycle-channel") {
    return finish({
      supported: false,
      reason: "Linear solver requires one cycle-channel effect",
    });
  }
  const effectParams = paramsOf(action.effects[0].params);
  const channel = typeof effectParams.channel === "string" ? effectParams.channel : "power";
  const rawModulo = effectParams.modulo;
  const rawStep = effectParams.step ?? 1;
  if (
    channel !== "power" ||
    typeof rawModulo !== "number" ||
    !Number.isFinite(rawModulo) ||
    typeof rawStep !== "number" ||
    !Number.isFinite(rawStep)
  ) {
    return finish({
      supported: false,
      reason: "Linear solver requires finite power modulo and step parameters",
    });
  }
  const modulus = Math.max(2, Math.floor(rawModulo));
  const step = modulo(Math.floor(rawStep), modulus);
  const metadataModulus = ruleset.metadata?.stateCount;
  if (metadataModulus !== undefined && metadataModulus !== modulus) {
    return finish({ supported: false, reason: "Ruleset state count and effect modulo do not match" });
  }

  if (ruleset.settleSystems.length > 0) {
    return finish({ supported: false, reason: "Linear solver does not support settle systems" });
  }
  if ((ruleset.lossConditions?.length ?? 0) > 0) {
    return finish({ supported: false, reason: "Linear solver does not support loss conditions" });
  }
  if (ruleset.goals.length !== 1 || ruleset.goals[0]?.type !== "channel-targets-match") {
    return finish({
      supported: false,
      reason: "Linear solver requires one channel-targets-match goal",
    });
  }
  const goalParams = paramsOf(ruleset.goals[0].params);
  const goalChannel = typeof goalParams.channel === "string" ? goalParams.channel : "power";
  const goalTargets = paramsOf(goalParams.targets ?? {});
  if (goalChannel !== "power") {
    return finish({ supported: false, reason: "Linear solver requires power target constraints" });
  }

  const entities = Object.values(state.entities)
    .sort((first, second) => {
      const a = first.nodeId ? state.board.nodes[first.nodeId] : undefined;
      const b = second.nodeId ? state.board.nodes[second.nodeId] : undefined;
      return (
        (a?.position.y ?? 0) - (b?.position.y ?? 0) ||
        (a?.position.x ?? 0) - (b?.position.x ?? 0) ||
        first.id.localeCompare(second.id)
      );
    });
  const powerEntities = entities.filter((entity) => entity.properties.hasPower === true);
  const anchors = entities.filter((entity) => entity.properties.activatable === true);
  if (powerEntities.length === 0 || anchors.length === 0) {
    return finish({ supported: false, reason: "Linear solver requires power cells and activatable cells" });
  }
  for (const entity of powerEntities) {
    const power = entity.channels.power;
    if (typeof power !== "number" || !Number.isInteger(power) || power < 0 || power >= modulus) {
      return finish({ supported: false, reason: `Entity ${entity.id} has invalid power` });
    }
  }

  const constrained = powerEntities.flatMap((entity) => {
    const goal = goalTargets[entity.id];
    if (goal === undefined) return [];
    if (typeof goal !== "number" || !Number.isInteger(goal) || goal < 0 || goal >= modulus) {
      return [{ entity, goal: Number.NaN }];
    }
    return [{ entity, goal }];
  });
  if (constrained.some(({ goal }) => Number.isNaN(goal))) {
    return finish({ supported: false, reason: "Linear solver found an invalid goal target" });
  }
  if (constrained.length === 0) {
    return finish({ supported: false, reason: "Linear solver requires at least one goal constraint" });
  }

  const anchorEntityIds = anchors.map((entity) => entity.id);
  const rowByEntityId = new Map(constrained.map(({ entity }, row) => [entity.id, row]));
  const matrix = Array.from({ length: constrained.length }, () =>
    Array<number>(anchorEntityIds.length).fill(0),
  );
  anchorEntityIds.forEach((anchorEntityId, column) => {
    const targets = getCommandTargets(
      state,
      { type: "activate", anchorEntityId },
      ruleset,
      registry,
    );
    for (const targetId of targets) {
      const row = rowByEntityId.get(targetId);
      if (row !== undefined && matrix[row]) {
        matrix[row][column] = modulo((matrix[row][column] ?? 0) + step, modulus);
      }
    }
  });
  const target = constrained.map(({ entity, goal }) =>
    modulo(goal - Number(entity.channels.power), modulus),
  );

  return finish({
    supported: true,
    model: { modulus, anchorEntityIds, matrix, target },
  });
}

import { getCommandTargets, type JsonValue } from "@lightout/engine";
import type { SolverContext } from "./types";

export interface AdditiveRuleModel {
  modulus: number;
  step: number;
  goalValue: number;
  entityIds: string[];
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
  const { state, ruleset, registry } = context;
  const actions = ruleset.actions.filter((action) => action.commandType === "activate");
  if (actions.length !== 1) {
    return { supported: false, reason: "Linear solver requires exactly one activate action" };
  }
  const action = actions[0];
  if (!action) return { supported: false, reason: "Linear solver requires an activate action" };
  if (action.selector.type !== "self" && action.selector.type !== "graph-neighborhood") {
    return {
      supported: false,
      reason: "Linear solver only supports state-independent standard selectors",
    };
  }
  const selectorParams = paramsOf(action.selector.params);
  if (selectorParams.kind !== undefined && selectorParams.kind !== "light") {
    return { supported: false, reason: "Linear solver requires light targets" };
  }

  if (action.effects.length !== 1 || action.effects[0]?.type !== "cycle-channel") {
    return {
      supported: false,
      reason: "Linear solver requires one cycle-channel effect",
    };
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
    return {
      supported: false,
      reason: "Linear solver requires finite power modulo and step parameters",
    };
  }
  const modulus = Math.max(2, Math.floor(rawModulo));
  const step = modulo(Math.floor(rawStep), modulus);
  const metadataModulus = ruleset.metadata?.stateCount;
  if (metadataModulus !== undefined && metadataModulus !== modulus) {
    return { supported: false, reason: "Ruleset state count and effect modulo do not match" };
  }

  if (ruleset.settleSystems.length > 0) {
    return { supported: false, reason: "Linear solver does not support settle systems" };
  }
  if ((ruleset.lossConditions?.length ?? 0) > 0) {
    return { supported: false, reason: "Linear solver does not support loss conditions" };
  }
  if (ruleset.goals.length !== 1 || ruleset.goals[0]?.type !== "all-channel-equals") {
    return {
      supported: false,
      reason: "Linear solver requires one all-channel-equals goal",
    };
  }
  const goalParams = paramsOf(ruleset.goals[0].params);
  const goalKind = typeof goalParams.kind === "string" ? goalParams.kind : "light";
  const goalChannel = typeof goalParams.channel === "string" ? goalParams.channel : "power";
  const rawGoal = goalParams.value ?? 0;
  if (
    goalKind !== "light" ||
    goalChannel !== "power" ||
    typeof rawGoal !== "number" ||
    !Number.isInteger(rawGoal)
  ) {
    return { supported: false, reason: "Linear solver requires an integer light power goal" };
  }
  const goalValue = modulo(rawGoal, modulus);
  const metadataGoal = ruleset.metadata?.goalValue;
  if (metadataGoal !== undefined && metadataGoal !== goalValue) {
    return { supported: false, reason: "Ruleset metadata and goal value do not match" };
  }

  const entities = Object.values(state.entities)
    .filter((entity) => entity.kind === "light")
    .sort((first, second) => {
      const a = first.nodeId ? state.board.nodes[first.nodeId] : undefined;
      const b = second.nodeId ? state.board.nodes[second.nodeId] : undefined;
      return (
        (a?.position.y ?? 0) - (b?.position.y ?? 0) ||
        (a?.position.x ?? 0) - (b?.position.x ?? 0) ||
        first.id.localeCompare(second.id)
      );
    });
  if (entities.length === 0) {
    return { supported: false, reason: "Linear solver requires at least one light entity" };
  }
  for (const entity of entities) {
    const power = entity.channels.power;
    if (typeof power !== "number" || !Number.isInteger(power) || power < 0 || power >= modulus) {
      return { supported: false, reason: `Entity ${entity.id} has invalid power` };
    }
  }

  const entityIds = entities.map((entity) => entity.id);
  const index = new Map(entityIds.map((id, position) => [id, position]));
  const matrix = Array.from({ length: entityIds.length }, () =>
    Array<number>(entityIds.length).fill(0),
  );
  entityIds.forEach((anchorEntityId, column) => {
    const targets = getCommandTargets(
      state,
      { type: "activate", anchorEntityId },
      ruleset,
      registry,
    );
    for (const targetId of targets) {
      const row = index.get(targetId);
      if (row !== undefined && matrix[row]) {
        matrix[row][column] = modulo((matrix[row][column] ?? 0) + step, modulus);
      }
    }
  });
  const target = entityIds.map((entityId) => {
    const current = Number(state.entities[entityId]?.channels.power ?? 0);
    return modulo(goalValue - current, modulus);
  });

  return {
    supported: true,
    model: { modulus, step, goalValue, entityIds, matrix, target },
  };
}

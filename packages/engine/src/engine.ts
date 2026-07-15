import { applyMutations, cloneState } from "./state";
import { assertValidGameState } from "./validation";
import type {
  GameCommand,
  GameEvent,
  GameState,
  MechanicRegistry,
  Ruleset,
  TurnResult,
} from "./types";

export function getCommandTargets(
  state: Readonly<GameState>,
  command: Readonly<GameCommand>,
  ruleset: Readonly<Ruleset>,
  registry: MechanicRegistry,
): string[] {
  const action = ruleset.actions.find(
    (candidate) => candidate.commandType === command.type,
  );
  if (!action) return [];
  const selector = registry.selectors.get(action.selector.type);
  if (!selector) throw new Error(`Unknown selector mechanic: ${action.selector.type}`);
  return selector({ state, command, definition: action.selector });
}

function rejected(state: Readonly<GameState>, reason: string): TurnResult {
  return {
    state: cloneState(state),
    events: [{ type: "command-rejected", reason }],
    accepted: false,
  };
}

function evaluateAllGoals(
  state: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
  registry: MechanicRegistry,
): boolean {
  return (
    ruleset.goals.length > 0 &&
    ruleset.goals.every((definition) => {
      const handler = registry.goals.get(definition.type);
      if (!handler) throw new Error(`Unknown goal mechanic: ${definition.type}`);
      return handler({ state, definition });
    })
  );
}

function evaluateAnyLoss(
  state: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
  registry: MechanicRegistry,
): boolean {
  return (ruleset.lossConditions ?? []).some((definition) => {
    const handler = registry.goals.get(definition.type);
    if (!handler) throw new Error(`Unknown loss mechanic: ${definition.type}`);
    return handler({ state, definition });
  });
}

export function dispatch(
  source: Readonly<GameState>,
  command: Readonly<GameCommand>,
  ruleset: Readonly<Ruleset>,
  registry: MechanicRegistry,
): TurnResult {
  assertValidGameState(source, ruleset);
  if (source.status !== "playing") return rejected(source, "game-not-playing");

  const action = ruleset.actions.find(
    (candidate) => candidate.commandType === command.type,
  );
  if (!action) return rejected(source, `unsupported-command:${command.type}`);

  if (
    command.anchorEntityId &&
    !source.entities[command.anchorEntityId]
  ) {
    return rejected(source, `unknown-anchor:${command.anchorEntityId}`);
  }

  const targets = getCommandTargets(source, command, ruleset, registry);
  if (targets.length === 0) return rejected(source, "no-valid-targets");

  let state = cloneState(source);
  const events: GameEvent[] = [
    {
      type: "command-accepted",
      commandType: command.type,
      anchorEntityId: command.anchorEntityId,
    },
  ];

  for (const definition of action.effects) {
    const effect = registry.effects.get(definition.type);
    if (!effect) throw new Error(`Unknown effect mechanic: ${definition.type}`);
    const mutations = effect({
      state,
      command,
      targetEntityIds: targets,
      definition,
    });
    const applied = applyMutations(state, mutations);
    state = applied.state;
    events.push(...applied.events);
  }

  const maxIterations = ruleset.maxSettleIterations ?? 32;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (const definition of ruleset.settleSystems) {
      const system = registry.systems.get(definition.type);
      if (!system) throw new Error(`Unknown settle mechanic: ${definition.type}`);
      const mutations = system({ state, definition, iteration });
      if (mutations.length === 0) continue;
      const applied = applyMutations(state, mutations);
      if (applied.events.length === 0) continue;
      state = applied.state;
      events.push(...applied.events, {
        type: "system-settled",
        systemType: definition.type,
        iteration,
      });
      changed = true;
    }
    if (!changed) break;
    if (iteration === maxIterations - 1) {
      throw new Error(`Settle pipeline did not converge after ${maxIterations} iterations`);
    }
  }

  state.turn += 1;
  const previousStatus = state.status;
  if (evaluateAllGoals(state, ruleset, registry)) state.status = "won";
  else if (evaluateAnyLoss(state, ruleset, registry)) state.status = "lost";
  if (state.status !== previousStatus) {
    events.push({ type: "status-changed", from: previousStatus, to: state.status });
  }

  assertValidGameState(state, ruleset);

  return { state, events, accepted: true };
}

export function evaluateState(
  source: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
  registry: MechanicRegistry,
): GameState {
  const state = cloneState(source);
  if (evaluateAllGoals(state, ruleset, registry)) state.status = "won";
  else if (evaluateAnyLoss(state, ruleset, registry)) state.status = "lost";
  else state.status = "playing";
  return state;
}

import type {
  EffectHandler,
  GoalHandler,
  MechanicRegistry,
  SelectorHandler,
  SystemHandler,
} from "./types";

export function createMechanicRegistry(): MechanicRegistry {
  return {
    selectors: new Map(),
    effects: new Map(),
    goals: new Map(),
    systems: new Map(),
  };
}

function register<T>(map: Map<string, T>, type: string, handler: T): void {
  if (map.has(type)) throw new Error(`Mechanic already registered: ${type}`);
  map.set(type, handler);
}

export function registerSelector(
  registry: MechanicRegistry,
  type: string,
  handler: SelectorHandler,
): void {
  register(registry.selectors, type, handler);
}

export function registerEffect(
  registry: MechanicRegistry,
  type: string,
  handler: EffectHandler,
): void {
  register(registry.effects, type, handler);
}

export function registerGoal(
  registry: MechanicRegistry,
  type: string,
  handler: GoalHandler,
): void {
  register(registry.goals, type, handler);
}

export function registerSystem(
  registry: MechanicRegistry,
  type: string,
  handler: SystemHandler,
): void {
  register(registry.systems, type, handler);
}

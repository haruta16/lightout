import type {
  ChannelSchema,
  GameEntity,
  GameState,
  Ruleset,
} from "./types";

function channelIsValid(value: unknown, schema: ChannelSchema): boolean {
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "string") {
    return (
      typeof value === "string" &&
      (!schema.values || schema.values.includes(value))
    );
  }
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (!schema.integer || Number.isInteger(value)) &&
    (schema.min === undefined || value >= schema.min) &&
    (schema.max === undefined || value <= schema.max)
  );
}

function validateEntity(
  entity: Readonly<GameEntity>,
  ruleset: Readonly<Ruleset>,
): string[] {
  const schema = ruleset.entityKinds?.[entity.kind];
  if (!schema) return [`Entity ${entity.id} has unregistered kind: ${entity.kind}`];
  const errors: string[] = [];
  for (const [channel, channelSchema] of Object.entries(schema.requiredChannels)) {
    if (!(channel in entity.channels)) {
      errors.push(`Entity ${entity.id} is missing channel: ${channel}`);
      continue;
    }
    if (!channelIsValid(entity.channels[channel], channelSchema)) {
      errors.push(`Entity ${entity.id} has invalid channel value: ${channel}`);
    }
  }
  if (!schema.allowAdditionalChannels) {
    for (const channel of Object.keys(entity.channels)) {
      if (!(channel in schema.requiredChannels)) {
        errors.push(`Entity ${entity.id} has undeclared channel: ${channel}`);
      }
    }
  }
  return errors;
}

export function validateGameState(
  state: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
): string[] {
  const errors: string[] = [];
  for (const entity of Object.values(state.entities)) {
    if (ruleset.entityKinds) errors.push(...validateEntity(entity, ruleset));
    if (entity.nodeId && !state.board.nodes[entity.nodeId]) {
      errors.push(`Entity ${entity.id} references unknown node: ${entity.nodeId}`);
    }
  }
  return errors;
}

export function assertValidGameState(
  state: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
): void {
  const errors = validateGameState(state, ruleset);
  if (errors.length > 0) throw new Error(`Invalid game state:\n${errors.join("\n")}`);
}

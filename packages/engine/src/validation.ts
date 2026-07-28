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
  const requiredProperties = schema.requiredProperties ?? {};
  const requiredChannels = schema.requiredChannels ?? {};
  const optionalChannels = schema.optionalChannels ?? {};
  for (const [property, propertySchema] of Object.entries(requiredProperties)) {
    if (!(property in entity.properties)) {
      errors.push(`Entity ${entity.id} is missing property: ${property}`);
      continue;
    }
    if (!channelIsValid(entity.properties[property], propertySchema)) {
      errors.push(`Entity ${entity.id} has invalid property value: ${property}`);
    }
  }
  if (!schema.allowAdditionalProperties) {
    for (const property of Object.keys(entity.properties)) {
      if (!(property in requiredProperties)) {
        errors.push(`Entity ${entity.id} has undeclared property: ${property}`);
      }
    }
  }
  for (const [channel, channelSchema] of Object.entries(requiredChannels)) {
    if (!(channel in entity.channels)) {
      errors.push(`Entity ${entity.id} is missing channel: ${channel}`);
      continue;
    }
    if (!channelIsValid(entity.channels[channel], channelSchema)) {
      errors.push(`Entity ${entity.id} has invalid channel value: ${channel}`);
    }
  }
  for (const [channel, channelSchema] of Object.entries(optionalChannels)) {
    if (channel in entity.channels && !channelIsValid(entity.channels[channel], channelSchema)) {
      errors.push(`Entity ${entity.id} has invalid channel value: ${channel}`);
    }
  }
  if (!schema.allowAdditionalChannels) {
    for (const channel of Object.keys(entity.channels)) {
      if (!(channel in requiredChannels) && !(channel in optionalChannels)) {
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
  for (const [nodeKey, node] of Object.entries(state.board.nodes)) {
    if (nodeKey !== node.id) errors.push(`Board node key does not match id: ${nodeKey} != ${node.id}`);
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      errors.push(`Board node ${node.id} has an invalid position`);
    }
  }
  const seenEdges = new Set<string>();
  for (const edge of state.board.edges) {
    if (!state.board.nodes[edge.from]) errors.push(`Board edge references unknown source: ${edge.from}`);
    if (!state.board.nodes[edge.to]) errors.push(`Board edge references unknown target: ${edge.to}`);
    if (edge.relation.length === 0) errors.push(`Board edge ${edge.from} -> ${edge.to} has an empty relation`);
    const edgeKey = `${edge.from}\u0000${edge.to}\u0000${edge.relation}`;
    if (seenEdges.has(edgeKey)) errors.push(`Board contains a duplicate edge: ${edge.from} -> ${edge.to} (${edge.relation})`);
    seenEdges.add(edgeKey);
  }
  for (const [entityKey, entity] of Object.entries(state.entities)) {
    if (entityKey !== entity.id) errors.push(`Entity key does not match id: ${entityKey} != ${entity.id}`);
    if (ruleset.entityKinds) errors.push(...validateEntity(entity, ruleset));
    if (entity.nodeId && !state.board.nodes[entity.nodeId]) {
      errors.push(`Entity ${entity.id} references unknown node: ${entity.nodeId}`);
    }
  }
  if (!Number.isInteger(state.turn) || state.turn < 0) errors.push("Game turn must be a non-negative integer");
  if (!Number.isInteger(state.seed) || state.seed < 0) errors.push("Game seed must be a non-negative integer");
  if (!["playing", "won", "lost"].includes(state.status)) errors.push(`Unknown game status: ${state.status}`);
  for (const [counter, value] of Object.entries(state.counters)) {
    if (!Number.isFinite(value)) errors.push(`Counter ${counter} must be finite`);
  }
  for (const [item, value] of Object.entries(state.inventory)) {
    if (!Number.isFinite(value)) errors.push(`Inventory ${item} must be finite`);
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

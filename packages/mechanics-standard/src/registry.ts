import {
  createMechanicRegistry,
  registerEffect,
  registerGoal,
  registerSelector,
  registerSystem,
  type BoardNode,
  type EntityId,
  type GameEntity,
  type MechanicRegistry,
  type StateMutation,
} from "@lightout/engine";
import {
  booleanParam,
  numberParam,
  objectParams,
  stringArrayParam,
  stringParam,
} from "./params";

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function entitiesAtNode(
  entities: Record<EntityId, GameEntity>,
  nodeIds: readonly string[],
  kind?: string,
): EntityId[] {
  const allowed = new Set(nodeIds);
  return Object.values(entities)
    .filter((entity) => entity.nodeId && allowed.has(entity.nodeId))
    .filter((entity) => !kind || entity.kind === kind)
    .map((entity) => entity.id);
}

export function createStandardRegistry(): MechanicRegistry {
  const registry = createMechanicRegistry();

  registerSelector(registry, "self", ({ state, command, definition }) => {
    const anchor = command.anchorEntityId
      ? state.entities[command.anchorEntityId]
      : undefined;
    if (!anchor) return [];
    const params = objectParams(definition.params);
    const kind = stringParam(params, "kind", anchor.kind);
    return anchor.kind === kind ? [anchor.id] : [];
  });

  registerSelector(registry, "graph-neighborhood", ({
    state,
    command,
    definition,
  }) => {
    const anchor = command.anchorEntityId
      ? state.entities[command.anchorEntityId]
      : undefined;
    if (!anchor?.nodeId) return [];
    const params = objectParams(definition.params);
    const relations = new Set(
      stringArrayParam(params, "relations", ["orthogonal"]),
    );
    const includeSelf = booleanParam(params, "includeSelf", true);
    const kind = stringParam(params, "kind", anchor.kind);
    const nodeIds = state.board.edges
      .filter((edge) => edge.from === anchor.nodeId && relations.has(edge.relation))
      .map((edge) => edge.to);
    if (includeSelf) nodeIds.push(anchor.nodeId);
    return unique(entitiesAtNode(state.entities, nodeIds, kind));
  });

  registerEffect(registry, "cycle-channel", ({
    state,
    targetEntityIds,
    definition,
  }) => {
    const params = objectParams(definition.params);
    const channel = stringParam(params, "channel", "power");
    const modulo = Math.max(2, Math.floor(numberParam(params, "modulo", 2)));
    const step = Math.floor(numberParam(params, "step", 1));
    return targetEntityIds.map<StateMutation>((entityId) => {
      const entity = state.entities[entityId];
      const current = Number(entity?.channels[channel] ?? 0);
      const value = ((current + step) % modulo + modulo) % modulo;
      return { type: "set-channel", entityId, channel, value };
    });
  });

  registerEffect(registry, "set-channel", ({
    command,
    targetEntityIds,
    definition,
  }) => {
    const params = objectParams(definition.params);
    const channel = stringParam(params, "channel", "power");
    const payloadKey = stringParam(params, "payloadKey", "value");
    const configured = params.value;
    const payload = command.payload?.[payloadKey];
    const value = payload ?? configured ?? 0;
    if (typeof value === "object") throw new Error("set-channel requires a primitive value");
    return targetEntityIds.map((entityId) => ({
      type: "set-channel" as const,
      entityId,
      channel,
      value,
    }));
  });

  registerGoal(registry, "all-channel-equals", ({ state, definition }) => {
    const params = objectParams(definition.params);
    const channel = stringParam(params, "channel", "power");
    const kind = stringParam(params, "kind", "light");
    const expected = params.value ?? 0;
    const entities = Object.values(state.entities).filter(
      (entity) => entity.kind === kind,
    );
    return (
      entities.length > 0 &&
      entities.every((entity) => entity.channels[channel] === expected)
    );
  });

  registerGoal(registry, "counter-at-least", ({ state, definition }) => {
    const params = objectParams(definition.params);
    const counter = stringParam(params, "counter", "score");
    const value = numberParam(params, "value", 1);
    return (state.counters[counter] ?? 0) >= value;
  });

  registerSystem(registry, "gravity-down", ({ state, definition }) => {
    const params = objectParams(definition.params);
    const kind = stringParam(params, "kind", "light");
    const occupied = new Set(
      Object.values(state.entities)
        .filter((entity) => entity.nodeId)
        .map((entity) => entity.nodeId as string),
    );
    const nodesByColumn = new Map<number, BoardNode[]>();
    for (const node of Object.values(state.board.nodes)) {
      const column = nodesByColumn.get(node.position.x) ?? [];
      column.push(node);
      nodesByColumn.set(node.position.x, column);
    }
    for (const nodes of nodesByColumn.values()) {
      nodes.sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));
    }
    const fallingEntities = Object.values(state.entities)
      .filter((entity) => entity.kind === kind && entity.nodeId)
      .sort((a, b) => {
        const first = a.nodeId ? state.board.nodes[a.nodeId] : undefined;
        const second = b.nodeId ? state.board.nodes[b.nodeId] : undefined;
        return (
          (second?.position.y ?? 0) - (first?.position.y ?? 0) ||
          a.id.localeCompare(b.id)
        );
      });
    const mutations: StateMutation[] = [];
    for (const entity of fallingEntities) {
      if (!entity.nodeId) continue;
      const current = state.board.nodes[entity.nodeId];
      if (!current) continue;
      const column = nodesByColumn.get(current.position.x);
      const currentIndex = column?.findIndex((node) => node.id === current.id) ?? -1;
      const destination = currentIndex >= 0 ? column?.[currentIndex + 1] : undefined;
      if (!destination || occupied.has(destination.id)) continue;
      occupied.delete(entity.nodeId);
      occupied.add(destination.id);
      mutations.push({
        type: "move-entity",
        entityId: entity.id,
        toNodeId: destination.id,
      });
    }
    return mutations;
  });

  return registry;
}

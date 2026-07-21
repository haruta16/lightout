import type {
  GameEvent,
  GameState,
  JsonPrimitive,
  StateMutation,
} from "./types";

export function cloneState(state: Readonly<GameState>): GameState {
  return structuredClone(state) as GameState;
}

export function applyMutations(
  source: Readonly<GameState>,
  mutations: readonly StateMutation[],
): { state: GameState; events: GameEvent[] } {
  const state = cloneState(source);
  const events: GameEvent[] = [];

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "set-channel": {
        const entity = state.entities[mutation.entityId];
        if (!entity) throw new Error(`Unknown entity: ${mutation.entityId}`);
        const from = entity.channels[mutation.channel] ?? null;
        if (from === mutation.value) break;
        entity.channels[mutation.channel] = mutation.value as JsonPrimitive;
        events.push({
          type: "channel-changed",
          entityId: mutation.entityId,
          channel: mutation.channel,
          from,
          to: mutation.value,
        });
        break;
      }
      case "move-entity": {
        const entity = state.entities[mutation.entityId];
        if (!entity) throw new Error(`Unknown entity: ${mutation.entityId}`);
        if (!state.board.nodes[mutation.toNodeId]) {
          throw new Error(`Unknown destination node: ${mutation.toNodeId}`);
        }
        const fromNodeId = entity.nodeId;
        if (fromNodeId === mutation.toNodeId) break;
        entity.nodeId = mutation.toNodeId;
        events.push({
          type: "entity-moved",
          entityId: mutation.entityId,
          fromNodeId,
          toNodeId: mutation.toNodeId,
        });
        break;
      }
      case "remove-entity": {
        const entity = state.entities[mutation.entityId];
        if (!entity) break;
        delete state.entities[mutation.entityId];
        events.push({
          type: "entity-removed",
          entityId: mutation.entityId,
          fromNodeId: entity.nodeId,
        });
        break;
      }
      case "set-counter": {
        const from = state.counters[mutation.counter] ?? 0;
        if (from === mutation.value) break;
        state.counters[mutation.counter] = mutation.value;
        events.push({
          type: "counter-changed",
          counter: mutation.counter,
          from,
          to: mutation.value,
        });
        break;
      }
    }
  }

  return { state, events };
}

export function stableEntityStateKey(state: Readonly<GameState>): string {
  return Object.values(state.entities)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entity) => {
      const channels = Object.entries(entity.channels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${String(value)}`)
        .join(",");
      return `${entity.id}@${entity.nodeId ?? "-"}[${channels}]`;
    })
    .join("|");
}

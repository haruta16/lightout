export type NodeId = string;
export type EntityId = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Point {
  x: number;
  y: number;
}

export interface BoardNode {
  id: NodeId;
  position: Point;
  tags: string[];
}

export interface BoardEdge {
  from: NodeId;
  to: NodeId;
  relation: string;
}

export interface BoardTopology {
  nodes: Record<NodeId, BoardNode>;
  edges: BoardEdge[];
}

export interface GameEntity {
  id: EntityId;
  kind: string;
  nodeId?: NodeId;
  tags: string[];
  channels: Record<string, JsonPrimitive>;
}

export type GameStatus = "playing" | "won" | "lost";

export interface GameState {
  schemaVersion: 1;
  board: BoardTopology;
  entities: Record<EntityId, GameEntity>;
  counters: Record<string, number>;
  inventory: Record<string, number>;
  turn: number;
  status: GameStatus;
  seed: number;
}

export interface Definition<TParams extends JsonValue = JsonValue> {
  type: string;
  params: TParams;
}

export type SelectorDefinition = Definition;
export type EffectDefinition = Definition;
export type GoalDefinition = Definition;
export type SystemDefinition = Definition;

export interface ActionDefinition {
  id: string;
  commandType: string;
  selector: SelectorDefinition;
  effects: EffectDefinition[];
}

export type ChannelSchema =
  | {
      type: "number";
      integer?: boolean;
      min?: number;
      max?: number;
    }
  | { type: "string"; values?: string[] }
  | { type: "boolean" };

export interface EntityKindSchema {
  requiredChannels: Record<string, ChannelSchema>;
  allowAdditionalChannels?: boolean;
}

export interface Ruleset {
  id: string;
  name: string;
  actions: ActionDefinition[];
  goals: GoalDefinition[];
  lossConditions?: GoalDefinition[];
  settleSystems: SystemDefinition[];
  entityKinds?: Record<string, EntityKindSchema>;
  maxSettleIterations?: number;
  metadata?: Record<string, JsonValue>;
}

export interface GameCommand {
  type: string;
  anchorEntityId?: EntityId;
  payload?: Record<string, JsonValue>;
}

export type StateMutation =
  | {
      type: "set-channel";
      entityId: EntityId;
      channel: string;
      value: JsonPrimitive;
    }
  | { type: "move-entity"; entityId: EntityId; toNodeId: NodeId }
  | { type: "remove-entity"; entityId: EntityId }
  | { type: "set-counter"; counter: string; value: number };

export type GameEvent =
  | {
      type: "command-accepted";
      commandType: string;
      anchorEntityId?: EntityId;
    }
  | {
      type: "channel-changed";
      entityId: EntityId;
      channel: string;
      from: JsonPrimitive;
      to: JsonPrimitive;
    }
  | {
      type: "entity-moved";
      entityId: EntityId;
      fromNodeId?: NodeId;
      toNodeId: NodeId;
    }
  | { type: "entity-removed"; entityId: EntityId; fromNodeId?: NodeId }
  | { type: "counter-changed"; counter: string; from: number; to: number }
  | { type: "system-settled"; systemType: string; iteration: number }
  | { type: "status-changed"; from: GameStatus; to: GameStatus }
  | { type: "command-rejected"; reason: string };

export interface TurnResult {
  state: GameState;
  events: GameEvent[];
  accepted: boolean;
}

export interface SelectorContext {
  state: Readonly<GameState>;
  command: Readonly<GameCommand>;
  definition: Readonly<SelectorDefinition>;
}

export interface EffectContext {
  state: Readonly<GameState>;
  command: Readonly<GameCommand>;
  targetEntityIds: readonly EntityId[];
  definition: Readonly<EffectDefinition>;
}

export interface GoalContext {
  state: Readonly<GameState>;
  definition: Readonly<GoalDefinition>;
}

export interface SystemContext {
  state: Readonly<GameState>;
  definition: Readonly<SystemDefinition>;
  iteration: number;
}

export type SelectorHandler = (context: SelectorContext) => EntityId[];
export type EffectHandler = (context: EffectContext) => StateMutation[];
export type GoalHandler = (context: GoalContext) => boolean;
export type SystemHandler = (context: SystemContext) => StateMutation[];

export interface MechanicRegistry {
  selectors: Map<string, SelectorHandler>;
  effects: Map<string, EffectHandler>;
  goals: Map<string, GoalHandler>;
  systems: Map<string, SystemHandler>;
}

export interface HistoryState {
  past: GameState[];
  present: GameState;
  future: GameState[];
}

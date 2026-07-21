import type { EntityId, GameEntity, GameState } from "@lightout/engine";
import { getBoardGeometryDefinition, type BoardGeometry } from "./topology";

export const INFLUENCE_DEFINITIONS = {
  cross: { relations: ["orthogonal"] },
  diagonal: { relations: ["diagonal"] },
  king: { relations: ["orthogonal", "diagonal"] },
  neighbors: { relations: ["adjacent"] },
  "row-column": { relations: ["same-row", "same-column"] },
} as const;

export type InfluencePattern = keyof typeof INFLUENCE_DEFINITIONS;
export const INFLUENCE_PATTERNS = Object.keys(
  INFLUENCE_DEFINITIONS,
) as InfluencePattern[];

export function isInfluencePattern(value: unknown): value is InfluencePattern {
  return typeof value === "string" && INFLUENCE_PATTERNS.includes(value as InfluencePattern);
}

export function relationsFor(pattern: InfluencePattern): string[] {
  return [...INFLUENCE_DEFINITIONS[pattern].relations];
}

export interface InfluenceTargetOptions {
  channel?: string;
  includeSelf?: boolean;
  kind?: string;
}

export function influenceTargetsForAnchor(
  state: Readonly<GameState>,
  anchor: Readonly<GameEntity>,
  options: InfluenceTargetOptions = {},
): EntityId[] {
  if (!anchor.nodeId) return [];

  const channel = options.channel ?? "influence";
  const configured = anchor.channels[channel];
  if (!isInfluencePattern(configured)) return [];

  const relations = new Set(relationsFor(configured));
  const nodeIds = new Set<string>();
  if (options.includeSelf ?? true) nodeIds.add(anchor.nodeId);
  for (const edge of state.board.edges) {
    if (edge.from === anchor.nodeId && relations.has(edge.relation)) {
      nodeIds.add(edge.to);
    }
  }

  const kind = options.kind ?? anchor.kind;
  return Object.values(state.entities)
    .filter((entity) => entity.nodeId && nodeIds.has(entity.nodeId))
    .filter((entity) => entity.kind === kind)
    .map((entity) => entity.id);
}

export function supportedInfluencesFor(geometry: BoardGeometry): InfluencePattern[] {
  const supported = new Set(getBoardGeometryDefinition(geometry).supportedRelations);
  return INFLUENCE_PATTERNS.filter((pattern) =>
    INFLUENCE_DEFINITIONS[pattern].relations.every((relation) => supported.has(relation)),
  );
}

import type { BoardTopology, EntityId, GameEntity, GameState } from "@lightout/engine";
import type { BoardGeometry } from "./topology";

export type InfluencePath =
  | { type: "neighbors"; relations: string[]; distance: number }
  | { type: "ray"; directions: string[]; maxDistance: number | null };

export interface InfluenceProfile {
  id: string;
  includeSelf: boolean;
  geometries: BoardGeometry[];
  paths: InfluencePath[];
}

export const BUILT_IN_INFLUENCE_PROFILES = {
  cross: {
    id: "cross",
    includeSelf: true,
    geometries: ["square"],
    paths: [{ type: "neighbors", relations: ["orthogonal"], distance: 1 }],
  },
  diagonal: {
    id: "diagonal",
    includeSelf: true,
    geometries: ["square"],
    paths: [{ type: "neighbors", relations: ["diagonal"], distance: 1 }],
  },
  king: {
    id: "king",
    includeSelf: true,
    geometries: ["square"],
    paths: [{ type: "neighbors", relations: ["adjacent"], distance: 1 }],
  },
  neighbors: {
    id: "neighbors",
    includeSelf: true,
    geometries: ["square", "hex", "triangle"],
    paths: [{ type: "neighbors", relations: ["adjacent"], distance: 1 }],
  },
  "row-column": {
    id: "row-column",
    includeSelf: true,
    geometries: ["square"],
    paths: [{
      type: "ray",
      directions: ["north", "east", "south", "west"],
      maxDistance: null,
    }],
  },
} satisfies Record<string, InfluenceProfile>;

export type InfluencePattern = keyof typeof BUILT_IN_INFLUENCE_PROFILES;
export const INFLUENCE_PATTERNS = Object.keys(BUILT_IN_INFLUENCE_PROFILES) as InfluencePattern[];

export function isInfluencePattern(value: unknown): value is InfluencePattern {
  return typeof value === "string" && INFLUENCE_PATTERNS.includes(value as InfluencePattern);
}

type RelationIndex = Map<string, Map<string, string[]>>;
const relationIndexCache = new WeakMap<BoardTopology, RelationIndex>();

function relationIndex(board: Readonly<BoardTopology>): RelationIndex {
  const cached = relationIndexCache.get(board as BoardTopology);
  if (cached) return cached;
  const index: RelationIndex = new Map();
  for (const edge of board.edges) {
    let byRelation = index.get(edge.from);
    if (!byRelation) {
      byRelation = new Map();
      index.set(edge.from, byRelation);
    }
    const targets = byRelation.get(edge.relation) ?? [];
    targets.push(edge.to);
    byRelation.set(edge.relation, targets);
  }
  relationIndexCache.set(board as BoardTopology, index);
  return index;
}

function neighborTargets(
  index: Readonly<RelationIndex>,
  origin: string,
  relations: readonly string[],
  distance: number,
): Set<string> {
  const allowed = new Set(relations);
  const visited = new Set([origin]);
  let frontier = new Set([origin]);
  for (let step = 0; step < distance; step += 1) {
    const next = new Set<string>();
    for (const nodeId of frontier) {
      const byRelation = index.get(nodeId);
      for (const relation of allowed) {
        for (const target of byRelation?.get(relation) ?? []) {
          if (!visited.has(target)) {
            visited.add(target);
            next.add(target);
          }
        }
      }
    }
    frontier = next;
  }
  visited.delete(origin);
  return visited;
}

function rayTargets(
  index: Readonly<RelationIndex>,
  origin: string,
  directions: readonly string[],
  maxDistance: number | null,
): Set<string> {
  const result = new Set<string>();
  for (const direction of directions) {
    let current = origin;
    let distance = 0;
    const visited = new Set([origin]);
    while (maxDistance === null || distance < maxDistance) {
      const next = index.get(current)?.get(`direction:${direction}`)?.[0];
      if (!next || visited.has(next)) break;
      visited.add(next);
      result.add(next);
      current = next;
      distance += 1;
    }
  }
  return result;
}

export function influenceNodeIds(
  board: Readonly<BoardTopology>,
  anchorNodeId: string,
  profile: Readonly<InfluenceProfile>,
): string[] {
  const nodeIds = new Set<string>();
  const index = relationIndex(board);
  if (profile.includeSelf) nodeIds.add(anchorNodeId);
  for (const path of profile.paths) {
    const targets = path.type === "neighbors"
      ? neighborTargets(index, anchorNodeId, path.relations, path.distance)
      : rayTargets(index, anchorNodeId, path.directions, path.maxDistance);
    for (const nodeId of targets) nodeIds.add(nodeId);
  }
  return [...nodeIds];
}

export function influenceTargetsForAnchor(
  state: Readonly<GameState>,
  anchor: Readonly<GameEntity>,
): EntityId[] {
  if (!anchor.nodeId || anchor.properties.activatable !== true) return [];
  const influenceId = anchor.properties.influenceId;
  if (!isInfluencePattern(influenceId)) return [];
  const nodeIds = new Set(influenceNodeIds(
    state.board,
    anchor.nodeId,
    BUILT_IN_INFLUENCE_PROFILES[influenceId],
  ));
  return Object.values(state.entities)
    .filter((entity) => entity.nodeId && nodeIds.has(entity.nodeId))
    .filter((entity) => entity.properties.hasPower === true)
    .map((entity) => entity.id);
}

export function supportedInfluencesFor(geometry: BoardGeometry): InfluencePattern[] {
  return INFLUENCE_PATTERNS.filter((id) =>
    (BUILT_IN_INFLUENCE_PROFILES[id].geometries as BoardGeometry[]).includes(geometry),
  );
}

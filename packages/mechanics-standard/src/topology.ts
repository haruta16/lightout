import type { BoardEdge, BoardNode, BoardTopology } from "@lightout/engine";

export const BOARD_GEOMETRIES = ["square", "hex", "triangle"] as const;
export type BoardGeometry = (typeof BOARD_GEOMETRIES)[number];

export interface RectTopologyOptions {
  width: number;
  height: number;
}

export interface BoardTopologyOptions extends RectTopologyOptions {
  geometry?: BoardGeometry;
}

export interface BoardGeometryDefinition {
  id: BoardGeometry;
  nodeTag: `geometry:${BoardGeometry}`;
  maxNeighbors: number;
  supportedRelations: readonly string[];
  create: (options: RectTopologyOptions) => BoardTopology;
}

export interface GridCoordinate {
  x: number;
  y: number;
}

export function formatNodeId(x: number, y: number): string {
  return `n:${x}:${y}`;
}

export function parseNodeId(value: string): GridCoordinate | null {
  const match = /^n:(\d+):(\d+)$/.exec(value);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function addDirectedPair(
  edges: BoardEdge[],
  from: string,
  to: string,
  relation: string,
): void {
  edges.push({ from, to, relation }, { from: to, to: from, relation });
}

export function createRectTopology({ width, height }: RectTopologyOptions): BoardTopology {
  const nodes: Record<string, BoardNode> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = formatNodeId(x, y);
      nodes[id] = { id, position: { x, y }, tags: ["playable", "geometry:square"] };
    }
  }

  const edges: BoardEdge[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = formatNodeId(x, y);
      const right = formatNodeId(x + 1, y);
      const below = formatNodeId(x, y + 1);
      for (const to of [right, below]) {
        if (!nodes[to]) continue;
        addDirectedPair(edges, from, to, "orthogonal");
        addDirectedPair(edges, from, to, "adjacent");
      }
      if (nodes[below]) edges.push({ from, to: below, relation: "down" });

      for (const to of [formatNodeId(x - 1, y + 1), formatNodeId(x + 1, y + 1)]) {
        if (!nodes[to]) continue;
        addDirectedPair(edges, from, to, "diagonal");
        addDirectedPair(edges, from, to, "adjacent");
      }

      for (let otherX = x + 1; otherX < width; otherX += 1) {
        addDirectedPair(edges, from, formatNodeId(otherX, y), "same-row");
      }
      for (let otherY = y + 1; otherY < height; otherY += 1) {
        addDirectedPair(edges, from, formatNodeId(x, otherY), "same-column");
      }
    }
  }
  return { nodes, edges };
}

export function createHexTopology({ width, height }: RectTopologyOptions): BoardTopology {
  const nodes: Record<string, BoardNode> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = formatNodeId(x, y);
      nodes[id] = {
        id,
        position: { x: x + (y % 2 === 0 ? 0 : 0.5), y: y * (Math.sqrt(3) / 2) },
        tags: ["playable", "geometry:hex"],
      };
    }
  }
  const edges: BoardEdge[] = [];
  const directionsForRow = (y: number): ReadonlyArray<readonly [number, number]> =>
    y % 2 === 0
      ? [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]]
      : [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = formatNodeId(x, y);
      for (const [dx, dy] of directionsForRow(y)) {
        const to = formatNodeId(x + dx, y + dy);
        if (nodes[to]) edges.push({ from, to, relation: "adjacent" });
      }
    }
  }
  return { nodes, edges };
}

export function createTriangleTopology({ width, height }: RectTopologyOptions): BoardTopology {
  const nodes: Record<string, BoardNode> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pointsUp = (x + y) % 2 === 0;
      const id = formatNodeId(x, y);
      nodes[id] = {
        id,
        position: { x: x + (y % 2 === 0 ? 0 : 0.25), y: y * 0.82 },
        tags: ["playable", "geometry:triangle", pointsUp ? "orientation:up" : "orientation:down"],
      };
    }
  }
  const edges: BoardEdge[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = formatNodeId(x, y);
      const verticalDirection = (x + y) % 2 === 0 ? 1 : -1;
      for (const to of [formatNodeId(x - 1, y), formatNodeId(x + 1, y), formatNodeId(x, y + verticalDirection)]) {
        if (nodes[to]) edges.push({ from, to, relation: "adjacent" });
      }
    }
  }
  return { nodes, edges };
}

export const BOARD_GEOMETRY_DEFINITIONS: Record<BoardGeometry, BoardGeometryDefinition> = {
  square: {
    id: "square",
    nodeTag: "geometry:square",
    maxNeighbors: 8,
    supportedRelations: ["orthogonal", "diagonal", "adjacent", "same-row", "same-column", "down"],
    create: createRectTopology,
  },
  hex: {
    id: "hex",
    nodeTag: "geometry:hex",
    maxNeighbors: 6,
    supportedRelations: ["adjacent"],
    create: createHexTopology,
  },
  triangle: {
    id: "triangle",
    nodeTag: "geometry:triangle",
    maxNeighbors: 3,
    supportedRelations: ["adjacent"],
    create: createTriangleTopology,
  },
};

export function getBoardGeometryDefinition(geometry: BoardGeometry): BoardGeometryDefinition {
  return BOARD_GEOMETRY_DEFINITIONS[geometry];
}

export function geometryFromNodeTags(tags: readonly string[]): BoardGeometry {
  return BOARD_GEOMETRIES.find(
    (geometry) => tags.includes(BOARD_GEOMETRY_DEFINITIONS[geometry].nodeTag),
  ) ?? "square";
}

export function createBoardTopology({ geometry = "square", ...options }: BoardTopologyOptions): BoardTopology {
  return getBoardGeometryDefinition(geometry).create(options);
}

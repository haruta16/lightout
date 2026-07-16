import type { BoardEdge, BoardNode, BoardTopology } from "@lightout/engine";

export type BoardShape = "full" | "diamond" | "ring";
export const BOARD_GEOMETRIES = ["square", "hex", "triangle"] as const;
export type BoardGeometry = (typeof BOARD_GEOMETRIES)[number];

export interface RectTopologyOptions {
  width: number;
  height: number;
  shape?: BoardShape;
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

function nodeId(x: number, y: number): string {
  return `n:${x}:${y}`;
}

function includeCoordinate(
  x: number,
  y: number,
  width: number,
  height: number,
  shape: BoardShape,
): boolean {
  if (shape === "full") return true;
  const nx = (x + 0.5 - width / 2) / (width / 2);
  const ny = (y + 0.5 - height / 2) / (height / 2);
  if (shape === "diamond") return Math.abs(nx) + Math.abs(ny) <= 1.05;
  const outer = nx * nx + ny * ny <= 1.05;
  const inner = nx * nx + ny * ny < 0.24;
  return outer && !inner;
}

function addDirectedPair(
  edges: BoardEdge[],
  from: string,
  to: string,
  relation: string,
): void {
  edges.push({ from, to, relation }, { from: to, to: from, relation });
}

export function createRectTopology({
  width,
  height,
  shape = "full",
}: RectTopologyOptions): BoardTopology {
  const nodes: Record<string, BoardNode> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!includeCoordinate(x, y, width, height, shape)) continue;
      const id = nodeId(x, y);
      nodes[id] = {
        id,
        position: { x, y },
        tags: ["playable", "geometry:square"],
      };
    }
  }

  const edges: BoardEdge[] = [];
  const nodeList = Object.values(nodes);
  for (let a = 0; a < nodeList.length; a += 1) {
    const first = nodeList[a];
    if (!first) continue;
    for (let b = a + 1; b < nodeList.length; b += 1) {
      const second = nodeList[b];
      if (!second) continue;
      const dx = Math.abs(first.position.x - second.position.x);
      const dy = Math.abs(first.position.y - second.position.y);
      if (dx + dy === 1) {
        addDirectedPair(edges, first.id, second.id, "orthogonal");
        addDirectedPair(edges, first.id, second.id, "adjacent");
      }
      if (dx === 1 && dy === 1) {
        addDirectedPair(edges, first.id, second.id, "diagonal");
        addDirectedPair(edges, first.id, second.id, "adjacent");
      }
      if (dy === 0) addDirectedPair(edges, first.id, second.id, "same-row");
      if (dx === 0) addDirectedPair(edges, first.id, second.id, "same-column");
    }
  }
  return { nodes, edges };
}

export function createHexTopology({
  width,
  height,
  shape = "full",
}: RectTopologyOptions): BoardTopology {
  const nodes: Record<string, BoardNode> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!includeCoordinate(x, y, width, height, shape)) continue;
      const id = nodeId(x, y);
      nodes[id] = {
        id,
        position: {
          x: x + (y % 2 === 0 ? 0 : 0.5),
          y: y * (Math.sqrt(3) / 2),
        },
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
      const from = nodeId(x, y);
      if (!nodes[from]) continue;
      for (const [dx, dy] of directionsForRow(y)) {
        const to = nodeId(x + dx, y + dy);
        if (nodes[to]) edges.push({ from, to, relation: "adjacent" });
      }
    }
  }

  return { nodes, edges };
}

export function createTriangleTopology({
  width,
  height,
  shape = "full",
}: RectTopologyOptions): BoardTopology {
  const nodes: Record<string, BoardNode> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!includeCoordinate(x, y, width, height, shape)) continue;
      const pointsUp = (x + y) % 2 === 0;
      const id = nodeId(x, y);
      nodes[id] = {
        id,
        position: {
          x: x + (y % 2 === 0 ? 0 : 0.25),
          y: y * 0.82,
        },
        tags: [
          "playable",
          "geometry:triangle",
          pointsUp ? "orientation:up" : "orientation:down",
        ],
      };
    }
  }

  const edges: BoardEdge[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = nodeId(x, y);
      if (!nodes[from]) continue;
      const verticalDirection = (x + y) % 2 === 0 ? 1 : -1;
      const neighbors = [
        nodeId(x - 1, y),
        nodeId(x + 1, y),
        nodeId(x, y + verticalDirection),
      ];
      for (const to of neighbors) {
        if (nodes[to]) edges.push({ from, to, relation: "adjacent" });
      }
    }
  }

  return { nodes, edges };
}

export const BOARD_GEOMETRY_DEFINITIONS: Record<
  BoardGeometry,
  BoardGeometryDefinition
> = {
  square: {
    id: "square",
    nodeTag: "geometry:square",
    maxNeighbors: 8,
    supportedRelations: [
      "orthogonal",
      "diagonal",
      "adjacent",
      "same-row",
      "same-column",
    ],
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

export function getBoardGeometryDefinition(
  geometry: BoardGeometry,
): BoardGeometryDefinition {
  return BOARD_GEOMETRY_DEFINITIONS[geometry];
}

export function geometryFromNodeTags(tags: readonly string[]): BoardGeometry {
  return (
    BOARD_GEOMETRIES.find(
      (geometry) => tags.includes(BOARD_GEOMETRY_DEFINITIONS[geometry].nodeTag),
    ) ?? "square"
  );
}

export function createBoardTopology({
  geometry = "square",
  ...options
}: BoardTopologyOptions): BoardTopology {
  return getBoardGeometryDefinition(geometry).create(options);
}

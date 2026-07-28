import type { BoardEdge, BoardNode, BoardTopology } from "@lightout/engine";

export const BOARD_GEOMETRIES = ["square", "hex", "triangle"] as const;
export type BoardGeometry = (typeof BOARD_GEOMETRIES)[number];

export interface RectTopologyOptions {
  width: number;
  height: number;
  includedNodeIds?: ReadonlySet<string>;
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

function shouldInclude(id: string, includedNodeIds?: ReadonlySet<string>): boolean {
  return !includedNodeIds || includedNodeIds.has(id);
}

function addRelations(
  edges: BoardEdge[],
  from: string,
  to: string,
  relations: readonly string[],
): void {
  for (const relation of relations) edges.push({ from, to, relation });
}

function createNodes(
  width: number,
  height: number,
  includedNodeIds: ReadonlySet<string> | undefined,
  create: (x: number, y: number, id: string) => BoardNode,
): Record<string, BoardNode> {
  const nodes: Record<string, BoardNode> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = formatNodeId(x, y);
      if (shouldInclude(id, includedNodeIds)) nodes[id] = create(x, y, id);
    }
  }
  return nodes;
}

const SQUARE_DIRECTIONS = [
  { dx: 0, dy: -1, direction: "north", group: "orthogonal" },
  { dx: 1, dy: 0, direction: "east", group: "orthogonal" },
  { dx: 0, dy: 1, direction: "south", group: "orthogonal" },
  { dx: -1, dy: 0, direction: "west", group: "orthogonal" },
  { dx: 1, dy: -1, direction: "north-east", group: "diagonal" },
  { dx: 1, dy: 1, direction: "south-east", group: "diagonal" },
  { dx: -1, dy: 1, direction: "south-west", group: "diagonal" },
  { dx: -1, dy: -1, direction: "north-west", group: "diagonal" },
] as const;

export function createRectTopology({ width, height, includedNodeIds }: RectTopologyOptions): BoardTopology {
  const nodes = createNodes(width, height, includedNodeIds, (x, y, id) => ({
    id,
    position: { x, y },
    tags: ["playable", "geometry:square"],
  }));
  const edges: BoardEdge[] = [];
  for (const node of Object.values(nodes)) {
    const coordinate = parseNodeId(node.id);
    if (!coordinate) continue;
    for (const { dx, dy, direction, group } of SQUARE_DIRECTIONS) {
      const to = formatNodeId(coordinate.x + dx, coordinate.y + dy);
      if (!nodes[to]) continue;
      addRelations(edges, node.id, to, ["adjacent", group, `direction:${direction}`]);
      if (direction === "south") edges.push({ from: node.id, to, relation: "down" });
    }
  }
  return { nodes, edges };
}

export function createHexTopology({ width, height, includedNodeIds }: RectTopologyOptions): BoardTopology {
  const nodes = createNodes(width, height, includedNodeIds, (x, y, id) => ({
    id,
    position: { x: x + (y % 2 === 0 ? 0 : 0.5), y: y * (Math.sqrt(3) / 2) },
    tags: ["playable", "geometry:hex"],
  }));
  const edges: BoardEdge[] = [];
  const directionsForRow = (y: number) => y % 2 === 0
    ? [
        [-1, 0, "west"], [1, 0, "east"], [-1, -1, "north-west"],
        [0, -1, "north-east"], [-1, 1, "south-west"], [0, 1, "south-east"],
      ] as const
    : [
        [-1, 0, "west"], [1, 0, "east"], [0, -1, "north-west"],
        [1, -1, "north-east"], [0, 1, "south-west"], [1, 1, "south-east"],
      ] as const;
  for (const node of Object.values(nodes)) {
    const coordinate = parseNodeId(node.id);
    if (!coordinate) continue;
    for (const [dx, dy, direction] of directionsForRow(coordinate.y)) {
      const to = formatNodeId(coordinate.x + dx, coordinate.y + dy);
      if (nodes[to]) addRelations(edges, node.id, to, ["adjacent", `direction:${direction}`]);
    }
  }
  return { nodes, edges };
}

export function createTriangleTopology({ width, height, includedNodeIds }: RectTopologyOptions): BoardTopology {
  const nodes = createNodes(width, height, includedNodeIds, (x, y, id) => {
    const pointsUp = (x + y) % 2 === 0;
    return {
      id,
      position: { x: x + (y % 2 === 0 ? 0 : 0.25), y: y * 0.82 },
      tags: ["playable", "geometry:triangle", pointsUp ? "orientation:up" : "orientation:down"],
    };
  });
  const edges: BoardEdge[] = [];
  for (const node of Object.values(nodes)) {
    const coordinate = parseNodeId(node.id);
    if (!coordinate) continue;
    const vertical = (coordinate.x + coordinate.y) % 2 === 0 ? 1 : -1;
    const directions = [
      [-1, 0, "left"], [1, 0, "right"], [0, vertical, "vertical"],
    ] as const;
    for (const [dx, dy, direction] of directions) {
      const to = formatNodeId(coordinate.x + dx, coordinate.y + dy);
      if (nodes[to]) addRelations(edges, node.id, to, ["adjacent", `direction:${direction}`]);
    }
  }
  return { nodes, edges };
}

export const BOARD_GEOMETRY_DEFINITIONS: Record<BoardGeometry, BoardGeometryDefinition> = {
  square: {
    id: "square",
    nodeTag: "geometry:square",
    maxNeighbors: 8,
    supportedRelations: ["adjacent", "orthogonal", "diagonal", "down", ...SQUARE_DIRECTIONS.map(({ direction }) => `direction:${direction}`)],
    create: createRectTopology,
  },
  hex: {
    id: "hex",
    nodeTag: "geometry:hex",
    maxNeighbors: 6,
    supportedRelations: ["adjacent", "direction:west", "direction:east", "direction:north-west", "direction:north-east", "direction:south-west", "direction:south-east"],
    create: createHexTopology,
  },
  triangle: {
    id: "triangle",
    nodeTag: "geometry:triangle",
    maxNeighbors: 3,
    supportedRelations: ["adjacent", "direction:left", "direction:right", "direction:vertical"],
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

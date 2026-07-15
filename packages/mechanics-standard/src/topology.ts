import type { BoardEdge, BoardNode, BoardTopology } from "@lightout/engine";

export type BoardShape = "full" | "diamond" | "ring";

export interface RectTopologyOptions {
  width: number;
  height: number;
  shape?: BoardShape;
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
      nodes[id] = { id, position: { x, y }, tags: ["playable"] };
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
      if (dx + dy === 1) addDirectedPair(edges, first.id, second.id, "orthogonal");
      if (dx === 1 && dy === 1) addDirectedPair(edges, first.id, second.id, "diagonal");
      if (dy === 0) addDirectedPair(edges, first.id, second.id, "same-row");
      if (dx === 0) addDirectedPair(edges, first.id, second.id, "same-column");
    }
  }
  return { nodes, edges };
}

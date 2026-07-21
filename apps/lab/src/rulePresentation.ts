import {
  getBoardGeometryDefinition,
  type BoardGeometry,
  type InfluencePattern,
} from "@lightout/mechanics-standard";

export const influenceLabels: Record<InfluencePattern, string> = {
  cross: "十字相邻",
  diagonal: "对角相邻",
  king: "八方向",
  neighbors: "全部相邻",
  "row-column": "整行整列",
};

export const influenceSymbols: Record<InfluencePattern, string> = {
  cross: "+",
  diagonal: "×",
  king: "✣",
  neighbors: "✦",
  "row-column": "↔",
};

export const geometryNames: Record<BoardGeometry, string> = {
  square: "方形",
  hex: "六边形",
  triangle: "三角形",
};

export const geometrySymbols: Record<BoardGeometry, string> = {
  square: "□",
  hex: "⬡",
  triangle: "△",
};

export function geometryLabel(geometry: BoardGeometry): string {
  const definition = getBoardGeometryDefinition(geometry);
  return `${geometryNames[geometry]} · ${definition.maxNeighbors} 邻接`;
}

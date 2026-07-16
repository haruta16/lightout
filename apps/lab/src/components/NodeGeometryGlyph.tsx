import type { ReactNode } from "react";
import type { BoardGeometry } from "@lightout/mechanics-standard";

type GeometryRenderer = (tags: readonly string[]) => ReactNode;

function trianglePoints(tags: readonly string[], radius: number): string {
  const pointsUp = tags.includes("orientation:up");
  const top = -radius;
  const bottom = radius * 0.68;
  const points = `0,${top} ${radius * 0.92},${bottom} ${-radius * 0.92},${bottom}`;
  return pointsUp ? points : `0,${-top} ${radius * 0.92},${-bottom} ${-radius * 0.92},${-bottom}`;
}

const GEOMETRY_RENDERERS: Record<BoardGeometry, GeometryRenderer> = {
  square: () => (
    <>
      <rect className="cell-hit" x="-39" y="-39" width="78" height="78" rx="8" />
      <rect className="cell-rim" x="-32" y="-32" width="64" height="64" rx="5" />
      <rect className="cell-core" x="-23" y="-23" width="46" height="46" rx="3" />
    </>
  ),
  hex: () => (
    <>
      <polygon className="cell-hit" points="0,-42 37,-21 37,21 0,42 -37,21 -37,-21" />
      <polygon className="cell-rim" points="0,-34 30,-17 30,17 0,34 -30,17 -30,-17" />
      <polygon className="cell-core" points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5" />
    </>
  ),
  triangle: (tags) => (
    <>
      <polygon className="cell-hit" points={trianglePoints(tags, 43)} />
      <polygon className="cell-rim" points={trianglePoints(tags, 35)} />
      <polygon className="cell-core" points={trianglePoints(tags, 25)} />
    </>
  ),
};

export function NodeGeometryGlyph({
  geometry,
  tags,
}: {
  geometry: BoardGeometry;
  tags: readonly string[];
}) {
  return GEOMETRY_RENDERERS[geometry](tags);
}

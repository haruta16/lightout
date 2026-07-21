import type { CSSProperties } from "react";
import type { GameEntity, GameState } from "@lightout/engine";
import {
  geometryFromNodeTags,
  isInfluencePattern,
} from "@lightout/mechanics-standard";
import type { EditorSurface, WorkspaceMode } from "../workspace";
import { influenceSymbols } from "../rulePresentation";
import { NodeGeometryGlyph } from "./NodeGeometryGlyph";

interface BoardCanvasProps {
  state: GameState;
  stateCount: number;
  mode: WorkspaceMode;
  editorSurface: EditorSurface;
  hovered: string | null;
  selected: string | null;
  affected: Set<string>;
  changed: Set<string>;
  solution: Map<string, number>;
  showSolution: boolean;
  onHover: (id: string | null) => void;
  onActivate: (entity: GameEntity) => void;
}

export function BoardCanvas({
  state,
  stateCount,
  mode,
  editorSurface,
  hovered,
  selected,
  affected,
  changed,
  solution,
  showSolution,
  onHover,
  onActivate,
}: BoardCanvasProps) {
  const nodes = Object.values(state.board.nodes);
  const maxX = Math.max(1, ...nodes.map((node) => node.position.x));
  const maxY = Math.max(1, ...nodes.map((node) => node.position.y));
  const byNode = new Map(
    Object.values(state.entities)
      .filter((entity) => entity.nodeId)
      .map((entity) => [entity.nodeId as string, entity]),
  );
  const unit = 92;
  const pad = 68;
  const width = maxX * unit + pad * 2;
  const height = maxY * unit + pad * 2;
  const visibleSurface = mode === "play" ? "initial" : editorSurface;

  return (
    <svg
      className={`board-svg mode-${mode} surface-${visibleSurface}`}
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label="开关联动实验棋盘"
    >
      <defs>
        <pattern id="board-grid" width="23" height="23" patternUnits="userSpaceOnUse">
          <path d="M 23 0 L 0 0 0 23" className="board-grid-line" />
        </pattern>
        <radialGradient id="board-vignette">
          <stop offset="0" stopColor="var(--board-glow)" stopOpacity=".16" />
          <stop offset="1" stopColor="var(--board-glow)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect className="board-grid" width="100%" height="100%" fill="url(#board-grid)" />
      <rect width="100%" height="100%" fill="url(#board-vignette)" />

      {hovered && [...affected]
        .filter((id) => id !== hovered)
        .map((id) => {
          const source = state.entities[hovered];
          const target = state.entities[id];
          const sourceNode = source?.nodeId ? state.board.nodes[source.nodeId] : undefined;
          const targetNode = target?.nodeId ? state.board.nodes[target.nodeId] : undefined;
          if (!sourceNode || !targetNode) return null;
          return (
            <g key={`wire:${id}`} className="influence-connection">
              <line className="influence-wire-backdrop" x1={pad + sourceNode.position.x * unit} y1={pad + sourceNode.position.y * unit} x2={pad + targetNode.position.x * unit} y2={pad + targetNode.position.y * unit} />
              <line className="influence-wire" x1={pad + sourceNode.position.x * unit} y1={pad + sourceNode.position.y * unit} x2={pad + targetNode.position.x * unit} y2={pad + targetNode.position.y * unit} />
            </g>
          );
        })}

      {nodes.map((node) => {
        const entity = byNode.get(node.id);
        if (!entity) return null;
        const power = Number(entity.channels.power ?? 0);
        const goal = Number(entity.channels.goal ?? -1);
        const influence = isInfluencePattern(entity.channels.influence)
          ? entity.channels.influence
          : "cross";
        const isUnconstrained = goal < 0;
        const displayValue = visibleSurface === "goal" ? Math.max(0, goal) : power;
        const solutionCount = solution.get(entity.id) ?? 0;
        const geometry = geometryFromNodeTags(node.tags);
        const style = {
          "--state-hue": String(42 + displayValue * 18),
          "--state-level": String(displayValue / Math.max(1, stateCount - 1)),
        } as CSSProperties;
        const visualLabel = visibleSurface === "goal"
          ? isUnconstrained ? "—" : String(goal)
          : visibleSurface === "influence"
            ? influenceSymbols[influence]
            : stateCount > 2 ? String(power) : "";
        const ariaDetail = visibleSurface === "goal"
          ? isUnconstrained ? "不约束" : `目标状态 ${goal}`
          : visibleSurface === "influence" ? `${influence} 影响` : `状态 ${power}`;
        return (
          <g
            key={entity.id}
            className={[
              "cell",
              `shape-${geometry}`,
              goal < 0 || power === goal ? "is-goal" : "is-active",
              visibleSurface === "goal" ? "is-target-preview" : "",
              visibleSurface === "goal" && isUnconstrained ? "is-unconstrained" : "",
              visibleSurface === "influence" ? "is-influence-preview" : "",
              affected.has(entity.id) ? "is-affected" : "",
              hovered === entity.id ? "is-anchor" : "",
              selected === entity.id ? "is-selected" : "",
              changed.has(entity.id) ? "is-changed" : "",
            ].join(" ")}
            style={style}
            transform={`translate(${pad + node.position.x * unit} ${pad + node.position.y * unit})`}
            role="button"
            tabIndex={0}
            aria-label={`节点 ${node.id}，${ariaDetail}`}
            onMouseEnter={() => onHover(entity.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(entity.id)}
            onBlur={() => onHover(null)}
            onClick={() => onActivate(entity)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onActivate(entity);
              }
            }}
          >
            <NodeGeometryGlyph geometry={geometry} tags={node.tags} />
            {visualLabel && <text className="cell-value" y="5">{visualLabel}</text>}
            {showSolution && solutionCount > 0 && (
              <g className="solution-mark" transform="translate(28 -28)">
                <circle r="11" /><text y="4">{solutionCount === 1 ? "+" : `×${solutionCount}`}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

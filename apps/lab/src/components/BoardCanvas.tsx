import type { CSSProperties } from "react";
import type { GameState } from "@lightout/engine";
import {
  cellRoleFor,
  cellPropertiesFor,
  createBoardTopology,
  geometryFromNodeTags,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import { type EditorSurface, type WorkspaceMode } from "../workspace";
import { cellRoleSymbols, influenceSymbols } from "../rulePresentation";
import { NodeGeometryGlyph } from "./NodeGeometryGlyph";

interface BoardCanvasProps {
  state: GameState;
  design: PuzzleDesign;
  mode: WorkspaceMode;
  editorSurface: EditorSurface;
  hovered: string | null;
  selected: string | null;
  affected: Set<string>;
  changed: Set<string>;
  solution: Map<string, number>;
  showSolution: boolean;
  generationLocked?: Set<string>;
  onHover: (nodeId: string | null) => void;
  onActivate: (nodeId: string) => void;
}

export function BoardCanvas({
  state,
  design,
  mode,
  editorSurface,
  hovered,
  selected,
  affected,
  changed,
  solution,
  showSolution,
  generationLocked = new Set(),
  onHover,
  onActivate,
}: BoardCanvasProps) {
  const layout = createBoardTopology({ ...design.board });
  const nodes = Object.values(mode === "edit" ? layout.nodes : state.board.nodes);
  const maxX = Math.max(1, ...Object.values(layout.nodes).map((node) => node.position.x));
  const maxY = Math.max(1, ...Object.values(layout.nodes).map((node) => node.position.y));
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
    <svg className={`board-svg mode-${mode} surface-${visibleSurface}`} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="开关联动实验棋盘">
      <defs>
        <pattern id="board-grid" width="23" height="23" patternUnits="userSpaceOnUse"><path d="M 23 0 L 0 0 0 23" className="board-grid-line" /></pattern>
        <radialGradient id="board-vignette"><stop offset="0" stopColor="var(--board-glow)" stopOpacity=".16" /><stop offset="1" stopColor="var(--board-glow)" stopOpacity="0" /></radialGradient>
      </defs>
      <rect className="board-grid" width="100%" height="100%" fill="url(#board-grid)" />
      <rect width="100%" height="100%" fill="url(#board-vignette)" />

      {hovered && [...affected].filter((nodeId) => nodeId !== hovered).map((nodeId) => {
        const sourceNode = state.board.nodes[hovered];
        const targetNode = state.board.nodes[nodeId];
        if (!sourceNode || !targetNode) return null;
        return <g key={`wire:${nodeId}`} className="influence-connection"><line className="influence-wire-backdrop" x1={pad + sourceNode.position.x * unit} y1={pad + sourceNode.position.y * unit} x2={pad + targetNode.position.x * unit} y2={pad + targetNode.position.y * unit} /><line className="influence-wire" x1={pad + sourceNode.position.x * unit} y1={pad + sourceNode.position.y * unit} x2={pad + targetNode.position.x * unit} y2={pad + targetNode.position.y * unit} /></g>;
      })}

      {nodes.map((node) => {
        const entity = byNode.get(node.id);
        const properties = cellPropertiesFor(design, node.id);
        const exists = properties.exists;
        const role = cellRoleFor(properties);
        const power = typeof entity?.channels.power === "number" ? entity.channels.power : 0;
        const goal = design.cells[node.id]?.goal?.power?.value;
        const unconstrained = goal === undefined;
        const solutionCount = solution.get(node.id) ?? 0;
        const geometry = geometryFromNodeTags(node.tags);
        const satisfied = properties.hasPower && goal !== undefined && power === goal;
        const unsatisfied = properties.hasPower && goal !== undefined && power !== goal;
        const canActivate = exists && properties.activatable;
        const canInteract = mode === "edit" || canActivate;
        const style = {
          "--state-hue": String(42 + power * 18),
          "--state-level": String(power / Math.max(1, design.rule.stateCount - 1)),
        } as CSSProperties;
        const coreLabel = !exists
          ? "×"
          : properties.hasPower
            ? design.rule.stateCount > 2 ? String(power) : ""
            : cellRoleSymbols[role];
        const ariaDetail = !exists ? "不存在" : visibleSurface === "goal" ? unconstrained ? "不约束" : `目标状态 ${goal}` : visibleSurface === "role" ? `角色 ${role}` : `状态 ${power}`;
        return (
          <g
            key={node.id}
            className={[
              "cell",
              `shape-${geometry}`,
              `role-${role}`,
              !exists ? "is-absent" : "",
              properties.hasPower && unconstrained ? "is-unconstrained" : "",
              satisfied ? "is-satisfied" : "",
              unsatisfied ? "is-unsatisfied" : "",
              mode === "play" && !canActivate ? "is-disabled" : "",
              affected.has(node.id) ? "is-affected" : "",
              hovered === node.id ? "is-hovered" : "",
              hovered === node.id && canActivate ? "is-anchor" : "",
              selected === node.id ? "is-selected" : "",
              changed.has(node.id) ? "is-changed" : "",
              generationLocked.has(node.id) ? "is-generation-locked" : "",
            ].join(" ")}
            style={style}
            transform={`translate(${pad + node.position.x * unit} ${pad + node.position.y * unit})`}
            role="button"
            tabIndex={canInteract ? 0 : -1}
            aria-label={`节点 ${node.id}，${ariaDetail}`}
            aria-disabled={mode === "play" && !canActivate ? true : undefined}
            onMouseEnter={() => onHover(node.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(node.id)}
            onBlur={() => onHover(null)}
            onClick={canInteract ? () => onActivate(node.id) : undefined}
            onKeyDown={(event) => {
              if (canInteract && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onActivate(node.id);
              }
            }}
          >
            <NodeGeometryGlyph geometry={geometry} tags={node.tags} />
            {coreLabel && <text className="cell-value cell-core-value" y="5">{coreLabel}</text>}
            {exists && <g className={`cell-marker role-marker ${role === "standard" ? "is-standard" : "is-special"}`} transform="translate(-27 -27)"><circle r="8" /><text y="3">{cellRoleSymbols[role]}</text></g>}
            {exists && properties.hasPower && <g className={`cell-marker goal-marker ${unconstrained ? "is-unconstrained-marker" : satisfied ? "is-satisfied-marker" : "is-unsatisfied-marker"}`} transform="translate(27 -27)"><circle r="8" /><text y="3">{unconstrained ? "—" : String(goal)}</text></g>}
            {exists && <g className={`cell-marker influence-marker ${properties.activatable ? "" : "is-dormant"}`} transform="translate(-27 27)"><circle r="8" /><text y="3">{influenceSymbols[properties.influenceId]}</text></g>}
            {showSolution && solutionCount > 0 && <g className="cell-marker solution-mark" transform="translate(27 27)"><circle r="9" /><text y="3">{solutionCount === 1 ? "+" : `×${solutionCount}`}</text></g>}
            {generationLocked.has(node.id) && <g className="generation-lock-mark" transform="translate(0 -34)"><rect x="-8" y="-1" width="16" height="12" rx="3" /><path d="M -5 -1 V -5 A 5 5 0 0 1 5 -5 V -1" /><circle cy="5" r="1.5" /></g>}
          </g>
        );
      })}
    </svg>
  );
}

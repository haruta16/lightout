import type { CSSProperties } from "react";
import type { GameEntity, GameEvent, GameState } from "@lightout/engine";
import type { SolveResult } from "@lightout/solver";
import {
  CELL_ROLES,
  getBoardGeometryDefinition,
  supportedInfluencesFor,
  type BoardGeometry,
  type CellRole,
  type InfluencePattern,
} from "@lightout/mechanics-standard";
import {
  type EditorPaintValue,
  type EditorSurface,
  type EditorTool,
  type WorkspaceMode,
} from "../workspace";
import {
  cellRoleLabels,
  cellRoleSymbols,
  geometryNames,
  influenceLabels,
  influenceSymbols,
} from "../rulePresentation";

const SURFACE_LABELS: Record<EditorSurface, string> = {
  structure: "棋盘结构",
  role: "格子角色",
  influence: "影响属性",
  initial: "初始棋局",
  goal: "目标棋局",
};

function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case "command-accepted": return event.commandType === "activate" ? "开关已触发" : "操作已应用";
    case "channel-changed": return `${event.entityId.replace("cell:n:", "格 ")} · ${String(event.from)} → ${String(event.to)}`;
    case "status-changed": return event.to === "won" ? "目标条件满足" : `状态变为 ${event.to}`;
    case "command-rejected": return `操作拒绝：${event.reason}`;
    case "entity-moved": return `${event.entityId} 移动到 ${event.toNodeId}`;
    case "entity-removed": return `${event.entityId} 被移除`;
    case "counter-changed": return `${event.counter} · ${event.from} → ${event.to}`;
    case "system-settled": return `${event.systemType} 完成第 ${event.iteration + 1} 次结算`;
  }
}

interface InspectorPanelProps {
  mode: WorkspaceMode;
  state: GameState;
  selectedNodeId: string | null;
  selectedEntity?: GameEntity;
  solver: SolveResult;
  events: GameEvent[];
  nodeCount: number;
  activeCount: number;
  targetCount: number;
  stateCount: number;
  geometry: BoardGeometry;
  perCellInfluence: boolean;
  structurePaintValue: boolean;
  rolePaintValue: CellRole;
  paintValue: number;
  goalPaintValue: number | null;
  influencePaintValue: InfluencePattern;
  editorTool: EditorTool;
  editorSurface: EditorSurface;
  affectedCount: number | null;
  showSolution: boolean;
  onStructurePaintValueChange: (value: boolean) => void;
  onRolePaintValueChange: (value: CellRole) => void;
  onPaintValueChange: (value: number) => void;
  onGoalPaintValueChange: (value: number | null) => void;
  onInfluencePaintValueChange: (value: InfluencePattern) => void;
  onFill: (value: EditorPaintValue) => void;
  onApplyHint: () => void;
  onToggleSolution: () => void;
}

function EntitySection({ nodeId, entity, state }: { nodeId: string; entity?: GameEntity; state: GameState }) {
  const node = state.board.nodes[nodeId];
  return (
    <section className="inspector-section entity-inspector">
      <header><span>SEL</span><div><strong>当前选择</strong><small>Cell inspector</small></div></header>
      <div className="entity-title"><i /><div><strong>{nodeId.replace("n:", "Cell ")}</strong><small>{entity ? entity.kind : "empty slot"}</small></div></div>
      <dl className="property-grid">
        <dt>Node</dt><dd>{nodeId}</dd>
        <dt>Position</dt><dd>{node ? `${node.position.x}, ${node.position.y}` : "编辑槽位"}</dd>
        {entity && Object.entries(entity.properties).map(([property, value]) => (
          <div className="property-pair" key={property}><dt>{property}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>
        ))}
        {entity && Object.entries(entity.channels).map(([channel, value]) => (
          <div className="property-pair" key={channel}><dt>{channel}</dt><dd>{String(value)}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function StatePicker({ stateCount, value, allowUnconstrained, onChange }: {
  stateCount: number;
  value: number | null;
  allowUnconstrained: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className={`state-swatch-grid ${allowUnconstrained ? "with-unconstrained" : ""}`}>
      {allowUnconstrained && <button type="button" className={value === null ? "selected" : ""} onClick={() => onChange(null)}><i className="unconstrained-swatch" />不限</button>}
      {Array.from({ length: stateCount }, (_, stateValue) => (
        <button key={stateValue} type="button" className={value === stateValue ? "selected" : ""} onClick={() => onChange(stateValue)}><i style={{ "--swatch-level": stateValue / Math.max(1, stateCount - 1) } as CSSProperties} />{stateValue}</button>
      ))}
    </div>
  );
}

export function InspectorPanel({
  mode,
  state,
  selectedNodeId,
  selectedEntity,
  solver,
  events,
  nodeCount,
  activeCount,
  targetCount,
  stateCount,
  geometry,
  perCellInfluence,
  structurePaintValue,
  rolePaintValue,
  paintValue,
  goalPaintValue,
  influencePaintValue,
  editorTool,
  editorSurface,
  affectedCount,
  showSolution,
  onStructurePaintValueChange,
  onRolePaintValueChange,
  onPaintValueChange,
  onGoalPaintValueChange,
  onInfluencePaintValueChange,
  onFill,
  onApplyHint,
  onToggleSolution,
}: InspectorPanelProps) {
  const influenceKinds = new Set(Object.values(state.entities).map((entity) => entity.properties.influenceId)).size;
  const availableInfluences = supportedInfluencesFor(geometry);
  const surfaceLabel = SURFACE_LABELS[editorSurface];
  const topology = getBoardGeometryDefinition(geometry);
  const switchCount = Object.values(state.entities).filter((entity) => entity.properties.activatable === true).length;
  const powerCount = Object.values(state.entities).filter((entity) => entity.properties.hasPower === true).length;

  return (
    <aside className="workspace-panel inspector-panel">
      <div className="panel-kicker"><span>INSPECTOR</span><b>{mode === "play" ? "PLAY CONTEXT" : `${surfaceLabel} EDIT`}</b></div>
      <div className="inspector-context"><span>{mode === "play" ? "运行时分析" : surfaceLabel}</span><strong>{selectedNodeId ? selectedNodeId.replace("n:", "格 ") : "全局上下文"}</strong></div>

      <div className="panel-scroll inspector-scroll">
        {mode === "play" ? (
          <section className={`inspector-section solver-section status-${solver.status}`}>
            <header><span>ALG</span><div><strong>自动求解</strong><small>{solver.solverName}</small></div><i className="solver-status-dot" /></header>
            {solver.status === "solved" ? <>
              <div className="solver-primary"><strong>{solver.presses.length}</strong><span>步参考解</span></div>
              <div className="metric-grid"><div><span>约束秩</span><b>{solver.rank}</b></div><div><span>自由度</span><b>{solver.freeVariables}</b></div><div><span>最短保证</span><b>{solver.minimal ? "YES" : "NO"}</b></div><div><span>模数</span><b>Z/{solver.modulus}Z</b></div></div>
              <div className="dual-actions"><button type="button" onClick={onToggleSolution}>{showSolution ? "隐藏解标记" : "显示解标记"}</button><button type="button" onClick={onApplyHint} disabled={solver.presses.length === 0}>执行一步</button></div>
            </> : <div className="solver-warning"><strong>{solver.status === "unsupported" ? "没有兼容算法" : "当前局面不可解"}</strong><p>{solver.reason ?? "线性约束中存在无法满足的条件。"}</p></div>}
          </section>
        ) : (
          <section className="inspector-section tool-inspector">
            <header><span>TOOL</span><div><strong>{surfaceLabel}</strong><small>{editorTool}</small></div></header>
            {editorTool === "paint" && editorSurface === "structure" && <><div className="field-label"><span>格子是否存在</span><b>{structurePaintValue ? "存在" : "空缺"}</b></div><div className="compact-picker"><button type="button" className={structurePaintValue ? "selected" : ""} onClick={() => onStructurePaintValueChange(true)}>存在</button><button type="button" className={!structurePaintValue ? "selected" : ""} onClick={() => onStructurePaintValueChange(false)}>空缺</button></div><div className="dual-actions"><button type="button" onClick={() => onFill(structurePaintValue)}>应用到全部格</button></div></>}
            {editorTool === "paint" && editorSurface === "role" && <><div className="field-label"><span>格子能力组合</span><b>{cellRoleLabels[rolePaintValue]}</b></div><div className="influence-picker role-picker">{CELL_ROLES.map((role) => <button key={role} type="button" className={rolePaintValue === role ? "selected" : ""} onClick={() => onRolePaintValueChange(role)}><b>{cellRoleSymbols[role]}</b><span>{cellRoleLabels[role]}</span></button>)}</div><div className="dual-actions"><button type="button" onClick={() => onFill(rolePaintValue)}>应用到全部格</button></div></>}
            {editorTool === "paint" && editorSurface === "initial" && <><div className="field-label"><span>写入初始状态</span><b>{paintValue}</b></div><StatePicker stateCount={stateCount} value={paintValue} allowUnconstrained={false} onChange={(value) => value !== null && onPaintValueChange(value)} /><div className="dual-actions"><button type="button" onClick={() => onFill(paintValue)}>填满有状态格</button><button type="button" onClick={() => onFill(0)}>全部归零</button></div></>}
            {editorTool === "paint" && editorSurface === "goal" && <><div className="field-label"><span>目标约束</span><b>{goalPaintValue === null ? "不限" : goalPaintValue}</b></div><StatePicker stateCount={stateCount} value={goalPaintValue} allowUnconstrained onChange={onGoalPaintValueChange} /><div className="dual-actions"><button type="button" onClick={() => onFill(goalPaintValue)}>填满有状态格</button><button type="button" onClick={() => onFill(null)}>全部不限</button></div></>}
            {editorTool === "paint" && editorSurface === "influence" && <><div className="field-label"><span>格子影响配置</span><b>{influenceSymbols[influencePaintValue]}</b></div><div className="influence-picker">{availableInfluences.map((pattern) => <button key={pattern} type="button" className={pattern === influencePaintValue ? "selected" : ""} onClick={() => onInfluencePaintValueChange(pattern)}><b>{influenceSymbols[pattern]}</b><span>{influenceLabels[pattern]}</span></button>)}</div><div className="dual-actions"><button type="button" onClick={() => onFill(influencePaintValue)}>应用到全部格</button></div>{!perCellInfluence && <p className="panel-note">逐格影响未启用；请先在 RULE DECK 切换应用范围。</p>}</>}
            {editorTool !== "paint" && <p className="panel-note">{editorTool === "cycle" ? "点击格子循环切换当前属性。" : "点击格子查看其编译后的属性和状态。"}</p>}
          </section>
        )}

        {selectedNodeId && <EntitySection nodeId={selectedNodeId} entity={selectedEntity} state={state} />}

        <section className="inspector-section topology-inspector">
          <header><span>MAP</span><div><strong>拓扑摘要</strong><small>{geometryNames[geometry]}</small></div></header>
          <div className="topology-summary"><div className="topology-glyph"><span>{geometry === "hex" ? "⬡" : geometry === "triangle" ? "△" : "□"}</span></div><div><strong>{geometryNames[geometry]}</strong><small>{nodeCount} 个有效格 · 最大 {topology.maxNeighbors} 邻接</small></div></div>
          <div className="topology-breakdown"><div><span>可点击</span><strong>{switchCount} 格</strong></div><div><span>有状态</span><strong>{powerCount} 格</strong></div><div><span>目标约束</span><strong>{targetCount} 格</strong></div><div><span>未满足</span><strong>{activeCount} 格</strong></div><div><span>影响配置</span><strong>{perCellInfluence ? `${influenceKinds} 种并存` : "统一"}</strong></div>{affectedCount !== null && <div className="is-previewing"><span>当前预览</span><strong>{affectedCount} 个目标</strong></div>}</div>
        </section>

        {mode === "play" && <section className="inspector-section event-inspector"><header><span>LOG</span><div><strong>本次操作</strong><small>Event stream</small></div></header><ol>{events.length === 0 ? <li className="empty-log">点击任一可点击格后，这里会显示 Engine 产生的事件。</li> : events.map((event, index) => <li key={`${event.type}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{describeEvent(event)}</p></li>)}</ol></section>}
      </div>
    </aside>
  );
}

import type { CSSProperties } from "react";
import type { GameEntity, GameEvent, GameState, JsonPrimitive } from "@lightout/engine";
import type { SolveResult } from "@lightout/solver";
import {
  getBoardGeometryDefinition,
  isInfluencePattern,
  supportedInfluencesFor,
  type BoardGeometry,
  type InfluencePattern,
} from "@lightout/mechanics-standard";
import type { EditorSurface, EditorTool, WorkspaceMode } from "../workspace";
import {
  geometryNames,
  influenceLabels,
  influenceSymbols,
} from "../rulePresentation";

function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case "command-accepted": return event.commandType === "activate" ? "开关已触发" : "编辑工具已应用";
    case "channel-changed": return `${event.entityId.replace("light:n:", "格 ")} · ${String(event.from)} → ${String(event.to)}`;
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
  selectedEntity?: GameEntity;
  solver: SolveResult;
  events: GameEvent[];
  nodeCount: number;
  activeCount: number;
  targetCount: number;
  stateCount: number;
  geometry: BoardGeometry;
  compositeInfluence: boolean;
  paintValue: number;
  goalPaintValue: number | null;
  influencePaintValue: InfluencePattern;
  editorTool: EditorTool;
  editorSurface: EditorSurface;
  affectedCount: number | null;
  showSolution: boolean;
  onPaintValueChange: (value: number) => void;
  onGoalPaintValueChange: (value: number | null) => void;
  onInfluencePaintValueChange: (value: InfluencePattern) => void;
  onFill: (value: JsonPrimitive) => void;
  onApplyHint: () => void;
  onToggleSolution: () => void;
}

function EntitySection({ entity, state }: { entity: GameEntity; state: GameState }) {
  const node = entity.nodeId ? state.board.nodes[entity.nodeId] : undefined;
  return (
    <section className="inspector-section entity-inspector">
      <header><span>SEL</span><div><strong>当前选择</strong><small>Entity inspector</small></div></header>
      <div className="entity-title"><i /><div><strong>{entity.id.replace("light:n:", "Light ")}</strong><small>{entity.kind}</small></div></div>
      <dl className="property-grid">
        <dt>Node</dt><dd>{entity.nodeId ?? "—"}</dd>
        <dt>Position</dt><dd>{node ? `${node.position.x}, ${node.position.y}` : "—"}</dd>
        {Object.entries(entity.channels).map(([channel, value]) => (
          <div className="property-pair" key={channel}><dt>{channel}</dt><dd>{channel === "goal" && value === -1 ? "不约束" : String(value)}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function StatePicker({
  stateCount,
  value,
  allowUnconstrained,
  onChange,
}: {
  stateCount: number;
  value: number | null;
  allowUnconstrained: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className={`state-swatch-grid ${allowUnconstrained ? "with-unconstrained" : ""}`}>
      {allowUnconstrained && (
        <button type="button" className={value === null ? "selected" : ""} onClick={() => onChange(null)}>
          <i className="unconstrained-swatch" />不限
        </button>
      )}
      {Array.from({ length: stateCount }, (_, stateValue) => (
        <button key={stateValue} type="button" className={value === stateValue ? "selected" : ""} onClick={() => onChange(stateValue)}>
          <i style={{ "--swatch-level": stateValue / Math.max(1, stateCount - 1) } as CSSProperties} />{stateValue}
        </button>
      ))}
    </div>
  );
}

export function InspectorPanel({
  mode,
  state,
  selectedEntity,
  solver,
  events,
  nodeCount,
  activeCount,
  targetCount,
  stateCount,
  geometry,
  compositeInfluence,
  paintValue,
  goalPaintValue,
  influencePaintValue,
  editorTool,
  editorSurface,
  affectedCount,
  showSolution,
  onPaintValueChange,
  onGoalPaintValueChange,
  onInfluencePaintValueChange,
  onFill,
  onApplyHint,
  onToggleSolution,
}: InspectorPanelProps) {
  const influenceKinds = new Set(
    Object.values(state.entities)
      .map((entity) => entity.channels.influence)
      .filter(isInfluencePattern),
  ).size;
  const availableInfluences = supportedInfluencesFor(geometry);
  const uniformInfluence = Object.values(state.entities)
    .map((entity) => entity.channels.influence)
    .find(isInfluencePattern) ?? availableInfluences[0] ?? "neighbors";
  const surfaceLabel = editorSurface === "initial" ? "初始棋局" : editorSurface === "goal" ? "目标棋局" : "影响机制";

  return (
    <aside className="workspace-panel inspector-panel">
      <div className="panel-kicker"><span>INSPECTOR</span><b>{mode === "play" ? "PLAY CONTEXT" : `${surfaceLabel} EDIT`}</b></div>
      <div className="inspector-context">
        <span>{mode === "play" ? "运行时分析" : surfaceLabel}</span>
        <strong>{selectedEntity ? selectedEntity.id.replace("light:n:", "格 ") : "全局上下文"}</strong>
      </div>

      <div className="panel-scroll inspector-scroll">
        {mode === "play" ? (
          <section className={`inspector-section solver-section status-${solver.status}`}>
            <header><span>ALG</span><div><strong>自动求解</strong><small>{solver.solverName}</small></div><i className="solver-status-dot" /></header>
            {solver.status === "solved" ? (
              <>
                <div className="solver-primary"><strong>{solver.presses.length}</strong><span>步参考解</span></div>
                <div className="metric-grid">
                  <div><span>约束秩</span><b>{solver.rank}</b></div><div><span>自由度</span><b>{solver.freeVariables}</b></div>
                  <div><span>最短保证</span><b>{solver.minimal ? "YES" : "NO"}</b></div><div><span>模数</span><b>Z/{solver.modulus}Z</b></div>
                </div>
                <div className="dual-actions">
                  <button type="button" onClick={onToggleSolution}>{showSolution ? "隐藏解标记" : "显示解标记"}</button>
                  <button type="button" onClick={onApplyHint} disabled={solver.presses.length === 0}>执行一步</button>
                </div>
              </>
            ) : (
              <div className="solver-warning"><strong>{solver.status === "unsupported" ? "没有兼容算法" : "当前局面不可解"}</strong><p>{solver.reason ?? "线性约束中存在无法满足的条件。"}</p></div>
            )}
          </section>
        ) : (
          <section className="inspector-section tool-inspector">
            <header><span>TOOL</span><div><strong>{surfaceLabel}</strong><small>{editorTool}</small></div></header>
            {editorTool === "paint" && editorSurface === "initial" && (
              <>
                <div className="field-label"><span>写入初始状态</span><b>{paintValue}</b></div>
                <StatePicker stateCount={stateCount} value={paintValue} allowUnconstrained={false} onChange={(value) => value !== null && onPaintValueChange(value)} />
                <div className="dual-actions"><button type="button" onClick={() => onFill(paintValue)}>填满画布</button><button type="button" onClick={() => onFill(0)}>全部归零</button></div>
              </>
            )}
            {editorTool === "paint" && editorSurface === "goal" && (
              <>
                <div className="field-label"><span>目标约束</span><b>{goalPaintValue === null ? "不限" : goalPaintValue}</b></div>
                <StatePicker stateCount={stateCount} value={goalPaintValue} allowUnconstrained onChange={onGoalPaintValueChange} />
                <div className="dual-actions"><button type="button" onClick={() => onFill(goalPaintValue)}>填满目标</button><button type="button" onClick={() => onFill(null)}>全部不限</button></div>
              </>
            )}
            {editorTool === "paint" && editorSurface === "influence" && (
              <>
                <div className="field-label"><span>格子影响机制</span><b>{influenceSymbols[influencePaintValue]}</b></div>
                <div className="influence-picker">
                  {availableInfluences.map((pattern) => (
                    <button key={pattern} type="button" className={pattern === influencePaintValue ? "selected" : ""} onClick={() => onInfluencePaintValueChange(pattern)}>
                      <b>{influenceSymbols[pattern]}</b><span>{influenceLabels[pattern]}</span>
                    </button>
                  ))}
                </div>
                <div className="dual-actions"><button type="button" onClick={() => onFill(influencePaintValue)}>应用到全部格</button></div>
              </>
            )}
            {editorTool === "cycle" && <p className="tool-explainer">点击格子，在当前编辑层的可选值中循环。</p>}
            {editorTool === "inspect" && <p className="tool-explainer">点击格子查看初始状态、目标约束和影响机制。</p>}
            <div className={`validation-stamp validation-${solver.status}`}>
              <span>关卡验证</span><strong>{solver.status === "solved" ? "可达" : solver.status === "unsolvable" ? "不可达" : "未验证"}</strong><small>{solver.solverName}</small>
            </div>
          </section>
        )}

        {selectedEntity && <EntitySection entity={selectedEntity} state={state} />}

        <section className="inspector-section scene-summary">
          <header><span>SCN</span><div><strong>场景摘要</strong><small>Scene summary</small></div></header>
          <div className="summary-bars">
            <div><span>未达目标</span><b>{activeCount} / {targetCount}</b><i style={{ width: `${targetCount === 0 ? 0 : (activeCount / targetCount) * 100}%` }} /></div>
            <div><span>当前回合</span><b>{state.turn}</b><i style={{ width: `${Math.min(100, state.turn * 4)}%` }} /></div>
          </div>
          <div className="topology-breakdown">
            <div><span>基础拓扑</span><strong>{geometryNames[geometry]} · 最多 {getBoardGeometryDefinition(geometry).maxNeighbors} 邻居</strong></div>
            <div><span>目标约束</span><strong>{targetCount} / {nodeCount} 格</strong></div>
            <div><span>影响类型</span><strong>{compositeInfluence ? `${influenceKinds} 种并存` : `统一 · ${influenceLabels[uniformInfluence]}`}</strong></div>
            <div className={affectedCount === null ? "is-idle" : "is-previewing"}><span>悬停预览</span><strong>{affectedCount === null ? "指向节点查看" : `${affectedCount} 个节点（含自身）`}</strong></div>
          </div>
        </section>

        {mode === "play" && (
          <section className="inspector-section event-inspector">
            <header><span>LOG</span><div><strong>最近操作</strong><small>{events.length} events</small></div></header>
            <ol>
              {events.length === 0 ? <li className="empty-log">点击棋盘后，这里会显示领域事件。</li> : events.slice(0, 8).map((event, index) => (
                <li key={`${event.type}:${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{describeEvent(event)}</p></li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </aside>
  );
}

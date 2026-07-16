import type { CSSProperties } from "react";
import type { GameEntity, GameEvent, GameState } from "@lightout/engine";
import type { SolveResult } from "@lightout/solver";
import type {
  EditorTool,
  NodeShape,
  WorkspaceMode,
} from "../workspace";

function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case "command-accepted":
      return event.commandType === "activate" ? "开关已触发" : "编辑工具已应用";
    case "channel-changed":
      return `${event.entityId.replace("light:n:", "格 ")} · ${String(event.from)} → ${String(event.to)}`;
    case "status-changed":
      return event.to === "won" ? "目标条件满足" : `状态变为 ${event.to}`;
    case "command-rejected":
      return `操作拒绝：${event.reason}`;
    case "entity-moved":
      return `${event.entityId} 移动到 ${event.toNodeId}`;
    case "entity-removed":
      return `${event.entityId} 被移除`;
    case "counter-changed":
      return `${event.counter} · ${event.from} → ${event.to}`;
    case "system-settled":
      return `${event.systemType} 完成第 ${event.iteration + 1} 次结算`;
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
  stateCount: number;
  paintValue: number;
  editorTool: EditorTool;
  nodeShape: NodeShape;
  showSolution: boolean;
  onPaintValueChange: (value: number) => void;
  onFill: (value: number) => void;
  onApplyHint: () => void;
  onToggleSolution: () => void;
  onNodeShapeChange: (shape: NodeShape) => void;
}

function EntitySection({ entity, state }: { entity: GameEntity; state: GameState }) {
  const node = entity.nodeId ? state.board.nodes[entity.nodeId] : undefined;
  return (
    <section className="inspector-section entity-inspector">
      <header>
        <span>SEL</span>
        <div><strong>当前选择</strong><small>Entity inspector</small></div>
      </header>
      <div className="entity-title">
        <i />
        <div><strong>{entity.id.replace("light:n:", "Light ")}</strong><small>{entity.kind}</small></div>
      </div>
      <dl className="property-grid">
        <dt>Node</dt><dd>{entity.nodeId ?? "—"}</dd>
        <dt>Position</dt><dd>{node ? `${node.position.x}, ${node.position.y}` : "—"}</dd>
        {Object.entries(entity.channels).map(([channel, value]) => (
          <div className="property-pair" key={channel}>
            <dt>{channel}</dt><dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
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
  stateCount,
  paintValue,
  editorTool,
  nodeShape,
  showSolution,
  onPaintValueChange,
  onFill,
  onApplyHint,
  onToggleSolution,
  onNodeShapeChange,
}: InspectorPanelProps) {
  return (
    <aside className="workspace-panel inspector-panel">
      <div className="panel-kicker">
        <span>INSPECTOR</span>
        <b>{mode === "play" ? "PLAY CONTEXT" : "EDIT CONTEXT"}</b>
      </div>

      <div className="inspector-context">
        <span>{mode === "play" ? "运行时分析" : "关卡编辑"}</span>
        <strong>{selectedEntity ? selectedEntity.id.replace("light:n:", "格 ") : "全局上下文"}</strong>
      </div>

      <div className="panel-scroll inspector-scroll">
        {mode === "play" ? (
          <section className={`inspector-section solver-section status-${solver.status}`}>
            <header>
              <span>ALG</span>
              <div><strong>自动求解</strong><small>{solver.solverName}</small></div>
              <i className="solver-status-dot" />
            </header>
            {solver.status === "solved" ? (
              <>
                <div className="solver-primary">
                  <strong>{solver.presses.length}</strong>
                  <span>步参考解</span>
                </div>
                <div className="metric-grid">
                  <div><span>约束秩</span><b>{solver.rank}</b></div>
                  <div><span>自由度</span><b>{solver.freeVariables}</b></div>
                  <div><span>最短保证</span><b>{solver.minimal ? "YES" : "NO"}</b></div>
                  <div><span>模数</span><b>Z/{solver.modulus}Z</b></div>
                </div>
                <div className="dual-actions">
                  <button type="button" onClick={onToggleSolution}>
                    {showSolution ? "隐藏解标记" : "显示解标记"}
                  </button>
                  <button type="button" onClick={onApplyHint} disabled={solver.presses.length === 0}>
                    执行一步
                  </button>
                </div>
              </>
            ) : (
              <div className="solver-warning">
                <strong>{solver.status === "unsupported" ? "没有兼容算法" : "当前局面不可解"}</strong>
                <p>{solver.reason ?? "线性约束中存在无法满足的条件。"}</p>
              </div>
            )}
          </section>
        ) : (
          <section className="inspector-section tool-inspector">
            <header>
              <span>TOOL</span>
              <div><strong>工具参数</strong><small>{editorTool}</small></div>
            </header>
            {editorTool === "paint" && (
              <>
                <div className="field-label"><span>写入状态</span><b>{paintValue}</b></div>
                <div className="state-swatch-grid">
                  {Array.from({ length: stateCount }, (_, value) => (
                    <button
                      key={value}
                      type="button"
                      className={paintValue === value ? "selected" : ""}
                      onClick={() => onPaintValueChange(value)}
                    >
                      <i style={{ "--swatch-level": value / Math.max(1, stateCount - 1) } as CSSProperties} />
                      {value}
                    </button>
                  ))}
                </div>
                <div className="dual-actions">
                  <button type="button" onClick={() => onFill(paintValue)}>填满画布</button>
                  <button type="button" onClick={() => onFill(0)}>全部归零</button>
                </div>
              </>
            )}
            {editorTool === "cycle" && (
              <p className="tool-explainer">点击格子将其状态向前循环一格，不会增加游玩回合。</p>
            )}
            {editorTool === "inspect" && (
              <p className="tool-explainer">点击棋盘实体进行选择；属性会固定显示在检查器中。</p>
            )}
            <div className={`validation-stamp validation-${solver.status}`}>
              <span>关卡验证</span>
              <strong>{solver.status === "solved" ? "可达" : solver.status === "unsolvable" ? "不可达" : "未验证"}</strong>
              <small>{solver.solverName}</small>
            </div>
          </section>
        )}

        {selectedEntity && <EntitySection entity={selectedEntity} state={state} />}

        <section className="inspector-section scene-summary">
          <header>
            <span>SCN</span>
            <div><strong>场景摘要</strong><small>Scene summary</small></div>
          </header>
          <div className="summary-bars">
            <div><span>未达目标</span><b>{activeCount} / {nodeCount}</b><i style={{ width: `${nodeCount === 0 ? 0 : (activeCount / nodeCount) * 100}%` }} /></div>
            <div><span>当前回合</span><b>{state.turn}</b><i style={{ width: `${Math.min(100, state.turn * 4)}%` }} /></div>
          </div>
          <div className="shape-toggle">
            <span>节点外观</span>
            <button type="button" className={nodeShape === "circle" ? "selected" : ""} onClick={() => onNodeShapeChange("circle")}>圆形</button>
            <button type="button" className={nodeShape === "rounded-square" ? "selected" : ""} onClick={() => onNodeShapeChange("rounded-square")}>方形</button>
          </div>
        </section>

        {mode === "play" && (
          <section className="inspector-section event-inspector">
            <header>
              <span>LOG</span>
              <div><strong>最近操作</strong><small>{events.length} events</small></div>
            </header>
            <ol>
              {events.length === 0 ? (
                <li className="empty-log">点击棋盘后，这里会显示领域事件。</li>
              ) : (
                events.slice(0, 8).map((event, index) => (
                  <li key={`${event.type}:${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>{describeEvent(event)}</p>
                  </li>
                ))
              )}
            </ol>
          </section>
        )}
      </div>
    </aside>
  );
}

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  commitHistory,
  createHistory,
  dispatch,
  getCommandTargets,
  redoHistory,
  resetHistory,
  undoHistory,
  type GameEntity,
  type GameCommand,
  type GameEvent,
  type HistoryState,
  type Ruleset,
} from "@lightout/engine";
import {
  createExperiment,
  createStandardRegistry,
  type BoardShape,
  type ExperimentConfig,
  type InfluencePattern,
} from "@lightout/mechanics-standard";
import {
  createDefaultSolverRegistry,
  solvePuzzle,
} from "@lightout/solver";

const DEFAULT_CONFIG: ExperimentConfig = {
  size: 5,
  stateCount: 2,
  goalValue: 0,
  influence: "cross",
  boardShape: "full",
  seed: 27183,
};

const influenceLabels: Record<InfluencePattern, string> = {
  cross: "十字相邻",
  diagonal: "对角相邻",
  king: "八方向",
  "row-column": "整行整列",
};

const shapeLabels: Record<BoardShape, string> = {
  full: "完整方阵",
  diamond: "菱形裁切",
  ring: "环形裁切",
};

type Tool = "activate" | "set-state";
type Theme = "light" | "dark";
type NodeShape = "circle" | "rounded-square";

function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case "command-accepted":
      return event.commandType === "activate" ? "开关已触发" : "实验工具已应用";
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

function statusLabel(status: HistoryState["present"]["status"]): string {
  if (status === "won") return "已达成";
  if (status === "lost") return "已失败";
  return "进行中";
}

interface BoardProps {
  history: HistoryState;
  ruleset: Ruleset;
  hovered: string | null;
  affected: Set<string>;
  changed: Set<string>;
  solution: Map<string, number>;
  showSolution: boolean;
  stateCount: number;
  goalValue: number;
  nodeShape: NodeShape;
  onHover: (id: string | null) => void;
  onActivate: (entity: GameEntity) => void;
}

function Board({
  history,
  hovered,
  affected,
  changed,
  solution,
  showSolution,
  stateCount,
  goalValue,
  nodeShape,
  onHover,
  onActivate,
}: BoardProps) {
  const state = history.present;
  const nodes = Object.values(state.board.nodes);
  const maxX = Math.max(1, ...nodes.map((node) => node.position.x));
  const maxY = Math.max(1, ...nodes.map((node) => node.position.y));
  const byNode = new Map(
    Object.values(state.entities)
      .filter((entity) => entity.nodeId)
      .map((entity) => [entity.nodeId as string, entity]),
  );
  const unit = 92;
  const pad = 62;
  const width = maxX * unit + pad * 2;
  const height = maxY * unit + pad * 2;

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label="开关联动实验棋盘"
    >
      {hovered &&
        [...affected]
          .filter((id) => id !== hovered)
          .map((id) => {
            const source = state.entities[hovered];
            const target = state.entities[id];
            const sourceNode = source?.nodeId ? state.board.nodes[source.nodeId] : undefined;
            const targetNode = target?.nodeId ? state.board.nodes[target.nodeId] : undefined;
            if (!sourceNode || !targetNode) return null;
            return (
              <line
                key={`wire:${id}`}
                className="influence-wire"
                x1={pad + sourceNode.position.x * unit}
                y1={pad + sourceNode.position.y * unit}
                x2={pad + targetNode.position.x * unit}
                y2={pad + targetNode.position.y * unit}
              />
            );
          })}

      {nodes.map((node) => {
        const entity = byNode.get(node.id);
        if (!entity) return null;
        const value = Number(entity.channels.power ?? 0);
        const isGoal = value === goalValue;
        const isAffected = affected.has(entity.id);
        const isChanged = changed.has(entity.id);
        const isAnchor = hovered === entity.id;
        const style = {
          "--state-hue": String(
            stateCount === 2 ? 43 : (38 + value * 92) % 360,
          ),
          "--state-level": String(value / Math.max(1, stateCount - 1)),
        } as CSSProperties;
        return (
          <g
            key={entity.id}
            className={`cell shape-${nodeShape} ${isGoal ? "is-goal" : "is-active"} ${isAffected ? "is-affected" : ""} ${isAnchor ? "is-anchor" : ""} ${isChanged ? "is-changed" : ""}`}
            style={style}
            transform={`translate(${pad + node.position.x * unit} ${pad + node.position.y * unit})`}
            role="button"
            tabIndex={0}
            aria-label={`位置 ${node.position.x + 1}, ${node.position.y + 1}，状态 ${value}`}
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
            {nodeShape === "circle" ? (
              <>
                <circle className="cell-hit" r="39" />
                <circle className="cell-rim" r="32" />
                <circle className="cell-core" r="23" />
              </>
            ) : (
              <>
                <rect className="cell-hit" x="-39" y="-39" width="78" height="78" rx="10" />
                <rect className="cell-rim" x="-32" y="-32" width="64" height="64" rx="7" />
                <rect className="cell-core" x="-23" y="-23" width="46" height="46" rx="4" />
              </>
            )}
            {stateCount > 2 && <text className="cell-value" y="5">{value}</text>}
            {showSolution && (solution.get(entity.id) ?? 0) > 0 && (
              <g className="solution-mark" transform="translate(28 -28)">
                <circle r="10" />
                <text y="4">
                  {(solution.get(entity.id) ?? 0) === 1
                    ? "+"
                    : `×${solution.get(entity.id)}`}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-label">
      <h2>{children}</h2>
    </div>
  );
}

export function App() {
  const registry = useMemo(() => createStandardRegistry(), []);
  const solverRegistry = useMemo(() => createDefaultSolverRegistry(), []);
  const [config, setConfig] = useState<ExperimentConfig>(DEFAULT_CONFIG);
  const firstExperiment = useMemo(() => createExperiment(DEFAULT_CONFIG), []);
  const [ruleset, setRuleset] = useState(firstExperiment.ruleset);
  const [initialState, setInitialState] = useState(firstExperiment.initialState);
  const [history, setHistory] = useState(() => createHistory(firstExperiment.initialState));
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("activate");
  const [showSolution, setShowSolution] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("lightout-theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  const [nodeShape, setNodeShape] = useState<NodeShape>(() => {
    const saved = window.localStorage.getItem("lightout-node-shape");
    return saved === "rounded-square" ? saved : "circle";
  });

  const solver = useMemo(
    () => solvePuzzle(history.present, ruleset, registry, solverRegistry),
    [history.present, ruleset, registry, solverRegistry],
  );
  const affected = useMemo(() => {
    if (!hovered) return new Set<string>();
    return new Set(
      getCommandTargets(
        history.present,
        { type: tool, anchorEntityId: hovered },
        ruleset,
        registry,
      ),
    );
  }, [history.present, hovered, registry, ruleset, tool]);
  const solution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entityId of solver.presses) {
      counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
    }
    return counts;
  }, [solver.presses]);

  useEffect(() => {
    if (changed.size === 0) return;
    const timer = window.setTimeout(() => setChanged(new Set()), 280);
    return () => window.clearTimeout(timer);
  }, [changed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("lightout-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("lightout-node-shape", nodeShape);
  }, [nodeShape]);

  function rebuild(nextConfig: ExperimentConfig): void {
    const normalized = {
      ...nextConfig,
      goalValue: Math.min(nextConfig.goalValue, nextConfig.stateCount - 1),
    };
    const experiment = createExperiment(normalized);
    setConfig(normalized);
    setRuleset(experiment.ruleset);
    setInitialState(experiment.initialState);
    setHistory(createHistory(experiment.initialState));
    setEvents([]);
    setChanged(new Set());
    setHovered(null);
    setShowSolution(false);
  }

  function updateConfig<K extends keyof ExperimentConfig>(
    key: K,
    value: ExperimentConfig[K],
  ): void {
    rebuild({ ...config, [key]: value });
  }

  function executeCommand(command: GameCommand): void {
    const source =
      history.present.status === "playing"
        ? history.present
        : { ...history.present, status: "playing" as const };
    const result = dispatch(source, command, ruleset, registry);
    setEvents(result.events);
    setChanged(
      new Set(
        result.events
          .filter((event) => event.type === "channel-changed")
          .map((event) => event.entityId),
      ),
    );
    if (result.accepted) setHistory((current) => commitHistory(current, result.state));
  }

  function runCommand(entity: GameEntity): void {
    executeCommand(
      tool === "activate"
        ? { type: "activate", anchorEntityId: entity.id }
        : {
            type: "set-state",
            anchorEntityId: entity.id,
            payload: { value: config.goalValue },
          },
    );
  }

  function restart(): void {
    setHistory(resetHistory(initialState));
    setEvents([]);
    setChanged(new Set());
    setShowSolution(false);
  }

  function undo(): void {
    setHistory((value) => undoHistory(value));
    setEvents([]);
    setChanged(new Set());
  }

  function redo(): void {
    setHistory((value) => redoHistory(value));
    setEvents([]);
    setChanged(new Set());
  }

  function applyHint(): void {
    const first = solver.presses[0];
    if (first) executeCommand({ type: "activate", anchorEntityId: first });
  }

  const activeCount = Object.values(history.present.entities).filter(
    (entity) => Number(entity.channels.power) !== config.goalValue,
  ).length;
  const nodeCount = Object.keys(history.present.board.nodes).length;

  return (
    <main className="app-shell">
      <header className="masthead">
        <div className="brand-lockup">
          <h1>Lightout 玩法实验台</h1>
          <p>开关联动规则原型</p>
        </div>
        <div className="header-actions">
          <div className={`status-beacon status-${history.present.status}`}>
            <span className="status-light" />
            <strong>{statusLabel(history.present.status)}</strong>
          </div>
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "浅色模式" : "夜间模式"}
          </button>
        </div>
      </header>

      <section className="lab-layout">
        <aside className="instrument-panel controls-panel">
          <SectionLabel>参数</SectionLabel>
          <p className="panel-note">修改参数后会重新生成一个保证可达的局面。</p>

          <label className="control-row">
            <span><b>棋盘尺寸</b><em>{config.size} × {config.size}</em></span>
            <input
              type="range"
              min="2"
              max="10"
              value={config.size}
              onChange={(event) => updateConfig("size", Number(event.target.value))}
            />
          </label>

          <div className="control-row">
            <span><b>状态数量</b><em>{config.stateCount} 种</em></span>
            <div className="state-count-picker" role="group" aria-label="状态数量">
              {[2, 3, 4, 5].map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={config.stateCount === count}
                  className={config.stateCount === count ? "selected" : ""}
                  onClick={() => updateConfig("stateCount", count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <label className="select-row">
            <span>影响关系</span>
            <select
              value={config.influence}
              onChange={(event) =>
                updateConfig("influence", event.target.value as InfluencePattern)
              }
            >
              {Object.entries(influenceLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="select-row">
            <span>棋盘形状</span>
            <select
              value={config.boardShape}
              onChange={(event) =>
                updateConfig("boardShape", event.target.value as BoardShape)
              }
            >
              {Object.entries(shapeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="select-row">
            <span>目标状态</span>
            <select
              value={config.goalValue}
              onChange={(event) => updateConfig("goalValue", Number(event.target.value))}
            >
              {Array.from({ length: config.stateCount }, (_, value) => (
                <option key={value} value={value}>全部变为状态 {value}</option>
              ))}
            </select>
          </label>

          <div className="control-row node-shape-control">
            <span><b>节点形状</b></span>
            <div className="node-shape-picker" role="group" aria-label="节点形状">
              <button
                type="button"
                aria-pressed={nodeShape === "circle"}
                className={nodeShape === "circle" ? "selected" : ""}
                onClick={() => setNodeShape("circle")}
              >
                圆形
              </button>
              <button
                type="button"
                aria-pressed={nodeShape === "rounded-square"}
                className={nodeShape === "rounded-square" ? "selected" : ""}
                onClick={() => setNodeShape("rounded-square")}
              >
                圆角矩形
              </button>
            </div>
          </div>

          <div className="tool-block">
            <span className="micro-label">操作模式</span>
            <div className="segmented-control">
              <button className={tool === "activate" ? "selected" : ""} onClick={() => setTool("activate")}>
                触发开关
              </button>
              <button className={tool === "set-state" ? "selected" : ""} onClick={() => setTool("set-state")}>
                设置单格
              </button>
            </div>
            <p>{tool === "activate" ? "按当前规则影响一组对象。" : "直接把单格设为目标状态，用于设计调试。"}</p>
          </div>

          <div className="button-stack">
            <button className="primary-button" onClick={() => rebuild({ ...config, seed: config.seed + 1 })}>
              生成新局面
            </button>
            <button className="ghost-button" onClick={() => rebuild(DEFAULT_CONFIG)}>
              恢复经典 5×5
            </button>
          </div>

          <div className="config-stamp">
            <span>Seed</span><strong>{config.seed.toString().padStart(6, "0")}</strong>
            <span>规则集</span><strong>{ruleset.id}</strong>
          </div>
        </aside>

        <section className="playfield-column">
          <div className="playfield-head">
            <div>
              <span className="micro-label">当前规则</span>
              <h2>{shapeLabels[config.boardShape]} · {influenceLabels[config.influence]}</h2>
            </div>
            <div className="readout-cluster">
              <div><small>步数</small><strong>{history.present.turn}</strong></div>
              <div><small>未达目标</small><strong>{activeCount}/{nodeCount}</strong></div>
            </div>
          </div>

          <div className={`playfield status-${history.present.status}`}>
            <Board
              history={history}
              ruleset={ruleset}
              hovered={hovered}
              affected={affected}
              changed={changed}
              solution={solution}
              showSolution={showSolution}
              stateCount={config.stateCount}
              goalValue={config.goalValue}
              nodeShape={nodeShape}
              onHover={setHovered}
              onActivate={runCommand}
            />
            {history.present.status === "won" && (
              <div className="win-stamp">
                <strong>目标达成</strong>
                <p>全部格子已进入目标状态</p>
                <button onClick={() => rebuild({ ...config, seed: config.seed + 1 })}>生成下一局</button>
              </div>
            )}
          </div>

          <div className="timeline-bar">
            <button disabled={history.past.length === 0} onClick={undo}>← 撤销</button>
            <button disabled={history.future.length === 0} onClick={redo}>重做 →</button>
            <div className="timeline-spacer" />
            <button onClick={restart}>重置局面</button>
          </div>
        </section>

        <aside className="instrument-panel analysis-panel">
          <SectionLabel>分析</SectionLabel>
          <div className={`solver-card solver-${solver.status}`}>
            <div className="solver-title">
              <div>
                <small>求解器 · 自动选择</small>
                <strong>
                  {solver.status === "unsupported"
                    ? "没有兼容的精确求解器"
                    : solver.solverName}
                </strong>
              </div>
            </div>
            {solver.status === "solved" ? (
              <>
                <div className="solver-number"><strong>{solver.presses.length}</strong><span>步参考解</span></div>
                <div className="metric-grid">
                  <span>约束秩<b>{solver.rank}</b></span>
                  <span>自由度<b>{solver.freeVariables}</b></span>
                  <span>最短保证<b>{solver.minimal ? "是" : "否"}</b></span>
                  <span>状态空间<b>{solver.modulus}^{nodeCount}</b></span>
                </div>
                <div className="solver-actions">
                  <button onClick={() => setShowSolution((value) => !value)}>{showSolution ? "隐藏解标记" : "显示解标记"}</button>
                  <button onClick={applyHint} disabled={solver.presses.length === 0}>执行一步</button>
                </div>
              </>
            ) : (
              <div className="solver-message">
                <strong>{solver.status === "unsupported" ? "当前规则不适用" : "局面不可解"}</strong>
                <p>{solver.reason ?? "线性系统检测到矛盾约束。"}</p>
              </div>
            )}
          </div>

          <div className="event-section">
            <div className="event-heading">
              <span className="micro-label">最近操作</span>
              <em>{events.length} 条事件</em>
            </div>
            <ol className="event-log">
              {events.length === 0 ? (
                <li className="event-empty">悬停查看影响范围，点击写入首个事件。</li>
              ) : (
                events.slice(0, 8).map((event, index) => (
                  <li key={`${event.type}:${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>{describeEvent(event)}</p>
                  </li>
                ))
              )}
            </ol>
          </div>

          <details className="rules-inspector">
            <summary>查看当前规则 <span>JSON</span></summary>
            <pre>{JSON.stringify({
              topology: { type: "rect-graph", size: config.size, shape: config.boardShape },
              state: { channel: "power", modulo: config.stateCount },
              action: ruleset.actions[0],
              goal: ruleset.goals[0],
              settle: ruleset.settleSystems,
            }, null, 2)}</pre>
          </details>
        </aside>
      </section>

    </main>
  );
}

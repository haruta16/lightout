import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  applyMutations,
  commitHistory,
  createHistory,
  dispatch,
  getCommandTargets,
  redoHistory,
  resetHistory,
  undoHistory,
  type GameCommand,
  type GameEntity,
  type GameEvent,
  type GameState,
  type HistoryState,
} from "@lightout/engine";
import {
  createExperiment,
  createStandardRegistry,
} from "@lightout/mechanics-standard";
import {
  createDefaultSolverRegistry,
  solvePuzzle,
} from "@lightout/solver";
import { BoardCanvas } from "./components/BoardCanvas";
import { InspectorPanel } from "./components/InspectorPanel";
import { RuleDeck } from "./components/RuleDeck";
import {
  duplicatePreset,
  loadPreference,
  loadWorkspace,
  savePreference,
  saveWorkspace,
  toExperimentConfig,
  type EditorTool,
  type NodeShape,
  type RulePreset,
  type Theme,
  type WorkspaceMode,
} from "./workspace";

function statusLabel(status: GameState["status"]): string {
  if (status === "won") return "目标达成";
  if (status === "lost") return "实验失败";
  return "运行中";
}

export function App() {
  const initialWorkspace = useMemo(() => loadWorkspace(), []);
  const initialPreset =
    initialWorkspace.presets.find(
      (preset) => preset.id === initialWorkspace.activeRuleId,
    ) ?? initialWorkspace.presets[0]!;
  const initialExperiment = useMemo(
    () => createExperiment(toExperimentConfig(initialPreset)),
    [],
  );
  const mechanics = useMemo(() => createStandardRegistry(), []);
  const solverRegistry = useMemo(() => createDefaultSolverRegistry(), []);

  const [presets, setPresets] = useState(initialWorkspace.presets);
  const [activeRuleId, setActiveRuleId] = useState(initialWorkspace.activeRuleId);
  const [savedAt, setSavedAt] = useState(Date.now());
  const [isSaved, setIsSaved] = useState(true);
  const [ruleset, setRuleset] = useState(initialExperiment.ruleset);
  const [editorHistory, setEditorHistory] = useState<HistoryState>(() =>
    createHistory(initialExperiment.initialState),
  );
  const [playHistory, setPlayHistory] = useState<HistoryState>(() =>
    createHistory(initialExperiment.initialState),
  );
  const [mode, setMode] = useState<WorkspaceMode>("play");
  const [editorTool, setEditorTool] = useState<EditorTool>("paint");
  const [paintValue, setPaintValue] = useState(0);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    loadPreference("lightout-theme", ["light", "dark"], "dark"),
  );
  const [nodeShape, setNodeShape] = useState<NodeShape>(() =>
    loadPreference(
      "lightout-node-shape",
      ["circle", "rounded-square"],
      "circle",
    ),
  );

  const activeIndex = Math.max(
    0,
    presets.findIndex((preset) => preset.id === activeRuleId),
  );
  const activePreset = presets[activeIndex] ?? presets[0]!;
  const config = toExperimentConfig(activePreset);
  const currentHistory = mode === "play" ? playHistory : editorHistory;
  const currentState = currentHistory.present;

  const solver = useMemo(
    () => solvePuzzle(currentState, ruleset, mechanics, solverRegistry),
    [currentState, ruleset, mechanics, solverRegistry],
  );
  const solution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entityId of solver.presses) {
      counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
    }
    return counts;
  }, [solver.presses]);
  const affected = useMemo(() => {
    if (!hovered || (mode === "edit" && editorTool === "inspect")) {
      return new Set<string>();
    }
    return new Set(
      getCommandTargets(
        currentState,
        {
          type: mode === "play" ? "activate" : "set-state",
          anchorEntityId: hovered,
        },
        ruleset,
        mechanics,
      ),
    );
  }, [currentState, editorTool, hovered, mechanics, mode, ruleset]);

  useEffect(() => {
    const saved = saveWorkspace({ presets, activeRuleId });
    setIsSaved(saved);
    if (saved) setSavedAt(Date.now());
  }, [activeRuleId, presets]);

  useEffect(() => {
    if (changed.size === 0) return;
    const timer = window.setTimeout(() => setChanged(new Set()), 280);
    return () => window.clearTimeout(timer);
  }, [changed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePreference("lightout-theme", theme);
  }, [theme]);

  useEffect(() => {
    savePreference("lightout-node-shape", nodeShape);
  }, [nodeShape]);

  function resetTransientState(): void {
    setEvents([]);
    setChanged(new Set());
    setHovered(null);
    setSelected(null);
    setShowSolution(false);
  }

  function rebuildFromPreset(preset: RulePreset): void {
    const experiment = createExperiment(toExperimentConfig(preset));
    setRuleset(experiment.ruleset);
    setEditorHistory(createHistory(experiment.initialState));
    setPlayHistory(createHistory(experiment.initialState));
    setPaintValue(Math.min(paintValue, preset.definition.stateCount - 1));
    resetTransientState();
  }

  function changePreset(next: RulePreset, rebuild: boolean): void {
    setPresets((current) =>
      current.map((preset) => (preset.id === next.id ? next : preset)),
    );
    if (rebuild) rebuildFromPreset(next);
  }

  function switchRule(index: number): void {
    const next = presets[index];
    if (!next || next.id === activeRuleId) return;
    setActiveRuleId(next.id);
    rebuildFromPreset(next);
  }

  function copyRule(): void {
    const copy = duplicatePreset(activePreset);
    setPresets((current) => [...current, copy]);
    setActiveRuleId(copy.id);
    rebuildFromPreset(copy);
  }

  function switchMode(next: WorkspaceMode): void {
    if (next === mode) return;
    if (next === "play") {
      setPlayHistory(createHistory(editorHistory.present));
      setEvents([]);
      setChanged(new Set());
      setShowSolution(false);
    }
    setMode(next);
    setHovered(null);
    setSelected(null);
  }

  function markEvents(nextEvents: GameEvent[]): void {
    setEvents(nextEvents);
    setChanged(
      new Set(
        nextEvents
          .filter((event) => event.type === "channel-changed")
          .map((event) => event.entityId),
      ),
    );
  }

  function executePlayCommand(command: GameCommand): void {
    const result = dispatch(playHistory.present, command, ruleset, mechanics);
    markEvents(result.events);
    if (result.accepted) {
      setPlayHistory((history) => commitHistory(history, result.state));
    }
  }

  function editEntity(entity: GameEntity): void {
    if (editorTool === "inspect") return;
    const current = Number(entity.channels.power ?? 0);
    const value =
      editorTool === "cycle"
        ? (current + 1) % config.stateCount
        : paintValue;
    const result = applyMutations(editorHistory.present, [
      { type: "set-channel", entityId: entity.id, channel: "power", value },
    ]);
    const state = { ...result.state, turn: 0, status: "playing" as const };
    markEvents(result.events);
    if (result.events.length > 0) {
      setEditorHistory((history) => commitHistory(history, state));
    }
  }

  function activateEntity(entity: GameEntity): void {
    setSelected(entity.id);
    if (mode === "play") {
      executePlayCommand({ type: "activate", anchorEntityId: entity.id });
    } else {
      editEntity(entity);
    }
  }

  function fillEditor(value: number): void {
    const mutations = Object.values(editorHistory.present.entities).map((entity) => ({
      type: "set-channel" as const,
      entityId: entity.id,
      channel: "power",
      value,
    }));
    const result = applyMutations(editorHistory.present, mutations);
    const state = { ...result.state, turn: 0, status: "playing" as const };
    markEvents(result.events);
    if (result.events.length > 0) {
      setEditorHistory((history) => commitHistory(history, state));
    }
  }

  function undo(): void {
    if (mode === "play") setPlayHistory((history) => undoHistory(history));
    else setEditorHistory((history) => undoHistory(history));
    setEvents([]);
    setChanged(new Set());
  }

  function redo(): void {
    if (mode === "play") setPlayHistory((history) => redoHistory(history));
    else setEditorHistory((history) => redoHistory(history));
    setEvents([]);
    setChanged(new Set());
  }

  function restartPlay(): void {
    setPlayHistory(resetHistory(editorHistory.present));
    setEvents([]);
    setChanged(new Set());
    setShowSolution(false);
  }

  function applyHint(): void {
    const first = solver.presses[0];
    if (first && mode === "play") {
      executePlayCommand({ type: "activate", anchorEntityId: first });
    }
  }

  const activeCount = Object.values(currentState.entities).filter(
    (entity) => Number(entity.channels.power) !== config.goalValue,
  ).length;
  const nodeCount = Object.keys(currentState.board.nodes).length;
  const selectedEntity = selected ? currentState.entities[selected] : undefined;
  const canUndo = currentHistory.past.length > 0;
  const canRedo = currentHistory.future.length > 0;

  return (
    <main
      className="workbench-shell"
      style={{ "--active-accent": activePreset.accent } as CSSProperties}
    >
      <header className="command-bar">
        <div className="brand-mark"><i /><div><strong>LIGHTOUT</strong><span>MECHANIC WORKBENCH</span></div></div>
        <div className="project-heading">
          <span>ACTIVE RULE</span>
          <strong>{activePreset.name}</strong>
          <small>{activePreset.description}</small>
        </div>
        <div className="mode-switcher" role="tablist" aria-label="工作模式">
          <button type="button" role="tab" aria-selected={mode === "play"} className={mode === "play" ? "selected" : ""} onClick={() => switchMode("play")}>
            <span>▶</span><div><strong>游玩</strong><small>PLAY</small></div>
          </button>
          <button type="button" role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "selected" : ""} onClick={() => switchMode("edit")}>
            <span>✦</span><div><strong>编辑</strong><small>EDIT</small></div>
          </button>
        </div>
        <button className="theme-button" type="button" onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>
          <span>{theme === "dark" ? "☼" : "◐"}</span>
          <small>{theme === "dark" ? "LIGHT" : "DARK"}</small>
        </button>
      </header>

      <section className="workspace-grid">
        <RuleDeck
          presets={presets}
          activeIndex={activeIndex}
          activePreset={activePreset}
          savedAt={savedAt}
          isSaved={isSaved}
          onSwitch={switchRule}
          onChange={changePreset}
          onDuplicate={copyRule}
        />

        <section className="workspace-panel board-workspace">
          <header className="board-toolbar">
            <div className="scene-title">
              <span>{mode === "play" ? "PLAY SESSION" : "LEVEL DRAFT"}</span>
              <strong>{config.size}×{config.size} · {config.stateCount} STATE</strong>
            </div>
            {mode === "edit" && (
              <div className="editor-tools" role="toolbar" aria-label="编辑工具">
                {(["inspect", "paint", "cycle"] as EditorTool[]).map((tool) => (
                  <button key={tool} type="button" className={editorTool === tool ? "selected" : ""} onClick={() => setEditorTool(tool)}>
                    {tool === "inspect" ? "选择" : tool === "paint" ? "状态画笔" : "循环状态"}
                  </button>
                ))}
              </div>
            )}
            <div className="history-tools">
              <button type="button" disabled={!canUndo} onClick={undo} aria-label="撤销">↶</button>
              <button type="button" disabled={!canRedo} onClick={redo} aria-label="重做">↷</button>
              {mode === "play" ? (
                <button type="button" onClick={restartPlay}>重置</button>
              ) : (
                <button type="button" onClick={() => switchMode("play")}>测试游玩</button>
              )}
            </div>
          </header>

          <div className={`board-stage status-${currentState.status}`}>
            <div className="stage-corners"><i /><i /><i /><i /></div>
            <BoardCanvas
              state={currentState}
              stateCount={config.stateCount}
              goalValue={config.goalValue}
              nodeShape={nodeShape}
              mode={mode}
              hovered={hovered}
              selected={selected}
              affected={affected}
              changed={changed}
              solution={solution}
              showSolution={mode === "play" && showSolution}
              onHover={setHovered}
              onActivate={activateEntity}
            />
            {mode === "play" && currentState.status === "won" && (
              <div className="completion-overlay">
                <span>SESSION COMPLETE</span>
                <strong>目标达成</strong>
                <p>{currentState.turn} 次操作完成当前规则实例</p>
                <button type="button" onClick={() => {
                  const next = {
                    ...activePreset,
                    level: { ...activePreset.level, seed: activePreset.level.seed + 1 },
                  };
                  changePreset(next, true);
                }}>生成下一局</button>
              </div>
            )}
          </div>

          <footer className="board-statusbar">
            <div><span>STATUS</span><b className={`status-${currentState.status}`}>{mode === "edit" ? "EDITING" : statusLabel(currentState.status)}</b></div>
            <div><span>TURN</span><b>{currentState.turn.toString().padStart(3, "0")}</b></div>
            <div><span>UNRESOLVED</span><b>{activeCount}/{nodeCount}</b></div>
            <div><span>SEED</span><b>{config.seed.toString().padStart(6, "0")}</b></div>
            <div className="status-spacer" />
            <div><span>RULESET</span><b>{ruleset.id}</b></div>
          </footer>
        </section>

        <InspectorPanel
          mode={mode}
          state={currentState}
          selectedEntity={selectedEntity}
          solver={solver}
          events={events}
          nodeCount={nodeCount}
          activeCount={activeCount}
          stateCount={config.stateCount}
          paintValue={paintValue}
          editorTool={editorTool}
          nodeShape={nodeShape}
          showSolution={showSolution}
          onPaintValueChange={setPaintValue}
          onFill={fillEditor}
          onApplyHint={applyHint}
          onToggleSolution={() => setShowSolution((value) => !value)}
          onNodeShapeChange={setNodeShape}
        />
      </section>
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  applyMutations,
  commitHistory,
  createHistory,
  dispatch,
  evaluateState,
  getCommandTargets,
  redoHistory,
  resetHistory,
  undoHistory,
  type GameCommand,
  type GameEntity,
  type GameEvent,
  type GameState,
  type HistoryState,
  type JsonPrimitive,
} from "@lightout/engine";
import {
  createExperiment,
  createStandardRegistry,
  isInfluencePattern,
  supportedInfluencesFor,
  type InfluencePattern,
} from "@lightout/mechanics-standard";
import { createDefaultSolverRegistry, solvePuzzle } from "@lightout/solver";
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
  withLevelDesign,
  type EditorSurface,
  type EditorTool,
  type RulePreset,
  type Theme,
  type WorkspaceMode,
} from "./workspace";

function statusLabel(status: GameState["status"]): string {
  if (status === "won") return "目标达成";
  if (status === "lost") return "实验失败";
  return "运行中";
}

const SURFACE_LABELS: Record<EditorSurface, string> = {
  initial: "初始棋局",
  goal: "目标棋局",
  influence: "影响机制",
};

export function App() {
  const initialWorkspace = useMemo(() => loadWorkspace(), []);
  const initialPreset = initialWorkspace.presets.find(
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
  const [editorHistory, setEditorHistory] = useState<HistoryState>(() => createHistory(initialExperiment.initialState));
  const [playHistory, setPlayHistory] = useState<HistoryState>(() => createHistory(initialExperiment.initialState));
  const [mode, setMode] = useState<WorkspaceMode>("play");
  const [editorTool, setEditorTool] = useState<EditorTool>("paint");
  const [editorSurface, setEditorSurface] = useState<EditorSurface>("initial");
  const [paintValue, setPaintValue] = useState(0);
  const [goalPaintValue, setGoalPaintValue] = useState<number | null>(0);
  const [influencePaintValue, setInfluencePaintValue] = useState<InfluencePattern>(initialPreset.definition.defaultInfluence);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadPreference("lightout-theme", ["light", "dark"], "dark"));

  const activeIndex = Math.max(0, presets.findIndex((preset) => preset.id === activeRuleId));
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
    for (const entityId of solver.presses) counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
    return counts;
  }, [solver.presses]);
  const affected = useMemo(() => {
    if (!hovered) return new Set<string>();
    if (mode === "edit" && editorSurface !== "influence") return new Set([hovered]);
    return new Set(getCommandTargets(
      currentState,
      { type: "activate", anchorEntityId: hovered },
      ruleset,
      mechanics,
    ));
  }, [currentState, editorSurface, hovered, mechanics, mode, ruleset]);

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
    setPaintValue((value) => Math.min(value, preset.definition.stateCount - 1));
    setGoalPaintValue((value) => value === null ? null : Math.min(value, preset.definition.stateCount - 1));
    setInfluencePaintValue(preset.definition.defaultInfluence);
    if (!preset.definition.compositeInfluence) {
      setEditorSurface((surface) => surface === "influence" ? "initial" : surface);
    }
    resetTransientState();
  }

  function changePreset(next: RulePreset, rebuild: boolean): void {
    setPresets((current) => current.map((preset) => preset.id === next.id ? next : preset));
    if (rebuild) rebuildFromPreset(next);
  }

  function persistEditorState(state: Readonly<GameState>): void {
    setPresets((current) => current.map((preset) =>
      preset.id === activeRuleId ? withLevelDesign(preset, state) : preset,
    ));
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

  function deleteRule(): void {
    if (presets.length <= 1) return;
    if (!window.confirm(`删除规则“${activePreset.name}”？此操作无法撤销。`)) return;

    const remaining = presets.filter((preset) => preset.id !== activePreset.id);
    const next = remaining[Math.min(activeIndex, remaining.length - 1)];
    if (!next) return;
    setPresets(remaining);
    setActiveRuleId(next.id);
    rebuildFromPreset(next);
  }

  function switchMode(next: WorkspaceMode): void {
    if (next === mode) return;
    if (next === "play") {
      const playState = evaluateState(editorHistory.present, ruleset, mechanics);
      setPlayHistory(createHistory(playState));
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
    setChanged(new Set(nextEvents.filter((event) => event.type === "channel-changed").map((event) => event.entityId)));
  }

  function executePlayCommand(command: GameCommand): void {
    const result = dispatch(playHistory.present, command, ruleset, mechanics);
    markEvents(result.events);
    if (result.accepted) setPlayHistory((history) => commitHistory(history, result.state));
  }

  function editorValue(entity: GameEntity): { channel: string; value: JsonPrimitive } {
    if (editorSurface === "initial") {
      const current = Number(entity.channels.power ?? 0);
      return { channel: "power", value: editorTool === "cycle" ? (current + 1) % config.stateCount : paintValue };
    }
    if (editorSurface === "goal") {
      const current = Number(entity.channels.goal ?? -1);
      const next = current >= config.stateCount - 1 ? -1 : current + 1;
      return { channel: "goal", value: editorTool === "cycle" ? next : (goalPaintValue ?? -1) };
    }
    const current = isInfluencePattern(entity.channels.influence) ? entity.channels.influence : "cross";
    const availableInfluences = supportedInfluencesFor(config.geometry ?? "square");
    const index = availableInfluences.indexOf(current);
    const next = availableInfluences[(index + 1) % availableInfluences.length] ?? "neighbors";
    return { channel: "influence", value: editorTool === "cycle" ? next : influencePaintValue };
  }

  function editEntity(entity: GameEntity): void {
    if (editorTool === "inspect") return;
    if (editorSurface === "influence" && !activePreset.definition.compositeInfluence) return;
    const edit = editorValue(entity);
    const result = applyMutations(editorHistory.present, [
      { type: "set-channel", entityId: entity.id, channel: edit.channel, value: edit.value },
    ]);
    const state = { ...result.state, turn: 0, status: "playing" as const };
    markEvents(result.events);
    if (result.events.length > 0) {
      setEditorHistory((history) => commitHistory(history, state));
      persistEditorState(state);
    }
  }

  function activateEntity(entity: GameEntity): void {
    setSelected(entity.id);
    if (mode === "play") executePlayCommand({ type: "activate", anchorEntityId: entity.id });
    else editEntity(entity);
  }

  function fillEditor(value: JsonPrimitive): void {
    if (editorSurface === "influence" && !activePreset.definition.compositeInfluence) return;
    const channel = editorSurface === "initial" ? "power" : editorSurface === "goal" ? "goal" : "influence";
    const normalized = editorSurface === "goal" && value === null ? -1 : value;
    const mutations = Object.values(editorHistory.present.entities).map((entity) => ({
      type: "set-channel" as const,
      entityId: entity.id,
      channel,
      value: normalized,
    }));
    const result = applyMutations(editorHistory.present, mutations);
    const state = { ...result.state, turn: 0, status: "playing" as const };
    markEvents(result.events);
    if (result.events.length > 0) {
      setEditorHistory((history) => commitHistory(history, state));
      persistEditorState(state);
    }
  }

  function undo(): void {
    if (mode === "play") setPlayHistory((history) => undoHistory(history));
    else {
      const next = undoHistory(editorHistory);
      setEditorHistory(next);
      persistEditorState(next.present);
    }
    setEvents([]);
    setChanged(new Set());
  }

  function redo(): void {
    if (mode === "play") setPlayHistory((history) => redoHistory(history));
    else {
      const next = redoHistory(editorHistory);
      setEditorHistory(next);
      persistEditorState(next.present);
    }
    setEvents([]);
    setChanged(new Set());
  }

  function restartPlay(): void {
    const playState = evaluateState(editorHistory.present, ruleset, mechanics);
    setPlayHistory(resetHistory(playState));
    setEvents([]);
    setChanged(new Set());
    setShowSolution(false);
  }

  function applyHint(): void {
    const first = solver.presses[0];
    if (first && mode === "play") executePlayCommand({ type: "activate", anchorEntityId: first });
  }

  const constrainedEntities = Object.values(currentState.entities).filter((entity) => Number(entity.channels.goal) >= 0);
  const targetCount = constrainedEntities.length;
  const activeCount = constrainedEntities.filter((entity) => entity.channels.power !== entity.channels.goal).length;
  const nodeCount = Object.keys(currentState.board.nodes).length;
  const selectedEntity = selected ? currentState.entities[selected] : undefined;
  const canUndo = currentHistory.past.length > 0;
  const canRedo = currentHistory.future.length > 0;

  return (
    <main className="workbench-shell">
      <header className="command-bar">
        <div className="brand-mark"><i /><div><strong>LIGHTOUT</strong><span>MECHANIC WORKBENCH</span></div></div>
        <div className="project-heading"><span>ACTIVE RULE</span><strong>{activePreset.name}</strong><small>{activePreset.description}</small></div>
        <div className="mode-switcher" role="tablist" aria-label="工作模式">
          <button type="button" role="tab" aria-selected={mode === "play"} className={mode === "play" ? "selected" : ""} onClick={() => switchMode("play")}><span>▶</span><div><strong>游玩</strong><small>PLAY</small></div></button>
          <button type="button" role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "selected" : ""} onClick={() => switchMode("edit")}><span>✦</span><div><strong>编辑</strong><small>EDIT</small></div></button>
        </div>
        <button className="theme-button" type="button" onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}><span>{theme === "dark" ? "☼" : "◐"}</span><small>{theme === "dark" ? "LIGHT" : "DARK"}</small></button>
      </header>

      <section className={`workspace-grid ${focusMode ? "focus-mode" : ""}`}>
        <section className={`workspace-panel board-workspace mode-${mode}`}>
          <header className={`board-toolbar mode-${mode}`}>
            <div className="scene-title"><span>{mode === "play" ? "PLAY SESSION" : SURFACE_LABELS[editorSurface]}</span><strong>{config.size}×{config.size} · {config.stateCount} STATE</strong></div>
            {mode === "edit" && (
              <>
                <div className="surface-switcher" role="tablist" aria-label="编辑对象">
                  {(["initial", "goal", "influence"] as EditorSurface[]).map((surface) => (
                    <button
                      key={surface}
                      type="button"
                      role="tab"
                      aria-selected={editorSurface === surface}
                      className={editorSurface === surface ? "selected" : ""}
                      disabled={surface === "influence" && !activePreset.definition.compositeInfluence}
                      title={surface === "influence" && !activePreset.definition.compositeInfluence ? "请先在 RULE DECK 选择复合影响" : undefined}
                      onClick={() => setEditorSurface(surface)}
                    >{SURFACE_LABELS[surface]}</button>
                  ))}
                </div>
                <div className="editor-tools" role="toolbar" aria-label="编辑工具">
                  {(["inspect", "paint", "cycle"] as EditorTool[]).map((tool) => (
                    <button key={tool} type="button" className={editorTool === tool ? "selected" : ""} onClick={() => setEditorTool(tool)}>{tool === "inspect" ? "选择" : tool === "paint" ? "画笔" : "循环"}</button>
                  ))}
                </div>
              </>
            )}
            <div className="history-tools">
              <button type="button" className={`focus-toggle ${focusMode ? "selected" : ""}`} onClick={() => setFocusMode((value) => !value)}>{focusMode ? "显示面板" : "专注棋盘"}</button>
              <button type="button" disabled={!canUndo} onClick={undo} aria-label="撤销">↶</button>
              <button type="button" disabled={!canRedo} onClick={redo} aria-label="重做">↷</button>
              {mode === "play" ? <button type="button" onClick={restartPlay}>重置</button> : <button type="button" onClick={() => switchMode("play")}>测试游玩</button>}
            </div>
          </header>

          <div className={`board-stage status-${currentState.status}`}>
            <div className="stage-corners"><i /><i /><i /><i /></div>
            <BoardCanvas
              state={currentState}
              stateCount={config.stateCount}
              mode={mode}
              editorSurface={editorSurface}
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
              <div className="completion-overlay"><span>SESSION COMPLETE</span><strong>目标达成</strong><p>{currentState.turn} 次操作完成当前规则实例</p><button type="button" onClick={() => {
                const next = { ...activePreset, level: { ...activePreset.level, seed: activePreset.level.seed + 1, initialValues: undefined } };
                changePreset(next, true);
              }}>生成下一局</button></div>
            )}
          </div>

          <footer className="board-statusbar">
            <div><span>STATUS</span><b className={`status-${currentState.status}`}>{mode === "edit" ? SURFACE_LABELS[editorSurface] : statusLabel(currentState.status)}</b></div>
            <div><span>TURN</span><b>{currentState.turn.toString().padStart(3, "0")}</b></div>
            <div><span>UNRESOLVED</span><b>{activeCount}/{targetCount}</b></div>
            <div><span>SEED</span><b>{config.seed.toString().padStart(6, "0")}</b></div>
            <div className="status-spacer" /><div><span>RULESET</span><b>{ruleset.id}</b></div>
          </footer>
        </section>

        {!focusMode && <RuleDeck presets={presets} activeIndex={activeIndex} activePreset={activePreset} savedAt={savedAt} isSaved={isSaved} onSwitch={switchRule} onChange={changePreset} onDuplicate={copyRule} onDelete={deleteRule} />}
        {!focusMode && (
          <InspectorPanel
            mode={mode}
            state={currentState}
            selectedEntity={selectedEntity}
            solver={solver}
            events={events}
            nodeCount={nodeCount}
            activeCount={activeCount}
            targetCount={targetCount}
            stateCount={config.stateCount}
            geometry={config.geometry ?? "square"}
            compositeInfluence={activePreset.definition.compositeInfluence}
            paintValue={paintValue}
            goalPaintValue={goalPaintValue}
            influencePaintValue={influencePaintValue}
            editorTool={editorTool}
            editorSurface={editorSurface}
            affectedCount={hovered ? affected.size : null}
            showSolution={showSolution}
            onPaintValueChange={setPaintValue}
            onGoalPaintValueChange={setGoalPaintValue}
            onInfluencePaintValueChange={setInfluencePaintValue}
            onFill={fillEditor}
            onApplyHint={applyHint}
            onToggleSolution={() => setShowSolution((value) => !value)}
          />
        )}
      </section>
    </main>
  );
}

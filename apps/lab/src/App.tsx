import { useEffect, useMemo, useRef, useState } from "react";
import {
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
} from "@lightout/engine";
import {
  createDefaultGenerationRegistry,
  createGenerationRequest,
  generatePuzzle,
  type GenerationLayerId,
  type GenerationLayerMode,
  type GenerationProgress,
  type PuzzleGenerationRequest,
  type PuzzleGenerationResult,
} from "@lightout/generator";
import {
  CELL_ROLES,
  cellRoleFor,
  cellPropertiesFor,
  compilePuzzleDesign,
  createStandardRegistry,
  formatNodeId,
  propertiesForRole,
  supportedInfluencesFor,
  type CellRole,
  type InfluencePattern,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import { createDefaultSolverRegistry, solvePuzzle } from "@lightout/solver";
import { BoardCanvas } from "./components/BoardCanvas";
import { GeneratorPanel } from "./components/GeneratorPanel";
import { InspectorPanel } from "./components/InspectorPanel";
import { RuleDeck } from "./components/RuleDeck";
import {
  commitDesignHistory,
  createDesignHistory,
  duplicatePreset,
  loadPreference,
  loadWorkspace,
  redoDesignHistory,
  replaceGameInstance,
  savePreference,
  saveWorkspace,
  undoDesignHistory,
  type DesignHistory,
  type EditorPaintValue,
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
  structure: "棋盘结构",
  role: "格子角色",
  influence: "影响属性",
  initial: "初始棋局",
  goal: "目标棋局",
};

const SURFACES: EditorSurface[] = ["structure", "role", "influence", "initial", "goal"];

function entityAtNode(state: Readonly<GameState>, nodeId: string): GameEntity | undefined {
  return Object.values(state.entities).find((entity) => entity.nodeId === nodeId);
}

function clearInitialValues(source: Readonly<PuzzleDesign>): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  next.seed += 1;
  for (const cell of Object.values(next.cells)) delete cell.initial;
  return next;
}

function materializeInitialValues(
  source: Readonly<PuzzleDesign>,
  state: Readonly<GameState>,
): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  for (const entity of Object.values(state.entities)) {
    if (!entity.nodeId || typeof entity.channels.power !== "number") continue;
    const cell = next.cells[entity.nodeId] ?? {};
    cell.initial = { power: entity.channels.power };
    next.cells[entity.nodeId] = cell;
  }
  return next;
}

function designNodeIds(design: Readonly<PuzzleDesign>): string[] {
  const nodeIds: string[] = [];
  for (let y = 0; y < design.board.height; y += 1) {
    for (let x = 0; x < design.board.width; x += 1) {
      nodeIds.push(formatNodeId(x, y));
    }
  }
  return nodeIds;
}

function clearLayerFixedValues(
  request: PuzzleGenerationRequest,
  layer: GenerationLayerId,
): void {
  if (layer === "structure") request.layers.structure.fixed.exists = {};
  else {
    request.layers[layer].fixed.cells = {};
    if (layer === "influence") {
      request.layers.influence.fixed.policy = undefined;
      request.layers.influence.fixed.defaultInfluence = undefined;
    }
  }
}

function captureLayerFixedValues(
  request: PuzzleGenerationRequest,
  layer: GenerationLayerId,
): void {
  const design = request.baseDesign;
  clearLayerFixedValues(request, layer);
  if (layer === "structure") {
    request.layers.structure.fixed.frame = {
      geometry: design.board.geometry,
      width: design.board.width,
      height: design.board.height,
      stateCount: design.rule.stateCount,
    };
    for (const nodeId of designNodeIds(design)) {
      request.layers.structure.fixed.exists[nodeId] = cellPropertiesFor(design, nodeId).exists;
    }
    return;
  }
  if (layer === "role") {
    for (const nodeId of designNodeIds(design)) {
      request.layers.role.fixed.cells[nodeId] = cellRoleFor(cellPropertiesFor(design, nodeId));
    }
    return;
  }
  if (layer === "influence") {
    request.layers.influence.fixed.policy =
      design.rule.propertyPolicies.influenceId;
    request.layers.influence.fixed.defaultInfluence =
      design.rule.cellDefaults.influenceId;
    for (const nodeId of designNodeIds(design)) {
      request.layers.influence.fixed.cells[nodeId] = cellPropertiesFor(design, nodeId).influenceId;
    }
    return;
  }
  if (layer === "goal") {
    for (const nodeId of designNodeIds(design)) {
      const properties = cellPropertiesFor(design, nodeId);
      if (!properties.exists || !properties.hasPower) continue;
      request.layers.goal.fixed.cells[nodeId] =
        design.cells[nodeId]?.goal?.power?.value ?? null;
    }
    return;
  }
  for (const nodeId of designNodeIds(design)) {
    const properties = cellPropertiesFor(design, nodeId);
    const value = design.cells[nodeId]?.initial?.power;
    if (properties.exists && properties.hasPower && value !== undefined) {
      request.layers.initial.fixed.cells[nodeId] = value;
    }
  }
}

export function App() {
  const initialWorkspace = useMemo(() => loadWorkspace(), []);
  const initialPreset = initialWorkspace.presets.find((preset) => preset.id === initialWorkspace.activeRuleId) ?? initialWorkspace.presets[0]!;
  const initialExperiment = useMemo(() => compilePuzzleDesign(initialPreset.game.design), []);
  const mechanics = useMemo(() => createStandardRegistry(), []);
  const solverRegistry = useMemo(() => createDefaultSolverRegistry(), []);
  const generationRegistry = useMemo(() => createDefaultGenerationRegistry(), []);
  const generationAbort = useRef<AbortController | null>(null);

  const [presets, setPresets] = useState(initialWorkspace.presets);
  const [activeRuleId, setActiveRuleId] = useState(initialWorkspace.activeRuleId);
  const [savedAt, setSavedAt] = useState(Date.now());
  const [isSaved, setIsSaved] = useState(true);
  const [editorHistory, setEditorHistory] = useState<DesignHistory>(() => createDesignHistory(initialPreset.game.design));
  const [playHistory, setPlayHistory] = useState<HistoryState>(() => createHistory(initialExperiment.initialState));
  const [mode, setMode] = useState<WorkspaceMode>("play");
  const [editorTool, setEditorTool] = useState<EditorTool>("paint");
  const [editorSurface, setEditorSurface] = useState<EditorSurface>("initial");
  const [structurePaintValue, setStructurePaintValue] = useState(true);
  const [rolePaintValue, setRolePaintValue] = useState<CellRole>("standard");
  const [paintValue, setPaintValue] = useState(0);
  const [goalPaintValue, setGoalPaintValue] = useState<number | null>(0);
  const [influencePaintValue, setInfluencePaintValue] = useState<InfluencePattern>(initialPreset.game.design.rule.cellDefaults.influenceId);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadPreference("lightout-theme", ["light", "dark"], "dark"));
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generationRequest, setGenerationRequest] = useState<PuzzleGenerationRequest | null>(null);
  const [generationResult, setGenerationResult] = useState<PuzzleGenerationResult | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationLockLayer, setGenerationLockLayer] = useState<GenerationLayerId | null>(null);

  const activeIndex = Math.max(0, presets.findIndex((preset) => preset.id === activeRuleId));
  const activePreset = presets[activeIndex] ?? presets[0]!;
  const design = editorHistory.present;
  const experiment = useMemo(() => compilePuzzleDesign(design), [design]);
  const candidateDesign = generatorOpen && generationResult?.status === "generated"
    ? generationResult.design
    : undefined;
  const displayDesign = candidateDesign ?? design;
  const displayExperiment = useMemo(
    () => candidateDesign ? compilePuzzleDesign(candidateDesign) : experiment,
    [candidateDesign, experiment],
  );
  const ruleset = displayExperiment.ruleset;
  const currentState = generatorOpen
    ? displayExperiment.initialState
    : mode === "play"
      ? playHistory.present
      : experiment.initialState;

  const solver = useMemo(
    () => solvePuzzle(currentState, ruleset, mechanics, solverRegistry),
    [currentState, ruleset, mechanics, solverRegistry],
  );
  const solution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entityId of solver.presses) {
      const nodeId = currentState.entities[entityId]?.nodeId;
      if (nodeId) counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
    }
    return counts;
  }, [currentState.entities, solver.presses]);
  const affected = useMemo(() => {
    if (!hovered) return new Set<string>();
    if (mode === "edit" && editorSurface !== "influence") return new Set([hovered]);
    const anchor = entityAtNode(currentState, hovered);
    if (!anchor) return new Set<string>();
    return new Set(getCommandTargets(
      currentState,
      { type: "activate", anchorEntityId: anchor.id },
      ruleset,
      mechanics,
    ).flatMap((entityId) => currentState.entities[entityId]?.nodeId ?? []));
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

  function syncEditorDesign(next: PuzzleDesign, resetHistory: boolean): void {
    setEditorHistory((history) => resetHistory
      ? createDesignHistory(next)
      : commitDesignHistory(history, next));
    const compiled = compilePuzzleDesign(next);
    setPlayHistory(createHistory(compiled.initialState));
    setPaintValue((value) => Math.min(value, next.rule.stateCount - 1));
    setGoalPaintValue((value) => value === null ? null : Math.min(value, next.rule.stateCount - 1));
    setInfluencePaintValue(next.rule.cellDefaults.influenceId);
    if (next.rule.propertyPolicies.influenceId !== "per-cell") {
      setEditorSurface((surface) => surface === "influence" ? "initial" : surface);
    }
    resetTransientState();
  }

  function changePreset(next: RulePreset, rebuild: boolean): void {
    const changedPreset = rebuild
      ? replaceGameInstance(next, { design: next.game.design })
      : next;
    setPresets((current) => current.map((preset) => preset.id === next.id ? changedPreset : preset));
    if (rebuild) {
      closeGenerator();
      syncEditorDesign(next.game.design, false);
    }
  }

  function persistDesign(next: PuzzleDesign): void {
    setPresets((current) => current.map((preset) =>
      preset.id === activeRuleId ? replaceGameInstance(preset, { design: next }) : preset,
    ));
  }

  function commitDesign(next: PuzzleDesign, nodeIds: Iterable<string>): void {
    setEditorHistory((history) => commitDesignHistory(history, next));
    persistDesign(next);
    setEvents([]);
    setChanged(new Set(nodeIds));
    setShowSolution(false);
  }

  function switchRule(index: number): void {
    const next = presets[index];
    if (!next || next.id === activeRuleId) return;
    closeGenerator();
    setActiveRuleId(next.id);
    syncEditorDesign(next.game.design, true);
  }

  function copyRule(): void {
    closeGenerator();
    const copy = duplicatePreset({
      ...activePreset,
      game: { ...activePreset.game, design },
    });
    setPresets((current) => [...current, copy]);
    setActiveRuleId(copy.id);
    syncEditorDesign(copy.game.design, true);
  }

  function deleteRule(): void {
    if (presets.length <= 1) return;
    if (!window.confirm(`删除规则“${activePreset.name}”？此操作无法撤销。`)) return;
    closeGenerator();
    const remaining = presets.filter((preset) => preset.id !== activePreset.id);
    const next = remaining[Math.min(activeIndex, remaining.length - 1)];
    if (!next) return;
    setPresets(remaining);
    setActiveRuleId(next.id);
    syncEditorDesign(next.game.design, true);
  }

  function switchMode(next: WorkspaceMode): void {
    if (generatorOpen) closeGenerator();
    if (next === mode) return;
    if (next === "play") {
      const playState = evaluateState(experiment.initialState, ruleset, mechanics);
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
    setChanged(new Set(nextEvents.filter((event) => event.type === "channel-changed").flatMap((event) => currentState.entities[event.entityId]?.nodeId ?? [])));
  }

  function executePlayCommand(command: GameCommand): void {
    const result = dispatch(playHistory.present, command, ruleset, mechanics);
    markEvents(result.events);
    if (result.accepted) setPlayHistory((history) => commitHistory(history, result.state));
  }

  function cycleValue(nodeId: string, source: Readonly<PuzzleDesign>): EditorPaintValue {
    const cell = source.cells[nodeId] ?? {};
    const properties = cellPropertiesFor(source, nodeId);
    if (editorSurface === "structure") return !properties.exists;
    if (editorSurface === "role") return CELL_ROLES[(CELL_ROLES.indexOf(cellRoleFor(properties)) + 1) % CELL_ROLES.length] ?? "standard";
    if (editorSurface === "influence") {
      const available = supportedInfluencesFor(source.board.geometry);
      return available[(available.indexOf(properties.influenceId) + 1) % available.length] ?? available[0] ?? "neighbors";
    }
    if (editorSurface === "initial") {
      const entity = entityAtNode(experiment.initialState, nodeId);
      return (Number(entity?.channels.power ?? 0) + 1) % source.rule.stateCount;
    }
    const goal = cell.goal?.power?.value;
    return goal === undefined ? 0 : goal >= source.rule.stateCount - 1 ? null : goal + 1;
  }

  function applyCellValue(source: PuzzleDesign, nodeId: string, value: EditorPaintValue): boolean {
    const cell = source.cells[nodeId] ?? {};
    const properties = cellPropertiesFor(source, nodeId);
    if (editorSurface === "structure" && typeof value === "boolean") {
      cell.properties = { ...cell.properties, exists: value };
    } else if (editorSurface === "role" && typeof value === "string" && CELL_ROLES.includes(value as CellRole)) {
      cell.properties = { ...cell.properties, ...propertiesForRole(value as CellRole) };
    } else if (editorSurface === "influence") {
      if (source.rule.propertyPolicies.influenceId !== "per-cell" || typeof value !== "string") return false;
      cell.properties = { ...cell.properties, influenceId: value as InfluencePattern };
    } else if (editorSurface === "initial") {
      if (!properties.exists || !properties.hasPower || typeof value !== "number") return false;
      cell.initial = { power: value };
    } else if (editorSurface === "goal") {
      if (!properties.exists || !properties.hasPower) return false;
      cell.goal = typeof value === "number" ? { power: { operator: "equals", value } } : undefined;
    } else return false;
    source.cells[nodeId] = cell;
    return true;
  }

  function editNode(nodeId: string): void {
    if (editorTool === "inspect") return;
    let next = editorSurface === "initial"
      ? materializeInitialValues(design, experiment.initialState)
      : structuredClone(design) as PuzzleDesign;
    const value = editorTool === "cycle" ? cycleValue(nodeId, next) : editorSurface === "structure" ? structurePaintValue : editorSurface === "role" ? rolePaintValue : editorSurface === "influence" ? influencePaintValue : editorSurface === "initial" ? paintValue : goalPaintValue;
    if (applyCellValue(next, nodeId, value)) commitDesign(next, [nodeId]);
  }

  function activateNode(nodeId: string): void {
    setSelected(nodeId);
    if (generatorOpen) {
      if (generationLockLayer) toggleGenerationLock(generationLockLayer, nodeId);
      return;
    }
    if (mode === "edit") {
      editNode(nodeId);
      return;
    }
    const entity = entityAtNode(playHistory.present, nodeId);
    if (entity) executePlayCommand({ type: "activate", anchorEntityId: entity.id });
  }

  function fillEditor(value: EditorPaintValue): void {
    let next = editorSurface === "initial"
      ? materializeInitialValues(design, experiment.initialState)
      : structuredClone(design) as PuzzleDesign;
    const changedNodes: string[] = [];
    for (let y = 0; y < next.board.height; y += 1) {
      for (let x = 0; x < next.board.width; x += 1) {
        const nodeId = formatNodeId(x, y);
        if (applyCellValue(next, nodeId, value)) changedNodes.push(nodeId);
      }
    }
    if (changedNodes.length > 0) commitDesign(next, changedNodes);
  }

  function undo(): void {
    if (mode === "play") setPlayHistory((history) => undoHistory(history));
    else {
      const next = undoDesignHistory(editorHistory);
      setEditorHistory(next);
      persistDesign(next.present);
    }
    setEvents([]);
    setChanged(new Set());
  }

  function redo(): void {
    if (mode === "play") setPlayHistory((history) => redoHistory(history));
    else {
      const next = redoDesignHistory(editorHistory);
      setEditorHistory(next);
      persistDesign(next.present);
    }
    setEvents([]);
    setChanged(new Set());
  }

  function restartPlay(): void {
    const playState = evaluateState(experiment.initialState, ruleset, mechanics);
    setPlayHistory(resetHistory(playState));
    setEvents([]);
    setChanged(new Set());
    setShowSolution(false);
  }

  function applyHint(): void {
    const first = solver.presses[0];
    if (first && mode === "play") executePlayCommand({ type: "activate", anchorEntityId: first });
  }

  function openGenerator(): void {
    generationAbort.current?.abort();
    const explicitBase = materializeInitialValues(design, experiment.initialState);
    setGenerationRequest(createGenerationRequest(explicitBase));
    setGenerationResult(null);
    setGenerationProgress(null);
    setGenerationBusy(false);
    setGenerationLockLayer(null);
    setGeneratorOpen(true);
    setFocusMode(false);
    setMode("edit");
    setEditorTool("inspect");
    resetTransientState();
  }

  function closeGenerator(): void {
    generationAbort.current?.abort();
    generationAbort.current = null;
    setGeneratorOpen(false);
    setGenerationBusy(false);
    setGenerationResult(null);
    setGenerationProgress(null);
    setGenerationLockLayer(null);
  }

  function updateGenerationRequest(next: PuzzleGenerationRequest): void {
    generationAbort.current?.abort();
    setGenerationRequest(next);
    setGenerationResult(null);
    setGenerationProgress(null);
    setGenerationBusy(false);
  }

  function changeGenerationLayerMode(
    layer: GenerationLayerId,
    nextMode: GenerationLayerMode,
  ): void {
    if (!generationRequest) return;
    const next = structuredClone(generationRequest) as PuzzleGenerationRequest;
    next.layers[layer].mode = nextMode;
    if (nextMode === "fixed") captureLayerFixedValues(next, layer);
    else clearLayerFixedValues(next, layer);
    updateGenerationRequest(next);
    setGenerationLockLayer(nextMode === "mixed" ? layer : null);
    setEditorSurface(layer);
  }

  function changeGenerationFrameLock(locked: boolean): void {
    if (!generationRequest) return;
    const next = structuredClone(generationRequest) as PuzzleGenerationRequest;
    next.layers.structure.fixed.frame = locked
      ? {
          geometry: next.baseDesign.board.geometry,
          width: next.baseDesign.board.width,
          height: next.baseDesign.board.height,
          stateCount: next.baseDesign.rule.stateCount,
        }
      : undefined;
    updateGenerationRequest(next);
  }

  function toggleGenerationLock(layer: GenerationLayerId, nodeId: string): void {
    if (!generationRequest || generationRequest.layers[layer].mode !== "mixed") return;
    const next = structuredClone(generationRequest) as PuzzleGenerationRequest;
    const base = next.baseDesign;
    const properties = cellPropertiesFor(base, nodeId);
    if (layer === "structure") {
      const values = next.layers.structure.fixed.exists;
      if (Object.prototype.hasOwnProperty.call(values, nodeId)) delete values[nodeId];
      else values[nodeId] = properties.exists;
    } else if (layer === "role") {
      const values = next.layers.role.fixed.cells;
      if (Object.prototype.hasOwnProperty.call(values, nodeId)) delete values[nodeId];
      else values[nodeId] = cellRoleFor(properties);
    } else if (layer === "influence") {
      const values = next.layers.influence.fixed.cells;
      if (Object.prototype.hasOwnProperty.call(values, nodeId)) delete values[nodeId];
      else values[nodeId] = properties.influenceId;
    } else if (layer === "goal") {
      if (!properties.exists || !properties.hasPower) return;
      const values = next.layers.goal.fixed.cells;
      if (Object.prototype.hasOwnProperty.call(values, nodeId)) delete values[nodeId];
      else values[nodeId] = base.cells[nodeId]?.goal?.power?.value ?? null;
    } else {
      if (!properties.exists || !properties.hasPower) return;
      const value = base.cells[nodeId]?.initial?.power;
      if (value === undefined) return;
      const values = next.layers.initial.fixed.cells;
      if (Object.prototype.hasOwnProperty.call(values, nodeId)) delete values[nodeId];
      else values[nodeId] = value;
    }
    updateGenerationRequest(next);
    setGenerationLockLayer(layer);
  }

  async function runGeneration(): Promise<void> {
    if (!generationRequest || generationBusy) return;
    const nextRequest = structuredClone(generationRequest) as PuzzleGenerationRequest;
    if (generationResult) nextRequest.seed += 1;
    setGenerationRequest(nextRequest);
    setGenerationResult(null);
    setGenerationProgress(null);
    setGenerationLockLayer(null);
    const controller = new AbortController();
    generationAbort.current?.abort();
    generationAbort.current = controller;
    setGenerationBusy(true);
    const result = await generatePuzzle(
      nextRequest,
      generationRegistry,
      { mechanics, solvers: solverRegistry },
      {
        signal: controller.signal,
        onProgress: (progress) => setGenerationProgress(progress),
      },
    );
    if (controller.signal.aborted) return;
    generationAbort.current = null;
    setGenerationBusy(false);
    setGenerationResult(result);
  }

  function generationRecord() {
    if (!generationRequest || !generationResult) return undefined;
    return {
      request: structuredClone(generationRequest) as PuzzleGenerationRequest,
      report: structuredClone(generationResult.report),
    };
  }

  function applyGeneratedGame(): void {
    const generated = generationResult?.design;
    const record = generationRecord();
    if (!generated || !record) return;
    setEditorHistory((history) => commitDesignHistory(history, generated));
    setPresets((current) => current.map((preset) =>
      preset.id === activeRuleId
        ? replaceGameInstance(preset, { design: generated, generation: record })
        : preset,
    ));
    const compiled = compilePuzzleDesign(generated);
    setPlayHistory(createHistory(compiled.initialState));
    closeGenerator();
    resetTransientState();
  }

  const constrained = Object.values(currentState.entities).flatMap((entity) => {
    if (!entity.nodeId || entity.properties.hasPower !== true) return [];
    const goal = displayDesign.cells[entity.nodeId]?.goal?.power?.value;
    return goal === undefined ? [] : [{ entity, goal }];
  });
  const targetCount = constrained.length;
  const activeCount = constrained.filter(({ entity, goal }) => entity.channels.power !== goal).length;
  const nodeCount = Object.keys(currentState.board.nodes).length;
  const selectedEntity = selected ? entityAtNode(currentState, selected) : undefined;
  const canUndo = mode === "play" ? playHistory.past.length > 0 : editorHistory.past.length > 0;
  const canRedo = mode === "play" ? playHistory.future.length > 0 : editorHistory.future.length > 0;
  const generationLockedNodes = useMemo(() => {
    if (!generationRequest || !generationLockLayer) return new Set<string>();
    const fixed = generationLockLayer === "structure"
      ? generationRequest.layers.structure.fixed.exists
      : generationRequest.layers[generationLockLayer].fixed.cells;
    return new Set(Object.keys(fixed));
  }, [generationLockLayer, generationRequest]);

  return (
    <main className="workbench-shell">
      <header className="command-bar">
        <div className="brand-mark"><i /><div><strong>LIGHTOUT</strong><span>MECHANIC WORKBENCH</span></div></div>
        <div className="project-heading"><span>{generatorOpen ? "GAME DRAFT" : "ACTIVE RULE"}</span><strong>{activePreset.name}</strong><small>{generatorOpen ? "候选预览不会修改当前牌局或规则" : activePreset.description}</small></div>
        <div className="mode-switcher" role="tablist" aria-label="工作模式"><button type="button" role="tab" aria-selected={mode === "play"} className={mode === "play" ? "selected" : ""} onClick={() => switchMode("play")}><span>▶</span><div><strong>游玩</strong><small>PLAY</small></div></button><button type="button" role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "selected" : ""} onClick={() => switchMode("edit")}><span>✦</span><div><strong>编辑</strong><small>EDIT</small></div></button></div>
        <button className="theme-button" type="button" onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}><span>{theme === "dark" ? "☼" : "◐"}</span><small>{theme === "dark" ? "LIGHT" : "DARK"}</small></button>
      </header>

      <section className={`workspace-grid ${focusMode ? "focus-mode" : ""}`}>
        <section className={`workspace-panel board-workspace mode-${mode}`}>
          <header className={`board-toolbar mode-${mode} ${generatorOpen ? "mode-generator" : ""}`}>
            <div className="scene-title"><span>{generatorOpen ? "GENERATOR PREVIEW" : mode === "play" ? "PLAY SESSION" : SURFACE_LABELS[editorSurface]}</span><strong>{displayDesign.board.width}×{displayDesign.board.height} · {displayDesign.rule.stateCount} STATE</strong></div>
            {mode === "edit" && !generatorOpen && <><div className="surface-switcher" role="tablist" aria-label="编辑对象">{SURFACES.map((surface) => <button key={surface} type="button" role="tab" aria-selected={editorSurface === surface} className={editorSurface === surface ? "selected" : ""} disabled={surface === "influence" && design.rule.propertyPolicies.influenceId !== "per-cell"} title={surface === "influence" && design.rule.propertyPolicies.influenceId !== "per-cell" ? "请先在 RULE DECK 选择逐格影响" : undefined} onClick={() => setEditorSurface(surface)}>{SURFACE_LABELS[surface]}</button>)}</div><div className="editor-tools" role="toolbar" aria-label="编辑工具">{(["inspect", "paint", "cycle"] as EditorTool[]).map((tool) => <button key={tool} type="button" className={editorTool === tool ? "selected" : ""} onClick={() => setEditorTool(tool)}>{tool === "inspect" ? "选择" : tool === "paint" ? "画笔" : "循环"}</button>)}</div></>}
            {generatorOpen && <div className="generator-toolbar-note"><span>{generationLockLayer ? `正在锁定：${SURFACE_LABELS[generationLockLayer]}` : generationResult?.status === "generated" ? "候选已通过编译与求解验证" : "设置生成层后创建候选"}</span><small>{generationLockLayer ? "点击棋盘格切换固定状态" : "PREVIEW ISOLATED"}</small></div>}
            <div className="history-tools">{generatorOpen ? <button type="button" onClick={closeGenerator}>退出生成</button> : <><button type="button" className="generate-game" onClick={openGenerator}>生成牌局</button><button type="button" className={`focus-toggle ${focusMode ? "selected" : ""}`} onClick={() => setFocusMode((value) => !value)}>{focusMode ? "显示面板" : "专注棋盘"}</button><button type="button" disabled={!canUndo} onClick={undo} aria-label="撤销">↶</button><button type="button" disabled={!canRedo} onClick={redo} aria-label="重做">↷</button>{mode === "play" ? <button type="button" onClick={restartPlay}>重置</button> : <button type="button" onClick={() => switchMode("play")}>测试游玩</button>}</>}</div>
          </header>

          <div className={`board-stage status-${currentState.status}`}>
            <div className="stage-corners"><i /><i /><i /><i /></div>
            <BoardCanvas state={currentState} design={displayDesign} mode={mode} editorSurface={generationLockLayer ?? editorSurface} hovered={hovered} selected={selected} affected={affected} changed={changed} solution={solution} showSolution={!generatorOpen && mode === "play" && showSolution} generationLocked={generationLockedNodes} onHover={setHovered} onActivate={activateNode} />
            {mode === "play" && currentState.status === "won" && <div className="completion-overlay"><span>SESSION COMPLETE</span><strong>目标达成</strong><p>{currentState.turn} 次操作完成当前牌局</p><button type="button" onClick={() => changePreset({ ...activePreset, game: { design: clearInitialValues(design) } }, true)}>随机初始局面</button></div>}
          </div>

          <footer className="board-statusbar"><div><span>STATUS</span><b className={`status-${currentState.status}`}>{generatorOpen ? "生成预览" : mode === "edit" ? SURFACE_LABELS[editorSurface] : statusLabel(currentState.status)}</b></div><div><span>TURN</span><b>{currentState.turn.toString().padStart(3, "0")}</b></div><div><span>UNRESOLVED</span><b>{activeCount}/{targetCount}</b></div><div><span>SEED</span><b>{displayDesign.seed.toString().padStart(6, "0")}</b></div><div className="status-spacer" /><div><span>RULESET</span><b>{ruleset.id}</b></div></footer>
        </section>

        {!focusMode && <RuleDeck presets={presets} activeIndex={activeIndex} activePreset={{ ...activePreset, game: { ...activePreset.game, design } }} savedAt={savedAt} isSaved={isSaved} onSwitch={switchRule} onChange={changePreset} onDuplicate={copyRule} onDelete={deleteRule} />}
        {!focusMode && (generatorOpen && generationRequest
          ? <GeneratorPanel request={generationRequest} result={generationResult} progress={generationProgress} busy={generationBusy} lockLayer={generationLockLayer} onRequestChange={updateGenerationRequest} onLayerModeChange={changeGenerationLayerMode} onLockLayerChange={(layer) => { setGenerationLockLayer(layer); if (layer) setEditorSurface(layer); }} onFrameLockChange={changeGenerationFrameLock} onGenerate={() => void runGeneration()} onApply={applyGeneratedGame} onClose={closeGenerator} />
          : <InspectorPanel mode={mode} state={currentState} selectedNodeId={selected} selectedEntity={selectedEntity} solver={solver} events={events} nodeCount={nodeCount} activeCount={activeCount} targetCount={targetCount} stateCount={design.rule.stateCount} geometry={design.board.geometry} perCellInfluence={design.rule.propertyPolicies.influenceId === "per-cell"} structurePaintValue={structurePaintValue} rolePaintValue={rolePaintValue} paintValue={paintValue} goalPaintValue={goalPaintValue} influencePaintValue={influencePaintValue} editorTool={editorTool} editorSurface={editorSurface} affectedCount={hovered ? affected.size : null} showSolution={showSolution} onStructurePaintValueChange={setStructurePaintValue} onRolePaintValueChange={setRolePaintValue} onPaintValueChange={setPaintValue} onGoalPaintValueChange={setGoalPaintValue} onInfluencePaintValueChange={setInfluencePaintValue} onFill={fillEditor} onApplyHint={applyHint} onToggleSolution={() => setShowSolution((value) => !value)} />)}
      </section>
    </main>
  );
}

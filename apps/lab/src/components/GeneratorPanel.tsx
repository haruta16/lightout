import {
  GENERATION_LAYERS,
  type GenerationLayerId,
  type GenerationLayerMode,
  type GenerationProgress,
  type PuzzleGenerationRequest,
  type PuzzleGenerationResult,
} from "@lightout/generator";

const LAYER_LABELS: Record<GenerationLayerId, string> = {
  structure: "棋盘结构",
  role: "格子角色",
  influence: "影响属性",
  goal: "目标棋局",
  initial: "初始棋局",
};

const MODE_LABELS: Record<GenerationLayerMode, string> = {
  generate: "生成",
  fixed: "固定",
  mixed: "混合",
};

interface GeneratorPanelProps {
  request: PuzzleGenerationRequest;
  result: PuzzleGenerationResult | null;
  progress: GenerationProgress | null;
  busy: boolean;
  lockLayer: GenerationLayerId | null;
  onRequestChange: (request: PuzzleGenerationRequest) => void;
  onLayerModeChange: (layer: GenerationLayerId, mode: GenerationLayerMode) => void;
  onLockLayerChange: (layer: GenerationLayerId | null) => void;
  onFrameLockChange: (locked: boolean) => void;
  onGenerate: () => void;
  onApply: () => void;
  onClose: () => void;
}

function fixedCount(
  request: Readonly<PuzzleGenerationRequest>,
  layer: GenerationLayerId,
): number {
  if (layer === "structure") return Object.keys(request.layers.structure.fixed.exists).length;
  return Object.keys(request.layers[layer].fixed.cells).length;
}

function solutionLengthConstraint(
  request: Readonly<PuzzleGenerationRequest>,
) {
  return request.acceptance.find((definition) => definition.type === "solution-length");
}

export function GeneratorPanel({
  request,
  result,
  progress,
  busy,
  lockLayer,
  onRequestChange,
  onLayerModeChange,
  onLockLayerChange,
  onFrameLockChange,
  onGenerate,
  onApply,
  onClose,
}: GeneratorPanelProps) {
  const solutionLength = solutionLengthConstraint(request);
  const generated = result?.status === "generated";

  function patchRequest(
    mutate: (next: PuzzleGenerationRequest) => void,
  ): void {
    const next = structuredClone(request) as PuzzleGenerationRequest;
    mutate(next);
    onRequestChange(next);
  }

  function toggleSolutionLength(enabled: boolean): void {
    patchRequest((next) => {
      next.acceptance = next.acceptance.filter(
        (definition) => definition.type !== "solution-length",
      );
      if (enabled) {
        next.acceptance.push({
          type: "solution-length",
          params: { min: 1, max: Math.max(1, next.baseDesign.board.width * 2) },
        });
      }
    });
  }

  function setSolutionLength(bound: "min" | "max", value: number): void {
    patchRequest((next) => {
      const constraint = next.acceptance.find(
        (definition) => definition.type === "solution-length",
      );
      if (constraint) constraint.params[bound] = Math.max(0, Math.floor(value));
    });
  }

  return (
    <aside className="workspace-panel inspector-panel generator-panel">
      <div className="panel-kicker"><span>GENERATOR</span><b>DESIGN PIPELINE</b></div>
      <div className="inspector-context">
        <span>{busy ? "正在搜索候选" : generated ? "候选已通过验证" : "按层生成关卡"}</span>
        <strong>{generated ? `Seed ${result.report.seed}` : "牌局生成工作台"}</strong>
      </div>

      <div className="panel-scroll inspector-scroll generator-scroll">
        <section className="inspector-section generator-run-config">
          <header><span>RUN</span><div><strong>运行参数</strong><small>Deterministic request</small></div></header>
          <div className="generator-number-grid">
            <label><span>SEED</span><input type="number" value={request.seed} disabled={busy} onChange={(event) => patchRequest((next) => { next.seed = Number(event.target.value); })} /></label>
            <label><span>尝试上限</span><input type="number" min="1" max="999" value={request.budget.maxAttempts} disabled={busy} onChange={(event) => patchRequest((next) => { next.budget.maxAttempts = Math.max(1, Math.floor(Number(event.target.value))); })} /></label>
          </div>
          <label className="generator-check"><input type="checkbox" checked={solutionLength !== undefined} disabled={busy} onChange={(event) => toggleSolutionLength(event.target.checked)} /><span>限制参考解长度</span></label>
          {solutionLength && <div className="generator-number-grid compact">
            <label><span>最少</span><input type="number" min="0" value={Number(solutionLength.params.min ?? 0)} disabled={busy} onChange={(event) => setSolutionLength("min", Number(event.target.value))} /></label>
            <label><span>最多</span><input type="number" min="0" value={Number(solutionLength.params.max ?? 0)} disabled={busy} onChange={(event) => setSolutionLength("max", Number(event.target.value))} /></label>
          </div>}
        </section>

        <section className="inspector-section generator-layers">
          <header><span>LAY</span><div><strong>生成层</strong><small>Generated / fixed / mixed</small></div></header>
          <div className="generator-frame-lock">
            <div><strong>尺寸、拓扑与状态数</strong><small>结构生成器的框架输入</small></div>
            <button type="button" className={request.layers.structure.fixed.frame ? "selected" : ""} disabled={busy} onClick={() => onFrameLockChange(!request.layers.structure.fixed.frame)}>
              {request.layers.structure.fixed.frame ? "固定当前" : "允许算法"}
            </button>
          </div>
          {GENERATION_LAYERS.map((layer) => {
            const directive = request.layers[layer];
            const count = fixedCount(request, layer);
            const isLocking = lockLayer === layer;
            return (
              <div className={`generator-layer-row ${isLocking ? "is-locking" : ""}`} key={layer}>
                <div className="generator-layer-heading">
                  <div><strong>{LAYER_LABELS[layer]}</strong><small>{directive.generator?.type ?? "无生成器"}</small></div>
                  <span>{directive.mode === "fixed" ? "整层固定" : `${count} 项锁定`}</span>
                </div>
                <div className="generator-mode-switch">
                  {(["generate", "fixed", "mixed"] as const).map((mode) => (
                    <button key={mode} type="button" disabled={busy} className={directive.mode === mode ? "selected" : ""} onClick={() => onLayerModeChange(layer, mode)}>{MODE_LABELS[mode]}</button>
                  ))}
                </div>
                {directive.mode === "mixed" && <button type="button" disabled={busy} className={`generator-lock-button ${isLocking ? "selected" : ""}`} onClick={() => onLockLayerChange(isLocking ? null : layer)}>
                  {isLocking ? "结束棋盘锁定" : "在棋盘上选择固定格"}
                </button>}
              </div>
            );
          })}
        </section>

        {(progress || result) && <section className={`inspector-section generator-result status-${result?.status ?? "running"}`}>
          <header><span>OUT</span><div><strong>{busy ? "候选搜索中" : generated ? "验证通过" : "没有合格候选"}</strong><small>{progress ? `${progress.attempt} / ${progress.maxAttempts} attempts` : result?.status}</small></div><i className="solver-status-dot" /></header>
          {busy && progress && <div className="generator-progress"><i style={{ width: `${Math.min(100, progress.attempt / progress.maxAttempts * 100)}%` }} /></div>}
          {result && <div className="metric-grid generator-metrics">
            <div><span>参考解</span><b>{result.report.metrics.solutionLength}</b></div>
            <div><span>目标格</span><b>{result.report.metrics.targetCount}</b></div>
            <div><span>约束秩</span><b>{result.report.metrics.rank}</b></div>
            <div><span>自由度</span><b>{result.report.metrics.freeVariables}</b></div>
          </div>}
          {result && result.report.conflicts.length > 0 && <div className="generator-conflicts">{result.report.conflicts.slice(0, 3).map((item, index) => <p key={`${item.code}-${index}`}>{item.message}</p>)}</div>}
          {result?.report.warnings.map((warning) => <p className="panel-note" key={warning}>{warning}</p>)}
        </section>}
      </div>

      <footer className="panel-footer generator-footer">
        <button type="button" className="generator-close" disabled={busy} onClick={onClose}>退出</button>
        {generated ? <div>
          <button type="button" disabled={busy} onClick={onGenerate}>再生成</button>
          <button type="button" className="generator-primary" disabled={busy} onClick={onApply}>应用为当前牌局</button>
        </div> : <button type="button" className="generator-primary" disabled={busy} onClick={onGenerate}>{busy ? "生成中…" : "生成候选"}</button>}
      </footer>
    </aside>
  );
}

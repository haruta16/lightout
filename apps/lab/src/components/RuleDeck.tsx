import { useRef, type WheelEvent } from "react";
import {
  BOARD_GEOMETRIES,
  supportedInfluencesFor,
  type BoardGeometry,
  type InfluencePattern,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import {
  changeGeometry,
  resizePuzzleDesign,
  type RulePreset,
} from "../workspace";
import { geometryLabel, geometrySymbols, influenceLabels } from "../rulePresentation";

interface RuleDeckProps {
  presets: RulePreset[];
  activeIndex: number;
  activePreset: RulePreset;
  savedAt: number;
  isSaved: boolean;
  onSwitch: (index: number) => void;
  onChange: (preset: RulePreset, rebuild: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function withStateCount(source: Readonly<PuzzleDesign>, stateCount: number): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  next.rule.stateCount = stateCount;
  for (const cell of Object.values(next.cells)) {
    if (cell.initial?.power !== undefined) cell.initial.power = Math.min(cell.initial.power, stateCount - 1);
    if (cell.goal?.power) cell.goal.power.value = Math.min(cell.goal.power.value, stateCount - 1);
  }
  return next;
}

function withoutInitialValues(source: Readonly<PuzzleDesign>): PuzzleDesign {
  const next = structuredClone(source) as PuzzleDesign;
  next.seed += 1;
  for (const cell of Object.values(next.cells)) delete cell.initial;
  return next;
}

export function RuleDeck({
  presets,
  activeIndex,
  activePreset,
  savedAt,
  isSaved,
  onSwitch,
  onChange,
  onDuplicate,
  onDelete,
}: RuleDeckProps) {
  const wheelLockedUntil = useRef(0);
  const previousIndex = (activeIndex - 1 + presets.length) % presets.length;
  const nextIndex = (activeIndex + 1) % presets.length;
  const { design } = activePreset.game;
  const supportedInfluences = supportedInfluencesFor(design.board.geometry);
  const canUsePerCell = supportedInfluences.length > 1;
  const influenceMode = design.rule.propertyPolicies.influenceId === "per-cell"
    ? "per-cell"
    : design.rule.cellDefaults.influenceId;

  function switchBy(direction: -1 | 1): void {
    onSwitch(direction < 0 ? previousIndex : nextIndex);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    if (Math.abs(event.deltaY) < 18 || Date.now() < wheelLockedUntil.current) return;
    wheelLockedUntil.current = Date.now() + 420;
    switchBy(event.deltaY > 0 ? 1 : -1);
  }

  function changeDesign(next: PuzzleDesign): void {
    onChange({ ...activePreset, game: { design: next } }, true);
  }

  return (
    <aside className="workspace-panel rule-panel">
      <div className="panel-kicker">
        <span>RULE DECK</span>
        <b>{String(activeIndex + 1).padStart(2, "0")} / {String(presets.length).padStart(2, "0")}</b>
      </div>

      <div className="rule-orbit" onWheel={handleWheel} aria-label="规则切换器">
        <button className="rule-peek previous" type="button" onClick={() => switchBy(-1)}><span>↑</span><small>{presets[previousIndex]?.name}</small></button>
        <div className="rule-identity"><span className="rule-index">R-{String(activeIndex + 1).padStart(2, "0")}</span><div><strong>{activePreset.name}</strong><small>滚轮或箭头切换规则</small></div><i /></div>
        <button className="rule-peek next" type="button" onClick={() => switchBy(1)}><span>↓</span><small>{presets[nextIndex]?.name}</small></button>
        <div className="rule-map" aria-label="全部规则">
          {presets.map((preset, index) => (
            <button key={preset.id} type="button" className={index === activeIndex ? "selected" : ""} aria-label={`切换到${preset.name}`} title={preset.name} onClick={() => onSwitch(index)}>
              <span>{geometrySymbols[preset.game.design.board.geometry]}</span><small>{String(index + 1).padStart(2, "0")}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-scroll rule-card-body">
        <section className="inspector-section rule-heading-editor">
          <label><span>规则名称</span><input value={activePreset.name} onChange={(event) => onChange({ ...activePreset, name: event.target.value }, false)} /></label>
          <label><span>设计说明</span><textarea rows={3} value={activePreset.description} onChange={(event) => onChange({ ...activePreset, description: event.target.value }, false)} /></label>
        </section>

        <section className="inspector-section">
          <header><span>01</span><div><strong>状态模型</strong><small>State model</small></div></header>
          <div className="field-row"><span>状态数量</span><div className="compact-picker">
            {[2, 3, 4, 5].map((count) => <button key={count} type="button" className={design.rule.stateCount === count ? "selected" : ""} onClick={() => changeDesign(withStateCount(design, count))}>{count}</button>)}
          </div></div>
        </section>

        <section className="inspector-section">
          <header><span>02</span><div><strong>影响属性</strong><small>Influence property</small></div></header>
          <label className="select-field"><span>应用范围</span><select value={influenceMode} onChange={(event) => {
            const value = event.target.value;
            const next = structuredClone(design) as PuzzleDesign;
            if (value === "per-cell") next.rule.propertyPolicies.influenceId = "per-cell";
            else {
              next.rule.propertyPolicies.influenceId = "uniform";
              next.rule.cellDefaults.influenceId = value as InfluencePattern;
            }
            changeDesign(next);
          }}>
            {supportedInfluences.map((value) => <option key={value} value={value}>{influenceLabels[value]}</option>)}
            {canUsePerCell && <option value="per-cell">逐格影响</option>}
          </select></label>
          {design.rule.propertyPolicies.influenceId === "per-cell" && <label className="select-field composite-base-field"><span>默认影响</span><select value={design.rule.cellDefaults.influenceId} onChange={(event) => {
            const next = structuredClone(design) as PuzzleDesign;
            next.rule.cellDefaults.influenceId = event.target.value as InfluencePattern;
            changeDesign(next);
          }}>{supportedInfluences.map((value) => <option key={value} value={value}>{influenceLabels[value]}</option>)}</select></label>}
          <p className={`panel-note ${design.rule.propertyPolicies.influenceId === "per-cell" ? "is-enabled" : ""}`}>
            {design.rule.propertyPolicies.influenceId === "per-cell" ? "逐格属性已启用：影响配置由默认值与格子覆盖共同决定。" : "当前使用统一影响；切换为逐格影响后可编辑每个格子的方位配置。"}
          </p>
          <div className="mechanic-readout"><span>Selector</span><code>anchor-influence</code><span>Effect</span><code>cycle power +1</code></div>
        </section>

        <section className="inspector-section">
          <header><span>03</span><div><strong>基础拓扑</strong><small>Board topology</small></div></header>
          <label className="range-field"><span><b>棋盘尺寸</b><em>{design.board.width} × {design.board.height}</em></span><input type="range" min="2" max="10" value={design.board.width} onChange={(event) => changeDesign(resizePuzzleDesign(design, Number(event.target.value)))} /></label>
          <label className="select-field"><span>节点拓扑</span><select value={design.board.geometry} onChange={(event) => changeDesign(changeGeometry(design, event.target.value as BoardGeometry))}>
            {BOARD_GEOMETRIES.map((geometry) => <option key={geometry} value={geometry}>{geometryLabel(geometry)}</option>)}
          </select></label>
          <div className="seed-readout"><span>SEED</span><strong>{design.seed.toString().padStart(6, "0")}</strong><button type="button" onClick={() => changeDesign(withoutInitialValues(design))}>重新生成</button></div>
        </section>
      </div>

      <footer className="panel-footer rule-footer">
        <div className="rule-save-state"><i className={`save-dot ${isSaved ? "" : "is-warning"}`} /><span>{isSaved ? "已自动保存" : "仅本次会话"}</span><small>{isSaved ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "存储不可用"}</small></div>
        <div className="rule-actions"><button type="button" className="delete-rule" disabled={presets.length <= 1} onClick={onDelete}>删除</button><button type="button" className="add-rule" onClick={onDuplicate}>＋ 新增</button></div>
      </footer>
    </aside>
  );
}

import { useRef, type WheelEvent } from "react";
import type { BoardGeometry, InfluencePattern } from "@lightout/mechanics-standard";
import {
  BOARD_GEOMETRIES,
  parseNodeId,
  supportedInfluencesFor,
} from "@lightout/mechanics-standard";
import type { LevelDefaults, RulePreset } from "../workspace";
import {
  geometryLabel,
  geometrySymbols,
  influenceLabels,
} from "../rulePresentation";

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

function resizeLevel(level: LevelDefaults, size: number): LevelDefaults {
  const within = (key: string) => {
    const coordinate = parseNodeId(key);
    return !!coordinate && coordinate.x < size && coordinate.y < size;
  };
  const filter = <T,>(values?: Record<string, T>) => values
    ? Object.fromEntries(Object.entries(values).filter(([key]) => within(key)))
    : undefined;
  return {
    ...level,
    size,
    initialValues: filter(level.initialValues),
    goalValues: filter(level.goalValues),
    influenceOverrides: filter(level.influenceOverrides),
  };
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
  const supportedInfluences = supportedInfluencesFor(activePreset.level.geometry);
  const canUseComposite = supportedInfluences.length > 1;
  const influenceMode = activePreset.definition.compositeInfluence
    ? "composite"
    : activePreset.definition.defaultInfluence;

  function switchBy(direction: -1 | 1): void {
    onSwitch(direction < 0 ? previousIndex : nextIndex);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    if (Math.abs(event.deltaY) < 18 || Date.now() < wheelLockedUntil.current) return;
    wheelLockedUntil.current = Date.now() + 420;
    switchBy(event.deltaY > 0 ? 1 : -1);
  }

  return (
    <aside className="workspace-panel rule-panel">
      <div className="panel-kicker">
        <span>RULE DECK</span>
        <b>{String(activeIndex + 1).padStart(2, "0")} / {String(presets.length).padStart(2, "0")}</b>
      </div>

      <div className="rule-orbit" onWheel={handleWheel} aria-label="规则切换器">
        <button className="rule-peek previous" type="button" onClick={() => switchBy(-1)}>
          <span>↑</span><small>{presets[previousIndex]?.name}</small>
        </button>
        <div className="rule-identity">
          <span className="rule-index">R-{String(activeIndex + 1).padStart(2, "0")}</span>
          <div><strong>{activePreset.name}</strong><small>滚轮或箭头切换规则</small></div>
          <i />
        </div>
        <button className="rule-peek next" type="button" onClick={() => switchBy(1)}>
          <span>↓</span><small>{presets[nextIndex]?.name}</small>
        </button>
        <div className="rule-map" aria-label="全部规则">
          {presets.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              className={index === activeIndex ? "selected" : ""}
              aria-label={`切换到${preset.name}`}
              title={preset.name}
              onClick={() => onSwitch(index)}
            >
              <span>{geometrySymbols[preset.level.geometry]}</span><small>{String(index + 1).padStart(2, "0")}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-scroll rule-card-body">
        <section className="inspector-section rule-heading-editor">
          <label>
            <span>规则名称</span>
            <input value={activePreset.name} onChange={(event) => onChange({ ...activePreset, name: event.target.value }, false)} />
          </label>
          <label>
            <span>设计说明</span>
            <textarea rows={3} value={activePreset.description} onChange={(event) => onChange({ ...activePreset, description: event.target.value }, false)} />
          </label>
        </section>

        <section className="inspector-section">
          <header><span>01</span><div><strong>状态模型</strong><small>State model</small></div></header>
          <div className="field-row">
            <span>状态数量</span>
            <div className="compact-picker">
              {[2, 3, 4, 5].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={activePreset.definition.stateCount === count ? "selected" : ""}
                  onClick={() => {
                    const clamp = (value: number) => Math.min(value, count - 1);
                    onChange({
                      ...activePreset,
                      definition: { ...activePreset.definition, stateCount: count },
                      level: {
                        ...activePreset.level,
                        initialValues: activePreset.level.initialValues && Object.fromEntries(
                          Object.entries(activePreset.level.initialValues).map(([key, value]) => [key, clamp(value)]),
                        ),
                        goalValues: activePreset.level.goalValues && Object.fromEntries(
                          Object.entries(activePreset.level.goalValues).map(([key, value]) => [key, value === null ? null : clamp(value)]),
                        ),
                      },
                    }, true);
                  }}
                >{count}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="inspector-section">
          <header><span>02</span><div><strong>影响模式</strong><small>Influence mode</small></div></header>
          <label className="select-field">
            <span>整盘规则</span>
            <select
              value={influenceMode}
              onChange={(event) => {
                const value = event.target.value;
                onChange({
                  ...activePreset,
                  definition: value === "composite"
                    ? { ...activePreset.definition, compositeInfluence: true }
                    : {
                        ...activePreset.definition,
                        defaultInfluence: value as InfluencePattern,
                        compositeInfluence: false,
                      },
                }, true);
              }}
            >
              {supportedInfluences.map((value) => <option key={value} value={value}>{influenceLabels[value]}</option>)}
              {canUseComposite && <option value="composite">复合影响</option>}
            </select>
          </label>
          {activePreset.definition.compositeInfluence && (
            <label className="select-field composite-base-field">
              <span>未单独设置的格子</span>
              <select
                value={activePreset.definition.defaultInfluence}
                onChange={(event) => onChange({
                  ...activePreset,
                  definition: {
                    ...activePreset.definition,
                    defaultInfluence: event.target.value as InfluencePattern,
                  },
                }, true)}
              >
                {supportedInfluences.map((value) => <option key={value} value={value}>{influenceLabels[value]}</option>)}
              </select>
            </label>
          )}
          <p className={`panel-note ${activePreset.definition.compositeInfluence ? "is-enabled" : ""}`}>
            {activePreset.definition.compositeInfluence
              ? "复合影响已启用：可在编辑模式中为每个格子分别设置影响。"
              : canUseComposite
                ? "当前为统一影响；逐格影响编辑仅在“复合影响”下开放。"
                : "当前拓扑只有一种可用基础影响，因此不提供复合影响。"}
          </p>
          <div className="mechanic-readout">
            <span>Selector</span><code>anchor-influence</code>
            <span>Effect</span><code>cycle power +1</code>
          </div>
        </section>

        <section className="inspector-section">
          <header><span>03</span><div><strong>基础拓扑</strong><small>Board topology</small></div></header>
          <label className="range-field">
            <span><b>棋盘尺寸</b><em>{activePreset.level.size} × {activePreset.level.size}</em></span>
            <input
              type="range"
              min="2"
              max="10"
              value={activePreset.level.size}
              onChange={(event) => onChange({ ...activePreset, level: resizeLevel(activePreset.level, Number(event.target.value)) }, true)}
            />
          </label>
          <label className="select-field">
            <span>节点拓扑</span>
            <select
              value={activePreset.level.geometry}
              onChange={(event) => {
                const geometry = event.target.value as BoardGeometry;
                const available = supportedInfluencesFor(geometry);
                const defaultInfluence = available.includes(activePreset.definition.defaultInfluence)
                  ? activePreset.definition.defaultInfluence
                  : available[0] ?? "neighbors";
                const influenceOverrides = activePreset.level.influenceOverrides && Object.fromEntries(
                  Object.entries(activePreset.level.influenceOverrides).filter(([, influence]) => available.includes(influence)),
                );
                onChange({
                  ...activePreset,
                  definition: {
                    ...activePreset.definition,
                    defaultInfluence,
                    compositeInfluence: activePreset.definition.compositeInfluence && available.length > 1,
                  },
                  level: { ...activePreset.level, geometry, influenceOverrides },
                }, true);
              }}
            >
              {BOARD_GEOMETRIES.map((geometry) => (
                <option key={geometry} value={geometry}>{geometryLabel(geometry)}</option>
              ))}
            </select>
          </label>
          <div className="seed-readout">
            <span>SEED</span><strong>{activePreset.level.seed.toString().padStart(6, "0")}</strong>
            <button type="button" onClick={() => onChange({
              ...activePreset,
              level: { ...activePreset.level, seed: activePreset.level.seed + 1, initialValues: undefined },
            }, true)}>重新生成</button>
          </div>
        </section>
      </div>

      <footer className="panel-footer rule-footer">
        <div className="rule-save-state">
          <i className={`save-dot ${isSaved ? "" : "is-warning"}`} />
          <span>{isSaved ? "已自动保存" : "仅本次会话"}</span>
          <small>{isSaved ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "存储不可用"}</small>
        </div>
        <div className="rule-actions">
          <button type="button" className="delete-rule" disabled={presets.length <= 1} onClick={onDelete}>删除</button>
          <button type="button" className="add-rule" onClick={onDuplicate}>＋ 新增</button>
        </div>
      </footer>
    </aside>
  );
}

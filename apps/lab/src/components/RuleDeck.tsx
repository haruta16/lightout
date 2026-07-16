import { useRef, type CSSProperties, type WheelEvent } from "react";
import type {
  BoardShape,
  InfluencePattern,
} from "@lightout/mechanics-standard";
import type { RulePreset } from "../workspace";

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

interface RuleDeckProps {
  presets: RulePreset[];
  activeIndex: number;
  activePreset: RulePreset;
  savedAt: number;
  isSaved: boolean;
  onSwitch: (index: number) => void;
  onChange: (preset: RulePreset, rebuild: boolean) => void;
  onDuplicate: () => void;
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
}: RuleDeckProps) {
  const wheelLockedUntil = useRef(0);
  const previousIndex = (activeIndex - 1 + presets.length) % presets.length;
  const nextIndex = (activeIndex + 1) % presets.length;

  function switchBy(direction: -1 | 1): void {
    onSwitch(direction < 0 ? previousIndex : nextIndex);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    if (Math.abs(event.deltaY) < 18 || Date.now() < wheelLockedUntil.current) return;
    wheelLockedUntil.current = Date.now() + 420;
    switchBy(event.deltaY > 0 ? 1 : -1);
  }

  return (
    <aside className="workspace-panel rule-panel" style={{ "--rule-accent": activePreset.accent } as CSSProperties}>
      <div className="panel-kicker">
        <span>RULE DECK</span>
        <b>{String(activeIndex + 1).padStart(2, "0")} / {String(presets.length).padStart(2, "0")}</b>
      </div>

      <div className="rule-orbit" onWheel={handleWheel} aria-label="规则切换器">
        <button className="rule-peek previous" type="button" onClick={() => switchBy(-1)}>
          <span>↑</span>
          <small>{presets[previousIndex]?.name}</small>
        </button>

        <div className="rule-identity">
          <span className="rule-index">R-{String(activeIndex + 1).padStart(2, "0")}</span>
          <div>
            <strong>{activePreset.name}</strong>
            <small>滚轮或箭头切换规则</small>
          </div>
          <i />
        </div>

        <button className="rule-peek next" type="button" onClick={() => switchBy(1)}>
          <span>↓</span>
          <small>{presets[nextIndex]?.name}</small>
        </button>
      </div>

      <div className="panel-scroll rule-card-body">
        <section className="inspector-section rule-heading-editor">
          <label>
            <span>规则名称</span>
            <input
              value={activePreset.name}
              onChange={(event) =>
                onChange({ ...activePreset, name: event.target.value }, false)
              }
            />
          </label>
          <label>
            <span>设计说明</span>
            <textarea
              rows={3}
              value={activePreset.description}
              onChange={(event) =>
                onChange({ ...activePreset, description: event.target.value }, false)
              }
            />
          </label>
        </section>

        <section className="inspector-section">
          <header>
            <span>01</span>
            <div><strong>状态模型</strong><small>State model</small></div>
          </header>
          <div className="field-row">
            <span>状态数量</span>
            <div className="compact-picker">
              {[2, 3, 4, 5].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={activePreset.definition.stateCount === count ? "selected" : ""}
                  onClick={() =>
                    onChange(
                      {
                        ...activePreset,
                        definition: {
                          ...activePreset.definition,
                          stateCount: count,
                          goalValue: Math.min(activePreset.definition.goalValue, count - 1),
                        },
                      },
                      true,
                    )
                  }
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <label className="select-field">
            <span>目标状态</span>
            <select
              value={activePreset.definition.goalValue}
              onChange={(event) =>
                onChange(
                  {
                    ...activePreset,
                    definition: {
                      ...activePreset.definition,
                      goalValue: Number(event.target.value),
                    },
                  },
                  true,
                )
              }
            >
              {Array.from({ length: activePreset.definition.stateCount }, (_, value) => (
                <option key={value} value={value}>状态 {value}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="inspector-section">
          <header>
            <span>02</span>
            <div><strong>影响机制</strong><small>Selector + effect</small></div>
          </header>
          <label className="select-field">
            <span>选择关系</span>
            <select
              value={activePreset.definition.influence}
              onChange={(event) =>
                onChange(
                  {
                    ...activePreset,
                    definition: {
                      ...activePreset.definition,
                      influence: event.target.value as InfluencePattern,
                    },
                  },
                  true,
                )
              }
            >
              {Object.entries(influenceLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="mechanic-readout">
            <span>Selector</span><code>graph-neighborhood</code>
            <span>Effect</span><code>cycle-channel +1</code>
          </div>
        </section>

        <section className="inspector-section">
          <header>
            <span>03</span>
            <div><strong>关卡默认</strong><small>Level defaults</small></div>
          </header>
          <label className="range-field">
            <span><b>棋盘尺寸</b><em>{activePreset.level.size} × {activePreset.level.size}</em></span>
            <input
              type="range"
              min="2"
              max="10"
              value={activePreset.level.size}
              onChange={(event) =>
                onChange(
                  {
                    ...activePreset,
                    level: { ...activePreset.level, size: Number(event.target.value) },
                  },
                  true,
                )
              }
            />
          </label>
          <label className="select-field">
            <span>棋盘形状</span>
            <select
              value={activePreset.level.boardShape}
              onChange={(event) =>
                onChange(
                  {
                    ...activePreset,
                    level: {
                      ...activePreset.level,
                      boardShape: event.target.value as BoardShape,
                    },
                  },
                  true,
                )
              }
            >
              {Object.entries(shapeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="seed-readout">
            <span>SEED</span>
            <strong>{activePreset.level.seed.toString().padStart(6, "0")}</strong>
            <button
              type="button"
              onClick={() =>
                onChange(
                  {
                    ...activePreset,
                    level: { ...activePreset.level, seed: activePreset.level.seed + 1 },
                  },
                  true,
                )
              }
            >
              换一局
            </button>
          </div>
        </section>
      </div>

      <footer className="panel-footer rule-footer">
        <div>
          <i className={`save-dot ${isSaved ? "" : "is-warning"}`} />
          <span>{isSaved ? "已自动保存" : "仅本次会话"}</span>
          <small>{isSaved ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "存储不可用"}</small>
        </div>
        <button type="button" onClick={onDuplicate}>复制规则</button>
      </footer>
    </aside>
  );
}

import { describe, expect, it } from "vitest";
import { createExperiment } from "@lightout/mechanics-standard";
import {
  DEFAULT_RULE_PRESETS,
  duplicatePreset,
  loadPreference,
  loadWorkspace,
  savePreference,
  saveWorkspace,
  toExperimentConfig,
  withLevelDesign,
  type InitialWorkspace,
} from "./workspace";

function createMemoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value,
  };
}

describe("rule workspace", () => {
  it("ships all three base topologies without a board-shape field", () => {
    expect(new Set(DEFAULT_RULE_PRESETS.map((preset) => preset.definition.stateCount))).toEqual(new Set([2, 3, 4, 5]));
    expect(new Set(DEFAULT_RULE_PRESETS.map((preset) => preset.level.geometry))).toEqual(new Set(["square", "hex", "triangle"]));
    for (const preset of DEFAULT_RULE_PRESETS) {
      const config = toExperimentConfig(preset);
      expect(config.size).toBeGreaterThanOrEqual(2);
      expect(config.defaultInfluence).toBe(preset.definition.defaultInfluence);
      expect(config.compositeInfluence).toBe(preset.definition.compositeInfluence);
      expect("boardShape" in config).toBe(false);
      expect(config.geometry).toBe(preset.level.geometry);
    }
  });

  it("rejects obsolete workspace schemas instead of migrating them", () => {
    const stored = JSON.stringify({
      version: 4,
      activeRuleId: "legacy",
      presets: [{
        id: "legacy",
        name: "Legacy",
        description: "old",
        accent: "#fff",
        definition: { stateCount: 3, goalValue: 2, influence: "neighbors" },
        level: { size: 3, boardShape: "ring", geometry: "hex", seed: 7 },
      }],
    });
    expect(loadWorkspace(createMemoryStorage(stored)).presets).toEqual(DEFAULT_RULE_PRESETS);
  });

  it("round-trips a workspace without coupling it to browser globals", () => {
    const storage = createMemoryStorage();
    const workspace: InitialWorkspace = {
      activeRuleId: DEFAULT_RULE_PRESETS[2]!.id,
      presets: structuredClone(DEFAULT_RULE_PRESETS),
    };
    saveWorkspace(workspace, storage);
    expect(loadWorkspace(storage)).toEqual(workspace);
  });

  it("keeps intentionally deleted built-in presets deleted", () => {
    const remaining = structuredClone(DEFAULT_RULE_PRESETS.slice(0, 2));
    const stored = JSON.stringify({
      version: 5,
      activeRuleId: remaining[0]!.id,
      presets: remaining,
    });

    expect(loadWorkspace(createMemoryStorage(stored)).presets).toEqual(remaining);
  });

  it("keeps an explicit uniform mode even when dormant per-cell overrides exist", () => {
    const stored = JSON.stringify({
      version: 5,
      activeRuleId: "mixed",
      presets: [{
        id: "mixed",
        name: "Mixed",
        description: "uniform board with dormant overrides",
        definition: { stateCount: 2, defaultInfluence: "cross", compositeInfluence: false },
        level: {
          size: 3,
          geometry: "square",
          seed: 1,
          influenceOverrides: { "n:1:1": "diagonal" },
        },
      }],
    });

    const preset = loadWorkspace(createMemoryStorage(stored)).presets[0]!;
    expect(preset.definition.compositeInfluence).toBe(false);
    expect(preset.level.influenceOverrides?.["n:1:1"]).toBe("diagonal");
    expect(toExperimentConfig(preset).influenceOverrides).toBeUndefined();
  });

  it("degrades storage failures to session-only state", () => {
    const unavailable = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
    };
    expect(loadPreference("theme", ["dark", "light"], "dark", unavailable)).toBe("dark");
    expect(savePreference("theme", "light", unavailable)).toBe(false);
    expect(saveWorkspace({ activeRuleId: DEFAULT_RULE_PRESETS[0]!.id, presets: DEFAULT_RULE_PRESETS }, unavailable)).toBe(false);
  });

  it("repairs a missing active rule and salvages valid presets beside invalid ones", () => {
    const validPreset = structuredClone(DEFAULT_RULE_PRESETS[1]!);
    const invalidPreset = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    invalidPreset.level.goalValues = { "n:99:99": 1 };
    const stored = { version: 5, activeRuleId: "missing", presets: [invalidPreset, validPreset] };
    const loaded = loadWorkspace(createMemoryStorage(JSON.stringify(stored)));
    expect(loaded.activeRuleId).toBe(validPreset.id);
    expect(loaded.presets).toEqual([validPreset]);
  });

  it("captures all three editor layers and duplicates them by value", () => {
    const source = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    source.definition.compositeInfluence = true;
    const { initialState } = createExperiment(toExperimentConfig(source));
    const first = Object.values(initialState.entities)[0]!;
    first.channels.power = 1;
    first.channels.goal = -1;
    first.channels.influence = "diagonal";
    const designed = withLevelDesign(source, initialState);
    expect(designed.level.initialValues?.[first.nodeId!]).toBe(1);
    expect(designed.level.goalValues?.[first.nodeId!]).toBeNull();
    expect(designed.level.influenceOverrides?.[first.nodeId!]).toBe("diagonal");

    const copy = duplicatePreset(designed);
    copy.level.initialValues![first.nodeId!] = 0;
    expect(copy.id).not.toBe(designed.id);
    expect(copy.name).toContain("副本");
    expect(designed.level.initialValues?.[first.nodeId!]).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULE_PRESETS,
  duplicatePreset,
  loadPreference,
  loadWorkspace,
  savePreference,
  saveWorkspace,
  toExperimentConfig,
  type InitialWorkspace,
} from "./workspace";

function createMemoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    value: () => value,
  };
}

describe("rule workspace", () => {
  it("ships one valid preset for each supported state count", () => {
    expect(DEFAULT_RULE_PRESETS.map((preset) => preset.definition.stateCount)).toEqual([
      2,
      3,
      4,
      5,
    ]);
    for (const preset of DEFAULT_RULE_PRESETS) {
      const config = toExperimentConfig(preset);
      expect(config.goalValue).toBeGreaterThanOrEqual(0);
      expect(config.goalValue).toBeLessThan(config.stateCount);
    }
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

  it("degrades storage failures to session-only state", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };

    expect(loadPreference("theme", ["dark", "light"], "dark", unavailable)).toBe("dark");
    expect(savePreference("theme", "light", unavailable)).toBe(false);
    expect(
      saveWorkspace(
        { activeRuleId: DEFAULT_RULE_PRESETS[0]!.id, presets: DEFAULT_RULE_PRESETS },
        unavailable,
      ),
    ).toBe(false);
  });

  it("repairs a missing active rule and rejects invalid stored definitions", () => {
    const valid = {
      version: 1,
      activeRuleId: "missing",
      presets: structuredClone(DEFAULT_RULE_PRESETS),
    };
    expect(loadWorkspace(createMemoryStorage(JSON.stringify(valid))).activeRuleId).toBe(
      DEFAULT_RULE_PRESETS[0]!.id,
    );

    valid.presets[0]!.definition.stateCount = 4;
    valid.presets[0]!.definition.goalValue = 4;
    expect(loadWorkspace(createMemoryStorage(JSON.stringify(valid))).presets).toEqual(
      DEFAULT_RULE_PRESETS,
    );
  });

  it("clamps defensive goal values and duplicates presets by value", () => {
    const source = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    source.definition.goalValue = -3;
    expect(toExperimentConfig(source).goalValue).toBe(0);

    const copy = duplicatePreset(source);
    copy.definition.stateCount = 5;
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toContain("副本");
    expect(source.definition.stateCount).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  CELL_ROLES,
  cellPropertiesFor,
  cellRoleFor,
  compilePuzzleDesign,
  propertiesForRole,
} from "@lightout/mechanics-standard";
import { createGenerationRequest } from "@lightout/generator";
import {
  DEFAULT_RULE_PRESETS,
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
  it("ships all three topologies as schema-6 puzzle designs", () => {
    expect(new Set(DEFAULT_RULE_PRESETS.map((preset) => preset.game.design.rule.stateCount))).toEqual(new Set([2, 3, 4, 5]));
    expect(new Set(DEFAULT_RULE_PRESETS.map((preset) => preset.game.design.board.geometry))).toEqual(new Set(["square", "hex", "triangle"]));
    for (const preset of DEFAULT_RULE_PRESETS) {
      expect(preset.game.design.schemaVersion).toBe(6);
      expect(() => compilePuzzleDesign(preset.game.design)).not.toThrow();
      expect("boardShape" in preset.game.design.board).toBe(false);
    }
  });

  it("rejects obsolete workspace schemas instead of migrating them", () => {
    const stored = JSON.stringify({ version: 6, activeRuleId: "legacy", presets: [] });
    expect(loadWorkspace(createMemoryStorage(stored)).presets).toEqual(DEFAULT_RULE_PRESETS);
  });

  it("round-trips a workspace without coupling it to browser globals", () => {
    const storage = createMemoryStorage();
    const workspace: InitialWorkspace = { activeRuleId: DEFAULT_RULE_PRESETS[2]!.id, presets: structuredClone(DEFAULT_RULE_PRESETS) };
    saveWorkspace(workspace, storage);
    expect(loadWorkspace(storage)).toEqual(workspace);
  });

  it("persists generation provenance on the game instead of the rule", () => {
    const preset = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    const request = createGenerationRequest(preset.game.design);
    preset.game.generation = {
      request,
      report: {
        seed: request.seed,
        attempts: 3,
        elapsedMs: 8,
        generatorVersions: { goal: 1 },
        metrics: {
          solverStatus: "solved",
          solutionLength: 7,
          rank: 12,
          freeVariables: 1,
          minimal: true,
          nodeCount: 25,
          targetCount: 18,
          roleCounts: { standard: 20, switch: 3, lamp: 2 },
          influenceCounts: { cross: 25 },
        },
        warnings: [],
        conflicts: [],
      },
    };
    const storage = createMemoryStorage();
    saveWorkspace({ activeRuleId: preset.id, presets: [preset] }, storage);

    const loaded = loadWorkspace(storage).presets[0]!;
    expect(loaded.game.generation).toEqual(preset.game.generation);
    expect("generation" in loaded).toBe(false);
  });

  it("replaces a game instance without changing or duplicating its rule", () => {
    const preset = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    const generated = structuredClone(DEFAULT_RULE_PRESETS[1]!.game.design);
    const updated = replaceGameInstance(preset, { design: generated });

    expect(updated.id).toBe(preset.id);
    expect(updated.name).toBe(preset.name);
    expect(updated.description).toBe(preset.description);
    expect(updated.game.design).toEqual(generated);
    expect([updated]).toHaveLength(1);
  });

  it("keeps intentionally deleted built-in presets deleted", () => {
    const remaining = structuredClone(DEFAULT_RULE_PRESETS.slice(0, 2));
    const stored = JSON.stringify({ version: 7, activeRuleId: remaining[0]!.id, presets: remaining });
    expect(loadWorkspace(createMemoryStorage(stored)).presets).toEqual(remaining);
  });

  it("keeps dormant per-cell influence values while uniform policy is active", () => {
    const preset = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    preset.game.design.cells["n:1:1"]!.properties = { influenceId: "diagonal" };
    preset.game.design.rule.propertyPolicies.influenceId = "uniform";
    const storage = createMemoryStorage();
    saveWorkspace({ activeRuleId: preset.id, presets: [preset] }, storage);
    const loaded = loadWorkspace(storage).presets[0]!;

    expect(loaded.game.design.cells["n:1:1"]?.properties?.influenceId).toBe("diagonal");
    expect(cellPropertiesFor(loaded.game.design, "n:1:1").influenceId).toBe("cross");
  });

  it("degrades storage failures to session-only state", () => {
    const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadPreference("theme", ["dark", "light"], "dark", unavailable)).toBe("dark");
    expect(savePreference("theme", "light", unavailable)).toBe(false);
    expect(saveWorkspace({ activeRuleId: DEFAULT_RULE_PRESETS[0]!.id, presets: DEFAULT_RULE_PRESETS }, unavailable)).toBe(false);
  });

  it("repairs a missing active rule and salvages valid presets beside invalid ones", () => {
    const validPreset = structuredClone(DEFAULT_RULE_PRESETS[1]!);
    const invalidPreset = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    invalidPreset.game.design.cells["n:99:99"] = {};
    const stored = { version: 7, activeRuleId: "missing", presets: [invalidPreset, validPreset] };
    const loaded = loadWorkspace(createMemoryStorage(JSON.stringify(stored)));
    expect(loaded.activeRuleId).toBe(validPreset.id);
    expect(loaded.presets).toEqual([validPreset]);
  });

  it("models cell roles as independent power and activation capabilities", () => {
    expect(CELL_ROLES).toEqual(["standard", "switch", "lamp"]);
    expect(cellRoleFor(propertiesForRole("standard"))).toBe("standard");
    expect(cellRoleFor(propertiesForRole("switch"))).toBe("switch");
    expect(cellRoleFor(propertiesForRole("lamp"))).toBe("lamp");
    expect(() => cellRoleFor({ hasPower: false, activatable: false })).toThrow(
      "A cell must have power or activation capability",
    );
  });

  it("undoes design snapshots and duplicates them by value", () => {
    const source = structuredClone(DEFAULT_RULE_PRESETS[0]!);
    const history = createDesignHistory(source.game.design);
    const changed = structuredClone(source.game.design);
    changed.cells["n:0:0"]!.properties = { exists: false };
    const committed = commitDesignHistory(history, changed);
    expect(undoDesignHistory(committed).present.cells["n:0:0"]?.properties?.exists).toBeUndefined();
    expect(redoDesignHistory(undoDesignHistory(committed)).present.cells["n:0:0"]?.properties?.exists).toBe(false);

    const copy = duplicatePreset({ ...source, game: { design: changed } });
    copy.game.design.cells["n:0:0"]!.properties!.exists = true;
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toContain("副本");
    expect(changed.cells["n:0:0"]?.properties?.exists).toBe(false);
  });
});

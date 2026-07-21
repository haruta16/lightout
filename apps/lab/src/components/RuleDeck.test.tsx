import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PRESETS } from "../workspace";
import { RuleDeck } from "./RuleDeck";

function renderPreset(index: number): string {
  const preset = DEFAULT_RULE_PRESETS[index]!;
  return renderToStaticMarkup(
    <RuleDeck
      presets={DEFAULT_RULE_PRESETS}
      activeIndex={index}
      activePreset={preset}
      savedAt={0}
      isSaved
      onSwitch={() => undefined}
      onChange={() => undefined}
      onDuplicate={() => undefined}
      onDelete={() => undefined}
    />,
  );
}

describe("RuleDeck influence capabilities", () => {
  it("offers composite influence when a topology has multiple base influences", () => {
    expect(renderPreset(0)).toContain('<option value="composite">复合影响</option>');
  });

  it("does not offer a meaningless composite mode for hex topology", () => {
    const hexIndex = DEFAULT_RULE_PRESETS.findIndex((preset) => preset.level.geometry === "hex");
    expect(renderPreset(hexIndex)).not.toContain('<option value="composite">复合影响</option>');
  });
});

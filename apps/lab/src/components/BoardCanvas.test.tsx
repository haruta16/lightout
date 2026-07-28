import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  compilePuzzleDesign,
  createPuzzleDesign,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import { BoardCanvas } from "./BoardCanvas";

function fixture(): { design: PuzzleDesign; state: ReturnType<typeof compilePuzzleDesign>["initialState"] } {
  const design = createPuzzleDesign({
    size: 2,
    stateCount: 3,
    defaultInfluence: "cross",
    influenceMode: "per-cell",
    seed: 1,
  });
  for (const cell of Object.values(design.cells)) cell.initial = { power: 0 };
  design.cells["n:0:0"]!.properties = { hasPower: false, activatable: true };
  design.cells["n:0:0"]!.goal = undefined;
  design.cells["n:1:0"]!.properties = { hasPower: true, activatable: false };
  design.cells["n:1:0"]!.goal = { power: { operator: "equals", value: 1 } };
  design.cells["n:0:1"]!.properties = { exists: false };
  return { design, state: compilePuzzleDesign(design).initialState };
}

function render(
  mode: "play" | "edit",
  editorSurface: "role" | "initial",
  generationLocked = new Set<string>(),
): string {
  const { design, state } = fixture();
  return renderToStaticMarkup(
    <BoardCanvas
      state={state}
      design={design}
      mode={mode}
      editorSurface={editorSurface}
      hovered={null}
      selected={null}
      affected={new Set()}
      changed={new Set()}
      solution={new Map()}
      showSolution={false}
      generationLocked={generationLocked}
      onHover={() => undefined}
      onActivate={() => undefined}
    />,
  );
}

describe("BoardCanvas cell visual anatomy", () => {
  it("keeps role, goal, and influence in stable marker slots", () => {
    const html = render("edit", "role");
    expect(html).toContain("role-switch");
    expect(html).toContain("is-unsatisfied");
    expect(html).toContain("is-absent");
    expect(html).toContain("role-marker");
    expect(html).toContain("goal-marker");
    expect(html).toContain("influence-marker");
    expect(html).not.toContain("is-goal");
    expect(html).not.toContain("is-active");
  });

  it("omits absent cells in play and makes passive lamps truly non-interactive", () => {
    const html = render("play", "initial");
    expect(html).not.toContain("节点 n:0:1");
    expect(html).toMatch(/role-lamp[^\"]*is-disabled[^\"]*\"[^>]*role=\"button\" tabindex=\"-1\"/);
    expect(html).toContain('aria-disabled="true"');
  });

  it("renders generation locks independently from the four semantic markers", () => {
    const html = render("edit", "role", new Set(["n:0:0"]));
    expect(html).toContain("is-generation-locked");
    expect(html).toContain("generation-lock-mark");
    expect(html).toContain("role-marker");
  });
});

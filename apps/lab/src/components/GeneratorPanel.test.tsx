import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createGenerationRequest } from "@lightout/generator";
import { createPuzzleDesign } from "@lightout/mechanics-standard";
import { GeneratorPanel } from "./GeneratorPanel";

describe("GeneratorPanel", () => {
  it("exposes all five generation layers and deterministic run controls", () => {
    const request = createGenerationRequest(createPuzzleDesign({
      size: 4,
      stateCount: 3,
      defaultInfluence: "cross",
      seed: 42,
    }));
    const html = renderToStaticMarkup(
      <GeneratorPanel
        request={request}
        result={null}
        progress={null}
        busy={false}
        lockLayer={null}
        onRequestChange={() => undefined}
        onLayerModeChange={() => undefined}
        onLockLayerChange={() => undefined}
        onFrameLockChange={() => undefined}
        onGenerate={() => undefined}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("棋盘结构");
    expect(html).toContain("格子角色");
    expect(html).toContain("影响属性");
    expect(html).toContain("目标棋局");
    expect(html).toContain("初始棋局");
    expect(html).toContain("SEED");
    expect(html).toContain("生成候选");
    expect(html.match(/>混合</g)).toHaveLength(5);
  });

  it("applies a generated candidate as the current game without rule actions", () => {
    const request = createGenerationRequest(createPuzzleDesign({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 7,
    }));
    const html = renderToStaticMarkup(
      <GeneratorPanel
        request={request}
        result={{
          status: "generated",
          design: request.baseDesign,
          report: {
            seed: 7,
            attempts: 1,
            elapsedMs: 1,
            generatorVersions: {},
            metrics: {
              solverStatus: "solved",
              solutionLength: 2,
              rank: 9,
              freeVariables: 0,
              minimal: true,
              nodeCount: 9,
              targetCount: 9,
              roleCounts: { standard: 9, switch: 0, lamp: 0 },
              influenceCounts: { cross: 9 },
            },
            warnings: [],
            conflicts: [],
          },
        }}
        progress={null}
        busy={false}
        lockLayer={null}
        onRequestChange={() => undefined}
        onLayerModeChange={() => undefined}
        onLockLayerChange={() => undefined}
        onFrameLockChange={() => undefined}
        onGenerate={() => undefined}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("应用为当前牌局");
    expect(html).not.toContain("保存为新规则");
    expect(html).not.toContain("替换当前");
  });
});

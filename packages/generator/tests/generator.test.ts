import { describe, expect, it } from "vitest";
import {
  cellPropertiesFor,
  cellRoleFor,
  compilePuzzleDesign,
  createPuzzleDesign,
  createStandardRegistry,
} from "@lightout/mechanics-standard";
import { createDefaultSolverRegistry } from "@lightout/solver";
import {
  createDefaultGenerationRegistry,
  createGenerationRequest,
  generatePuzzle,
} from "../src";

const services = {
  mechanics: createStandardRegistry(),
  solvers: createDefaultSolverRegistry(),
};

describe("puzzle generator", () => {
  it("generates the same validated design from the same request and seed", async () => {
    const request = createGenerationRequest(createPuzzleDesign({
      size: 4,
      stateCount: 3,
      defaultInfluence: "cross",
      seed: 42,
    }));
    const registry = createDefaultGenerationRegistry();
    const first = await generatePuzzle(request, registry, services);
    const second = await generatePuzzle(request, registry, services);

    expect(first.status).toBe("generated");
    expect(second.status).toBe("generated");
    expect(first.design).toEqual(second.design);
    expect(first.report.metrics).toEqual(second.report.metrics);
    expect(() => compilePuzzleDesign(first.design!)).not.toThrow();
  });

  it("preserves partial fixed values while generating the remaining cells", async () => {
    const base = createPuzzleDesign({
      size: 4,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 9,
    });
    const request = createGenerationRequest(base);
    request.layers.structure.mode = "mixed";
    request.layers.structure.fixed.exists["n:0:0"] = true;
    request.layers.role.mode = "mixed";
    request.layers.role.fixed.cells["n:0:0"] = "standard";
    request.layers.influence.mode = "mixed";
    request.layers.influence.fixed.cells["n:0:0"] = "diagonal";
    request.layers.goal.mode = "mixed";
    request.layers.goal.fixed.cells["n:0:0"] = 1;
    request.layers.initial.mode = "mixed";
    request.layers.initial.fixed.cells["n:0:0"] = 0;

    const result = await generatePuzzle(
      request,
      createDefaultGenerationRegistry(),
      services,
    );

    expect(result.status).toBe("generated");
    const design = result.design!;
    expect(cellPropertiesFor(design, "n:0:0").exists).toBe(true);
    expect(cellRoleFor(cellPropertiesFor(design, "n:0:0"))).toBe("standard");
    expect(cellPropertiesFor(design, "n:0:0").influenceId).toBe("diagonal");
    expect(design.cells["n:0:0"]?.goal?.power?.value).toBe(1);
    expect(design.cells["n:0:0"]?.initial?.power).toBe(0);
  });

  it("rejects an unregistered layer generator before attempting candidates", async () => {
    const request = createGenerationRequest(createPuzzleDesign({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 1,
    }));
    request.layers.goal.generator = { type: "missing", version: 1, params: {} };

    const result = await generatePuzzle(
      request,
      createDefaultGenerationRegistry(),
      services,
    );

    expect(result.status).toBe("invalid-request");
    expect(result.report.attempts).toBe(0);
    expect(result.report.conflicts[0]?.code).toBe("generator-unknown");
  });

  it("rejects unsafe frame dimensions before allocating candidate cells", async () => {
    const request = createGenerationRequest(createPuzzleDesign({
      size: 3,
      stateCount: 2,
      defaultInfluence: "cross",
      seed: 1,
    }));
    request.layers.structure.fixed.frame = {
      ...request.layers.structure.fixed.frame,
      width: 100_000,
    };

    const result = await generatePuzzle(
      request,
      createDefaultGenerationRegistry(),
      services,
    );

    expect(result.status).toBe("invalid-request");
    expect(result.report.attempts).toBe(0);
    expect(result.report.conflicts.some((item) => item.code === "frame")).toBe(true);
  });
});

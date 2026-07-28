import { describe, expect, it } from "vitest";
import { dispatch } from "@lightout/engine";
import {
  compilePuzzleDesign,
  createPuzzleDesign,
  createStandardRegistry,
  type PuzzleDesign,
} from "@lightout/mechanics-standard";
import { createDefaultSolverRegistry, solvePuzzle } from "../src";
import { solveModuloFour, solvePrimeLinear } from "../src/algebra";

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function satisfies(matrix: readonly (readonly number[])[], values: readonly number[], target: readonly number[], modulus: number): boolean {
  return matrix.every((row, index) => modulo(row.reduce((sum, coefficient, column) => sum + coefficient * (values[column] ?? 0), 0), modulus) === modulo(target[index] ?? 0, modulus));
}

function bruteForce(matrix: readonly (readonly number[])[], target: readonly number[], modulus: number): number[] | undefined {
  const columns = matrix[0]?.length ?? 0;
  const combinations = modulus ** columns;
  let best: number[] | undefined;
  let bestWeight = Number.POSITIVE_INFINITY;
  for (let encoded = 0; encoded < combinations; encoded += 1) {
    const values = Array<number>(columns).fill(0);
    let remainder = encoded;
    for (let index = 0; index < columns; index += 1) {
      values[index] = remainder % modulus;
      remainder = Math.floor(remainder / modulus);
    }
    if (!satisfies(matrix, values, target, modulus)) continue;
    const weight = values.reduce((sum, value) => sum + value, 0);
    if (weight < bestWeight) {
      best = values;
      bestWeight = weight;
    }
  }
  return best;
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

function expectMatchesBruteForce(matrix: number[][], target: number[], modulus: number): void {
  const expected = bruteForce(matrix, target, modulus);
  const actual = modulus === 4 ? solveModuloFour(matrix, target) : solvePrimeLinear(matrix, target, modulus);
  expect(actual.status).toBe(expected ? "solved" : "unsolvable");
  if (expected) {
    expect(satisfies(matrix, actual.values, target, modulus)).toBe(true);
    expect(actual.values.reduce((sum, value) => sum + value, 0)).toBe(expected.reduce((sum, value) => sum + value, 0));
  }
}

describe("modular linear algebra", () => {
  it.each([3, 5, 7])("matches brute force over GF(%i)", (prime) => {
    const rng = random(prime);
    for (let sample = 0; sample < 80; sample += 1) {
      const matrix = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => Math.floor(rng() * prime)));
      const target = Array.from({ length: 3 }, () => Math.floor(rng() * prime));
      expectMatchesBruteForce(matrix, target, prime);
    }
  });

  it.each([[2, 3], [3, 2], [3, 3]] as const)("matches brute force for %i × %i matrices over Z/4Z", (rows, columns) => {
    const rng = random(rows * 10 + columns);
    for (let sample = 0; sample < 160; sample += 1) {
      const matrix = Array.from({ length: rows }, () => Array.from({ length: columns }, () => Math.floor(rng() * 4)));
      const target = Array.from({ length: rows }, () => Math.floor(rng() * 4));
      expectMatchesBruteForce(matrix, target, 4);
    }
  });
});

function solveAndPlay(design: PuzzleDesign): ReturnType<typeof solvePuzzle> {
  const mechanics = createStandardRegistry();
  const { initialState, ruleset } = compilePuzzleDesign(design);
  const result = solvePuzzle(initialState, ruleset, mechanics, createDefaultSolverRegistry());
  expect(result.status).toBe("solved");
  let state = initialState;
  for (const anchorEntityId of result.presses) {
    state = dispatch({ ...state, status: "playing" }, { type: "activate", anchorEntityId }, ruleset, mechanics).state;
  }
  expect(state.status).toBe("won");
  return result;
}

describe("automatic solver selection", () => {
  it.each(["square", "hex", "triangle"] as const)("derives the influence matrix from the %s topology through Engine API", (geometry) => {
    solveAndPlay(createPuzzleDesign({ size: 4, geometry, stateCount: 3, defaultInfluence: "neighbors", seed: 63 }));
  });

  it.each([3, 4])("solves per-cell influences against a partial %i-state target", (stateCount) => {
    const design = createPuzzleDesign({ size: 3, stateCount, defaultInfluence: "cross", influenceMode: "per-cell", seed: 81 });
    design.cells["n:1:1"]!.properties = { influenceId: "king" };
    design.cells["n:0:0"]!.properties = { influenceId: "diagonal" };
    for (const cell of Object.values(design.cells)) cell.goal = undefined;
    design.cells["n:0:0"]!.goal = { power: { operator: "equals", value: 2 } };
    design.cells["n:1:1"]!.goal = { power: { operator: "equals", value: 1 } };
    design.cells["n:2:2"]!.goal = { power: { operator: "equals", value: 0 } };
    solveAndPlay(design);
  });

  it("solves a rectangular Z/4Z model with more target lamps than switches", () => {
    const design = createPuzzleDesign({ size: 3, stateCount: 4, defaultInfluence: "king", seed: 27 });
    for (const [nodeId, cell] of Object.entries(design.cells)) {
      cell.properties = { ...cell.properties, activatable: nodeId === "n:0:0" || nodeId === "n:2:2" };
    }
    const result = solveAndPlay(design);
    expect(result.solverId).toBe("modulo-four-linear");
    expect(result.freeVariables).toBeGreaterThanOrEqual(0);
  });

  it.each([[2, "prime-field-linear"], [3, "prime-field-linear"], [4, "modulo-four-linear"], [5, "prime-field-linear"]] as const)("selects %s-state puzzles with %s", (stateCount, solverId) => {
    const result = solveAndPlay(createPuzzleDesign({ size: 4, stateCount, defaultInfluence: "king", seed: 27 }));
    expect(result.solverId).toBe(solverId);
  });

  it("builds the additive model only once while selecting the modulo-four solver", () => {
    const mechanics = createStandardRegistry();
    const selector = mechanics.selectors.get("anchor-influence")!;
    let targetQueries = 0;
    mechanics.selectors.set("anchor-influence", (context) => {
      targetQueries += 1;
      return selector(context);
    });
    const design = createPuzzleDesign({ size: 3, stateCount: 4, defaultInfluence: "cross", seed: 13 });
    design.cells["n:1:1"]!.properties = { activatable: false };
    const { initialState, ruleset } = compilePuzzleDesign(design);
    expect(solvePuzzle(initialState, ruleset, mechanics).status).toBe("solved");
    expect(targetQueries).toBe(Object.values(initialState.entities).filter((entity) => entity.properties.activatable === true).length);
  });
});

import { describe, expect, it } from "vitest";
import { dispatch } from "@lightout/engine";
import {
  createExperiment,
  createStandardRegistry,
} from "@lightout/mechanics-standard";
import {
  createDefaultSolverRegistry,
  solvePuzzle,
} from "../src";
import { solveModuloFour, solvePrimeLinear } from "../src/algebra";

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function satisfies(
  matrix: readonly (readonly number[])[],
  values: readonly number[],
  target: readonly number[],
  modulus: number,
): boolean {
  return matrix.every(
    (row, index) =>
      modulo(
        row.reduce(
          (sum, coefficient, column) =>
            sum + coefficient * (values[column] ?? 0),
          0,
        ),
        modulus,
      ) === modulo(target[index] ?? 0, modulus),
  );
}

function bruteForce(
  matrix: readonly (readonly number[])[],
  target: readonly number[],
  modulus: number,
): number[] | undefined {
  const size = matrix[0]?.length ?? 0;
  const combinations = modulus ** size;
  let best: number[] | undefined;
  let bestWeight = Number.POSITIVE_INFINITY;
  for (let encoded = 0; encoded < combinations; encoded += 1) {
    const values = Array<number>(size).fill(0);
    let remainder = encoded;
    for (let index = 0; index < size; index += 1) {
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

describe("modular linear algebra", () => {
  it.each([3, 5, 7])("matches brute force over GF(%i)", (prime) => {
    const rng = random(prime);
    for (let sample = 0; sample < 80; sample += 1) {
      const matrix = Array.from({ length: 3 }, () =>
        Array.from({ length: 3 }, () => Math.floor(rng() * prime)),
      );
      const target = Array.from({ length: 3 }, () => Math.floor(rng() * prime));
      const expected = bruteForce(matrix, target, prime);
      const actual = solvePrimeLinear(matrix, target, prime);
      expect(actual.status).toBe(expected ? "solved" : "unsolvable");
      if (expected) {
        expect(satisfies(matrix, actual.values, target, prime)).toBe(true);
        expect(actual.values.reduce((sum, value) => sum + value, 0)).toBe(
          expected.reduce((sum, value) => sum + value, 0),
        );
      }
    }
  });

  it("matches brute force over the Z/4Z ring", () => {
    const rng = random(4);
    for (let sample = 0; sample < 200; sample += 1) {
      const matrix = Array.from({ length: 3 }, () =>
        Array.from({ length: 3 }, () => Math.floor(rng() * 4)),
      );
      const target = Array.from({ length: 3 }, () => Math.floor(rng() * 4));
      const expected = bruteForce(matrix, target, 4);
      const actual = solveModuloFour(matrix, target);
      expect(actual.status).toBe(expected ? "solved" : "unsolvable");
      if (expected) {
        expect(satisfies(matrix, actual.values, target, 4)).toBe(true);
        expect(actual.values.reduce((sum, value) => sum + value, 0)).toBe(
          expected.reduce((sum, value) => sum + value, 0),
        );
      }
    }
  });

  it("matches brute force for every two-variable Z/4Z system", () => {
    for (let encoded = 0; encoded < 4 ** 6; encoded += 1) {
      const digits = Array<number>(6).fill(0);
      let remainder = encoded;
      for (let index = 0; index < digits.length; index += 1) {
        digits[index] = remainder % 4;
        remainder = Math.floor(remainder / 4);
      }
      const matrix = [digits.slice(0, 2), digits.slice(2, 4)];
      const target = digits.slice(4, 6);
      const expected = bruteForce(matrix, target, 4);
      const actual = solveModuloFour(matrix, target);
      expect(actual.status).toBe(expected ? "solved" : "unsolvable");
      if (expected) {
        expect(satisfies(matrix, actual.values, target, 4)).toBe(true);
        expect(actual.values.reduce((sum, value) => sum + value, 0)).toBe(
          expected.reduce((sum, value) => sum + value, 0),
        );
      }
    }
  });
});

describe("automatic solver selection", () => {
  it.each(["square", "hex", "triangle"] as const)(
    "derives the influence matrix from the %s topology through Engine API",
    (geometry) => {
      const mechanics = createStandardRegistry();
      const { initialState, ruleset } = createExperiment({
        size: 4,
        geometry,
        stateCount: 3,
        defaultInfluence: "neighbors",
        seed: 63,
      });
      const result = solvePuzzle(initialState, ruleset, mechanics);
      expect(result.status).toBe("solved");
      let state = initialState;
      for (const anchorEntityId of result.presses) {
        state = dispatch(
          { ...state, status: "playing" },
          { type: "activate", anchorEntityId },
          ruleset,
          mechanics,
        ).state;
      }
      expect(state.status).toBe("won");
    },
  );

  it.each([3, 4])("solves heterogeneous influences against a partial %i-state target", (stateCount) => {
    const mechanics = createStandardRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount,
      defaultInfluence: "cross",
      compositeInfluence: true,
      influenceOverrides: { "n:1:1": "king", "n:0:0": "diagonal" },
      goalValues: { "n:0:0": 2, "n:1:1": 1, "n:2:2": 0 },
      seed: 81,
    });
    const result = solvePuzzle(initialState, ruleset, mechanics);
    expect(result.status).toBe("solved");
    let state = initialState;
    for (const anchorEntityId of result.presses) {
      state = dispatch(
        { ...state, status: "playing" },
        { type: "activate", anchorEntityId },
        ruleset,
        mechanics,
      ).state;
    }
    expect(state.status).toBe("won");
  });

  it.each([
    [2, "prime-field-linear"],
    [3, "prime-field-linear"],
    [4, "modulo-four-linear"],
    [5, "prime-field-linear"],
    [7, "prime-field-linear"],
  ] as const)("solves a generated %i-state board with %s", (stateCount, solverId) => {
    const mechanics = createStandardRegistry();
    const solvers = createDefaultSolverRegistry();
    const { initialState, ruleset } = createExperiment({
      size: 4,
      stateCount,
      defaultInfluence: "king",
      goalValues: Object.fromEntries(
        Array.from({ length: 4 }, (_, y) =>
          Array.from({ length: 4 }, (_, x) => [`n:${x}:${y}`, stateCount - 1] as const),
        ).flat(),
      ),
      seed: 27,
    });
    const result = solvePuzzle(initialState, ruleset, mechanics, solvers);
    expect(result.status).toBe("solved");
    expect(result.solverId).toBe(solverId);
    expect(result.modulus).toBe(stateCount);

    let state = initialState;
    for (const anchorEntityId of result.presses) {
      state = dispatch(
        { ...state, status: "playing" },
        { type: "activate", anchorEntityId },
        ruleset,
        mechanics,
      ).state;
    }
    expect(
      Object.values(state.entities).every(
        (entity) => entity.channels.power === stateCount - 1,
      ),
    ).toBe(true);
  });

  it("builds the additive model only once while selecting the modulo-four solver", () => {
    const mechanics = createStandardRegistry();
    const selector = mechanics.selectors.get("anchor-influence");
    expect(selector).toBeDefined();
    if (!selector) return;
    let targetQueries = 0;
    mechanics.selectors.set("anchor-influence", (context) => {
      targetQueries += 1;
      return selector(context);
    });
    const { initialState, ruleset } = createExperiment({
      size: 3,
      stateCount: 4,
      defaultInfluence: "cross",
      seed: 13,
    });

    expect(solvePuzzle(initialState, ruleset, mechanics).status).toBe("solved");
    expect(targetQueries).toBe(Object.keys(initialState.entities).length);
  });
});

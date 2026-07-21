import { solveModuloFour, solvePrimeLinear, type LinearSolution } from "./algebra";
import { analyzeAdditiveRule, modulo, type AdditiveRuleModel } from "./model";
import {
  type PuzzleSolver,
  type SolveResult,
  unsupportedResult,
} from "./types";

function isPrime(value: number): boolean {
  if (!Number.isInteger(value) || value < 2) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
    if (value % divisor === 0) return false;
  }
  return true;
}

function resultFromLinearSolution(
  model: AdditiveRuleModel,
  solution: LinearSolution,
  solver: Pick<PuzzleSolver, "id" | "name">,
): SolveResult {
  if (solution.status === "unsolvable") {
    return {
      status: "unsolvable",
      solverId: solver.id,
      solverName: solver.name,
      modulus: model.modulus,
      presses: [],
      rank: solution.rank,
      freeVariables: solution.freeVariables,
      minimal: false,
    };
  }

  const presses = model.entityIds.flatMap((entityId, column) =>
    Array<string>(solution.values[column] ?? 0).fill(entityId),
  );
  if (
    model.matrix.some(
      (row, rowIndex) =>
        modulo(
          row.reduce(
            (sum, coefficient, column) =>
              sum + coefficient * (solution.values[column] ?? 0),
            0,
          ),
          model.modulus,
        ) !== model.target[rowIndex],
    )
  ) {
    return unsupportedResult(
      "Solver produced a result that does not satisfy the linear model",
      solver.id,
      solver.name,
      model.modulus,
    );
  }

  return {
    status: "solved",
    solverId: solver.id,
    solverName: solver.name,
    modulus: model.modulus,
    presses,
    rank: solution.rank,
    freeVariables: solution.freeVariables,
    minimal: solution.minimal,
  };
}

export const primeFieldSolver: PuzzleSolver = {
  id: "prime-field-linear",
  name: "GF(p) 质数域线性求解",
  priority: 100,
  supports(context) {
    const analysis = analyzeAdditiveRule(context);
    if (!analysis.supported) return analysis;
    return isPrime(analysis.model.modulus)
      ? { supported: true }
      : {
          supported: false,
          reason: `Modulus ${analysis.model.modulus} is not a supported prime field`,
        };
  },
  solve(context) {
    const analysis = analyzeAdditiveRule(context);
    if (!analysis.supported) {
      return unsupportedResult(analysis.reason, this.id, this.name);
    }
    if (!isPrime(analysis.model.modulus)) {
      return unsupportedResult(
        `Modulus ${analysis.model.modulus} is not a supported prime field`,
        this.id,
        this.name,
        analysis.model.modulus,
      );
    }
    const solution = solvePrimeLinear(
      analysis.model.matrix,
      analysis.model.target,
      analysis.model.modulus,
    );
    return resultFromLinearSolution(analysis.model, solution, this);
  },
};

export const moduloFourSolver: PuzzleSolver = {
  id: "modulo-four-linear",
  name: "Z/4Z 模环线性求解",
  priority: 90,
  supports(context) {
    const analysis = analyzeAdditiveRule(context);
    if (!analysis.supported) return analysis;
    return analysis.model.modulus === 4
      ? { supported: true }
      : { supported: false, reason: "Solver only supports modulo-4 rules" };
  },
  solve(context) {
    const analysis = analyzeAdditiveRule(context);
    if (!analysis.supported) {
      return unsupportedResult(analysis.reason, this.id, this.name);
    }
    if (analysis.model.modulus !== 4) {
      return unsupportedResult(
        "Solver only supports modulo-4 rules",
        this.id,
        this.name,
        analysis.model.modulus,
      );
    }
    const columnCount = analysis.model.entityIds.length;
    const squareMatrix = [
      ...analysis.model.matrix.map((row) => [...row]),
      ...Array.from(
        { length: Math.max(0, columnCount - analysis.model.matrix.length) },
        () => Array<number>(columnCount).fill(0),
      ),
    ];
    const squareTarget = [
      ...analysis.model.target,
      ...Array<number>(Math.max(0, columnCount - analysis.model.target.length)).fill(0),
    ];
    const solution = solveModuloFour(squareMatrix, squareTarget);
    return resultFromLinearSolution(analysis.model, solution, this);
  },
};

import type { GameState, MechanicRegistry, Ruleset } from "@lightout/engine";
import { analyzeAdditiveRule } from "./model";
import { primeFieldSolver } from "./solvers";
import { type SolveResult, unsupportedResult } from "./types";

/** Backward-compatible entry point for callers that explicitly require GF(2). */
export function solveBinaryToggle(
  state: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
  registry: MechanicRegistry,
): SolveResult {
  const context = { state, ruleset, registry };
  const analysis = analyzeAdditiveRule(context);
  if (!analysis.supported) {
    return unsupportedResult(analysis.reason, primeFieldSolver.id, primeFieldSolver.name);
  }
  if (analysis.model.modulus !== 2) {
    return unsupportedResult(
      "GF(2) solver only supports two-state rules",
      primeFieldSolver.id,
      primeFieldSolver.name,
      analysis.model.modulus,
    );
  }
  return primeFieldSolver.solve(context);
}

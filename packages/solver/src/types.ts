import type { GameState, MechanicRegistry, Ruleset } from "@lightout/engine";

export interface SolverContext {
  state: Readonly<GameState>;
  ruleset: Readonly<Ruleset>;
  registry: MechanicRegistry;
  analysisCache: Map<string, unknown>;
}

export interface SolverSupport {
  supported: boolean;
  reason?: string;
}

export interface SolveResult {
  status: "solved" | "unsolvable" | "unsupported";
  solverId: string;
  solverName: string;
  modulus: number;
  presses: string[];
  rank: number;
  freeVariables: number;
  minimal: boolean;
  reason?: string;
}

export interface PuzzleSolver {
  id: string;
  name: string;
  priority: number;
  supports(context: SolverContext): SolverSupport;
  solve(context: SolverContext): SolveResult;
}

export interface SolverRegistry {
  solvers: PuzzleSolver[];
}

export function unsupportedResult(
  reason: string,
  solverId = "none",
  solverName = "No compatible solver",
  modulus = 0,
): SolveResult {
  return {
    status: "unsupported",
    solverId,
    solverName,
    modulus,
    presses: [],
    rank: 0,
    freeVariables: 0,
    minimal: false,
    reason,
  };
}

import type { GameState, MechanicRegistry, Ruleset } from "@lightout/engine";
import { moduloFourSolver, primeFieldSolver } from "./solvers";
import {
  type PuzzleSolver,
  type SolveResult,
  type SolverRegistry,
  unsupportedResult,
} from "./types";

export function createSolverRegistry(solvers: readonly PuzzleSolver[] = []): SolverRegistry {
  const registered: PuzzleSolver[] = [];
  for (const solver of solvers) {
    if (registered.some((candidate) => candidate.id === solver.id)) {
      throw new Error(`Solver already registered: ${solver.id}`);
    }
    registered.push(solver);
  }
  return { solvers: registered.sort((a, b) => b.priority - a.priority) };
}

export function registerSolver(registry: SolverRegistry, solver: PuzzleSolver): void {
  if (registry.solvers.some((candidate) => candidate.id === solver.id)) {
    throw new Error(`Solver already registered: ${solver.id}`);
  }
  registry.solvers.push(solver);
  registry.solvers.sort((a, b) => b.priority - a.priority);
}

export function createDefaultSolverRegistry(): SolverRegistry {
  return createSolverRegistry([primeFieldSolver, moduloFourSolver]);
}

export function solvePuzzle(
  state: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
  mechanics: MechanicRegistry,
  solvers: SolverRegistry = createDefaultSolverRegistry(),
): SolveResult {
  const context = { state, ruleset, registry: mechanics };
  const reasons: string[] = [];
  for (const solver of solvers.solvers) {
    const support = solver.supports(context);
    if (support.supported) return solver.solve(context);
    if (support.reason) reasons.push(`${solver.name}: ${support.reason}`);
  }
  return unsupportedResult(
    reasons.length > 0 ? reasons.join("; ") : "No solver is registered",
  );
}

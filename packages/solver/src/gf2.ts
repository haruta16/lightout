import {
  getCommandTargets,
  type GameState,
  type MechanicRegistry,
  type Ruleset,
} from "@lightout/engine";

export interface SolveResult {
  status: "solved" | "unsolvable" | "unsupported";
  presses: string[];
  rank: number;
  freeVariables: number;
  minimal: boolean;
  reason?: string;
}

function powerOf(state: Readonly<GameState>, entityId: string): number {
  return Number(state.entities[entityId]?.channels.power ?? 0) & 1;
}

export function solveBinaryToggle(
  state: Readonly<GameState>,
  ruleset: Readonly<Ruleset>,
  registry: MechanicRegistry,
): SolveResult {
  const stateCount = Number(ruleset.metadata?.stateCount ?? 2);
  const goalValue = Number(ruleset.metadata?.goalValue ?? 0);
  if (stateCount !== 2) {
    return {
      status: "unsupported",
      presses: [],
      rank: 0,
      freeVariables: 0,
      minimal: false,
      reason: "GF(2) solver only supports two-state rules",
    };
  }

  const entityIds = Object.values(state.entities)
    .filter((entity) => entity.kind === "light")
    .sort((a, b) => {
      const na = a.nodeId ? state.board.nodes[a.nodeId] : undefined;
      const nb = b.nodeId ? state.board.nodes[b.nodeId] : undefined;
      return (
        (na?.position.y ?? 0) - (nb?.position.y ?? 0) ||
        (na?.position.x ?? 0) - (nb?.position.x ?? 0)
      );
    })
    .map((entity) => entity.id);
  const count = entityIds.length;
  const index = new Map(entityIds.map((id, position) => [id, position]));
  const matrix = Array.from({ length: count }, (_, row) => {
    const values = Array<number>(count + 1).fill(0);
    values[count] = powerOf(state, entityIds[row] ?? "") ^ (goalValue & 1);
    return values;
  });

  entityIds.forEach((anchorEntityId, column) => {
    const targets = getCommandTargets(
      state,
      { type: "activate", anchorEntityId },
      ruleset,
      registry,
    );
    for (const targetId of targets) {
      const row = index.get(targetId);
      if (row !== undefined && matrix[row]) matrix[row][column] = 1;
    }
  });

  const pivotColumns: number[] = [];
  let pivotRow = 0;
  for (let column = 0; column < count && pivotRow < count; column += 1) {
    const swapRow = matrix.findIndex(
      (row, candidate) => candidate >= pivotRow && row?.[column] === 1,
    );
    if (swapRow < 0) continue;
    [matrix[pivotRow], matrix[swapRow]] = [matrix[swapRow]!, matrix[pivotRow]!];
    for (let row = 0; row < count; row += 1) {
      if (row === pivotRow || matrix[row]?.[column] !== 1) continue;
      for (let c = column; c <= count; c += 1) {
        matrix[row]![c] = (matrix[row]![c] ?? 0) ^ (matrix[pivotRow]![c] ?? 0);
      }
    }
    pivotColumns.push(column);
    pivotRow += 1;
  }

  for (let row = pivotRow; row < count; row += 1) {
    const lhsEmpty = matrix[row]?.slice(0, count).every((value) => value === 0);
    if (lhsEmpty && matrix[row]?.[count] === 1) {
      return {
        status: "unsolvable",
        presses: [],
        rank: pivotColumns.length,
        freeVariables: count - pivotColumns.length,
        minimal: true,
      };
    }
  }

  const pivotSet = new Set(pivotColumns);
  const freeColumns = Array.from({ length: count }, (_, column) => column).filter(
    (column) => !pivotSet.has(column),
  );

  function solutionFor(mask: number): number[] {
    const solution = Array<number>(count).fill(0);
    freeColumns.forEach((column, bit) => {
      solution[column] = (mask >> bit) & 1;
    });
    for (let row = pivotColumns.length - 1; row >= 0; row -= 1) {
      const column = pivotColumns[row];
      if (column === undefined) continue;
      let value = matrix[row]?.[count] ?? 0;
      for (const freeColumn of freeColumns) {
        value ^= (matrix[row]?.[freeColumn] ?? 0) & (solution[freeColumn] ?? 0);
      }
      solution[column] = value;
    }
    return solution;
  }

  const canEnumerate = freeColumns.length <= 18;
  const combinations = canEnumerate ? 2 ** freeColumns.length : 1;
  let best = solutionFor(0);
  let bestWeight = best.reduce((sum, value) => sum + value, 0);
  for (let mask = 1; mask < combinations; mask += 1) {
    const candidate = solutionFor(mask);
    const weight = candidate.reduce((sum, value) => sum + value, 0);
    if (weight < bestWeight) {
      best = candidate;
      bestWeight = weight;
    }
  }

  return {
    status: "solved",
    presses: entityIds.filter((_, column) => best[column] === 1),
    rank: pivotColumns.length,
    freeVariables: freeColumns.length,
    minimal: canEnumerate,
  };
}

import { modulo } from "./model";

export interface LinearSolution {
  status: "solved" | "unsolvable";
  values: number[];
  rank: number;
  freeVariables: number;
  minimal: boolean;
}

const ENUMERATION_LIMIT = 262_144;

function combinationCount(radices: readonly number[]): number {
  let count = 1;
  for (const radix of radices) {
    if (count > ENUMERATION_LIMIT / radix) return ENUMERATION_LIMIT + 1;
    count *= radix;
  }
  return count;
}

function inversePrime(value: number, prime: number): number {
  for (let candidate = 1; candidate < prime; candidate += 1) {
    if (modulo(value * candidate, prime) === 1) return candidate;
  }
  throw new Error(`No inverse for ${value} modulo ${prime}`);
}

export function solvePrimeLinear(
  sourceMatrix: readonly (readonly number[])[],
  sourceTarget: readonly number[],
  prime: number,
): LinearSolution {
  const rows = sourceMatrix.length;
  const columns = sourceMatrix[0]?.length ?? 0;
  const matrix = sourceMatrix.map((row, index) => [
    ...row.map((value) => modulo(value, prime)),
    modulo(sourceTarget[index] ?? 0, prime),
  ]);
  const pivotColumns: number[] = [];
  let pivotRow = 0;

  for (let column = 0; column < columns && pivotRow < rows; column += 1) {
    const swapRow = matrix.findIndex(
      (row, candidate) => candidate >= pivotRow && (row?.[column] ?? 0) !== 0,
    );
    if (swapRow < 0) continue;
    [matrix[pivotRow], matrix[swapRow]] = [matrix[swapRow]!, matrix[pivotRow]!];
    const inverse = inversePrime(matrix[pivotRow]?.[column] ?? 0, prime);
    for (let c = column; c <= columns; c += 1) {
      matrix[pivotRow]![c] = modulo((matrix[pivotRow]?.[c] ?? 0) * inverse, prime);
    }
    for (let row = 0; row < rows; row += 1) {
      if (row === pivotRow) continue;
      const factor = matrix[row]?.[column] ?? 0;
      if (factor === 0) continue;
      for (let c = column; c <= columns; c += 1) {
        matrix[row]![c] = modulo(
          (matrix[row]?.[c] ?? 0) - factor * (matrix[pivotRow]?.[c] ?? 0),
          prime,
        );
      }
    }
    pivotColumns.push(column);
    pivotRow += 1;
  }

  for (let row = pivotRow; row < rows; row += 1) {
    const empty = matrix[row]?.slice(0, columns).every((value) => value === 0);
    if (empty && (matrix[row]?.[columns] ?? 0) !== 0) {
      return {
        status: "unsolvable",
        values: [],
        rank: pivotColumns.length,
        freeVariables: columns - pivotColumns.length,
        minimal: false,
      };
    }
  }

  const pivotSet = new Set(pivotColumns);
  const freeColumns = Array.from({ length: columns }, (_, column) => column).filter(
    (column) => !pivotSet.has(column),
  );
  const combinations = combinationCount(freeColumns.map(() => prime));
  const canEnumerate = combinations <= ENUMERATION_LIMIT;
  const limit = canEnumerate ? combinations : 1;
  let best = Array<number>(columns).fill(0);
  let bestWeight = Number.POSITIVE_INFINITY;

  for (let encoded = 0; encoded < limit; encoded += 1) {
    const values = Array<number>(columns).fill(0);
    let remainder = encoded;
    for (const column of freeColumns) {
      values[column] = remainder % prime;
      remainder = Math.floor(remainder / prime);
    }
    for (let row = pivotColumns.length - 1; row >= 0; row -= 1) {
      const column = pivotColumns[row];
      if (column === undefined) continue;
      let value = matrix[row]?.[columns] ?? 0;
      for (const freeColumn of freeColumns) {
        value -= (matrix[row]?.[freeColumn] ?? 0) * (values[freeColumn] ?? 0);
      }
      values[column] = modulo(value, prime);
    }
    const weight = values.reduce((sum, value) => sum + value, 0);
    if (weight < bestWeight) {
      best = values;
      bestWeight = weight;
    }
  }

  return {
    status: "solved",
    values: best,
    rank: pivotColumns.length,
    freeVariables: freeColumns.length,
    minimal: canEnumerate,
  };
}

function identity(size: number): number[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (row === column ? 1 : 0)),
  );
}

export function solveModuloFour(
  sourceMatrix: readonly (readonly number[])[],
  sourceTarget: readonly number[],
): LinearSolution {
  const rows = sourceMatrix.length;
  const columns = sourceMatrix[0]?.length ?? 0;
  const matrix = sourceMatrix.map((row) => row.map((value) => modulo(value, 4)));
  const target = sourceTarget.map((value) => modulo(value, 4));
  const transform = identity(columns);

  function swapRows(first: number, second: number): void {
    [matrix[first], matrix[second]] = [matrix[second]!, matrix[first]!];
    [target[first], target[second]] = [target[second] ?? 0, target[first] ?? 0];
  }

  function swapColumns(first: number, second: number): void {
    for (let row = 0; row < rows; row += 1) {
      [matrix[row]![first], matrix[row]![second]] = [
        matrix[row]?.[second] ?? 0,
        matrix[row]?.[first] ?? 0,
      ];
    }
    for (let row = 0; row < columns; row += 1) {
      [transform[row]![first], transform[row]![second]] = [
        transform[row]?.[second] ?? 0,
        transform[row]?.[first] ?? 0,
      ];
    }
  }

  function addRow(targetRow: number, sourceRow: number, factor: number): void {
    for (let column = 0; column < columns; column += 1) {
      matrix[targetRow]![column] = modulo(
        (matrix[targetRow]?.[column] ?? 0) +
          factor * (matrix[sourceRow]?.[column] ?? 0),
        4,
      );
    }
    target[targetRow] = modulo(
      (target[targetRow] ?? 0) + factor * (target[sourceRow] ?? 0),
      4,
    );
  }

  function addColumn(targetColumn: number, sourceColumn: number, factor: number): void {
    for (let row = 0; row < rows; row += 1) {
      matrix[row]![targetColumn] = modulo(
        (matrix[row]?.[targetColumn] ?? 0) +
          factor * (matrix[row]?.[sourceColumn] ?? 0),
        4,
      );
    }
    for (let row = 0; row < columns; row += 1) {
      transform[row]![targetColumn] = modulo(
        (transform[row]?.[targetColumn] ?? 0) +
          factor * (transform[row]?.[sourceColumn] ?? 0),
        4,
      );
    }
  }

  function scaleRow(row: number, factor: number): void {
    for (let column = 0; column < columns; column += 1) {
      matrix[row]![column] = modulo((matrix[row]?.[column] ?? 0) * factor, 4);
    }
    target[row] = modulo((target[row] ?? 0) * factor, 4);
  }

  let pivot = 0;
  while (pivot < Math.min(rows, columns)) {
    let foundRow = -1;
    let foundColumn = -1;
    for (let row = pivot; row < rows && foundRow < 0; row += 1) {
      for (let column = pivot; column < columns; column += 1) {
        if ((matrix[row]?.[column] ?? 0) % 2 === 1) {
          foundRow = row;
          foundColumn = column;
          break;
        }
      }
    }
    if (foundRow < 0) break;
    swapRows(pivot, foundRow);
    swapColumns(pivot, foundColumn);
    if (matrix[pivot]?.[pivot] === 3) scaleRow(pivot, 3);
    for (let row = 0; row < rows; row += 1) {
      if (row !== pivot && (matrix[row]?.[pivot] ?? 0) !== 0) {
        addRow(row, pivot, -(matrix[row]?.[pivot] ?? 0));
      }
    }
    for (let column = 0; column < columns; column += 1) {
      if (column !== pivot && (matrix[pivot]?.[column] ?? 0) !== 0) {
        addColumn(column, pivot, -(matrix[pivot]?.[column] ?? 0));
      }
    }
    pivot += 1;
  }

  while (pivot < Math.min(rows, columns)) {
    let foundRow = -1;
    let foundColumn = -1;
    for (let row = pivot; row < rows && foundRow < 0; row += 1) {
      for (let column = pivot; column < columns; column += 1) {
        if ((matrix[row]?.[column] ?? 0) === 2) {
          foundRow = row;
          foundColumn = column;
          break;
        }
      }
    }
    if (foundRow < 0) break;
    swapRows(pivot, foundRow);
    swapColumns(pivot, foundColumn);
    for (let row = 0; row < rows; row += 1) {
      if (row !== pivot && (matrix[row]?.[pivot] ?? 0) === 2) {
        addRow(row, pivot, -1);
      }
    }
    for (let column = 0; column < columns; column += 1) {
      if (column !== pivot && (matrix[pivot]?.[column] ?? 0) === 2) {
        addColumn(column, pivot, -1);
      }
    }
    pivot += 1;
  }

  for (let row = pivot; row < rows; row += 1) {
    const empty = matrix[row]?.every((value) => value === 0);
    if (empty && (target[row] ?? 0) !== 0) {
      return { status: "unsolvable", values: [], rank: pivot, freeVariables: columns - pivot, minimal: false };
    }
  }

  const choices: number[][] = [];
  let rank = 0;
  let freeVariables = 0;
  for (let index = 0; index < columns; index += 1) {
    const diagonal = index < pivot ? matrix[index]?.[index] ?? 0 : 0;
    const value = index < rows ? target[index] ?? 0 : 0;
    if (diagonal === 1) {
      choices.push([value]);
      rank += 1;
    } else if (diagonal === 2) {
      if (value % 2 !== 0) {
        return { status: "unsolvable", values: [], rank, freeVariables, minimal: false };
      }
      const base = (value / 2) % 2;
      choices.push([base, base + 2]);
      rank += 1;
      freeVariables += 1;
    } else {
      if (value !== 0) {
        return { status: "unsolvable", values: [], rank, freeVariables, minimal: false };
      }
      choices.push([0, 1, 2, 3]);
      freeVariables += 1;
    }
  }

  const combinations = combinationCount(choices.map((values) => values.length));
  const canEnumerate = combinations <= ENUMERATION_LIMIT;
  const limit = canEnumerate ? combinations : 1;
  let best = Array<number>(columns).fill(0);
  let bestWeight = Number.POSITIVE_INFINITY;

  for (let encoded = 0; encoded < limit; encoded += 1) {
    const diagonalValues = Array<number>(columns).fill(0);
    let remainder = encoded;
    for (let index = 0; index < columns; index += 1) {
      const options = choices[index] ?? [0];
      diagonalValues[index] = options[remainder % options.length] ?? 0;
      remainder = Math.floor(remainder / options.length);
    }
    const values = Array.from({ length: columns }, (_, row) =>
      modulo(
        diagonalValues.reduce(
          (sum, value, column) => sum + (transform[row]?.[column] ?? 0) * value,
          0,
        ),
        4,
      ),
    );
    const weight = values.reduce((sum, value) => sum + value, 0);
    if (weight < bestWeight) {
      best = values;
      bestWeight = weight;
    }
  }

  return {
    status: "solved",
    values: best,
    rank,
    freeVariables,
    minimal: canEnumerate,
  };
}

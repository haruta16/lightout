import { cloneState } from "./state";
import type { GameState, HistoryState } from "./types";

const HISTORY_LIMIT = 256;

function appendPast(past: readonly GameState[], state: Readonly<GameState>): GameState[] {
  return [...past, cloneState(state)].slice(-HISTORY_LIMIT);
}

export function createHistory(initial: Readonly<GameState>): HistoryState {
  return { past: [], present: cloneState(initial), future: [] };
}

export function commitHistory(
  history: Readonly<HistoryState>,
  next: Readonly<GameState>,
): HistoryState {
  return {
    past: appendPast(history.past, history.present),
    present: cloneState(next),
    future: [],
  };
}

export function undoHistory(history: Readonly<HistoryState>): HistoryState {
  const previous = history.past.at(-1);
  if (!previous) return structuredClone(history) as HistoryState;
  return {
    past: history.past.slice(0, -1).map(cloneState),
    present: cloneState(previous),
    future: [cloneState(history.present), ...history.future.map(cloneState)],
  };
}

export function redoHistory(history: Readonly<HistoryState>): HistoryState {
  const [next, ...future] = history.future;
  if (!next) return structuredClone(history) as HistoryState;
  return {
    past: appendPast(history.past.map(cloneState), history.present),
    present: cloneState(next),
    future: future.map(cloneState),
  };
}

export function resetHistory(state: Readonly<GameState>): HistoryState {
  return createHistory(state);
}

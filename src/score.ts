import type { Extraction, FactValue } from './types';

export interface Fixture {
  id: string;
  prose: string;
  /** Paths that must be produced, with the value they must carry. */
  expect: Record<string, FactValue>;
  /** Paths the extractor must NOT produce a value for. */
  abstain: string[];
  note?: string;
}

/**
 * Four outcomes, deliberately not collapsed into one accuracy number.
 * `overreach` is the one that matters: a confident wrong fact reaches the
 * engine and computes, where a missed one announces itself.
 */
export interface Score {
  correct: number;
  wrongValue: number;
  missed: number;
  overreach: number;
}

export const EMPTY: Score = {
  correct: 0,
  wrongValue: 0,
  missed: 0,
  overreach: 0,
};

export function scoreOne(fixture: Fixture, out: Extraction): Score {
  const got = new Map<string, FactValue>();
  for (const f of out.facts)
    if (f.status === 'complete') got.set(f.path, f.value);

  const s = { ...EMPTY };
  for (const [path, want] of Object.entries(fixture.expect)) {
    if (!got.has(path)) s.missed++;
    else if (got.get(path) === want) s.correct++;
    else s.wrongValue++;
  }
  for (const path of fixture.abstain) if (got.has(path)) s.overreach++;
  return s;
}

export function add(a: Score, b: Score): Score {
  return {
    correct: a.correct + b.correct,
    wrongValue: a.wrongValue + b.wrongValue,
    missed: a.missed + b.missed,
    overreach: a.overreach + b.overreach,
  };
}
